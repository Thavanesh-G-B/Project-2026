/**
 * Orbital sortie: a top-down space fight above a planet, in the spirit of a lunar-lander
 * (thrust, drift, a fuel tank to watch). DOM-free so it can be tested headlessly.
 *
 * Units are sprite pixels: the renderer draws one unit as 3 screen pixels. Angles are radians with 0 facing
 * right, which is how the ship sprites are drawn.
 */
import { bossBonus, getPlanet, PlanetDef } from '../game/balance';
import { mulberry32 } from '../game/terrain';
import type { BossPattern } from '../game/balance';
import type { RigStats } from '../types';

export const ARENA_W = 1800;
export const ARENA_H = 1300;

export type ShipKind = 'scout' | 'fighter' | 'gunship' | 'heavy' | 'cruiser';
export type PickupKind = 'fuel' | 'repair' | 'missile' | 'shield' | 'scrap' | 'crew' | 'core';

export interface ShipDef {
  kind: ShipKind;
  name: string;
  sprite: number; // column in ships.png
  hp: number;
  r: number;
  scrap: number;
  armor: number; // fraction of damage ignored
  minWave: number;
  cost: number; // wave budget points
}

export const SHIPS: Record<ShipKind, ShipDef> = {
  scout: { kind: 'scout', name: 'Scout', sprite: 0, hp: 14, r: 8, scrap: 5, armor: 0, minWave: 1, cost: 1 },
  fighter: { kind: 'fighter', name: 'Fighter', sprite: 1, hp: 30, r: 11, scrap: 9, armor: 0, minWave: 2, cost: 3 },
  gunship: { kind: 'gunship', name: 'Gunship', sprite: 2, hp: 60, r: 13, scrap: 16, armor: 0.1, minWave: 4, cost: 5 },
  heavy: { kind: 'heavy', name: 'Heavy', sprite: 3, hp: 120, r: 16, scrap: 30, armor: 0.25, minWave: 7, cost: 9 },
  cruiser: { kind: 'cruiser', name: 'Cruiser', sprite: 4, hp: 1, r: 27, scrap: 0, armor: 0.1, minWave: 5, cost: 0 },
};

export interface SInput {
  moveX: number; // -1..1 screen-space thrust
  moveY: number;
  boost: boolean;
  fire: boolean;
  aimX: number; // world coordinates
  aimY: number;
}
export const NO_SINPUT: SInput = { moveX: 0, moveY: 0, boost: false, fire: false, aimX: 0, aimY: 0 };

export interface Enemy {
  id: number;
  kind: ShipKind;
  row: number; // colour row in ships.png (0 green, 1 red)
  x: number; y: number; vx: number; vy: number; angle: number;
  hp: number; maxHp: number; r: number;
  t: number; // shoot timer
  t2: number; // secondary timer (missiles)
  flash: number;
  phase: number;
  dir: number; // strafe direction
  // boss
  boss: boolean;
  bossIndex: number;
  atk: string;
  atkT: number;
  atkN: number;
  patIdx: number;
  tx: number; ty: number;
  name: string;
}

export interface Bullet {
  x: number; y: number; vx: number; vy: number; dmg: number; life: number; r: number;
  fromPlayer: boolean; kind: 'pulse' | 'orange' | 'green' | 'big' | 'mine' | 'missile';
  homing?: boolean; turn?: number; arm?: number; blast?: number; crit?: boolean; hp?: number;
}

export interface Asteroid { x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number; hp: number; r: number; variant: number }
export interface Pickup { x: number; y: number; vx: number; vy: number; kind: PickupKind; age: number }
export interface Blast { x: number; y: number; t: number; size: number }
export interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
export interface Floater { x: number; y: number; text: string; color: string; life: number }
export interface Beam { x: number; y: number; angle: number; len: number; live: boolean }

export type SEvent =
  | { type: 'shoot' } | { type: 'missile' } | { type: 'hit' } | { type: 'hurt' } | { type: 'explode'; big: boolean }
  | { type: 'pickup'; kind: PickupKind } | { type: 'wave'; wave: number; boss: boolean } | { type: 'waveClear'; wave: number; bonus: number }
  | { type: 'boss'; name: string } | { type: 'bossDown' } | { type: 'lowfuel' } | { type: 'emp' } | { type: 'crew' }
  | { type: 'end'; result: SortieResult };

export interface SortieResult {
  planetId: number;
  outcome: 'retreat' | 'destroyed';
  scrap: number;
  neuroCores: number;
  wave: number;
  kills: number;
  bossesDown: number;
  crewRescued: number;
  asteroids: number;
}

const SHIP_R = 9;
const MAX_SPEED = 120;
const BOOST_SPEED = 185;
const ACCEL = 260;
const FUEL_BURN = 5;
const SHOT_COST = 4;
const OVERRIDE_COOLDOWN = 40;
export const KEEP_ON_DEATH = 0.5;

/** Which attack names the space boss understands; planet patterns without a space version map onto one. */
const PATTERN_MAP: Record<BossPattern, string> = {
  ring: 'ring', aimed: 'aimed', dash: 'dash', summon: 'summon', sweep: 'sweep', shards: 'ring', mines: 'mines', blink: 'dash', spiral: 'spiral',
};

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const wrapAngle = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/** Colour row of ships.png for a planet's hostile faction (the player is always the blue row, 2). */
export const factionRow = (planetId: number) => (planetId === 2 || planetId === 3 || planetId === 5 ? 1 : 0);

