// Correções manuais do casamento JP <-> BR. Para achar os nsuids: o do Brasil está na URL do
// jogo no nintendo.com/pt-br, o do Japão no data.json (campo nsuidJp) ou na busca do nintendo.co.jp.

// Pares que o crawler não consegue casar sozinho: Title ID diferente entre as regiões (builds
// separadas, comum na Atlus) e nome em japonês no JP.
//   [nsuid JP, nsuid BR, nome só para referência]
export const ALIASES: [string, string, string][] = [
  ['70010000042356', '70010000043147', 'Persona 5 Royal'],
  ['70010000057905', '70010000066005', 'Persona 5 Tactica'],
  ['70010000022628', '70010000030163', 'Persona 5 Strikers'],
  ['70010000044380', '70010000047451', 'Persona 4 Arena Ultimax'],
  ['70010000100151', '70010000100149', 'Persona 3 Reload'],
  // Pacotes (coleções) com nome em japonês: pacote não casa por editora + data
  ['70070000029947', '70070000030770', 'Super Mario Galaxy + Super Mario Galaxy 2'],
  ['70070000018037', '70070000018036', 'Pikmin 1+2'],
];

// Pares que o casamento automático (nome, ou editora + data de lançamento) juntou por engano:
// jogos diferentes da mesma editora lançados no mesmo dia.
//   [nsuid JP, nsuid BR, motivo]
export const NOT_SAME: [string, string, string][] = [
  ['70010000003605', '70010000012257', 'ネコ・トモ ≠ Taiko no Tatsujin: Drum \'n\' Fun!'],
  ['70010000005701', '70010000013947', 'SDガンダムX ≠ Katamari Damacy REROLL'],
];
