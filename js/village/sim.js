'use strict';
// Village mode, part 4: simulation (buildings, pathfinding, hero, guards, enemies, raids, saving).
const SAVE_KEY = 'ashen-hollow-village-v1';

const V = {
  seed: 1, res: { gold: 300, wood: 200 }, buildings: [], trees: [], occ: new Int16Array(GN * GN),
  uidn: 0, selHero: false, selEnemy: null, hero: null, guards: [], villagers: [], input: { x: 0, y: 0 }, hitstop: 0, slashFx: [], enemies: [], proj: [], parts: [], texts: [], rings: [],
  raid: { n: 1, active: false, queue: [], spawnT: 0, lanes: [], killed: 0, bestN: 0 },
  heroLevel: 1, heroXp: 0, nextId: 1, time: 0, state: 'play', paused: false, kills: 0, selected: null, shake: 0,
  cb: { toast() { }, changed() { }, banner() { }, expanded() { } },   // UI hooks
};
const tileOf = (v) => Math.floor(v);
const occAt = (i, j) => (inGrid(i, j) ? V.occ[j * GN + i] : -2);
const bById = id => V.buildings.find(b => b.id === id);
const toast = (m) => V.cb.toast(m);
const sfxAt = (name, i, j) => Sfx.at(name, i, j);
// turn a unit to look at a point on the map (tile coords)
function lookAt(u, ti, tj) { const dx = ti - u.i, dy = tj - u.j, l = Math.hypot(dx, dy); if (l > 0.01) { u.fdir = { x: dx / l, y: dy / l }; u.face = (dx - dy) >= 0 ? 1 : -1; } }

// ---------------------------------------------------------------- resources
function caps() {
  let g = 0, w = 0;
  for (const b of V.buildings) {
    if (b.state === 'ruin') continue;
    const d = BDEF[b.type];
    if (b.type === 'townhall' || b.type === 'storage') { const c = d.cap[b.level - 1]; g += c; w += c; }
  }
  return { gold: g, wood: w };
}
function addRes(kind, n) {
  const c = caps()[kind];
  const before = V.res[kind];
  V.res[kind] = Math.min(c, V.res[kind] + n);
  return V.res[kind] - before;
}
const canAfford = cost => !cost || Object.keys(cost).every(k => V.res[k] >= cost[k]);
const pay = cost => { for (const k in cost) V.res[k] -= cost[k]; };
const builderCount = () => 1 + V.buildings.filter(b => b.type === 'builderhut' && b.state === 'built').length;
const busyBuilders = () => V.buildings.filter(b => b.state === 'building').length;

// ---------------------------------------------------------------- buildings
function setOcc(b, v) {
  for (let j = b.j; j < b.j + b.d; j++) for (let i = b.i; i < b.i + b.w; i++) if (inGrid(i, j)) V.occ[j * GN + i] = v;
}
function addBuilding(type, i, j, opt) {
  const d = BDEF[type], o = opt || {};
  const b = {
    id: V.nextId++, type, i, j, w: d.w, d: d.d, level: o.level || 1, state: o.state || 'built', hp: 0, maxHp: 0,
    buildT: o.buildT || 0, buildTotal: o.buildTotal || 0, up: o.up || 0, prod: o.prod || 0, cd: 0, aim: 0.8, armed: true, flash: 0, guardT: 0, rubble: false,
  };
  b.maxHp = d.hp[b.level - 1]; b.hp = o.hp !== undefined ? o.hp : b.maxHp;
  V.buildings.push(b);
  if (b.state !== 'ruin') setOcc(b, b.id);
  return b;
}
function tilesFree(i, j, w, d) {
  if (i < 1 || j < 1 || i + w > GN - 1 || j + d > GN - 1) return false;
  for (let y = j; y < j + d; y++) for (let x = i; x < i + w; x++) if (V.occ[y * GN + x] !== 0 || !Terr.has(x, y)) return false;
  return true;
}
const minHallFor = type => { for (let k = 0; k < 3; k++) if (BDEF[type].max[k] > 0) return k + 1; return 3; };
function countOf(type) { return V.buildings.filter(b => b.type === type).length; }
function placeCheck(type, i, j) {
  const d = BDEF[type];
  for (let y = j; y < j + d.d; y++) for (let x = i; x < i + d.w; x++) if (inGrid(x, y) && !Terr.has(x, y)) return 'That land is still hidden by clouds. Expand the map first.';
  if (!tilesFree(i, j, d.w, d.d)) return 'That spot is blocked.';
  if (maxCount(type) === 0) return `${d.name} needs Town Hall level ${minHallFor(type)}.`;
  if (countOf(type) >= maxCount(type)) return `Town Hall level ${hallLevel()} allows ${maxCount(type)} ${d.name}${maxCount(type) > 1 ? 's' : ''}. Upgrade the Town Hall for more.`;
  if (!canAfford(d.cost[0])) return 'Not enough resources.';
  if (busyBuilders() >= builderCount()) return 'All builders are busy.';
  for (const e of V.enemies) if (!e.dying && e.i >= i - 0.3 && e.i <= i + d.w + 0.3 && e.j >= j - 0.3 && e.j <= j + d.d + 0.3) return 'An enemy is in the way.';
  return null;
}
function buildNew(type, i, j) {
  const why = placeCheck(type, i, j);
  if (why) return why;
  const d = BDEF[type];
  pay(d.cost[0]);
  const t = d.time[0];
  addBuilding(type, i, j, { state: 'building', buildT: t, buildTotal: t, hp: 1 });
  sfxAt('place', i + 1, j + 1); V.cb.changed();
  return null;
}
function upgradeCheck(b) {
  const d = BDEF[b.type];
  if (b.state !== 'built') return 'Not available right now.';
  if (b.level >= (d.maxLevel || 3)) return 'Already at the maximum level.';
  if (b.type !== 'townhall' && b.level >= hallLevel()) return 'Upgrade the Town Hall first.';
  const cost = d.cost[b.level];
  if (!canAfford(cost)) return 'Not enough resources.';
  if (busyBuilders() >= builderCount()) return 'All builders are busy.';
  if (V.raid.active && b.type === 'townhall') return 'Wait until the raid is over.';
  return null;
}
function upgradeBuilding(b) {
  const why = upgradeCheck(b);
  if (why) return why;
  const d = BDEF[b.type];
  pay(d.cost[b.level]);
  b.state = 'building'; b.up = b.level + 1; b.buildTotal = d.time[b.level]; b.buildT = b.buildTotal;
  sfxAt('craft', b.i + 1, b.j + 1); V.cb.changed();
  return null;
}
function rebuildCost(b) {
  const c = BDEF[b.type].cost[b.level - 1], r = {};
  for (const k in c) r[k] = Math.ceil(c[k] * 0.5);
  return r;
}
function rebuildRuin(b) {
  const c = rebuildCost(b);
  if (!canAfford(c)) return 'Not enough resources.';
  if (!tilesFree(b.i, b.j, b.w, b.d)) return 'Something is in the way.';
  pay(c); b.state = 'built'; b.hp = b.maxHp = BDEF[b.type].hp[b.level - 1]; setOcc(b, b.id); b.armed = true;
  Sfx.play('place'); V.cb.changed(); return null;
}
function collect(b) {
  const d = BDEF[b.type];
  if (b.state !== 'built' || d.kind !== 'collector') return 0;
  const n = addRes(d.res, Math.floor(b.prod));
  if (n > 0) { b.prod -= n; sfxAt('coin', b.i + b.w / 2, b.j + b.d / 2); floatText(b.i + b.w / 2, b.j + b.d / 2, 60, `+${n} ${d.res}`, d.res === 'gold' ? '#ffd966' : '#c8a070'); }
  else if (V.res[d.res] >= caps()[d.res]) toast(`Your ${d.res} storage is full.`);
  return n;
}
function damageBuilding(b, dmg, srcX, srcY) {
  if (b.state === 'ruin' || b.hp <= 0) return;
  b.hp -= dmg; b.flash = 0.12;
  if (b.hp <= 0) destroyBuilding(b);
}
function destroyBuilding(b) {
  const cx = b.i + b.w / 2, cy = b.j + b.d / 2;
  burst(cx, cy, 20 + b.w * 8, ['#8a8478', '#5a5248', '#c9a070', '#3a2e24'], 140, 0.9);
  sfxAt('crash', cx, cy); sfxAt('explode', cx, cy); V.shake = Math.max(V.shake, 8);
  if (b.type === 'townhall') { b.state = 'ruin'; b.hp = 0; setOcc(b, 0); V.state = 'lost'; V.cb.changed(); return; }
  setOcc(b, 0);
  if (b.type === 'wall') { V.buildings.splice(V.buildings.indexOf(b), 1); return; }
  b.state = 'ruin'; b.hp = 0; b.prod = 0;
  if (V.selected === b) V.selected = null;
  V.cb.changed();
}

