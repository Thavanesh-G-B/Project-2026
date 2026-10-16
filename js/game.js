'use strict';
// Ashen Hollow: game state, loop, input, rendering and UI.

const VW = 960, VH = 540;
const DAY_LEN = 130;             // seconds per full day/night cycle
const BOSS_NIGHTS = { 3: 'knight', 6: 'king' };

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const G = {
  state: 'loading', world: null, player: null,
  enemies: [], projectiles: [], pickups: [], particles: [], texts: [], fx: [],
  clock: 0, night: 0, sun: 1, nightNum: 0, cycle: 0, nightStarted: false,
  kills: 0, score: 0, shake: 0, winT: 0, won: false, bossAlive: null,
  input: { left: false, right: false, jump: false, jumpPressed: false, attackPressed: false, dashPressed: false, mineHeld: false, placeHeld: false },
  mouse: { x: VW / 2, y: VH / 2 }, mouseWorld: { x: 0, y: 0 }, target: null, cam: { x: 0, y: 0 },
  toasts: [], spawnT: 4, seenT: 0, showMap: true, craftSel: 0, banner: null, time: 0,
  toast(msg) { G.toasts.push({ msg, t: 0 }); if (G.toasts.length > 4) G.toasts.shift(); },
  dmgScale() { return 1 + 0.1 * Math.max(0, G.nightNum - 1); },
  hpScale() { return 1 + 0.15 * Math.max(0, G.nightNum - 1); },
};

// ---------------------------------------------------------------- recipes
const RECIPES = [
  { name: 'Health Potion', desc: 'Restores 50 HP', cost: { crystal: 2, wood: 1, coin: 5 }, give: { hpPot: 1 }, icon: 'hpPot' },
  { name: 'Mana Potion', desc: 'Restores 70 mana', cost: { crystal: 1, stone: 2, coin: 3 }, give: { manaPot: 1 }, icon: 'manaPot' },
  { name: 'Bricks x4', desc: 'Sturdy shelter blocks', cost: { stone: 4 }, give: { brick: 4 }, icon: 'brick' },
  { name: 'Speed Boots', desc: '+45% speed, 25s', cost: { iron: 3, gold: 1 }, give: { boots: 1 }, icon: 'boots' },
  { name: 'Attack Boost', desc: '+60% damage, 25s', cost: { gold: 2, crystal: 2 }, give: { atk: 1 }, icon: 'atk' },
  { name: 'Defense Shield', desc: '-60% damage taken, 25s', cost: { iron: 2, crystal: 3 }, give: { shield: 1 }, icon: 'shield' },
  { name: 'Iron Pickaxe', desc: 'Mine almost 2x faster', cost: { iron: 5, wood: 3 }, gear: ['pick', 1], icon: 'iron' },
  { name: 'Gold Pickaxe', desc: 'Mine 3x faster', cost: { gold: 5, crystal: 3, wood: 3 }, gear: ['pick', 2], icon: 'gold' },
  { name: 'Iron Sword', desc: 'Damage 10 > 16', cost: { iron: 6, wood: 3 }, gear: ['sword', 1], icon: 'atk' },
  { name: 'Gold Sword', desc: 'Damage 16 > 24', cost: { gold: 6, crystal: 4, wood: 3 }, gear: ['sword', 2], icon: 'atk' },
  { name: 'Iron Armor', desc: '-25% damage taken', cost: { iron: 8, wood: 2 }, gear: ['armor', 1], icon: 'shield' },
  { name: 'Gold Armor', desc: '-40% damage taken', cost: { gold: 8, crystal: 5 }, gear: ['armor', 2], icon: 'shield' },
];
function recipeState(r) {
  const p = G.player;
  if (r.gear) {
    const cur = p.gear[r.gear[0]];
    if (cur >= r.gear[1]) return 'owned';
    if (cur < r.gear[1] - 1) return 'locked';
  }
  return Object.keys(r.cost).every(k => p.inv_[k] >= r.cost[k]) ? 'ok' : 'short';
}
function craft(i) {
  const r = RECIPES[i], p = G.player, st = recipeState(r);
  if (st !== 'ok') { Sfx.play('deny'); return; }
  for (const k in r.cost) p.inv_[k] -= r.cost[k];
  if (r.gear) p.gear[r.gear[0]] = r.gear[1];
  else for (const k in r.give) p.inv_[k] += r.give[k];
  Sfx.play('craft'); G.toast('Crafted ' + r.name);
}

// ---------------------------------------------------------------- game setup
function newGame() {
  const seed = Math.floor(Math.random() * 1e9);
  G.world = new World(seed);
  const sp = G.world.spawn;
  G.player = new Player(sp.x, sp.y - 0.01);
  G.enemies = []; G.projectiles = []; G.pickups = []; G.particles = []; G.texts = []; G.fx = []; G.toasts = [];
  G.clock = DAY_LEN * 0.1; G.nightNum = 0; G.cycle = 0; G.nightStarted = false; G.kills = 0; G.score = 0; G.shake = 0;
  G.winT = 0; G.won = false; G.spawnT = 5; G.banner = null; G.target = null;
  updateDayNight();
  G.cam.x = G.player.x - VW / 2; G.cam.y = G.player.y - VH * 0.6;
  G.state = 'play';
  G.toast('Mine with the mouse, fight with J / K. Survive the nights!');
}

