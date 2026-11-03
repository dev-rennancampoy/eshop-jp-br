// API pública de preços do eShop (a mesma que o console e o eshop-prices usam).
// Aceita até 50 nsuids por chamada.
import { config } from '../config.ts';
import { describeError, fetchJson, mapLimit } from '../http.ts';

const BASE = 'https://api.ec.nintendo.com/v1/price';
const BATCH = 50;

type EcAmount = {
  amount: string;
  currency: string;
  raw_value?: string;
  start_datetime?: string;
  end_datetime?: string;
};

type EcTitle = {
  title_id: number | string;
  sales_status: string;
  regular_price?: EcAmount;
  discount_price?: EcAmount;
};

type EcResponse = { prices?: EcTitle[] };

export type EcPrice = {
  nsuid: string;
  currency: string;
  regular: number;
  current: number;
  saleStart: string | null;
  saleEnd: string | null;
  status: string;
};

function parseAmount(a: EcAmount): number {
  const raw = Number(a.raw_value);
  if (Number.isFinite(raw)) return raw;
  // fallback: "R$ 1.299,90" -> 1299.90
  const digits = a.amount.replace(/[^\d,.-]/g, '');
  return Number(digits.includes(',') ? digits.replace(/\./g, '').replace(',', '.') : digits);
}

function isoOrNull(s: string | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toPrice(t: EcTitle): EcPrice | null {
  if (!t.regular_price || t.sales_status === 'not_found' || t.sales_status === 'sales_termination') return null;
  const regular = parseAmount(t.regular_price);
  const discount = t.discount_price ? parseAmount(t.discount_price) : null;
  const onSale = discount != null && discount < regular;
  return {
    nsuid: String(t.title_id),
    currency: t.regular_price.currency,
    regular,
    current: onSale ? discount : regular,
    saleStart: onSale ? isoOrNull(t.discount_price?.start_datetime) : null,
    saleEnd: onSale ? isoOrNull(t.discount_price?.end_datetime) : null,
    status: t.sales_status,
  };
}

export async function fetchEcPrices(
  country: string,
  lang: string,
  nsuids: string[],
): Promise<{ prices: EcPrice[]; failedBatches: number; batches: number; firstError: string | null }> {
  const batches: string[][] = [];
  for (let i = 0; i < nsuids.length; i += BATCH) batches.push(nsuids.slice(i, i + BATCH));

  let ok = 0;
  let failedBatches = 0;
  let firstError: string | null = null;
  const results = await mapLimit(batches, config.priceConcurrency, async (ids) => {
    // Várias falhas sem nenhum sucesso = API inacessível (bloqueio de rede etc.): não insiste no resto.
    if (ok === 0 && failedBatches >= 5) {
      failedBatches++;
      return [];
    }
    const qs = new URLSearchParams({ country, lang, ids: ids.join(',') });
    try {
      const res = await fetchJson<EcResponse>(`${BASE}?${qs}`);
      ok++;
      return (res.prices ?? []).map(toPrice).filter((p): p is EcPrice => p !== null);
    } catch (err) {
      failedBatches++;
      firstError ??= describeError(err);
      return [];
    }
  });

  return { prices: results.flat(), failedBatches, batches: batches.length, firstError };
}
