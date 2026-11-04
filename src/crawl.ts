// Coleta catálogo + preços do eShop JP e BR e grava no SQLite.
//   npm run crawl
import type { DatabaseSync } from 'node:sqlite';
import { getMeta, openDb, setMeta, transaction, type Region } from './db.ts';
import { ALIASES, NOT_SAME } from './aliases.ts';
import { describeError } from './http.ts';
import { brPublisherGroup, jpPublisherGroup, nameKey, releaseKeys, sharesLatinWords } from './matching.ts';
import { AmazonBlocked, searchAmazonDigital } from './sources/amazon-jp.ts';
import { fetchBrStore } from './sources/br-store.ts';
import { METACRITIC_DELAY_MS, MetacriticBlocked, fetchMetacritic } from './sources/metacritic.ts';
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
  popularity: number | null;
  trending: number | null;
  bundle: boolean; // pacote (coleção, edição deluxe) e não jogo avulso
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
  ref?: string | null; // ASIN na Amazon
};

/** Title IDs de Switch 2 começam com 04; os de Switch 1, com 01. */
const platformOf = (titleId: string) => (titleId.startsWith('04') ? 'switch2' : 'switch');

/**
 * Vários produtos podem ter o mesmo Title ID: o jogo base, o "Friend's Pass" gratuito, a
 * "Nintendo Switch 2 Edition". Ordem de preferência (o primeiro fica com a vaga): plataforma do
 * Title ID, depois pago antes de gratuito, depois o menor preço cheio.
 */
function baseFirst(titleId: string | null | undefined, platform: string, regular: number | null | undefined): number[] {
  return [
    titleId && platformOf(titleId) === platform ? 0 : 1,
    regular != null && regular > 0 ? 0 : 1,
    regular ?? Number.MAX_SAFE_INTEGER,
  ];
}

const compareTuples = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Id do jogo no site. A "Nintendo Switch 2 Edition" tem o mesmo Title ID do jogo de Switch 1
 * (é o mesmo app), mas é outro produto com outro preço: vira um jogo à parte, "<Title ID>-S2".
 */
