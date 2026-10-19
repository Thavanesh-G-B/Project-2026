/**
 * Headless playthrough of the harness (or any page that mounts CoreDrillGame with ?debug).
 *   NODE_PATH=<global node_modules> node tests/e2e/playtest.cjs [url] [outDir]
 * Needs `npm run dev` running and Playwright + a chromium (PLAYWRIGHT_BROWSERS_PATH).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('assert');

const URL = process.argv[2] || 'http://127.0.0.1:5174/?debug=1&aug=math,cs';
const OUT = process.argv[3] || 'e2e-out';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/404|ERR_|fonts/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  const eng = (fn) => p.evaluate(fn);
  const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const step = (m) => console.log('  ✓', m);

  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.cd-orbit');
  await shot('01-orbit');
  assert(await p.isVisible('text=Launch · 40 EN'), 'planet 1 launchable');
  assert(await p.isDisabled('.cd-planet:nth-child(2) .cd-btn-launch'), 'planet 2 locked before boss clear');
  step('orbit map renders, later planets locked');

  await p.click('text=Launch · 40 EN');
  await p.waitForSelector('.cd-canvas');
  await p.waitForTimeout(800);
  assert(await eng(() => window.__coreDrill.engine.onPad), 'starts docked');
  await shot('02-surface');
  step('run starts docked on the pad');

  await p.keyboard.down('KeyD'); await p.waitForTimeout(1000); await p.keyboard.up('KeyD');
  await p.keyboard.down('KeyS'); await p.waitForTimeout(4500); await p.keyboard.up('KeyS');
  const depth = await eng(() => window.__coreDrill.engine.depth);
  assert(depth >= 5, 'dug down (depth ' + depth + ')');
  await shot('03-digging');
  step('driving and digging works, depth ' + depth);

  // combat: spawn a crawler next to the rig and shoot it
  await eng(() => { const e = window.__coreDrill.engine; 
    const W = e.world.w, ry = Math.floor(e.y); for (let x = Math.floor(e.x); x < Math.floor(e.x) + 6; x++) e.world.tiles[ry * W + x] = 0;
    const c = e.spawnEnemy('crawler', e.x + 3, e.y); c.speed = 0; });
  await p.mouse.move(640 + 150, 360); await p.mouse.down(); await p.waitForTimeout(1500); await p.mouse.up();
  assert((await eng(() => window.__coreDrill.engine.kills)) >= 1, 'blaster killed the crawler');
  step('blaster kills enemies');

  // bomb
  const bombs = await eng(() => window.__coreDrill.engine.bombs);
  await p.keyboard.press('KeyB');
  assert((await eng(() => window.__coreDrill.engine.bombs)) === bombs - 1, 'bomb consumed');
  step('bomb placed');

  // vault flashcard
  await eng(() => { const e = window.__coreDrill.engine; e.enemies.length = 0; e.bombList.length = 0;
    e.x = 40.5; e.y = 12.4; e.vx = 0; e.vy = 0; const W = e.world.w;
    for (let y = 9; y < 16; y++) for (let x = 38; x < 43; x++) e.world.tiles[y * W + x] = 1;
    e.world.tiles[13 * W + 40] = 9; for (let y = 9; y < 13; y++) e.world.tiles[y * W + 40] = 0; });
  await p.keyboard.down('KeyS'); await p.waitForSelector('text=Reveal answer', { timeout: 6000 }); await p.keyboard.up('KeyS');
  await shot('04-vault');
  await p.click('text=Reveal answer'); await p.click('text=I got it');
  const v = await eng(() => ({ s: window.__coreDrill.engine.status, c: window.__coreDrill.engine.vaultsOpened }));
  assert.deepStrictEqual(v, { s: 'running', c: 1 });
  step('vault crate asks a flashcard and pays out');

  // override
  await eng(() => { window.__coreDrill.engine.damageRig(60); });
  await p.keyboard.press('KeyF'); await p.waitForSelector('text=ACADEMIC OVERRIDE');
  await p.click('text=Reveal answer'); await p.click('text=I got it');
  assert(!(await eng(() => window.__coreDrill.engine.overrideReady)), 'override on cooldown');
  step('flashcard override fires and goes on cooldown');

  // boss
  await eng(() => { const e = window.__coreDrill.engine; e.hull = e.stats.maxHull; e.x = 30; e.y = e.world.bossTop + 8; e.vy = 0; });
  await p.waitForTimeout(2500);
  assert(await eng(() => !!window.__coreDrill.engine.boss), 'boss awake');
  await shot('05-boss');
  await eng(() => { const e = window.__coreDrill.engine; e.hurtEnemy(e.boss, 1e6, false, false); });
  await p.waitForSelector('text=PLANET CORE SECURED');
  await shot('06-result');
  step('boss fight and victory screen');

  await p.click('text=Return to orbit');
  await p.waitForSelector('text=BOSS DOWN');
  assert(await p.isVisible('text=Launch · 60 EN'), 'Foundry-VII unlocked');
  step('boss clear unlocks the next planet');

  // death path
  await p.click('text=Launch · 60 EN'); await p.waitForTimeout(500);
  await eng(() => { window.__coreDrill.engine.damageRig(1e6); });
  await p.waitForSelector('text=RIG DESTROYED');
  await shot('07-destroyed');
  await p.click('text=Return to orbit');
  step('destroyed-rig path');

  // shop
  const before = await p.textContent('.cd-chips');
  await p.click('.cd-shop-row:first-child .cd-btn-buy');
  const after = await p.textContent('.cd-chips');
  assert(before !== after, 'scrap spent on upgrade');
  step('shop purchase');

  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('PASS: no page errors');
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
