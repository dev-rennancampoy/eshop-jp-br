// Coleta catálogo + preços do eShop JP e BR e grava no SQLite.
//   npm run crawl
import type { DatabaseSync } from 'node:sqlite';
import { openDb, setMeta, transaction, type Region } from './db.ts';
import { ALIASES, NOT_SAME } from './aliases.ts';
import { describeError } from './http.ts';
import { brPublisherGroup, jpPublisherGroup, nameKey, releaseKeys, sharesLatinWords } from './matching.ts';
import { fetchBrStore } from './sources/br-store.ts';
import { fetchEcPrices, type EcPrice } from './sources/ec-price.ts';
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

/**
 * Casa cada jogo JP com no máximo um BR pela chave, só quando o par é único dos dois lados.
 * Chaves com mais de um candidato (ex.: duas edições com o mesmo nome) ficam de fora.
 */
function uniquePairs<J, B>(jp: J[], br: B[], jpKeys: (j: J) => string[], brKeys: (b: B) => string[]): [J, B][] {
  const brByKey = new Map<string, B[]>();
  for (const b of br) for (const k of brKeys(b)) brByKey.set(k, [...(brByKey.get(k) ?? []), b]);
  const proposals: [J, B][] = [];
  for (const j of jp) {
    const cands = new Set(jpKeys(j).flatMap((k) => brByKey.get(k) ?? []));
    if (cands.size === 1) proposals.push([j, [...cands][0]]);
  }
  const uses = new Map<B, number>();
  for (const [, b] of proposals) uses.set(b, (uses.get(b) ?? 0) + 1);
  return proposals.filter(([, b]) => uses.get(b) === 1);
}

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
  log('titledb US (data de lançamento)...');
  const usReleaseDates = new Map<string, string>();
  for (const g of (await loadTitleDb('US.en.json')).values()) if (g.releaseDate) usReleaseDates.set(g.nsuid, g.releaseDate);
  log(`  ${usReleaseDates.size} datas`);

  log('Catálogo + preços JP (search.nintendo.jp)...');
  const jp = await fetchJpCatalog();
  log(`  ${jp.games.length} de ${jp.total} jogos à venda`);

  log('Catálogo BR (busca do nintendo.com)...');
  const store = await fetchBrStore();
  log(`  ${store.games.length} jogos${store.truncated ? ` (${store.truncated} fatias passaram de 1000 e vieram incompletas)` : ''}`);

  // Catálogo BR = titledb ∪ nintendo.com. O nsuid é o mesmo nos dois; só o titledb traz o Title ID.
  const storeByNsuid = new Map(store.games.map((g) => [g.nsuid, g]));
  const brNsuids = [...new Set([...tdbBr.keys(), ...storeByNsuid.keys()])];

  log(`Preços BR (api.ec.nintendo.com, ${Math.ceil(brNsuids.length / 50)} lotes)...`);
  const br = await fetchEcPrices('BR', 'pt', brNsuids);
  const brOk = br.failedBatches === 0;
  const brPriceByNsuid = new Map<string, EcPrice>(br.prices.map((p) => [p.nsuid, p]));
  // Lotes que falharam: fica o preço que a busca do nintendo.com mostra.
  let fallback = 0;
  for (const nsuid of br.failedNsuids) {
    const p = storeByNsuid.get(nsuid)?.price;
    if (p) {
      brPriceByNsuid.set(nsuid, { nsuid, status: 'onsale', ...p });
      fallback++;
    }
  }
  if (br.failedBatches) {
    const why = br.failedBatches === br.batches ? 'API de preços inacessível' : `${br.failedBatches} lotes falharam`;
    console.warn(`  !! ${why} (${br.firstError}). ${fallback} preços vieram da busca do nintendo.com.`);
  }
  log(`  ${brPriceByNsuid.size} preços`);

  // --- Jogos do Brasil ---
  const games = new Map<string, GameRow>();
  const brPrices: PriceRow[] = [];
  const jpPrices: PriceRow[] = [];

  const brIdByNsuid = new Map<string, string>();
  for (const nsuid of brNsuids) {
    const t = tdbBr.get(nsuid);
    const s = storeByNsuid.get(nsuid);
    const id = t?.titleId ?? `br-${nsuid}`;
    if (games.has(id)) continue; // mesma Title ID em dois nsuids (raro): fica o primeiro
    brIdByNsuid.set(nsuid, id);
    games.set(id, {
      id,
      name: (s?.name ?? t?.name) as string,
      nameJp: null,
      publisher: s?.publisher ?? t?.publisher ?? null,
      platform: s?.platform ?? (t?.titleId ? platformOf(t.titleId) : 'switch'),
      // No catálogo BR (titledb e nintendo.com/pt-br) a data de jogos antigos é a de entrada na
      // eShop brasileira, aberta no fim de 2020. A dos EUA (mesmo nsuid) é a de lançamento.
      releaseDate: usReleaseDates.get(nsuid) ?? s?.releaseDate ?? t?.releaseDate ?? null,
      image: t?.image ?? s?.image ?? null,
      nsuidBr: nsuid,
      nsuidJp: null,
    });
  }
  for (const [nsuid, id] of brIdByNsuid) {
    const p = brPriceByNsuid.get(nsuid);
    if (p) brPrices.push({ gameId: id, region: 'BR', ...p });
  }

  // --- Casa os jogos do Japão com os do Brasil ---
  // Mesmo Title ID em mais de um produto JP (ex.: jogo base e "Nintendo Switch 2 Edition"):
  // vence o da plataforma do Title ID e, entre esses, o mais barato (o primeiro da lista ganha).
  const rank = (g: JpGame) => {
    const titleId = tdbJp.get(g.nsuid)?.titleId;
    return titleId && platformOf(titleId) === g.platform ? 0 : 1;
  };
  const jpGames = [...jp.games].sort((a, b) => rank(a) - rank(b) || a.current - b.current);

  const jpIdByNsuid = new Map<string, string>();
  const isFreeBr = (id: string | null | undefined): id is string => {
    const g = id ? games.get(id) : undefined;
    return !!g && g.nsuidBr != null && g.nsuidJp == null;
  };
  const attach = (g: JpGame, id: string) => {
    const e = games.get(id) as GameRow;
    e.nameJp = g.name;
    e.nsuidJp = g.nsuid;
    e.platform = g.platform;
    // Ícone quadrado do titledb; a imagem da busca JP é um retrato 1080x1920.
    e.image ??= tdbJp.get(g.nsuid)?.image ?? g.image;
    e.releaseDate ??= g.releaseDate;
    jpIdByNsuid.set(g.nsuid, id);
  };
  const unmatched = () => jpGames.filter((g) => !jpIdByNsuid.has(g.nsuid));

  // 1) Title ID
  for (const g of jpGames) {
    const titleId = tdbJp.get(g.nsuid)?.titleId;
    if (isFreeBr(titleId)) attach(g, titleId);
  }
  const byTitleId = jpIdByNsuid.size;

  // 2) Apelidos mantidos à mão (Title ID diferente + nome em japonês)
  const aliasBr = new Map(ALIASES.map(([jpNsuid, brNsuid]) => [jpNsuid, brNsuid]));
  for (const g of unmatched()) {
    const id = brIdByNsuid.get(aliasBr.get(g.nsuid) ?? '');
    if (isFreeBr(id)) attach(g, id);
  }
  const byAlias = jpIdByNsuid.size - byTitleId;

  const freeBr = () => [...games.values()].filter((g) => isFreeBr(g.id));
  const notSame = new Set(NOT_SAME.map(([jpNsuid, brNsuid]) => `${jpNsuid}|${brNsuid}`));
  const allowed = (g: JpGame, b: GameRow) => !notSame.has(`${g.nsuid}|${b.nsuidBr}`);

  // 3) Mesmo nome e plataforma (lançamentos que o titledb ainda não tem, ex.: FINAL FANTASY VII REBIRTH)
  const keys = (k: string | null) => (k ? [k] : []);
  for (const [g, b] of uniquePairs(unmatched(), freeBr(), (g) => keys(nameKey(g.name, g.platform)), (b) =>
    keys(nameKey(b.name, b.platform)),
  )) {
    if (allowed(g, b)) attach(g, b.id);
  }
  const byName = jpIdByNsuid.size - byTitleId - byAlias;

  // 4) Mesma editora japonesa grande, plataforma e data de lançamento (nome em japonês no JP,
  //    ex.: ドンキーコング バナンザ = Donkey Kong Bananza)
  for (const [g, b] of uniquePairs(
    unmatched(),
    freeBr(),
    (g) => {
      const group = jpPublisherGroup(g.publisher);
      return group ? releaseKeys(group, g.platform, g.releaseDate) : [];
    },
    (b) => {
      const group = brPublisherGroup(b.publisher);
      return group ? releaseKeys(group, b.platform, b.releaseDate, 0) : [];
    },
  )) {
    if (allowed(g, b) && sharesLatinWords(g.name, b.name)) attach(g, b.id);
  }
  const byRelease = jpIdByNsuid.size - byTitleId - byAlias - byName;
  log(
    `Casados JP <-> BR: ${byTitleId} por Title ID, ${byAlias} por apelido, ${byName} por nome, ${byRelease} por editora + lançamento`,
  );

  // 5) O resto só existe no Japão
  for (const g of unmatched()) {
    const tdb = tdbJp.get(g.nsuid);
    const id = tdb?.titleId ?? `jp-${g.nsuid}`;
    if (games.has(id)) continue; // outra edição do mesmo Title ID já ficou com a vaga
    games.set(id, {
      id,
      name: g.name,
      nameJp: g.name,
      publisher: g.publisher,
      platform: g.platform,
      releaseDate: g.releaseDate,
      image: tdb?.image ?? g.image,
      nsuidBr: null,
      nsuidJp: g.nsuid,
    });
    jpIdByNsuid.set(g.nsuid, id);
  }

  for (const g of jpGames) {
    const id = jpIdByNsuid.get(g.nsuid);
    if (!id) continue;
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

  const { brChanged, jpChanged } = transaction(db, () => {
    saveGames(db, games.values(), now);
    const brChanged = brPrices.length ? savePrices(db, 'BR', brPrices, now, brOk) : 0;
    const jpChanged = savePrices(db, 'JP', jpPrices, now, true);
    setMeta(db, 'fx_jpy_brl', String(fx.rate));
    setMeta(db, 'fx_source', fx.source);
    setMeta(db, 'fx_at', fx.at);
    setMeta(db, 'crawled_at', now);
    if (brPrices.length) setMeta(db, 'br_crawled_at', now);
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
