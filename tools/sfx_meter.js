// Plays every sound voice through the real engine and measures its peak level at the output.
// Usage: NODE_PATH=<playwright dir> node tools/sfx_meter.js [village|platformer]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve('village.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  const rows = await page.evaluate(async () => {
    Sfx.init(); await Sfx.ctx.resume(); Sfx.setMusic('off', true); Sfx.setMuted(false);
    const names = Object.keys(window.__voices || {}).length ? [] : [];
    const res = [];
    for (const n of ['slash', 'hit', 'clang', 'thud', 'hurt', 'jump', 'dash', 'charge', 'strike', 'mine', 'chop', 'creak', 'crash', 'break', 'hammer', 'place', 'pickup', 'coin', 'power', 'craft', 'upgrade', 'done', 'click', 'open', 'deny', 'step', 'stepStone', 'stepDirt', 'arrow', 'cannon', 'mortar', 'explode', 'magic', 'cast', 'summon', 'heal', 'zombie', 'skeleton', 'die', 'horn', 'night', 'boss', 'dawn', 'cloud', 'fire']) {
      Sfx.last = {}; let peak = 0; const t0 = performance.now();
      Sfx.play(n, { vol: 1 });
      while (performance.now() - t0 < 1500) { await new Promise(r => setTimeout(r, 8)); peak = Math.max(peak, Sfx.peak()); }
      res.push([n, +peak.toFixed(3)]);
    }
    return res;
  });
  let bad = 0;
  for (const [n, p] of rows) { const flag = p < 0.02 ? 'QUIET' : p > 0.95 ? 'LOUD' : ''; if (flag) bad++; console.log(n.padEnd(10), p.toFixed(3), flag); }
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
