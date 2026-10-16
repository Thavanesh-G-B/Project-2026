'use strict';
// Entities: physics helper, player, enemies, bosses, projectiles, pickups, particles.
// All entities use x = horizontal centre, y = feet.

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sign = v => (v < 0 ? -1 : 1);

// ---------------------------------------------------------------- audio (tiny synth)
const Sfx = {
  ctx: null, muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
  },
  tone(freq, dur, type, vol, slide) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur);
  },
  noise(dur, vol) {
    if (!this.ctx || this.muted) return;
    const n = Math.floor(this.ctx.sampleRate * dur), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    g.gain.value = vol || 0.08; s.buffer = buf; s.connect(g); g.connect(this.ctx.destination); s.start();
  },
  play(name) {
    switch (name) {
      case 'slash': this.noise(0.12, 0.07); this.tone(420, 0.1, 'sawtooth', 0.03, 0.5); break;
      case 'hit': this.tone(180, 0.1, 'square', 0.07, 0.5); this.noise(0.05, 0.06); break;
      case 'hurt': this.tone(140, 0.25, 'sawtooth', 0.08, 0.4); break;
      case 'jump': this.tone(300, 0.12, 'square', 0.03, 1.8); break;
      case 'dash': this.noise(0.25, 0.08); this.tone(250, 0.25, 'sawtooth', 0.04, 2.5); break;
      case 'mine': this.tone(110 + Math.random() * 40, 0.05, 'square', 0.04); break;
      case 'break': this.noise(0.12, 0.08); this.tone(90, 0.1, 'square', 0.05, 0.6); break;
      case 'place': this.tone(160, 0.06, 'square', 0.04); break;
      case 'pickup': this.tone(780, 0.07, 'square', 0.035); this.tone(1170, 0.09, 'square', 0.03); break;
      case 'coin': this.tone(990, 0.06, 'square', 0.03); this.tone(1480, 0.1, 'square', 0.03); break;
      case 'power': this.tone(400, 0.3, 'triangle', 0.07, 3); break;
      case 'craft': this.tone(520, 0.08, 'triangle', 0.06); this.tone(780, 0.14, 'triangle', 0.06); break;
      case 'cast': this.tone(200, 0.4, 'sine', 0.07, 2.2); break;
      case 'summon': this.tone(120, 0.6, 'sawtooth', 0.05, 2); break;
      case 'boss': this.tone(70, 1.2, 'sawtooth', 0.09, 0.7); break;
      case 'die': this.tone(300, 0.5, 'sawtooth', 0.07, 0.25); break;
      case 'night': this.tone(110, 1.4, 'triangle', 0.08, 0.6); break;
      case 'dawn': this.tone(330, 0.9, 'triangle', 0.06, 1.6); break;
      case 'deny': this.tone(110, 0.15, 'square', 0.05); break;
    }
  },
};

// ---------------------------------------------------------------- physics
function collidesBox(l, t, r, b) {
  const w = G.world;
  const x0 = Math.floor(l / T), x1 = Math.floor((r - 0.01) / T), y0 = Math.floor(t / T), y1 = Math.floor((b - 0.01) / T);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.solid(x, y)) return true;
  return false;
}

function moveBody(e, dt) {
  const hw = e.w / 2;
  e.hitWall = false;
  e.x += e.vx * dt;
  if (collidesBox(e.x - hw, e.y - e.h, e.x + hw, e.y)) {
    if (e.vx > 0) e.x = Math.floor((e.x + hw) / T) * T - hw - 0.001;
    else if (e.vx < 0) e.x = (Math.floor((e.x - hw) / T) + 1) * T + hw + 0.001;
    e.vx = 0; e.hitWall = true;
  }
  e.y += e.vy * dt;
  if (collidesBox(e.x - hw, e.y - e.h, e.x + hw, e.y)) {
    if (e.vy > 0) e.y = Math.floor(e.y / T) * T - 0.001;
    else if (e.vy < 0) e.y = (Math.floor((e.y - e.h) / T) + 1) * T + e.h + 0.001;
    e.vy = 0;
  }
  e.onGround = e.vy >= 0 && collidesBox(e.x - hw, e.y, e.x + hw, e.y + 1.5);
}

// First solid tile top at/below pixel y in tile column of x (for spawning on ground).
function groundY(x, fromY) {
  const tx = clamp(Math.floor(x / T), 0, WW - 1);
  for (let ty = Math.max(0, Math.floor(fromY / T)); ty < WH; ty++) if (G.world.solid(tx, ty)) return ty * T;
  return WH * T;
}

function overlap(a, b) { // a, b: {l,t,r,b}
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}
function boxOf(e) { return { l: e.x - e.w / 2, r: e.x + e.w / 2, t: e.y - e.h, b: e.y }; }

// ---------------------------------------------------------------- effects
function spawnParticles(x, y, n, color, spd, life, grav, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, s = Math.random() * (spd || 80);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (spd || 80) * 0.3, life: life || 0.5, max: life || 0.5,
      color, g: grav === undefined ? 400 : grav, size: size || 3 });
  }
}
function floatText(x, y, text, color) {
  G.texts.push({ x, y, text, color: color || '#fff', t: 0, life: 0.9 });
}

// ---------------------------------------------------------------- items
const ICON = {
  dirt: 'dirt', stone: 'stonechunk', wood: 'trunk', iron: 'iron', gold: 'ore_gold', crystal: 'crystals', coin: 'coin',
  brick: 'brick', hpPot: 'pu_health', manaPot: 'pu_mana', boots: 'pu_boots', atk: 'pu_attack', shield: 'pu_shield',
  key: 'key', map: 'map',
};
const ITEM_NAME = {
  dirt: 'Dirt', stone: 'Stone', wood: 'Wood', iron: 'Iron', gold: 'Gold', crystal: 'Crystal', coin: 'Coins', brick: 'Brick',
  hpPot: 'Health Potion', manaPot: 'Mana Potion', boots: 'Speed Boots', atk: 'Attack Boost', shield: 'Defense Shield',
  key: 'Vault Key', map: 'Treasure Map',
};