function smooth(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }

function updateDayNight() {
  const cyc = Math.floor(G.clock / DAY_LEN), p = (G.clock % DAY_LEN) / DAY_LEN;
  G.phase = p;
  G.night = smooth(0.58, 0.68, p) * (1 - smooth(0.93, 1.0, p));
  G.sun = 1 - G.night;
  if (cyc > G.cycle) { // dawn
    G.cycle = cyc; G.nightStarted = false;
    if (G.nightNum > 0 && G.player && !G.player.dead) {
      G.score += 100 * G.nightNum; Sfx.play('dawn');
      G.banner = { text: 'Dawn breaks', sub: 'You survived night ' + G.nightNum, t: 0 };
    }
  }
  if (!G.nightStarted && p >= 0.63) {
    G.nightStarted = true; G.nightNum++; Sfx.play('night');
    G.banner = { text: 'Night ' + G.nightNum, sub: 'The dead rise...', t: 0 };
    const boss = BOSS_NIGHTS[G.nightNum];
    if (boss && G.player) spawnBoss(boss);
  }
}

function spawnBoss(type) {
  const p = G.player, side = Math.random() < 0.5 ? -1 : 1;
  const x = clamp(p.x + side * 520, 6 * T, (WW - 6) * T);
  const y = type === 'king' ? p.y - 150 : groundY(x, 0) - 1;
  const b = new Enemy(type, x, y, 1);
  G.enemies.push(b);
  G.banner = { text: BOSS_NAME[type], sub: 'A great evil approaches', t: 0 };
  G.toast('Boss: ' + BOSS_NAME[type]); Sfx.play('boss');
}

// ---------------------------------------------------------------- spawning
function spawnTick(dt) {
  G.spawnT -= dt;
  if (G.spawnT > 0) return;
  const p = G.player, w = G.world, ptx = clamp(Math.floor(p.x / T), 0, WW - 1);
  const depth = p.y / T - w.surf[ptx], under = depth > 8;
  const live = G.enemies.filter(e => !e.boss && !e.dying).length;
  let cap = 0, interval = 5;
  if (under) { cap = 4 + Math.min(4, Math.floor(depth / 12)); interval = 4.5; }
  else if (G.night > 0.5) { cap = 3 + G.nightNum * 2; interval = Math.max(1.4, 4.2 - G.nightNum * 0.4); }
  G.spawnT = interval * rand(0.7, 1.3);
  if (live >= cap) return;
  const hs = G.hpScale();
  if (under) {
    for (let i = 0; i < 30; i++) {
      const tx = Math.floor((p.x + rand(-720, 720)) / T), ty = Math.floor((p.y + rand(-320, 320)) / T);
      if (w.get(tx, ty) !== TID.AIR || w.get(tx, ty - 1) !== TID.AIR || w.get(tx, ty - 2) !== TID.AIR || !w.solid(tx, ty + 1)) continue;
      const sx = tx * T + T / 2, sy = (ty + 1) * T;
      if (Math.abs(sx - p.x) < 500 && Math.abs(sy - p.y) < 300) continue;
      const r = Math.random();
      const type = r < 0.2 && depth > 20 ? 'necro' : r < 0.6 ? 'skeleton' : 'zombie';
      G.enemies.push(new Enemy(type, sx, sy - 0.01, hs));
      return;
    }
  } else {
    const side = Math.random() < 0.5 ? -1 : 1;
    const sx = clamp(p.x + side * rand(520, 720), 4 * T, (WW - 4) * T);
    const sy = w.surf[Math.floor(sx / T)] * T;
    const r = Math.random();
    let type = 'zombie';
    if (G.nightNum >= 3 && r < 0.1) type = 'necro';
    else if (G.nightNum >= 2 && r < 0.35) type = 'skeleton';
    G.enemies.push(new Enemy(type, sx, sy - 0.01, hs));
  }
}

