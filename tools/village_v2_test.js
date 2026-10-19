// Village v2 checks: bigger map and sparser forest, research, hero training, Battle Cry, Tesla coil, market, options, difficulty.
// Usage: NODE_PATH=<playwright dir> node tools/village_v2_test.js <outDir>
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const out = process.argv[2] || '/tmp';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve('village.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => { localStorage.clear(); newVillage(); });

  // ---- map and forest
  const m = await ev(() => {
    const dense = V.trees.length / (GN * GN), nearHall = V.trees.filter(t => Math.max(Math.abs(t.i - MID), Math.abs(t.j - MID)) < 9).length;
    return { GN, levels: TERR_R.length, trees: V.trees.length, dense: +dense.toFixed(3), nearHall, strips: Ground.strips.length, maxStrip: Math.max(...Ground.strips.map(s => s.canvas.width * s.canvas.height)) };
  });
  console.log('map', JSON.stringify(m));
  assert(m.GN >= 80 && m.levels === 5, 'bigger map with five stages');
  assert(m.dense < 0.15, 'forest is sparse (' + m.dense + ' trees per tile)');
  assert(m.nearHall === 0, 'clearing around the hall');
  assert(m.maxStrip < 16.7e6, 'every ground canvas stays under the iOS canvas limit');

  // ---- research needs an academy
  const r1 = await ev(() => { V.res.gold = 5000; V.res.wood = 5000; const a = techCheck('prospect'); const ac = addBuilding('academy', MID + 6, MID - 8); const b = techCheck('prospect'); return [a, b, ac.state]; });
  assert(/Academy/.test(r1[0]) && r1[1] === null, 'research gated by an academy: ' + r1);
  const r2 = await ev(() => {
    const gm = V.buildings.find(b => b.type === 'goldmine'); gm.prod = 0; step(1); const base = gm.prod;
    researchTech('prospect'); gm.prod = 0; step(1); const boosted = gm.prod;
    const capBefore = caps().gold; researchTech('granary'); const capAfter = caps().gold;
    const hall = V.buildings.find(b => b.type === 'townhall'), hp0 = hall.maxHp; researchTech('masonry');
    return { ratio: boosted / base, capRatio: capAfter / capBefore, hpRatio: hall.maxHp / hp0, lvl: tech('prospect') };
  });
  console.log('research', JSON.stringify(r2));
  assert(Math.abs(r2.ratio - 1.12) < 0.02 && Math.abs(r2.capRatio - 1.12) < 0.02 && Math.abs(r2.hpRatio - 1.08) < 0.02, 'research effects apply');
  const gate = await ev(() => { V.tech.prospect = 2; return techCheck('prospect'); });
  assert(/Town Hall level 2/.test(gate), 'third level needs a bigger hall: ' + gate);

  // ---- hero training and Battle Cry
  const h1 = await ev(() => {
    V.heroLevel = 5; const d0 = heroStats().dmg, sp0 = skillPoints(); trainHero('might'); trainHero('might'); trainHero('vigor'); trainHero('mind'); trainHero('fleet');
    const s = heroStats(); const none = trainHero('might');
    return { d0, d1: s.dmg, sp0, sp1: skillPoints(), hp: s.maxHp, speed: s.speed, none };
  });
  console.log('train', JSON.stringify(h1));
  assert(h1.d1 > h1.d0 && h1.sp0 === 4 && h1.sp1 === 0 && /skill points/.test(h1.none), 'skill points are spent and run out');
  const c1 = await ev(() => {
    V.heroLevel = 2; const early = heroCry(); V.heroLevel = 5; V.hero.mana = V.hero.maxMana; const d0 = heroStats().dmg;
    const g = { i: V.hero.i + 1, j: V.hero.j, hp: 10, maxHp: 10, id: 999, home: 0 }; V.guards.push(g);
    const ok = heroCry(); const d1 = heroStats().dmg; const again = heroCry(); V.guards.pop();
    return { early, ok, again, ratio: d1 / d0, cryT: V.hero.cryT, guardBuff: g.cryT };
  });
  console.log('cry', JSON.stringify(c1));
  assert(c1.early === false && c1.ok === true && c1.again === false && c1.ratio > 1.3 && c1.guardBuff > 0, 'Battle Cry works once per cooldown');

  // ---- Tesla coil chains between enemies
  const t1 = await ev(() => {
    V.hero.dead = true; const t = addBuilding('tesla', MID + 8, MID + 8), foes = [];
    for (let k = 0; k < 4; k++) { const e = new Enemy('zombie', MID + 8 + 3 + k * 1.2, MID + 9, 1); V.enemies.push(e); foes.push(e); }
    let arc = 0; for (let k = 0; k < 40; k++) { step(0.05); arc = Math.max(arc, V.arcs.length); }
    return { arc, hurt: foes.filter(e => e.hp < e.maxHp).length, pts: arc };
  });
  console.log('tesla', JSON.stringify(t1));
  assert(t1.arc > 0 && t1.hurt >= 2, 'Tesla coil zaps several enemies');
  await ev(() => { V.enemies = []; V.hero.dead = false; });

  // ---- market and options
  const mk = await ev(() => {
    const noMarket = trade('sellWood'); addBuilding('market', MID - 9, MID + 6); V.res.wood = 400; V.res.gold = 100;
    const g0 = V.res.gold, w0 = V.res.wood; const e = trade('sellWood', 2); return { noMarket, dg: V.res.gold - g0, dw: V.res.wood - w0, e };
  });
  assert(/Trading Post/.test(mk.noMarket) && mk.dg === 110 && mk.dw === -200 && mk.e === null, 'market trades: ' + JSON.stringify(mk));
  const o1 = await ev(() => {
    SET.auto = true; const gm = V.buildings.find(b => b.type === 'goldmine'); V.res.gold = 10; gm.prod = BDEF.goldmine.store[gm.level - 1] - 0.01; step(0.1);
    SET.speed = 2; saveSettings(); SET.speed = 1; loadSettings();
    SET.diff = 'brutal'; V.raid.n = 1; V.raid.lanes = [0]; const e = spawnEnemy('zombie'); const hp = e.maxHp; SET.diff = 'easy'; const e2 = spawnEnemy('zombie'); const r = { collected: V.res.gold > 10, speed: SET.speed, brutal: hp, easy: e2.maxHp }; V.enemies = []; SET.diff = 'normal'; SET.auto = false; SET.speed = 1; saveSettings(); return r;
  });
  console.log('options', JSON.stringify(o1));
  assert(o1.collected && o1.speed === 2 && o1.brutal > o1.easy * 1.8, 'options apply');

  // ---- UI: research + options panels, HUD
  await ev(() => { V.heroLevel = 6; V.hero.cryCd = 0; document.getElementById('tResearch').click(); });
  assert(await page.isVisible('#research.show .tech'), 'research panel opens');
  await page.screenshot({ path: out + '/v2-research.png' });
  await ev(() => closeResearch()); await ev(() => document.getElementById('tOptions').click());
  assert(await page.isVisible('#options.show .orow'), 'options panel opens'); await ev(() => closeOptions());
  const hud = await ev(() => { refreshHud(); return { name: document.getElementById('hudName').textContent, abil: document.querySelectorAll('.hudabil button').length, income: document.getElementById('hudInc').textContent }; });
  assert(hud.abil === 3 && /min/.test(hud.income), 'HUD shows abilities and income: ' + JSON.stringify(hud));

  // ---- save / load keeps research and training
  const sl = await ev(() => { saveGame(); const a = [JSON.stringify(V.tech), JSON.stringify(V.train)]; loadGame(); return [a, [JSON.stringify(V.tech), JSON.stringify(V.train)]]; });
  assert.deepStrictEqual(sl[0], sl[1], 'research and training survive a reload');

  // ---- the whole island: expand to the last stage, a raid from 30 tiles out, frame cost at the widest zoom
  const ex = await ev(() => {
    V.res.gold = V.res.wood = 99999; const hall = V.buildings.find(b => b.type === 'townhall'); hall.level = 3; hall.state = 'built'; let n = 0;
    while (expandInfo()) { V.res.gold = V.res.wood = 99999; V.tech.granary = 5; if (expandMap()) break; n++; }
    return { n, r: Terr.r, level: Terr.level, sp: Terr.spawnPoints()[0] };
  });
  console.log('expand', JSON.stringify(ex));
  assert(ex.n === 4 && ex.r >= 42, 'all four expansions open the whole island');
  const ch = await ev(() => {
    const chests = Life.props.filter(p => p.type === 'chest'); V.res.gold = 100; const p = chests[0]; V.hero.dead = false; V.hero.i = p.i + 0.5; V.hero.j = p.j + 0.5; step(0.05);
    const first = V.res.gold; V.hero.i = p.i + 0.6; step(0.05);
    return { n: chests.length, opened: p.open, gold: first, again: V.res.gold, looted: V.looted.length };
  });
  console.log('chests', JSON.stringify(ch));
  assert(ch.n >= 8 && ch.opened && ch.gold > 150 && ch.again === ch.gold && ch.looted === 1, 'treasure chests open once');
  const raid = await ev(() => {
    V.res.gold = 5000; V.res.wood = 5000; for (const [t, di, dj] of [['archer', 3, 4], ['cannon', -4, 4], ['tesla', 5, -4]]) { const b = addBuilding(t, MID + di, MID + dj); }
    startRaid(); let steps = 0, reached = 0; for (; steps < 40 * 90 && V.raid.active; steps++) step(1 / 40); return { steps, active: V.raid.active, kills: V.kills, state: V.state };
  });
  console.log('raid at full size', JSON.stringify(raid));
  assert(raid.state === 'play', 'village survives a raid on the big map');
  const perf = await ev(() => { UI.cam.zoom = 0.3; centerOn(MID, MID); UI.follow = false; const t0 = performance.now(); for (let k = 0; k < 20; k++) render(performance.now()); return (performance.now() - t0) / 20; });
  console.log('render ms/frame at the widest zoom (software GL):', perf.toFixed(1));
  await page.waitForTimeout(300); await page.screenshot({ path: out + '/v2-wide.png' });
  assert(errors.length === 0, 'no console errors: ' + errors.join('; '));
  console.log('village v2 checks passed'); await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
