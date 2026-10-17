'use strict';
// Village mode, part 6: input, panels (shop, info, world map) and the main loop.
const $ = id => document.getElementById(id);
const ICO = { gold: '◉', wood: '⌾' };
const costHtml = (cost, ok) => cost ? Object.keys(cost).map(k => `<span class="cost ${V.res[k] >= cost[k] ? '' : 'short'}">${ICO[k]} ${cost[k]} ${k}</span>`).join('') : '';

// ---------------------------------------------------------------- hit testing
function groundTile(wx, wy) { const p = unIso(wx, wy); return { i: Math.floor(p.i), j: Math.floor(p.j), fi: p.i, fj: p.j }; }
function pickEnemy(wx, wy) {
  let best = null, bd = 1e9;
  for (const e of V.enemies) {
    if (e.dying) continue;
    const ex = isoX(e.i, e.j), ey = isoY(e.i, e.j) - (e.flying ? 26 : 0) - 24 * e.d.scale / 0.5;
    const d = Math.hypot(wx - ex, wy - ey), r = (e.boss ? 46 : 26);
    if (d < r && d < bd) { bd = d; best = e; }
  }
  return best;
}
function pickBuilding(wx, wy) {
  for (const dy of [0, 14, 28, 44, 62, 82]) {
    const g = groundTile(wx, wy + dy), o = occAt(g.i, g.j);
    if (o > 0) return bById(o);
  }
  // ruins are not in occ
  const g = groundTile(wx, wy + 8);
  return V.buildings.find(b => b.state === 'ruin' && g.i >= b.i && g.i < b.i + b.w && g.j >= b.j && g.j < b.j + b.d) || null;
}
function pickTree(wx, wy) {
  let best = null;
  const g = groundTile(wx, wy);
  for (const t of V.trees) {
    if (!t.alive || Math.abs(t.i - g.i) > 7 || Math.abs(t.j - g.j) > 7) continue;
    const x = isoX(t.i + 0.5 + t.ox, t.j + 0.5 + t.oj), y = isoY(t.i + 0.5 + t.ox, t.j + 0.5 + t.oj);
    if (wx > x - 28 * t.s && wx < x + 28 * t.s && wy > y - 110 * t.s && wy < y + 8) { if (!best || t.i + t.j > best.i + best.j) best = t; }
  }
  return best;
}
function pickCollectorBubble(wx, wy) {
  for (const b of V.buildings) {
    const d = BDEF[b.type];
    if (d.kind !== 'collector' || b.state !== 'built') continue;
    const cx = isoX(b.i + b.w / 2, b.j + b.d / 2), cy = isoY(b.i + b.w / 2, b.j + b.d / 2) - 92 - (b.w + b.d) * 4;
    if (b.prod >= 1 && Math.hypot(wx - cx, wy - cy) < 20) return b;
  }
  return null;
}

// ---------------------------------------------------------------- tools
function setTool(t) {
  UI.tool = t; UI.place = null;
  for (const id of ['tMove', 'tGather']) $(id).classList.toggle('active', id === (t === 'move' ? 'tMove' : 'tGather'));
  canvas.style.cursor = t === 'gather' ? 'crosshair' : 'default';
  setHint(t === 'gather' ? 'Click a tree and your hero will walk over and chop it down for wood.' : null);
}
function startPlacing(type) {
  UI.place = { type }; UI.tool = 'place'; closeShop();
  setHint(`Placing ${BDEF[type].name}. Click an empty spot to build. Right-click or Esc to cancel.${type === 'wall' ? ' Hold and drag to build a line.' : ''}`);
  canvas.style.cursor = 'copy'; qbSig = ''; refreshQuickBar();
}
function cancelPlace() { if (UI.place) { UI.place = null; setTool('move'); qbSig = ''; refreshQuickBar(); } }
function setHint(text) { if (text) $('info').innerHTML = `<p>${text}</p>`; else refreshInfo(); }