class Pickup {
  constructor(item, n, x, y, vx, vy) {
    this.item = item; this.n = n || 1;
    this.x = x; this.y = y; this.w = 10; this.h = 10;
    this.vx = vx === undefined ? rand(-90, 90) : vx; this.vy = vy === undefined ? rand(-260, -120) : vy;
    this.t = 0; this.dead = false; this.onGround = false;
  }
  update(dt) {
    this.t += dt;
    const p = G.player, dx = p.x - this.x, dy = (p.y - 28) - (this.y - 5), d = Math.hypot(dx, dy);
    if (!p.dead && this.t > 0.35 && d < 85) {
      const s = 360 * dt / Math.max(d, 1);
      this.vx = dx * s / dt * 0.9; this.vy = dy * s / dt * 0.9;
      this.x += this.vx * dt; this.y += this.vy * dt;
    } else {
      this.vy = Math.min(this.vy + 1100 * dt, 600);
      moveBody(this, dt);
      if (this.onGround) this.vx *= 0.8;
    }
    if (d < 20 && this.t > 0.2 && !p.dead) { p.collect(this.item, this.n); this.dead = true; }
    if (this.t > 120) this.dead = true;
  }
  draw(ctx) {
    const bob = Math.sin(this.t * 4 + this.x) * 2;
    Assets.item(ctx, ICON[this.item] || 'orb', this.x, this.y - 8 + bob, ['coin', 'dirt', 'stone', 'wood', 'brick'].includes(this.item) ? 14 : 22);
  }
}

// ---------------------------------------------------------------- projectiles
class Projectile {
  constructor(kind, x, y, vx, vy, dmg, life) {
    this.kind = kind; this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.dmg = dmg; this.life = life || 4;
    this.t = 0; this.dead = false; this.r = kind === 'flame' ? 22 : 11; this.homing = 0;
  }
  update(dt) {
    this.t += dt; this.life -= dt;
    const p = G.player;
    if (this.homing && !p.dead) {
      const want = Math.atan2(p.y - 30 - this.y, p.x - this.x), cur = Math.atan2(this.vy, this.vx);
      let d = want - cur; while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283;
      const na = cur + clamp(d, -this.homing * dt, this.homing * dt), sp = Math.hypot(this.vx, this.vy);
      this.vx = Math.cos(na) * sp; this.vy = Math.sin(na) * sp;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.kind === 'flame') {
      // flame waves hug the ground
      const gy = groundY(this.x, this.y - 40);
      this.y = gy;
    } else if (G.world.solid(Math.floor(this.x / T), Math.floor(this.y / T))) {
      spawnParticles(this.x, this.y, 8, '#b070ff', 90, 0.4, 0, 3);
      this.dead = true; return;
    }
    if (this.life <= 0) { this.dead = true; return; }
    if (!p.dead) {
      const cy = this.kind === 'flame' ? this.y - 24 : this.y;
      if (Math.abs(p.x - this.x) < p.w / 2 + this.r && cy > p.y - p.h - this.r && cy < p.y + this.r * 0.5) {
        if (p.hurt(this.dmg, this.x)) { spawnParticles(this.x, this.y, 8, '#c08cff', 120, 0.4, 0, 3); if (this.kind !== 'flame') this.dead = true; }
      }
    }
  }
  draw(ctx) {
    if (this.kind === 'flame') {
      const s = 1 + Math.sin(this.t * 20) * 0.08, f = Math.sign(this.vx) || 1;
      ctx.save(); ctx.translate(this.x, this.y); ctx.scale(f * s, s);
      const g = ctx.createLinearGradient(0, -50, 0, 0);
      g.addColorStop(0, 'rgba(255,230,120,0)'); g.addColorStop(0.5, 'rgba(255,150,40,.9)'); g.addColorStop(1, 'rgba(255,70,10,.95)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.quadraticCurveTo(-6, -52, 22, -10); ctx.quadraticCurveTo(10, -22, 14, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    let group, idx, sc;
    if (this.kind === 'skull') { group = 'king_beam'; idx = 7 + Math.floor(this.t * 12) % 5; sc = 0.9; }
    else { group = 'necro_cast'; idx = 6 + Math.floor(this.t * 10) % 2; sc = 1.3; }
    let a = Math.atan2(this.vy, this.vx), flip = false;
    if (Math.cos(a) < 0) { flip = true; a = Math.atan2(this.vy, -this.vx); }
    const f = SPRITES.chars[group][idx];
    ctx.save(); ctx.translate(this.x, this.y); if (flip) ctx.scale(-1, 1); ctx.rotate(a);
    ctx.drawImage(Assets.chars, f[0], f[1], f[2], f[3], -f[2] * sc / 2, -f[3] * sc / 2, f[2] * sc, f[3] * sc);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- player
const GEAR = {
  sword: [{ name: 'Rusty Sword', dmg: 10 }, { name: 'Iron Sword', dmg: 16 }, { name: 'Gold Sword', dmg: 24 }],
  pick: [{ name: 'Old Pickaxe', speed: 1 }, { name: 'Iron Pickaxe', speed: 1.9 }, { name: 'Gold Pickaxe', speed: 3 }],
  armor: [{ name: 'Tunic', red: 0 }, { name: 'Iron Armor', red: 0.25 }, { name: 'Gold Armor', red: 0.4 }],
};
const SLASH_SEQ = [0, 1, 2, 4, 5, 6], SLASH_DUR = [0.06, 0.06, 0.06, 0.07, 0.07, 0.07];
const DASH_SEQ = [1, 2, 3, 4, 4, 6, 7];
const BLOCKS = [{ item: 'dirt', tile: TID.DIRT }, { item: 'stone', tile: TID.STONE }, { item: 'brick', tile: TID.BRICK }, { item: 'wood', tile: TID.PLANK }];

class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 18; this.h = 56; this.vx = 0; this.vy = 0; this.onGround = false;
    this.face = 1; this.hp = 100; this.maxHp = 100; this.mana = 100; this.maxMana = 100;
    this.atkT = -1; this.atkHit = false; this.dashT = -1; this.dashHit = new Set();
    this.hurtT = 0; this.inv = 0; this.dead = false; this.deathT = 0; this.sinceHurt = 99;
    this.coyote = 0; this.jumpBuf = 0; this.anim = 0; this.walkT = 0; this.mine = { x: -1, y: -1, p: 0 }; this.placeCd = 0;
    this.inv_ = { dirt: 0, stone: 0, wood: 0, iron: 0, gold: 0, crystal: 0, coin: 0, brick: 0, hpPot: 1, manaPot: 0, boots: 0, atk: 0, shield: 0, key: 0, map: 0 };
    this.gear = { sword: 0, pick: 0, armor: 0 };
    this.buff = { speed: 0, atk: 0, shield: 0 };
    this.block = 0;
  }
  get items() { return this.inv_; }
  get dmg() { return GEAR.sword[this.gear.sword].dmg * (this.buff.atk > 0 ? 1.6 : 1); }

  collect(item, n) {
    this.inv_[item] += n;
    if (item === 'map') { G.world.revealAll(); G.toast('Treasure map: the whole world is revealed (M)'); }
    if (item === 'coin') { G.score += n * 5; Sfx.play('coin'); } else Sfx.play('pickup');
    if (item === 'key') G.toast('Vault key found! Press F at a vault door');
  }

  hurt(dmg, fromX) {
    if (this.dead || this.inv > 0) return false;
    dmg *= (1 - GEAR.armor[this.gear.armor].red) * (this.buff.shield > 0 ? 0.4 : 1);
    dmg = Math.max(1, Math.round(dmg));
    this.hp -= dmg; this.inv = 0.8; this.hurtT = 0.28; this.sinceHurt = 0;
    const d = this.x >= fromX ? 1 : -1;
    this.vx = d * 260; this.vy = -240;
    this.atkT = -1;
    floatText(this.x, this.y - 70, '-' + dmg, '#ff6666');
    spawnParticles(this.x, this.y - 30, 10, '#d02020', 140, 0.5, 500, 3);
    G.shake = Math.max(G.shake, 7);
    Sfx.play('hurt');
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.deathT = 0; Sfx.play('die'); this.vx = d * 160; }
    return true;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); floatText(this.x, this.y - 70, '+' + n, '#7dff7d'); }