// ---------------------------------------------------------------- particles / text
function burst(i, j, n, colors, spd, life, up) {
  const x = isoX(i, j), y = isoY(i, j);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * 6.283, s = Math.random() * (spd || 80);
    V.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 - (up === undefined ? 40 : up), life: life || 0.7, max: life || 0.7, c: colors[Math.floor(Math.random() * colors.length)], s: 2 + Math.random() * 3, g: 160 });
  }
}
function floatText(i, j, z, text, color) { V.texts.push({ i, j, z: z || 40, text, color: color || '#fff', t: 0, life: 1.1 }); }

// ---------------------------------------------------------------- pathfinding (A* on the tile grid)
class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let k = a.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (a[p].f <= a[k].f) break; [a[p], a[k]] = [a[k], a[p]]; k = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let k = 0; for (; ;) { let l = k * 2 + 1, r = l + 1, m = k; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } } return top; }
  get size() { return this.a.length; }
}
// cost of entering a tile for a mover; Infinity = blocked
function tileCost(i, j, walls, lock) {
  if (lock && !Terr.has(i, j)) return Infinity;
  const o = occAt(i, j);
  if (o === 0) return 1;
  if (o > 0) { const b = bById(o); if (walls && b && b.type === 'wall') return 9; return Infinity; }
  return Infinity;
}
function rectDist(px, py, b) {
  const dx = Math.max(b.i - px, 0, px - (b.i + b.w)), dy = Math.max(b.j - py, 0, py - (b.j + b.d));
  return Math.hypot(dx, dy);
}
// path from tile (si,sj) to any tile within `reach` of rect `r` (or to tile goal gi,gj when r is null)
function findPath(si, sj, goalFn, hFn, walls, maxN, lock) {
  const key = (i, j) => j * GN + i, best = new Map(), heap = new Heap();
  const start = { i: si, j: sj, g: 0, f: hFn(si, sj), p: null };
  heap.push(start); best.set(key(si, sj), 0);
  let n = 0;
  while (heap.size && n++ < (maxN || 3500)) {
    const c = heap.pop();
    if (c.g > best.get(key(c.i, c.j))) continue;
    if (goalFn(c.i, c.j)) { const path = []; for (let q = c; q.p; q = q.p) path.push({ i: q.i, j: q.j }); return path.reverse(); }
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ni = c.i + di, nj = c.j + dj;
      if (!inGrid(ni, nj)) continue;
      let cost = tileCost(ni, nj, walls, lock);
      if (cost === Infinity) continue;
      if (di && dj && (tileCost(c.i + di, c.j, walls, lock) === Infinity || tileCost(c.i, c.j + dj, walls, lock) === Infinity)) continue;
      const g = c.g + cost * (di && dj ? 1.41 : 1);
      const k = key(ni, nj);
      if (best.has(k) && best.get(k) <= g) continue;
      best.set(k, g);
      heap.push({ i: ni, j: nj, g, f: g + hFn(ni, nj), p: c });
    }
  }
  return null;
}
function pathToBuilding(u, b, reach, walls) {   // enemies ignore the cloud boundary
  const hf = (i, j) => rectDist(i + 0.5, j + 0.5, b);
  return findPath(tileOf(u.i), tileOf(u.j), (i, j) => tileCost(i, j, walls) !== Infinity && rectDist(i + 0.5, j + 0.5, b) <= reach, hf, walls, 4500, false);
}
// Tile-by-tile A* paths zig-zag (east, north-east, east, ...), which made walking units wiggle their facing. String-pulling keeps only the
// corners that are really needed: each waypoint is the furthest one in clear sight (with a body's width of room) of the one before.
function clearLine(ax, ay, bx, by, lock) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(len / 0.2)), px = len ? -dy / len : 0, py = len ? dx / len : 0;
  for (let k = 0; k <= n; k++) {
    const x = ax + dx * k / n, y = ay + dy * k / n;
    for (const o of [0, -0.28, 0.28]) if (tileCost(Math.floor(x + px * o), Math.floor(y + py * o), false, lock) === Infinity) return false;
  }
  return true;
}
function smoothPath(u, path, lock) {
  if (!path || path.length < 2) return path;
  const pts = [{ x: u.i, y: u.j }].concat(path.map(w => ({ x: w.i + 0.5, y: w.j + 0.5, i: w.i, j: w.j })));
  const out = []; let cur = 0;
  while (cur < pts.length - 1) {
    let nxt = cur + 1;
    for (let k = pts.length - 1; k > cur + 1; k--) if (clearLine(pts[cur].x, pts[cur].y, pts[k].x, pts[k].y, lock)) { nxt = k; break; }
    out.push({ i: pts[nxt].i, j: pts[nxt].j }); cur = nxt;
  }
  return out;
}
function pathToTile(u, gi, gj) {                 // hero / guards stay inside the territory
  const raw = pathToTileRaw(u, gi, gj);
  return raw ? smoothPath(u, raw, true) : raw;
}
function pathToTileRaw(u, gi, gj) {
  const hf = (i, j) => Math.max(Math.abs(i - gi), Math.abs(j - gj));
  return findPath(tileOf(u.i), tileOf(u.j), (i, j) => i === gi && j === gj, hf, false, 3500, true)
    || (tileCost(gi, gj, false, true) === Infinity ? findPath(tileOf(u.i), tileOf(u.j), (i, j) => Math.max(Math.abs(i - gi), Math.abs(j - gj)) <= 1 && tileCost(i, j, false, true) !== Infinity, hf, false, 3500, true) : null);
}
// The chopping pictures face the camera (down-left or down-right), so the hero must stand where the tree is beside or below him
// on screen. Preferred spots: level with the tree on its left / right, then the two upper sides; any neighbour is the last resort.
const CHOP_TIERS = [[[1, -1], [-1, 1]], [[0, -1], [-1, 0]], [[1, 0], [0, 1], [-1, -1], [1, 1]]];
function pathToTree(u, t) {
  const si = tileOf(u.i), sj = tileOf(u.j);
  for (const tier of CHOP_TIERS) {
    const spots = tier.map(([a, b]) => [t.i + a, t.j + b]).filter(([i, j]) => inGrid(i, j) && tileCost(i, j, false, true) !== Infinity);
    if (spots.some(([i, j]) => i === si && j === sj)) return [];                       // already standing on a good spot
    let best = null;
    for (const [gi, gj] of spots) { const p = findPath(si, sj, (i, j) => i === gi && j === gj, (i, j) => Math.max(Math.abs(i - gi), Math.abs(j - gj)), false, 3500, true); if (p && (!best || p.length < best.length)) best = p; }
    if (best) return smoothPath(u, best, true);
  }
  const hf = (i, j) => Math.max(Math.abs(i - t.i), Math.abs(j - t.j));
  const last = findPath(si, sj, (i, j) => Math.abs(i - t.i) <= 1 && Math.abs(j - t.j) <= 1 && tileCost(i, j, false, true) !== Infinity, hf, false, 3500, true);
  return last ? smoothPath(u, last, true) : last;
}
// move a unit along its path; returns true while still travelling
function followPath(u, dt, speed) {
  if (!u.path || !u.path.length) return false;
  let left = speed * dt;
  while (left > 0 && u.path.length) {
    const w = u.path[0], tx = w.i + 0.5, ty = w.j + 0.5, dx = tx - u.i, dy = ty - u.j, d = Math.hypot(dx, dy);
    if (d <= left) { u.i = tx; u.j = ty; left -= d; u.path.shift(); }
    else { u.i += dx / d * left; u.j += dy / d * left; u.dir = { x: dx / d, y: dy / d }; left = 0; }
    if (d > 0.001) u.dir = { x: dx / d, y: dy / d };
  }
  return u.path.length > 0;
}
function faceFrom(u) { if (u.dir) { u.fdir = { x: u.dir.x, y: u.dir.y }; const sx = (u.dir.x - u.dir.y); if (Math.abs(sx) > 0.05) u.face = sx > 0 ? 1 : -1; } }