let dragState = null;
function onDown(e) {
  Sfx.init();
  const r = canvas.getBoundingClientRect(); UI.mouse.x = e.clientX - r.left; UI.mouse.y = e.clientY - r.top; UI.mouse.in = true;
  dragState = { x: e.clientX, y: e.clientY, cx: UI.cam.x, cy: UI.cam.y, moved: false, button: e.button, paint: !!UI.place && UI.place.type === 'wall' && e.button === 0 };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
  if (dragState.paint) tryPlaceAtHover();
}
function onMove(e) {
  const r = canvas.getBoundingClientRect(); UI.mouse.x = e.clientX - r.left; UI.mouse.y = e.clientY - r.top; UI.mouse.in = true;
  if (dragState && !dragState.paint) {
    const dx = e.clientX - dragState.x, dy = e.clientY - dragState.y;
    if (dragState.moved || Math.hypot(dx, dy) > 6) { dragState.moved = true; UI.cam.x = dragState.cx - dx / UI.cam.zoom; UI.cam.y = dragState.cy - dy / UI.cam.zoom; UI.follow = false; $('bFollow').classList.remove('active'); clampCam(); }
  }
  updateHover();
  if (dragState && dragState.paint) tryPlaceAtHover();
}
function updateHover() {
  const wx = worldX(UI.mouse.x), wy = worldY(UI.mouse.y), g = groundTile(wx, wy);
  if (UI.place) {
    const a = placeAnchor(UI.place.type, g.fi, g.fj);
    UI.hover = { i: a.i, j: a.j, why: placeCheck(UI.place.type, a.i, a.j) || '' };
  }
  UI.hoverTree = UI.tool === 'gather' ? pickTree(wx, wy) : null;
}
function tryPlaceAtHover() {
  if (!UI.place) return;
  const why = buildNew(UI.place.type, UI.hover.i, UI.hover.j);
  if (why) { if (!dragState || !dragState.paint) toast2(why); else if (why.startsWith('Not enough') || why.includes('builders') || why.includes('allows')) { toast2(why); dragState.paint = false; } }
  else if (UI.place.type !== 'wall') { UI.place = null; setTool('move'); }
}
function onUp(e) {
  if (!dragState) return;
  const d = dragState; dragState = null;
  if (d.moved || d.paint) return;
  const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  clickWorld(worldX(sx), worldY(sy), d.button);
}
function clickWorld(wx, wy, button) {
  if (V.state !== 'play' || V.paused) return;
  if (UI.place) { if (button === 2) cancelPlace(); else { updateHover(); tryPlaceAtHover(); } return; }
  const enemy = pickEnemy(wx, wy);
  const g = groundTile(wx, wy);
  if (button === 2) { // right click = command the hero
    if (enemy) { orderAttack(enemy); return; }
    const t = pickTree(wx, wy); if (t) { orderChop(t); return; }
    if (inGrid(g.i, g.j)) { orderMove(g.fi, g.fj); pingAt(g.fi, g.fj); }
    return;
  }
  if (UI.tool === 'gather') {
    const t = pickTree(wx, wy);
    if (t) { orderChop(t); Sfx.play('place'); } else toast2('Click on a tree to chop it.');
    return;
  }
  const bubble = pickCollectorBubble(wx, wy);
  if (bubble) { collect(bubble); return; }
  if (enemy) { orderAttack(enemy); select(null); return; }
  const b = pickBuilding(wx, wy);
  if (b) { select(b); if (BDEF[b.type].kind === 'collector' && b.state === 'built' && b.prod >= 1) collect(b); return; }
  const t = pickTree(wx, wy);
  if (t) { select(null); $('info').innerHTML = '<p><b>Old tree.</b> Choose the <b>Gather tree</b> tool, then click it to have your hero chop it for wood, which also clears space to build.</p>'; return; }
  select(null);
  if (inGrid(g.i, g.j)) { orderMove(g.fi, g.fj); pingAt(g.fi, g.fj); }
}
function pingAt(i, j) { V.rings.push({ i, j, r: 0.1, max: 0.6, t: 0 }); }

// ---------------------------------------------------------------- DOM panels
let toastTimer = 0;
function toast2(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800); Sfx.play('deny'); }
V.cb.toast = msg => { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); };
V.cb.banner = (text, sub) => { UI.banner = { text, sub, t: 0 }; };
V.cb.changed = () => { refreshInfo(); refreshButtons(); refreshQuickBar(); };
V.cb.expanded = (level, instant) => { Clouds.expanded(level, instant, UI.time); clampCam(); };

