/**
 * Core Drill simulation. Framework-free and DOM-free so it can be unit tested
 * headlessly: feed it `update(dt, input)` and read state / drain `events`.
 * All positions are in tile units (1 tile = TILE px when rendered).
 */
import {
  BOSS_BONUS, Cargo, cargoCount, cargoValue, DIG_TIME, emptyCargo, ENEMIES, EnemyKind,
  getPlanet, isOre, KEEP_ON_DEATH, PlanetDef, RECALL_FEE, SURFACE_ROW, T,
} from './balance';
import { generateWorld, idx, mulberry32, tileAt, World } from './terrain';
import type { RigStats, RunResult } from '../types';

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
  aimX: number; // tile coordinates
  aimY: number;
}

export const NO_INPUT: Input = { left: false, right: false, up: false, down: false, fire: false, aimX: 0, aimY: 0 };

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  contactDps: number;
  shootT: number;
  flash: number;
  phase: number; // animation / behaviour timer
  // boss-only state
  dashT: number;
  dashState: 'idle' | 'telegraph' | 'dash' | 'return';
  dashTx: number;
  dashTy: number;
  summoned: number;
}

export interface Bullet {
  x: number; y: number; vx: number; vy: number;
  dmg: number; life: number; fromPlayer: boolean; crit: boolean; color: string; r: number;
}
export interface Bomb { x: number; y: number; fuse: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
export interface Floater { x: number; y: number; text: string; color: string; life: number; big: boolean }

export type EngineEvent =
  | { type: 'shoot' } | { type: 'hit' } | { type: 'hurt' } | { type: 'dig' }
  | { type: 'ore'; tile: number } | { type: 'explode' } | { type: 'bomb' } | { type: 'enemyDie'; boss: boolean }
  | { type: 'dock'; scrap: number; cores: number } | { type: 'vault' } | { type: 'emp' }
  | { type: 'raid' } | { type: 'boss' } | { type: 'lowfuel' } | { type: 'cargoFull' }
  | { type: 'nest' } | { type: 'end'; result: RunResult };

export type EngineStatus = 'running' | 'vault' | 'ended';

const RIG_HX = 0.38;
const RIG_HY = 0.4;
const GRAVITY = 26;
const SHOT_COST = 5;
const OVERRIDE_COOLDOWN = 40;
const DRILL_DPS = 42;
// Fuel per second. A straight 70 m dive and climb costs about the base tank, so detours need upgrades or a recall.
const FUEL_DIG = 2.0;
const FUEL_THRUST = 5.0;
const FUEL_IDLE = 0.25;

export class DrillEngine {
  readonly planet: PlanetDef;
  readonly world: World;
  readonly stats: RigStats;
  readonly rnd: () => number;

  time = 0;
  status: EngineStatus = 'running';
  result: RunResult | null = null;

  // rig
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing = 1;
  grounded = false;
  fuel: number;
  hull: number;
  shield: number;
  energy: number;
  bombs: number;
  shieldDelay = 0;
  fireCd = 0;
  digTarget: { x: number; y: number } | null = null;
  digProgress = 0;
  digging = false;
  thrusting = false;
  hurtFlash = 0;
  recallHeld = 0;
  overrideCd = 0;

  // run tally
  cargo: Cargo = emptyCargo();
  bankedScrap = 0;
  bankedCores = 0;
  depth = 0;
  maxDepth = 0;
  kills = 0;
  vaultsOpened = 0;
  bossBeaten = false;
  bossSpawned = false;

  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  bombList: Bomb[] = [];
  particles: Particle[] = [];
  floaters: Floater[] = [];
  events: EngineEvent[] = [];

  private nextId = 1;
  private spawnT = 6;
  private raidT = 70;
  private raidPending = false;
  private raidsDone = 0;
  private lowFuelWarned = false;
  private vaultTile: { x: number; y: number } | null = null;

  constructor(planetId: number, stats: RigStats, seed: number = (Date.now() & 0xffff) + 1) {
    this.planet = getPlanet(planetId);
    this.stats = stats;
    this.rnd = mulberry32(seed + 17);
    this.world = generateWorld(this.planet, seed);
    this.x = (this.world.padX0 + this.world.padX1 + 1) / 2;
    this.y = SURFACE_ROW - RIG_HY;
    this.fuel = stats.maxFuel;
    this.hull = stats.maxHull;
    this.shield = stats.maxShield;
    this.energy = stats.maxEnergy;
    this.bombs = stats.bombs;
  }

