// Sonda temporária: baixa 3 páginas da Amazon JP para conferir o HTML e se o GitHub Actions é bloqueado.
// Uso único (workflow amazon-probe.yml); será removida depois.
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'amazon-probe';
const PAGES: [string, string][] = [
  ['produto-B0HGXBHWXG', 'https://www.amazon.co.jp/dp/B0HGXBHWXG'],
  ['busca-bananza', `https://www.amazon.co.jp/s?k=${encodeURIComponent('ドンキーコング バナンザ オンラインコード版')}&i=videogames`],
  ['busca-mkworld', `https://www.amazon.co.jp/s?k=${encodeURIComponent('マリオカート ワールド オンラインコード版')}&i=videogames`],
];

await mkdir(OUT, { recursive: true });
for (const [name, url] of PAGES) {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'accept-language': 'ja-JP,ja;q=0.9',
        accept: 'text/html',
      },
      signal: AbortSignal.timeout(30_000),
    });
    const html = await res.text();
    await writeFile(`${OUT}/${name}.html`, html);
    const captcha = /captcha|automated access/i.test(html);
    console.log(`${name}: HTTP ${res.status}, ${html.length} bytes, captcha/bloqueio: ${captcha}`);
  } catch (err) {
    console.log(`${name}: erro ${err}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