function select(b) { V.selected = b; refreshInfo(); }
function statLines(b) {
  const d = BDEF[b.type], L = b.level - 1, out = [];
  if (d.kind === 'collector') out.push(`Produces ${d.rate[L]}/s ${d.res}`, `Holds ${d.store[L]} (now ${Math.floor(b.prod)})`);
  if (d.kind === 'defense') out.push(`Damage ${d.dmg[L]} per shot`, `Range ${d.range} tiles`, d.ground && !d.air ? 'Ground only' : 'Ground and air', d.splash ? 'Splash damage' : '');
  if (d.kind === 'storage') out.push(`Adds ${d.cap[L]} gold and wood capacity`);
  if (d.kind === 'core') out.push(`Base storage ${d.cap[L]} each`, `Builders ${builderCount()}`);
  if (d.kind === 'trap') out.push(`Damage ${d.dmg[L]}`, b.armed ? 'Armed' : 'Sprung (re-arms after the raid)');
  if (d.kind === 'shrine') out.push(`Heals units ${d.heal[L]}/s`, `Mends buildings ${d.mend[L]}/s`, `Radius ${d.radius} tiles`);
  if (d.kind === 'hut') out.push('+1 builder');
  if (d.minRange) out.push(`Cannot hit within ${d.minRange} tiles`);
  if (d.kind === 'barracks') out.push(`Trains ${d.guards[L]} guards (HP ${d.ghp[L]}, damage ${d.gdmg[L]})`);
  return out.filter(Boolean);
}
function refreshInfo() {
  const el = $('info'), b = V.selected;
  if (!b || !V.buildings.includes(b)) {
    V.selected = null;
    el.innerHTML = V.raid.active
      ? `<p><b>Raid ${V.raid.n} in progress.</b> Right-click an enemy to attack it with your hero, or press <b>Hero strike</b> for a shockwave. Defenses fire on their own.</p>`
      : `<p>Welcome to your village. Clouds hide the land you have not claimed yet: use <b>Expand map</b> to push them back. Tap a mine or lumber camp to collect, build from the <b>quick bar</b> or the <b>Village shop</b>, and right-click to command your hero. Start a raid when you are ready.</p>`;
    return;
  }
  const d = BDEF[b.type];
  let h = `<div class="selhead"><b>${d.name}</b> <span class="lv">Level ${b.level}${b.type === 'townhall' || (d.maxLevel === 1) ? '' : ' / ' + hallLevel()}</span></div>`;
  if (b.state === 'ruin') {
    h += `<p>Ruins. Rebuild at half cost: ${costHtml(rebuildCost(b))}</p><div class="acts"><button class="btn gold" id="aRebuild">Rebuild</button></div>`;
  } else if (b.state === 'building') {
    h += `<p>${b.up ? 'Upgrading to level ' + b.up : 'Under construction'}: <b>${Math.ceil(b.buildT)}s</b> left.</p>`;
  } else {
    h += `<p>${d.desc}</p><p class="stats">HP ${Math.ceil(b.hp)} / ${b.maxHp} · ${statLines(b).join(' · ')}</p><div class="acts">`;
    if (d.kind === 'collector') h += `<button class="btn gold" id="aCollect">Collect ${Math.floor(b.prod)} ${d.res}</button>`;
    if (b.level < (d.maxLevel || 3)) {
      const why = upgradeCheck(b), c = d.cost[b.level];
      h += `<button class="btn ${why ? '' : 'gold'}" id="aUpgrade" title="${why || ''}">Upgrade to ${b.level + 1}</button><span class="costs">${costHtml(c)} <span class="cost">${d.time[b.level]}s</span></span>`;
    } else if (!d.maxLevel) h += '<span class="costs">Max level</span>';
    h += '</div>';
  }
  el.innerHTML = h;
  const bind = (id, fn) => { const x = $(id); if (x) x.onclick = fn; };
  bind('aCollect', () => { collect(b); refreshInfo(); });
  bind('aUpgrade', () => { const why = upgradeBuilding(b); if (why) toast2(why); else refreshInfo(); });
  bind('aRebuild', () => { const why = rebuildRuin(b); if (why) toast2(why); else refreshInfo(); });
}
function refreshButtons() {
  const r = V.raid;
  const rb = $('tRaid');
  rb.textContent = r.active ? `Raid ${r.n} · ${r.queue.length + V.enemies.filter(e => !e.dying).length} left` : `Start raid ${r.n}`;
  rb.disabled = r.active || V.state !== 'play';
  const ex = expandInfo(), eb = $('tExpand');
  eb.querySelector('span').textContent = ex ? `☁ Expand map  ◉${ex.gold} ⌾${ex.wood}${hallLevel() < ex.th ? ' (Hall ' + ex.th + ')' : ''}` : '☁ Map fully open';
  eb.disabled = !ex; eb.classList.toggle('short', !!ex && !!expandCheck());
  $('chipState').textContent = V.state === 'lost' ? 'Village fallen' : r.active ? `Raid ${r.n} in progress` : 'Peaceful preparation';
  $('chipState').classList.toggle('danger', r.active);
}
function refreshHud() {
  const c = caps();
  $('rGold').textContent = `${Math.floor(V.res.gold)} / ${c.gold}`; $('rWood').textContent = `${Math.floor(V.res.wood)} / ${c.wood}`;
  $('rBuild').textContent = `${builderCount() - busyBuilders()}/${builderCount()}`;
  const hall = V.buildings.find(b => b.type === 'townhall');
  $('chipHp').textContent = `Hall ${hall ? Math.ceil(hall.hp) : 0} · Hero ${V.hero ? (V.hero.dead ? 'down ' + Math.ceil(V.hero.respawn) + 's' : Math.ceil(V.hero.hp)) : 0}`;
  const sb = $('tStrike'), cd = V.hero ? V.hero.strikeCd : 0;
  sb.style.setProperty('--cd', cd > 0 ? (cd / HERO_DEF.strikeCd * 100) + '%' : '0%'); sb.classList.toggle('cooling', cd > 0);
  sb.querySelector('span').textContent = cd > 0 ? `Hero strike (${Math.ceil(cd)}s)` : 'Hero strike';
  $('pLevel').textContent = `Hero level ${V.heroLevel} · ${V.heroXp}/${24 * V.heroLevel} XP`;
  $('pXp').style.width = (V.heroXp / (24 * V.heroLevel) * 100) + '%';
  $('mapInfo').textContent = `Territory ${Terr.r * 2 + 1} × ${Terr.r * 2 + 1} of ${GN} × ${GN}${Terr.level >= TERR_R.length ? ' · fully open' : ''}`;
  $('lost').classList.toggle('show', V.state === 'lost');
  if (V.state === 'lost') $('lostStats').textContent = `You repelled ${V.raid.n - 1} raid${V.raid.n === 2 ? '' : 's'}, slew ${V.kills} undead and your hero reached level ${V.heroLevel}.`;
}

