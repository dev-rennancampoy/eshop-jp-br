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
| Catálogo e preços do Japão | `search.nintendo.jp` (busca oficial, já traz preço cheio, preço atual e período da promoção) |
| Catálogo do Brasil | [blawar/titledb](https://github.com/blawar/titledb) (`BR.pt.json`) |
| Preços do Brasil | `api.ec.nintendo.com/v1/price` (API pública do eShop, 50 jogos por chamada) |
| Câmbio JPY→BRL | AwesomeAPI, com fallback no ExchangeRate-API |
| Miniaturas | `wsrv.nl` redimensiona as imagens do eShop (~1 MB → ~15 KB) |

O mesmo jogo tem nsuids diferentes em cada país. O que liga os dois é o **Title ID** do Switch,
que vem do titledb (`JP.ja.json` e `BR.pt.json`).

### Regras de "melhor preço"

- O preço japonês é convertido pela cotação do dia, mais a **taxa extra** configurável (IOF, ágio do gift card etc.).
  Ela pode ser ajustada no próprio site (fica salva no navegador) ou definida como padrão em `JP_TAXA_EXTRA` (em %) no build.
- Em caso de empate, ganha o Brasil.
- O desconto e a economia são medidos contra o **preço cheio no Brasil**.
- "Só em promoção" = há promoção em algum dos dois países **e** o melhor preço fica abaixo do preço cheio no Brasil.

## Deploy (GitHub Pages, gratuito)

O workflow `.github/workflows/deploy.yml` roda a cada 6 horas (e a cada push na `main`):
crawl → build → publica `dist/` no GitHub Pages. O banco é guardado no cache do Actions para manter o histórico.

Para ativar: em *Settings → Pages*, escolha **Source: GitHub Actions**. No plano gratuito, o repositório precisa ser público.

## Limitações conhecidas

- O catálogo brasileiro depende do titledb. Lançamentos muito recentes (principalmente de Switch 2) podem demorar a aparecer.
- Jogos sem Title ID no titledb não são casados entre os países e aparecem como exclusivos de um deles.
- `api.ec.nintendo.com` recusa conexões de algumas redes. Quando isso acontece, o crawl mantém os últimos preços do Brasil
  e o site avisa.
- Workflows agendados de repositórios públicos são pausados pelo GitHub depois de 60 dias sem commits.
