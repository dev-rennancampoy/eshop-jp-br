// Busca oficial do nintendo.com para o Brasil (Algolia), a mesma que o site usa no navegador,
// com a chave pública de busca dele. Cobre o que o titledb ainda não tem (lançamentos recentes,
// Switch 2) e traz o preço em reais, usado como reserva quando a API de preços falha.
import { fetchJson, mapLimit } from '../http.ts';

const APP_ID = 'U3B6GR4UA3';
const SEARCH_KEY = 'a29c6927638bfd8cee23993e51e721c9'; // chave pública, só de busca, embutida no nintendo.com
const URL = `https://${APP_ID}-dsn.algolia.net/1/indexes/store_game_pt_br/query`;
const MAX_HITS = 1000; // o Algolia não devolve mais que isso por consulta, então o catálogo vai em fatias
const RANK_WINDOW = 500;
const ATTRS = ['nsuid', 'title', 'platformCode', 'productImageSquare', 'releaseDate', 'softwarePublisher', 'eshopDetails'];

type Hit = {
  nsuid?: string | null;
  title?: string | null;
  platformCode?: string | null;
  productImageSquare?: string | null;
  releaseDate?: string | null;
  softwarePublisher?: string | null;
  eshopDetails?: {
    regularPrice?: number | null;
    discountPrice?: number | null;
    discountPriceStart?: string | null;
    discountPriceEnd?: string | null;
    currency?: string | null;
  } | null;
};

type QueryResponse = {
  nbHits: number;
  hits: Hit[];
  facets?: Record<string, Record<string, number>>;
  facets_stats?: Record<string, { min: number; max: number }>;
};

export type StoreGame = {
  nsuid: string;
  name: string;
  platform: 'switch' | 'switch2';
  publisher: string | null;
  releaseDate: string | null;
  image: string | null;
  price: { currency: string; regular: number; current: number; saleStart: string | null; saleEnd: string | null } | null;
};

function query(body: object): Promise<QueryResponse> {
  return fetchJson<QueryResponse>(URL, {
    method: 'POST',
    headers: { 'x-algolia-application-id': APP_ID, 'x-algolia-api-key': SEARCH_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** ".../image/fetch/q_auto/f_auto/https://atum-img-lp1.cdn.nintendo.net/i/c/<id>_1024" -> URL original */
function unwrapImage(url: string | null | undefined): string | null {
  if (!url) return null;
  const inner = url.indexOf('https://', 8);
  return inner > 0 ? url.slice(inner) : url;
}

function toGame(h: Hit): StoreGame | null {
  const nsuid = h.nsuid ?? '';
  const name = h.title?.trim();
  if (!nsuid.startsWith('7001') || !name) return null; // só jogos (DLC é 7005, pacotes 7007)
  const e = h.eshopDetails;
  let price: StoreGame['price'] = null;
  if (e?.currency === 'BRL' && e.regularPrice != null) {
    const onSale = e.discountPrice != null && e.discountPrice < e.regularPrice;
    price = {
      currency: 'BRL',
      regular: e.regularPrice,
      current: onSale ? (e.discountPrice as number) : e.regularPrice,
      saleStart: onSale ? (e.discountPriceStart ?? null) : null,
      saleEnd: onSale ? (e.discountPriceEnd ?? null) : null,
    };
  }
  return {
    nsuid,
    name,
    platform: h.platformCode === 'NINTENDO_SWITCH_2' ? 'switch2' : 'switch',
    publisher: h.softwarePublisher ?? null,
    releaseDate: h.releaseDate ? h.releaseDate.slice(0, 10) : null,
    image: unwrapImage(h.productImageSquare),
    price,
  };
}

export async function fetchBrStore(): Promise<{ games: StoreGame[]; truncated: number }> {
  const stats = await query({ query: '', hitsPerPage: 0, facets: ['availability', 'priceRange', 'popularityRank'] });
  const maxRank = stats.facets_stats?.popularityRank?.max ?? 20_000;

  const slices: object[] = [];
  for (let lo = 0; lo <= maxRank; lo += RANK_WINDOW) {
    slices.push({ numericFilters: [`popularityRank>=${lo}`, `popularityRank<${lo + RANK_WINDOW}`] });
  }
  // Sem popularityRank ficam sobretudo edições de Switch 2 e lançamentos futuros.
  for (const range of Object.keys(stats.facets?.priceRange ?? {})) {
    slices.push({ facetFilters: [['corePlatforms:Nintendo Switch 2'], [`priceRange:${range}`]] });
  }
  const availability = Object.entries(stats.facets?.availability ?? {}).sort((a, b) => b[1] - a[1]);
  for (const [value] of availability.slice(1)) {
    // a mais comum ("Já disponível") tem dezenas de milhares e já está nas fatias acima
    slices.push({ facetFilters: [[`availability:${value}`]] });
  }

  let truncated = 0;
  const pages = await mapLimit(slices, 4, async (slice) => {
    const res = await query({ query: '', hitsPerPage: MAX_HITS, attributesToRetrieve: ATTRS, ...slice });
    if (res.nbHits > MAX_HITS) truncated++;
    return res.hits;
  });

  const byNsuid = new Map<string, StoreGame>();
  for (const h of pages.flat()) {
    const g = toGame(h);
    if (g) byNsuid.set(g.nsuid, g);
  }
  return { games: [...byNsuid.values()], truncated };
}