// ---------------------------------------------------------------- update
function update(dt) {
  G.time += dt;
  if (G.state !== 'play') return;
  const p = G.player, w = G.world;
  G.clock += dt; updateDayNight();

  p.update(dt); p.updateBuild(dt);
  for (const e of G.enemies) e.update(dt);
  G.enemies = G.enemies.filter(e => !e.dead);
  for (const pr of G.projectiles) pr.update(dt);
  G.projectiles = G.projectiles.filter(pr => !pr.dead);
  for (const pk of G.pickups) pk.update(dt);
  G.pickups = G.pickups.filter(pk => !pk.dead);
  spawnTick(dt);

  for (const q of G.particles) { q.life -= dt; q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
  G.particles = G.particles.filter(q => q.life > 0);
  if (G.particles.length > 400) G.particles.splice(0, G.particles.length - 400);
  for (const t of G.texts) { t.t += dt; t.y -= 28 * dt; }
  G.texts = G.texts.filter(t => t.t < t.life);
  for (const f of G.fx) f.t += dt;
  G.fx = G.fx.filter(f => f.t < f.life);
  for (const t of G.toasts) t.t += dt;
  G.toasts = G.toasts.filter(t => t.t < 4);
  if (G.banner) { G.banner.t += dt; if (G.banner.t > 3.5) G.banner = null; }
  G.shake = Math.max(0, G.shake - dt * 30);
  G.bossAlive = G.enemies.find(e => e.boss && !e.dying) || null;

  // camera follows the player with a little look-ahead
  const tx = p.x + p.face * 40 - VW / 2, ty = p.y - 40 - VH * 0.5;
  const k = 1 - Math.exp(-dt * 7);
  G.cam.x += (tx - G.cam.x) * k; G.cam.y += (ty - G.cam.y) * k;
  G.cam.x = clamp(G.cam.x, 0, WW * T - VW); G.cam.y = clamp(G.cam.y, 0, WH * T - VH);

  G.seenT -= dt;
  if (G.seenT <= 0) { G.seenT = 0.25; w.reveal(Math.floor(p.x / T), Math.floor((p.y - 30) / T), 13); }

  if (p.dead && p.deathT > 2.4) G.state = 'dead';
  if (G.winT > 0) { G.winT += dt; if (G.winT > 3 && !G.won) { G.won = true; G.state = 'win'; G.score += 2000; } }
}
function endFrame() {
  G.input.jumpPressed = false; G.input.attackPressed = false; G.input.dashPressed = false;
}

function tryInteract() {
  const p = G.player, w = G.world;
  for (const v of w.vaults) {
    if (v.opened) continue;
    if (Math.hypot(v.door.x * T + 16 - p.x, v.door.y * T - p.y) < 3.2 * T) {
      if (p.inv_.key <= 0) { G.toast('The vault is locked. You need a Vault Key.'); Sfx.play('deny'); return; }
      p.inv_.key--; v.opened = true;
      w.set(v.door.x, v.door.y, TID.AIR); w.set(v.door.x, v.door.y - 1, TID.AIR);
      const cx = (v.x + v.w / 2) * T, cy = (v.y + v.h - 1) * T;
      const loot = [['crystal', 6], ['gold', 4], ['iron', 4], ['coin', 25], ['hpPot', 2], ['manaPot', 1], ['boots', 1], ['atk', 1], ['shield', 1], ['map', 1]];
      for (const [it, n] of loot) for (let i = 0; i < n; i++) G.pickups.push(new Pickup(it, 1, cx + rand(-30, 30), cy - 10));
      G.toast('Vault opened!'); Sfx.play('power'); spawnParticles(cx, cy - 20, 24, '#ffe08a', 160, 0.8, -50, 3);
      return;
    }
  }
}

// ---------------------------------------------------------------- input
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyW: 'jump', ArrowUp: 'jump', Space: 'jump',
};
window.addEventListener('keydown', e => {
  Sfx.init();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  const code = e.code;
  if (G.state === 'title') { if (code === 'Enter' || code === 'Space') newGame(); return; }
  if (G.state === 'dead') { if (code === 'Enter' || code === 'KeyR') newGame(); return; }
  if (G.state === 'win') { if (code === 'Enter') { G.state = 'play'; G.toast('Endless mode: keep surviving!'); } return; }
  if (G.state === 'paused') { if (code === 'KeyP' || code === 'Escape') G.state = 'play'; return; }
  if (G.state === 'craft') {
    if (code === 'KeyC' || code === 'Escape') G.state = 'play';
    else if (code === 'ArrowDown' || code === 'KeyS') G.craftSel = (G.craftSel + 1) % RECIPES.length;
    else if (code === 'ArrowUp' || code === 'KeyW') G.craftSel = (G.craftSel + RECIPES.length - 1) % RECIPES.length;
    else if (code === 'Enter' || code === 'Space') craft(G.craftSel);
    return;
  }
  if (G.state !== 'play') return;
  const p = G.player, inp = G.input;
  if (KEYMAP[code]) { inp[KEYMAP[code]] = true; if (KEYMAP[code] === 'jump') inp.jumpPressed = true; }
  switch (code) {
    case 'KeyJ': case 'KeyZ': inp.attackPressed = true; break;
    case 'KeyK': case 'KeyX': case 'ShiftLeft': case 'ShiftRight': inp.dashPressed = true; break;
    case 'KeyQ': p.use('hpPot'); break;
    case 'KeyR': p.use('manaPot'); break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': p.block = +code.slice(5) - 1; break;
    case 'Digit5': p.use('boots'); break;
    case 'Digit6': p.use('atk'); break;
    case 'Digit7': p.use('shield'); break;
    case 'KeyF': case 'KeyE': tryInteract(); break;
    case 'KeyC': G.state = 'craft'; break;
    case 'KeyM': G.showMap = !G.showMap; break;
    case 'KeyN': Sfx.muted = !Sfx.muted; G.toast(Sfx.muted ? 'Sound off' : 'Sound on'); break;
    case 'KeyP': case 'Escape': G.state = 'paused'; break;
  }
});
window.addEventListener('keyup', e => {
  if (KEYMAP[e.code]) G.input[KEYMAP[e.code]] = false;
});
window.addEventListener('blur', () => {
  for (const k of ['left', 'right', 'jump', 'mineHeld', 'placeHeld']) G.input[k] = false;
  if (G.state === 'play') G.state = 'paused';
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') G.state = 'paused'; });

function setMouse(e) {
  const r = canvas.getBoundingClientRect();
  G.mouse.x = (e.clientX - r.left) * VW / r.width; G.mouse.y = (e.clientY - r.top) * VH / r.height;
}
canvas.addEventListener('mousemove', setMouse);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  setMouse(e); Sfx.init(); canvas.focus();
  if (G.state === 'title') { newGame(); return; }
  if (G.state === 'dead') { newGame(); return; }
  if (G.state === 'win') { G.state = 'play'; return; }
  if (G.state === 'paused') { G.state = 'play'; return; }
  if (G.state === 'craft') { const i = craftRowAt(G.mouse.x, G.mouse.y); if (i >= 0) { G.craftSel = i; craft(i); } return; }
  if (e.button === 0) G.input.mineHeld = true;
  if (e.button === 2) G.input.placeHeld = true;
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) G.input.mineHeld = false;
  if (e.button === 2) G.input.placeHeld = false;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (G.state === 'play') G.player.block = (G.player.block + (e.deltaY > 0 ? 1 : 3)) % 4;
}, { passive: false });

