// SPA com rotas por hash (funciona em qualquer hospedagem estática, inclusive em subpasta):
//   #/?q=zelda&ordem=preco   home / busca
//   #/jogo/<id>              página do jogo
import { filterDeals, normalizeSearch, toDeal, type Deal, type ListOptions } from './deals.ts';
import type { DataFile, HistoryShard } from './types.ts';
import { historyShard } from './types.ts';
import { DEFAULTS, SEARCH_DEFAULTS, fmtDateTime, gameView, historyView, homeHref, homeView, money, notFoundView } from './views.ts';

const PAGE = 48;
const FEE_KEY = 'eshop-jp-br:taxa';

const app = document.getElementById('app') as HTMLElement;
const searchInput = document.getElementById('q') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;

let data: DataFile;
let searchIndex: string[] = [];
let deals: Deal[] = [];
let byId = new Map<string, Deal>();
let feePct = 0;
const historyCache = new Map<string, Promise<HistoryShard>>();

// Estado da home para voltar do jogo sem perder a posição.
let homeKey = '';
let shown = PAGE;
let homeScroll = 0;

function readFee(fallback: number): number {
  try {
    const v = localStorage.getItem(FEE_KEY);
    return v != null && Number.isFinite(Number(v)) ? Number(v) : fallback;
  } catch {
    return fallback;
  }
}

function saveFee(v: number): void {
  try {
    localStorage.setItem(FEE_KEY, String(v));
  } catch {
    /* modo anônimo etc. */
  }
}

const factor = () => data.fx.rate * (1 + feePct / 100);

function computeDeals(): void {
  const k = factor();
  deals = data.games.map((g, i) => toDeal(g, k, searchIndex[i]));
  byId = new Map(deals.map((d) => [d.game.id, d]));
}

function parseHome(qs: URLSearchParams): ListOptions {
  const q = (qs.get('q') ?? '').trim();
  const base = q ? SEARCH_DEFAULTS : DEFAULTS;
  const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T) =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    q,
    sort: pick(qs.get('ordem'), ['desconto', 'preco', 'economia', 'fim', 'novos', 'nome'], base.sort),
    filter: pick(qs.get('filtro'), ['ofertas', 'todos'], base.filter),
    scope: pick(qs.get('pais'), ['ambos', 'qualquer'], base.scope),
    platform: pick(qs.get('plataforma'), ['', 'switch', 'switch2'], ''),
  };
}

function currentHome(): ListOptions {
  const [, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return parseHome(new URLSearchParams(query));
}

function renderHome(): void {
  const opts = currentHome();
  const key = homeHref(opts);
  const returning = key === homeKey;
  if (!returning) {
    homeKey = key;
    shown = PAGE;
    homeScroll = 0;
  }
  if (document.activeElement !== searchInput) searchInput.value = opts.q;
  const list = filterDeals(deals, opts);
  app.innerHTML = homeView({ opts, list, shown, feePct, hasBr: !!data.brCrawledAt });
  document.title = opts.q ? `${opts.q} · eShop JP×BR` : 'Melhores ofertas · eShop JP×BR';
  window.scrollTo(0, returning ? homeScroll : 0);
}

async function loadHistory(id: string): Promise<HistoryShard> {
  const shard = historyShard(id);
  let p = historyCache.get(shard);
  if (!p) {
    p = fetch(`h/${shard}.json`).then((r) => (r.ok ? r.json() : {}));
    p.catch(() => historyCache.delete(shard));
    historyCache.set(shard, p);
  }
  return p;
}

function renderGame(id: string): void {
  const d = byId.get(id);
  if (!d) {
    app.innerHTML = notFoundView();
    return;
  }
  app.innerHTML = gameView({
    d,
    fx: data.fx,
    feePct,
    factor: factor(),
    crawledAt: data.crawledAt,
    hasBr: !!data.brCrawledAt,
    backHref: homeKey || '#/',
  });
  document.title = `${d.game.name} · eShop JP×BR`;
  window.scrollTo(0, 0);
  loadHistory(id)
    .then((h) => {
      const el = document.getElementById('history');
      if (el && location.hash.startsWith('#/jogo/')) el.innerHTML = historyView(h[id] ?? [], factor());
    })
    .catch(() => {});
}

function route(): void {
  const m = location.hash.match(/^#\/jogo\/([^?]+)/);
  if (m) renderGame(decodeURIComponent(m[1]));
  else renderHome();
}

function navigateHome(opts: ListOptions, replace = false): void {
  const href = homeHref(opts);
  if (replace) {
    history.replaceState(null, '', href);
    route();
  } else {
    location.hash = href;
  }
}

// ---------- eventos ----------

let searchTimer: number | undefined;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    const onHome = !location.hash.startsWith('#/jogo/');
    // Digitar não deve empilhar uma entrada de histórico por letra.
    navigateHome({ ...(onHome ? currentHome() : DEFAULTS), q: searchInput.value.trim() }, onHome);
  }, 250);
});
(document.getElementById('search') as HTMLFormElement).addEventListener('submit', (e) => {
  e.preventDefault();
  searchInput.blur();
});

app.addEventListener('change', (e) => {
  const form = (e.target as HTMLElement).closest('form#filters') as HTMLFormElement | null;
  if (!form) return;
  const fd = new FormData(form);
  const fee = Number(fd.get('taxa'));
  if ((e.target as HTMLInputElement).name === 'taxa') {
    feePct = Number.isFinite(fee) && fee >= 0 ? fee : 0;
    saveFee(feePct);
    computeDeals();
    homeKey = '';
    renderHome();
    return;
  }
  const qs = new URLSearchParams();
  for (const [k, v] of fd) if (k !== 'taxa') qs.set(k, String(v));
  qs.set('q', currentHome().q);
  navigateHome(parseHome(qs));
});

app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'more') {
    homeScroll = window.scrollY;
    shown += PAGE;
    renderHome();
    return;
  }
  // Guarda a posição antes de abrir um jogo.
  if (target.closest('a.card')) homeScroll = window.scrollY;
});

window.addEventListener('hashchange', route);

// ---------- início ----------

async function main(): Promise<void> {
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as DataFile;
  } catch (err) {
    app.innerHTML = `<div class="empty"><h1>Não foi possível carregar os preços</h1><p>${String(err)}</p></div>`;
    return;
  }
  // Sem preços do Brasil, "à venda nos dois países" deixaria a home vazia.
  if (!data.brCrawledAt) DEFAULTS.scope = 'qualquer';
  feePct = readFee(data.defaultFeePct);
  searchIndex = data.games.map((g) => normalizeSearch(`${g.name} ${g.nameJp ?? ''}`));
  computeDeals();
  status.textContent = `Atualizado ${fmtDateTime(data.crawledAt)} · ¥100 = ${money(data.fx.rate * 100)}`;
  route();
}

main();
