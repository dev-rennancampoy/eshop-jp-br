# eShop JP×BR

Comparador de preços do Nintendo eShop do **Brasil** e do **Japão**, no estilo do eshop-prices.com.

- **Home**: melhores ofertas, mostrando só o menor preço entre os dois países (o japonês já convertido para reais).
- **Página do jogo**: os dois preços lado a lado, quem está mais barato, até quando vai a promoção e o histórico de preços.

## Como funciona

```
npm run crawl   coleta catálogo + preços e grava em data/eshop.db (SQLite)
npm run build   gera o site estático em dist/ (data.json + histórico + app)
npm start       build + servidor local em http://localhost:3000
```

Não há dependências de runtime: Node 22.18+ roda TypeScript direto e já traz `node:sqlite`.
`npm install` só é necessário para `npm run typecheck`.

### Fontes

| Dado | Fonte |
| --- | --- |
| Catálogo e preços do Japão | `search.nintendo.jp` (busca oficial, já traz preço cheio, preço atual, promoção, editora e lançamento) |
| Catálogo do Brasil | [blawar/titledb](https://github.com/blawar/titledb) (`BR.pt.json`) + busca do nintendo.com/pt-br (Algolia, chave pública de busca do site), que cobre lançamentos recentes e Switch 2 |
| Preços do Brasil | `api.ec.nintendo.com/v1/price` (API pública do eShop, 50 jogos por chamada). Se um lote falhar, vale o preço da busca do nintendo.com |
| Preços Amazon JP | busca da amazon.co.jp, só a versão digital (`オンラインコード版` / `ダウンロード版`) com título idêntico ao do eShop JP. Só os 70 jogos mais populares, uma vez por dia, uma busca a cada 3 s. Se a Amazon bloquear, para e mantém os últimos preços (`AMAZON_TOP=0` desliga) |
| Notas (Metacritic) | endpoints JSON que a página do Metacritic usa: imprensa (Metascore) e usuários da versão de Switch / Switch 2. Switch 2 Edition sem nota própria usa a do jogo base. ~250 jogos por execução, dos mais populares; cada nota é renovada a cada 14 dias (3 para lançamentos). `METACRITIC_BUDGET=0` desliga |
| Popularidade | busca do nintendo.com/pt-br (`popularityRank` e `trendingRank` da loja brasileira), renumerada só entre os jogos do site |
| Data de lançamento (BR) | titledb `US.en.json`: o nsuid das Américas é o mesmo, e a data do catálogo BR de jogos antigos é a de entrada na eShop brasileira |
| Câmbio JPY→BRL | AwesomeAPI, com fallback no ExchangeRate-API |
| Miniaturas | `wsrv.nl` redimensiona as imagens do eShop (~1 MB → ~15 KB) |

### Como o mesmo jogo é reconhecido nos dois países

O nsuid é diferente em cada país. O crawler tenta, em ordem, e só aceita pares únicos dos dois lados:

1. **Title ID** do Switch (titledb `JP.ja.json` e `BR.pt.json`): a grande maioria.
2. **Apelidos** em `src/aliases.ts`: Title ID diferente e nome em japonês (ex.: Persona 5 Royal).
3. **Mesmo nome e plataforma**: lançamentos que o titledb ainda não tem (ex.: FINAL FANTASY VII REBIRTH).
4. **Mesma editora japonesa grande + plataforma + lançamento (±1 dia)**: jogos com nome em japonês
   (ex.: ドンキーコング バナンザ = Donkey Kong Bananza). Só editoras mapeadas em `src/matching.ts`.

Pacotes (nsuid `7007`: coleções como KINGDOM HEARTS Collection e edições deluxe) entram quando o eShop BR
diz que contêm jogo (`dlcType` vazio ou `ROM Bundle`; `Pacote` é só DLC). Pacote só casa com pacote, por nome
ou apelido; pacote japonês sem par fica de fora, porque a busca do Japão não diferencia pacote de jogo de
pacote de DLC.

A "Nintendo Switch 2 Edition" tem o mesmo Title ID do jogo de Switch 1, mas é outro produto com outro preço:
vira um jogo à parte (`<Title ID>-S2`). Nas regras 3 e 4 só entram jogos com preço no Brasil (um art book da
mesma editora e data deixaria o par ambíguo).

Se aparecer um par errado no site, adicione-o em `NOT_SAME` (`src/aliases.ts`). Se faltar um par, em `ALIASES`.

### Regras de "melhor preço"

- O preço japonês em reais é o custo real de pagar em iene: `¥ × câmbio comercial × (1 + spread) × (1 + IOF)`.
  - IOF de compras internacionais: **3,5%** (cartão e conta global, desde jul/2025).
  - Spread: **4%** no cartão de crédito comum ou **0,7%** para quem marca **"Cliente Wise"** no topo do site
    (fica salvo no navegador).
  - Os percentuais ficam em `src/config.ts` e podem ser trocados no build por `JP_IOF`, `JP_SPREAD_CARTAO` e `JP_SPREAD_WISE`.
- O lado japonês vale o menor entre eShop JP e Amazon JP (os dois em iene, mesmo spread e IOF). Na página do jogo aparecem as três origens.
- Em caso de empate, ganha o Brasil.
- O desconto e a economia são medidos contra o **preço cheio no Brasil**.
- "Só em promoção" = há promoção em algum dos dois países **e** o melhor preço fica abaixo do preço cheio no Brasil.
- **Populares em promoção** (faixa no topo da home e ordenação): só jogos em promoção, ordenados por
  `economia × (1 − log₁₀(posição na popularidade) / 3)`. O peso é 1 para o #1, 0,67 no #10, 0,33 no #100 e 0 do #1000 em diante.

## Deploy (GitHub Pages, gratuito)

O workflow `.github/workflows/deploy.yml` roda a cada 6 horas (e a cada push na `main`):
crawl → build → publica `dist/` no GitHub Pages. O banco é guardado no cache do Actions para manter o histórico.

Para ativar: em *Settings → Pages*, escolha **Source: GitHub Actions**. No plano gratuito, o repositório precisa ser público.

## Limitações conhecidas

- Jogos que não caem em nenhuma das regras acima (Title ID diferente, nome em japonês e editora não mapeada)
  aparecem como exclusivos de um dos países até ganharem um apelido.
- `api.ec.nintendo.com` recusa conexões de algumas redes. Quando isso acontece, o crawl mantém os últimos preços do Brasil
  e o site avisa.
- Workflows agendados de repositórios públicos são pausados pelo GitHub depois de 60 dias sem commits.