// ---------------------------------------------------------------- rendering helpers
const lightCanvas = document.createElement('canvas'); lightCanvas.width = VW; lightCanvas.height = VH;
const lctx = lightCanvas.getContext('2d');
const lightSprite = document.createElement('canvas'); lightSprite.width = lightSprite.height = 256;
(function () {
  const c = lightSprite.getContext('2d'), g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
})();
let wallTiles = [];
function buildWallTiles() {
  wallTiles = ['stone2', 'stone', 'cobble', 'cobble2'].map(n => {
    const c = document.createElement('canvas'); c.width = c.height = T;
    const x = c.getContext('2d'); Assets.tile(x, n, 0, 0, T);
    x.fillStyle = 'rgba(8,8,18,.72)'; x.fillRect(0, 0, T, T);
    return c;
  });
}
const STARS = Array.from({ length: 90 }, (_, i) => ({ x: hash2(i, 1, 9) * VW, y: hash2(i, 2, 9) * VH * 0.6, s: 1 + Math.floor(hash2(i, 3, 9) * 2), ph: hash2(i, 4, 9) * 6 }));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

function drawSky() {
  const n = G.night, tw = 1 - Math.abs(2 * n - 1);
  let top = mix([84, 170, 232], [6, 9, 28], n), bot = mix([196, 232, 246], [26, 30, 62], n);
  const glow = tw * 0.55;
  top = mix(top, [120, 70, 110], glow * 0.6); bot = mix(bot, [240, 150, 80], glow);
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bot));
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  if (n > 0.05) for (const s of STARS) {
    ctx.globalAlpha = n * (0.5 + 0.5 * Math.sin(G.time * 2 + s.ph)); ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, s.s, s.s);
  }
  ctx.globalAlpha = 1;
  const p = G.phase;
  if (p < 0.66) { // sun
    const a = p / 0.66, x = 60 + a * (VW - 120), y = VH * 0.5 - Math.sin(a * Math.PI) * VH * 0.38;
    ctx.fillStyle = 'rgba(255,240,170,.25)'; ctx.beginPath(); ctx.arc(x, y, 34, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffe99a'; ctx.beginPath(); ctx.arc(x, y, 20, 0, 6.283); ctx.fill();
  }
  if (p > 0.6) { // moon
    const a = (p - 0.6) / 0.4, x = 60 + a * (VW - 120), y = VH * 0.5 - Math.sin(a * Math.PI) * VH * 0.38;
    ctx.fillStyle = '#e8eefc'; ctx.beginPath(); ctx.arc(x, y, 18, 0, 6.283); ctx.fill();
    ctx.fillStyle = rgb(top); ctx.beginPath(); ctx.arc(x + 7, y - 3, 16, 0, 6.283); ctx.fill();
  }
  // parallax hills, anchored to the world surface so they scroll with the ground
  const horizon = SURFACE * T - G.cam.y;
  if (horizon > -200) {
    for (const [par, amp, col, dark] of [[0.15, 60, [92, 140, 140], [16, 24, 48]], [0.35, 38, [52, 110, 84], [14, 28, 40]]]) {
      ctx.fillStyle = rgb(mix(col, dark, n));
      ctx.beginPath(); ctx.moveTo(0, VH + 400);
      for (let x = 0; x <= VW; x += 16) {
        const wx = x + G.cam.x * par;
        ctx.lineTo(x, horizon - 20 - amp * (0.5 + 0.5 * Math.sin(wx * 0.006 + par * 9)) - amp * 0.4 * Math.sin(wx * 0.015 + 2));
      }
      ctx.lineTo(VW, VH + 400); ctx.closePath(); ctx.fill();
    }
  }
}

