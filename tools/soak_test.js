// Accelerated soak test: runs the simulation headlessly (no rendering) with a simple bot,
// and checks death/victory/vault flows. Reports exceptions, NaNs and enemy counts.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('file://' + path.resolve('index.html'));
  await page.waitForFunction(() => typeof G !== 'undefined' && G.state === 'title');
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);

  const res = await page.evaluate(() => {
    const log = { maxEnemies: 0, nan: false, nights: 0, deaths: 0, minHp: 100, boss: [] };
    const p = () => G.player;
    // bot: face nearest enemy, slash, keep hp up; invulnerable-ish to reach late nights
    for (let step = 0; step < 60 * 60 * 14; step++) { // 14 simulated minutes
      const pl = p();
      G.input.left = G.input.right = false;
      const near = G.enemies.filter(e => !e.dying).sort((a, b) => Math.abs(a.x - pl.x) - Math.abs(b.x - pl.x))[0];
      if (near) {
        G.mouseWorld.x = near.x; G.mouseWorld.y = near.y;
        if (Math.abs(near.x - pl.x) > 55) { if (near.x > pl.x) G.input.right = true; else G.input.left = true; }
        if (step % 20 === 0) G.input.attackPressed = true;
        if (step % 200 === 0) G.input.dashPressed = true;
      }
      if (pl.hp < 40 && pl.inv_.hpPot > 0 && step % 30 === 0) pl.use('hpPot');
      if (pl.hp < 25) pl.hp = 60;            // keep the bot alive for the soak
      if (pl.dead) { log.deaths++; pl.dead = false; pl.hp = 100; }
      if (G.state !== 'play' && G.state !== 'win') G.state = 'play';
      pl.inv_.hpPot = Math.max(pl.inv_.hpPot, 2);
      G.input.jump = step % 90 < 8;
      if (step % 90 === 0) G.input.jumpPressed = true;
      update(1 / 60); endFrame();
      log.maxEnemies = Math.max(log.maxEnemies, G.enemies.length);
      log.minHp = Math.min(log.minHp, pl.hp);
      if (![pl.x, pl.y, pl.hp, pl.mana].every(Number.isFinite)) { log.nan = true; break; }
      if (G.enemies.some(e => !Number.isFinite(e.x) || !Number.isFinite(e.y))) { log.nan = true; break; }
      if (G.nightNum > log.nights) { log.nights = G.nightNum; log.boss.push([G.nightNum, G.bossAlive ? G.bossAlive.type : null]); }
    }
    log.final = { clock: Math.round(G.clock), nightNum: G.nightNum, kills: G.kills, score: G.score, state: G.state, enemies: G.enemies.length, pickups: G.pickups.length, particles: G.particles.length, proj: G.projectiles.length };
    return log;
  });
  console.log('soak:', JSON.stringify(res));

  // death flow
  await page.evaluate(() => { G.state = 'play'; G.player.hurt(9999, G.player.x - 10); });
  await page.waitForTimeout(3500);
  console.log('after death state =', await page.evaluate(() => G.state));
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  console.log('after restart state =', await page.evaluate(() => G.state + ' hp=' + G.player.hp));

  // victory flow: kill the king
  await page.evaluate(() => { spawnBoss('king'); const k = G.enemies.find(e => e.type === 'king'); k.hurt(99999, 1); });
  await page.waitForTimeout(3800);
  console.log('after king death state =', await page.evaluate(() => G.state));
  await page.screenshot({ path: (process.argv[2] || '/tmp') + '/20_victory.png' });
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);

  // vault flow
  const v = await page.evaluate(() => {
    const vt = G.world.vaults[0]; const d = vt.door;
    G.player.x = d.x * T + 16 + (d.x < vt.x ? -40 : 40); G.player.y = (d.y + 1) * T - 0.01; G.player.inv_.key = 1; G.world.carveCircle(d.x, d.y, 4);
    tryInteract(); return { opened: vt.opened, door: G.world.get(d.x, d.y), pickups: G.pickups.length, key: G.player.inv_.key };
  });
  console.log('vault:', JSON.stringify(v));
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
})();
