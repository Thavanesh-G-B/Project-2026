// Bot plays 12 raids (both bosses): builds defenses, upgrades, collects. Reports per-raid results.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('file://' + path.resolve('village.html'));
  await page.waitForFunction(() => window.__ready === true);
  const res = await page.evaluate((target) => {
    try { localStorage.clear(); } catch (e) { }
    newVillage();
    const log = [], t0 = performance.now(); let maxStep = 0;
    const hall = () => V.buildings.find(b => b.type === 'townhall');
    function freeSpot(type) {
      const d = BDEF[type], h = hall(), cx = h.i + 1, cy = h.j + 1;
      const spots = [];
      for (let r = 3; r <= 11; r++) for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
        if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
        if (isRoad(i, j) && type !== 'wall') continue;
        if (!placeCheck(type, i, j)) spots.push([i, j]);
      }
      return spots[Math.floor(Math.random() * Math.min(spots.length, 6))];
    }
    function prep() {
      for (const b of V.buildings) { if (BDEF[b.type].kind === 'collector') collect(b); if (b.state === 'ruin') rebuildRuin(b); }
      for (let pass = 0; pass < 12; pass++) {
        let did = false;
        const h = hall();
        if (h.level < 3 && !upgradeCheck(h)) { upgradeBuilding(h); did = true; }
        // save up for the next Town Hall level once the basics are in place
        const hc = h.level < 3 ? BDEF.townhall.cost[h.level] : null;
        const saving = hc && V.raid.n >= 2 && countOf('archer') >= 2 && (V.res.gold < hc.gold + 60 || V.res.wood < hc.wood + 40);
        if (saving) break;
        for (const type of ['archer', 'cannon', 'magetower', 'mortar', 'barracks', 'shrine', 'storage', 'trap', 'goldmine', 'lumbercamp', 'builderhut']) {
          if (countOf(type) < maxCount(type)) { const sp = freeSpot(type); if (sp && !buildNew(type, sp[0], sp[1])) { did = true; } }
        }
        for (const b of V.buildings) if (b.state === 'built' && b.type !== 'wall' && !upgradeCheck(b)) { upgradeBuilding(b); did = true; }
        if (!did) break;
      }
      // let construction finish between raids (no raid in progress)
      for (let k = 0; k < 20 * 60 && V.buildings.some(b => b.state === 'building'); k++) step(1 / 20);
      // idle time to earn resources
      for (let k = 0; k < 20 * 30; k++) step(1 / 20);
    }
    for (let n = 1; n <= target && V.state === 'play'; n++) {
      prep();
      const startHall = hall().hp, ruins0 = V.buildings.filter(b => b.state === 'ruin').length;
      startRaid(); let t = 0, heroDown = 0, minHall = 1e9, bossSeen = '';
      while (V.raid.active && V.state === 'play' && t < 400) {
        const s0 = performance.now(); step(1 / 30); maxStep = Math.max(maxStep, performance.now() - s0); t += 1 / 30;
        if (V.hero.dead) heroDown++;
        const e = V.enemies.find(x => x.boss); if (e) bossSeen = e.type;
        minHall = Math.min(minHall, hall().hp);
        if (V.hero.strikeCd <= 0 && V.enemies.length > 3) heroStrike();
        if (Math.floor(t * 30) % 90 === 0 && V.hero.hp < V.hero.maxHp * 0.4 && V.hero.dead === false) V.hero.hp += 0;
        if (![V.hero.i, V.hero.j].every(Number.isFinite) || V.enemies.some(x => !Number.isFinite(x.i) || !Number.isFinite(x.j))) return { nan: true, log };
      }
      log.push({ n, secs: Math.round(t), hallMin: Math.round(minHall), ruins: V.buildings.filter(b => b.state === 'ruin').length - ruins0, heroDownTicks: heroDown, boss: bossSeen, res: [Math.round(V.res.gold), Math.round(V.res.wood)], hallLv: hall().level, b: V.buildings.length, guards: V.guards.length, state: V.state, active: V.raid.active, enemiesLeft: V.enemies.length });
    }
    return { log, maxStepMs: +maxStep.toFixed(2), totalMs: Math.round(performance.now() - t0), state: V.state, kills: V.kills, heroLv: V.heroLevel };
  }, 12);
  if (res.log) for (const l of res.log) console.log(JSON.stringify(l));
  console.log(JSON.stringify({ ...res, log: undefined }));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  await browser.close();
})();
