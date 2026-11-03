// Notas do Metacritic (imprensa = Metascore, e usuários) da versão de Switch / Switch 2 de cada jogo,
// pelos mesmos endpoints JSON que a página do Metacritic consulta. Uso pequeno e espaçado; se o
// Metacritic recusar (403/429), paramos.
const BASE = 'https://backend.metacritic.com/reviews/metacritic';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  accept: 'application/json',
};
const DELAY_MS = 400;

export class MetacriticBlocked extends Error {}

export type McScore = {
  slug: string;
  critic: number | null; // Metascore, 0–100
  criticReviews: number | null;
  user: number | null; // 0–10
  userReviews: number | null;
  fromBase: boolean; // Switch 2 Edition sem notas próprias: vale a do jogo de Switch 1
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Kirby™ and the Forgotten Land – Nintendo Switch™ 2 Edition + Star-Crossed World" -> "kirby-and-the-forgotten-land-…" */
export function metacriticSlug(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "… – Nintendo Switch 2 Edition" / "… Edição Nintendo Switch 2" (com ou sem extras depois) -> nome do jogo base */
export function baseGameName(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .replace(/\s*[-–:]?\s*(?:Nintendo Switch 2 Edition|Edição Nintendo Switch 2)\b.*$/i, '')
    .trim();
}

type Stats = { score: number | null; reviews: number | null };

/** null = o Metacritic não tem esse jogo (404) */
async function stats(kind: 'critic' | 'user', slug: string, platform: string): Promise<Stats | null> {
  const res = await fetch(`${BASE}/${kind}/games/${slug}/platform/${platform}/stats/web`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  // 404 = não existe; 3xx = o Metacritic redireciona quando o jogo não tem essa plataforma
  if (res.status === 404 || (res.status >= 300 && res.status < 400)) return null;
  if (res.status === 403 || res.status === 429) throw new MetacriticBlocked(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Metacritic: HTTP ${res.status}`);
  const item = ((await res.json()) as { data?: { item?: { score?: number | null; reviewCount?: number | null } } }).data?.item;
  return { score: item?.score ?? null, reviews: item?.reviewCount ?? null };
}

async function scoresFor(slug: string, platform: string): Promise<Omit<McScore, 'fromBase'> | null> {
  const critic = await stats('critic', slug, platform);
  if (!critic) return null;
  await sleep(DELAY_MS);
  const user = await stats('user', slug, platform);
  return { slug, critic: critic.score, criticReviews: critic.reviews, user: user?.score ?? null, userReviews: user?.reviews ?? null };
}

/** `name` em inglês, como no eShop das Américas. */
export async function fetchMetacritic(name: string, platform: 'switch' | 'switch2', isSwitch2Edition: boolean): Promise<McScore | null> {
  const hasScore = (s: Omit<McScore, 'fromBase'> | null) => s != null && (s.critic != null || s.user != null);
  const own = await scoresFor(metacriticSlug(name), platform === 'switch2' ? 'nintendo-switch-2' : 'nintendo-switch');
  if (hasScore(own) || !isSwitch2Edition) return own ? { ...(own as Omit<McScore, 'fromBase'>), fromBase: false } : null;

  // Switch 2 Edition sem página própria com nota: as críticas costumam estar na página do jogo base,
  // na plataforma Switch 2; se não, vale a nota da versão de Switch 1.
  const baseSlug = metacriticSlug(baseGameName(name));
  for (const basePlatform of ['nintendo-switch-2', 'nintendo-switch']) {
    await sleep(DELAY_MS);
    const base = await scoresFor(baseSlug, basePlatform);
    if (hasScore(base)) return { ...(base as Omit<McScore, 'fromBase'>), fromBase: basePlatform === 'nintendo-switch' };
  }
  return own ? { ...own, fromBase: false } : null;
}

export { DELAY_MS as METACRITIC_DELAY_MS };
