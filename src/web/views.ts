import { TOP_OPTIONS, type Deal, type JpCost, type ListOptions } from './deals.ts';
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

const FLAG: Record<Region, string> = { BR: '🇧🇷', JP: '🇯🇵', AMZ: '🇯🇵' };
const STORE: Record<Region, string> = { BR: 'eShop Brasil', JP: 'eShop Japão', AMZ: 'Amazon Japão' };
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

export const DEFAULTS: ListOptions = { q: '', sort: 'desconto', filter: 'todos', scope: 'ambos', platform: '', top: 0, score: '' };
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
  if (opts.score) qs.set('nota', opts.score);
  const s = qs.toString();
  return s ? `#/?${s}` : '#/';
}

// ---------- notas do Metacritic ----------

// Faixas de cor do próprio Metacritic: verde, amarelo, vermelho
const criticTone = (v: number) => (v >= 75 ? 'good' : v >= 50 ? 'mixed' : 'bad');
const userTone = (v: number) => (v >= 7.5 ? 'good' : v >= 5 ? 'mixed' : 'bad');
const fmtUser = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function scoresView(g: GameRec): string {
  const mc = g.mc;
  if (!mc) return '';
  const platform = mc.fromBase || g.platform !== 'switch2' ? 'nintendo-switch' : 'nintendo-switch-2';
  const link = (kind: 'critic' | 'user') => `https://www.metacritic.com/game/${mc.slug}/${kind}-reviews/?platform=${platform}`;
  const box = (kind: 'critic' | 'user', label: string, value: number | undefined, count: number | undefined, unit: string) => {
    const shown = value == null ? '—' : kind === 'critic' ? String(value) : fmtUser(value);
    const tone = value == null ? 'none' : kind === 'critic' ? criticTone(value) : userTone(value);
    const sub = value == null ? 'sem nota ainda' : count ? `${count.toLocaleString('pt-BR')} ${unit}` : '';
    return `<a class="score-box" href="${esc(link(kind))}" target="_blank" rel="noopener">
      <b class="${tone}">${shown}</b><span>${label}<small>${sub}</small></span></a>`;
  };
  return `<div class="scores">
    ${box('critic', 'Imprensa', mc.critic, mc.criticReviews, 'críticas')}
    ${box('user', 'Usuários', mc.user, mc.userReviews, 'avaliações')}
  </div>
  <p class="note">Metacritic, versão de ${platform === 'nintendo-switch-2' ? 'Switch 2' : 'Switch'}${
    mc.fromBase ? ' (a Switch 2 Edition ainda não tem nota própria)' : ''
  }.</p>`;
}

// ---------- home ----------