function drawWorld() {
  const w = G.world, cam = G.cam;
  const x0 = Math.max(0, Math.floor(cam.x / T)), x1 = Math.min(WW - 1, Math.floor((cam.x + VW) / T));
  const y0 = Math.max(0, Math.floor(cam.y / T)), y1 = Math.min(WH - 1, Math.floor((cam.y + VH) / T));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const id = w.t[y * WW + x], d = TDEF[id];
      if (!d.solid && y > w.surf[x]) ctx.drawImage(wallTiles[(x * 7 + y * 13) & 3], x * T, y * T);
      if (id === TID.AIR) continue;
      if (d.foliage) { ctx.globalAlpha = 0.97; Assets.tile(ctx, d.spr, x * T - 4, y * T - 4, T + 8); ctx.globalAlpha = 1; }
      else Assets.tile(ctx, d.spr, x * T, y * T, T);
    }
  // mining crack overlay
  const m = G.player.mine;
  if (m.x >= 0 && m.p > 0) {
    const d = TDEF[w.get(m.x, m.y)], f = clamp(m.p / d.hard, 0, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.15 + f * 0.5})`; ctx.fillRect(m.x * T, m.y * T, T, T);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < 2 + Math.floor(f * 6); i++) { const px = m.x * T + hash2(i, m.x, 3) * T, py = m.y * T + hash2(i, m.y, 5) * T; ctx.moveTo(px, py); ctx.lineTo(px + (hash2(i, 9, 1) - 0.5) * 14, py + (hash2(i, 7, 2) - 0.5) * 14); }
    ctx.stroke();
  }
  // placement / mining target
  const t = G.target;
  if (t && G.state === 'play') {
    ctx.strokeStyle = t.ok ? 'rgba(255,255,255,.8)' : 'rgba(255,80,80,.6)'; ctx.lineWidth = 2;
    ctx.strokeRect(t.x * T + 1, t.y * T + 1, T - 2, T - 2);
  }
  // vault door markers when the door is visible
  for (const v of w.vaults) if (!v.opened) { const dx = v.door.x * T, dy = (v.door.y - 1) * T; ctx.fillStyle = 'rgba(255,220,100,.18)'; ctx.fillRect(dx, dy, T, T * 2); }
}

function drawFx() {
  for (const f of G.fx) {
    if (f.kind !== 'slash') continue;
    const a = f.t / f.life;
    ctx.save(); ctx.translate(f.x + f.face * 22, f.y); ctx.scale(f.face, 1);
    ctx.globalAlpha = 1 - a; ctx.lineCap = 'round';
    ctx.strokeStyle = '#fff6b0'; ctx.lineWidth = 14 * (1 - a * 0.6);
    ctx.beginPath(); ctx.arc(-14, 0, 46 + a * 10, -1.15, 1.15); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(-14, 0, 46 + a * 10, -1.0, 1.0); ctx.stroke();
    ctx.restore();
  }
  for (const q of G.particles) {
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.color; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 13px "Courier New", monospace'; ctx.textAlign = 'center';
  for (const t of G.texts) {
    ctx.globalAlpha = 1 - t.t / t.life; ctx.fillStyle = '#000'; ctx.fillText(t.text, t.x + 1, t.y + 1); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function addLight(c, x, y, r, a) {
  const sx = x - G.cam.x + G.shakeX, sy = y - G.cam.y + G.shakeY;
  if (sx < -r || sx > VW + r || sy < -r || sy > VH + r) return;
  c.globalAlpha = a; c.drawImage(lightSprite, sx - r, sy - r, r * 2, r * 2);
}
function drawLighting() {
  const p = G.player, w = G.world, ptx = clamp(Math.floor(p.x / T), 0, WW - 1);
  const depth = p.y / T - w.surf[ptx], under = clamp((depth - 3) / 14, 0, 1);
  const dark = Math.max(G.night * 0.84 * (1 - under), under * 0.9);
  if (dark < 0.03) return;
  lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 1; lctx.clearRect(0, 0, VW, VH);
  lctx.fillStyle = `rgba(4,6,20,${dark})`; lctx.fillRect(0, 0, VW, VH);
  lctx.globalCompositeOperation = 'destination-out';
  const flick = 1 + Math.sin(G.time * 9) * 0.03;
  addLight(lctx, p.x, p.y - 30, (G.night > 0.4 || under > 0.3 ? 215 : 260) * flick, 1);
  const w0 = Math.floor(G.cam.x / T), w1 = Math.floor((G.cam.x + VW) / T), h0 = Math.floor(G.cam.y / T), h1 = Math.floor((G.cam.y + VH) / T);
  for (let y = Math.max(0, h0 - 2); y <= Math.min(WH - 1, h1 + 2); y++)
    for (let x = Math.max(0, w0 - 2); x <= Math.min(WW - 1, w1 + 2); x++) if (w.t[y * WW + x] === TID.CRYSTAL) addLight(lctx, x * T + 16, y * T + 16, 80, 0.7);
  for (const e of G.enemies) if (e.boss || e.type === 'necro') addLight(lctx, e.x, e.y - e.h / 2, e.boss ? 130 : 60, 0.7);
  for (const pr of G.projectiles) addLight(lctx, pr.x, pr.y, 55, 0.9);
  for (const pk of G.pickups) addLight(lctx, pk.x, pk.y, 34, 0.6);
  for (const f of G.fx) if (f.kind === 'slash') addLight(lctx, f.x + f.face * 30, f.y, 80, 0.8);
  lctx.globalAlpha = 1; lctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(lightCanvas, 0, 0);
}

function render() {
  const sh = G.shake;
  G.shakeX = sh ? Math.round(rand(-sh, sh) * 0.5) : 0; G.shakeY = sh ? Math.round(rand(-sh, sh) * 0.5) : 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  if (!G.world) { ctx.fillStyle = '#07080f'; ctx.fillRect(0, 0, VW, VH); return; }
  drawSky();
  ctx.save();
  ctx.translate(-Math.round(G.cam.x) + G.shakeX, -Math.round(G.cam.y) + G.shakeY);
  drawWorld();
  for (const pk of G.pickups) pk.draw(ctx);
  for (const e of G.enemies) if (e.dying) e.draw(ctx);
  for (const e of G.enemies) if (!e.dying) e.draw(ctx);
  G.player.draw(ctx);
  for (const pr of G.projectiles) pr.draw(ctx);
  drawFx();
  ctx.restore();
  drawLighting();
  if (G.state !== 'title') drawHUD();
}

// ---------------------------------------------------------------- HUD
function txt(s, x, y, color, size, align) {
  ctx.font = `bold ${size || 13}px "Courier New", monospace`; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = color || '#fff'; ctx.fillText(s, x, y);
}
function panel(x, y, w, h, a) {
  ctx.fillStyle = `rgba(14,16,30,${a === undefined ? 0.82 : a})`; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(120,130,180,.55)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}
function bar(x, y, w, h, f, col, label) {
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(f, 0, 1), h);
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, y, w * clamp(f, 0, 1), h / 3);
  if (label) txt(label, x + 6, y + h - 3, '#fff', 11);
}

const minimap = document.createElement('canvas'); minimap.width = WW; minimap.height = WH;
const mmctx = minimap.getContext('2d'); let mmT = 0;
const MM_COL = { [TID.GRASS]: [88, 150, 60], [TID.DIRT]: [120, 80, 50], [TID.ROOTS]: [120, 80, 50], [TID.STONE]: [90, 94, 104], [TID.STONE2]: [90, 94, 104], [TID.COBBLE]: [100, 104, 114], [TID.COBBLE2]: [100, 104, 114], [TID.IRON]: [200, 180, 160], [TID.GOLD]: [255, 210, 60], [TID.CRYSTAL]: [80, 200, 255], [TID.BEDROCK]: [40, 40, 50], [TID.TRUNK]: [90, 60, 30], [TID.LEAVES]: [50, 120, 50], [TID.CRATE]: [170, 120, 60], [TID.MOSS]: [90, 120, 90], [TID.VAULT]: [255, 230, 90], [TID.BRICK]: [150, 150, 170], [TID.PLANK]: [170, 120, 60] };
function drawMinimap() {
  const w = G.world;
  if (G.time - mmT > 0.6) {
    mmT = G.time;
    const img = mmctx.createImageData(WW, WH);
    for (let i = 0; i < WW * WH; i++) {
      const id = w.t[i], seen = w.seen[i];
      let c = seen ? (id === TID.AIR ? [14, 16, 30] : MM_COL[id] || [90, 90, 100]) : [0, 0, 0];
      if (seen && id === TID.AIR && Math.floor(i / WW) <= w.surf[i % WW]) c = [60, 100, 150];
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = seen ? 255 : 200;
    }
    mmctx.putImageData(img, 0, 0);
  }
  const s = 0.75, mw = WW * s, mh = WH * s, mx = VW - mw - 10, my = 150;
  panel(mx - 4, my - 4, mw + 8, mh + 8, 0.85);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(minimap, mx, my, mw, mh); ctx.imageSmoothingEnabled = true;
  const p = G.player;
  ctx.fillStyle = '#fff'; ctx.fillRect(mx + p.x / T * s - 2, my + p.y / T * s - 3, 4, 4);
  for (const v of w.vaults) if (!v.opened && w.seen[v.door.y * WW + v.door.x]) { ctx.fillStyle = '#ffd24a'; ctx.fillRect(mx + v.door.x * s - 2, my + v.door.y * s - 2, 4, 4); }
  for (const e of G.enemies) if (e.boss && !e.dying) { ctx.fillStyle = '#ff3b3b'; ctx.fillRect(mx + e.x / T * s - 2, my + e.y / T * s - 2, 5, 5); }
}

function drawHUD() {
  const p = G.player;
  // vitals
  panel(8, 8, 270, 74);
  ctx.save(); ctx.beginPath(); ctx.rect(14, 14, 46, 62); ctx.clip();
  Assets.char(ctx, 'p_walk', 0, 38, 80, 0.62, false); ctx.restore();
  bar(68, 16, 200, 16, p.hp / p.maxHp, '#c62d2d', `HP ${Math.ceil(p.hp)}/${p.maxHp}`);
  bar(68, 40, 200, 12, p.mana / p.maxMana, '#2d6fd0', `MP ${Math.floor(p.mana)}`);
  let bx = 68;
  for (const [k, ic, col] of [['speed', 'pu_boots', '#7de0ff'], ['atk', 'pu_attack', '#ffb04a'], ['shield', 'pu_shield', '#6aa8ff']]) {
    if (p.buff[k] > 0) { Assets.item(ctx, ic, bx + 8, 66, 16); txt(Math.ceil(p.buff[k]) + 's', bx + 20, 70, col, 11); bx += 56; }
  }
  // gear line
  txt(`${GEAR.sword[p.gear.sword].name} (${Math.round(p.dmg)})`, 8, 100, '#d8d8e8', 11);

  // clock
  const cw = 190, cx = VW / 2 - cw / 2;
  panel(cx, 8, cw, 34);
  const isNight = G.night > 0.5;
  txt(`${isNight ? 'Night' : 'Day'} ${isNight ? G.nightNum : Math.max(1, G.nightNum + 1)}`, cx + 10, 30, isNight ? '#b7a8ff' : '#ffe08a', 14);
  const ph = G.phase;
  ctx.fillStyle = '#222'; ctx.fillRect(cx + 90, 20, 90, 8);
  ctx.fillStyle = '#e8c860'; ctx.fillRect(cx + 90, 20, 90 * Math.min(1, ph / 0.63), 8);
  ctx.fillStyle = '#7a62d8'; ctx.fillRect(cx + 90 + 90 * 0.63, 20, 90 * Math.max(0, ph - 0.63) / 0.37 * 0.37, 8);
  ctx.fillStyle = '#fff'; ctx.fillRect(cx + 90 + 90 * ph - 1, 17, 2, 14);

  // resources
  const res = ['wood', 'stone', 'dirt', 'brick', 'iron', 'gold', 'crystal', 'coin', 'key'];
  panel(VW - 134, 8, 126, 136);
  res.forEach((k, i) => {
    const col = i % 2, row = Math.floor(i / 2), x = VW - 128 + col * 62, y = 14 + row * 26;
    Assets.item(ctx, ICON[k], x + 10, y + 11, 18); txt(String(p.inv_[k]), x + 24, y + 16, p.inv_[k] ? '#fff' : '#777', 13);
  });
  if (G.showMap) drawMinimap();

  // hotbar
  const slots = [
    ...['dirt', 'stone', 'brick', 'wood'].map((k, i) => ({ k, key: String(i + 1), sel: p.block === i })),
    { k: 'boots', key: '5' }, { k: 'atk', key: '6' }, { k: 'shield', key: '7' }, { k: 'hpPot', key: 'Q' }, { k: 'manaPot', key: 'R' },
  ];
  const sw = 44, total = slots.length * (sw + 4), hx = VW / 2 - total / 2, hy = VH - 56;
  slots.forEach((s, i) => {
    const x = hx + i * (sw + 4);
    panel(x, hy, sw, sw, 0.78);
    if (s.sel) { ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 3; ctx.strokeRect(x + 1, hy + 1, sw - 2, sw - 2); }
    Assets.item(ctx, ICON[s.k], x + sw / 2, hy + sw / 2 - 2, 26);
    txt(String(p.inv_[s.k]), x + sw - 4, hy + sw - 5, p.inv_[s.k] ? '#fff' : '#888', 12, 'right');
    txt(s.key, x + 4, hy + 12, '#9aa', 10);
  });
  txt('C: craft   M: map   P: pause   N: sound', VW / 2, VH - 6, 'rgba(210,215,240,.7)', 11, 'center');

  // boss bar
  const b = G.bossAlive;
  if (b) {
    const bw = 380, bx2 = VW / 2 - bw / 2;
    txt(BOSS_NAME[b.type], VW / 2, 66, '#ff8a8a', 15, 'center');
    bar(bx2, 72, bw, 12, b.hp / b.maxHp, b.type === 'king' ? '#8a3ad0' : '#d6561f');
  }
  // toasts
  G.toasts.forEach((t, i) => {
    ctx.globalAlpha = clamp(4 - t.t, 0, 1); txt(t.msg, VW / 2, VH - 76 - (G.toasts.length - 1 - i) * 18, '#ffe9a8', 13, 'center');
  });
  ctx.globalAlpha = 1;
  // vault prompt
  for (const v of G.world.vaults) if (!v.opened && Math.hypot(v.door.x * T + 16 - p.x, v.door.y * T - p.y) < 3.2 * T)
    txt(p.inv_.key > 0 ? 'Press F to open the vault' : 'Locked vault: needs a key', VW / 2, VH * 0.62, '#ffd24a', 14, 'center');
  // banner
  if (G.banner) {
    const a = G.banner.t < 0.5 ? G.banner.t / 0.5 : G.banner.t > 3 ? (3.5 - G.banner.t) / 0.5 : 1;
    ctx.globalAlpha = clamp(a, 0, 1);
    txt(G.banner.text, VW / 2, VH * 0.3, '#fff', 40, 'center'); txt(G.banner.sub, VW / 2, VH * 0.3 + 28, '#c9c4ee', 16, 'center');
    ctx.globalAlpha = 1;
  }
  // red flash when low
  if (p.hp < 30 && !p.dead) { ctx.fillStyle = `rgba(160,0,0,${0.12 + Math.sin(G.time * 6) * 0.05})`; ctx.fillRect(0, 0, VW, VH); }
  if (G.state === 'craft') drawCraft();
  if (G.state === 'paused') overlay('Paused', 'Press P or click to resume');
}

function overlay(title, sub, lines, titleCol) {
  ctx.fillStyle = 'rgba(4,5,12,.72)'; ctx.fillRect(0, 0, VW, VH);
  txt(title, VW / 2, VH * 0.3, titleCol || '#fff', 44, 'center');
  txt(sub, VW / 2, VH * 0.3 + 32, '#c9c4ee', 16, 'center');
  (lines || []).forEach((l, i) => txt(l, VW / 2, VH * 0.3 + 76 + i * 22, '#e8e8f4', 14, 'center'));
}

const CRAFT = { x: 150, y: 20, w: 660, rowH: 33, top: 76 };
function craftRowAt(mx, my) {
  if (mx < CRAFT.x || mx > CRAFT.x + CRAFT.w) return -1;
  const i = Math.floor((my - CRAFT.top) / CRAFT.rowH);
  return i >= 0 && i < RECIPES.length ? i : -1;
}
function drawCraft() {
  const p = G.player;
  ctx.fillStyle = 'rgba(4,5,12,.6)'; ctx.fillRect(0, 0, VW, VH);
  panel(CRAFT.x, CRAFT.y, CRAFT.w, 56 + RECIPES.length * CRAFT.rowH + 12, 0.95);
  txt('Crafting', CRAFT.x + 20, CRAFT.y + 28, '#ffe08a', 20);
  txt('Click or Up/Down + Enter to craft. C / Esc to close.', CRAFT.x + 20, CRAFT.y + 46, '#aab', 11);
  const hover = craftRowAt(G.mouse.x, G.mouse.y); if (hover >= 0) G.craftSel = hover;
  RECIPES.forEach((r, i) => {
    const y = CRAFT.top + i * CRAFT.rowH, st = recipeState(r);
    if (i === G.craftSel) { ctx.fillStyle = 'rgba(120,140,255,.22)'; ctx.fillRect(CRAFT.x + 8, y, CRAFT.w - 16, CRAFT.rowH - 2); }
    ctx.globalAlpha = st === 'ok' ? 1 : 0.5;
    Assets.item(ctx, ICON[r.icon], CRAFT.x + 30, y + 15, 22);
    txt(r.name, CRAFT.x + 52, y + 15, st === 'ok' ? '#fff' : '#bbb', 13);
    txt(st === 'owned' ? 'Owned' : st === 'locked' ? 'Craft the previous tier first' : r.desc, CRAFT.x + 52, y + 29, '#99a', 10);
    let cx = CRAFT.x + 330;
    if (st !== 'owned' && st !== 'locked') for (const k in r.cost) {
      Assets.item(ctx, ICON[k], cx + 8, y + 17, 18);
      txt(`${r.cost[k]}`, cx + 20, y + 22, p.inv_[k] >= r.cost[k] ? '#9f9' : '#f88', 13); cx += 62;
    }
    ctx.globalAlpha = 1;
  });
}

function drawTitle() {
  ctx.fillStyle = 'rgba(4,5,12,.7)'; ctx.fillRect(0, 0, VW, VH);
  txt('ASHEN HOLLOW', VW / 2, 110, '#ffe08a', 56, 'center');
  txt('A 2D survival platformer', VW / 2, 142, '#c9c4ee', 17, 'center');
  const L = ['A / D  move       W / Space  jump', 'J  sword slash      K / Shift  dash attack (30 mana)', 'Mouse: hold left to mine, right to place a block (1-4 / wheel to pick)',
    'Q  health potion    R  mana potion    5 6 7  boots / attack / shield', 'C  crafting    F  open vault    M  map    P  pause    N  sound', '',
    'Gather resources, build a shelter, craft gear and survive the nights.', 'Zombies, skeletons and necromancers rise at dusk and burn at dawn.', 'Two bosses stalk the dark. Destroy the Necromancer King to win.'];
  L.forEach((l, i) => txt(l, VW / 2, 200 + i * 24, '#e8e8f4', 14, 'center'));
  ctx.globalAlpha = 0.6 + Math.sin(G.time * 4) * 0.4;
  txt('Press ENTER or click to begin', VW / 2, 470, '#fff', 20, 'center');
  ctx.globalAlpha = 1;
}

function drawEnd() {
  const p = G.player, nights = Math.max(0, G.nightNum - (G.night > 0.5 ? 1 : 0));
  const stats = [`Nights survived: ${nights}`, `Undead slain: ${G.kills}`, `Score: ${G.score}`];
  if (G.state === 'dead') overlay('You have fallen', 'Press ENTER to try again', stats, '#ff7a7a');
  else overlay('VICTORY', 'The Necromancer King is destroyed. Press ENTER to keep playing.', stats, '#ffe08a');
}

// ---------------------------------------------------------------- main loop
let last = 0;
function frame(ts) {
  const dt = Math.min(0.033, (ts - last) / 1000 || 0.016); last = ts;
  try {
    G.mouseWorld.x = G.mouse.x + G.cam.x; G.mouseWorld.y = G.mouse.y + G.cam.y;
    update(dt);
    render();
    if (G.state === 'title') drawTitle();
    if (G.state === 'dead' || G.state === 'win') drawEnd();
    endFrame();
  } catch (err) { showError(err); return; }
  requestAnimationFrame(frame);
}
function showError(err) {
  console.error(err);
  const el = document.getElementById('err'); el.style.display = 'flex'; el.textContent = 'Something went wrong: ' + err.message;
}

Assets.load().then(() => {
  buildWallTiles();
  newGame(); G.state = 'title'; // world is generated behind the title screen
  requestAnimationFrame(frame);
}).catch(showError);
