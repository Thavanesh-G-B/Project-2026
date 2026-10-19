/**
 * Headless playthrough of the harness (or any page that mounts CoreDrillGame with ?debug).
 *   NODE_PATH=<global node_modules> node tests/e2e/playtest.cjs [url] [outDir]
 * Needs `npm run dev` running (or the built core-drill.html via file://) and Playwright + a chromium.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('assert');

const URL = process.argv[2] || 'http://127.0.0.1:5174/?debug=1&aug=math,cs&fresh=1';
const OUT = process.argv[3] || 'e2e-out';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/404|ERR_|fonts/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  const ev = (fn, arg) => p.evaluate(fn, arg);
  const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const step = (m) => console.log('  ✓', m);
  const E = '(window.__coreDrill.engine)';

  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.cd-orbit');
  await shot('01-orbit');
  assert((await p.locator('.cd-planet').count()) === 5, 'five planets on the star map');
  assert(await p.isVisible('text=Launch · 40 EN'), 'planet 1 launchable');
  assert(await p.isDisabled('.cd-planet:nth-child(2) .cd-btn-launch'), 'planet 2 locked before boss clear');
  assert((await p.locator('.cd-shop-row').count()) === 8, 'eight rig upgrades in the shop');
  step('orbit map: 5 planets, 8 upgrades, later planets locked');

  await p.click('text=Launch · 40 EN');
  await p.waitForSelector('.cd-canvas');
  await p.waitForTimeout(900);
  assert(await ev(() => window.__coreDrill.engine.onPad), 'starts docked');
  await shot('02-surface');
  step('run starts docked on the pad');

  // dig down beside the pad
  await p.keyboard.down('KeyD'); await p.waitForTimeout(900); await p.keyboard.up('KeyD');
  await p.keyboard.down('KeyS'); await p.waitForTimeout(4500); await p.keyboard.up('KeyS');
  const depth = await ev(() => window.__coreDrill.engine.depth);
  assert(depth >= 5, 'dug down (depth ' + depth + ')');
  step('driving and digging works, depth ' + depth);

  // a mine level: teleport into the first drift and look at it
  await ev(() => { const e = window.__coreDrill.engine; const w = e.world; let cx = 30; for (let x = 2; x < 58; x++) if (w.tiles[24 * w.w + x] === 0) { cx = x; break; } e.x = cx + 6.5; e.y = 24.6; e.vy = 0; e.vx = 0; });
  await p.waitForTimeout(900);
  await shot('03-drift');
  step('abandoned-mine drift renders');

  // fog of war: the far corner of the screen is black underground
  const lum = await ev(() => {
    const c = document.querySelector('.cd-canvas'); const g = c.getContext('2d');
    const d = g.getImageData(4, 4, 6, 6).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4) / 3;
  });
  assert(lum < 12, 'screen corner is dark underground (lum ' + lum.toFixed(1) + ')');
  step('fog of war hides everything beyond the light');

  // combat: carve a lane, spawn a mite, shoot it
  await ev(() => { const e = window.__coreDrill.engine; const W = e.world.w; for (const s of e.world.spawners) s.done = true; e.enemies.length = 0;
    const ry = Math.floor(e.y); for (let x = Math.floor(e.x); x < Math.floor(e.x) + 7; x++) e.world.tiles[ry * W + x] = 0;
    const c = e.spawnEnemy('mite', e.x + 3, e.y); c.speed = 0; c.shootT = 99; });
  const cr = await ev(() => { const r = document.querySelector('.cd-canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(cr.x + 150, cr.y); await p.mouse.down(); await p.waitForTimeout(1500); await p.mouse.up();
  assert((await ev(() => window.__coreDrill.engine.kills)) >= 1, 'blaster killed the mite');
  step('blaster kills enemies');

  const bombs = await ev(() => window.__coreDrill.engine.bombs);
  await p.keyboard.press('KeyB');
  assert((await ev(() => window.__coreDrill.engine.bombs)) === bombs - 1, 'bomb consumed');
  step('bomb placed');

  // trader: place one on the rig, press E, buy fuel
  await ev(() => { const e = window.__coreDrill.engine; e.enemies.length = 0; e.world.merchants.push({ x: e.x, y: e.y }); e.bankedScrap = 200; e.fuel = 20; });
  await p.waitForTimeout(250);
  await p.keyboard.press('KeyE');
  await p.waitForSelector('text=DERELICT TRADER');
  await shot('04-trader');
  await p.click('.cd-offer >> nth=0');
  assert((await ev(() => window.__coreDrill.engine.fuel)) > 60, 'bought fuel');
  await p.click('text=Leave');
  assert((await ev(() => window.__coreDrill.engine.status)) === 'running');
  step('trader sells fuel for banked scrap');

  // vault flashcard
  await ev(() => { const e = window.__coreDrill.engine; e.enemies.length = 0; const W = e.world.w; const x = Math.floor(e.x), y = Math.floor(e.y) + 1;
    e.world.tiles[y * W + x] = 9; });
  await p.keyboard.down('KeyS'); await p.waitForSelector('text=Reveal answer', { timeout: 6000 }); await p.keyboard.up('KeyS');
  await shot('05-vault');
  await p.click('text=Reveal answer'); await p.click('text=I got it');
  assert.deepStrictEqual(await ev(() => ({ s: window.__coreDrill.engine.status, c: window.__coreDrill.engine.vaultsOpened })), { s: 'running', c: 1 });
  step('vault crate asks a flashcard and pays out');

  // override
  await ev(() => { window.__coreDrill.engine.damageRig(60); });
  await p.keyboard.press('KeyF'); await p.waitForSelector('text=ACADEMIC OVERRIDE');
  await p.click('text=Reveal answer'); await p.click('text=I got it');
  assert(!(await ev(() => window.__coreDrill.engine.overrideReady)), 'override on cooldown');
  step('flashcard override fires and goes on cooldown');

  // core boss -> warp-or-stay -> stay
  await ev(() => { const e = window.__coreDrill.engine; e.hull = e.stats.maxHull; const s = e.world.bossSites[0]; e.x = (s.left + s.right) / 2; e.y = s.bottom - 0.5; e.vy = 0; });
  await p.waitForTimeout(2800);
  assert(await ev(() => !!window.__coreDrill.engine.boss), 'boss awake');
  await shot('06-boss');
  await ev(() => { const e = window.__coreDrill.engine; e.hurtEnemy(e.boss, 1e9, false, false); });
  await p.waitForSelector('text=is offline');
  await shot('07-choice');
  assert(await p.isVisible('text=Warp to Foundry-VII'), 'warp option offered');
  await p.click('text=Stay on Mainframe-IV');
  assert((await ev(() => window.__coreDrill.engine.status)) === 'running');
  assert((await ev(() => window.__coreDrill.engine.planet.id)) === 1);
  step('core boss offers warp-or-stay; staying keeps the run going');

  // guardian boss deeper on the same planet pays out with no second prompt
  await ev(() => { const e = window.__coreDrill.engine; e.hull = e.stats.maxHull; const s = e.world.bossSites[1]; e.x = (s.left + s.right) / 2; e.y = s.bottom - 0.5; e.vy = 0; });
  await p.waitForTimeout(2800);
  await ev(() => { const e = window.__coreDrill.engine; e.hurtEnemy(e.boss, 1e9, false, false); });
  await p.waitForTimeout(500);
  assert((await ev(() => window.__coreDrill.engine.status)) === 'running');
  assert((await ev(() => window.__coreDrill.engine.bossesDown)) === 2);
  step('guardian boss: two bosses down, no second prompt');

  // end the run
  await ev(() => { window.__coreDrill.engine.finish('recalled'); });
  await p.waitForSelector('text=EXPEDITION COMPLETE');
  await shot('08-result');
  await p.click('text=Return to orbit');
  await p.waitForSelector('text=CORE BOSS DOWN');
  assert(await p.isVisible('text=Launch · 60 EN'), 'Foundry-VII unlocked');
  step('results screen; boss clear unlocks the next planet');

  // second run: warp path and death path
  await p.click('text=Launch · 60 EN'); await p.waitForTimeout(500);
  assert((await ev(() => window.__coreDrill.engine.planet.id)) === 2);
  await ev(() => { const e = window.__coreDrill.engine; e.hull = e.stats.maxHull; });
  await ev(() => { window.__coreDrill.engine.damageRig(1e6); });
  await p.waitForSelector('text=RIG DESTROYED');
  await shot('09-destroyed');
  await p.click('text=Return to orbit');
  step('destroyed-rig path');

  // shop: lamp upgrade
  const before = await p.textContent('.cd-chips');
  await p.click('.cd-shop-row:nth-child(7) .cd-btn-buy');
  assert(before !== (await p.textContent('.cd-chips')), 'scrap spent on the headlamp');
  step('shop purchase');

  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('PASS: no page errors');
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
