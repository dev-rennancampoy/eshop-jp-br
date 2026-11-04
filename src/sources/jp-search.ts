// Busca oficial da Nintendo Japão (a mesma do site nintendo.com/jp). Já traz o preço
// cheio, o preço atual e o período da promoção, então dispensa a API de preços para o JP.
import { mapLimit, fetchJson } from '../http.ts';

const BASE = 'https://search.nintendo.jp/nintendo_soft/search.json';
const PAGE_SIZE = 300;

type JpItem = {
  nsuid: string | null;
  title: string | null;
  hard: string | null;
  maker: string | null;
  pdate: string | null; // quando entrou na loja (pré-venda), não o lançamento
  sdate: string | null; // lançamento, "2025.7.17"
  iurl: string | null;
  price: number | null;
  current_price: number | null;
  sprice: number | null;
  ssdate: string | null;
  sedate: string | null;
};

type JpResponse = { result: { total: number; items: JpItem[] } };

export type JpGame = {
  nsuid: string;
  name: string;
  platform: 'switch' | 'switch2';
  bundle: boolean;
  publisher: string | null;
  releaseDate: string | null;
  image: string | null;
  regular: number;
  current: number;
  saleStart: string | null;
  saleEnd: string | null;
};

/** "2025.7.17" -> "2025-07-17" */
function releaseDate(it: JpItem): string | null {
  const m = it.sdate?.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return it.pdate ? it.pdate.slice(0, 10) : null;
}

/** "2026-11-15 23:59:59" (horário de Tóquio) -> ISO UTC */
function jstToIso(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(`${s.replace(' ', 'T')}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pageUrl(page: number): string {
  const qs = new URLSearchParams({
    opt_sshow: '1',
    // À venda: jogos (7001) e pacotes (7007); DLC avulsa é 7005. A busca não distingue pacote com
    // jogo de pacote de DLC: quem decide se um pacote entra é o casamento com o Brasil (ver crawl.ts).
    fq: 'ssitu_s:onsale AND (id:70010* OR id:70070*)',
    sort: 'sodate desc,id asc',
    limit: String(PAGE_SIZE),
    page: String(page),
  });
  return `${BASE}?${qs}`;
}

function toGame(it: JpItem): JpGame | null {
  const name = it.title?.trim();
  if (!it.nsuid || !name || it.price == null) return null;
  const regular = it.price;
  const current = it.current_price ?? regular;
  const onSale = it.sprice != null && current < regular;
  return {
    nsuid: it.nsuid,
    name,
    platform: it.hard === '05_BEE' ? 'switch2' : 'switch',
    bundle: it.nsuid.startsWith('7007'),
    publisher: it.maker,
    releaseDate: releaseDate(it),
    image: it.iurl ? `https://img-eshop.cdn.nintendo.net/i/${it.iurl}.jpg` : null,
    regular,
    current,
    saleStart: onSale ? jstToIso(it.ssdate) : null,
    saleEnd: onSale ? jstToIso(it.sedate) : null,
  };
}

export async function fetchJpCatalog(): Promise<{ games: JpGame[]; total: number }> {
  const first = await fetchJson<JpResponse>(pageUrl(1));
  const total = first.result.total;
  const pages = Math.ceil(total / PAGE_SIZE);
  const rest = await mapLimit(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2),
    3,
    (p) => fetchJson<JpResponse>(pageUrl(p)),
  );

  const byNsuid = new Map<string, JpGame>();
  for (const res of [first, ...rest]) {
    for (const it of res.result.items) {
      const g = toGame(it);
      if (g) byNsuid.set(g.nsuid, g);
    }
  }
  return { games: [...byNsuid.values()], total };
}
