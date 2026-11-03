// API pública de preços do eShop (a mesma que o console e o eshop-prices usam).
// Aceita até 50 nsuids por chamada.
import { config } from '../config.ts';
import { describeError, fetchJson, mapLimit } from '../http.ts';

const BASE = 'https://api.ec.nintendo.com/v1/price';
const BATCH = 50;
const DELAY_MS = 400; // pausa de cada worker entre chamadas
const PASSES = 3; // 1ª passada + até 2 repescagens dos lotes que falharam
const COOLDOWN_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
): Promise<{
  prices: EcPrice[];
  failedBatches: number;
  failedNsuids: string[];
  batches: number;
  firstError: string | null;
}> {
  let pending: string[][] = [];
  for (let i = 0; i < nsuids.length; i += BATCH) pending.push(nsuids.slice(i, i + BATCH));
  const total = pending.length;

  const prices: EcPrice[] = [];
  let ok = 0;
  let firstError: string | null = null;

  // A Akamai na frente da API responde 403 quando as chamadas vêm rápidas demais: vai devagar e,
  // no fim, tenta de novo os lotes que falharam depois de uma pausa, um de cada vez.
  for (let pass = 0; pass < PASSES && pending.length; pass++) {
    if (pass > 0) {
      if (ok === 0) break; // nenhuma chamada passou: API inacessível, não adianta insistir
      await sleep(COOLDOWN_MS * pass);
    }
    const failed: string[][] = [];
    await mapLimit(pending, pass === 0 ? config.priceConcurrency : 1, async (ids) => {
      // Várias falhas sem nenhum sucesso = API inacessível (bloqueio de rede etc.): não insiste no resto.
      if (ok === 0 && failed.length >= 5) {
        failed.push(ids);
        return;
      }
      const qs = new URLSearchParams({ country, lang, ids: ids.join(',') });
      try {
        const res = await fetchJson<EcResponse>(`${BASE}?${qs}`);
        ok++;
        for (const t of res.prices ?? []) {
          const p = toPrice(t);
          if (p) prices.push(p);
        }
      } catch (err) {
        failed.push(ids);
        firstError ??= describeError(err);
      }
      await sleep(DELAY_MS);
    });
    pending = failed;
  }

  return { prices, failedBatches: pending.length, failedNsuids: pending.flat(), batches: total, firstError };
}
