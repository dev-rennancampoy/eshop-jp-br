// Formato dos arquivos gerados pelo build (data.json e h/*.json) e lidos pelo site.

export type Region = 'BR' | 'JP';
export type Platform = 'switch' | 'switch2';

/** [preço cheio, preço atual, fim da promoção (ISO) ou null], na moeda local: BRL ou JPY */
export type PriceTuple = [number, number, string | null];

export type GameRec = {
  id: string;
  name: string;
  nameJp?: string;
  publisher?: string;
  img?: string;
  platform: Platform;
  release?: string;
  nsuidBr?: string;
  nsuidJp?: string;
  br?: PriceTuple;
  jp?: PriceTuple;
  pop?: number; // posição entre os jogos do site nos mais populares do eShop BR (1 = topo)
  trend?: number; // idem para "em alta"
};

export type DataFile = {
  generatedAt: string;
  crawledAt: string | null;
  brCrawledAt: string | null;
  fx: { rate: number; source: string | null; at: string | null };
  fees: JpFees;
  games: GameRec[];
};

/** Custos de pagar em iene, em % sobre o câmbio comercial (ver config.ts) */
export type JpFees = { iofPct: number; cardSpreadPct: number; wiseSpreadPct: number };

/** [região, preço cheio, preço atual, quando mudou (ISO)] */
export type HistoryEntry = [Region, number, number, string];
export type HistoryShard = Record<string, HistoryEntry[]>;

// O histórico fica dividido em arquivos menores para a página do jogo baixar só um pedaço.
const HISTORY_SHARDS = 64;

export function historyShard(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % HISTORY_SHARDS).toString(16).padStart(2, '0');
}
