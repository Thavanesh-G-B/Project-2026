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
function pickHero(wx, wy) {
  const h = V.hero; if (!h || h.dead && h.respawn < 11) return null;
  return Math.hypot(wx - isoX(h.i, h.j), wy - (isoY(h.i, h.j) - 30)) < 30 ? h : null;
}
function pickBuilding(wx, wy) {
  // first the building whose picture is under the cursor (front-most wins); then fall back to the footprint under it
  let best = null, bk = -1;
  for (const b of V.buildings) {
    if (b.state === 'ruin') continue;
    const lvl = b.state === 'building' && !b.up ? 1 : b.level, s = BART.get(b.type, lvl, b.type === 'wall' ? wallMask(b) : 0);
    const cx = isoX(b.i + b.w / 2, b.j + b.d / 2), cy = isoY(b.i + b.w / 2, b.j + b.d / 2), W = s.canvas.width, H = s.canvas.height;
    const x0 = cx - s.ox + W * 0.18, x1 = cx - s.ox + W * 0.82, y0 = cy - s.oy + H * 0.08, y1 = cy - s.oy + H * 0.96;
    if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) { const k = b.i + b.j + b.w + b.d; if (k > bk) { bk = k; best = b; } }
  }
  if (best) return best;
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
    if (!t.alive || t.felled || Math.abs(t.i - g.i) > 7 || Math.abs(t.j - g.j) > 7) continue;
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
  const enemy = pickEnemy(wx, wy), heroHit = button === 0 && UI.tool !== 'gather' ? pickHero(wx, wy) : null;
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
  if (heroHit) { selectHero(); Sfx.play('open'); return; }
  if (enemy) { selectEnemy(enemy); Sfx.play('click'); return; }
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

