// Regras de "melhor preço": o preço japonês é convertido para BRL com spread e IOF (ver jpCost)
// e comparado ao brasileiro. Empate fica com o Brasil (sem dor de cabeça).
// A economia é sempre medida contra o preço cheio no Brasil, a referência de quem compra daqui.
import type { GameRec, JpFees, Platform, Region } from './types.ts';

export type Sort =
  | 'desconto'
  | 'popdesc'
  | 'preco'
  | 'economia'
  | 'fim'
  | 'populares'
  | 'alta'
  | 'usuarios'
  | 'imprensa'
  | 'novos'
  | 'nome';
export const SORTS_LIST: readonly Sort[] = [
  'desconto',
  'popdesc',
  'preco',
  'economia',
  'fim',
  'populares',
  'alta',
  'usuarios',
  'imprensa',
  'novos',
  'nome',
];

/** Filtro por nota do Metacritic: u = usuários (0–10), c = imprensa (0–100). '' = qualquer nota. */
export type ScoreFilter = '' | 'u7' | 'u8' | 'u9' | 'c75' | 'c85' | 'c90';
export const SCORE_FILTERS: readonly ScoreFilter[] = ['', 'u7', 'u8', 'u9', 'c75', 'c85', 'c90'];
export type Filter = 'ofertas' | 'todos';
export type Scope = 'ambos' | 'qualquer';
export const TOP_OPTIONS = [100, 500, 1000] as const;

export type ListOptions = {
  q: string;
  sort: Sort;
  filter: Filter;
  scope: Scope;
  platform: Platform | '';
  top: number; // só os N mais populares; 0 = todos
  score: ScoreFilter;
};

export type Deal = {
  game: GameRec;
  search: string;
  brCur: number | null;
  brReg: number | null;
  jpCur: number | null; // em BRL: o mais barato entre eShop JP e Amazon JP
  jpReg: number | null; // em BRL: preço cheio no eShop JP
  jpSource: 'JP' | 'AMZ'; // de onde veio o jpCur
  best: Region;
  bestPrice: number;
  bestEnd: string | null;
  refReg: number;
  saving: number;
  savingPct: number;
  onSale: boolean;
  popScore: number; // índice popularidade + desconto; 0 = fora (sem promoção ou fora do top 1000)
};

