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
  // Custo de pagar o preço em iene com dinheiro brasileiro, em % sobre o câmbio comercial.
  jpFees: {
    // IOF de compras internacionais (cartão de crédito, débito, pré-pago e conta global): 3,5% desde
    // jul/2025 (Decreto 12.499/2025), sem cronograma de redução.
    iofPct: num('JP_IOF', 3.5),
    // Spread do cartão de crédito comum: Nubank 4%, Inter ~5%, C6 5,25%, Itaú ~5,5%.
    cardSpreadPct: num('JP_SPREAD_CARTAO', 4),
    // Tarifa de conversão da Wise (~0,6–0,8% sobre o câmbio comercial).
    wiseSpreadPct: num('JP_SPREAD_WISE', 0.7),
  },
  priceConcurrency: num('PRICE_CONCURRENCY', 2),
  userAgent: 'eshop-jp-br/0.1 (comparador pessoal de precos)',
};