export function card(d: Deal): string {
  const g = d.game;
  const badge = d.savingPct >= 0.01 ? `<span class="badge">-${pct.format(d.savingPct)}</span>` : '';
  const from = d.saving >= 0.01 ? `<span class="from">${money(d.refReg)}</span>` : '';
  let note = '';
  if (d.best !== 'BR' && d.brCur != null && d.brCur - d.bestPrice >= 0.01) {
    note = `<span class="note good">${pct.format(1 - d.bestPrice / d.brCur)} mais barato que no 🇧🇷</span>`;
  } else if (d.best === 'BR' && d.jpCur != null) {
    note = '<span class="note">melhor no Brasil</span>';
  }
  const ends = endsIn(d.bestEnd);
  const rank =
    g.pop != null
      ? `<span class="rank${g.pop <= 100 ? ' hot' : ''}" title="Posição nos mais populares do eShop Brasil">${
          g.pop <= 100 ? '🔥 ' : ''
        }#${g.pop.toLocaleString('pt-BR')}</span>`
      : '';
  const user =
    g.mc?.user != null
      ? ` <span class="mcs ${userTone(g.mc.user)}" title="Nota dos usuários no Metacritic${
          g.mc.userReviews ? ` (${g.mc.userReviews.toLocaleString('pt-BR')} avaliações)` : ''
        }">👤 ${fmtUser(g.mc.user)}</span>`
      : '';
  return `<a class="card" href="${esc(gameHref(g))}">
  <div class="img">${img(g.img, 320, 'loading="lazy"')}${badge}${rank}</div>
  <div class="body">
    <div class="name">${esc(g.name)}</div>
    <div class="chips"><span class="chip">${esc(PLATFORM[g.platform] ?? 'Switch')}</span>${
       g.bundle ? '<span class="chip">Pacote</span>' : ''
     }${user}</div>
    <div class="price"><span title="${STORE[d.best]}">${FLAG[d.best]}</span> ${money(d.bestPrice)} ${from}</div>
    ${d.best === 'AMZ' ? '<span class="note src">via Amazon JP (código digital)</span>' : ''}
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
      ['usuarios', 'Nota dos usuários'],
      ['imprensa', 'Nota da imprensa'],
      ['novos', 'Lançamentos'],
      ['nome', 'Nome'],
    ])}
    ${select('filtro', opts.filter, 'Filtro', [
      ['todos', 'Todos os jogos'],
      ['ofertas', 'Só em promoção'],
    ])}
    ${select('nota', opts.score, 'Nota no Metacritic', [
      ['', 'Qualquer nota'],
      ['u7', 'Usuários 7+'],
      ['u8', 'Usuários 8+'],
      ['u9', 'Usuários 9+'],
      ['c75', 'Imprensa 75+'],
      ['c85', 'Imprensa 85+'],
      ['c90', 'Imprensa 90+'],
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

function storeUrl(region: Region, g: GameRec): string | null {
  if (region === 'AMZ') return g.asin ? `https://www.amazon.co.jp/dp/${g.asin}` : null;
  if (region === 'JP') return g.nsuidJp ? `https://store-jp.nintendo.com/item/software/D${g.nsuidJp}` : null;
  return g.nsuidBr ? `https://ec.nintendo.com/apps/${g.nsuidBr}/BR` : null;
}

