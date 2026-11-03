import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

export type Region = 'BR' | 'JP';

const SCHEMA = `
create table if not exists game (
  id           text primary key,  -- Title ID (ex.: 0100152000022000) ou jp-<nsuid> / br-<nsuid> sem par
  name         text not null,     -- nome no eShop BR quando existe, senão o japonês
  name_jp      text,
  publisher    text,
  platform     text,              -- switch | switch2
  release_date text,
  image        text,
  nsuid_br     text,
  nsuid_jp     text,
  updated_at   text not null
);

create table if not exists price (
  game_id    text not null references game(id),
  region     text not null,       -- BR | JP
  currency   text not null,       -- BRL | JPY (valor na moeda local, sem conversão)
  regular    real not null,
  current    real not null,
  sale_start text,
  sale_end   text,
  status     text,
  fetched_at text not null,
  primary key (game_id, region)
);

-- Uma linha por mudança de preço (não por crawl)
create table if not exists price_history (
  game_id text not null,
  region  text not null,
  regular real not null,
  current real not null,
  seen_at text not null
);
create index if not exists price_history_game on price_history(game_id, region, seen_at);

create table if not exists meta (
  key   text primary key,
  value text not null
);
`;

export function openDb(): DatabaseSync {
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  return db;
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('select value from meta where key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, value);
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('begin');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (err) {
    db.exec('rollback');
    throw err;
  }
}
