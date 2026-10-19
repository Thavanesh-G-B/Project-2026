// Bundles the harness into one self-contained HTML file that opens by double-click (file://).
//   node build-standalone.mjs [out.html]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? '../core-drill.html');
const dir = mkdtempSync(join(tmpdir(), 'cd-build-'));
await build({
  entryPoints: ['src/harness/main.tsx'],
  bundle: true, minify: true, format: 'iife', target: 'es2020',
  jsx: 'automatic', outdir: dir, entryNames: 'app', loader: { '.png': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
const js = readFileSync(join(dir, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(dir, 'app.css'), 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Core Drill: Planetfall</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=Chakra+Petch:wght@400;600;700&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;600&display=swap" rel="stylesheet" />
<style>
html, body, #root { margin: 0; min-height: 100%; background: #050811; }
body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
.demo-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 6px 12px; background: #0a0f1d; border-bottom: 1px solid rgba(148,163,184,.16); font: 11px 'JetBrains Mono', monospace; color: #94a3b8; }
.demo-bar span { flex: 1 1 auto; }
.demo-bar button { background: transparent; color: #e2e8f0; border: 1px solid rgba(148,163,184,.3); border-radius: 8px; padding: 4px 10px; font: inherit; cursor: pointer; }
.demo-bar button:hover { border-color: #22d3ee; color: #22d3ee; }
${css}
.cd-play { height: calc(100vh - 38px); }
</style>
</head>
<body>
<div id="root"></div>
<script>
${js}
</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
