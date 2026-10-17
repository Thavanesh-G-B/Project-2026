// Village mode: character rig, chop/fall flow, villagers, props, bars and every sound voice.
// Usage: NODE_PATH=<playwright dir> node tools/village_life_test.js <outDir>
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve('village.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await page.evaluate(() => { localStorage.clear(); newVillage(); });
  let fail = 0; const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fail++; };

  // 1. the hero looks the same from every side: same palette pixels in all 8 facings, every action draws
  const rig = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 160; const g = c.getContext('2d'); const res = { tunic: [], total: [], kinds: {} };
    for (let k = 0; k < 8; k++) {
      g.clearRect(0, 0, 160, 160); drawRig(g, { x: 80, y: 120, s: 1.8, yaw: k * Math.PI / 4, kind: 'idle', t: 1, pal: RigPal.hero, tiers: {}, tool: 'sword' });
      const d = g.getImageData(0, 0, 160, 160).data; let blue = 0, all = 0;
      for (let p = 0; p < d.length; p += 4) if (d[p + 3] > 200) { all++; if (d[p + 2] > d[p] + 40 && d[p + 2] > 120) blue++; }
      res.tunic.push(blue); res.total.push(all);
    }
    for (const kind of ['idle', 'walk', 'attack', 'chop', 'strike', 'hurt', 'carry', 'work']) {
      g.clearRect(0, 0, 160, 160); drawRig(g, { x: 80, y: 120, s: 1.8, yaw: 0.7, kind, u: 0.5, ph: 1, t: 1, pal: RigPal.hero, tiers: { head: 2, chest: 2, legs: 2 }, tool: kind === 'chop' ? 'axe' : 'sword', carry: kind === 'carry' ? 'log' : null });
      const d = g.getImageData(0, 0, 160, 160).data; let n = 0; for (let p = 3; p < d.length; p += 4) if (d[p] > 200) n++; res.kinds[kind] = n;
    }
    return res;
  });
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  check('hero tunic visible from all 8 sides', rig.tunic.every(v => v > 150), JSON.stringify(rig.tunic));
  check('hero silhouette consistent', rig.total.every(v => v > mean(rig.total) * 0.7 && v < mean(rig.total) * 1.35));
  check('all rig actions draw', Object.values(rig.kinds).every(n => n > 800), JSON.stringify(rig.kinds));

  // 2. chop: three axe hits, shake, fall, wood
  const chop = await page.evaluate(() => {
    const t = V.trees.filter(t => t.alive && Math.abs(t.i - MID) < 9 && Math.abs(t.j - MID) < 9 && Terr.has(t.i, t.j) && occAt(t.i, t.j + 2) === 0)[0];
    V.hero.i = t.i + 0.5; V.hero.j = t.j + 2.2; V.hero.path = []; const wood0 = V.res.wood; orderChop(t);
    const seen = { shake: false, chopping: false, fall: false, hits: 0 };
    for (let k = 0; k < 40 * 6; k++) { step(1 / 40); if (t.shake > 0) seen.shake = true; if (V.hero.chopping) seen.chopping = true; if (t.fall) seen.fall = true; seen.hits = Math.max(seen.hits, t.hits || 0); }
    return Object.assign(seen, { alive: t.alive, wood: V.res.wood - wood0, occ: occAt(t.i, t.j) });
  });
  check('chop flow', chop.shake && chop.chopping && chop.fall && chop.hits === 3 && !chop.alive && chop.wood >= 6 && chop.occ === 0, JSON.stringify(chop));

  // 3. villagers, props, plaza, light
  await page.evaluate(() => { for (let k = 0; k < 40 * 25; k++) step(1 / 40); });
  const life = await page.evaluate(() => ({ vill: V.villagers.length, props: Life.props.length, plaza: !!Life.plaza, acts: V.villagers.map(v => v.act).join(',') }));
  check('villagers, props and plaza exist', life.vill >= 2 && life.props >= 8 && life.plaza, JSON.stringify(life));
  const raid = await page.evaluate(() => { startRaid(); for (let k = 0; k < 40 * 8; k++) step(1 / 40); return { dusk: Life.dusk, hidden: V.villagers.filter(v => v.hidden).length, n: V.villagers.length, mode: Sfx.mode }; });
  check('raid: dusk falls, villagers take shelter, raid music', raid.dusk > 0.5 && raid.hidden >= 1 && raid.mode !== 'peace', JSON.stringify(raid));
  await page.waitForTimeout(500); await page.screenshot({ path: `${out}/life_raid.png` });
  await page.evaluate(() => { for (const e of V.enemies) e.hurt(99999, 'hero'); V.raid.queue = []; for (let k = 0; k < 40 * 4; k++) step(1 / 40); });
  const calm = await page.evaluate(() => ({ active: V.raid.active, mode: Sfx.mode, dusk: Life.dusk }));
  check('raid over: peace music returns', !calm.active && calm.mode === 'peace', JSON.stringify(calm));

  // 4. sound: every voice plays without throwing, positional sound works, mute and music toggles
  const snd = await page.evaluate(() => { Sfx.init(); return { ctx: !!Sfx.ctx }; });
  const voices = await page.evaluate(() => {
    const names = ['slash', 'hit', 'thud', 'hurt', 'jump', 'dash', 'strike', 'mine', 'chop', 'crash', 'break', 'hammer', 'place', 'pickup', 'coin', 'power', 'craft', 'upgrade', 'done', 'click', 'open', 'deny', 'step', 'arrow', 'cannon', 'mortar', 'explode', 'magic', 'cast', 'summon', 'heal', 'zombie', 'skeleton', 'die', 'horn', 'night', 'boss', 'dawn', 'cloud', 'fire'];
    const bad = []; Sfx.THROTTLE = {};
    for (const n of names) { try { Sfx._last = {}; Sfx.play(n, { vol: 0.2 }); Sfx.at(n, MID, MID); } catch (e) { bad.push(n + ':' + e.message); } }
    try { Sfx.setMuted(true); Sfx.play('hit'); Sfx.setMuted(false); Sfx.setMusicOn(false); Sfx.setMusicOn(true); for (const m of ['raid', 'boss', 'peace']) Sfx.setMusic(m, true); } catch (e) { bad.push('ctl:' + e.message); }
    return bad;
  });
  check('all sound voices run', snd.ctx && voices.length === 0, JSON.stringify(voices));
  const pan = await page.evaluate(() => { const a = Sfx.listener(MID - 6, MID + 6), b = Sfx.listener(MID + 6, MID - 6); return [a.pan, b.pan]; });
  check('positional sound pans left/right', pan[0] < 0 && pan[1] > 0, JSON.stringify(pan));

  // 5. bars: damage trail follows the hero's health and the DOM HUD fills
  const bars = await page.evaluate(() => { V.hero.hp = V.hero.maxHp * 0.25; refreshHud(); return { hero: document.querySelector('#barHero .fill').style.transform, low: document.getElementById('barHero').classList.contains('low') }; });
  check('HUD hero bar reflects health', /0\.2/.test(bars.hero) && bars.low, JSON.stringify(bars));
  await page.evaluate(() => { UI.cam.zoom = 1.5; centerOn(V.hero.i, V.hero.j); const e = new Enemy('knight', V.hero.i + 3, V.hero.j + 1, 1); V.enemies.push(e); e.hp = e.maxHp * 0.6; });
  await page.waitForTimeout(600); await page.screenshot({ path: `${out}/life_boss.png` });

  console.log(errors.length ? errors.join('\n') : 'no console errors');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})();
