import { describeError, fetchJson } from '../http.ts';

export type FxRate = { rate: number; source: string; at: string };

type AwesomeResponse = { JPYBRL?: { bid: string; create_date: string } };
type ErApiResponse = { result: string; rates?: { BRL?: number }; time_last_update_unix?: number };

/** Cotação JPY -> BRL. AwesomeAPI (comercial, atualiza ao longo do dia) com fallback no ExchangeRate-API. */
export async function fetchJpyBrl(): Promise<FxRate> {
  try {
    const res = await fetchJson<AwesomeResponse>('https://economia.awesomeapi.com.br/json/last/JPY-BRL');
    const rate = Number(res.JPYBRL?.bid);
    if (rate > 0) return { rate, source: 'AwesomeAPI', at: new Date().toISOString() };
  } catch (err) {
    console.warn(`  AwesomeAPI falhou (${describeError(err)}), tentando ExchangeRate-API`);
  }
  const res = await fetchJson<ErApiResponse>('https://open.er-api.com/v6/latest/JPY');
  const rate = res.rates?.BRL;
  if (!rate) throw new Error('Nenhuma fonte de câmbio JPY->BRL respondeu');
  const at = res.time_last_update_unix ? new Date(res.time_last_update_unix * 1000) : new Date();
  return { rate, source: 'ExchangeRate-API', at: at.toISOString() };
}
