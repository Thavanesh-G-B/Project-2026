// Scripted scenarios: night + enemies, bosses, mining/placing, crafting UI. Writes screenshots to outDir.
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve('index.html'));
  await page.waitForFunction(() => typeof G !== 'undefined' && G.state === 'title');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const shot = n => page.screenshot({ path: `${out}/${n}.png` });

  // 1. night with a few undead around the player
  await page.evaluate(() => {
    G.clock = DAY_LEN * 0.8; const p = G.player;
    G.enemies.push(new Enemy('zombie', p.x + 120, p.y, 1), new Enemy('skeleton', p.x + 200, p.y, 1), new Enemy('necro', p.x - 220, p.y, 1), new Enemy('zombie', p.x - 90, p.y, 1));
    G.player.mana = 100;
  });
  await page.waitForTimeout(2500); await shot('10_night');
  console.log('t after night shot', await page.evaluate(() => JSON.stringify({ t: G.time, es: G.enemies.map(e => [e.type, Math.round(e.x - G.player.x)]) })));
  // fight: face right, slash repeatedly
  for (let i = 0; i < 6; i++) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(450); }
  await shot('11_fight');

  // 2. mining + placing: aim the mouse at exact tiles relative to the player
  await page.evaluate(() => { G.enemies = []; });
  const aim = async (dx, dy) => { // tile offset from the ground tile under the player's feet
    const pt = await page.evaluate(([dx, dy]) => { const tx = Math.floor(G.player.x / T) + dx, ty = Math.floor((G.player.y + 1) / T) + dy;
      return { x: tx * T + 16 - G.cam.x, y: ty * T + 16 - G.cam.y, id: G.world.get(tx, ty) }; }, [dx, dy]);
    await page.mouse.move(pt.x, pt.y); return pt;
  };
  const t0 = await aim(2, 0);
  await page.mouse.down(); await page.waitForTimeout(1000); await page.mouse.up(); await page.waitForTimeout(500);
  console.log('mined tile id', t0.id, 'inventory', await page.evaluate(() => JSON.stringify({ dirt: G.player.inv_.dirt, stone: G.player.inv_.stone })));
  await page.evaluate(() => { G.player.inv_.dirt = 5; });
  // pick an empty tile beside the player that touches solid ground, so the check works on any world seed
  const cand = await page.evaluate(() => { const px = Math.floor(G.player.x / T), py = Math.floor((G.player.y + 1) / T);
    for (const [dx, dy] of [[1, -1], [-1, -1], [2, -1], [-2, -1], [1, 0], [-1, 0]]) {
      const x = px + dx, y = py + dy;
      if (G.world.get(x, y) === 0 && (G.world.solid(x, y + 1) || G.world.solid(x + 1, y) || G.world.solid(x - 1, y))) return [dx, dy];
    } return null; });
  const t1 = await aim(cand[0], cand[1]);
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(250); await page.mouse.up({ button: 'right' });
  console.log('placed: dirt left', await page.evaluate(() => G.player.inv_.dirt), '(was target air:', t1.id === 0, ')');

  // 3. Cursed Knight boss
  await page.evaluate(() => { G.enemies = []; G.clock = DAY_LEN * 0.8; G.nightNum = 2; G.nightStarted = true; spawnBoss('knight'); const b = G.enemies[0]; b.x = G.player.x + 160; b.y = G.player.y; });
  await page.waitForTimeout(2200); await shot('12_knight');
  await page.waitForTimeout(1500); await shot('13_knight2');
  // 4. Necromancer King
  await page.evaluate(() => { G.enemies = []; G.projectiles = []; spawnBoss('king'); G.player.hp = 100; });
  await page.waitForTimeout(3500); await shot('14_king');
  // 5. craft menu
  await page.evaluate(() => { Object.assign(G.player.inv_, { iron: 20, gold: 10, crystal: 10, wood: 10, coin: 30, stone: 10 }); });
  await page.keyboard.press('KeyC'); await page.waitForTimeout(200); await shot('15_craft');
  await page.keyboard.press('Enter'); await page.keyboard.press('KeyC');
  // 6. underground
  await page.evaluate(() => { G.enemies = []; G.projectiles = []; G.clock = DAY_LEN * 0.2; let x = Math.floor(G.player.x / T), y = G.world.surf[x] + 20; G.world.carveCircle(x, y, 4); G.player.x = x * T + 16; G.player.y = (y + 3) * T; });
  await page.waitForTimeout(1200); await shot('16_cave');
  console.log(JSON.stringify(await page.evaluate(() => ({ state: G.state, hp: G.player.hp, enemies: G.enemies.length, gear: G.player.gear }))));
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
