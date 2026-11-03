import { TOP_OPTIONS, type Deal, type ListOptions } from './deals.ts';
import type { GameRec, HistoryEntry, Region } from './types.ts';

// ---------- formatação ----------

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const jpy = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export const money = (v: number) => (v === 0 ? 'Grátis' : brl.format(v));
const yen = (v: number) => (v === 0 ? 'Grátis' : jpy.format(v));
const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '');
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '');

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function endsIn(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return '';
  if (days === 0) return 'termina hoje';
  if (days === 1) return 'termina amanhã';
  return `termina em ${days} dias`;
}

const FLAG: Record<Region, string> = { BR: '🇧🇷', JP: '🇯🇵' };
const COUNTRY: Record<Region, string> = { BR: 'Brasil', JP: 'Japão' };
const PLATFORM: Record<string, string> = { switch: 'Switch', switch2: 'Switch 2' };

/** Miniatura via wsrv.nl: as imagens originais do eShop têm ~1 MB cada. */
function img(url: string | undefined, size: number, attrs = ''): string {
  if (!url) return '';
  const small = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${size}&h=${size}&fit=cover&a=attention&output=webp&q=70`;
  return `<img src="${esc(small)}" data-src="${esc(url)}" onerror="this.onerror=null;this.src=this.dataset.src" alt="" referrerpolicy="no-referrer" ${attrs}>`;
}

export function gameHref(g: GameRec): string {
  return `#/jogo/${encodeURIComponent(g.id)}`;
}

export const DEFAULTS: ListOptions = { q: '', sort: 'desconto', filter: 'todos', scope: 'ambos', platform: '', top: 0 };
// Buscando um jogo específico, mostra tudo (não só promoções) e de qualquer país.
export const SEARCH_DEFAULTS: ListOptions = { ...DEFAULTS, filter: 'todos', scope: 'qualquer' };

export function homeHref(opts: ListOptions): string {
  const base = opts.q ? SEARCH_DEFAULTS : DEFAULTS;
  const qs = new URLSearchParams();
  if (opts.q) qs.set('q', opts.q);
  if (opts.sort !== base.sort) qs.set('ordem', opts.sort);
  if (opts.filter !== base.filter) qs.set('filtro', opts.filter);
  if (opts.scope !== base.scope) qs.set('pais', opts.scope);
  if (opts.platform) qs.set('plataforma', opts.platform);
  if (opts.top) qs.set('populares', String(opts.top));
  const s = qs.toString();
  return s ? `#/?${s}` : '#/';
}

// ---------- home ----------

export function card(d: Deal): string {
  const g = d.game;
  const badge = d.savingPct >= 0.01 ? `<span class="badge">-${pct.format(d.savingPct)}</span>` : '';
  const from = d.saving >= 0.01 ? `<span class="from">${money(d.refReg)}</span>` : '';
  let note = '';
  if (d.best === 'JP' && d.brCur != null && d.brCur - d.bestPrice >= 0.01) {
    note = `<span class="note good">${pct.format(1 - d.bestPrice / d.brCur)} mais barato que no 🇧🇷</span>`;
  } else if (d.best === 'BR' && d.jpCur != null) {
    note = '<span class="note">melhor no Brasil</span>';
  }
  const ends = endsIn(d.bestEnd);
  return `<a class="card" href="${esc(gameHref(g))}">
  <div class="img">${img(g.img, 320, 'loading="lazy"')}${badge}</div>
  <div class="body">
    <div class="name">${esc(g.name)}</div>
    <div><span class="chip">${esc(PLATFORM[g.platform] ?? 'Switch')}</span>${
      g.pop != null && g.pop <= 100 ? ` <span class="chip hot" title="Entre os mais populares do eShop Brasil">🔥 #${g.pop}</span>` : ''
    }</div>
    <div class="price"><span title="${COUNTRY[d.best]}">${FLAG[d.best]}</span> ${money(d.bestPrice)} ${from}</div>
    ${note}
    ${ends ? `<span class="note">⏱ ${ends}</span>` : ''}
  </div>
</a>`;
}

function select(name: string, value: string, label: string, options: [string, string][]): string {
  const opts = options
    .map(([v, text]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(text)}</option>`)
    .join('');
  return `<select name="${name}" aria-label="${esc(label)}">${opts}</select>`;
}

