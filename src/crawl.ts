// Coleta catálogo + preços do eShop JP e BR e grava no SQLite.
//   npm run crawl
import type { DatabaseSync } from 'node:sqlite';
import { openDb, setMeta, transaction, type Region } from './db.ts';
import { describeError } from './http.ts';
import { fetchEcPrices } from './sources/ec-price.ts';
import { fetchJpyBrl } from './sources/fx.ts';
import { fetchJpCatalog, type JpGame } from './sources/jp-search.ts';
import { loadTitleDb } from './sources/titledb.ts';

type GameRow = {
  id: string;
  name: string;
  nameJp: string | null;
  publisher: string | null;
  platform: string | null;
  releaseDate: string | null;
  image: string | null;
  nsuidBr: string | null;
  nsuidJp: string | null;
};

type PriceRow = {
  gameId: string;
  region: Region;
  currency: string;
  regular: number;
  current: number;
  saleStart: string | null;
  saleEnd: string | null;
  status: string;
};

/** Title IDs de Switch 2 começam com 04; os de Switch 1, com 01. */
const platformOf = (titleId: string) => (titleId.startsWith('04') ? 'switch2' : 'switch');

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${msg}`);

function saveGames(db: DatabaseSync, games: Iterable<GameRow>, now: string): void {
  const stmt = db.prepare(`
    insert into game (id, name, name_jp, publisher, platform, release_date, image, nsuid_br, nsuid_jp, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name, name_jp = excluded.name_jp, publisher = excluded.publisher,
      platform = excluded.platform, release_date = excluded.release_date, image = excluded.image,
      nsuid_br = excluded.nsuid_br, nsuid_jp = excluded.nsuid_jp, updated_at = excluded.updated_at`);
  for (const g of games) {
    stmt.run(g.id, g.name, g.nameJp, g.publisher, g.platform, g.releaseDate, g.image, g.nsuidBr, g.nsuidJp, now);
  }
}

/** Grava os preços da região, registra histórico quando muda e remove o que saiu da loja. */
function savePrices(db: DatabaseSync, region: Region, prices: PriceRow[], now: string, removeMissing: boolean): number {
  const prev = db.prepare('select regular, current from price where game_id = ? and region = ?');
  const upsert = db.prepare(`
    insert into price (game_id, region, currency, regular, current, sale_start, sale_end, status, fetched_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(game_id, region) do update set
      currency = excluded.currency, regular = excluded.regular, current = excluded.current,
      sale_start = excluded.sale_start, sale_end = excluded.sale_end, status = excluded.status,
      fetched_at = excluded.fetched_at`);
  const history = db.prepare('insert into price_history (game_id, region, regular, current, seen_at) values (?, ?, ?, ?, ?)');

  let changed = 0;
  for (const p of prices) {
    const old = prev.get(p.gameId, region) as { regular: number; current: number } | undefined;
    if (!old || old.regular !== p.regular || old.current !== p.current) {
      history.run(p.gameId, region, p.regular, p.current, now);
      changed++;
    }
    upsert.run(p.gameId, region, p.currency, p.regular, p.current, p.saleStart, p.saleEnd, p.status, now);
  }
  if (removeMissing) db.prepare('delete from price where region = ? and fetched_at < ?').run(region, now);
  return changed;
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const db = openDb();

  log('Câmbio JPY -> BRL...');
  const fx = await fetchJpyBrl();
  log(`  1 JPY = R$ ${fx.rate.toFixed(5)} (${fx.source})`);

  // Carregados em sequência: cada arquivo tem ~80 MB de JSON.
  log('titledb BR (catálogo brasileiro)...');
  const tdbBr = await loadTitleDb('BR.pt.json');
  log(`  ${tdbBr.size} jogos`);
  log('titledb JP (nsuid -> Title ID e ícone)...');
  const tdbJp = await loadTitleDb('JP.ja.json');
  log(`  ${tdbJp.size} jogos`);

  log('Catálogo + preços JP (search.nintendo.jp)...');
  const jp = await fetchJpCatalog();
  log(`  ${jp.games.length} de ${jp.total} jogos à venda`);

  log(`Preços BR (api.ec.nintendo.com, ${Math.ceil(tdbBr.size / 50)} lotes)...`);
  const br = await fetchEcPrices('BR', 'pt', [...tdbBr.keys()]);
  const brOk = br.failedBatches === 0;
  if (br.failedBatches === br.batches) {
    console.warn(`  !! API de preços inacessível (${br.firstError}). Preços BR anteriores foram mantidos.`);
  } else {
    log(`  ${br.prices.length} preços${brOk ? '' : ` (${br.failedBatches} lotes falharam: ${br.firstError})`}`);
  }

  // --- Junta JP e BR pelo Title ID ---
  const games = new Map<string, GameRow>();
  const brPrices: PriceRow[] = [];
  const jpPrices: PriceRow[] = [];
  const brPriceByNsuid = new Map(br.prices.map((p) => [p.nsuid, p]));

  const brIdByNsuid = new Map<string, string>();
  for (const g of tdbBr.values()) {
    const id = g.titleId ?? `br-${g.nsuid}`;
    if (games.has(id)) continue; // mesma Title ID em dois nsuids (raro): fica o primeiro
    brIdByNsuid.set(g.nsuid, id);
    games.set(id, {
      id,
      name: g.name,
      nameJp: null,
      publisher: g.publisher,
      platform: g.titleId ? platformOf(g.titleId) : 'switch',
      releaseDate: g.releaseDate,
      image: g.image,
      nsuidBr: g.nsuid,
      nsuidJp: null,
    });
  }
  for (const [nsuid, id] of brIdByNsuid) {
    const p = brPriceByNsuid.get(nsuid);
    if (p) brPrices.push({ gameId: id, region: 'BR', ...p });
  }

  // Mesmo Title ID em mais de um produto JP (ex.: jogo base e "Nintendo Switch 2 Edition"):
  // vence o da plataforma do Title ID e, entre esses, o mais barato. O loop abaixo fica com o primeiro.
  const rank = (g: JpGame) => {
    const titleId = tdbJp.get(g.nsuid)?.titleId;
    return titleId && platformOf(titleId) === g.platform ? 0 : 1;
  };
  const jpGames = [...jp.games].sort((a, b) => rank(a) - rank(b) || a.current - b.current);

  let matched = 0;
  for (const g of jpGames) {
    const tdb = tdbJp.get(g.nsuid);
    const id = tdb?.titleId ?? `jp-${g.nsuid}`;
    // Ícone quadrado do titledb; a imagem da busca JP é um retrato 1080x1920.
    const image = tdb?.image ?? g.image;
    const existing = games.get(id);
    if (existing?.nsuidJp) continue;
    if (existing) {
      matched++;
      existing.nameJp = g.name;
      existing.nsuidJp = g.nsuid;
      existing.platform = g.platform;
      existing.image ??= image;
      existing.releaseDate ??= g.releaseDate;
    } else {
      games.set(id, {
        id,
        name: g.name,
        nameJp: g.name,
        publisher: g.publisher,
        platform: g.platform,
        releaseDate: g.releaseDate,
        image,
        nsuidBr: null,
        nsuidJp: g.nsuid,
      });
    }
    jpPrices.push({
      gameId: id,
      region: 'JP',
      currency: 'JPY',
      regular: g.regular,
      current: g.current,
      saleStart: g.saleStart,
      saleEnd: g.saleEnd,
      status: 'onsale',
    });
  }
  log(`${matched} jogos casados JP <-> BR pelo Title ID`);

  const { brChanged, jpChanged } = transaction(db, () => {
    saveGames(db, games.values(), now);
    const brChanged = br.prices.length ? savePrices(db, 'BR', brPrices, now, brOk) : 0;
    const jpChanged = savePrices(db, 'JP', jpPrices, now, true);
    setMeta(db, 'fx_jpy_brl', String(fx.rate));
    setMeta(db, 'fx_source', fx.source);
    setMeta(db, 'fx_at', fx.at);
    setMeta(db, 'crawled_at', now);
    if (br.prices.length) setMeta(db, 'br_crawled_at', now);
    setMeta(db, 'jp_crawled_at', now);
    return { brChanged, jpChanged };
  });
  log(`Gravado. Mudanças de preço: BR ${brChanged}, JP ${jpChanged}.`);
  db.close();
}

main().catch((err) => {
  console.error(`Crawl falhou: ${describeError(err)}`);
  process.exitCode = 1;
});
