// Catálogo por região do projeto blawar/titledb. Usado para:
//  - listar os jogos do eShop brasileiro (nsuid, nome em pt, imagens)
//  - descobrir o Title ID de cada nsuid, que é o que liga o mesmo jogo entre JP e BR
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { config } from '../config.ts';
import { fetchWithRetry } from '../http.ts';

const BASE = 'https://raw.githubusercontent.com/blawar/titledb/master';

export type TitleDbFile = 'BR.pt.json' | 'JP.ja.json' | 'US.en.json';

export type TitleDbGame = {
  nsuid: string;
  titleId: string | null;
  name: string;
  publisher: string | null;
  releaseDate: string | null;
  image: string | null;
};

type RawEntry = {
  nsuId?: number | string;
  id?: string | null;
  name?: string | null;
  publisher?: string | null;
  releaseDate?: number | null;
  iconUrl?: string | null;
  isDemo?: boolean;
};

/** Baixa o arquivo só se mudou (ETag) e devolve o caminho local. */
async function download(file: TitleDbFile): Promise<string> {
  const dir = path.join(config.dataDir, 'titledb');
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, file);
  const etagFile = `${dest}.etag`;
  const etag = await readFile(etagFile, 'utf8').catch(() => null);

  const res = await fetchWithRetry(`${BASE}/${file}`, { headers: etag ? { 'if-none-match': etag } : {} });
  if (res.status === 304) return dest;

  const tmp = `${dest}.tmp`;
  await pipeline(Readable.fromWeb(res.body as ReadableStream), createWriteStream(tmp));
  await rename(tmp, dest);
  const newEtag = res.headers.get('etag');
  if (newEtag) await writeFile(etagFile, newEtag);
  return dest;
}

function formatDate(yyyymmdd: number | null | undefined): string | null {
  const s = String(yyyymmdd ?? '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

/** Jogos base (nsuid 7001…, sem demos), indexados por nsuid. */
export async function loadTitleDb(file: TitleDbFile): Promise<Map<string, TitleDbGame>> {
  const raw = JSON.parse(await readFile(await download(file), 'utf8')) as Record<string, RawEntry>;
  const games = new Map<string, TitleDbGame>();
  for (const e of Object.values(raw)) {
    const nsuid = String(e.nsuId ?? '');
    if (!nsuid.startsWith('7001') || e.isDemo || !e.name) continue;
    games.set(nsuid, {
      nsuid,
      titleId: e.id ? e.id.toUpperCase() : null,
      name: e.name.trim(),
      publisher: e.publisher ?? null,
      releaseDate: formatDate(e.releaseDate),
      image: e.iconUrl ?? null,
    });
  }
  return games;
}