// ---- shop and quick-build bar
let shopCat = 'Economy';
function thumb(type, size) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const s = BART.get(type, 1, 0), g = cv.getContext('2d'), small = BDEF[type].w === 1 && type !== 'lantern' || type === 'garden';
  const content = type === 'wall' || type === 'trap' ? size * 0.8 : size * 1.1, sc = Math.min(type === 'wall' || type === 'trap' || type === 'lantern' ? 2.4 : 1.3, content / Math.max(s.canvas.width - 40, s.canvas.height - 30));
  g.drawImage(s.canvas, size / 2 - s.ox * sc, size * 0.68 - s.oy * sc, s.canvas.width * sc, s.canvas.height * sc);
  if (type === 'cannon' || type === 'mortar') { const mort = type === 'mortar'; g.strokeStyle = '#1c1c22'; g.lineWidth = (mort ? 15 : 11) * sc; g.lineCap = 'round'; g.beginPath(); g.moveTo(size / 2 - 4, size * 0.68 + s.turret.y * sc); g.lineTo(size / 2 + (mort ? 11 : 22) * sc, size * 0.68 + s.turret.y * sc + (mort ? 6 : 10) * sc); g.stroke(); g.strokeStyle = '#4a4c54'; g.lineWidth = (mort ? 11 : 7) * sc; g.stroke(); }
  return cv;
}
function buildReason(type) {
  const d = BDEF[type], n = countOf(type), max = maxCount(type);
  if (max === 0) return `Needs Town Hall ${minHallFor(type)}`;
  if (n >= max) return 'Limit reached';
  if (!canAfford(d.cost[0])) return 'Not enough resources';
  if (busyBuilders() >= builderCount()) return 'Builders busy';
  return '';
}
function tryStartPlacing(type) {
  const why = buildReason(type);
  if (why === 'Limit reached') { toast2(`Town Hall level ${hallLevel()} allows ${maxCount(type)} ${BDEF[type].name}${maxCount(type) > 1 ? 's' : ''}. Upgrade it for more.`); return; }
  if (why === 'Needs Town Hall ' + minHallFor(type)) { toast2(`${BDEF[type].name} ${why.toLowerCase()}.`); return; }
  if (why) { toast2(why + '.'); return; }
  startPlacing(type);
}
function openShop() {
  const tabs = $('shopTabs'); tabs.innerHTML = '';
  for (const c of SHOP_CATS) { const b = document.createElement('button'); b.textContent = c; b.className = c === shopCat ? 'on' : ''; b.onclick = () => { shopCat = c; openShop(); }; tabs.appendChild(b); }
  const grid = $('shopGrid'); grid.innerHTML = '';
  for (const type of SHOP_ORDER) {
    const d = BDEF[type];
    if (d.cat !== shopCat) continue;
    const n = countOf(type), max = maxCount(type), cost = d.cost[0], why = buildReason(type);
    const card = document.createElement('button');
    card.className = 'card-b' + (why === 'Limit reached' || why.startsWith('Needs') ? ' full' : '') + (why === 'Not enough resources' ? ' poor' : '');
    card.appendChild(thumb(type, 84));
    const body = document.createElement('div'); body.className = 'cb';
    body.innerHTML = `<b>${d.name}</b><small>${d.desc}</small><div class="row">${costHtml(cost)}</div><div class="row meta"><span>${why.startsWith('Needs') ? why : n + ' / ' + max + ' built'}</span><span>${d.time[0]}s</span></div>`;
    card.appendChild(body);
    card.onclick = () => tryStartPlacing(type);
    grid.appendChild(card);
  }
  $('shop').classList.add('show'); $('shopRes').innerHTML = `${ICO.gold} ${Math.floor(V.res.gold)} gold · ${ICO.wood} ${Math.floor(V.res.wood)} wood · Builders ${builderCount() - busyBuilders()}/${builderCount()}`;
}
function closeShop() { $('shop').classList.remove('show'); }
let qbSig = '';
function refreshQuickBar() {
  const bar = $('qbar'); if (!bar) return;
  const sig = SHOP_ORDER.map(t => buildReason(t) + countOf(t)).join('|') + (UI.place ? UI.place.type : '') + hallLevel();
  if (sig === qbSig) return; qbSig = sig;
  bar.innerHTML = '';
  for (const type of SHOP_ORDER) {
    if (maxCount(type) === 0) continue;
    const d = BDEF[type], why = buildReason(type), b = document.createElement('button');
    b.className = (why ? 'off ' : '') + (UI.place && UI.place.type === type ? 'on' : '');
    b.appendChild(thumb(type, 50));
    const n = document.createElement('small'); n.textContent = `${countOf(type)}/${maxCount(type)}`; b.appendChild(n);
    const tip = document.createElement('div'); tip.className = 'tip'; tip.textContent = `${d.name}: ${Object.keys(d.cost[0]).map(k => d.cost[0][k] + ' ' + k).join(', ')}${why ? ' (' + why + ')' : ''}`; b.appendChild(tip);
    b.onclick = () => tryStartPlacing(type);
    bar.appendChild(b);
  }
}