function regionBox(region: Region, g: GameRec, cost: JpCost, isBest: boolean, hasBr: boolean): string {
  const tuple = region === 'BR' ? g.br : region === 'JP' ? g.jp : g.amz;
  const head = `<h2><span>${FLAG[region]} ${STORE[region]}</span>${isBest ? '<span class="tag">Melhor preço</span>' : ''}</h2>`;
  if (!tuple) {
    const why =
      region === 'AMZ'
        ? 'Sem versão digital (código) encontrada. A busca na Amazon JP cobre só os 70 jogos mais populares.'
        : region === 'BR' && !hasBr
          ? 'Preço do Brasil ainda não coletado.'
          : `Não está à venda no eShop ${region === 'BR' ? 'brasileiro' : 'japonês'}.`;
    return `<div class="region">${head}<div class="na">${why}</div></div>`;
  }
  const [regular, current, saleEnd] = tuple;
  const inYen = region !== 'BR';
  const toBrl = (v: number) => (inYen ? v * cost.factor : v);
  const rows: string[] = [];
  if (inYen) {
    // A conta aberta: câmbio comercial, depois o spread de quem converte, depois o IOF sobre o total.
    const commercial = current * cost.rate;
    const spread = commercial * (cost.spreadPct / 100);
    const iof = (commercial + spread) * (cost.iofPct / 100);
    const pctFmt = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    rows.push(
      `<dt>Na moeda local</dt><dd>${yen(current)}</dd>`,
      `<dt>Câmbio comercial</dt><dd>${money(commercial)}</dd>`,
      `<dt>Spread ${pctFmt(cost.spreadPct)} (${cost.wise ? 'Wise' : 'cartão de crédito'})</dt><dd>+ ${money(spread)}</dd>`,
      `<dt>IOF ${pctFmt(cost.iofPct)}</dt><dd>+ ${money(iof)}</dd>`,
    );
  }
  if (region === 'AMZ') {
    // Na Amazon o terceiro campo é quando o preço foi visto (coleta 1x por dia)
    rows.push(`<dt>Versão</dt><dd>Código digital (オンラインコード版)</dd>`);
    if (saleEnd) rows.push(`<dt>Preço visto em</dt><dd>${fmtDateTime(saleEnd)}</dd>`);
  } else {
    rows.push(
      `<dt>Preço cheio</dt><dd>${money(toBrl(regular))}${inYen ? ` <span class="note">(${yen(regular)})</span>` : ''}</dd>`,
    );
    if (current < regular) {
      rows.push(`<dt>Desconto</dt><dd>-${pct.format(1 - current / regular)}</dd>`);
      if (saleEnd) rows.push(`<dt>Promoção até</dt><dd>${fmtDateTime(saleEnd)}</dd>`);
    }
  }
  const url = storeUrl(region, g);
  return `<div class="region${isBest ? ' best' : ''}">${head}
    <div class="big">${money(toBrl(current))}</div>
    <dl>${rows.join('')}</dl>
    ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Abrir na ${STORE[region]} ↗</a>` : ''}
  </div>`;
}

export function gameView(p: {
  d: Deal;
  fx: { rate: number; source: string | null; at: string | null };
  cost: JpCost;
  crawledAt: string | null;
  hasBr: boolean;
  backHref: string;
}): string {
  const { d, cost } = p;
  const g = d.game;

  let verdict = '';
  if (d.brCur == null && !p.hasBr) {
    verdict = `<div class="verdict neutral">Preço do Brasil ainda não coletado. Por enquanto, só o do Japão.</div>`;
  } else if (d.brCur != null && d.jpCur != null) {
    const diff = d.brCur - d.jpCur;
    if (diff >= 0.01) {
      verdict = `<div class="verdict">🇯🇵 Mais barato no Japão${d.jpSource === 'AMZ' ? ', na Amazon' : ''}: ${money(d.jpCur)}, ${money(diff)} (${pct.format(diff / d.brCur)}) a menos que no Brasil hoje.</div>`;
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
    g.bundle ? 'Pacote' : null,
    g.release ? `Lançamento ${fmtDate(`${g.release}T12:00:00Z`)}` : null,
    g.pop != null ? `#${g.pop.toLocaleString('pt-BR')} em popularidade no eShop Brasil` : null,
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ');

  const fxNote = `<p class="fxnote">Câmbio comercial: ¥100 = ${money(p.fx.rate * 100)} (${esc(p.fx.source ?? '')}, ${fmtDateTime(p.fx.at)}).
    O preço do Japão em reais já inclui spread ${cost.wise ? 'da Wise' : 'do cartão de crédito'} e IOF${
      cost.wise ? '' : '. Paga com Wise? Marque “Cliente Wise” no topo'
    }. Preços coletados em ${fmtDateTime(p.crawledAt)}.</p>`;

  return `<a class="back" href="${esc(p.backHref)}">← Ofertas</a>
  <section class="hero">
    ${g.img ? img(g.img, 480) : '<div></div>'}
    <div>
      <h1>${esc(g.name)}</h1>
      ${g.nameJp && g.nameJp !== g.name ? `<p class="sub" lang="ja">${esc(g.nameJp)}</p>` : ''}
      <p class="sub">${info}</p>
      ${scoresView(g)}
      ${verdict}
    </div>
  </section>
  <section class="regions">
    ${regionBox('BR', g, cost, d.best === 'BR', p.hasBr)}
    ${regionBox('JP', g, cost, d.best === 'JP', p.hasBr)}
    ${regionBox('AMZ', g, cost, d.best === 'AMZ', p.hasBr)}
  </section>
  ${fxNote}
  <div id="history"></div>`;
}

export function historyView(entries: HistoryEntry[], factor: number): string {
  if (!entries.length) return '';
  const lowest = (['BR', 'JP', 'AMZ'] as const)
    .map((r) => {
      const rows = entries.filter((h) => h[0] === r);
      if (!rows.length) return '';
      const min = rows.reduce((a, b) => (b[2] < a[2] ? b : a));
      const val = r !== 'BR' ? `${yen(min[2])} <span class="note">(≈ ${money(min[2] * factor)} hoje)</span>` : money(min[2]);
      return `<tr><td>${FLAG[r]} ${STORE[r]}</td><td class="num">${val}</td><td class="num">${fmtDate(min[3])}</td></tr>`;
    })
    .join('');
  const changes = entries
    .slice(0, 30)
    .map(
      ([r, regular, current, at]) =>
        `<tr><td>${fmtDate(at)}</td><td>${FLAG[r]}${r === 'AMZ' ? ' Amazon' : ''}</td><td class="num">${r !== 'BR' ? yen(current) : money(current)}</td><td class="num">${
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