  // ------------------------------------------------------------ helpers

  private emit(e: EngineEvent) { this.events.push(e); }

  drainEvents(): EngineEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private solidAt(x: number, y: number) { return tileAt(this.world, Math.floor(x), Math.floor(y)) !== T.AIR; }

  private boxHitsSolid(cx: number, cy: number, hx: number, hy: number): boolean {
    const x0 = Math.floor(cx - hx), x1 = Math.floor(cx + hx - 1e-6);
    const y0 = Math.floor(cy - hy), y1 = Math.floor(cy + hy - 1e-6);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tileAt(this.world, x, y) !== T.AIR) return true;
    return false;
  }

  hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  get onPad(): boolean {
    return this.grounded && Math.abs(this.y + RIG_HY - SURFACE_ROW) < 0.05 &&
      this.x >= this.world.padX0 && this.x <= this.world.padX1 + 1;
  }

  get inBossRoom(): boolean {
    return this.y > this.world.bossTop && this.x > this.world.bossLeft && this.x < this.world.bossRight + 1;
  }

  get boss(): Enemy | undefined { return this.enemies.find((e) => e.kind === 'boss'); }
  get overrideReady(): boolean { return this.overrideCd <= 0 && this.status === 'running'; }

  private floater(x: number, y: number, text: string, color: string, big = false) {
    this.floaters.push({ x, y, text, color, life: big ? 1.6 : 0.9, big });
  }

