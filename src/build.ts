// Gera o site estático em dist/ a partir do SQLite:
//   data.json  jogos + preços atuais (o que a home e a página do jogo usam)
//   h/xx.json  histórico de preços, dividido em pedaços
//   app.js...  o front (src/web/*.ts sem os tipos)
//   npm run build
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { getMeta, openDb } from './db.ts';
import { historyShard, type DataFile, type GameRec, type HistoryShard, type Platform, type PriceTuple, type Region } from './web/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'src', 'web');
const outDir = path.join(root, 'dist');

type Row = {
  id: string;
  name: string;
  name_jp: string | null;
  publisher: string | null;
  platform: string | null;
  release_date: string | null;
  image: string | null;
  nsuid_br: string | null;
  nsuid_jp: string | null;
  popularity: number | null;
  trending: number | null;
  br_reg: number | null;
  br_cur: number | null;
  br_end: string | null;
  jp_reg: number | null;
  jp_cur: number | null;
  jp_end: string | null;
};

const tuple = (reg: number | null, cur: number | null, end: string | null): PriceTuple | undefined =>
  reg == null || cur == null ? undefined : [reg, cur, end];

function toRec(r: Row): GameRec {
  const rec: GameRec = {
    id: r.id,
    name: r.name,
    nameJp: r.name_jp ?? undefined,
    publisher: r.publisher ?? undefined,
    img: r.image ?? undefined,
    platform: (r.platform as Platform) ?? 'switch',
    release: r.release_date ?? undefined,
    nsuidBr: r.nsuid_br ?? undefined,
    nsuidJp: r.nsuid_jp ?? undefined,
    br: tuple(r.br_reg, r.br_cur, r.br_end),
    jp: tuple(r.jp_reg, r.jp_cur, r.jp_end),
  };
  // JSON.stringify já descarta undefined; o nome JP só vale quando difere do principal.
  if (rec.nameJp === rec.name) rec.nameJp = undefined;
  return rec;
}

async function buildWeb(): Promise<void> {
  for (const f of await readdir(webDir)) {
    const src = path.join(webDir, f);
    if (f.endsWith('.ts')) {
      const js = stripTypeScriptTypes(await readFile(src, 'utf8'), { mode: 'strip' }).replace(
        /(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g,
        '$1.js$2',
      );
      await writeFile(path.join(outDir, f.replace(/\.ts$/, '.js')), js);
    } else {
      await copyFile(src, path.join(outDir, f));
    }
  }
  await writeFile(path.join(outDir, '.nojekyll'), '');
}

async function main(): Promise<void> {
  const db = openDb();
  const rate = Number(getMeta(db, 'fx_jpy_brl'));
  if (!(rate > 0)) throw new Error('Banco sem dados. Rode `npm run crawl` antes do build.');

  const rows = db
    .prepare(
      `select g.*,
              br.regular as br_reg, br.current as br_cur, br.sale_end as br_end,
              jp.regular as jp_reg, jp.current as jp_cur, jp.sale_end as jp_end
       from game g
       left join price br on br.game_id = g.id and br.region = 'BR'
       left join price jp on jp.game_id = g.id and jp.region = 'JP'
       where br.game_id is not null or jp.game_id is not null`,
    )
    .all() as Row[];

  // O ranking do nintendo.com mistura DLCs e pacotes; aqui vira 1..N só entre os jogos do site.
  const denseRank = (key: 'popularity' | 'trending') =>
    new Map(
      rows
        .filter((r) => r[key] != null)
        .sort((a, b) => (a[key] as number) - (b[key] as number))
        .map((r, i) => [r.id, i + 1]),
    );
  const popRank = denseRank('popularity');
  const trendRank = denseRank('trending');

  const data: DataFile = {
    generatedAt: new Date().toISOString(),
    crawledAt: getMeta(db, 'crawled_at'),
    brCrawledAt: getMeta(db, 'br_crawled_at'),
    fx: { rate, source: getMeta(db, 'fx_source'), at: getMeta(db, 'fx_at') },
    defaultFeePct: config.jpExtraFeePct,
    games: rows.map((r) => ({ ...toRec(r), pop: popRank.get(r.id), trend: trendRank.get(r.id) })),
  };

  const ids = new Set(rows.map((r) => r.id));
  const shards = new Map<string, HistoryShard>();
  const history = db
    .prepare('select game_id, region, regular, current, seen_at from price_history order by seen_at desc')
    .all() as { game_id: string; region: Region; regular: number; current: number; seen_at: string }[];
  for (const h of history) {
    if (!ids.has(h.game_id)) continue;
    const key = historyShard(h.game_id);
    const shard = shards.get(key) ?? {};
    (shard[h.game_id] ??= []).push([h.region, h.regular, h.current, h.seen_at]);
    shards.set(key, shard);
  }
  db.close();

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'h'), { recursive: true });
  await writeFile(path.join(outDir, 'data.json'), JSON.stringify(data));
  for (const [key, shard] of shards) await writeFile(path.join(outDir, 'h', `${key}.json`), JSON.stringify(shard));
  await buildWeb();

  const size = (await stat(path.join(outDir, 'data.json'))).size;
  console.log(`dist/ gerado: ${data.games.length} jogos, data.json ${(size / 1024 / 1024).toFixed(1)} MB, ${shards.size} arquivos de histórico.`);
}

main().catch((err) => {
  console.error(`Build falhou: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