  use(item) {
    if (this.dead || this.inv_[item] <= 0) { if (!this.dead) Sfx.play('deny'); return; }
    if (item === 'hpPot') { if (this.hp >= this.maxHp) return; this.heal(50); }
    else if (item === 'manaPot') { if (this.mana >= this.maxMana) return; this.mana = Math.min(this.maxMana, this.mana + 70); floatText(this.x, this.y - 70, '+70 MP', '#6aa8ff'); }
    else if (item === 'boots') { this.buff.speed = 25; G.toast('Speed boots! (25s)'); }
    else if (item === 'atk') { this.buff.atk = 25; G.toast('Attack boost! (25s)'); }
    else if (item === 'shield') { this.buff.shield = 25; G.toast('Defense shield! (25s)'); }
    else return;
    this.inv_[item]--; Sfx.play('power');
    spawnParticles(this.x, this.y - 30, 14, '#ffffff', 120, 0.6, -50, 3);
  }

  startSlash() {
    if (this.dead || this.atkT >= 0 || this.dashT >= 0 || this.hurtT > 0) return;
    this.atkT = 0; this.atkHit = false;
    this.face = sign(G.mouseWorld.x - this.x);
    Sfx.play('slash');
  }

  startDash() {
    if (this.dead || this.dashT >= 0 || this.hurtT > 0 || this.mana < 30) { if (this.mana < 30 && !this.dead) Sfx.play('deny'); return; }
    this.mana -= 30; this.dashT = 0; this.atkT = -1; this.dashHit.clear();
    this.inv = Math.max(this.inv, 0.4);
    Sfx.play('dash');
  }

  slashBox() {
    return this.face > 0 ? { l: this.x + 2, r: this.x + 70, t: this.y - 66, b: this.y - 2 }
      : { l: this.x - 70, r: this.x - 2, t: this.y - 66, b: this.y - 2 };
  }

  doSlash() {
    const box = this.slashBox();
    G.fx.push({ kind: 'slash', x: this.x, y: this.y - 34, face: this.face, t: 0, life: 0.16 });
    let hit = false;
    for (const e of G.enemies) {
      if (e.dying || !overlap(box, boxOf(e))) continue;
      if (e.hurt(this.dmg, this.face, 1)) hit = true;
    }
    for (const pr of G.projectiles) if (pr.kind !== 'flame' && overlap(box, { l: pr.x - 8, r: pr.x + 8, t: pr.y - 8, b: pr.y + 8 })) {
      pr.dead = true; spawnParticles(pr.x, pr.y, 8, '#9ff', 100, 0.4, 0, 3); hit = true;
    }
    if (hit) { Sfx.play('hit'); G.shake = Math.max(G.shake, 3); }
  }

