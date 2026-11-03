// Como reconhecer o mesmo jogo no eShop do Japão e do Brasil quando o Title ID não resolve
// (titledb sem o jogo, ou builds diferentes por região).

function compact(s: string): string {
  return s
    .replace(/[™®©]/g, '') // antes do NFKC, que transforma ™ em "TM"
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** "FINAL FANTASY™ VII REBIRTH" e "Final Fantasy VII Rebirth" viram a mesma chave. Nomes curtos demais não casam. */
export function nameKey(name: string, platform: string | null): string | null {
  const n = compact(name);
  return n.length >= 4 ? `${n}|${platform ?? 'switch'}` : null;
}

// Editoras japonesas grandes, que lançam no mundo todo no mesmo dia e cujos jogos têm nome em
// japonês no eShop JP. Só elas entram no casamento por editora + data: indies lançam vários
// jogos no mesmo dia e dariam pares errados.
const JP_MAKERS: Record<string, string> = {
  任天堂: 'nintendo',
  株式会社ポケモン: 'nintendo',
  ポケモン: 'nintendo',
  'スクウェア・エニックス': 'squareenix',
  セガ: 'sega',
  アトラス: 'sega',
  カプコン: 'capcom',
  バンダイナムコエンターテインメント: 'bandainamco',
  コーエーテクモゲームス: 'koeitecmo',
  KONAMI: 'konami',
  'スパイク・チュンソフト': 'spikechunsoft',
  日本一ソフトウェア: 'nippon1',
  アークシステムワークス: 'arcsystemworks',
  レベルファイブ: 'level5',
  マーベラス: 'marvelous',
  ハムスター: 'hamster',
};

// No Brasil o nome da editora vem em inglês e às vezes com sufixo ("Bandai Namco Entertainment America").
const BR_PUBLISHER_PREFIXES: [string, string][] = [
  ['nintendo', 'nintendo'],
  ['thepokemoncompany', 'nintendo'],
  ['squareenix', 'squareenix'],
  ['sega', 'sega'],
  ['atlus', 'sega'],
  ['capcom', 'capcom'],
  ['bandainamco', 'bandainamco'],
  ['koeitecmo', 'koeitecmo'],
  ['konami', 'konami'],
  ['spikechunsoft', 'spikechunsoft'],
  // NIS America e XSEED ficam de fora: publicam no ocidente jogos de várias editoras japonesas.
  ['nipponichi', 'nippon1'],
  ['arcsystemworks', 'arcsystemworks'],
  ['level5', 'level5'],
  ['marvelous', 'marvelous'],
  ['hamster', 'hamster'],
];

const GENERIC_WORDS = new Set(
  'the and for with plus edition nintendo switch remaster remastered deluxe complete definitive enhanced hd dx collection version'.split(' '),
);

/**
 * Se o nome japonês tem palavras em inglês ("Curse Warrior"), alguma delas precisa estar no nome
 * brasileiro. Nome só em japonês (ou só com termos genéricos como "Edition") passa direto.
 */
export function sharesLatinWords(jpName: string, brName: string): boolean {
  const words = (jpName.replace(/[™®©]/g, '').normalize('NFKC').toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !GENERIC_WORDS.has(w));
  if (!words.length) return true;
  const br = brName.replace(/[™®©]/g, '').normalize('NFKC').toLowerCase().replace(/[^a-z]/g, '');
  return words.some((w) => br.includes(w));
}

export function jpPublisherGroup(maker: string | null): string | null {
  return maker ? (JP_MAKERS[maker.trim()] ?? null) : null;
}

export function brPublisherGroup(publisher: string | null): string | null {
  if (!publisher) return null;
  const n = compact(publisher);
  return BR_PUBLISHER_PREFIXES.find(([prefix]) => n.startsWith(prefix))?.[1] ?? null;
}

/** Chaves editora|plataforma|data para a data e os vizinhos (fuso: meia-noite no Japão ainda é véspera no Brasil). */
export function releaseKeys(group: string, platform: string | null, date: string | null, toleranceDays = 1): string[] {
  if (!date) return [];
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return [];
  const keys: string[] = [];
  for (let d = -toleranceDays; d <= toleranceDays; d++) {
    keys.push(`${group}|${platform ?? 'switch'}|${new Date(t + d * 86_400_000).toISOString().slice(0, 10)}`);
  }
  return keys;
}