// ---- world map
function drawWorldMap() {
  const c = $('mapCanvas'), g = c.getContext('2d'), W = c.width, H = c.height;
  g.fillStyle = '#1f3038'; g.fillRect(0, 0, W, H);
  const sc = (W - 40) / (GN * TW), ox = W / 2, oy = 24;
  const P2 = (i, j) => [ox + isoX(i, j) * sc, oy + isoY(i, j) * sc];
  g.fillStyle = '#5c7a48'; g.beginPath(); const pts = [P2(0, 0), P2(GN, 0), P2(GN, GN), P2(0, GN)]; g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.closePath(); g.fill();
  g.fillStyle = '#8c7658'; for (const [a, b] of [[MID - 1, 0], [0, MID - 1]]) { const q = [P2(a, b), P2(a + (a ? GN : 3), b + (b ? GN : 3)), P2(a + 3, b + GN), P2(a + GN, b + 3)]; }
  g.fillStyle = 'rgba(138,114,84,.9)';
  for (const quad of [[MID - 1, 0, 3, GN], [0, MID - 1, GN, 3]]) { const [i, j, w, d] = quad; g.beginPath(); const q = [P2(i, j), P2(i + w, j), P2(i + w, j + d), P2(i, j + d)]; g.moveTo(...q[0]); for (const p of q.slice(1)) g.lineTo(...p); g.closePath(); g.fill(); }
  g.fillStyle = 'rgba(224,236,242,.92)';                                   // clouds over land you have not claimed
  { const lo = MID - Terr.r, hi = MID + Terr.r + 1, q = [P2(0, 0), P2(GN, 0), P2(GN, GN), P2(0, GN)], h = [P2(lo, lo), P2(lo, hi), P2(hi, hi), P2(hi, lo)];
    g.beginPath(); g.moveTo(...q[0]); for (const p of q.slice(1)) g.lineTo(...p); g.closePath(); g.moveTo(...h[0]); for (const p of h.slice(1)) g.lineTo(...p); g.closePath(); g.fill('evenodd'); }
  g.fillStyle = '#3d6038'; for (const t of V.trees) if (Terr.has(t.i, t.j)) if (t.alive) { const p = P2(t.i + 0.5, t.j + 0.5); g.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3); }
  for (const b of V.buildings) { const p = P2(b.i + b.w / 2, b.j + b.d / 2); g.fillStyle = b.state === 'ruin' ? '#555' : b.type === 'townhall' ? '#e8c24a' : BDEF[b.type].kind === 'defense' ? '#d86a5a' : b.type === 'wall' ? '#aaa' : '#8ab8e0'; const s = b.type === 'wall' ? 2 : 4 + b.w; g.fillRect(p[0] - s / 2, p[1] - s / 2, s, s); }
  for (const e of V.enemies) { if (!Terr.has(e.i, e.j)) continue; const p = P2(e.i, e.j); g.fillStyle = '#ff4a3a'; g.fillRect(p[0] - 2, p[1] - 2, e.boss ? 6 : 4, e.boss ? 6 : 4); }
  if (V.hero) { const p = P2(V.hero.i, V.hero.j); g.fillStyle = '#fff'; g.beginPath(); g.arc(p[0], p[1], 4, 0, 6.283); g.fill(); g.strokeStyle = '#3a8ae0'; g.lineWidth = 2; g.stroke(); }
  const vw = UI.W / UI.cam.zoom * sc, vh = UI.H / UI.cam.zoom * sc;
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.strokeRect(ox + UI.cam.x * sc - vw / 2, oy + UI.cam.y * sc - vh / 2, vw, vh);
}
function openMap() { $('worldmap').classList.add('show'); UI.mapOpen = true; }
function closeMap() { $('worldmap').classList.remove('show'); UI.mapOpen = false; }

