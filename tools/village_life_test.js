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

  // 1. one character from every side: all eight facings and every action draw, in every outfit
  const rig = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 160; const g = c.getContext('2d'); const res = { dirs: [], kinds: {}, variants: {} };
    const one = o => { const r = Hero.draw(g, Object.assign({ x: 80, y: 130, s: 1.6, t: 1, ph: 1 }, o)); return [r._name, Math.round(r._h || 0), r._flip]; };
    for (let k = 0; k < 8; k++) res.dirs.push(one({ yaw: k * Math.PI / 4, kind: 'walk' }));
    for (const kind of ['idle', 'walk', 'carry', 'attack', 'chop', 'work', 'strike', 'hurt', 'dead']) res.kinds[kind] = one({ yaw: 0.7, kind, u: 0.5, deadT: 1, carry: kind === 'carry' ? 'log' : null });
    for (const v of ['hero', 'a1', 'a2', 'a3', 'v0', 'v1', 'v2', 'v3']) res.variants[v] = !!Hero.img[v] && !!one({ yaw: 0, kind: 'idle', variant: v })[0];
    return res;
  });
  check('hero drawn from all 8 sides (NW mirrors NE)', rig.dirs.every(([n, h]) => n && h > 70) && rig.dirs[5][0].startsWith('w_NE') && rig.dirs[5][2], JSON.stringify(rig.dirs.map(d => d[0])));
  check('all actions pick a frame', Object.values(rig.kinds).every(([n, h]) => n && h > 20), JSON.stringify(Object.fromEntries(Object.entries(rig.kinds).map(([k, v]) => [k, v[0]]))));
  check('armour and villager outfits load', Object.values(rig.variants).every(Boolean), JSON.stringify(rig.variants));

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
    const names = ['slash', 'hit', 'thud', 'hurt', 'jump', 'dash', 'strike', 'mine', 'chop', 'crash', 'break', 'hammer', 'place', 'pickup', 'coin', 'power', 'craft', 'upgrade', 'done', 'click', 'open', 'deny', 'step', 'arrow', 'cannon', 'mortar', 'explode', 'magic', 'cast', 'summon', 'heal', 'zombie', 'skeleton', 'die', 'horn', 'night', 'boss', 'dawn', 'cloud', 'fire', 'charge', 'clang', 'creak', 'stepStone', 'stepDirt'];
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

  // 6. keyboard control: D moves the hero right on screen, W up, J attacks
  await page.evaluate(() => { for (const e of V.enemies) e.dead = true; V.enemies = []; V.raid.active = false; V.raid.queue = []; V.hero.i = MID + 0.5; V.hero.j = MID + 7.5; V.hero.dead = false; V.hero.order = null; V.hero.path = []; });
  const kx = await page.evaluate(async () => {
    const x0 = isoX(V.hero.i, V.hero.j), y0 = isoY(V.hero.i, V.hero.j);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' })); for (let k = 0; k < 40; k++) step(1 / 40); const x1 = isoX(V.hero.i, V.hero.j);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' })); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); for (let k = 0; k < 40; k++) step(1 / 40); const y1 = isoY(V.hero.i, V.hero.j);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); const still = [V.hero.i, V.hero.j]; for (let k = 0; k < 10; k++) step(1 / 40);
    return { dx: x1 - x0, dy: y1 - y0, stopped: still[0] === V.hero.i && still[1] === V.hero.j, inTerr: Terr.has(Math.floor(V.hero.i), Math.floor(V.hero.j)) };
  });
  check('WASD moves the hero on screen axes and stops on release', kx.dx > 30 && kx.dy < -10 && kx.stopped && kx.inTerr, JSON.stringify(kx));

  // 7. hero panel: click the hero -> stats; target a specific enemy; mana, strike without spinning, heal, stance, armour
  await page.evaluate(() => { for (const e of V.enemies) e.dead = true; V.enemies = []; V.raid.active = false; V.hero.dead = false; V.hero.hp = V.hero.maxHp * 0.5; V.hero.mana = V.hero.maxMana; V.hero.healCd = 0; V.hero.strikeCd = 0; V.hero.strikeT = -1; V.hero.order = null; V.paused = false; UI.cam.zoom = 1.3; UI.follow = true; centerOn(V.hero.i, V.hero.j); });
  await page.waitForTimeout(250);
  const pt = await page.evaluate(() => { const r = document.getElementById('v').getBoundingClientRect(), h = V.hero; return { x: r.left + (isoX(h.i, h.j) - UI.cam.x) * UI.cam.zoom + UI.W / 2, y: r.top + (isoY(h.i, h.j) - 30 - UI.cam.y) * UI.cam.zoom + UI.H / 2 }; });
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(200);
  const panel = await page.evaluate(() => ({ sel: V.selHero, html: document.getElementById('info').innerText }));
  check('clicking the hero opens the stats panel', panel.sel && /Aldric/.test(panel.html) && /Damage per hit/i.test(panel.html) && /MP/.test(panel.html) && /Armor/i.test(panel.html), panel.html.replace(/\s+/g, ' ').slice(0, 120));
  const abil = await page.evaluate(async () => {
    const h = V.hero, out = {}; const press = a => document.querySelector(`[data-act="${a}"]`).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    const m0 = h.mana, hp0 = h.hp; press('heal'); out.heal = h.hp > hp0 && h.mana < m0;
    const e = new Enemy('zombie', h.i + 3, h.j + 1, 1); V.enemies.push(e); V.raid.active = true; await new Promise(r => setTimeout(r, 400));
    document.querySelector('[data-act="atk"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); out.target = !!(h.order && h.order.type === 'attack' && h.order.e === e);
    press('stance'); out.stance = h.stance; press('stop'); out.stopped = !h.order;
    const seen = new Set(); h.strikeCd = 0; h.mana = h.maxMana; const m1 = h.mana; heroStrike(); out.manaSpent = h.mana < m1;
    for (let k = 0; k < 24; k++) { step(1 / 40); const o = { x: 0, y: 0, s: 1, yaw: 0.6, kind: 'strike', u: Math.min(1, h.strikeT / 0.5), t: 0 }; Hero.draw(document.createElement('canvas').getContext('2d'), o); seen.add(o._name); }
    out.frames = [...seen]; h.stance = 'aggressive'; V.raid.active = false; V.enemies = [];
    V.heroLevel = 9; const base = 100; h.inv = 0; const hpA = h.hp; hurtUnit(h, base); out.armourTaken = +(hpA - h.hp).toFixed(1); V.heroLevel = 1;
    return out;
  });
  check('hero abilities: heal, specific target, stance, stop, mana-cost strike', abil.heal && abil.target && abil.stance === 'defensive' && abil.stopped && abil.manaSpent, JSON.stringify(abil));
  check('strike plays sword frames (no spinning through directions)', abil.frames.every(n => /^atk/.test(n)), JSON.stringify(abil.frames));
  check('armour reduces damage taken', abil.armourTaken < 90 && abil.armourTaken > 70, String(abil.armourTaken));

  // 8. reference-sheet buildings are used and the ground is dressed with boulders / berry bushes
  const bld = await page.evaluate(() => ({ spr: ['townhall', 'archer', 'magetower', 'cannon', 'goldmine', 'lumbercamp', 'storage', 'barracks', 'shrine'].every(t => [1, 2, 3].every(L => BART.get(t, L, 0).sprite)), wild: Life.props.filter(p => p.wild).length }));
  check('buildings draw from the sprite atlas, wild props scattered', bld.spr && bld.wild > 20, JSON.stringify(bld));

  // 9. buildings fit their footprints (no sideways spill over neighbours) and clicking a sprite selects that building
  const fit = await page.evaluate(() => {
    const bad = [];
    for (const t of Object.keys(BSPR)) for (let L = 1; L <= 3; L++) { const d = BDEF[t], s = BART.get(t, L, 0); if (s.canvas.width - 24 > (d.w + d.d) * 32 + 2) bad.push(`${t}${L}:${s.canvas.width - 24}>${(d.w + d.d) * 32}`); }
    return bad;
  });
  check('every building sprite fits inside its footprint width', fit.length === 0, JSON.stringify(fit));
  const pick = await page.evaluate(() => {
    V.res.gold = 9999; V.res.wood = 9999; for (const e of V.enemies) e.dead = true; V.enemies = [];
    UI.follow = false; document.getElementById('bFollow').classList.remove('active'); const a = buildNew('storage', MID + 5, MID - 1), c = buildNew('cannon', MID + 8, MID - 1); for (let k = 0; k < 40 * 25; k++) step(1 / 40);
    UI.cam.zoom = 1; centerOn(MID + 7, MID); const r = document.getElementById('v').getBoundingClientRect(), out = {};
    for (const t of ['storage', 'cannon']) { const b = V.buildings.find(q => q.type === t && q.i >= MID + 5); if (!b) { out[t] = 'missing'; continue; } const x = isoX(b.i + b.w / 2, b.j + b.d / 2), y = isoY(b.i + b.w / 2, b.j + b.d / 2) - 40; out[t] = [r.left + (x - UI.cam.x) * UI.cam.zoom + UI.W / 2, r.top + (y - UI.cam.y) * UI.cam.zoom + UI.H / 2]; }
    return { a, c, out };
  });
  for (const t of ['storage', 'cannon']) {
    if (!Array.isArray(pick.out[t])) { check('click selects ' + t, false, JSON.stringify(pick)); continue; }
    await page.mouse.click(pick.out[t][0], pick.out[t][1]); await page.waitForTimeout(120);
    const sel = await page.evaluate(() => V.selected && V.selected.type);
    check('clicking the ' + t + ' sprite selects it', sel === t, String(sel));
  }

  // 10. walk animation follows the ground: the stride phase advances in proportion to the distance walked
  const gait = await page.evaluate(async () => {
    V.selected = null; V.selHero = false; V.hero.dead = false; V.hero.i = MID + 0.5; V.hero.j = MID + 9.5; V.hero.path = []; UI.cam.zoom = 1; UI.follow = true; centerOn(V.hero.i, V.hero.j);
    await new Promise(r => setTimeout(r, 200)); const h = V.hero; h._ph = 0; h._lx = undefined; orderMove(MID + 9.5, MID + 9.5);
    const x0 = isoX(h.i, h.j), y0 = isoY(h.i, h.j);
    await new Promise(r => setTimeout(r, 1500));
    const d = Math.hypot(isoX(h.i, h.j) - x0, isoY(h.i, h.j) - y0);
    return { dist: Math.round(d), ph: +h._ph.toFixed(2), cycles: +(h._ph / 6.2832).toFixed(2), expected: +(d / 52).toFixed(2) };
  });
  check('stride phase tracks distance walked (no foot skating)', gait.dist > 60 && Math.abs(gait.cycles - gait.expected) < 0.35, JSON.stringify(gait));

  console.log(errors.length ? errors.join('\n') : 'no console errors');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})();
