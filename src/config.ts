import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  dataDir: path.join(root, 'data'),
  dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'eshop.db'),
  port: num('PORT', 3000),
  // % somado ao preço japonês convertido: IOF do cartão, ágio do gift card etc.
  jpExtraFeePct: num('JP_TAXA_EXTRA', 0),
  priceConcurrency: num('PRICE_CONCURRENCY', 2),
  userAgent: 'eshop-jp-br/0.1 (comparador pessoal de precos)',
};