export function homeView(p: {
  opts: ListOptions;
  list: Deal[];
  shown: number;
  feePct: number;
  hasBr: boolean;
  featured: Deal[];
  featuredHref: string;
}): string {
  const { opts, list } = p;
  const featured = p.featured.length
    ? `<section class="featured">
    <div class="featured-head"><h2>🔥 Populares em promoção</h2><a href="${esc(p.featuredHref)}">Ver todos →</a></div>
    <div class="row">${p.featured.map(card).join('')}</div>
  </section>`
    : '';
  const heading = opts.q
    ? `<h1>Resultados para “${esc(opts.q)}”</h1>`
    : `<h1>Melhores ofertas</h1><p class="sub">Menor preço entre o eShop do Brasil e do Japão, em reais. Desconto calculado sobre o preço cheio no Brasil.</p>`;

  const warn = p.hasBr
    ? ''
    : `<div class="warn">Ainda não há preços do Brasil: a API de preços da Nintendo não respondeu no último crawl. Por enquanto só aparecem preços do Japão.</div>`;

  const filters = `<form class="filters" id="filters">
    ${select('ordem', opts.sort, 'Ordenar', [
      ['desconto', 'Maior desconto'],
      ['popdesc', 'Populares em promoção'],
      ['economia', 'Maior economia (R$)'],
      ['preco', 'Menor preço'],
      ['fim', 'Terminando antes'],
      ['populares', 'Mais populares'],
      ['alta', 'Em alta'],
      ['novos', 'Lançamentos'],
      ['nome', 'Nome'],
    ])}
    ${select('filtro', opts.filter, 'Filtro', [
      ['todos', 'Todos os jogos'],
      ['ofertas', 'Só em promoção'],
    ])}
    ${select('populares', String(opts.top), 'Popularidade', [
      ['0', 'Qualquer popularidade'],
      ...TOP_OPTIONS.map((n): [string, string] => [String(n), `Top ${n} mais populares`]),
    ])}
    ${select('pais', opts.scope, 'Países', [
      ['ambos', 'À venda nos dois países'],
      ['qualquer', 'Em qualquer um'],
    ])}
    ${select('plataforma', opts.platform, 'Plataforma', [
      ['', 'Switch e Switch 2'],
      ['switch', 'Só Switch'],
      ['switch2', 'Só Switch 2'],
    ])}
    <label class="fee" title="Somado ao preço do Japão: IOF do cartão, ágio do gift card etc.">Taxa JP
      <input name="taxa" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="${p.feePct}">%</label>
    <span class="count">${list.length.toLocaleString('pt-BR')} jogos</span>
  </form>`;

  const grid = list.length
    ? `<div class="grid" id="grid">${list.slice(0, p.shown).map(card).join('')}</div>`
    : `<div class="empty">Nenhum jogo encontrado com esses filtros.</div>`;
  const more =
    list.length > p.shown
      ? `<div class="more"><button type="button" id="more">Mostrar mais (${(list.length - p.shown).toLocaleString('pt-BR')} restantes)</button></div>`
      : '';

  return `${warn}${featured}${heading}${filters}${grid}${more}`;
}

// ---------- página do jogo ----------

function storeUrl(region: Region, nsuid: string): string {
  return region === 'JP'
    ? `https://store-jp.nintendo.com/item/software/D${nsuid}`
    : `https://ec.nintendo.com/apps/${nsuid}/BR`;
}

function regionBox(region: Region, g: GameRec, factor: number, isBest: boolean, hasBr: boolean): string {
  const tuple = region === 'BR' ? g.br : g.jp;
  const nsuid = region === 'BR' ? g.nsuidBr : g.nsuidJp;
  const head = `<h2><span>${FLAG[region]} ${COUNTRY[region]}</span>${isBest ? '<span class="tag">Melhor preço</span>' : ''}</h2>`;
  if (!tuple) {
    const why =
      region === 'BR' && !hasBr
        ? 'Preço do Brasil ainda não coletado.'
        : `Não está à venda no eShop ${region === 'BR' ? 'brasileiro' : 'japonês'}.`;
    return `<div class="region">${head}<div class="na">${why}</div></div>`;
  }
  const [regular, current, saleEnd] = tuple;
  const toBrl = (v: number) => (region === 'JP' ? v * factor : v);
  const rows: string[] = [];
  if (region === 'JP') rows.push(`<dt>Na moeda local</dt><dd>${yen(current)}</dd>`);
  rows.push(
    `<dt>Preço cheio</dt><dd>${money(toBrl(regular))}${region === 'JP' ? ` <span class="note">(${yen(regular)})</span>` : ''}</dd>`,
  );
  if (current < regular) {
    rows.push(`<dt>Desconto</dt><dd>-${pct.format(1 - current / regular)}</dd>`);
    if (saleEnd) rows.push(`<dt>Promoção até</dt><dd>${fmtDateTime(saleEnd)}</dd>`);
  }
  return `<div class="region${isBest ? ' best' : ''}">${head}
    <div class="big">${money(toBrl(current))}</div>
    <dl>${rows.join('')}</dl>
    ${nsuid ? `<a class="btn" href="${esc(storeUrl(region, nsuid))}" target="_blank" rel="noopener">Abrir no eShop ${region} ↗</a>` : ''}
  </div>`;
}