export class SpaceEngine {
  readonly planet: PlanetDef;
  readonly stats: RigStats;
  readonly rnd: () => number;

  time = 0;
  status: 'running' | 'ended' = 'running';
  result: SortieResult | null = null;

  // ship
  x = ARENA_W / 2; y = ARENA_H / 2; vx = 0; vy = 0; angle = 0; thrust = 0; boosting = false;
  hull: number; shield: number; fuel: number; energy: number; missiles: number;
  shieldDelay = 0; fireCd = 0; hurtFlash = 0; overrideCd = 0; recallHeld = 0;

  // run tally
  scrap = 0; cores = 0; kills = 0; bossesDown = 0; crewRescued = 0; asteroidsDestroyed = 0;
  private coreFrac = 0;

  // waves
  wave = 0;
  breakT = 3;
  waveActive = false;
  private spawnQueue: Array<{ kind: ShipKind; at: number }> = [];

  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  asteroids: Asteroid[] = [];
  pickups: Pickup[] = [];
  blasts: Blast[] = [];
  sparks: Spark[] = [];
  floaters: Floater[] = [];
  beams: Beam[] = [];
  events: SEvent[] = [];

  private nextId = 1;
  private crewT = 22;
  private rockT = 6;
  private lowFuelWarned = false;
  /** Once the tank runs dry the thrusters stay off until a little fuel has trickled back. */
  private dry = false;

  constructor(planetId: number, stats: RigStats, seed: number = (Date.now() & 0xffff) + 1) {
    this.planet = getPlanet(planetId);
    this.stats = stats;
    this.rnd = mulberry32(seed + 91);
    this.hull = stats.maxHull;
    this.shield = stats.maxShield;
    this.fuel = stats.maxFuel;
    this.energy = stats.maxEnergy;
    this.missiles = stats.bombs * 2;
    for (let i = 0; i < 12; i++) this.spawnAsteroid(this.rnd() < 0.5 ? 0 : 1, true);
  }

  // ------------------------------------------------------------ helpers

  private emit(e: SEvent) { this.events.push(e); }
  drainEvents(): SEvent[] { const e = this.events; this.events = []; return e; }
  get overrideReady() { return this.overrideCd <= 0 && this.status === 'running'; }
  get boss(): Enemy | undefined { return this.enemies.find((e) => e.boss); }
  get hostileRow() { return factionRow(this.planet.id); }
  /** Ship look improves with hull upgrades: blue fighter -> gunship -> heavy. */
  get shipSprite() { const lvl = Math.round((this.stats.maxHull - 100) / 25); return lvl >= 4 ? 4 : lvl >= 2 ? 3 : lvl >= 1 ? 2 : 1; }