// ---------------------------------------------------------------- wiring
function setZoom(z, ax, ay) {
  const old = UI.cam.zoom; z = clamp(z, 0.45, 1.7);
  if (ax !== undefined) { const wx = worldX(ax), wy = worldY(ay); UI.cam.zoom = z; UI.cam.x = wx - (ax - UI.W / 2) / z; UI.cam.y = wy - (ay - UI.H / 2) / z; }
  else UI.cam.zoom = z;
  clampCam();
}
function wire() {
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', () => { dragState = null; });
  canvas.addEventListener('pointerleave', () => { UI.mouse.in = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); setZoom(UI.cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  $('tMove').onclick = () => setTool('move'); $('tGather').onclick = () => setTool('gather');
  $('tShop').onclick = () => { setTool('move'); openShop(); };
  $('tStrike').onclick = () => heroStrike();
  $('tExpand').onclick = () => { const why = expandMap(); if (why) toast2(why); };
  $('tRaid').onclick = () => { if (V.hero && V.hero.dead) toast2('Your hero is down, but the raid will begin anyway.'); startRaid(); };
  $('shopClose').onclick = closeShop; $('shop').onclick = e => { if (e.target === $('shop')) closeShop(); };
  $('bMinus').onclick = () => setZoom(UI.cam.zoom / 1.2); $('bPlus').onclick = () => setZoom(UI.cam.zoom * 1.2);
  $('bVillage').onclick = () => { const h = hallCenter(); centerOn(h.i, h.j); UI.follow = false; $('bFollow').classList.remove('active'); };
  $('bFollow').onclick = () => { UI.follow = !UI.follow; $('bFollow').classList.toggle('active', UI.follow); };
  $('bMap').onclick = openMap; $('mapClose').onclick = closeMap;
  $('mapCanvas').onclick = e => { const c = $('mapCanvas'), r = c.getBoundingClientRect(), sc = (c.width - 40) / (GN * TW), x = (e.clientX - r.left) * c.width / r.width, y = (e.clientY - r.top) * c.height / r.height; UI.cam.x = (x - c.width / 2) / sc; UI.cam.y = (y - 24) / sc; UI.follow = false; clampCam(); closeMap(); };
  $('bPause').onclick = () => { V.paused = !V.paused; $('bPause').textContent = V.paused ? 'Resume' : 'Pause'; };
  $('bNew').onclick = () => { if (confirm('Abandon this village and start a new one?')) { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } newVillage(); const h = hallCenter(); centerOn(h.i, h.j); } };
  $('lostNew').onclick = () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } newVillage(); const h = hallCenter(); centerOn(h.i, h.j); };
  $('bSound').onclick = () => { Sfx.muted = !Sfx.muted; $('bSound').textContent = Sfx.muted ? 'Sound off' : 'Sound on'; };
  window.addEventListener('keydown', e => {
    Sfx.init();
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    switch (e.code) {
      case 'Escape': cancelPlace(); closeShop(); closeMap(); setTool('move'); select(null); break;
      case 'Digit1': setTool('move'); break; case 'Digit2': setTool('gather'); break; case 'Digit3': openShop(); break;
      case 'Space': e.preventDefault(); heroStrike(); break; case 'KeyR': startRaid(); break;
      case 'Equal': case 'NumpadAdd': setZoom(UI.cam.zoom * 1.15); break; case 'Minus': case 'NumpadSubtract': setZoom(UI.cam.zoom / 1.15); break;
      case 'KeyE': $('tExpand').click(); break; case 'KeyF': $('bFollow').click(); break; case 'KeyM': UI.mapOpen ? closeMap() : openMap(); break; case 'KeyP': $('bPause').click(); break;
    }
  });
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', saveGame); document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
  new ResizeObserver(resize).observe(canvas.parentElement);
}

