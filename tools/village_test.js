// Village mode checks: UI flow (shop -> place -> construct -> collect), a raid, and a long soak.
// Usage: NODE_PATH=<playwright dir> node tools/village_test.js <outDir>
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve('village.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { } newVillage(); });
  await page.waitForTimeout(500);
  const shot = n => page.screenshot({ path: `${out}/${n}.png` });

  // --- shop -> place an archer tower with the mouse
  await page.click('#tShop'); await page.waitForTimeout(200); await shot('v2_shop');
  const cards = await page.$$('#shopGrid .card-b'); console.log('shop cards', cards.length);
  await cards[4].click();                       // cannon (the starting archers already fill the archer limit)
  const before = await page.evaluate(() => ({ n: V.buildings.length, gold: V.res.gold, tool: UI.tool, placing: UI.place && UI.place.type }));
  // aim at a free clearing tile left of the hall
  const pt = await page.evaluate(() => { const i = 28, j = 22; const r = document.getElementById('v').getBoundingClientRect();
    return { x: r.left + (isoX(i + 1, j + 1) - UI.cam.x) * UI.cam.zoom + UI.W / 2, y: r.top + (isoY(i + 1, j + 1) - UI.cam.y) * UI.cam.zoom + UI.H / 2 }; });
  await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(150); await shot('v3_ghost');
  await page.mouse.click(pt.x, pt.y);
  const after = await page.evaluate(() => ({ n: V.buildings.length, gold: V.res.gold, wood: V.res.wood, busy: busyBuilders(), tool: UI.tool, st: V.buildings[V.buildings.length - 1].state }));
  console.log('placing', JSON.stringify(before), '->', JSON.stringify(after));
  // finish construction
  await page.evaluate(() => { for (let k = 0; k < 400; k++) step(1 / 20); });
  console.log('after build', await page.evaluate(() => JSON.stringify({ busy: busyBuilders(), last: V.buildings[V.buildings.length - 1].state })));

  // --- collect from the gold mine by clicking its bubble
  await page.evaluate(() => { V.buildings.find(b => b.type === 'goldmine').prod = 120; centerOn(MID + 5, MID + 4); });
  await page.waitForTimeout(150);
  const gold0 = await page.evaluate(() => V.res.gold);
  const bub = await page.evaluate(() => { const b = V.buildings.find(b => b.type === 'goldmine'); const r = document.getElementById('v').getBoundingClientRect();
    const cx = isoX(b.i + 1, b.j + 1), cy = isoY(b.i + 1, b.j + 1) - 92 - 16; return { x: r.left + (cx - UI.cam.x) * UI.cam.zoom + UI.W / 2, y: r.top + (cy - UI.cam.y) * UI.cam.zoom + UI.H / 2 }; });
  await page.mouse.click(bub.x, bub.y);
  console.log('collected gold', Math.round(await page.evaluate(() => V.res.gold) - gold0));

  // --- upgrade through the info panel
  await page.evaluate(() => { V.res.gold = 500; V.res.wood = 400; select(V.buildings.find(b => b.type === 'townhall')); });
  await page.click('#aUpgrade'); console.log('upgrade state', await page.evaluate(() => V.selected.state + ' -> ' + V.selected.up));
  await page.evaluate(() => { for (let k = 0; k < 600; k++) step(1 / 20); });
  console.log('town hall level', await page.evaluate(() => V.buildings.find(b => b.type === 'townhall').level));

  // --- a raid, with the hero helping
  await page.evaluate(() => { centerOn(MID + 0.5, MID + 0.5); UI.cam.zoom = 0.8; });
  await page.click('#tRaid'); await page.waitForTimeout(100);
  await page.evaluate(() => { for (let k = 0; k < 300; k++) step(1 / 30); });
  await page.waitForTimeout(250); await shot('v4_raid');
  const mid = await page.evaluate(() => ({ active: V.raid.active, enemies: V.enemies.length, kills: V.kills }));
  await page.evaluate(() => { for (let k = 0; k < 2400 && V.raid.active; k++) step(1 / 30); });
  console.log('raid mid', JSON.stringify(mid), 'end', await page.evaluate(() => JSON.stringify({ active: V.raid.active, n: V.raid.n, hall: V.buildings.find(b => b.type === 'townhall').hp, state: V.state, kills: V.kills })));

  // --- world map + save/load round trip
  await page.click('#bMap'); await page.waitForTimeout(250); await shot('v5_map'); await page.keyboard.press('Escape');
  const saved = await page.evaluate(() => { saveGame(); const n = V.buildings.length, g = V.res.gold, r = V.raid.n; V.buildings = []; loadGame(); return { before: [n, Math.round(g), r], after: [V.buildings.length, Math.round(V.res.gold), V.raid.n] }; });
  console.log('save/load', JSON.stringify(saved));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
})();