// ---------------------------------------------------------------- hero
const heroTierNow = () => Math.min(3, Math.floor((V.heroLevel - 1) / 4));
const heroStats = () => ({ maxHp: HERO_DEF.hp + (V.heroLevel - 1) * 25, dmg: HERO_DEF.dmg + (V.heroLevel - 1) * 3, maxMana: HERO_DEF.mana + (V.heroLevel - 1) * 10, red: HERO_DEF.armorRed[heroTierNow()] });
function spawnHero() {
  const hall = V.buildings.find(b => b.type === 'townhall');
  const s = heroStats();
  V.hero = { i: hall.i + 1.5, j: hall.j + hall.d + 0.7, hp: s.maxHp, maxHp: s.maxHp, face: 1, dir: null, path: [], order: null, atk: -1, atkHit: false, strikeCd: 0, strikeT: -1,
    dead: false, respawn: 0, mana: s.maxMana, maxMana: s.maxMana, healCd: 0, stance: 'aggressive', hero_kills: 0, chop: 0, hits: 0, anim: 0, walkT: 0, inv: 0, hurt: 0, fdir: { x: 0.7, y: 0.7 }, yaw: 0, lastStep: 0, chopping: false };
}
function gainXp(n) {
  V.heroXp += n;
  while (V.heroXp >= 24 * V.heroLevel && V.heroLevel < 20) {
    V.heroXp -= 24 * V.heroLevel; V.heroLevel++;
    const s = heroStats(); V.hero.maxHp = s.maxHp; V.hero.hp = s.maxHp; V.hero.maxMana = s.maxMana; V.hero.mana = s.maxMana;
    toast(`Hero reached level ${V.heroLevel}!`); Sfx.play('power');
    floatText(V.hero.i, V.hero.j, 70, 'LEVEL UP', '#ffe08a');
  }
}
function orderMove(i, j) {
  const h = V.hero; if (!h || h.dead) return;
  h.order = { type: 'move' };
  h.path = pathToTile(h, tileOf(i), tileOf(j)) || [];
  h.chop = 0;
}
function orderAttack(e) { const h = V.hero; if (!h || h.dead) return; h.order = { type: 'attack', e }; h.path = []; h.pathT = 0; }
function orderChop(t) {
  const h = V.hero; if (!h || h.dead) return;
  h.order = { type: 'chop', t }; h.path = pathToTree(h, t) || []; h.chop = 0; h.hits = 0;
  if (!h.path.length && !(Math.abs(tileOf(h.i) - t.i) <= 1 && Math.abs(tileOf(h.j) - t.j) <= 1)) { h.order = null; toast("The hero can't reach that tree."); }
}
// Hero strike: the hero raises the sword (charge), then slams it down; the shockwave lands at the moment of impact.
function heroStrike() {
  const h = V.hero;
  if (!h || h.dead || h.strikeT >= 0) return false;
  if (h.strikeCd > 0) { Sfx.play('deny'); return false; }
  if (h.mana < HERO_DEF.strikeMana) { Sfx.play('deny'); toast('Not enough mana.'); return false; }
  h.mana -= HERO_DEF.strikeMana; h.strikeCd = HERO_DEF.strikeCd; h.strikeT = 0; h.strikePending = true; h.inv = 0.5; h.atk = -1; h.path = []; h.order = null;
  sfxAt('charge', h.i, h.j);
  return true;
}
function strikeImpact() {
  const h = V.hero; h.strikePending = false;
  const dmg = heroStats().dmg * HERO_DEF.strikeDmg;
  sfxAt('strike', h.i, h.j); V.shake = Math.max(V.shake, 6);
  V.rings.push({ i: h.i, j: h.j, r: 0.3, max: HERO_DEF.strikeRadius, t: 0 });
  burst(h.i, h.j, 28, ['#bfe8ff', '#ffffff', '#ffe9a0'], 200, 0.6, 20);
  V.hitstop = Math.max(V.hitstop, 0.07);
  for (const e of V.enemies) if (!e.dying && Math.hypot(e.i - h.i, e.j - h.j) <= HERO_DEF.strikeRadius) {
    e.hurt(dmg, 'hero');
    const d = Math.hypot(e.i - h.i, e.j - h.j) || 1; e.kx = (e.i - h.i) / d * 3.5; e.ky = (e.j - h.j) / d * 3.5; e.stun = 0.45;
  }
}
// Second Wind: a quick self-heal
function heroHeal() {
  const h = V.hero;
  if (!h || h.dead) return false;
  if (h.healCd > 0) { Sfx.play('deny'); toast(`Second Wind is recharging (${Math.ceil(h.healCd)}s).`); return false; }
  if (h.mana < HERO_DEF.healMana) { Sfx.play('deny'); toast('Not enough mana.'); return false; }
  if (h.hp >= h.maxHp) { Sfx.play('deny'); toast('Your hero is already at full health.'); return false; }
  h.mana -= HERO_DEF.healMana; h.healCd = HERO_DEF.healCd;
  const n = Math.round(h.maxHp * HERO_DEF.healPct); h.hp = Math.min(h.maxHp, h.hp + n);
  floatText(h.i, h.j, 70, '+' + n, '#9cffb0'); sfxAt('heal', h.i, h.j);
  V.rings.push({ i: h.i, j: h.j, r: 0.2, max: 1.4, t: 0, green: true });
  burst(h.i, h.j, 16, ['#bfffcf', '#ffffff', '#7be08a'], 60, 0.9, 40);
  return true;
}
function heroStop() { const h = V.hero; if (h && !h.dead) { h.order = null; h.path = []; h.chop = 0; h.hits = 0; } }
function heroHome() { const h = V.hero, hall = V.buildings.find(b => b.type === 'townhall'); if (h && !h.dead && hall) orderMove(hall.i + 1.5, hall.j + hall.d + 0.7); }
const STANCES = ['aggressive', 'defensive', 'hold'];
function cycleStance() { const h = V.hero; if (!h) return; h.stance = STANCES[(STANCES.indexOf(h.stance) + 1) % STANCES.length]; Sfx.play('click'); return h.stance; }
function nearestEnemy(i, j, r, groundOnly) {
  let best = null, bd = r;
  for (const e of V.enemies) { if (e.dying || !Terr.has(e.i, e.j)) continue; /* enemies hidden in the clouds are out of reach */ const d = Math.hypot(e.i - i, e.j - j); if (d < bd) { bd = d; best = e; } }
  return best;
}
function updateHero(dt) {
  const h = V.hero; if (!h) return;
  h.anim += dt; h.inv = Math.max(0, h.inv - dt); h.hurt = Math.max(0, h.hurt - dt); h.strikeCd = Math.max(0, h.strikeCd - dt);
  const st = heroStats();
  h.maxMana = st.maxMana; h.healCd = Math.max(0, (h.healCd || 0) - dt);
  if (!h.dead) h.mana = Math.min(h.maxMana, h.mana + dt * HERO_DEF.manaRegen * (V.raid.active ? 1 : 1.8));
  if (h.dead) {
    h.respawn -= dt;
    if (h.respawn <= 0) { const hall = V.buildings.find(b => b.type === 'townhall'); h.dead = false; h.hp = st.maxHp; h.i = hall.i + 1.5; h.j = hall.j + hall.d + 0.7; h.order = null; toast('Your hero has returned.'); }
    return;
  }
  if (V.raid.active || h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + dt * (V.raid.active ? 1.5 : 6));
  if (h.strikeT >= 0) { h.strikeT += dt; if (h.strikePending && h.strikeT >= 0.2) strikeImpact(); if (h.strikeT > 0.5) h.strikeT = -1; }
  const o = h.order;
  // swing timeline
  h.chopping = false;
  if (h.atk >= 0) {
    h.atk += dt;
    if (!h.atkHit && h.atk >= 0.18) {
      h.atkHit = true;
      const t = h.atkTarget;
      const tgt = t && !t.dying ? t : nearestEnemy(h.i, h.j, HERO_DEF.range + 0.4);
      if (tgt && Math.hypot(tgt.i - h.i, tgt.j - h.j) <= HERO_DEF.range + 0.6) {
        tgt.hurt(st.dmg, 'hero'); sfxAt('hit', tgt.i, tgt.j); if (tgt.type === 'knight' || tgt.type === 'skeleton' || tgt.type === 'bonelord') sfxAt('clang', tgt.i, tgt.j); V.hitstop = Math.max(V.hitstop, 0.05); V.shake = Math.max(V.shake, 2.5);
        burst(tgt.i, tgt.j, 9, ['#ffffff', '#ffe9a0', '#ffb060'], 120, 0.3, 20);
        const dx = tgt.i - h.i, dy = tgt.j - h.j, l = Math.hypot(dx, dy) || 1; if (!tgt.boss) { tgt.kx = dx / l * 1.6; tgt.ky = dy / l * 1.6; tgt.stun = Math.max(tgt.stun, 0.12); }
        V.slashFx.push({ i: tgt.i, j: tgt.j, t: 0, a: Math.atan2((dx - dy), (dx + dy) * 0.5) });
      }
    }
    if (h.atk >= 0.39) h.atk = -1;
    return;
  }
  if (h.strikeT >= 0) return;
  let moving = false;
  // keyboard: WASD / arrows move along the screen axes (mapped onto the isometric grid), cancelling any click order
  const inp = V.input, kb = !!(inp && (inp.x || inp.y));
  if (kb) {
    h.order = null; h.path = []; h.chop = 0; h.hits = 0;
    const di = inp.x + inp.y, dj = inp.y - inp.x, l = Math.hypot(di, dj) || 1, sp = HERO_DEF.speed * 1.08 * dt;   // screen right = tile (1,-1), screen down = tile (1,1): the same eight directions as the pictures
    const vx = di / l * sp, vy = dj / l * sp, ok = (i, j) => Terr.has(tileOf(i), tileOf(j)) && tileCost(tileOf(i), tileOf(j), false, true) !== Infinity;
    const nx = h.i + vx, ny = h.j + vy;
    if (ok(nx, ny)) { h.i = nx; h.j = ny; } else if (ok(nx, h.j)) h.i = nx; else if (ok(h.i, ny)) h.j = ny;
    h.dir = { x: di / l, y: dj / l }; faceFrom(h); h.path = []; moving = true; h.kbMove = true;
  } else h.kbMove = false;
  if (kb) { /* handled above */ }
  else if (o && o.type === 'attack') {
    if (!o.e || o.e.dying) { h.order = null; }
    else {
      const d = Math.hypot(o.e.i - h.i, o.e.j - h.j);
      if (d <= HERO_DEF.range) { lookAt(h, o.e.i, o.e.j); h.atk = 0; h.atkHit = false; h.atkTarget = o.e; sfxAt('slash', h.i, h.j); }
      else { h.pathT = (h.pathT || 0) - dt; if (h.pathT <= 0 || !h.path.length) { h.path = pathToTile(h, tileOf(o.e.i), tileOf(o.e.j)) || []; h.pathT = 0.4; } moving = followPath(h, dt, HERO_DEF.speed); }
    }
  } else if (o && o.type === 'chop') {
    const t = o.t;
    if (!t.alive || t.felled) { h.order = null; h.chop = 0; }
    else if (Math.abs(tileOf(h.i) - t.i) <= 1 && Math.abs(tileOf(h.j) - t.j) <= 1 && !h.path.length) {
      // three axe swings (0.9 s each, impact at 62% of the swing), then the tree comes down
      lookAt(h, t.i + 0.5 + (t.ox || 0), t.j + 0.5 + (t.oj || 0)); h.chopping = true; h.chop += dt;
      const due = h.chop >= 0.558 ? Math.floor((h.chop - 0.558) / 0.9) + 1 : 0;
      while (h.hits < due && h.order === o) { h.hits++; chopHit(h, t); }
    } else moving = followPath(h, dt, HERO_DEF.speed);
  } else if (o && o.type === 'move') {
    moving = followPath(h, dt, HERO_DEF.speed);
    if (!moving) h.order = null;
  } else {
    // idle: engage anything that comes close
    const reach = h.stance === 'hold' ? 1.4 : h.stance === 'defensive' ? 4.5 : V.raid.active ? 80 : 3.2;
    const e = nearestEnemy(h.i, h.j, reach);   // aggressive: during a raid the idle hero hunts; defensive: only what comes near; hold: only what is in reach
    if (e) { h.order = { type: 'attack', e, auto: true }; }
  }
  if (moving) {
    h.walkT += dt * 1.6; if (!kb) faceFrom(h);
    const step = Math.floor(h.walkT * 7.05 / Math.PI);                  // a footfall every half stride
    if (step !== h.lastStep) { h.lastStep = step; sfxAt({ stone: 'stepStone', dirt: 'stepDirt', grass: 'step' }[typeof Life !== 'undefined' ? Life.surfaceAt(h.i, h.j) : 'grass'], h.i, h.j); if (Math.random() < 0.5) V.parts.push({ x: isoX(h.i, h.j), y: isoY(h.i, h.j) + 2, vx: rnd(-8, 8), vy: -10, life: 0.5, max: 0.5, c: 'rgba(190,170,130,.55)', s: 3, g: -10 }); }
  }
}
// an axe lands on a tree: chips, shake and a thunk; the third hit fells it
function chopHit(h, t) {
  t.shake = 0.42; t.hits = (t.hits || 0) + 1;
  const x = t.i + 0.5, y = t.j + 0.5;
  sfxAt('chop', x, y); V.shake = Math.max(V.shake, 1.2);
  for (let k = 0; k < 7; k++) { const a = Math.random() * 6.283, sp = 40 + Math.random() * 80; V.parts.push({ x: isoX(x, y) + rnd(-3, 3), y: isoY(x, y) - 22 + rnd(-4, 4), vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp - 30, life: 0.7, max: 0.7, c: k % 2 ? '#c8a070' : '#e2c08a', s: 2 + Math.random() * 2.2, g: 380, chip: true }); }
  for (let k = 0; k < 3; k++) V.parts.push({ x: isoX(x, y) + rnd(-12, 12), y: isoY(x, y) - 70 + rnd(-12, 10), vx: rnd(-14, 14), vy: rnd(10, 40), life: 1.0, max: 1.0, c: ['#78a85a', '#5a8a46', '#a8c070'][k], s: 3, g: 60, leaf: true });
  if (t.hits >= 3) {
    t.felled = true; V.occ[t.j * GN + t.i] = 0;
    t.fall = { t: 0, dir: (isoX(t.i, t.j) >= isoX(h.i, h.j)) ? 1 : -1 };
    h.order = null; h.chop = 0; h.hits = 0;
  }
}
// trees: shake and fall animations, then the wood
function updateTrees(dt) {
  for (const t of V.trees) {
    if (t.shake > 0) t.shake = Math.max(0, t.shake - dt);
    if (t.fall) {
      t.fall.t += dt;
      if (!t.fall.cracked && t.fall.t > 0.35) { t.fall.cracked = true; sfxAt('crash', t.i, t.j); }
      if (t.fall.t >= 0.95) {
        const fd = t.fall.dir; t.alive = false; t.fall = null;
        const n = addRes('wood', 6); floatText(t.i + 0.5, t.j + 0.5, 70, n ? `+${n} wood` : 'storage full', '#c8a070');
        sfxAt('thud', t.i, t.j); V.shake = Math.max(V.shake, 3.5);
        burst(t.i + 0.5 + fd * 0.6, t.j + 0.5 - fd * 0.6, 16, ['#5a8a46', '#78a85a', '#8a6240', '#a8c070'], 130, 0.9);
      }
    }
  }
}