export function gameView(p: {
  d: Deal;
  fx: { rate: number; source: string | null; at: string | null };
  feePct: number;
  factor: number;
  crawledAt: string | null;
  hasBr: boolean;
  backHref: string;
}): string {
  const { d, factor } = p;
  const g = d.game;

  let verdict = '';
  if (d.brCur == null && !p.hasBr) {
    verdict = `<div class="verdict neutral">Preço do Brasil ainda não coletado. Por enquanto, só o do Japão.</div>`;
  } else if (d.brCur != null && d.jpCur != null) {
    const diff = d.brCur - d.jpCur;
    if (diff >= 0.01) {
      verdict = `<div class="verdict">🇯🇵 Mais barato no Japão: ${money(d.jpCur)}, ${money(diff)} (${pct.format(diff / d.brCur)}) a menos que no Brasil hoje.</div>`;
    } else if (diff <= -0.01) {
      verdict = `<div class="verdict">🇧🇷 Mais barato no Brasil: ${money(d.brCur)}, ${money(-diff)} (${pct.format(-diff / d.jpCur)}) a menos que no Japão hoje.</div>`;
    } else {
      verdict = `<div class="verdict neutral">Mesmo preço nos dois países: ${money(d.brCur)}.</div>`;
    }
  } else {
    verdict = `<div class="verdict neutral">Só está à venda no eShop ${d.best === 'BR' ? 'do Brasil' : 'do Japão'}.</div>`;
  }

  const info = [
    g.publisher,
    PLATFORM[g.platform],
    g.release ? `Lançamento ${fmtDate(`${g.release}T12:00:00Z`)}` : null,
    g.pop != null ? `#${g.pop.toLocaleString('pt-BR')} em popularidade no eShop Brasil` : null,
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ');

  const fxNote = `<p class="fxnote">Câmbio: ¥100 = ${money(p.fx.rate * 100)} (${esc(p.fx.source ?? '')}, ${fmtDateTime(p.fx.at)})${
    p.feePct ? ` + ${p.feePct}% de taxa extra no preço japonês` : ''
  }. Preços coletados em ${fmtDateTime(p.crawledAt)}.</p>`;

  return `<a class="back" href="${esc(p.backHref)}">← Ofertas</a>
  <section class="hero">
    ${g.img ? img(g.img, 480) : '<div></div>'}
    <div>
      <h1>${esc(g.name)}</h1>
      ${g.nameJp && g.nameJp !== g.name ? `<p class="sub" lang="ja">${esc(g.nameJp)}</p>` : ''}
      <p class="sub">${info}</p>
      ${verdict}
    </div>
  </section>
  <section class="regions">
    ${regionBox('BR', g, factor, d.best === 'BR', p.hasBr)}
    ${regionBox('JP', g, factor, d.best === 'JP', p.hasBr)}
  </section>
  ${fxNote}
  <div id="history"></div>`;
}

export function historyView(entries: HistoryEntry[], factor: number): string {
  if (!entries.length) return '';
  const lowest = (['BR', 'JP'] as const)
    .map((r) => {
      const rows = entries.filter((h) => h[0] === r);
      if (!rows.length) return '';
      const min = rows.reduce((a, b) => (b[2] < a[2] ? b : a));
      const val = r === 'JP' ? `${yen(min[2])} <span class="note">(≈ ${money(min[2] * factor)} hoje)</span>` : money(min[2]);
      return `<tr><td>${FLAG[r]} ${COUNTRY[r]}</td><td class="num">${val}</td><td class="num">${fmtDate(min[3])}</td></tr>`;
    })
    .join('');
  const changes = entries
    .slice(0, 30)
    .map(
      ([r, regular, current, at]) =>
        `<tr><td>${fmtDate(at)}</td><td>${FLAG[r]}</td><td class="num">${r === 'JP' ? yen(current) : money(current)}</td><td class="num">${
          current < regular ? `-${pct.format(1 - current / regular)}` : '—'
        }</td></tr>`,
    )
    .join('');
  return `<h3>Menor preço registrado</h3>
    <table><thead><tr><th>País</th><th class="num">Preço</th><th class="num">Desde</th></tr></thead><tbody>${lowest}</tbody></table>
    <h3>Mudanças de preço</h3>
    <table><thead><tr><th>Data</th><th>País</th><th class="num">Preço</th><th class="num">Desconto</th></tr></thead><tbody>${changes}</tbody></table>
    <p class="fxnote">O histórico começa no primeiro crawl e fica mais completo a cada execução.</p>`;
}

export function notFoundView(): string {
  return `<div class="empty"><h1>Jogo não encontrado</h1><p><a href="#/">← Voltar para as ofertas</a></p></div>`;
}