  private floater(x: number, y: number, text: string, color: string) { this.floaters.push({ x, y, text, color, life: 1.1 }); }
  private spark(x: number, y: number, color: string, n: number, speed = 60, size = 1.6) {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, s = speed * (0.3 + this.rnd());
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + this.rnd() * 0.4, max: 0.75, color, size });
    }
  }
  private boom(x: number, y: number, size: number) { this.blasts.push({ x, y, t: 0, size }); this.emit({ type: 'explode', big: size > 1.5 }); }
  private value(v: number) { return Math.round(v * this.planet.scrapMult * this.stats.oreValueMult); }

  // ------------------------------------------------------------ damage

  damageShip(raw: number) {
    if (this.status === 'ended') return;
    const amt = raw * (1 - this.stats.damageReduction);
    this.shieldDelay = 3.5;
    this.hurtFlash = 0.25;
    let rest = amt;
    if (this.shield > 0) { const a = Math.min(this.shield, rest); this.shield -= a; rest -= a; }
    if (rest > 0) this.hull -= rest;
    if (raw >= 2) this.emit({ type: 'hurt' });
    if (this.hull <= 0) { this.hull = 0; this.boom(this.x, this.y, 2); this.finish('destroyed'); }
  }

  // ------------------------------------------------------------ main update

  update(dt: number, input: SInput) {
    if (this.status !== 'running') return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.overrideCd = Math.max(0, this.overrideCd - dt);

    this.updateShip(dt, input);
    this.updateWaves(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateAsteroids(dt);
    this.updatePickups(dt);
    this.updateFx(dt);

    this.shieldDelay = Math.max(0, this.shieldDelay - dt);
    if (this.shieldDelay <= 0) this.shield = Math.min(this.stats.maxShield, this.shield + 7 * dt);
    this.energy = Math.min(this.stats.maxEnergy, this.energy + 16 * dt);
    if (this.fuel < this.stats.maxFuel * 0.2 && !this.lowFuelWarned) { this.lowFuelWarned = true; this.emit({ type: 'lowfuel' }); }
    if (this.fuel > this.stats.maxFuel * 0.35) this.lowFuelWarned = false;
  }

  // ------------------------------------------------------------ ship

  private updateShip(dt: number, input: SInput) {
    const mag = Math.hypot(input.moveX, input.moveY);
    const want = mag > 1 ? 1 : mag;
    if (this.fuel <= 0) this.dry = true;
    else if (this.fuel > this.stats.maxFuel * 0.04) this.dry = false;
    const canThrust = !this.dry && this.fuel > 0 && want > 0;
    const boost = input.boost && canThrust;
    this.boosting = boost;
    this.thrust = canThrust ? want : 0;
    const cap = (boost ? BOOST_SPEED : MAX_SPEED) * this.stats.moveSpeed;
    if (canThrust) {
      this.vx += (input.moveX / (mag || 1)) * ACCEL * want * dt * (boost ? 1.5 : 1);
      this.vy += (input.moveY / (mag || 1)) * ACCEL * want * dt * (boost ? 1.5 : 1);
      this.fuel = Math.max(0, this.fuel - FUEL_BURN * want * (boost ? 2 : 1) * dt);
    } else {
      this.fuel = Math.min(this.stats.maxFuel, this.fuel + 1.6 * dt); // a trickle, so a dry tank is never a dead end
    }
    // inertia with a light drag, a speed cap, and a soft cap that bleeds off when over it
    const drag = canThrust ? 0.35 : 0.9;
    this.vx -= this.vx * drag * dt; this.vy -= this.vy * drag * dt;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > cap) { const k = Math.max(cap / sp, 1 - 5 * dt); this.vx *= k; this.vy *= k; }
    this.x += this.vx * dt; this.y += this.vy * dt;
    // the arena edge is a soft wall
    if (this.x < SHIP_R) { this.x = SHIP_R; this.vx = Math.abs(this.vx) * 0.4; }
    if (this.x > ARENA_W - SHIP_R) { this.x = ARENA_W - SHIP_R; this.vx = -Math.abs(this.vx) * 0.4; }
    if (this.y < SHIP_R) { this.y = SHIP_R; this.vy = Math.abs(this.vy) * 0.4; }
    if (this.y > ARENA_H - SHIP_R) { this.y = ARENA_H - SHIP_R; this.vy = -Math.abs(this.vy) * 0.4; }

    // turn toward the cursor
    const want_a = Math.atan2(input.aimY - this.y, input.aimX - this.x);
    const da = wrapAngle(want_a - this.angle);
    this.angle += Math.max(-9 * dt, Math.min(9 * dt, da));

    if (input.fire && this.fireCd <= 0 && this.energy >= SHOT_COST) {
      const crit = this.rnd() < this.stats.critChance;
      const spread = (this.rnd() - 0.5) * 0.04;
      const a = this.angle + spread;
      this.bullets.push({
        x: this.x + Math.cos(a) * 14, y: this.y + Math.sin(a) * 14, vx: Math.cos(a) * 280 + this.vx * 0.3, vy: Math.sin(a) * 280 + this.vy * 0.3,
        dmg: this.stats.blasterDamage * 0.85 * (crit ? 2 : 1), life: 1.05, r: 2.5, fromPlayer: true, kind: 'pulse', crit,
      });
      this.energy -= SHOT_COST;
      this.fireCd = 1 / Math.min(10, this.stats.blasterRate);
      this.emit({ type: 'shoot' });
    }
  }

  fireMissile() {
    if (this.status !== 'running' || this.missiles <= 0) return;
    this.missiles--;
    const a = this.angle;
    this.bullets.push({
      x: this.x + Math.cos(a) * 12, y: this.y + Math.sin(a) * 12, vx: Math.cos(a) * 120 + this.vx, vy: Math.sin(a) * 120 + this.vy,
      dmg: 70, life: 4, r: 4, fromPlayer: true, kind: 'missile', homing: true, turn: 3.2, blast: 34,
    });
    this.emit({ type: 'missile' });
  }

  /** UI calls this each frame while R is held; `held=false` cancels. */
  setRecall(held: boolean, dt: number) {
    if (this.status !== 'running') return;
    if (!held) { this.recallHeld = 0; return; }
    this.recallHeld += dt;
    if (this.recallHeld >= 2) this.finish('retreat');
  }

  /** Flashcard "Academic Override": a pulse that hurts every hostile, clears their fire and restores the shield. */
  empBlast() {
    if (this.status === 'ended') return;
    this.overrideCd = OVERRIDE_COOLDOWN;
    this.emit({ type: 'emp' });
    this.shield = this.stats.maxShield;
    this.hull = Math.min(this.stats.maxHull, this.hull + 25);
    this.bullets = this.bullets.filter((b) => b.fromPlayer);
    for (const e of [...this.enemies]) if (dist(e.x, e.y, this.x, this.y) < 520) this.hurtEnemy(e, e.boss ? 60 : 55, false);
    this.spark(this.x, this.y, '#38bdf8', 40, 220, 2.2);
    this.floater(this.x, this.y - 22, 'ACADEMIC OVERRIDE', '#34d399');
  }

  // ------------------------------------------------------------ waves

  private updateWaves(dt: number) {
    // stray crew pods and drifting rock keep the field alive
    this.crewT -= dt;
    if (this.crewT <= 0) { this.crewT = 26 + this.rnd() * 14; this.pickups.push({ x: 120 + this.rnd() * (ARENA_W - 240), y: 120 + this.rnd() * (ARENA_H - 240), vx: (this.rnd() - 0.5) * 12, vy: (this.rnd() - 0.5) * 12, kind: 'crew', age: 0 }); }
    this.rockT -= dt;
    if (this.rockT <= 0) { this.rockT = 7; if (this.asteroids.length < 14) this.spawnAsteroid(this.rnd() < 0.6 ? 0 : 1, false); }

    if (!this.waveActive) {
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave();
      return;
    }
    // stagger spawns
    for (const s of [...this.spawnQueue]) {
      if (this.time >= s.at) { this.spawnShip(s.kind); this.spawnQueue.splice(this.spawnQueue.indexOf(s), 1); }
    }
    if (this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.waveActive = false;
      this.breakT = 4;
      const bonus = this.value(18 * this.wave);
      this.scrap += bonus;
      this.emit({ type: 'waveClear', wave: this.wave, bonus });
      this.floater(this.x, this.y - 30, `WAVE CLEARED +${bonus}`, '#facc15');
      // a care package between waves
      for (let i = 0; i < 2; i++) this.dropPickup(this.x + (this.rnd() - 0.5) * 160, this.y + (this.rnd() - 0.5) * 160, true);
    }
  }

  private startWave() {
    this.wave++;
    this.waveActive = true;
    const boss = this.wave % 5 === 0;
    this.emit({ type: 'wave', wave: this.wave, boss });
    let budget = 5 + this.wave * 3;
    const q: ShipKind[] = [];
    const kinds = (['heavy', 'gunship', 'fighter', 'scout'] as ShipKind[]).filter((k) => SHIPS[k].minWave <= this.wave);
    if (boss) budget = Math.round(budget * 0.45);
    let guard = 0;
    while (budget > 0 && guard++ < 60) {
      const affordable = kinds.filter((k) => SHIPS[k].cost <= budget);
      if (!affordable.length) break;
      // bias toward cheaper hulls so waves look like swarms with a few big ships
      const pick = affordable[affordable.length - 1 - Math.floor(Math.pow(this.rnd(), 1.7) * affordable.length)];
      q.push(pick); budget -= SHIPS[pick].cost;
    }
    q.forEach((kind, i) => this.spawnQueue.push({ kind, at: this.time + 0.4 + i * 0.35 }));
    if (boss) this.spawnBoss();
  }

  private edgePoint(): { x: number; y: number } {
    // outside the player's view, near the arena edge
    for (let i = 0; i < 20; i++) {
      const side = Math.floor(this.rnd() * 4);
      const x = side === 0 ? 40 : side === 1 ? ARENA_W - 40 : 40 + this.rnd() * (ARENA_W - 80);
      const y = side === 2 ? 40 : side === 3 ? ARENA_H - 40 : 40 + this.rnd() * (ARENA_H - 80);
      if (dist(x, y, this.x, this.y) > 380) return { x, y };
    }
    return { x: 40, y: 40 };
  }

  private spawnShip(kind: ShipKind) {
    const def = SHIPS[kind];
    const p = this.edgePoint();
    const scale = this.planet.enemyHpMult * (1 + this.wave * 0.06);
    const hp = Math.round(def.hp * scale);
    this.enemies.push({
      id: this.nextId++, kind, row: this.hostileRow, x: p.x, y: p.y, vx: 0, vy: 0, angle: Math.atan2(this.y - p.y, this.x - p.x),
      hp, maxHp: hp, r: def.r, t: 0.6 + this.rnd() * 1.2, t2: 3 + this.rnd() * 3, flash: 0, phase: this.rnd() * 6, dir: this.rnd() < 0.5 ? -1 : 1,
      boss: false, bossIndex: 0, atk: 'idle', atkT: 2, atkN: 0, patIdx: 0, tx: p.x, ty: p.y, name: def.name,
    });
  }

  private spawnBoss() {
    const idx = Math.floor(this.wave / 5) - 1;
    const hp = Math.round(this.planet.bossHp * 0.55 * (1 + 0.5 * idx));
    const p = this.edgePoint();
    const name = idx === 0 ? this.planet.bossName : `${this.planet.bossName} · Guardian ${idx}`;
    this.enemies.push({
      id: this.nextId++, kind: 'cruiser', row: 1, x: p.x, y: p.y, vx: 0, vy: 0, angle: 0, hp, maxHp: hp, r: 27,
      t: 2, t2: 0, flash: 0, phase: 0, dir: 1, boss: true, bossIndex: idx, atk: 'idle', atkT: 2.5, atkN: 0, patIdx: 0, tx: p.x, ty: p.y, name,
    });
    this.emit({ type: 'boss', name });
  }

  // ------------------------------------------------------------ enemies

  hurtEnemy(e: Enemy, dmg: number, crit: boolean) {
    if (e.hp <= 0) return;
    const def = SHIPS[e.kind];
    dmg *= 1 - def.armor;
    e.hp -= dmg;
    e.flash = 0.08;
    if (crit) this.floater(e.x, e.y - e.r - 6, `${Math.round(dmg)}!`, '#fde047');
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    this.kills++;
    this.enemies = this.enemies.filter((o) => o !== e);
    this.boom(e.x, e.y, e.boss ? 3.4 : e.r > 14 ? 1.8 : 1);
    this.spark(e.x, e.y, '#fbbf24', e.boss ? 40 : 12, e.boss ? 160 : 90);
    if (e.boss) {
      this.bossesDown++;
      const b = bossBonus(this.planet, e.bossIndex);
      this.scrap += b.scrap; this.cores += b.cores;
      this.floater(e.x, e.y - 30, `+${b.scrap} SCRAP  +${b.cores} CORES`, '#34d399');
      for (let i = 0; i < 6; i++) this.dropPickup(e.x + (this.rnd() - 0.5) * 80, e.y + (this.rnd() - 0.5) * 80, true);
      this.bullets = this.bullets.filter((b2) => b2.fromPlayer);
      this.beams = [];
      this.emit({ type: 'bossDown' });
      return;
    }
    const v = this.value(SHIPS[e.kind].scrap);
    this.scrap += v;
    this.floater(e.x, e.y - 12, `+${v}`, '#facc15');
    if (this.rnd() < (e.kind === 'heavy' ? 0.8 : 0.2)) this.dropPickup(e.x, e.y, false);
  }

  private dropPickup(x: number, y: number, rich: boolean) {
    const table: Array<[PickupKind, number]> = [['scrap', 30], ['fuel', 24], ['repair', 16], ['missile', 14], ['shield', 12], ['crew', rich ? 6 : 3], ['core', rich ? 5 : 1]];
    const total = table.reduce((n, [, w]) => n + w, 0);
    let r = this.rnd() * total, kind: PickupKind = 'scrap';
    for (const [k, w] of table) { r -= w; if (r <= 0) { kind = k; break; } }
    this.pickups.push({ x, y, vx: (this.rnd() - 0.5) * 40, vy: (this.rnd() - 0.5) * 40, kind, age: 0 });
  }

  private shoot(e: Enemy, a: number, speed: number, dmg: number, kind: Bullet['kind'] = e.row === 0 ? 'green' : 'orange') {
    const scale = Math.min(1.8, 1 + this.wave * 0.03);
    this.bullets.push({ x: e.x + Math.cos(a) * (e.r + 2), y: e.y + Math.sin(a) * (e.r + 2), vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg: dmg * scale, life: 3.2, r: kind === 'big' ? 4 : 2.6, fromPlayer: false, kind });
  }

  private updateEnemies(dt: number) {
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.phase += dt;
      const dx = this.x - e.x, dy = this.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const toShip = Math.atan2(dy, dx);
      const steer = (tx: number, ty: number, accel: number, max: number) => {
        const ax = tx - e.x, ay = ty - e.y, ad = Math.hypot(ax, ay) || 1;
        e.vx += (ax / ad) * accel * dt; e.vy += (ay / ad) * accel * dt;
        const s = Math.hypot(e.vx, e.vy); if (s > max) { e.vx *= max / s; e.vy *= max / s; }
      };
      switch (e.kind) {
        case 'scout': {
          steer(this.x + this.vx * 0.3, this.y + this.vy * 0.3, 190, 100);
          if (d < e.r + SHIP_R) { this.damageShip(12); this.boom(e.x, e.y, 1); this.enemies = this.enemies.filter((o) => o !== e); this.kills++; continue; }
          break;
        }
        case 'fighter': {
          const want = d > 180 ? 1 : d < 120 ? -1 : 0;
          const px = -dy / d, py = dx / d;
          steer(e.x + (dx / d) * want * 80 + px * e.dir * 70, e.y + (dy / d) * want * 80 + py * e.dir * 70, 150, 82);
          if (Math.sin(e.phase * 0.5 + e.id) > 0.97) e.dir = -e.dir;
          e.t -= dt;
          if (e.t <= 0 && d < 340) { e.t = 1.2; this.shoot(e, toShip + (this.rnd() - 0.5) * 0.12, 150, 7); }
          break;
        }
        case 'gunship': {
          const ang = Math.atan2(e.y - this.y, e.x - this.x) + e.dir * 0.5;
          steer(this.x + Math.cos(ang) * 190, this.y + Math.sin(ang) * 190, 120, 62);
          e.t -= dt;
          if (e.t <= 0 && d < 380) { e.t = 2.3; for (const s of [-0.26, 0, 0.26]) this.shoot(e, toShip + s, 140, 8); }
          break;
        }
        case 'heavy': {
          steer(this.x - (dx / d) * 200, this.y - (dy / d) * 200, 70, 40);
          e.t -= dt; e.t2 -= dt;
          if (e.t <= 0 && d < 400) { e.t = 1.7; for (const o of [-8, 8]) { const a = toShip; this.bullets.push({ x: e.x + Math.cos(a + Math.PI / 2) * o, y: e.y + Math.sin(a + Math.PI / 2) * o, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, dmg: 9, life: 3, r: 2.6, fromPlayer: false, kind: e.row === 0 ? 'green' : 'orange' }); } }
          if (e.t2 <= 0 && d < 420) { e.t2 = 5; this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(toShip) * 80, vy: Math.sin(toShip) * 80, dmg: 18, life: 5, r: 4, fromPlayer: false, kind: 'missile', homing: true, turn: 1.9, hp: 8 }); }
          break;
        }
        case 'cruiser': this.aiBoss(e, dt); break;
      }
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.x = Math.max(20, Math.min(ARENA_W - 20, e.x)); e.y = Math.max(20, Math.min(ARENA_H - 20, e.y));
      if (!(e.boss && e.atk === 'dash')) e.angle += wrapAngle(toShip - e.angle) * Math.min(1, dt * 5);
      // ramming
      if (e.kind !== 'scout' && d < e.r + SHIP_R) { this.damageShip((e.boss ? 20 : 8) * dt * 4); const k = 1 / d; this.vx -= dx * k * 40 * dt * 6; this.vy -= dy * k * 40 * dt * 6; }
    }
    // enemies push each other apart so swarms do not stack on one pixel
    for (let i = 0; i < this.enemies.length; i++) for (let j = i + 1; j < this.enemies.length; j++) {
      const a = this.enemies[i], b = this.enemies[j];
      const dd = dist(a.x, a.y, b.x, b.y), min = (a.r + b.r) * 0.8;
      if (dd < min && dd > 0.01) { const k = (min - dd) / dd * 0.5; a.x -= (b.x - a.x) * k; a.y -= (b.y - a.y) * k; b.x += (b.x - a.x) * k; b.y += (b.y - a.y) * k; }
    }
  }

  // ------------------------------------------------------------ boss

  private aiBoss(e: Enemy, dt: number) {
    const dx = this.x - e.x, dy = this.y - e.y;
    const patterns = this.planet.bossPatterns.map((p) => PATTERN_MAP[p]);
    const rage = e.hp / e.maxHp < 0.5 ? 0.7 : 1;
    e.atkT -= dt;
    // keep a respectful distance and slowly circle
    if (e.atk === 'idle' || e.atk === 'summon' || e.atk === 'ring') {
      const ang = Math.atan2(e.y - this.y, e.x - this.x) + 0.35;
      const tx = this.x + Math.cos(ang) * 300, ty = this.y + Math.sin(ang) * 300;
      e.vx += (tx - e.x) * 0.6 * dt; e.vy += (ty - e.y) * 0.6 * dt;
      const s = Math.hypot(e.vx, e.vy); if (s > 46) { e.vx *= 46 / s; e.vy *= 46 / s; }
    } else if (e.atk !== 'dash') { e.vx *= 1 - 3 * dt; e.vy *= 1 - 3 * dt; }

    if (e.atk === 'idle') {
      if (e.atkT <= 0) { e.atk = patterns[e.patIdx++ % patterns.length]; e.atkN = 0; e.t = 0; e.tx = this.x; e.ty = this.y; }
      return;
    }
    const end = (gap: number) => { e.atk = 'idle'; e.atkT = gap * rage; e.atkN = 0; this.beams = []; };
    switch (e.atk) {
      case 'ring': {
        const n = e.hp / e.maxHp < 0.5 ? 20 : 14;
        for (let i = 0; i < n; i++) { const a = e.phase + (i / n) * Math.PI * 2; this.shoot(e, a, 105, 9, 'big'); }
        end(1.8); break;
      }
      case 'aimed': {
        e.t -= dt;
        if (e.t <= 0 && e.atkN < 3) { for (const s of [-0.3, -0.15, 0, 0.15, 0.3]) this.shoot(e, Math.atan2(dy, dx) + s, 170, 9); e.atkN++; e.t = 0.45; }
        if (e.atkN >= 3 && e.t <= -0.4) end(1.6);
        break;
      }
      case 'dash': {
        e.t -= dt;
        if (e.atkN === 0) { e.atkN = 1; e.t = 0.9; e.tx = this.x; e.ty = this.y; }
        else if (e.atkN === 1) { e.tx = this.x; e.ty = this.y; e.angle = Math.atan2(e.ty - e.y, e.tx - e.x); if (e.t <= 0) { e.atkN = 2; e.t = 0.8; const a = Math.atan2(e.ty - e.y, e.tx - e.x); e.vx = Math.cos(a) * 300; e.vy = Math.sin(a) * 300; } }
        else if (e.atkN === 2) { if (e.t <= 0) { e.atkN = 3; e.t = 1; } }
        else { e.vx *= 1 - 3 * dt; e.vy *= 1 - 3 * dt; if (e.t <= 0) end(2); }
        break;
      }
      case 'summon': {
        for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; this.spawnShip('scout'); const s = this.enemies[this.enemies.length - 1]; s.x = e.x + Math.cos(a) * 40; s.y = e.y + Math.sin(a) * 40; }
        this.floater(e.x, e.y - 40, 'REINFORCEMENTS', '#fbbf24');
        end(2.4); break;
      }
      case 'sweep': {
        if (e.atkN === 0) { e.atkN = 1; e.t = 0.9; e.tx = Math.atan2(dy, dx) - 0.9; this.beams = [{ x: e.x, y: e.y, angle: e.tx, len: 700, live: false }]; }
        else if (e.atkN === 1) { e.t -= dt; this.beams[0] = { x: e.x, y: e.y, angle: e.tx, len: 700, live: false }; if (e.t <= 0) { e.atkN = 2; e.t = 2.2; } }
        else {
          e.t -= dt; e.tx += (1.9 / 2.2) * dt * 1.05;
          this.beams[0] = { x: e.x, y: e.y, angle: e.tx, len: 700, live: true };
          const b = this.beams[0]; const ex = b.x + Math.cos(b.angle) * b.len, ey = b.y + Math.sin(b.angle) * b.len;
          const t = Math.max(0, Math.min(1, ((this.x - b.x) * (ex - b.x) + (this.y - b.y) * (ey - b.y)) / (b.len * b.len)));
          if (dist(b.x + (ex - b.x) * t, b.y + (ey - b.y) * t, this.x, this.y) < 11) this.damageShip(32 * dt);
          if (e.t <= 0) end(2);
        }
        break;
      }
      case 'mines': {
        for (let i = 0; i < 5; i++) {
          const a = this.rnd() * Math.PI * 2, r = 60 + this.rnd() * 120;
          this.bullets.push({ x: this.x + Math.cos(a) * r, y: this.y + Math.sin(a) * r, vx: 0, vy: 0, dmg: 20, life: 12, r: 6, fromPlayer: false, kind: 'mine', arm: 1.1, hp: 10 });
        }
        end(2.2); break;
      }
      case 'spiral': {
        e.t -= dt;
        if (e.t <= 0 && e.atkN < 36) { const a = e.atkN * 0.4; this.shoot(e, a, 115, 8); e.atkN++; e.t = 0.07; }
        if (e.atkN >= 36) end(2);
        break;
      }
      default: end(1);
    }
  }

  // ------------------------------------------------------------ bullets

  private updateBullets(dt: number) {
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      b.life -= dt;
      if (b.kind === 'mine') {
        if ((b.arm ?? 0) > 0) b.arm! -= dt;
        else if (dist(b.x, b.y, this.x, this.y) < 24) { this.boom(b.x, b.y, 1.2); this.damageShip(b.dmg); continue; }
        // player shots detonate mines
        let popped = false;
        for (const p of this.bullets) if (p.fromPlayer && dist(p.x, p.y, b.x, b.y) < b.r + p.r) { p.life = 0; popped = true; }
        if (popped) { this.boom(b.x, b.y, 1); continue; }
        if (b.life > 0) keep.push(b);
        continue;
      }
      if (b.homing) {
        const target = b.fromPlayer ? this.nearestEnemy(b.x, b.y, 480) : { x: this.x, y: this.y };
        if (target) {
          const want = Math.atan2(target.y - b.y, target.x - b.x), cur = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy);
          const na = cur + Math.max(-(b.turn ?? 2) * dt, Math.min((b.turn ?? 2) * dt, wrapAngle(want - cur)));
          const nsp = Math.min(b.fromPlayer ? 200 : 105, sp + 90 * dt);
          b.vx = Math.cos(na) * nsp; b.vy = Math.sin(na) * nsp;
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -20 || b.y < -20 || b.x > ARENA_W + 20 || b.y > ARENA_H + 20) continue;
      let dead = b.life <= 0;
      if (b.fromPlayer) {
        for (const e of this.enemies) {
          if (e.hp > 0 && dist(e.x, e.y, b.x, b.y) < e.r + b.r) { dead = true; this.hit(b, e); break; }
        }
        if (!dead) for (const a of this.asteroids) {
          if (dist(a.x, a.y, b.x, b.y) < a.r + b.r) { dead = true; if (b.blast) this.explodeAt(b); else this.hitAsteroid(a, b.dmg); break; }
        }
        // enemy missiles can be shot down
        if (!dead) for (const o of this.bullets) {
          if (!o.fromPlayer && o.kind === 'missile' && dist(o.x, o.y, b.x, b.y) < 7) { o.life = 0; dead = true; if (b.blast) this.explodeAt(b); else this.boom(o.x, o.y, 0.8); break; }
        }
      } else if (dist(this.x, this.y, b.x, b.y) < SHIP_R + b.r) {
        this.damageShip(b.dmg);
        if (b.kind === 'missile') this.boom(b.x, b.y, 0.9);
        dead = true;
      }
      if (dead && b.blast && b.fromPlayer && b.life <= 0 && !this.blasts.some((x) => x.t === 0 && dist(x.x, x.y, b.x, b.y) < 1)) this.explodeAt(b);
      if (!dead && b.life > 0) keep.push(b);
    }
    this.bullets = keep;
  }

  private nearestEnemy(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null, bd = range;
    for (const e of this.enemies) { const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  private hit(b: Bullet, e: Enemy) {
    if (b.blast) { this.explodeAt(b); return; }
    this.emit({ type: 'hit' });
    this.spark(b.x, b.y, '#fbcfe8', 3, 50, 1.2);
    this.hurtEnemy(e, b.dmg, !!b.crit);
  }

  private explodeAt(b: Bullet) {
    const R = b.blast ?? 30;
    this.boom(b.x, b.y, 1.6);
    for (const e of [...this.enemies]) if (dist(e.x, e.y, b.x, b.y) < R + e.r) this.hurtEnemy(e, b.dmg, false);
    for (const a of [...this.asteroids]) if (dist(a.x, a.y, b.x, b.y) < R + a.r) this.hitAsteroid(a, b.dmg);
    b.life = 0;
  }

  // ------------------------------------------------------------ asteroids

  spawnAsteroid(size: number, anywhere: boolean) {
    const sizes = [{ r: 30, hp: 70 }, { r: 22, hp: 40 }, { r: 13, hp: 20 }, { r: 10, hp: 12 }];
    const s = sizes[size];
    let x = 0, y = 0;
    for (let i = 0; i < 30; i++) {
      x = 60 + this.rnd() * (ARENA_W - 120); y = 60 + this.rnd() * (ARENA_H - 120);
      if (anywhere ? dist(x, y, ARENA_W / 2, ARENA_H / 2) > 220 : dist(x, y, this.x, this.y) > 420) break;
    }
    const a = this.rnd() * Math.PI * 2, sp = 6 + this.rnd() * 14;
    this.asteroids.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: this.rnd() * 6.28, vr: (this.rnd() - 0.5) * 0.8, size, hp: s.hp, r: s.r, variant: Math.floor(this.rnd() * 2) });
  }

  private hitAsteroid(a: Asteroid, dmg: number) {
    a.hp -= dmg;
    this.spark(a.x, a.y, '#94a3b8', 4, 40, 1.4);
    if (a.hp > 0) return;
    this.asteroids = this.asteroids.filter((o) => o !== a);
    this.asteroidsDestroyed++;
    this.boom(a.x, a.y, a.size < 2 ? 1 : 0.8);
    if (a.size <= 1) {
      for (let i = 0; i < 2; i++) {
        const sizes = [{ r: 30, hp: 70 }, { r: 22, hp: 40 }, { r: 13, hp: 20 }, { r: 10, hp: 12 }];
        const ns = a.size + 2, s = sizes[ns], ang = this.rnd() * Math.PI * 2, sp = 18 + this.rnd() * 22;
        this.asteroids.push({ x: a.x + Math.cos(ang) * 8, y: a.y + Math.sin(ang) * 8, vx: a.vx + Math.cos(ang) * sp, vy: a.vy + Math.sin(ang) * sp, rot: this.rnd() * 6.28, vr: (this.rnd() - 0.5) * 1.6, size: ns, hp: s.hp, r: s.r, variant: 0 });
      }
    } else {
      const roll = this.rnd();
      this.pickups.push({ x: a.x, y: a.y, vx: a.vx * 0.5, vy: a.vy * 0.5, kind: roll < 0.1 ? 'core' : roll < 0.3 ? 'fuel' : 'scrap', age: 0 });
    }
  }

  private updateAsteroids(dt: number) {
    for (const a of this.asteroids) {
      a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.vr * dt;
      if (a.x < a.r) { a.x = a.r; a.vx = Math.abs(a.vx); } if (a.x > ARENA_W - a.r) { a.x = ARENA_W - a.r; a.vx = -Math.abs(a.vx); }
      if (a.y < a.r) { a.y = a.r; a.vy = Math.abs(a.vy); } if (a.y > ARENA_H - a.r) { a.y = ARENA_H - a.r; a.vy = -Math.abs(a.vy); }
      const d = dist(a.x, a.y, this.x, this.y);
      if (d < a.r + SHIP_R) {
        const sp = Math.hypot(this.vx - a.vx, this.vy - a.vy);
        const dmg = Math.min(30, 3 + sp * 0.12) * (a.size < 2 ? 1.2 : 0.8);
        if (this.hurtFlash <= 0.1) this.damageShip(dmg);
        const nx = (this.x - a.x) / (d || 1), ny = (this.y - a.y) / (d || 1);
        this.x = a.x + nx * (a.r + SHIP_R + 0.5); this.y = a.y + ny * (a.r + SHIP_R + 0.5);
        const dot = this.vx * nx + this.vy * ny;
        if (dot < 0) { this.vx -= 1.6 * dot * nx; this.vy -= 1.6 * dot * ny; }
        a.vx -= nx * 6; a.vy -= ny * 6;
        this.spark(this.x, this.y, '#cbd5e1', 6, 70);
      }
    }
  }

  // ------------------------------------------------------------ pickups

  private updatePickups(dt: number) {
    const keep: Pickup[] = [];
    for (const p of this.pickups) {
      p.age += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 0.5 * dt; p.vy *= 1 - 0.5 * dt;
      const d = dist(p.x, p.y, this.x, this.y);
      if (d < 70 && p.age > 0.3) { p.x += (this.x - p.x) * Math.min(1, dt * 5); p.y += (this.y - p.y) * Math.min(1, dt * 5); }
      if (d < 16 && p.age > 0.25) { this.takePickup(p); continue; }
      if (p.age < 60) keep.push(p);
    }
    this.pickups = keep;
  }

  private takePickup(p: Pickup) {
    this.emit({ type: 'pickup', kind: p.kind });
    const s = this.stats;
    const msg =
      p.kind === 'fuel' ? (this.fuel = Math.min(s.maxFuel, this.fuel + 45), '+FUEL')
      : p.kind === 'repair' ? (this.hull = Math.min(s.maxHull, this.hull + 30), '+HULL')
      : p.kind === 'missile' ? (this.missiles = Math.min(12, this.missiles + 2), '+2 MISSILES')
      : p.kind === 'shield' ? (this.shield = s.maxShield, 'SHIELD')
      : p.kind === 'core' ? (this.cores += 1, '+1 NEURO-CORE')
      : p.kind === 'crew' ? this.rescue()
      : (this.scrap += this.value(14), `+${this.value(14)}`);
    const color = p.kind === 'fuel' ? '#34d399' : p.kind === 'repair' ? '#f87171' : p.kind === 'missile' ? '#fb923c' : p.kind === 'shield' ? '#38bdf8' : p.kind === 'core' ? '#c4b5fd' : p.kind === 'crew' ? '#86efac' : '#facc15';
    this.floater(p.x, p.y - 8, msg, color);
  }

  private rescue(): string {
    this.crewRescued++;
    this.coreFrac += 1 / 3;
    if (this.coreFrac >= 0.999) { this.coreFrac = 0; this.cores += 1; }
    this.scrap += this.value(20);
    this.emit({ type: 'crew' });
    return this.coreFrac === 0 ? 'CREW RESCUED +1 CORE' : 'CREW RESCUED';
  }

  // ------------------------------------------------------------ fx

  private updateFx(dt: number) {
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const b of this.blasts) b.t += dt;
    this.blasts = this.blasts.filter((b) => b.t < 0.55);
    for (const f of this.floaters) { f.y -= 18 * dt; f.life -= dt; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    if (this.sparks.length > 300) this.sparks.splice(0, this.sparks.length - 300);
  }

  // ------------------------------------------------------------ end

  finish(outcome: SortieResult['outcome']) {
    if (this.status === 'ended') return;
    this.status = 'ended';
    const k = outcome === 'destroyed' ? KEEP_ON_DEATH : 1;
    this.result = {
      planetId: this.planet.id, outcome, scrap: Math.round(this.scrap * k), neuroCores: Math.floor(this.cores * k),
      wave: Math.max(0, this.wave - (this.waveActive ? 1 : 0)), kills: this.kills, bossesDown: this.bossesDown,
      crewRescued: this.crewRescued, asteroids: this.asteroidsDestroyed,
    };
    this.emit({ type: 'end', result: this.result });
  }
}