// ---------------------------------------------------------------- loop
let last = 0, hudT = 0, saveT = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
  try {
    step(dt);
    if (UI.banner) { UI.banner.t += dt; if (UI.banner.t > 3) UI.banner = null; }
    if (UI.follow && V.hero) { const k = 1 - Math.exp(-dt * 5); UI.cam.x += (isoX(V.hero.i, V.hero.j) - UI.cam.x) * k; UI.cam.y += (isoY(V.hero.i, V.hero.j) - 20 - UI.cam.y) * k; }
    if (UI.mouse.in) updateHover();
    render(ts);
    hudT -= dt; if (hudT <= 0) { hudT = 0.12; refreshHud(); if (V.selected && !dragState) { const sel = V.selected; if (sel.state === 'building' || (BDEF[sel.type].kind === 'collector') || sel.hp < sel.maxHp) refreshInfoLive(); } if (UI.mapOpen) drawWorldMap(); if ($('shop').classList.contains('show')) $('shopRes').innerHTML = `${ICO.gold} ${Math.floor(V.res.gold)} gold · ${ICO.wood} ${Math.floor(V.res.wood)} wood · Builders ${builderCount() - busyBuilders()}/${builderCount()}`; }
    saveT -= dt; if (saveT <= 0) { saveT = 10; if (V.state === 'play') saveGame(); }
  } catch (err) { showError(err); return; }
  requestAnimationFrame(frame);
}
let infoSig = '';
function refreshInfoLive() {
  const b = V.selected; if (!b) return;
  const sig = [b.id, b.level, b.state, Math.ceil(b.buildT), Math.floor(b.prod / 3), Math.ceil(b.hp / 20), Object.values(V.res).map(v => Math.floor(v / 10)).join(',')].join('|');
  if (sig !== infoSig) { infoSig = sig; refreshInfo(); }
}
function showError(err) { console.error(err); const el = $('err'); el.style.display = 'flex'; el.textContent = 'Something went wrong: ' + err.message; }

Assets.load().then(() => {
  Trees.build(); Clouds.build(); wire(); resize();
  if (!loadGame()) newVillage();
  const h = hallCenter(); centerOn(h.i, h.j + 2); UI.cam.zoom = UI.W < 700 ? 0.7 : 0.95; refreshQuickBar();
  setTool('move'); refreshButtons(); refreshHud();
  window.__ready = true;
  requestAnimationFrame(frame);
}).catch(showError);