  update(dt) {
    const k = G.input;
    this.inv = Math.max(0, this.inv - dt); this.hurtT = Math.max(0, this.hurtT - dt);
    this.sinceHurt += dt; this.placeCd = Math.max(0, this.placeCd - dt);
    for (const b in this.buff) this.buff[b] = Math.max(0, this.buff[b] - dt);

    if (this.dead) {
      this.deathT += dt;
      this.vx *= Math.pow(0.02, dt); this.vy = Math.min(this.vy + 1500 * dt, 800);
      moveBody(this, dt);
      return;
    }
    // regen
    this.mana = Math.min(this.maxMana, this.mana + dt * (this.dashT >= 0 ? 0 : 7));
    if (this.sinceHurt > 6 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * 0.7);

    const dir = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const speed = 185 * (this.buff.speed > 0 ? 1.45 : 1);

    if (this.dashT >= 0) {
      this.dashT += dt;
      const moving = this.dashT < 0.24;
      this.vx = moving ? this.face * 640 : this.face * 120;
      this.vy = moving ? 0 : this.vy + 1500 * dt;
      if (moving) {
        const box = { l: this.x - 34, r: this.x + 34, t: this.y - 62, b: this.y };
        for (const e of G.enemies) if (!e.dying && !this.dashHit.has(e) && overlap(box, boxOf(e))) {
          this.dashHit.add(e);
          if (e.hurt(this.dmg * 1.8, this.face, 1.6)) { Sfx.play('hit'); G.shake = Math.max(G.shake, 5); }
        }
        if (Math.random() < 0.6) G.particles.push({ x: this.x - this.face * 20, y: this.y - rand(8, 50), vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#bfe8ff', g: 0, size: 3 });
      }
      if (this.dashT > 0.4) this.dashT = -1;
    } else {
      if (this.hurtT > 0.12) { /* stunned: keep knockback */ }
      else {
        const slow = this.atkT >= 0 ? 0.4 : 1;
        const target = dir * speed * slow;
        this.vx += (target - this.vx) * Math.min(1, dt * (this.onGround ? 16 : 7));
        if (dir && this.atkT < 0) this.face = dir;
      }
      // jump (buffered + coyote) with variable height
      if (k.jumpPressed) this.jumpBuf = 0.12;
      this.jumpBuf = Math.max(0, this.jumpBuf - dt);
      this.coyote = this.onGround ? 0.1 : Math.max(0, this.coyote - dt);
      if (this.jumpBuf > 0 && this.coyote > 0) {
        this.vy = -(570 + (this.buff.speed > 0 ? 40 : 0)); this.jumpBuf = 0; this.coyote = 0; Sfx.play('jump');
        spawnParticles(this.x, this.y, 5, '#a89c88', 60, 0.3, 200, 2);
      }
      if (!k.jump && this.vy < -220) this.vy *= 0.55;
      this.vy = Math.min(this.vy + 1500 * dt, 850);
    }
    const wasAir = !this.onGround, vyBefore = this.vy;
    moveBody(this, dt);
    if (wasAir && this.onGround && vyBefore > 380) spawnParticles(this.x, this.y, 6, '#a89c88', 70, 0.3, 200, 2);

    // slash timeline
    if (this.atkT >= 0) {
      this.atkT += dt;
      if (!this.atkHit && this.atkT >= 0.18) { this.atkHit = true; this.doSlash(); }
      if (this.atkT >= 0.39) this.atkT = -1;
    }
    if (k.attackPressed) this.startSlash();
    if (k.dashPressed) this.startDash();

    // animation clock
    this.anim += dt;
    if (this.onGround && Math.abs(this.vx) > 20) this.walkT += dt * Math.abs(this.vx) / 185;
    // clamp to world
    this.x = clamp(this.x, T * 2 + this.w, (WW - 2) * T - this.w);
  }

  // tile mining / placing driven by the mouse
  updateBuild(dt) {
    if (this.dead || G.state !== 'play') return;
    const m = G.mouseWorld, tx = Math.floor(m.x / T), ty = Math.floor(m.y / T);
    const reach = Math.hypot(tx * T + T / 2 - this.x, ty * T + T / 2 - (this.y - 30)) <= 4.8 * T;
    const w = G.world;
    G.target = { x: tx, y: ty, ok: reach };
    if (G.input.mineHeld && reach) {
      const id = w.get(tx, ty), d = TDEF[id];
      if (id !== TID.AIR && d.hard !== Infinity) {
        if (this.mine.x !== tx || this.mine.y !== ty) this.mine = { x: tx, y: ty, p: 0 };
        this.mine.p += dt * GEAR.pick[this.gear.pick].speed;
        if (Math.random() < dt * 14) { Sfx.play('mine'); spawnParticles(tx * T + 16, ty * T + 16, 2, '#b9a98c', 70, 0.35, 400, 2); }
        if (this.mine.p >= d.hard) { this.breakTile(tx, ty); this.mine = { x: -1, y: -1, p: 0 }; }
      } else this.mine = { x: -1, y: -1, p: 0 };
    } else this.mine = { x: -1, y: -1, p: 0 };

    if (G.input.placeHeld && reach && this.placeCd <= 0) {
      const b = BLOCKS[this.block];
      if (w.get(tx, ty) === TID.AIR && this.inv_[b.item] > 0) {
        const tb = { l: tx * T, r: tx * T + T, t: ty * T, b: ty * T + T };
        const blocked = overlap(tb, boxOf(this)) || G.enemies.some(e => !e.dying && overlap(tb, boxOf(e)));
        const support = w.get(tx + 1, ty) || w.get(tx - 1, ty) || w.get(tx, ty + 1) || w.get(tx, ty - 1);
        if (!blocked && support) {
          w.set(tx, ty, b.tile); this.inv_[b.item]--; this.placeCd = 0.12; Sfx.play('place');
        }
      }
    }
  }

  breakTile(tx, ty) {
    const w = G.world, id = w.get(tx, ty), d = TDEF[id];
    w.set(tx, ty, TID.AIR);
    const cx = tx * T + T / 2, cy = ty * T + T / 2;
    Sfx.play('break'); spawnParticles(cx, cy, 10, '#b9a98c', 110, 0.5, 450, 3);
    if (d.drop) {
      const n = d.drop[1] + Math.floor(Math.random() * (d.drop[2] - d.drop[1] + 1));
      for (let i = 0; i < n; i++) G.pickups.push(new Pickup(d.drop[0], 1, cx, cy));
    }
    if (d.loot) {
      const r = Math.random();
      if (r < 0.35) G.pickups.push(new Pickup('coin', 1 + Math.floor(Math.random() * 3), cx, cy));
      else if (r < 0.5) G.pickups.push(new Pickup('hpPot', 1, cx, cy));
      else if (r < 0.58) G.pickups.push(new Pickup('manaPot', 1, cx, cy));
      else if (r < 0.64) G.pickups.push(new Pickup('key', 1, cx, cy));
      else if (r < 0.7) G.pickups.push(new Pickup(['boots', 'atk', 'shield'][Math.floor(Math.random() * 3)], 1, cx, cy));
    }
    // loose leaves / trunks above a mined trunk keep floating; clear dangling foliage for cleanliness
    if (id === TID.TRUNK) for (let y = ty - 1; y > ty - 8; y--) { const a = w.get(tx, y); if (a === TID.TRUNK) { /* leave */ } }
  }

  draw(ctx) {
    const flip = this.face < 0;
    if (this.inv > 0 && !this.dead && Math.floor(this.inv * 20) % 2 === 0 && this.hurtT <= 0) ctx.globalAlpha = 0.55;
    const S = 0.72;
    let g, i;
    if (this.dead) { g = 'p_death'; i = this.deathT < 0.3 ? 0 : this.deathT < 0.6 ? 1 : this.deathT < 0.9 ? 2 : 3; }
    else if (this.hurtT > 0) { g = 'p_death'; i = 0; }
    else if (this.dashT >= 0) { g = 'p_dash'; i = DASH_SEQ[Math.min(DASH_SEQ.length - 1, Math.floor(this.dashT / 0.4 * DASH_SEQ.length))]; }
    else if (this.atkT >= 0) {
      let acc = 0, idx = 0; for (; idx < SLASH_DUR.length - 1; idx++) { acc += SLASH_DUR[idx]; if (this.atkT < acc) break; }
      g = 'p_slash'; i = SLASH_SEQ[idx];
    } else if (!this.onGround) { g = 'p_walk'; i = this.vy < 0 ? 3 : 5; }
    else if (Math.abs(this.vx) > 20) { g = 'p_walk'; i = Math.floor(this.walkT * 9); }
    else { g = 'p_walk'; i = 0; }
    const breathe = this.onGround && !this.dead && g === 'p_walk' && i === 0 ? 1 + Math.sin(this.anim * 3) * 0.012 : 1;
    ctx.save(); ctx.translate(this.x, this.y); ctx.scale(1, breathe); ctx.translate(-this.x, -this.y);
    Assets.char(ctx, g, i, this.x, this.y + 2, S, flip);
    ctx.restore();
    if (this.buff.shield > 0 && !this.dead) {
      ctx.globalAlpha = 0.25 + Math.sin(this.anim * 6) * 0.08; ctx.fillStyle = '#5ab6ff';
      ctx.beginPath(); ctx.ellipse(this.x, this.y - 30, 28, 38, 0, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- enemies
const EDEF = {
  zombie: { hp: 30, w: 20, h: 58, speed: 52, scale: 0.74, dmg: 10, range: 30, atkTime: 0.6, hitAt: 0.32, cd: 1.1, aggro: 650, coins: [1, 2], kb: 170,
    g: { idle: 'zombie_idle', walk: 'zombie_walk', atk: 'zombie_atk', die: 'zombie_die' } },
  skeleton: { hp: 40, w: 20, h: 58, speed: 72, scale: 0.85, dmg: 12, range: 42, atkTime: 0.5, hitAt: 0.26, cd: 0.9, aggro: 650, coins: [1, 3], kb: 150,
    g: { idle: 'skel_idle', walk: 'skel_walk', atk: 'skel_atk', die: 'skel_die' } },
  necro: { hp: 45, w: 20, h: 56, speed: 48, scale: 0.9, dmg: 14, range: 0, atkTime: 0.7, hitAt: 0.5, cd: 2.8, aggro: 560, coins: [2, 4], kb: 120,
    g: { idle: 'necro_idle', walk: 'necro_walk', cast: 'necro_cast', summon: 'necro_summon' } },
  spawn: { hp: 10, w: 16, h: 30, speed: 105, scale: 0.8, dmg: 6, range: 22, atkTime: 0.3, hitAt: 0.15, cd: 0.7, aggro: 600, coins: [0, 1], kb: 120,
    g: { walk: 'spawn_walk' } },
  knight: { hp: 420, w: 42, h: 96, speed: 64, scale: 1.75, dmg: 22, range: 0, boss: true, kb: 0, coins: [30, 40],
    g: { idle: 'knight_idle', walk: 'knight_walk', swing: 'knight_swing', bash: 'knight_bash', die: 'knight_die' } },
  king: { hp: 520, w: 36, h: 80, speed: 130, scale: 1.7, dmg: 12, range: 0, boss: true, kb: 0, coins: [40, 60], flying: true,
    g: { idle: 'king_idle', walk: 'king_move', beam: 'king_beam', summon: 'king_summon', hurt: 'king_hurt', die: 'king_die' } },
};
const BOSS_NAME = { knight: 'The Cursed Knight', king: 'The Necromancer King' };

class Enemy {
  constructor(type, x, y, hpMul) {
    const d = EDEF[type];
    this.type = type; this.d = d; this.x = x; this.y = y; this.w = d.w; this.h = d.h; this.vx = 0; this.vy = 0;
    this.maxHp = Math.round(d.hp * (hpMul || 1)); this.hp = this.maxHp; this.boss = !!d.boss;
    this.dir = -1; this.t = Math.random() * 10; this.state = 'move'; this.st = 0; this.cd = rand(0.3, 1.2);
    this.atkT = -1; this.hit = false; this.flash = 0; this.stun = 0; this.dying = false; this.dieT = 0; this.dead = false;
    this.wanderT = 0; this.onGround = false; this.alpha = 1; this.phase2 = false; this.sumCd = rand(4, 8); this.tpCd = 10;
    this.burnT = 0; this.hover = Math.random() * 6;
  }

  hurt(dmg, dir, kbMul) {
    if (this.dying) return false;
    if (this.state === 'tele') return false;
    dmg = Math.round(dmg);
    this.hp -= dmg; this.flash = 0.12;
    floatText(this.x, this.y - this.h - 6, String(dmg), '#ffe066');
    spawnParticles(this.x, this.y - this.h / 2, 6, this.type === 'skeleton' ? '#e8dfc0' : '#7fb04d', 120, 0.4, 500, 3);
    if (!this.boss) {
      this.stun = 0.25; this.vx = dir * this.d.kb * (kbMul || 1); this.vy = -150; this.atkT = -1;
    } else if (this.type === 'king') this.hurtT = 0.18;
    if (this.hp <= 0) { this.die(); return true; }
    return true;
  }

  die() {
    this.dying = true; this.dieT = 0; this.vx = 0; this.atkT = -1;
    G.kills++; G.score += this.boss ? 500 : 10;
    Sfx.play('die');
    const d = this.d, n = d.coins ? d.coins[0] + Math.floor(Math.random() * (d.coins[1] - d.coins[0] + 1)) : 0;
    const cx = this.x, cy = this.y - this.h / 2;
    for (let i = 0; i < n; i++) G.pickups.push(new Pickup('coin', 1, cx, cy));
    const r = Math.random();
    if (this.boss) {
      for (let i = 0; i < 6; i++) G.pickups.push(new Pickup('crystal', 1, cx, cy));
      for (let i = 0; i < 3; i++) G.pickups.push(new Pickup('gold', 1, cx, cy));
      for (const it of ['hpPot', 'hpPot', 'manaPot', 'boots', 'atk', 'shield']) G.pickups.push(new Pickup(it, 1, cx, cy));
      if (this.type === 'knight') { G.pickups.push(new Pickup('key', 1, cx, cy)); G.pickups.push(new Pickup('map', 1, cx, cy)); }
      G.shake = 14; Sfx.play('boss');
      if (this.type === 'knight') G.toast('The Cursed Knight has fallen!');
      if (this.type === 'king') G.winT = 0.01;
    } else {
      if (r < 0.14) G.pickups.push(new Pickup('crystal', 1, cx, cy));
      else if (r < 0.22) G.pickups.push(new Pickup('hpPot', 1, cx, cy));
      else if (r < 0.27) G.pickups.push(new Pickup('manaPot', 1, cx, cy));
      else if (r < 0.30) G.pickups.push(new Pickup(['boots', 'atk', 'shield'][Math.floor(Math.random() * 3)], 1, cx, cy));
      else if (r < 0.32) G.pickups.push(new Pickup('key', 1, cx, cy));
    }
    if (this.type === 'necro' || this.type === 'spawn') spawnParticles(cx, cy, 16, '#a060ff', 140, 0.7, 0, 3);
  }

  nearPlayer() { return Math.hypot(G.player.x - this.x, G.player.y - this.y); }

  // ---- AI
  update(dt) {
    this.t += dt; this.flash = Math.max(0, this.flash - dt); this.cd -= dt;
    if (this.dying) {
      this.dieT += dt;
      if (!this.d.flying) { this.vy = Math.min(this.vy + 1500 * dt, 800); this.vx *= 0.9; moveBody(this, dt); }
      const hold = this.boss ? 2.2 : (this.d.g.die ? 1.4 : 0.7);
      if (this.dieT > hold) this.alpha = Math.max(0, 1 - (this.dieT - hold) / 0.6);
      if (this.dieT > hold + 0.6) this.dead = true;
      return;
    }
    switch (this.type) {
      case 'knight': this.aiKnight(dt); break;
      case 'king': this.aiKing(dt); break;
      case 'necro': this.aiNecro(dt); break;
      default: this.aiMelee(dt);
    }
    // sunlight burns surface undead at dawn
    if (!this.boss && G.sun > 0.55 && this.exposed()) {
      this.burnT += dt;
      if (this.burnT > 0.5) { this.burnT = 0; this.hp -= 8; this.flash = 0.1; spawnParticles(this.x, this.y - 30, 4, '#ff9a3a', 60, 0.5, -80, 3); if (this.hp <= 0) this.die(); }
    }
    if (this.nearPlayer() > 1500 && !this.boss) this.dead = true;
  }

  exposed() {
    const tx = Math.floor(this.x / T), ty = Math.floor((this.y - this.h) / T);
    for (let y = ty; y >= Math.max(0, ty - 12); y--) { const id = G.world.get(tx, y); if (TDEF[id].solid) return false; }
    return true;
  }

  walkToward(dir, speed, dt) {
    this.vx += (dir * speed - this.vx) * Math.min(1, dt * 10);
    if (this.hitWall && this.onGround) this.vy = -390; // hop 1-block ledges
  }

  physics(dt) {
    this.vy = Math.min(this.vy + 1500 * dt, 800);
    moveBody(this, dt);
  }

  aiMelee(dt) {
    const p = G.player, d = this.d, dx = p.x - this.x, dist = Math.abs(dx), dy = p.y - this.y;
    if (this.stun > 0) { this.stun -= dt; this.vx *= 0.92; this.physics(dt); return; }
    const hunting = !p.dead && dist < d.aggro && Math.abs(dy) < 420;
    if (this.atkT >= 0) {
      this.atkT += dt; this.vx *= 0.8;
      if (!this.hit && this.atkT >= d.hitAt) {
        this.hit = true;
        const reach = d.range + 16;
        if (Math.abs(p.x - this.x) < reach + p.w / 2 && Math.abs(p.y - this.y) < 56 && sign(p.x - this.x) === this.dir) p.hurt(d.dmg * G.dmgScale(), this.x);
        if (this.type === 'spawn') this.vx = this.dir * 160;
      }
      if (this.atkT >= d.atkTime) { this.atkT = -1; this.cd = d.cd; }
    } else if (hunting) {
      this.dir = sign(dx);
      if (dist < d.range && Math.abs(dy) < 50 && this.cd <= 0) { this.atkT = 0; this.hit = false; }
      else if (dist > d.range * 0.7) this.walkToward(this.dir, d.speed * (G.night > 0.5 ? 1.15 : 1), dt);
      else this.vx *= 0.8;
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) { this.wanderT = rand(1.5, 4); this.dir = Math.random() < 0.5 ? -1 : 1; this.wanderMove = Math.random() < 0.6; }
      if (this.wanderMove) this.walkToward(this.dir, d.speed * 0.35, dt); else this.vx *= 0.85;
    }
    this.physics(dt);
  }

  aiNecro(dt) {
    const p = G.player, d = this.d, dx = p.x - this.x, dist = Math.abs(dx);
    if (this.stun > 0) { this.stun -= dt; this.vx *= 0.92; this.physics(dt); return; }
    this.sumCd -= dt;
    if (this.state === 'cast' || this.state === 'summon') {
      this.st += dt; this.vx *= 0.8;
      if (this.state === 'cast' && !this.hit && this.st >= 0.5) {
        this.hit = true; Sfx.play('cast');
        const ax = p.x - this.x, ay = (p.y - 30) - (this.y - 40), l = Math.hypot(ax, ay) || 1;
        G.projectiles.push(new Projectile('orb', this.x + this.dir * 14, this.y - 40, ax / l * 230, ay / l * 230, d.dmg * G.dmgScale(), 4));
      }
      if (this.state === 'summon' && !this.hit && this.st >= 0.7) {
        this.hit = true; Sfx.play('summon');
        const live = G.enemies.filter(e => e.type === 'spawn' && !e.dying).length;
        for (let i = 0; i < 2 && live + i < 6; i++) G.enemies.push(new Enemy('spawn', this.x + (i ? 24 : -24), this.y - 4, G.hpScale()));
        spawnParticles(this.x, this.y - 10, 14, '#4fd8ff', 100, 0.6, -60, 3);
      }
      if (this.st >= (this.state === 'cast' ? 0.75 : 1.0)) { this.state = 'move'; this.cd = d.cd; }
    } else if (!p.dead && dist < d.aggro) {
      this.dir = sign(dx);
      if (this.sumCd <= 0 && dist < 460) { this.state = 'summon'; this.st = 0; this.hit = false; this.sumCd = rand(9, 13); }
      else if (this.cd <= 0 && dist < 440) { this.state = 'cast'; this.st = 0; this.hit = false; }
      else if (dist < 150) this.walkToward(-this.dir, d.speed * 1.2, dt);
      else if (dist > 280) this.walkToward(this.dir, d.speed, dt);
      else this.vx *= 0.85;
    } else {
      this.vx *= 0.85;
    }
    this.physics(dt);
  }

  aiKnight(dt) {
    const p = G.player, d = this.d, dx = p.x - this.x, dist = Math.abs(dx);
    if (!this.phase2 && this.hp < this.maxHp * 0.5) { this.phase2 = true; G.toast('The Cursed Knight is enraged!'); G.shake = 8; Sfx.play('boss'); }
    const spd = d.speed * (this.phase2 ? 1.5 : 1);
    this.st += dt;
    if (this.state === 'move') {
      if (!p.dead) { this.dir = sign(dx); if (dist > 70) this.walkToward(this.dir, spd, dt); else this.vx *= 0.8; }
      else this.vx *= 0.9;
      if (this.cd <= 0 && !p.dead) {
        if (dist < 130) { this.state = 'swing'; this.st = 0; this.hit = false; }
        else if (dist < 420 && Math.random() < 0.55) { this.state = 'bash'; this.st = 0; this.hit = false; }
        else this.cd = 0.5;
      }
    } else if (this.state === 'swing') {
      this.vx *= 0.8;
      if (!this.hit && this.st >= 0.6) {
        this.hit = true; Sfx.play('slash'); G.shake = Math.max(G.shake, 5);
        if (Math.abs(p.x - this.x) < 125 && Math.abs(p.y - this.y) < 90 && sign(p.x - this.x) === this.dir) p.hurt(d.dmg * G.dmgScale(), this.x);
        if (this.phase2) G.projectiles.push(new Projectile('flame', this.x + this.dir * 50, this.y, this.dir * 300, 0, 16 * G.dmgScale(), 1.6));
      }
      if (this.st >= 0.95) { this.state = 'move'; this.cd = this.phase2 ? 1.0 : 1.8; }
    } else if (this.state === 'bash') {
      if (this.st < 0.35) this.vx *= 0.8;
      else if (this.st < 0.9) {
        this.vx = this.dir * (this.phase2 ? 480 : 400);
        if (!this.hit && Math.abs(p.x - this.x) < 48 && Math.abs(p.y - this.y) < 70) { this.hit = true; p.hurt(18 * G.dmgScale(), this.x); p.vx = this.dir * 420; }
        if (this.hitWall && this.onGround) this.vy = -380;
      } else this.vx *= 0.8;
      if (this.st >= 1.3) { this.state = 'move'; this.cd = this.phase2 ? 1.0 : 1.8; }
    }
    this.physics(dt);
  }

  aiKing(dt) {
    const p = G.player, d = this.d;
    if (!this.phase2 && this.hp < this.maxHp * 0.5) { this.phase2 = true; G.toast('The Necromancer King unleashes his power!'); G.shake = 8; Sfx.play('boss'); }
    this.hover += dt; this.hurtT = Math.max(0, (this.hurtT || 0) - dt);
    this.tpCd -= dt; this.sumCd -= dt; this.st += dt;
    const dx = p.x - this.x;
    if (this.state !== 'tele') this.dir = sign(dx);
    // hover near the player, keeping some distance
    const side = this.sideSign || (this.sideSign = Math.random() < 0.5 ? -1 : 1);
    let tx = p.x - side * 190, ty = p.y - 78 + Math.sin(this.hover * 1.7) * 16;
    if (this.state === 'beam' || this.state === 'summon') { tx = this.x; ty = this.y; }
    const mx = clamp((tx - this.x) * 1.4, -d.speed, d.speed), my = clamp((ty - (this.y - 40)) * 1.4, -d.speed, d.speed);
    this.vx += (mx - this.vx) * Math.min(1, dt * 4); this.vy += (my - this.vy) * Math.min(1, dt * 4);
    this.x = clamp(this.x + this.vx * dt, 3 * T, (WW - 3) * T); this.y = clamp(this.y + this.vy * dt, 4 * T, (WH - 3) * T);

    if (this.state === 'move') {
      if (this.tpCd <= 0 && !p.dead) { this.state = 'tele'; this.st = 0; this.tpDone = false; this.tpCd = this.phase2 ? 7 : 11; }
      else if (this.cd <= 0 && !p.dead) {
        const live = G.enemies.filter(e => !e.boss && !e.dying).length;
        if (this.sumCd <= 0 && live < 6) { this.state = 'summon'; this.hit = false; this.sumCd = this.phase2 ? 9 : 13; }
        else this.state = 'beam', this.hit = false;
        this.st = 0;
      }
    } else if (this.state === 'beam') {
      if (!this.hit && this.st >= 0.6) {
        this.hit = true; Sfx.play('cast');
        const n = this.phase2 ? 7 : 5, base = Math.atan2((p.y - 30) - (this.y - 45), p.x - this.x);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.26, pr = new Projectile('skull', this.x + this.dir * 20, this.y - 45, Math.cos(a) * 225, Math.sin(a) * 225, d.dmg * 0.95 * G.dmgScale(), 4.5);
          pr.homing = 0.7; G.projectiles.push(pr);
        }
      }
      if (this.st >= 1.0) { this.state = 'move'; this.cd = this.phase2 ? 1.8 : 2.8; }
    } else if (this.state === 'summon') {
      if (!this.hit && this.st >= 0.75) {
        this.hit = true; Sfx.play('summon');
        for (let i = 0; i < 3; i++) {
          const sx = clamp(p.x + rand(-260, 260), 5 * T, (WW - 5) * T), sy = groundY(sx, p.y - 200);
          G.enemies.push(new Enemy(i === 2 ? 'skeleton' : 'zombie', sx, sy - 1, G.hpScale()));
          spawnParticles(sx, sy - 20, 14, '#a060ff', 120, 0.6, -80, 3);
        }
      }
      if (this.st >= 1.1) { this.state = 'move'; this.cd = this.phase2 ? 1.6 : 2.6; }
    } else if (this.state === 'tele') {
      this.alpha = this.st < 0.4 ? 1 - this.st / 0.4 : Math.min(1, (this.st - 0.4) / 0.4);
      if (this.st >= 0.4 && !this.tpDone) {
        this.tpDone = true; this.sideSign = -this.sideSign;
        this.x = clamp(p.x + this.sideSign * -rand(190, 260), 4 * T, (WW - 4) * T); this.y = clamp(p.y - rand(60, 140), 5 * T, (WH - 4) * T);
        spawnParticles(this.x, this.y - 40, 16, '#b080ff', 120, 0.6, 0, 3);
      }
      if (this.st >= 0.8) { this.state = 'move'; this.alpha = 1; this.cd = 0.8; }
    }
    // contact damage
    if (!p.dead && this.state !== 'tele' && overlap(boxOf(this), boxOf(p))) p.hurt(d.dmg * G.dmgScale(), this.x);
  }

  // ---- drawing
  frame() {
    const g = this.d.g, t = this.t;
    const loop = (grp, fps) => [grp, Math.floor(t * fps) % Assets.count(grp)];
    if (this.dying) {
      if (g.die) { const n = Assets.count(g.die), per = this.boss ? 0.28 : 0.13; return [g.die, Math.min(n - 1, Math.floor(this.dieT / per))]; }
      return [g.idle || g.walk, 0];
    }
    switch (this.type) {
      case 'zombie': case 'skeleton':
        if (this.atkT >= 0) return [g.atk, Math.min(3, Math.floor(this.atkT / this.d.atkTime * 4))];
        if (Math.abs(this.vx) > 8) return loop(g.walk, 7);
        return loop(g.idle, 3);
      case 'spawn': return loop(g.walk, Math.abs(this.vx) > 10 ? 9 : 4);
      case 'necro':
        if (this.state === 'cast') return [g.cast, Math.min(5, Math.floor(this.st / 0.75 * 6))];
        if (this.state === 'summon') return [g.summon, Math.min(6, Math.floor(this.st / 1.0 * 7))];
        return Math.abs(this.vx) > 8 ? loop(g.walk, 6) : loop(g.idle, 3);
      case 'knight':
        if (this.state === 'swing') return [g.swing, this.st < 0.6 ? Math.min(3, Math.floor(this.st / 0.15)) : Math.min(6, 4 + Math.floor((this.st - 0.6) / 0.11))];
        if (this.state === 'bash') return [g.bash, this.st < 0.35 ? 0 : 1 + Math.floor(this.st * 10) % 3];
        return Math.abs(this.vx) > 8 ? loop(g.walk, 7) : loop(g.idle, 4);
      case 'king':
        if (this.hurtT > 0 && this.state === 'move') return [g.hurt, 0];
        if (this.state === 'beam') return [g.beam, Math.min(6, Math.floor(this.st / 0.8 * 7))];
        if (this.state === 'summon') return [g.summon, Math.min(4, Math.floor(this.st / 0.9 * 5))];
        return Math.abs(this.vx) > 25 ? loop(g.walk, 6) : loop(g.idle, 4);
    }
    return [g.idle || g.walk, 0];
  }

  draw(ctx) {
    const [grp, idx] = this.frame();
    const bob = this.type === 'king' && !this.dying ? Math.sin(this.hover * 3) * 3 : 0;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    if (this.dying && this.type === 'spawn') ctx.globalAlpha = Math.max(0, 1 - this.dieT / 0.5);
    if (this.dying && this.type === 'necro') ctx.globalAlpha = Math.max(0, 1 - this.dieT / 0.6);
    const flip = this.dir < 0;
    Assets.char(ctx, grp, idx, this.x, this.y + 2 + bob, this.d.scale, flip);
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55 * this.alpha;
      Assets.char(ctx, grp, idx, this.x, this.y + 2 + bob, this.d.scale, flip);
    }
    ctx.restore();
    if (!this.boss && !this.dying && this.hp < this.maxHp) {
      const w = 26, x = this.x - w / 2, y = this.y - this.h - 10;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
      ctx.fillStyle = '#d83a3a'; ctx.fillRect(x, y, w * Math.max(0, this.hp / this.maxHp), 3);
    }
  }
}
