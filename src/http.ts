import { config } from './config.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} em ${url}`);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET com retry exponencial para 429/5xx/erros de rede. 4xx (exceto 429) falha na hora. */
export async function fetchWithRetry(url: string, init: RequestInit = {}, tries = 4): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'user-agent': config.userAgent, ...init.headers },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok || res.status === 304) return res;
      throw new HttpError(res.status, url);
    } catch (err) {
      lastErr = err;
      const retryable = !(err instanceof HttpError) || err.status === 429 || err.status >= 500;
      if (!retryable || attempt === tries) break;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  const { origin, pathname } = new URL(url);
  throw new Error(`Falha ao buscar ${origin}${pathname}`, { cause: lastErr });
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(url, { ...init, headers: { accept: 'application/json', ...init.headers } });
  return (await res.json()) as T;
}

/** Executa `fn` sobre `items` com no máximo `limit` chamadas simultâneas, preservando a ordem. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Mensagem do erro + causas encadeadas (fetch esconde o motivo real em `cause`). */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  while (cur instanceof Error && parts.length < 4) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  if (cur && !(cur instanceof Error)) parts.push(String(cur));
  return parts.join(' <- ');
}