/** Minúsculas, sem acento e sem ™/®, para "pokemon" achar "Pokémon™". */
export function normalizeSearch(s: string): string {
  return s
    .replace(/[™®©]/g, '') // antes do NFKD, que transforma ™ em "TM"
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quanto custa, em reais, pagar em iene: câmbio comercial + spread de quem converte + IOF. */
export type JpCost = { rate: number; spreadPct: number; iofPct: number; wise: boolean; factor: number };

export function jpCost(rate: number, fees: JpFees, wise: boolean): JpCost {
  const spreadPct = wise ? fees.wiseSpreadPct : fees.cardSpreadPct;
  // O IOF incide sobre o valor já convertido pelo banco, ou seja, com o spread.
  const factor = rate * (1 + spreadPct / 100) * (1 + fees.iofPct / 100);
  return { rate, spreadPct, iofPct: fees.iofPct, wise, factor };
}

/** `factor` = reais por iene já com spread e IOF (ver jpCost). */
export function toDeal(game: GameRec, factor: number, search: string): Deal {
  const brCur = game.br ? game.br[1] : null;
  const brReg = game.br ? game.br[0] : null;
  // Lado japonês: o mais barato entre eShop e Amazon (os dois em iene, mesmo custo de conversão)
  const eshopJp = game.jp ? game.jp[1] * factor : null;
  const amazonJp = game.amz ? game.amz[1] * factor : null;
  const jpSource = amazonJp != null && (eshopJp == null || amazonJp < eshopJp) ? 'AMZ' : 'JP';
  const jpCur = jpSource === 'AMZ' ? amazonJp : eshopJp;
  const jpReg = game.jp ? game.jp[0] * factor : amazonJp;
  const best: Region = brCur == null ? jpSource : jpCur == null || brCur <= jpCur ? 'BR' : jpSource;
  const bestPrice = (best === 'BR' ? brCur : jpCur) as number;
  const refReg = (brReg ?? jpReg) as number;
  const saving = refReg - bestPrice;
  const savingPct = refReg > 0 ? 1 - bestPrice / refReg : 0;
  // Promoção é só a do eShop: a Amazon vende o código digital mais barato quase sempre.
  const onSale =
    (brCur != null && brCur < (brReg as number)) || (eshopJp != null && game.jp != null && game.jp[1] < game.jp[0]);
  return {
    game,
    search,
    brCur,
    brReg,
    jpCur,
    jpReg,
    jpSource,
    best,
    bestPrice,
    bestEnd: (best === 'BR' ? game.br?.[2] : best === 'JP' ? game.jp?.[2] : null) ?? null,
    refReg,
    saving,
    savingPct,
    onSale,
    popScore: onSale && saving >= 0.01 ? savingPct * popularityWeight(game.pop) : 0,
  };
}

/**
 * Peso do índice "popularidade + desconto": 1 para o mais popular, 0,67 no #10, 0,33 no #100 e
 * 0 do #1000 em diante. Escala log para que um jogo do topo com desconto menor ainda fique na
 * frente de um mediano com desconto enorme.
 */
function popularityWeight(pop: number | undefined): number {
  return pop ? Math.max(0, 1 - Math.log10(pop) / 3) : 0;
}

type Cmp = (a: Deal, b: Deal) => number;
const by =
  (...cmps: Cmp[]): Cmp =>
  (a, b) => {
    for (const c of cmps) {
      const r = c(a, b);
      if (r) return r;
    }
    return 0;
  };
const nullsLast = (get: (d: Deal) => string | number | null | undefined, dir: 1 | -1): Cmp => (a, b) => {
  const x = get(a);
  const y = get(b);
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
  return x < y ? -dir : x > y ? dir : 0;
};

const SORTS: Record<Sort, Cmp> = {
  desconto: by((a, b) => b.savingPct - a.savingPct, (a, b) => a.bestPrice - b.bestPrice),
  popdesc: by((a, b) => b.popScore - a.popScore, nullsLast((d) => d.game.pop, 1)),
  preco: by((a, b) => a.bestPrice - b.bestPrice, (a, b) => b.savingPct - a.savingPct),
  economia: by((a, b) => b.saving - a.saving, (a, b) => b.savingPct - a.savingPct),
  fim: by(nullsLast((d) => d.bestEnd, 1), (a, b) => b.savingPct - a.savingPct),
  populares: by(nullsLast((d) => d.game.pop, 1), (a, b) => b.savingPct - a.savingPct),
  alta: by(nullsLast((d) => d.game.trend, 1), (a, b) => b.savingPct - a.savingPct),
  usuarios: by(nullsLast((d) => d.game.mc?.user, -1), nullsLast((d) => d.game.pop, 1)),
  imprensa: by(nullsLast((d) => d.game.mc?.critic, -1), nullsLast((d) => d.game.pop, 1)),
  novos: by(nullsLast((d) => d.game.release, -1)),
  nome: (a, b) => a.game.name.localeCompare(b.game.name, 'pt-BR'),
};

function passesScore(d: Deal, f: ScoreFilter): boolean {
  if (!f) return true;
  const min = Number(f.slice(1));
  const score = f[0] === 'u' ? d.game.mc?.user : d.game.mc?.critic;
  return score != null && score >= min;
}

export function filterDeals(deals: Deal[], opts: ListOptions): Deal[] {
  const q = normalizeSearch(opts.q);
  const out = deals.filter(
    (d) =>
      (opts.scope === 'qualquer' || (d.brCur != null && d.jpCur != null)) &&
      (!opts.platform || d.game.platform === opts.platform) &&
      (!opts.top || (d.game.pop != null && d.game.pop <= opts.top)) &&
      passesScore(d, opts.score) &&
      (!q || d.search.includes(q)) &&
      // Oferta = promoção em algum dos dois países E o melhor preço abaixo do preço cheio BR.
      (opts.filter === 'todos' || (d.onSale && d.saving >= 0.01)) &&
      // "Populares em promoção" é uma lista, não só uma ordem: quem tem índice 0 fica de fora.
      (opts.sort !== 'popdesc' || d.popScore > 0),
  );
  return out.sort(SORTS[opts.sort]);
}
