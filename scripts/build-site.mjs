// 產生 GitHub Pages 網站：site/widget.js（打包的小工具）、site/data/（資料檔）、site/index.html（示範與嵌入說明）
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

await rm('site', { recursive: true, force: true });
await mkdir('site', { recursive: true });
await build({
  entryPoints: ['src/widget.ts'], bundle: true, minify: true, format: 'iife',
  target: ['es2020'], outfile: 'site/widget.js', legalComments: 'none',
});
await cp('data', 'site/data', { recursive: true, filter: src => !src.endsWith('.tmp') });

await writeFile('site/index.html', `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>清大課綱搜尋</title>
<style>
  body { margin: 0; background: #F6F4F6; color: #222; font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif; }
  header { background: #721F6E; color: #fff; padding: 14px 16px; font-weight: 700; }
  main { max-width: 1024px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { color: #721F6E; margin: 0 0 4px; font-size: 28px; }
  p.lead { margin: 0 0 20px; color: #555; }
  details.embed { margin-top: 32px; background: #fff; border: 1px solid #CFC8CF; border-radius: 8px; padding: 12px 16px; }
  details.embed summary { cursor: pointer; font-weight: 600; min-height: 32px; }
  pre { background: #F6F4F6; padding: 12px; border-radius: 8px; overflow-x: auto; }
</style>
</head>
<body>
<header>國立清華大學 課綱搜尋</header>
<main>
  <h1>課綱關鍵字搜尋</h1>
  <p class="lead">搜尋校方公告的全部課程大綱 PDF，找出包含指定關鍵字的課程。</p>
  <div id="nthu-syllabus-search"></div>
  <details class="embed">
    <summary>嵌入學校 CMS 的方法</summary>
    <p>在 CMS 頁面的 HTML 原始碼貼上：</p>
    <pre><code>&lt;div id="nthu-syllabus-search"&gt;&lt;/div&gt;
&lt;script src="<span id="src"></span>" defer&gt;&lt;/script&gt;</code></pre>
  </details>
</main>
<script>document.getElementById('src').textContent = new URL('widget.js', location.href).href;</script>
<script src="widget.js" defer></script>
</body>
</html>
`);
console.log('site/ 已產生');
