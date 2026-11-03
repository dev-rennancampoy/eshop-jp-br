// Preço da versão digital (オンラインコード版 / ダウンロード版) na Amazon JP, pela página de busca.
// A página de produto cai na tela de "acesso automatizado"; a busca não. Uso propositalmente
// pequeno: poucos jogos por dia, uma busca por vez. Se a Amazon bloquear, paramos (sem contornar).
import { describeError } from '../http.ts';

const SEARCH = 'https://www.amazon.co.jp/s';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'accept-language': 'ja-JP,ja;q=0.9',
  accept: 'text/html',
};

export class AmazonBlocked extends Error {}

export type AmazonOffer = { asin: string; title: string; price: number };

/** "ドンキーコング バナンザ|オンラインコード版" -> "ドンキーコング バナンザ"; combos, DLC e físicos ficam de fora. */
function digitalCore(title: string): string | null {
  const m = title.match(/^(.*?)\s*[|｜]\s*(?:オンラインコード版|ダウンロード版)\s*$/);
  if (!m) return null;
  return m[1]
    .replace(/【[^】]*】/g, '')
    .replace(/[-－]\s*Switch\s*2?\s*$/i, '')
    .replace(/[(（]\s*(?:Nintendo\s*)?Switch\s*2?\s*[)）]/gi, '')
    .trim();
}

function compact(s: string): string {
  return s
    .replace(/[™®©]/g, '') // antes do NFKC, que transforma ™ em "TM"
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseResults(html: string): AmazonOffer[] {
  const offers: AmazonOffer[] = [];
  for (const block of html.split(/(?=<div[^>]+data-component-type="s-search-result")/).slice(1)) {
    const asin = block.match(/data-asin="([A-Z0-9]{10})"/)?.[1];
    const title = block.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/)?.[1];
    const price = block.match(/<span class="a-price"[^>]*>\s*<span class="a-offscreen">[￥¥]\s*([\d,]+)/)?.[1];
    if (asin && title && price) offers.push({ asin, title: decodeEntities(title).trim(), price: Number(price.replace(/,/g, '')) });
  }
  return offers;
}

/** Versão digital mais barata cujo título bate exatamente com o nome do jogo no eShop JP. */
export async function searchAmazonDigital(nameJp: string): Promise<AmazonOffer | null> {
  const qs = new URLSearchParams({ k: `${nameJp} オンラインコード版`, i: 'videogames' });
  let res: Response;
  try {
    res = await fetch(`${SEARCH}?${qs}`, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new Error(`Amazon JP: ${describeError(err)}`);
  }
  const html = await res.text();
  if (res.status === 503 || /automated access|captcha/i.test(html)) throw new AmazonBlocked(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Amazon JP: HTTP ${res.status}`);

  const want = compact(nameJp);
  const matches = parseResults(html).filter((o) => {
    const core = digitalCore(o.title);
    return core != null && compact(core) === want && o.price > 0;
  });
  return matches.sort((a, b) => a.price - b.price)[0] ?? null;
}