function productId(titleId: string, platform: string): string {
  return platform === 'switch2' && platformOf(titleId) === 'switch' ? `${titleId}-S2` : titleId;
}

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
    insert into game (id, name, name_jp, publisher, platform, release_date, image, nsuid_br, nsuid_jp, popularity, trending, bundle, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name, name_jp = excluded.name_jp, publisher = excluded.publisher,
      platform = excluded.platform, release_date = excluded.release_date, image = excluded.image,
      nsuid_br = excluded.nsuid_br, nsuid_jp = excluded.nsuid_jp, popularity = excluded.popularity,
      trending = excluded.trending, bundle = excluded.bundle, updated_at = excluded.updated_at`);
  for (const g of games) {
    stmt.run(
      g.id, g.name, g.nameJp, g.publisher, g.platform, g.releaseDate, g.image, g.nsuidBr, g.nsuidJp, g.popularity, g.trending,
      g.bundle ? 1 : 0, now,
    );
  }
}

/** Grava os preços da região, registra histórico quando muda e remove o que saiu da loja. */
function savePrices(db: DatabaseSync, region: Region, prices: PriceRow[], now: string, removeMissing: boolean): number {
  const prev = db.prepare('select regular, current from price where game_id = ? and region = ?');
  const upsert = db.prepare(`
    insert into price (game_id, region, currency, regular, current, sale_start, sale_end, status, ref, fetched_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(game_id, region) do update set
      currency = excluded.currency, regular = excluded.regular, current = excluded.current,
      sale_start = excluded.sale_start, sale_end = excluded.sale_end, status = excluded.status,
      ref = excluded.ref, fetched_at = excluded.fetched_at`);
  const history = db.prepare('insert into price_history (game_id, region, regular, current, seen_at) values (?, ?, ?, ?, ?)');

  let changed = 0;
  for (const p of prices) {
    const old = prev.get(p.gameId, region) as { regular: number; current: number } | undefined;
    if (!old || old.regular !== p.regular || old.current !== p.current) {
      history.run(p.gameId, region, p.regular, p.current, now);
      changed++;
    }
    upsert.run(p.gameId, region, p.currency, p.regular, p.current, p.saleStart, p.saleEnd, p.status, p.ref ?? null, now);
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
  const usNames = new Map<string, string>(); // nome em inglês, para achar o jogo no Metacritic
  for (const g of (await loadTitleDb('US.en.json')).values()) {
    if (g.releaseDate) usReleaseDates.set(g.nsuid, g.releaseDate);
    usNames.set(g.nsuid, g.name);
  }
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

  const brPlatform = (nsuid: string) => {
    const titleId = tdbBr.get(nsuid)?.titleId;
    return storeByNsuid.get(nsuid)?.platform ?? (titleId ? platformOf(titleId) : 'switch');
  };
  const brOrder = (nsuid: string) =>
    baseFirst(tdbBr.get(nsuid)?.titleId, brPlatform(nsuid), brPriceByNsuid.get(nsuid)?.regular);
  const brIdByNsuid = new Map<string, string>();
  for (const nsuid of [...brNsuids].sort((a, b) => compareTuples(brOrder(a), brOrder(b)))) {
    const t = tdbBr.get(nsuid);
    const s = storeByNsuid.get(nsuid);
    const id = t?.titleId ? productId(t.titleId, brPlatform(nsuid)) : `br-${nsuid}`;
    if (games.has(id)) continue; // outro produto com o mesmo Title ID já ficou com a vaga (ver baseFirst)
    brIdByNsuid.set(nsuid, id);
    games.set(id, {
      id,
      name: (s?.name ?? t?.name) as string,
      nameJp: null,
      publisher: s?.publisher ?? t?.publisher ?? null,
      platform: brPlatform(nsuid),
      // No catálogo BR (titledb e nintendo.com/pt-br) a data de jogos antigos é a de entrada na
      // eShop brasileira, aberta no fim de 2020. A dos EUA (mesmo nsuid) é a de lançamento.
      releaseDate: usReleaseDates.get(nsuid) ?? s?.releaseDate ?? t?.releaseDate ?? null,
      image: t?.image ?? s?.image ?? null,
      nsuidBr: nsuid,
      nsuidJp: null,
      popularity: s?.popularity ?? null,
      trending: s?.trending ?? null,
      bundle: s?.bundle ?? false,
    });
  }
  for (const [nsuid, id] of brIdByNsuid) {
    const p = brPriceByNsuid.get(nsuid);
    if (p) brPrices.push({ gameId: id, region: 'BR', ...p });
  }

  // --- Casa os jogos do Japão com os do Brasil ---
  const jpOrder = (g: JpGame) => baseFirst(tdbJp.get(g.nsuid)?.titleId, g.platform, g.regular);
  const jpGames = [...jp.games].sort((a, b) => compareTuples(jpOrder(a), jpOrder(b)));

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
    const id = titleId ? productId(titleId, g.platform) : null;
    if (isFreeBr(id)) attach(g, id);
  }
  const byTitleId = jpIdByNsuid.size;

  // 2) Apelidos mantidos à mão (Title ID diferente + nome em japonês)
  const aliasBr = new Map(ALIASES.map(([jpNsuid, brNsuid]) => [jpNsuid, brNsuid]));
  for (const g of unmatched()) {
    const id = brIdByNsuid.get(aliasBr.get(g.nsuid) ?? '');
    if (isFreeBr(id)) attach(g, id);
  }
  const byAlias = jpIdByNsuid.size - byTitleId;

  // Nas regras aproximadas (nome, editora + data), só entram jogos com preço no Brasil: um app
  // sem preço (art book, trilha sonora) da mesma editora e data deixaria o par ambíguo.
  const brPriced = new Set(brPrices.map((p) => p.gameId));
  const freeBr = () => [...games.values()].filter((g) => isFreeBr(g.id) && brPriced.has(g.id));
  const notSame = new Set(NOT_SAME.map(([jpNsuid, brNsuid]) => `${jpNsuid}|${brNsuid}`));
  const allowed = (g: JpGame, b: GameRow) => !notSame.has(`${g.nsuid}|${b.nsuidBr}`);

  // 3) Mesmo nome e plataforma (lançamentos que o titledb ainda não tem, ex.: FINAL FANTASY VII REBIRTH,
  //    e pacotes como KINGDOM HEARTS Collection). Pacote só casa com pacote.
  const keys = (k: string | null, bundle: boolean) => (k ? [bundle ? `${k}|pacote` : k] : []);
  for (const [g, b] of uniquePairs(
    unmatched(),
    freeBr(),
    (g) => keys(nameKey(g.name, g.platform), g.bundle),
    (b) => keys(nameKey(b.name, b.platform), b.bundle),
  )) {
    if (allowed(g, b)) attach(g, b.id);
  }
  const byName = jpIdByNsuid.size - byTitleId - byAlias;

  // 4) Mesma editora japonesa grande, plataforma e data de lançamento (nome em japonês no JP,
  //    ex.: ドンキーコング バナンザ = Donkey Kong Bananza)
  for (const [g, b] of uniquePairs(
    unmatched(),
    freeBr(),
    // Pacotes ficam de fora: a edição deluxe e o pacote de DLC saem no mesmo dia, da mesma editora.
    (g) => {
      const group = g.bundle ? null : jpPublisherGroup(g.publisher);
      return group ? releaseKeys(group, g.platform, g.releaseDate) : [];
    },
    (b) => {
      const group = b.bundle ? null : brPublisherGroup(b.publisher);
      return group ? releaseKeys(group, b.platform, b.releaseDate, 0) : [];
    },
  )) {
    if (allowed(g, b) && sharesLatinWords(g.name, b.name)) attach(g, b.id);
  }
  const byRelease = jpIdByNsuid.size - byTitleId - byAlias - byName;
  log(
    `Casados JP <-> BR: ${byTitleId} por Title ID, ${byAlias} por apelido, ${byName} por nome, ${byRelease} por editora + lançamento`,
  );

  // 5) O resto só existe no Japão. Pacote japonês sem par no Brasil fica de fora: a busca do
  //    Japão não diz se ele tem jogo ou só DLC.
  for (const g of unmatched()) {
    if (g.bundle) continue;
    const tdb = tdbJp.get(g.nsuid);
    const id = tdb?.titleId ? productId(tdb.titleId, g.platform) : `jp-${g.nsuid}`;
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
      popularity: null,
      trending: null,
      bundle: false,
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

  await crawlMetacritic(db, games, usNames);
  await crawlAmazon(db, games);
  db.close();
}

const MC_BUDGET = Number(process.env.METACRITIC_BUDGET ?? 250); // jogos por execução; 0 desliga
const MC_REFRESH_DAYS = 14;
const MC_REFRESH_NEW_DAYS = 3; // lançamentos dos últimos 60 dias recebem notas novas mais rápido

/**
 * Notas do Metacritic dos jogos à venda no Brasil, dos mais populares para os menos. Cada execução
 * busca só um lote (os que nunca foram buscados ou estão vencidos); o resto fica guardado no banco.
 */
async function crawlMetacritic(db: DatabaseSync, games: Map<string, GameRow>, usNames: Map<string, string>): Promise<void> {
  if (MC_BUDGET <= 0) return;
  const checked = new Map(
    (db.prepare('select game_id, checked_at from metacritic').all() as { game_id: string; checked_at: string }[]).map((r) => [
      r.game_id,
      Date.parse(r.checked_at),
    ]),
  );
  const now = Date.now();
  const due = (g: GameRow) => {
    const last = checked.get(g.id);
    if (last == null) return true;
    const isNew = g.releaseDate != null && now - Date.parse(g.releaseDate) < 60 * 86_400_000;
    return now - last > (isNew ? MC_REFRESH_NEW_DAYS : MC_REFRESH_DAYS) * 86_400_000;
  };
  const queue = [...games.values()]
    .filter((g) => g.nsuidBr && !g.bundle && g.popularity != null && due(g))
    .sort((a, b) => (a.popularity as number) - (b.popularity as number))
    .slice(0, MC_BUDGET);
  if (!queue.length) return;
  log(`Metacritic (${queue.length} jogos, dos mais populares)...`);

  const upsert = db.prepare(`
    insert into metacritic (game_id, slug, critic, critic_reviews, user_score, user_reviews, from_base, checked_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(game_id) do update set slug = excluded.slug, critic = excluded.critic,
      critic_reviews = excluded.critic_reviews, user_score = excluded.user_score,
      user_reviews = excluded.user_reviews, from_base = excluded.from_base, checked_at = excluded.checked_at`);
  let found = 0;
  for (const [i, g] of queue.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, METACRITIC_DELAY_MS));
    const name = usNames.get(g.nsuidBr as string) ?? g.name;
    try {
      const mc = await fetchMetacritic(name, g.platform === 'switch2' ? 'switch2' : 'switch', g.id.endsWith('-S2'));
      if (mc && (mc.critic != null || mc.user != null)) found++;
      upsert.run(
        g.id, mc?.slug ?? null, mc?.critic ?? null, mc?.criticReviews ?? null, mc?.user ?? null, mc?.userReviews ?? null,
        mc?.fromBase ? 1 : 0, new Date().toISOString(),
      );
    } catch (err) {
      const blocked = err instanceof MetacriticBlocked;
      console.warn(`  !! Metacritic ${blocked ? 'recusou, parando' : 'falhou'} em "${name}": ${describeError(err)}`);
      if (blocked) break;
    }
  }
  const total = (db.prepare('select count(*) as n from metacritic where critic is not null or user_score is not null').get() as { n: number }).n;
  log(`  ${found} de ${queue.length} com nota. Total no banco: ${total} jogos com nota.`);
}

const AMAZON_TOP = Number(process.env.AMAZON_TOP ?? 70); // 0 desliga a etapa da Amazon
const AMAZON_EVERY_HOURS = 20; // uma vez por dia (o workflow roda a cada 6 h)
const AMAZON_DELAY_MS = 3000;

/** Versão digital na Amazon JP dos jogos mais populares que existem no eShop JP. */
async function crawlAmazon(db: DatabaseSync, games: Map<string, GameRow>): Promise<void> {
  if (AMAZON_TOP <= 0) return;
  const last = Date.parse(getMeta(db, 'amazon_crawled_at') ?? '');
  if (!process.env.AMAZON_FORCE && Date.now() - last < AMAZON_EVERY_HOURS * 3_600_000) {
    log('Amazon JP: coletada há menos de 20 h, pulando.');
    return;
  }
  const top = [...games.values()]
    .filter((g) => g.nameJp && g.nsuidJp && g.popularity != null)
    .sort((a, b) => (a.popularity as number) - (b.popularity as number))
    .slice(0, AMAZON_TOP);
  log(`Amazon JP (versão digital dos ${top.length} jogos mais populares)...`);

  const now = new Date().toISOString();
  const prices: PriceRow[] = [];
  let complete = true;
  for (const [i, g] of top.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, AMAZON_DELAY_MS));
    try {
      const offer = await searchAmazonDigital(g.nameJp as string);
      if (offer) {
        prices.push({
          gameId: g.id,
          region: 'AMZ',
          currency: 'JPY',
          regular: offer.price,
          current: offer.price,
          saleStart: null,
          saleEnd: null,
          status: 'onsale',
          ref: offer.asin,
        });
      }
    } catch (err) {
      // Bloqueio: para tudo e mantém os preços anteriores. Sem insistir nem tentar contornar.
      complete = false;
      const blocked = err instanceof AmazonBlocked;
      console.warn(`  !! Amazon JP ${blocked ? 'bloqueou, parando' : 'falhou'} no jogo ${i + 1}/${top.length}: ${describeError(err)}`);
      if (blocked) break;
    }
  }

  const changed = transaction(db, () => {
    const n = savePrices(db, 'AMZ', prices, now, complete);
    if (complete) setMeta(db, 'amazon_crawled_at', now);
    return n;
  });
  log(`  ${prices.length} de ${top.length} com versão digital na Amazon. Mudanças de preço: ${changed}.`);
}

main().catch((err) => {
  console.error(`Crawl falhou: ${describeError(err)}`);
  process.exitCode = 1;
});