// ---------------------------------------------------------------- guards
function updateGuards(dt) {
  for (const b of V.buildings) {
    if (b.type !== 'barracks' || b.state !== 'built') continue;
    const d = BDEF.barracks, want = d.guards[b.level - 1], have = V.guards.filter(g => g.home === b.id).length;
    if (have < want) {
      b.guardT -= dt;
      if (b.guardT <= 0) { b.guardT = 9; V.guards.push({ id: V.nextId++, home: b.id, i: b.i + b.w / 2 + 0.3, j: b.j + b.d + 0.5, hp: d.ghp[b.level - 1], maxHp: d.ghp[b.level - 1], level: b.level, face: 1, path: [], atk: -1, cd: 0, dead: false, walkT: 0, anim: 0, wander: 0 }); burst(b.i + 1, b.j + b.d, 8, ['#fff', '#cde'], 60, 0.4); }
    }
  }
  for (const g of V.guards) {
    const home = bById(g.home);
    if (!home || home.state !== 'built') { g.dead = true; continue; }
    g.anim += dt; g.cd -= dt;
    const d = BDEF.barracks, dmg = d.gdmg[home.level - 1];
    if (g.atk >= 0) {
      g.atk += dt;
      if (!g.atkHit && g.atk >= 0.2) { g.atkHit = true; const t = g.target; if (t && !t.dying && Math.hypot(t.i - g.i, t.j - g.j) < 1.5) { t.hurt(dmg, 'guard'); } }
      if (g.atk >= 0.45) { g.atk = -1; g.cd = 0.5; }
      continue;
    }
    const e = nearestEnemy(g.i, g.j, 5.5);
    const hx = home.i + home.w / 2, hy = home.j + home.d / 2;
    if (e && Math.hypot(e.i - hx, e.j - hy) < 9) {
      const dd = Math.hypot(e.i - g.i, e.j - g.j);
      if (dd < 1.0 && g.cd <= 0) { g.atk = 0; g.atkHit = false; g.target = e; lookAt(g, e.i, e.j); sfxAt('slash', g.i, g.j); g.face = ((e.i - e.j) - (g.i - g.j)) >= 0 ? 1 : -1; }
      else if (dd >= 1.0) {
        g.pathT = (g.pathT || 0) - dt;
        if (g.pathT <= 0 || !g.path.length) { g.path = pathToTile(g, tileOf(e.i), tileOf(e.j)) || []; g.pathT = 0.5; }
        if (followPath(g, dt, 2.4)) { g.walkT += dt * 1.6; faceFrom(g); }
      }
    } else {
      g.wander -= dt;
      if (g.wander <= 0) { g.wander = rnd(2, 5); const ti = clamp(tileOf(hx + rnd(-2.8, 2.8)), 1, GN - 2), tj = clamp(tileOf(hy + rnd(1.2, 3.2)), 1, GN - 2); g.path = pathToTile(g, ti, tj) || []; }
      if (followPath(g, dt, 1.2)) { g.walkT += dt * 0.9; faceFrom(g); }
    }
  }
  for (const g of V.guards) if (g.hp <= 0 && !g.dead) { g.dead = true; floatText(g.i, g.j, 40, 'fallen', '#c8c8c8'); burst(g.i, g.j, 8, ['#cde', '#fff'], 60, 0.5); }
  V.guards = V.guards.filter(g => !g.dead);
}