function select(b) { V.selected = b; V.selHero = false; V.selEnemy = null; refreshInfo(); }
function selectHero() { V.selected = null; V.selEnemy = null; V.selHero = true; refreshInfo(); }
function selectEnemy(e) { V.selected = null; V.selHero = false; V.selEnemy = e; refreshInfo(); }
let infoHtml = '';
const barH = (cls, f, trail) => `<span class="hbar ${cls}${f < 0.3 && f > 0 && cls === 'hero' ? ' low' : ''}"><i class="fill" style="transform:scaleX(${clamp(f, 0, 1).toFixed(3)});transition:none"></i></span>`;
function portraitStyle(k, bw, bh, top) {
  k = k || 1.15; bw = bw || 62; bh = bh || 84;
  const A = window.HERO_ATLAS, t = heroTierNow(), F = A.frames.w_S_0, w = F[2] * k, h2 = F[3] * k;
  return `background-image:url(assets/sprites/hero_${t ? 'a' + t : 'hero'}.png);background-size:${A.w * k}px ${A.h * k}px;background-position:${-F[0] * k + (bw - w) / 2}px ${top ? -F[1] * k + 1 : -F[1] * k + (bh - h2) / 2 - 2}px`;
}
function heroState(h) {
  if (h.dead) return `Fallen. Returns in ${Math.ceil(h.respawn)}s`;
  if (h.strikeT >= 0) return 'Unleashing Hero strike';
  if (h.atk >= 0 || (h.order && h.order.type === 'attack')) return `Fighting${h.order && h.order.e && !h.order.e.dying ? ' ' + h.order.e.d.name : ''}`;
  if (h.chopping) return 'Chopping a tree';
  if (h.order && h.order.type === 'chop') return 'Heading to a tree';
  if ((h.path && h.path.length) || h.kbMove) return 'On the move';
  return `Idle · ${h.stance} stance`;
}
const eid = e => e.uid || (e.uid = ++V.uidn);
function heroPanel() {
  const h = V.hero, st = heroStats(), t = heroTierNow(), cdS = HERO_DEF.strikeCd;
  const title = HERO_DEF.titles[Math.min(3, Math.floor((V.heroLevel - 1) / 4))], dps = (st.dmg / HERO_DEF.cd);
  const need = 24 * V.heroLevel, ok = !h.dead;
  const strikeWhy = !ok ? 'down' : h.strikeCd > 0 ? Math.ceil(h.strikeCd) + 's' : h.mana < HERO_DEF.strikeMana ? 'no mana' : '';
  const healWhy = !ok ? 'down' : h.healCd > 0 ? Math.ceil(h.healCd) + 's' : h.mana < HERO_DEF.healMana ? 'no mana' : h.hp >= h.maxHp ? 'full hp' : '';
  const cryWhy = !ok ? 'down' : V.heroLevel < HERO_DEF.cryLevel ? 'level ' + HERO_DEF.cryLevel : h.cryCd > 0 ? Math.ceil(h.cryCd) + 's' : h.mana < HERO_DEF.cryMana ? 'no mana' : '';
  const tgt = h.order && h.order.type === 'attack' && h.order.e && !h.order.e.dying ? h.order.e : null;
  const foes = V.enemies.filter(e => !e.dying && Terr.has(e.i, e.j)).sort((a, b) => Math.hypot(a.i - h.i, a.j - h.j) - Math.hypot(b.i - h.i, b.j - h.j)).slice(0, 6);
  return `<div class="hp">
    <div>
      <div class="hp-id"><div class="portrait" style="${portraitStyle()}"></div><div><div class="hname">${HERO_DEF.name}<small>${title} · Level ${V.heroLevel}</small></div><div class="hstate">${heroState(h)}</div></div></div>
      <div class="hbars"><span>HP</span>${barH('hero', h.hp / h.maxHp)}<b>${Math.ceil(h.hp)}/${h.maxHp}</b><span>MP</span>${barH('mana', h.mana / h.maxMana)}<b>${Math.floor(h.mana)}/${h.maxMana}</b><span>XP</span>${barH('xp', V.heroXp / need)}<b>${V.heroXp}/${need}</b></div>
    </div>
    <div class="hmid">
      <div class="hstats">
        <div><span>Damage per hit</span><b>${st.dmg}</b></div><div><span>Attack speed</span><b>${(1 / HERO_DEF.cd).toFixed(1)} hits/s · ${dps.toFixed(0)} dps</b></div><div><span>Reach</span><b>${HERO_DEF.range} tiles</b></div>
        <div><span>Strike</span><b>${Math.round(st.dmg * HERO_DEF.strikeDmg)} dmg · radius ${HERO_DEF.strikeRadius}</b></div><div><span>Armor</span><b>${HERO_DEF.armorName[t]}${st.red ? ' (-' + Math.round(st.red * 100) + '% dmg)' : ''}</b></div><div><span>Speed · mana regen</span><b>${st.speed.toFixed(2)} · ${(st.regen * (V.raid.active ? 1 : 1.8)).toFixed(1)}/s</b></div>
        <div><span>Hero kills</span><b>${h.hero_kills}</b></div><div><span>Village kills</span><b>${V.kills}</b></div><div><span>Raids survived</span><b>${V.raid.n - 1}</b></div>
      </div>
      <div class="htargets">${foes.length ? '<span style="color:var(--mute);align-self:center">Attack:</span>' + foes.map(e => `<div class="tg${tgt === e ? ' on' : ''}"><span>${e.d.name}</span>${barH('raid', e.hp / e.maxHp)}<button data-act="atk" data-id="${eid(e)}">${tgt === e ? 'Targeted' : 'Attack'}</button></div>`).join('') : '<span style="color:var(--mute)">No enemies in the village. During a raid, pick a specific one here, or click an enemy on the map.</span>'}</div>
    </div>
    <div class="hacts">
      <button class="btn gold${strikeWhy ? ' off' : ''}" data-act="strike"><span>Hero strike <kbd>Space</kbd></span><span class="cost">${HERO_DEF.strikeMana} MP${strikeWhy ? ' · ' + strikeWhy : ''}</span></button>
      <button class="btn${healWhy ? ' off' : ''}" data-act="heal"><span>Second Wind <kbd>H</kbd></span><span class="cost">${HERO_DEF.healMana} MP · +${Math.round(HERO_DEF.healPct * 100)}% HP${healWhy ? ' · ' + healWhy : ''}</span></button>
      <button class="btn${cryWhy ? ' off' : ''}" data-act="cry"><span>Battle Cry <kbd>B</kbd></span><span class="cost">${HERO_DEF.cryMana} MP · +${Math.round((HERO_DEF.cryDmg - 1) * 100)}% dmg${cryWhy ? ' · ' + cryWhy : ''}</span></button>
      <button class="btn${skillPoints() ? ' gold' : ''}" data-act="train"><span>Train hero</span><span class="cost">${skillPoints()} skill point${skillPoints() === 1 ? '' : 's'}</span></button>
      <button class="btn" data-act="nearest"><span>Attack nearest <kbd>J</kbd></span></button>
      <button class="btn" data-act="stop"><span>Stop <kbd>X</kbd></span></button>
      <button class="btn" data-act="home"><span>Return to hall</span></button>
      <button class="btn" data-act="stance" title="Aggressive: hunts raiders. Defensive: only fights what comes near. Hold: stays put."><span>Stance: ${h.stance}</span></button>
    </div></div>`;
}
function enemyPanel(e) {
  const d = e.d, h = V.hero, dist = h ? Math.hypot(e.i - h.i, e.j - h.j) : 0, tgt = h && h.order && h.order.type === 'attack' && h.order.e === e;
  return `<div class="hp"><div>
      <div class="hp-id"><div class="portrait" style="background-image:none;display:grid;place-items:center;font-size:30px">${d.boss ? '☠' : d.flying ? '✦' : '☗'}</div><div><div class="hname">${d.name}<small>${d.boss ? 'Boss' : 'Raider'} · ${d.flying ? 'flying' : 'ground'}</small></div><div class="hstate">${e.dying ? 'Defeated' : dist.toFixed(1) + ' tiles from your hero'}</div></div></div>
      <div class="hbars"><span>HP</span>${barH('raid', e.hp / e.maxHp)}<b>${Math.ceil(e.hp)}/${e.maxHp}</b></div></div>
    <div class="hp-right"><div class="hstats"><div><span>Damage</span><b>${Math.round(d.dmg * (e.dmgMul || 1))}</b></div><div><span>Attack every</span><b>${d.cd}s</b></div><div><span>Range</span><b>${d.range}</b></div><div><span>Speed</span><b>${d.speed}</b></div><div><span>Hunts</span><b>${d.target === 'defense' ? 'defenses' : d.target === 'townhall' ? 'Town Hall' : 'anything'}</b></div><div><span>Reward</span><b>${d.gold} gold · ${d.xp} xp</b></div></div>
      <div class="hacts"><button class="btn red" data-act="atkSel">${tgt ? 'Hero is attacking this' : 'Attack this enemy'}</button><button class="btn" data-act="desel">Deselect</button></div></div></div>`;
}
function refreshInfoPanel() {
  const el = $('info');
  let h;
  if (V.selHero && V.hero) h = heroPanel();
  else if (V.selEnemy) { if (V.selEnemy.dead || V.selEnemy.dying) { V.selEnemy = null; return false; } h = enemyPanel(V.selEnemy); }
  else return false;
  if (h !== infoHtml) { el.innerHTML = h; infoHtml = h; }
  return true;
}
function infoAction(act, id) {
  const h = V.hero; if (!h) return;
  switch (act) {
    case 'strike': if (!heroStrike()) { } break;
    case 'heal': heroHeal(); break;
    case 'cry': heroCry(); break;
    case 'train': openResearch('hero'); break;
    case 'trade': { const [k, m] = id.split(':'); const w = trade(k, +m); if (w) toast2(w); refreshInfo(); break; }
    case 'research': openResearch('village'); break;
    case 'nearest': { const e = nearestEnemy(h.i, h.j, 99); if (e) orderAttack(e); else toast2('No enemies to attack.'); break; }
    case 'stop': heroStop(); break;
    case 'home': heroHome(); break;
    case 'stance': cycleStance(); break;
    case 'follow': UI.follow = !UI.follow; $('bFollow').classList.toggle('active', UI.follow); break;
    case 'atk': { const e = V.enemies.find(x => x.uid == id && !x.dying); if (e) { orderAttack(e); Sfx.play('click'); } break; }
    case 'atkSel': if (V.selEnemy && !V.selEnemy.dying) { orderAttack(V.selEnemy); Sfx.play('click'); } break;
    case 'desel': V.selEnemy = null; V.selHero = false; refreshInfo(); break;
  }
  refreshInfoPanel();
}
function statLines(b) {
  const d = BDEF[b.type], L = b.level - 1, out = [];
  if (d.kind === 'collector') out.push(`Produces ${d.rate[L]}/s ${d.res}`, `Holds ${d.store[L]} (now ${Math.floor(b.prod)})`);
  if (d.kind === 'defense') out.push(`Damage ${Math.round(d.dmg[L] * towerMul(b.type))} per shot`, `Range ${d.range} tiles`, d.ground && !d.air ? 'Ground only' : 'Ground and air', d.splash ? 'Splash damage' : '');
  if (d.kind === 'storage') out.push(`Adds ${d.cap[L]} gold and wood capacity`);
  if (d.kind === 'core') out.push(`Base storage ${d.cap[L]} each`, `Builders ${builderCount()}`);
  if (d.kind === 'trap') out.push(`Damage ${d.dmg[L]}`, b.armed ? 'Armed' : 'Sprung (re-arms after the raid)');
  if (d.kind === 'shrine') out.push(`Heals units ${d.heal[L]}/s`, `Mends buildings ${d.mend[L]}/s`, `Radius ${d.radius} tiles`);
  if (d.kind === 'hut') out.push('+1 builder');
  if (d.chain) out.push(`Chains to ${d.chain[L]} enemies`);
  if (d.kind === 'academy') out.push(`${TECH_ORDER.reduce((a, k) => a + tech(k), 0)} techs researched`);
  if (d.minRange) out.push(`Cannot hit within ${d.minRange} tiles`);
  if (d.kind === 'barracks') out.push(`Trains ${d.guards[L]} guards (HP ${d.ghp[L]}, damage ${d.gdmg[L]})`);
  return out.filter(Boolean);
}
function refreshInfo() {
  if (refreshInfoPanel()) return;
  infoHtml = '';
  const el = $('info'), b = V.selected;
  if (!b || !V.buildings.includes(b)) {
    V.selected = null;
    el.innerHTML = V.raid.active
      ? `<p><b>Raid ${V.raid.n} in progress.</b> Right-click an enemy to attack it with your hero, or press <b>Hero strike</b> for a shockwave. Defenses fire on their own.</p>`
      : `<p>Welcome to your village. Clouds hide the land you have not claimed yet: use <b>Expand map</b> to push them back. Tap a mine or lumber camp to collect, build from the <b>quick bar</b> or the <b>Village shop</b>, and right-click to command your hero. Treasure chests lie out in the wild: walk your hero up to one to open it. Start a raid when you are ready.</p>`;
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
    if (d.kind === 'academy') h += `<button class="btn gold" data-act="research">Open research</button>`;
    h += '</div>';
    if (d.kind === 'market') h += marketPanel();
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
  const setBar = (id, f, num, txt) => { const el = $(id); const k = clamp(f, 0, 1); el.querySelector('.fill').style.transform = `scaleX(${k})`; el.querySelector('.trail').style.transform = `scaleX(${k})`; el.classList.toggle('low', k < 0.3 && k > 0 && (id === 'barHall' || id === 'barHero')); if (num) $(num).textContent = txt; };
  setBar('barHall', hall ? hall.hp / hall.maxHp : 0, 'numHall', hall ? Math.ceil(hall.hp) : 0);
  setBar('barMana', V.hero ? V.hero.mana / V.hero.maxMana : 0, 'numMana', V.hero ? Math.floor(V.hero.mana) : 0);
  const hr = V.hero; setBar('barHero', hr && !hr.dead ? hr.hp / hr.maxHp : 0, 'numHero', hr ? (hr.dead ? Math.ceil(hr.respawn) + 's' : Math.ceil(hr.hp)) : 0);
  setBar('barXp', V.heroXp / (24 * V.heroLevel), 'numXp', 'Lv ' + V.heroLevel);
  const rr = V.raid, left = rr.active ? rr.queue.length + V.enemies.filter(e => !e.dying).length : 0;
  $('rowRaid').style.display = rr.active ? 'flex' : 'none'; $('chipHp').classList.toggle('danger', rr.active);
  if (rr.active) setBar('barRaid', rr.total ? left / rr.total : 0, 'numRaid', left);
  refreshHud2();
  { const rb = $('tResearch'); rb.classList.toggle('glow', skillPoints() > 0); }
  const sb = $('tStrike'), cd = V.hero ? V.hero.strikeCd : 0;
  sb.style.setProperty('--cd', cd > 0 ? (cd / HERO_DEF.strikeCd * 100) + '%' : '0%'); sb.classList.toggle('cooling', cd > 0);
  sb.querySelector('span').textContent = cd > 0 ? `Hero strike (${Math.ceil(cd)}s)` : `Hero strike · ${HERO_DEF.strikeMana} MP`;
  $('pLevel').textContent = `Hero level ${V.heroLevel} · ${V.heroXp}/${24 * V.heroLevel} XP`;
  $('pXp').style.width = (V.heroXp / (24 * V.heroLevel) * 100) + '%';
  $('mapInfo').textContent = `Territory ${Math.min(GN, Terr.r * 2 + 1)} × ${Math.min(GN, Terr.r * 2 + 1)} of ${GN} × ${GN}${Terr.level >= TERR_R.length ? ' · fully open' : ` · stage ${Terr.level}/${TERR_R.length}`}${SET.speed > 1 ? ` · ${SET.speed}× speed` : ''}`;
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
  if (s.turret && (type === 'cannon' || type === 'mortar')) { const mort = type === 'mortar'; g.strokeStyle = '#1c1c22'; g.lineWidth = (mort ? 15 : 11) * sc; g.lineCap = 'round'; g.beginPath(); g.moveTo(size / 2 - 4, size * 0.68 + s.turret.y * sc); g.lineTo(size / 2 + (mort ? 11 : 22) * sc, size * 0.68 + s.turret.y * sc + (mort ? 6 : 10) * sc); g.stroke(); g.strokeStyle = '#4a4c54'; g.lineWidth = (mort ? 11 : 7) * sc; g.stroke(); }
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
  for (const p of Life.props) if (p.type === 'chest' && !p.open && Terr.has(p.i, p.j)) { const q = P2(p.i + 0.5, p.j + 0.5); g.fillStyle = '#ffd24a'; g.fillRect(q[0] - 2, q[1] - 2, 4, 4); g.strokeStyle = '#6a4a10'; g.lineWidth = 1; g.strokeRect(q[0] - 2, q[1] - 2, 4, 4); }
  for (const e of V.enemies) { if (!Terr.has(e.i, e.j)) continue; const p = P2(e.i, e.j); g.fillStyle = '#ff4a3a'; g.fillRect(p[0] - 2, p[1] - 2, e.boss ? 6 : 4, e.boss ? 6 : 4); }
  if (V.hero) { const p = P2(V.hero.i, V.hero.j); g.fillStyle = '#fff'; g.beginPath(); g.arc(p[0], p[1], 4, 0, 6.283); g.fill(); g.strokeStyle = '#3a8ae0'; g.lineWidth = 2; g.stroke(); }
  const vw = UI.W / UI.cam.zoom * sc, vh = UI.H / UI.cam.zoom * sc;
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.strokeRect(ox + UI.cam.x * sc - vw / 2, oy + UI.cam.y * sc - vh / 2, vw, vh);
}
function openMap() { $('worldmap').classList.add('show'); UI.mapOpen = true; }
function closeMap() { $('worldmap').classList.remove('show'); UI.mapOpen = false; }

// ---------------------------------------------------------------- wiring
function setZoom(z, ax, ay) {
  const old = UI.cam.zoom; z = clamp(z, Terr.r > 25 ? 0.3 : Terr.r > 18 ? 0.38 : 0.45, 1.7);   // a bigger territory can be viewed from further away
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
  $('tResearch').onclick = () => { setTool('move'); openResearch(); }; $('tOptions').onclick = openOptions;
  $('resClose').onclick = closeResearch; $('research').onclick = e => { if (e.target === $('research')) closeResearch(); };
  $('optClose').onclick = closeOptions; $('options').onclick = e => { if (e.target === $('options')) closeOptions(); };
  for (const [id, fn] of [['hStrike', () => heroStrike()], ['hHeal', () => heroHeal()], ['hCry', () => heroCry()], ['hudPortrait', () => { if (V.hero) { selectHero(); centerOn(V.hero.i, V.hero.j); } }], ['hudStats', () => openResearch('hero')]]) $(id).addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
  $('tHero').onclick = () => { if (V.hero) { selectHero(); const hh = V.hero; centerOn(hh.i, hh.j); } };
  // act on mouse-down (the panel redraws as numbers change, which could swallow a click); keyboard activation still uses click
  $('info').addEventListener('mousedown', e => { const a = e.target.closest('[data-act]'); if (a && e.button === 0) { e.preventDefault(); infoAction(a.dataset.act, a.dataset.id); } });
  $('info').addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (a && e.detail === 0) infoAction(a.dataset.act, a.dataset.id); });
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
  $('bSound').onclick = () => { Sfx.init(); Sfx.setMuted(!Sfx.muted); $('bSound').textContent = Sfx.muted ? 'Sound off' : 'Sound on'; if (!Sfx.muted) Sfx.play('click'); };
  $('bMusic').onclick = () => { Sfx.init(); Sfx.setMusicOn(!Sfx.musicOn); $('bMusic').textContent = Sfx.musicOn ? 'Music on' : 'Music off'; Sfx.play('click'); };
  // sounds pan and fade with where they happen on screen; things hidden under the clouds are muffled
  Sfx.listener = (wi, wj) => {
    const z = UI.cam.zoom, sx = (isoX(wi, wj) - UI.cam.x) * z, sy = (isoY(wi, wj) - UI.cam.y) * z;
    const ox = Math.max(0, Math.abs(sx) - UI.W / 2) / UI.W, oy = Math.max(0, Math.abs(sy) - UI.H / 2) / UI.H;
    let vol = 1 - (ox + oy) * 1.6; if (!Terr.has(wi, wj)) vol *= 0.45;
    return { pan: clamp(sx / (UI.W / 2), -1, 1) * 0.8, vol: clamp(vol, 0, 1) };
  };
  const held = new Set();
  const syncInput = () => { V.input.x = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0); V.input.y = (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) - (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0); };
  window.addEventListener('keyup', e => { held.delete(e.code); syncInput(); });
  window.addEventListener('blur', () => { held.clear(); syncInput(); });
  window.addEventListener('keydown', e => {
    Sfx.init();
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !$('shop').classList.contains('show') && !$('research').classList.contains('show') && !$('options').classList.contains('show') && !UI.mapOpen) {
      e.preventDefault(); held.add(e.code); syncInput();
      if (!UI.follow) { UI.follow = true; $('bFollow').classList.add('active'); }
      return;
    }
    if (e.code === 'KeyJ' && V.hero && !V.hero.dead) { const en = nearestEnemy(V.hero.i, V.hero.j, 5); if (en) orderAttack(en); else Sfx.play('slash'); return; }
    switch (e.code) {
      case 'Escape': cancelPlace(); closeShop(); closeMap(); closeResearch(); closeOptions(); setTool('move'); select(null); break;
      case 'Digit1': setTool('move'); break; case 'Digit2': setTool('gather'); break; case 'Digit3': openShop(); break;
      case 'KeyH': heroHeal(); break; case 'KeyB': heroCry(); break; case 'KeyT': openResearch(); break; case 'KeyO': openOptions(); break; case 'KeyX': heroStop(); break; case 'KeyC': $('tHero').click(); break;
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
    for (let k = 0; k < SET.speed; k++) step(dt);
    if (UI.banner) { UI.banner.t += dt; if (UI.banner.t > 3) UI.banner = null; }
    if (UI.follow && V.hero) { const k = 1 - Math.exp(-dt * 5); UI.cam.x += (isoX(V.hero.i, V.hero.j) - UI.cam.x) * k; UI.cam.y += (isoY(V.hero.i, V.hero.j) - 20 - UI.cam.y) * k; }
    if (UI.mouse.in) updateHover();
    render(ts);
    hudT -= dt; if (hudT <= 0) { hudT = 0.12; refreshHud(); if ((V.selHero || V.selEnemy)) refreshInfoPanel(); if (V.selected && !dragState) { const sel = V.selected; if (sel.state === 'building' || (BDEF[sel.type].kind === 'collector') || sel.hp < sel.maxHp) refreshInfoLive(); } if (UI.mapOpen) drawWorldMap(); if ($('shop').classList.contains('show')) $('shopRes').innerHTML = `${ICO.gold} ${Math.floor(V.res.gold)} gold · ${ICO.wood} ${Math.floor(V.res.wood)} wood · Builders ${builderCount() - busyBuilders()}/${builderCount()}`; }
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

Promise.all([Assets.load(), Hero.load(), BLD.load(), Foes.load()]).then(() => {
  loadSettings(); Trees.build(); Clouds.build(); wire(); resize(); Sfx.setMusic('peace');
  if (!loadGame()) newVillage();
  const h = hallCenter(); centerOn(h.i, h.j + 2); UI.cam.zoom = UI.W < 700 ? 0.7 : 0.95; refreshQuickBar();
  setTool('move'); refreshButtons(); refreshHud();
  window.__ready = true;
  requestAnimationFrame(frame);
}).catch(showError);
