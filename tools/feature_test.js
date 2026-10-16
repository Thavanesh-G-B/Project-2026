// Armor, fall damage and walk-cycle checks. Usage: NODE_PATH=<playwright dir> node tools/feature_test.js <outDir>
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve('index.html'));
  await page.waitForFunction(() => typeof G !== 'undefined' && G.state === 'title');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);

  // --- walk cycle: capture the player over a full stride
  await page.evaluate(() => { G.clock = 1; });
  await page.keyboard.down('KeyD');
  const clip = async () => { const b = await page.evaluate(() => ({ x: G.player.x - G.cam.x - 50, y: G.player.y - G.cam.y - 90 })); return { x: Math.max(0, b.x), y: Math.max(0, b.y), width: 100, height: 110 }; };
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(95); await page.screenshot({ path: `${out}/walk_${i}.png`, clip: await clip() }); }
  await page.keyboard.up('KeyD');

  // --- armor: craft pieces through the real crafting code and check defense / damage
  const r = await page.evaluate(() => {
    const p = G.player; Object.assign(p.inv_, { iron: 40, gold: 40, crystal: 40, wood: 10 });
    const names = [];
    for (const n of ['Iron Helmet', 'Iron Chestplate', 'Iron Leggings']) { craft(RECIPES.find(r => r.name === n)); }
    const iron = { def: p.defense, red: armorReduction(p.armor) };
    for (const n of ['Gold Helmet', 'Crystal Chestplate']) craft(RECIPES.find(r => r.name === n));
    const mixed = { def: p.defense, armor: { ...p.armor } };
    p.hp = 100; p.inv = 0; p.hurt(20, p.x - 5);
    return { iron, mixed, hpAfterHit: p.hp, resources: { iron: p.inv_.iron, gold: p.inv_.gold, crystal: p.inv_.crystal } };
  });
  console.log('armor', JSON.stringify(r));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { G.player.face = 1; });
  await page.screenshot({ path: `${out}/armor_mixed.png`, clip: await clip() });
  await page.evaluate(() => { for (const s of ['head', 'chest', 'legs']) G.player.armor[s] = 3; });
  await page.waitForTimeout(100); await page.screenshot({ path: `${out}/armor_crystal.png`, clip: await clip() });
  await page.evaluate(() => { for (const s of ['head', 'chest', 'legs']) G.player.armor[s] = 2; });
  await page.waitForTimeout(100); await page.screenshot({ path: `${out}/armor_gold.png`, clip: await clip() });
  await page.evaluate(() => { for (const s of ['head', 'chest', 'legs']) G.player.armor[s] = 1; });
  await page.waitForTimeout(100); await page.screenshot({ path: `${out}/armor_iron.png`, clip: await clip() });
  await page.keyboard.press('KeyC'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/craft_armor.png` });
  await page.keyboard.press('KeyC');

  // --- fall damage
  const fall = async (tiles) => page.evaluate((tiles) => {
    const p = G.player, w = G.world, tx = Math.floor(p.x / T);
    p.hp = 100; p.inv = 0; p.dead = false; p.hurtT = 0;
    // open a shaft above solid floor and drop the player from `tiles` tiles up
    const floor = w.surf[tx] + 14;
    for (let y = floor - tiles - 2; y < floor; y++) for (let dx = -1; dx <= 1; dx++) w.set(tx + dx, y, TID.AIR);
    for (let dx = -1; dx <= 1; dx++) w.set(tx + dx, floor, TID.STONE);
    p.x = tx * T + 16; p.y = (floor - tiles) * T; p.vx = 0; p.vy = 0;
    p.armor = { head: 3, chest: 3, legs: 3 };      // armor must NOT soften falls
    for (let i = 0; i < 240; i++) { G.input.left = G.input.right = false; update(1 / 60); endFrame(); if (p.onGround && p.y >= floor * T - 2) break; }
    for (let i = 0; i < 20; i++) { update(1 / 60); endFrame(); }
    return Math.round(100 - p.hp);
  }, tiles);
  const dmg = {};
  for (const t of [2, 3, 4, 6, 10, 16]) dmg[t] = await fall(t);
  console.log('fall damage by drop height (tiles):', JSON.stringify(dmg));
  // jumping must never hurt: full-height jump onto flat ground
  const jump = await page.evaluate(() => { const p = G.player; p.hp = 100; p.armor = { head: 0, chest: 0, legs: 0 }; p.inv = 0;
    for (let k = 0; k < 6; k++) { G.input.jump = true; G.input.jumpPressed = true; for (let i = 0; i < 90; i++) { update(1 / 60); endFrame(); G.input.jump = i < 20; } } return p.hp; });
  console.log('hp after repeated jumps:', jump);
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