  private burst(x: number, y: number, color: string, n: number, speed = 3, size = 0.12) {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const s = speed * (0.3 + this.rnd());
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + this.rnd() * 0.4, max: 0.9, color, size: size * (0.6 + this.rnd()) });
    }
  }

  // ------------------------------------------------------------ rig damage

  damageRig(raw: number) {
    if (this.status === 'ended') return;
    const amt = raw * (1 - this.stats.damageReduction);
    this.shieldDelay = 4;
    this.hurtFlash = 0.25;
    let rest = amt;
    if (this.shield > 0) {
      const a = Math.min(this.shield, rest);
      this.shield -= a;
      rest -= a;
    }
    if (rest > 0) this.hull -= rest;
    if (raw >= 2) this.emit({ type: 'hurt' });
    if (this.hull <= 0) {
      this.hull = 0;
      this.finish('destroyed');
    }
  }

  // ------------------------------------------------------------ main update

  update(dt: number, input: Input) {
    if (this.status !== 'running') return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.overrideCd = Math.max(0, this.overrideCd - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);

    this.updateRig(dt, input);
    this.updateDig(dt, input);
    this.updateDock();
    this.updateWeapons(input);
    this.updateSpawns(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateBombs(dt);
    this.updateFx(dt);

    // sustain: shield regen and energy
    this.shieldDelay = Math.max(0, this.shieldDelay - dt);
    if (this.shieldDelay <= 0) this.shield = Math.min(this.stats.maxShield, this.shield + 8 * dt);
    this.energy = Math.min(this.stats.maxEnergy, this.energy + 14 * dt);

    if (this.fuel < this.stats.maxFuel * 0.2 && !this.lowFuelWarned) {
      this.lowFuelWarned = true;
      this.emit({ type: 'lowfuel' });
    }
    if (this.fuel > this.stats.maxFuel * 0.3) this.lowFuelWarned = false;
  }

  // ------------------------------------------------------------ rig movement

  private updateRig(dt: number, input: Input) {
    const hasFuel = this.fuel > 0;
    const speed = 5 * this.stats.moveSpeed * (hasFuel ? 1 : 0.5);
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) this.facing = dir;
    let target = dir * speed;
    // Digging straight down: ease onto the tile column so the rig fits the shaft it cuts.
    if (dir === 0 && input.down && this.grounded) {
      target = Math.max(-3, Math.min(3, (Math.floor(this.x) + 0.5 - this.x) * 10));
    }
    const accel = this.grounded ? 40 : 22;
    if (this.vx < target) this.vx = Math.min(target, this.vx + accel * dt);
    else if (this.vx > target) this.vx = Math.max(target, this.vx - accel * dt);

    this.thrusting = input.up && hasFuel;
    this.vy += GRAVITY * dt;
    if (this.thrusting) {
      this.vy -= 55 * dt;
      this.fuel -= FUEL_THRUST * dt;
    }
    this.vy = Math.max(-7.5, Math.min(16, this.vy));

    // x
    const nx = this.x + this.vx * dt;
    if (!this.boxHitsSolid(nx, this.y, RIG_HX, RIG_HY)) this.x = nx;
    else this.vx = 0;
    // y
    const wasVy = this.vy;
    const ny = this.y + this.vy * dt;
    this.grounded = false;
    if (!this.boxHitsSolid(this.x, ny, RIG_HX, RIG_HY)) {
      this.y = ny;
    } else {
      if (this.vy > 0) {
        this.y = Math.floor(ny + RIG_HY) - RIG_HY - 1e-4;
        this.grounded = true;
        if (wasVy > 11) {
          const dmg = (wasVy - 11) * 3.5;
          this.damageRig(dmg);
          this.floater(this.x, this.y - 0.8, `-${Math.round(dmg)}`, '#f87171');
          this.burst(this.x, this.y + 0.4, '#a1a1aa', 8, 2);
        }
      } else {
        this.y = Math.ceil(ny - RIG_HY) + RIG_HY + 1e-4;
      }
      this.vy = 0;
    }
    // Resting on something even when vy is already zero.
    if (!this.grounded && this.boxHitsSolid(this.x, this.y + 0.06, RIG_HX, RIG_HY) && this.vy >= 0) this.grounded = true;

    this.depth = Math.max(0, Math.round(this.y - SURFACE_ROW));
    this.maxDepth = Math.max(this.maxDepth, this.depth);
    if (this.thrusting || this.digging) { /* fuel drains elsewhere */ } else if (!this.onPad) this.fuel -= FUEL_IDLE * dt;
    this.fuel = Math.max(0, this.fuel);
  }

  // ------------------------------------------------------------ digging

  private findDigTile(input: Input): { x: number; y: number } | null {
    const cx = this.x, cy = this.y;
    if (input.down) {
      const t = { x: Math.floor(cx), y: Math.floor(cy + RIG_HY + 0.06) };
      if (tileAt(this.world, t.x, t.y) !== T.AIR && this.grounded) return t;
    }
    const side = input.left ? -1 : input.right ? 1 : 0;
    if (side !== 0) {
      const px = cx + side * (RIG_HX + 0.06);
      // check the row of the rig centre first, then the row of its feet
      for (const oy of [0, RIG_HY - 0.05]) {
        const t = { x: Math.floor(px), y: Math.floor(cy + oy) };
        if (tileAt(this.world, t.x, t.y) !== T.AIR) return t;
      }
    }
    return null;
  }

  private updateDig(dt: number, input: Input) {
    this.digging = false;
    if (this.fuel <= 0) { this.digTarget = null; this.digProgress = 0; return; }
    const t = this.findDigTile(input);
    if (!t) { this.digTarget = null; this.digProgress = 0; return; }
    const type = tileAt(this.world, t.x, t.y);
    const time = DIG_TIME[type];
    if (time === undefined || !isFinite(time)) { this.digTarget = null; this.digProgress = 0; return; }
    if (!this.digTarget || this.digTarget.x !== t.x || this.digTarget.y !== t.y) {
      this.digTarget = t;
      this.digProgress = 0;
    }
    this.digging = true;
    this.fuel = Math.max(0, this.fuel - FUEL_DIG * dt);
    this.digProgress += (dt * this.stats.drillSpeed) / time;
    if (this.rnd() < dt * 14) {
      this.burst(t.x + 0.5, t.y + 0.5, this.planet.dirt[0], 1, 2.2, 0.1);
      this.emit({ type: 'dig' });
    }
    // Drill melee on anything sitting in the cut.
    for (const e of this.enemies) {
      if (Math.hypot(e.x - (t.x + 0.5), e.y - (t.y + 0.5)) < 0.9 + e.radius * 0.5) this.hurtEnemy(e, DRILL_DPS * dt, false, false);
    }
    if (this.digProgress >= 1) {
      this.breakTile(t.x, t.y, true);
      this.digTarget = null;
      this.digProgress = 0;
    }
  }

  private collect(type: number, x: number, y: number) {
    if (cargoCount(this.cargo) >= this.stats.cargoCap) {
      this.floater(x, y - 0.4, 'CARGO FULL', '#fbbf24');
      this.emit({ type: 'cargoFull' });
      return;
    }
    if (type === T.SCRAP) this.cargo.scrapOre++;
    else if (type === T.CRYSTAL) this.cargo.crystal++;
    else if (type === T.CORE) this.cargo.core++;
    const label = type === T.SCRAP ? '+SCRAP' : type === T.CRYSTAL ? '+CRYSTAL' : '+QUANTUM CORE';
    const color = type === T.SCRAP ? '#facc15' : type === T.CRYSTAL ? '#e879f9' : '#34d399';
    this.floater(x, y - 0.4, label, color, type === T.CORE);
    this.emit({ type: 'ore', tile: type });
  }

  /** Remove a tile and apply what it contained. `byDrill` false = bomb blast (no vault / nest spawn). */
  breakTile(x: number, y: number, byDrill: boolean) {
    const type = tileAt(this.world, x, y);
    if (type === T.AIR || type === T.BEDROCK) return;
    const cx = x + 0.5, cy = y + 0.5;
    if (type === T.VAULT) {
      if (!byDrill) return;
      this.world.tiles[idx(this.world, x, y)] = T.AIR;
      this.vaultTile = { x, y };
      this.status = 'vault';
      this.emit({ type: 'vault' });
      return;
    }
    this.world.tiles[idx(this.world, x, y)] = T.AIR;
    if (isOre(type)) this.collect(type, cx, cy);
    else this.burst(cx, cy, this.planet.rock[0], 4, 2.4);
    if (type === T.HAZARD) {
      this.emit({ type: 'explode' });
      this.burst(cx, cy, this.planet.hazardColor, 18, 5, 0.16);
      if (Math.hypot(this.x - cx, this.y - cy) < 2.4) {
        this.damageRig(16);
        this.floater(this.x, this.y - 0.9, this.planet.hazardName.toUpperCase(), this.planet.hazardColor, true);
      }
      for (const e of this.enemies) if (Math.hypot(e.x - cx, e.y - cy) < 2.4) this.hurtEnemy(e, 30, false, false);
    }
    if (type === T.NEST) {
      this.emit({ type: 'nest' });
      this.cargo.bonusScrap += Math.round(25 * this.planet.scrapMult * this.stats.oreValueMult);
      this.floater(cx, cy - 0.5, 'NEST CRACKED', this.planet.enemyColor, true);
      if (byDrill) {
        const kind: EnemyKind = this.depth > 24 && this.rnd() < 0.5 ? 'spitter' : 'crawler';
        for (let i = 0; i < 3; i++) this.spawnEnemy(kind, cx + (this.rnd() - 0.5), cy + (this.rnd() - 0.5));
      }
    }
  }

  // ------------------------------------------------------------ docking

  private updateDock() {
    if (!this.onPad) return;
    const hadCargo = cargoCount(this.cargo) > 0 || this.cargo.bonusScrap > 0;
    if (hadCargo) {
      const v = cargoValue(this.cargo, this.planet, this.stats.oreValueMult);
      this.bankedScrap += v.scrap;
      this.bankedCores += v.cores;
      this.cargo = emptyCargo();
      this.emit({ type: 'dock', scrap: v.scrap, cores: v.cores });
      this.floater(this.x, this.y - 1.2, `SOLD +${v.scrap}${v.cores ? ` +${v.cores} CORE` : ''}`, '#34d399', true);
    }
    if (this.fuel < this.stats.maxFuel || this.hull < this.stats.maxHull) {
      this.fuel = this.stats.maxFuel;
      this.hull = this.stats.maxHull;
    }
    this.shield = this.stats.maxShield;
    this.bombs = this.stats.bombs;
  }

  // ------------------------------------------------------------ weapons

  private updateWeapons(input: Input) {
    if (input.fire && this.fireCd <= 0 && this.energy >= SHOT_COST) {
      const dx = input.aimX - this.x, dy = input.aimY - (this.y - 0.1);
      const d = Math.hypot(dx, dy) || 1;
      const crit = this.rnd() < this.stats.critChance;
      const dmg = this.stats.blasterDamage * (crit ? 2 : 1);
      this.bullets.push({
        x: this.x + (dx / d) * 0.5, y: this.y - 0.1 + (dy / d) * 0.5,
        vx: (dx / d) * 19, vy: (dy / d) * 19, dmg, life: 1.1, fromPlayer: true, crit,
        color: crit ? '#fde047' : '#67e8f9', r: crit ? 0.14 : 0.1,
      });
      this.facing = dx >= 0 ? 1 : -1;
      this.energy -= SHOT_COST;
      this.fireCd = 1 / this.stats.blasterRate;
      this.emit({ type: 'shoot' });
    }
  }

  /** UI calls this each frame while R is held; `held=false` cancels. */
  setRecall(held: boolean, dt: number) {
    if (this.status !== 'running') return;
    if (!held) { this.recallHeld = 0; return; }
    this.recallHeld += dt;
    if (this.recallHeld >= 2.5) this.finish('recalled');
  }

  placeBomb() {
    if (this.status !== 'running' || this.bombs <= 0) return;
    this.bombs--;
    this.bombList.push({ x: this.x, y: this.y, fuse: 1.0 });
    this.emit({ type: 'bomb' });
  }

  private updateBombs(dt: number) {
    for (const b of this.bombList) b.fuse -= dt;
    const live: Bomb[] = [];
    for (const b of this.bombList) {
      if (b.fuse > 0) { live.push(b); continue; }
      this.emit({ type: 'explode' });
      this.burst(b.x, b.y, '#fb923c', 26, 6, 0.18);
      const R = 3.2;
      const bx = Math.floor(b.x), by = Math.floor(b.y);
      for (let ty = by - 4; ty <= by + 4; ty++) {
        for (let tx = bx - 4; tx <= bx + 4; tx++) {
          if (Math.hypot(tx + 0.5 - b.x, ty + 0.5 - b.y) <= R) this.breakTile(tx, ty, false);
        }
      }
      for (const e of this.enemies) {
        if (Math.hypot(e.x - b.x, e.y - b.y) <= R + e.radius) this.hurtEnemy(e, 70, false, true);
      }
      if (Math.hypot(this.x - b.x, this.y - b.y) <= 2) this.damageRig(22);
    }
    this.bombList = live;
  }

  /** Flashcard "Academic Override": called by the UI after a correct answer. */
  empBlast() {
    if (this.status === 'ended') return;
    this.overrideCd = OVERRIDE_COOLDOWN;
    this.emit({ type: 'emp' });
    this.shield = this.stats.maxShield;
    this.hull = Math.min(this.stats.maxHull, this.hull + 25);
    this.bullets = this.bullets.filter((b) => b.fromPlayer);
    for (const e of [...this.enemies]) this.hurtEnemy(e, e.kind === 'boss' ? 60 : 55, false, true);
    this.burst(this.x, this.y, '#38bdf8', 40, 9, 0.2);
    this.floater(this.x, this.y - 1.2, 'ACADEMIC OVERRIDE', '#34d399', true);
  }

  /** Resolve a pending vault crate after the flashcard question. */
  resolveVault(success: boolean) {
    if (this.status !== 'vault' || !this.vaultTile) return;
    const { x, y } = this.vaultTile;
    this.vaultTile = null;
    this.status = 'running';
    if (success) {
      this.vaultsOpened++;
      this.bankedCores += 1;
      this.cargo.bonusScrap += Math.round(60 * this.planet.scrapMult * this.stats.oreValueMult);
      this.floater(x + 0.5, y, 'VAULT DECRYPTED  +1 CORE', '#34d399', true);
      this.burst(x + 0.5, y + 0.5, '#34d399', 24, 5, 0.16);
    } else {
      this.floater(x + 0.5, y, 'VAULT FRIED', '#f87171', true);
      this.burst(x + 0.5, y + 0.5, '#f87171', 12, 3);
    }
  }

  // ------------------------------------------------------------ enemies

  spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const def = ENEMIES[kind];
    const hp = kind === 'boss' ? this.planet.bossHp : Math.round(def.hp * this.planet.enemyHpMult);
    const e: Enemy = {
      id: this.nextId++, kind, x, y, vx: 0, vy: 0, hp, maxHp: hp, radius: def.radius, speed: def.speed * (this.planet.id === 2 ? 1.12 : 1),
      contactDps: def.contactDps, shootT: 1 + this.rnd() * 1.5, flash: 0, phase: this.rnd() * 6,
      dashT: 4, dashState: 'idle', dashTx: 0, dashTy: 0, summoned: 0,
    };
    this.enemies.push(e);
    return e;
  }

  private updateSpawns(dt: number) {
    // Ambient glitches wake up as you get deeper.
    this.spawnT -= dt;
    const ambientCap = Math.min(9, 3 + Math.floor(this.depth / 10));
    if (this.spawnT <= 0 && this.depth > 5 && !this.inBossRoom) {
      this.spawnT = Math.max(3, 9 - this.depth / 12) + this.rnd() * 3;
      if (this.enemies.filter((e) => e.kind !== 'raider').length < ambientCap) {
        for (let tries = 0; tries < 12; tries++) {
          const a = this.rnd() * Math.PI * 2;
          const d = 9 + this.rnd() * 4;
          const sx = this.x + Math.cos(a) * d, sy = this.y + Math.sin(a) * d;
          if (sx < 2 || sx > this.world.w - 3 || sy < SURFACE_ROW + 3 || sy > this.world.bossTop - 2) continue;
          const spitterDepth = this.planet.id === 2 ? 14 : 28;
          const kind: EnemyKind = this.depth > spitterDepth && this.rnd() < 0.4 ? 'spitter' : 'crawler';
          this.spawnEnemy(kind, sx, sy);
          break;
        }
      }
    }

    // Raiders drop in from orbit while you work near the surface.
    this.raidT -= dt;
    if (this.raidT <= 0 && !this.raidPending) this.raidPending = true;
    if (this.raidPending && this.depth < 10 && !this.inBossRoom) {
      this.raidPending = false;
      this.raidT = 85 + this.rnd() * 30;
      this.raidsDone++;
      const n = Math.min(5, 2 + this.raidsDone);
      this.emit({ type: 'raid' });
      for (let i = 0; i < n; i++) {
        this.spawnEnemy('raider', i % 2 === 0 ? 1.5 : this.world.w - 2.5, SURFACE_ROW - 6 - this.rnd() * 3);
      }
    }

    // Boss wakes when the rig drops into its cavern.
    if (!this.bossSpawned && this.inBossRoom) {
      this.bossSpawned = true;
      const cx = (this.world.bossLeft + this.world.bossRight) / 2 + 0.5;
      const b = this.spawnEnemy('boss', cx, this.world.bossTop + 4);
      b.phase = 0;
      this.emit({ type: 'boss' });
      this.floater(cx, this.world.bossTop + 2, this.planet.bossName.toUpperCase(), this.planet.primary, true);
    }
  }

  hurtEnemy(e: Enemy, dmg: number, crit: boolean, showNumber: boolean) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 0.1;
    if (showNumber) this.floater(e.x, e.y - e.radius - 0.2, `${Math.round(dmg)}`, crit ? '#fde047' : '#e2e8f0', crit);
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    this.kills++;
    this.enemies = this.enemies.filter((o) => o !== e);
    this.burst(e.x, e.y, this.planet.enemyColor, e.kind === 'boss' ? 60 : 14, e.kind === 'boss' ? 8 : 4, e.kind === 'boss' ? 0.25 : 0.14);
    this.emit({ type: 'enemyDie', boss: e.kind === 'boss' });
    const drop = Math.round(ENEMIES[e.kind].scrapDrop * this.planet.scrapMult * this.stats.oreValueMult);
    if (drop > 0) {
      this.cargo.bonusScrap += drop;
      this.floater(e.x, e.y - 0.5, `+${drop}`, '#facc15');
    }
    if (e.kind === 'boss') {
      this.bossBeaten = true;
      const bonus = BOSS_BONUS(this.planet);
      this.bankedScrap += bonus.scrap;
      this.bankedCores += bonus.cores;
      this.finish('cleared');
    }
  }

  private fireEnemyBullet(e: Enemy, tx: number, ty: number, speed: number, dmg: number, color: string, spread = 0) {
    const a = Math.atan2(ty - e.y, tx - e.x) + spread;
    this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, life: 3, fromPlayer: false, crit: false, color, r: 0.14 });
  }

  private updateEnemies(dt: number) {
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.phase += dt;
      const dx = this.x - e.x, dy = this.y - e.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const nx = dx / dist, ny = dy / dist;

      if (e.kind === 'crawler') {
        const inRock = this.solidAt(e.x, e.y);
        const sp = e.speed * (inRock ? 0.6 : 1);
        e.vx = nx * sp; e.vy = ny * sp;
        this.moveEnemy(e, dt);
      } else if (e.kind === 'spitter') {
        let mv = 0;
        if (dist > 6.5) mv = 1; else if (dist < 4.2) mv = -1;
        const inRock = this.solidAt(e.x, e.y);
        const sp = e.speed * (inRock ? 0.65 : 1);
        const px = -ny, py = nx; // strafe
        e.vx = (nx * mv + px * 0.35 * Math.sin(e.phase)) * sp;
        e.vy = (ny * mv + py * 0.35 * Math.sin(e.phase)) * sp;
        this.moveEnemy(e, dt);
        e.shootT -= dt;
        if (e.shootT <= 0 && dist < 9.5 && this.hasLineOfSight(e.x, e.y, this.x, this.y)) {
          e.shootT = 2.2;
          this.fireEnemyBullet(e, this.x, this.y, 7, 9, this.planet.hazardColor);
        }
      } else if (e.kind === 'raider') {
        const hx = this.x + Math.sin(e.phase * 0.7 + e.id) * 5, hy = Math.min(this.y - 3.2, SURFACE_ROW - 2.5);
        const tx = hx - e.x, ty = hy - e.y, td = Math.hypot(tx, ty) || 1;
        e.vx = (tx / td) * e.speed * Math.min(1, td / 2); e.vy = (ty / td) * e.speed * Math.min(1, td / 2);
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.shootT -= dt;
        if (e.shootT <= 0 && dist < 11 && this.hasLineOfSight(e.x, e.y, this.x, this.y)) {
          e.shootT = 1.5;
          this.fireEnemyBullet(e, this.x, this.y, 9, 7, '#f87171');
        }
      } else {
        this.updateBoss(e, dt);
      }

      // contact damage
      if (e.hp > 0 && dist < e.radius + RIG_HX) {
        this.damageRig(e.contactDps * dt);
        if (e.kind !== 'boss') this.hurtEnemy(e, 8 * dt, false, false);
      }
    }
  }

  private moveEnemy(e: Enemy, dt: number) {
    const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt;
    // Glitches phase through dirt and rock but not bedrock.
    if (tileAt(this.world, Math.floor(nx), Math.floor(e.y)) !== T.BEDROCK) e.x = nx;
    if (tileAt(this.world, Math.floor(e.x), Math.floor(ny)) !== T.BEDROCK) e.y = ny;
  }

  private updateBoss(e: Enemy, dt: number) {
    const w = this.world;
    const minX = w.bossLeft + 2.5, maxX = w.bossRight - 1.5, hoverY = w.bossTop + 4;
    const hpFrac = e.hp / e.maxHp;
    e.shootT -= dt;
    const burstGap = hpFrac < 0.5 ? 1.7 : 2.4;
    if (e.shootT <= 0) {
      e.shootT = burstGap;
      const n = hpFrac < 0.5 ? 12 : 8;
      for (let i = 0; i < n; i++) {
        const a = e.phase * 0.5 + (i / n) * Math.PI * 2;
        this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 5.5, vy: Math.sin(a) * 5.5, dmg: 10, life: 4, fromPlayer: false, crit: false, color: this.planet.enemyColor, r: 0.15 });
      }
      if (this.planet.id === 2) {
        for (const s of [-0.25, 0, 0.25]) this.fireEnemyBullet(e, this.x, this.y, 8, 12, '#fb923c', s);
      }
    }
    // summons at 66% and 33%
    const stage = hpFrac < 0.33 ? 2 : hpFrac < 0.66 ? 1 : 0;
    if (stage > e.summoned) {
      e.summoned = stage;
      for (let i = 0; i < 2; i++) this.spawnEnemy('crawler', e.x + (i ? 2 : -2), e.y + 1);
      this.floater(e.x, e.y - 2, 'REINFORCEMENTS', '#fbbf24', true);
    }

    e.dashT -= dt;
    if (e.dashState === 'idle') {
      e.x += Math.sign(((minX + maxX) / 2 + Math.sin(e.phase * 0.6) * (maxX - minX) * 0.45) - e.x) * Math.min(2.4 * dt, 1);
      e.y += (hoverY - e.y) * Math.min(1, dt * 2);
      if (e.dashT <= 0) { e.dashState = 'telegraph'; e.dashT = 0.9; e.dashTx = this.x; e.dashTy = this.y; }
    } else if (e.dashState === 'telegraph') {
      e.dashTx = this.x; e.dashTy = this.y;
      if (e.dashT <= 0) { e.dashState = 'dash'; e.dashT = 0.7; }
    } else if (e.dashState === 'dash') {
      const tx = e.dashTx - e.x, ty = e.dashTy - e.y, td = Math.hypot(tx, ty) || 1;
      e.x += (tx / td) * 11 * dt; e.y += (ty / td) * 11 * dt;
      if (e.dashT <= 0 || td < 0.5) { e.dashState = 'return'; e.dashT = 1.2; }
    } else {
      e.y += (hoverY - e.y) * Math.min(1, dt * 2.5);
      e.x += Math.sign(((minX + maxX) / 2) - e.x) * Math.min(2 * dt, 1);
      if (e.dashT <= 0) { e.dashState = 'idle'; e.dashT = hpFrac < 0.5 ? 4 : 6; }
    }
    e.x = Math.max(minX, Math.min(maxX, e.x));
    e.y = Math.max(w.bossTop + 1.5, Math.min(w.h - 3, e.y));
  }

  // ------------------------------------------------------------ bullets & fx

  private updateBullets(dt: number) {
    const live: Bullet[] = [];
    for (const b of this.bullets) {
      b.life -= dt;
      const steps = 2;
      let dead = b.life <= 0;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        if (this.solidAt(b.x, b.y)) {
          dead = true;
          this.burst(b.x, b.y, b.color, 3, 1.5, 0.08);
        } else if (b.fromPlayer) {
          for (const e of this.enemies) {
            if (e.hp > 0 && Math.hypot(e.x - b.x, e.y - b.y) < e.radius + b.r) {
              this.hurtEnemy(e, b.dmg, b.crit, true);
              this.emit({ type: 'hit' });
              dead = true;
              break;
            }
          }
        } else if (Math.hypot(this.x - b.x, this.y - b.y) < RIG_HX + b.r) {
          this.damageRig(b.dmg);
          dead = true;
        }
      }
      if (!dead) live.push(b);
    }
    this.bullets = live;
  }

  private updateFx(dt: number) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 6 * dt; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) { f.y -= 0.9 * dt; f.life -= dt; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }

  // ------------------------------------------------------------ end of run

  finish(outcome: RunResult['outcome']) {
    if (this.status === 'ended') return;
    const v = cargoValue(this.cargo, this.planet, this.stats.oreValueMult);
    let scrap = this.bankedScrap;
    let cores = this.bankedCores;
    if (outcome === 'destroyed') {
      scrap += Math.round(v.scrap * KEEP_ON_DEATH);
      cores += Math.floor(v.cores * KEEP_ON_DEATH);
    } else if (outcome === 'recalled' && !this.onPad && this.y - SURFACE_ROW > 3) {
      scrap += Math.round(v.scrap * (1 - RECALL_FEE));
      cores += v.cores;
    } else {
      scrap += v.scrap;
      cores += v.cores;
    }
    this.status = 'ended';
    this.result = {
      planetId: this.planet.id, outcome, scrap, neuroCores: cores, depth: this.maxDepth,
      kills: this.kills, bossBeaten: this.bossBeaten, vaultsOpened: this.vaultsOpened,
    };
    this.emit({ type: 'end', result: this.result });
  }
}