// ---------------------------------------------------------------- enemies
class Enemy {
  constructor(type, i, j, hpMul) {
    const d = EDATA[type];
    this.type = type; this.d = d; this.i = i; this.j = j; this.maxHp = Math.round(d.hp * hpMul); this.hp = this.maxHp;
    this.face = 1; this.dir = null; this.path = []; this.pathT = 0; this.cd = rnd(0.2, 0.8); this.atk = -1; this.stun = 0; this.kx = 0; this.ky = 0;
    this.dying = false; this.dieT = 0; this.dead = false; this.flash = 0; this.target = null; this.unit = null; this.walkT = Math.random() * 5; this.anim = 0; this.retarget = 0; this.blocker = null;
    this.boss = !!d.boss; this.flying = !!d.flying; this.state = 'move'; this.st = 0; this.sumCd = rnd(6, 10); this.hover = Math.random() * 6; this.burnT = 0;
  }
  hurt(dmg, src) {
    if (this.dying) return;
    dmg = Math.round(dmg);
    this.hp -= dmg; this.flash = 0.1;
    floatText(this.i, this.j, 54, String(dmg), '#ffe066');
    if (this.hp <= 0) this.die(src);
  }
  die(src) {
    this.dying = true; this.dieT = 0; this.atk = -1;
    V.kills++; V.raid.killed++; if (src === 'hero' && V.hero) V.hero.hero_kills++;
    const g = addRes('gold', this.d.gold);
    if (this.d.gold) floatText(this.i, this.j, 74, `+${this.d.gold}`, '#ffd966');
    if (this.boss) { addRes('wood', 40); burst(this.i, this.j, 30, ['#a060ff', '#ffe08a'], 160, 1, 20); V.shake = 12; }
    gainXp(this.d.xp);
    sfxAt(this.boss ? 'boss' : 'die', this.i, this.j);
    if (this.type === 'necro' || this.type === 'spawn' || this.type === 'king') burst(this.i, this.j, 14, ['#a060ff', '#4fd8ff'], 110, 0.7);
  }
  pickTarget() {
    const live = V.buildings.filter(b => b.state !== 'ruin' && b.hp > 0 && b.type !== 'wall' && b.type !== 'trap' && BDEF[b.type].kind !== 'decor');
    if (!live.length) return null;
    let pool = live;
    const pref = this.d.target;
    if (pref === 'defense') { const f = live.filter(b => BDEF[b.type].kind === 'defense' || b.type === 'barracks'); if (f.length) pool = f; }
    else if (pref === 'townhall') { const f = live.filter(b => b.type === 'townhall'); if (f.length) pool = f; }
    let best = null, bd = 1e9;
    for (const b of pool) { const d = rectDist(this.i, this.j, b); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  attackBuilding(b, dt) {
    const d = this.d;
    if (this.cd > 0) return;
    this.atk = 0; this.hit = false; this.hitTarget = b; this.cd = d.cd;
    this.face = ((b.i + b.w / 2 - b.j - b.d / 2) - (this.i - this.j)) >= 0 ? 1 : -1;
  }
  update(dt) {
    this.anim += dt; this.flash = Math.max(0, this.flash - dt); this.cd -= dt; this.hover += dt;
    if (this.dying) {
      this.dieT += dt;
      if (this.dieT > (this.boss ? 2.4 : this.d.g.die ? 1.4 : 0.8)) this.dead = true;
      return;
    }
    if (this.stun > 0) { this.stun -= dt; const k = Math.max(0, this.stun / 0.45); this.i += this.kx * dt * k; this.j += this.ky * dt * k; this.kx *= 0.9; this.ky *= 0.9; return; }
    const d = this.d;
    // attack animation timeline
    if (this.atk >= 0) {
      this.atk += dt;
      const hitAt = d.ranged ? 0.45 : 0.28, total = d.ranged ? 0.8 : 0.55;
      if (!this.hit && this.atk >= hitAt) {
        this.hit = true;
        const t = this.hitTarget;
        if (t && t.isUnit) {
          if (Math.hypot(t.u.i - this.i, t.u.j - this.j) <= d.range + 0.7) hurtUnit(t.u, d.dmg * (this.dmgMul || 1));
        } else if (t && t.state !== 'ruin' && t.hp > 0) {
          if (d.ranged) {
            const sx = this.i, sy = this.j;
            V.proj.push({ kind: this.type === 'king' ? 'skull' : 'orb', i: sx, j: sy, z: 34, ti: t.i + t.w / 2, tj: t.j + t.d / 2, tb: t, dmg: d.dmg * (this.dmgMul || 1), speed: 6.5, t: 0, fromEnemy: true });
            sfxAt('cast', this.i, this.j);
          } else { damageBuilding(t, d.dmg * (this.dmgMul || 1)); sfxAt('thud', t.i + t.w / 2, t.j + t.d / 2); burst(t.i + t.w / 2, t.j + t.d / 2, 4, ['#c9a070', '#8a8478'], 70, 0.4); }
        }
      }
      if (this.atk >= total) { this.atk = -1; }
      return;
    }
    // sunlight does not matter here; pick a target
    this.retarget -= dt;
    if (!this.target || this.target.state === 'ruin' || this.target.hp <= 0 || this.retarget <= 0) {
      this.retarget = 1.0; const nt = this.pickTarget();
      if (nt !== this.target) { this.target = nt; this.path = []; this.pathT = 0; }
    }
    // distract to nearby hero/guards
    let unit = null, ud = 1.6;
    const h = V.hero;
    if (h && !h.dead && Math.hypot(h.i - this.i, h.j - this.j) < ud) { unit = h; ud = Math.hypot(h.i - this.i, h.j - this.j); }
    for (const g of V.guards) { const dd = Math.hypot(g.i - this.i, g.j - this.j); if (dd < ud) { unit = g; ud = dd; } }
    if (unit && !d.ranged) {
      if (ud <= d.range + 0.1) { if (this.cd <= 0) { this.atk = 0; this.hit = false; this.hitTarget = { isUnit: true, u: unit }; this.cd = d.cd; this.face = ((unit.i - unit.j) - (this.i - this.j)) >= 0 ? 1 : -1; } return; }
      const dx = unit.i - this.i, dy = unit.j - this.j, l = Math.hypot(dx, dy);
      this.dir = { x: dx / l, y: dy / l }; this.stepFree(dx / l * d.speed * dt, dy / l * d.speed * dt); this.walkT += dt * d.speed * 1.4; faceFrom(this); return;
    }
    if (!this.target) { return; }
    const b = this.target, dist = rectDist(this.i, this.j, b);
    if (this.blocker && (this.blocker.state === 'ruin' || this.blocker.hp <= 0 || !V.buildings.includes(this.blocker))) this.blocker = null;
    const victim = this.blocker || b;
    const vd = rectDist(this.i, this.j, victim);
    if (vd <= d.range) { this.attackBuilding(victim, dt); return; }
    // movement
    if (this.flying) {
      const tx = b.i + b.w / 2, ty = b.j + b.d / 2, dx = tx - this.i, dy = ty - this.j, l = Math.hypot(dx, dy) || 1;
      this.dir = { x: dx / l, y: dy / l }; this.i += dx / l * d.speed * dt; this.j += dy / l * d.speed * dt; this.walkT += dt * 2; faceFrom(this);
      return;
    }
    this.pathT -= dt;
    if (this.pathT <= 0 || !this.path.length) {
      const p = pathToBuilding(this, b, d.range * 0.9, true);
      this.path = p || []; this.pathT = 1.4 + Math.random() * 0.6; this.blocker = null;
      if (!p) { // no route: go straight and bash whatever is in the way
        const dx = b.i + b.w / 2 - this.i, dy = b.j + b.d / 2 - this.j, l = Math.hypot(dx, dy) || 1;
        const hit = this.stepFree(dx / l * d.speed * dt, dy / l * d.speed * dt);
        if (hit) this.blocker = hit; this.dir = { x: dx / l, y: dy / l }; faceFrom(this); this.walkT += dt * d.speed * 1.4; return;
      }
    }
    // a wall (or anything) on the next waypoint: stop and break it
    const nxt = this.path[0];
    if (nxt) {
      const o = occAt(nxt.i, nxt.j);
      if (o > 0) { const ob = bById(o); if (ob && ob !== b) { this.blocker = ob; return; } }
    }
    if (followPath(this, dt, d.speed * (this.type === 'zombie' ? 1 : 1))) { this.walkT += dt * d.speed * 1.5; faceFrom(this); }
  }
  stepFree(dx, dy) {
    const ni = this.i + dx, nj = this.j + dy, o = occAt(Math.floor(ni), Math.floor(nj));
    if (o > 0) return bById(o);
    if (o === -1) { // tree: slide around
      if (occAt(Math.floor(ni), Math.floor(this.j)) === 0) this.i = ni; else if (occAt(Math.floor(this.i), Math.floor(nj)) === 0) this.j = nj;
      return null;
    }
    this.i = ni; this.j = nj; return null;
  }
}
function hurtUnit(u, dmg) {
  if (u === V.hero) {
    if (u.dead || u.inv > 0) return;
    dmg *= 1 - heroStats().red;
    u.hp -= dmg; u.hurt = 0.25; u.inv = 0.25; floatText(u.i, u.j, 60, '-' + Math.round(dmg), '#ff6666'); sfxAt('hurt', u.i, u.j);
    if (u.hp <= 0) { u.hp = 0; u.dead = true; u.respawn = 12; u.order = null; u.atk = -1; toast('Your hero has fallen. Respawning at the Town Hall...'); sfxAt('die', u.i, u.j); }
  } else { u.hp -= dmg; floatText(u.i, u.j, 50, '-' + Math.round(dmg), '#ff9a6a'); }
}

// ---------------------------------------------------------------- defenses
function updateDefenses(dt) {
  for (const b of V.buildings) {
    b.flash = Math.max(0, b.flash - dt);
    if (b.state === 'building') {
      b.buildT -= dt;
      b.hamT = (b.hamT || 0) - dt; if (b.hamT <= 0) { b.hamT = rnd(0.55, 0.9); sfxAt('hammer', b.i + b.w / 2, b.j + b.d / 2); }
      if (b.buildT <= 0) {
        const d = BDEF[b.type];
        if (b.up) { b.level = b.up; b.up = 0; } b.state = 'built'; b.maxHp = d.hp[b.level - 1]; b.hp = b.maxHp; b.armed = true;
        burst(b.i + b.w / 2, b.j + b.d / 2, 18, ['#ffe08a', '#fff', '#c9a070'], 120, 0.7, 30); sfxAt(b.level > 1 ? 'upgrade' : 'done', b.i + b.w / 2, b.j + b.d / 2);
        toast(`${d.name} ${b.level > 1 ? 'upgraded to level ' + b.level : 'is ready'}.`); V.cb.changed();
      }
      continue;
    }
    if (b.state !== 'built') continue;
    const d = BDEF[b.type];
    if (d.kind === 'collector') { b.prod = Math.min(d.store[b.level - 1], b.prod + d.rate[b.level - 1] * dt); }
    else if (d.kind === 'defense') {
      b.cd -= dt;
      const cx = b.i + b.w / 2, cy = b.j + b.d / 2;
      let tgt = null, bd = d.range;
      for (const e of V.enemies) {
        if (e.dying) continue;
        if (e.flying && !d.air) continue;
        const dd = Math.hypot(e.i - cx, e.j - cy);
        if (d.minRange && dd < d.minRange) continue;
        if (dd < bd) { bd = dd; tgt = e; }
      }
      if (tgt) {
        const want = Math.atan2((tgt.j - cy), (tgt.i - cx));
        let da = want - b.aim; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283;
        b.aim += clamp(da, -dt * 7, dt * 7);
        if (b.cd <= 0) {
          b.cd = d.cd;
          const dmg = d.dmg[b.level - 1];
          const dd = Math.hypot(tgt.i - cx, tgt.j - cy);
          if (b.type === 'archer') { V.proj.push({ kind: 'arrow', i: cx, j: cy, z: 72, ti: tgt.i, tj: tgt.j, te: tgt, dmg, speed: 13, t: 0 }); sfxAt('arrow', cx, cy); }
          else if (b.type === 'magetower') { V.proj.push({ kind: 'bolt', i: cx, j: cy, z: 84, ti: tgt.i, tj: tgt.j, te: tgt, dmg, splash: d.splash, speed: 9, t: 0, air: true }); sfxAt('magic', cx, cy); b.recoil = 0.25; }
          else if (b.type === 'mortar') { V.proj.push({ kind: 'ball', i: cx, j: cy, z: 24, ti: tgt.i + (tgt.vx || 0), tj: tgt.j, dmg, splash: d.splash, speed: 4.6, t: 0, d0: dd, arc: 70 }); sfxAt('mortar', cx, cy); b.recoil = 0.3; burst(cx + Math.cos(b.aim) * 0.5, cy + Math.sin(b.aim) * 0.5, 10, ['#ddd', '#999', '#ffcf70'], 60, 0.6, 30); }
          else { V.proj.push({ kind: 'ball', i: cx, j: cy, z: 24, ti: tgt.i, tj: tgt.j, dmg, splash: d.splash, speed: 7.5, t: 0, d0: dd, arc: 28 }); sfxAt('cannon', cx, cy); b.recoil = 0.2; burst(cx + Math.cos(b.aim) * 0.6, cy + Math.sin(b.aim) * 0.6, 6, ['#ddd', '#999'], 40, 0.5); }
        }
      }
      b.recoil = Math.max(0, (b.recoil || 0) - dt);
    } else if (d.kind === 'shrine') {
      b.pulse = (b.pulse || 0) - dt;
      if (V.raid.active || V.enemies.length || V.hero && V.hero.hp < V.hero.maxHp) {
        const cx = b.i + b.w / 2, cy = b.j + b.d / 2, rad = d.radius, hu = d.heal[b.level - 1] * dt, bu = d.mend[b.level - 1] * dt;
        let healed = false;
        const h = V.hero;
        if (h && !h.dead && Math.hypot(h.i - cx, h.j - cy) <= rad && h.hp < h.maxHp) { h.hp = Math.min(h.maxHp, h.hp + hu); healed = true; }
        for (const g of V.guards) if (Math.hypot(g.i - cx, g.j - cy) <= rad && g.hp < g.maxHp) { g.hp = Math.min(g.maxHp, g.hp + hu); healed = true; }
        for (const o of V.buildings) if (o.state === 'built' && o.hp < o.maxHp && Math.hypot(o.i + o.w / 2 - cx, o.j + o.d / 2 - cy) <= rad) { o.hp = Math.min(o.maxHp, o.hp + bu); healed = true; }
        if (healed && b.pulse <= 0) { b.pulse = 0.9; V.rings.push({ i: cx, j: cy, r: 0.4, max: rad * 0.9, t: 0, green: true }); }
      }
    } else if (d.kind === 'trap' && b.armed) {
      for (const e of V.enemies) {
        if (e.dying || e.flying) continue;
        if (Math.hypot(e.i - (b.i + 0.5), e.j - (b.j + 0.5)) < 0.8) {
          b.armed = false; sfxAt('explode', b.i + b.w / 2, b.j + b.d / 2); V.shake = Math.max(V.shake, 5);
          burst(b.i + 0.5, b.j + 0.5, 22, ['#b9bcc0', '#e8e8e8', '#6a6a6a'], 150, 0.6, 30);
          V.rings.push({ i: b.i + 0.5, j: b.j + 0.5, r: 0.2, max: 1.5, t: 0 });
          for (const t of V.enemies) if (!t.dying && !t.flying && Math.hypot(t.i - b.i - 0.5, t.j - b.j - 0.5) < 1.5) t.hurt(d.dmg[b.level - 1], 'trap');
          break;
        }
      }
    }
  }
}
function updateProjectiles(dt) {
  for (const p of V.proj) {
    p.t += dt;
    if (p.te && !p.te.dying) { p.ti = p.te.i; p.tj = p.te.j; }
    if (p.tb) { p.ti = p.tb.i + p.tb.w / 2; p.tj = p.tb.j + p.tb.d / 2; }
    const dx = p.ti - p.i, dy = p.tj - p.j, d = Math.hypot(dx, dy), step = p.speed * dt;
    if (d <= step + 0.1) {
      p.dead = true;
      if (p.kind === 'arrow') { if (p.te && !p.te.dying) { p.te.hurt(p.dmg, 'tower'); sfxAt('hit', p.ti, p.tj); } }
      else if (p.kind === 'bolt') {
        burst(p.ti, p.tj, 14, ['#9ad0ff', '#d6f0ff', '#7a7aff'], 110, 0.5, 20); V.rings.push({ i: p.ti, j: p.tj, r: 0.2, max: p.splash, t: 0, blue: true });
        for (const e of V.enemies) if (!e.dying && Math.hypot(e.i - p.ti, e.j - p.tj) <= p.splash) e.hurt(p.dmg, 'tower');
        sfxAt('magic', p.ti, p.tj);
      }
      else if (p.kind === 'ball') {
        burst(p.ti, p.tj, 12, ['#ffcf70', '#ff9a40', '#555'], 120, 0.5, 20); V.rings.push({ i: p.ti, j: p.tj, r: 0.2, max: p.splash, t: 0 });
        for (const e of V.enemies) if (!e.dying && !e.flying && Math.hypot(e.i - p.ti, e.j - p.tj) <= p.splash) e.hurt(p.dmg, 'tower');
        sfxAt('explode', p.ti, p.tj); V.shake = Math.max(V.shake, 2);
      } else if (p.tb) { damageBuilding(p.tb, p.dmg); burst(p.ti, p.tj, 8, ['#c08cff', '#8a60ff'], 100, 0.5); }
    } else { p.i += dx / d * step; p.j += dy / d * step; }
  }
  V.proj = V.proj.filter(p => !p.dead);
}

// ---------------------------------------------------------------- raids
function raidQueue(n) {
  const q = []; let pts = 5 + 3 * n;
  while (pts > 0) {
    const r = Math.random();
    if (n >= 3 && r < 0.12 && pts >= 3) { q.push('necro'); pts -= 3; }
    else if (n >= 4 && r < 0.2 && pts >= 3) { q.push('brute'); pts -= 3; }
    else if (n >= 6 && r < 0.3 && pts >= 3) { q.push('bonelord'); pts -= 3; }
    else if (n >= 2 && r < 0.38 && pts >= 1.5) { q.push('skeleton'); pts -= 1.5; }
    else if (n >= 2 && r < 0.5 && pts >= 1.5) { q.push('spawn', 'spawn', 'spawn'); pts -= 1.5; }
    else { q.push('zombie'); pts -= 1; }
  }
  if (n % 5 === 0) q.push((n / 5) % 2 === 1 ? 'knight' : 'king');
  return q;
}
function startRaid() {
  if (V.raid.active || V.state !== 'play') return false;
  const n = V.raid.n;
  V.raid.active = true; V.raid.queue = raidQueue(n); V.raid.total = V.raid.queue.length; V.raid.killed = 0; V.raid.spawnT = 1.5;
  const lanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, 1 + Math.min(3, Math.floor(n / 3)));
  V.raid.lanes = lanes;
  Sfx.play('horn'); Sfx.setMusic(n % 5 === 0 ? 'boss' : 'raid'); V.cb.banner(`Raid ${n}`, n % 5 === 0 ? 'A great evil approaches' : 'The dead are coming');
  V.cb.changed();
  return true;
}
function spawnEnemy(type) {
  const n = V.raid.n, sp = Terr.spawnPoints(), lane = sp[V.raid.lanes[Math.floor(Math.random() * V.raid.lanes.length)]];
  const hpMul = (1 + 0.1 * (n - 1)) * (EDATA[type].boss ? 1 + 0.4 * (Math.floor(n / 5) - 1) : 1);
  const e = new Enemy(type, lane.i + rnd(-0.8, 0.8), lane.j + rnd(-0.8, 0.8), hpMul);
  e.dmgMul = 1 + 0.05 * (n - 1);
  V.enemies.push(e);
  if (Math.random() < 0.5 || EDATA[type].boss) sfxAt(type === 'skeleton' || type === 'bonelord' ? 'skeleton' : 'zombie', e.i, e.j);
  return e;
}
function endRaid() {
  const n = V.raid.n;
  V.raid.active = false; V.raid.bestN = Math.max(V.raid.bestN, n);
  const g = 60 + 30 * n, w = 30 + 12 * n;
  const gg = addRes('gold', g), ww = addRes('wood', w);
  for (const b of V.buildings) { if (b.state === 'built') { b.hp = b.maxHp; b.armed = true; } }
  if (V.hero && !V.hero.dead) V.hero.hp = V.hero.maxHp;
  for (const g2 of V.guards) g2.hp = g2.maxHp;
  V.raid.n++;
  if (V.hero && !V.hero.dead && !V.hero.order) { const hl = V.buildings.find(b => b.type === 'townhall'); if (hl) orderMove(hl.i + 1.5, hl.j + hl.d + 0.7); }
  V.cb.banner('Raid repelled', `+${gg} gold  +${ww} wood`);
  Sfx.play('dawn'); Sfx.setMusic('peace'); saveGame(); V.cb.changed();
}
function updateRaid(dt) {
  const r = V.raid;
  if (!r.active) return;
  r.spawnT -= dt;
  if (r.queue.length && r.spawnT <= 0) {
    const t = r.queue.shift(); spawnEnemy(t);
    r.spawnT = t === 'knight' || t === 'king' ? 1 : rnd(0.5, 1.1);
    if (t === 'knight' || t === 'king') { Sfx.play('boss'); Sfx.setMusic('boss'); V.cb.banner(EDATA[t].name, 'Defend the village!'); }
  }
  if (!r.queue.length && !V.enemies.some(e => !e.dying)) endRaid();
}

// ---------------------------------------------------------------- main step
function step(dt) {
  if (V.state !== 'play' || V.paused) return;
  if (V.hitstop > 0) { V.hitstop = Math.max(0, V.hitstop - dt); dt *= 0.12; }   // a brief freeze-frame on heavy hits
  V.time += dt;
  updateTrees(dt);
  for (const f of V.slashFx) f.t += dt;
  V.slashFx = V.slashFx.filter(f => f.t < 0.32);
  updateHero(dt); updateGuards(dt); updateDefenses(dt);
  if (typeof Life !== 'undefined') Life.update(dt, V.time);
  for (const e of V.enemies) e.update(dt);
  V.enemies = V.enemies.filter(e => !e.dead);
  updateProjectiles(dt); updateRaid(dt);
  for (const p of V.parts) { p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  V.parts = V.parts.filter(p => p.life > 0);
  if (V.parts.length > 500) V.parts.splice(0, V.parts.length - 500);
  for (const t of V.texts) t.t += dt;
  V.texts = V.texts.filter(t => t.t < t.life);
  for (const r of V.rings) r.t += dt;
  V.rings = V.rings.filter(r => r.t < 0.5);
  V.shake = Math.max(0, V.shake - dt * 25);
  // smoke from badly damaged buildings
  for (const b of V.buildings) if (b.state === 'built' && b.hp < b.maxHp * 0.5 && Math.random() < dt * 5) burst(b.i + b.w / 2 + rnd(-0.4, 0.4), b.j + b.d / 2 + rnd(-0.4, 0.4), 1, ['#555', '#777', '#ff9a40'], 20, 0.9, 60);
}

// ---------------------------------------------------------------- setup / save / load
function layoutTrees(removed) {
  V.trees = Trees.generate(V.seed);
  V.occ.fill(0);
  const rm = new Set((removed || []).map(r => r[0] + ',' + r[1]));
  for (const t of V.trees) { if (rm.has(t.i + ',' + t.j)) t.alive = false; else V.occ[t.j * GN + t.i] = -1; }
}
function newVillage() {
  V.seed = 1 + Math.floor(Math.random() * 1e6);
  Object.assign(V, { res: { gold: 300, wood: 200 }, buildings: [], hero: null, guards: [], villagers: [], slashFx: [], hitstop: 0, enemies: [], proj: [], parts: [], texts: [], rings: [], heroLevel: 1, heroXp: 0, nextId: 1, time: 0, state: 'play', kills: 0, selected: null, selHero: false, selEnemy: null, paused: false });
  V.raid = { n: 1, active: false, queue: [], spawnT: 0, lanes: [], killed: 0, bestN: 0 };
  Terr.level = 1;
  Ground.build(V.seed); layoutTrees();
  const m = MID;
  addBuilding('townhall', m - 1, m - 1);
  addBuilding('archer', m + 3, m + 2);
  addBuilding('archer', m - 4, m - 3);
  addBuilding('goldmine', m + 4, m - 3, { prod: 40 });
  addBuilding('lumbercamp', m - 4, m + 3, { prod: 30 });
  addBuilding('builderhut', m + 3, m + 6);
  spawnHero();
  V.cb.expanded(Terr.level, true);
  V.cb.changed();
}
// ---------------------------------------------------------------- map expansion
function expandInfo() { const L = Terr.level; return L >= TERR_R.length ? null : Object.assign({ level: L + 1 }, EXPAND[L]); }
function expandCheck() {
  const e = expandInfo();
  if (!e) return 'The whole island is already yours.';
  if (hallLevel() < e.th) return `Expanding needs Town Hall level ${e.th}.`;
  if (V.raid.active) return 'Not during a raid.';
  if (!canAfford({ gold: e.gold, wood: e.wood })) return 'Not enough resources.';
  return null;
}
function expandMap() {
  const why = expandCheck();
  if (why) return why;
  const e = expandInfo();
  pay({ gold: e.gold, wood: e.wood });
  Terr.level = e.level;
  Sfx.play('cloud'); Sfx.play('dawn'); V.shake = Math.max(V.shake, 6);
  V.cb.expanded(Terr.level, false);
  V.cb.banner('The clouds part', `New land revealed: ${Terr.r * 2 + 1} x ${Terr.r * 2 + 1} tiles`);
  V.cb.changed();
  return null;
}
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      seed: V.seed, res: V.res, terr: Terr.level, raid: V.raid.n, best: V.raid.bestN, heroLevel: V.heroLevel, heroXp: V.heroXp, kills: V.kills, t: Date.now(),
      removed: V.trees.filter(t => !t.alive).map(t => [t.i, t.j]),
      b: V.buildings.map(b => ({ type: b.type, i: b.i, j: b.j, level: b.level, state: b.state, hp: b.hp, buildT: b.buildT, buildTotal: b.buildTotal, up: b.up, prod: b.prod })),
    }));
  } catch (e) { /* storage unavailable */ }
}
function loadGame() {
  let s;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { s = null; }
  if (!s || !s.b || !s.b.some(b => b.type === 'townhall' && b.state !== 'ruin')) return false;
  Object.assign(V, { res: s.res, buildings: [], hero: null, guards: [], villagers: [], slashFx: [], hitstop: 0, enemies: [], proj: [], parts: [], texts: [], rings: [], heroLevel: s.heroLevel || 1, heroXp: s.heroXp || 0, nextId: 1, time: 0, state: 'play', kills: s.kills || 0, selected: null, selHero: false, selEnemy: null, paused: false, seed: s.seed });
  V.raid = { n: s.raid || 1, active: false, queue: [], spawnT: 0, lanes: [], killed: 0, bestN: s.best || 0 };
  Terr.level = clamp(s.terr || 1, 1, TERR_R.length);
  Ground.build(V.seed); layoutTrees(s.removed);
  const away = clamp((Date.now() - (s.t || Date.now())) / 1000, 0, 1800);
  for (const o of s.b) {
    const b = addBuilding(o.type, o.i, o.j, { level: o.level, state: o.state, hp: o.hp, buildT: o.buildT, buildTotal: o.buildTotal, up: o.up, prod: o.prod });
    const d = BDEF[b.type];
    if (b.state === 'building') { b.buildT -= away; }
    if (b.state === 'built' && d.kind === 'collector') b.prod = Math.min(d.store[b.level - 1], b.prod + d.rate[b.level - 1] * away * 0.5);
    if (b.state === 'built') b.hp = b.maxHp;
  }
  spawnHero();
  V.cb.expanded(Terr.level, true);
  if (away > 60) toast(`Welcome back. Your collectors worked while you were away.`);
  V.cb.changed();
  return true;
}
