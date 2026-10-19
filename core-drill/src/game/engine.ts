/**
 * Core Drill simulation. Framework-free and DOM-free so it can be unit tested
 * headlessly: feed it `update(dt, input)` and read state / drain `events`.
 * All positions are in tile units (1 tile = TILE px when rendered).
 *
 * The run is endless: the world grows as you descend, bosses return every few levels, and
 * after a planet's core boss you may warp on to the next planet or stay and keep drilling.
 */
import {
  bossBonus, Cargo, cargoCount, cargoValue, depthScale, DIG_TIME, emptyCargo, ENEMIES, EnemyKind,
  getPlanet, isBreakable, isOre, KEEP_ON_DEATH, lightRadius, MERCHANT_OFFERS, nextPlanet, PickupKind,
  PlanetDef, RECALL_FEE, SURFACE_ROW, T,
} from './balance';
import { FLOW_INF, FlowField } from './flow';
import { BossSite, createWorld, ensureRows, idx, mulberry32, Room, tileAt, World } from './terrain';
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

export interface Seg { x: number; y: number }

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
  phase: number; // animation / behaviour clock
  angle: number; // facing / heading (radians)
  state: string; // behavioural state
  stateT: number;
  alpha: number; // 1 = solid, <0.5 = intangible (phantoms)
  home: Seg | null; // sentries stay put
  segs: Seg[]; // worm body, head first
  slows: boolean; // contact slows the rig (frost)
  dmgMult: number;
  name: string;
  // boss-only state
  site: BossSite | null;
  bossIndex: number;
  atk: string;
  atkT: number;
  atkN: number;
  patIdx: number;
  tx: number;
  ty: number;
}

export interface Bullet {
  x: number; y: number; vx: number; vy: number;
  dmg: number; life: number; fromPlayer: boolean; crit: boolean; color: string; r: number;
  mine?: boolean; arm?: number; slow?: boolean; turret?: boolean;
}
export interface Bomb { x: number; y: number; fuse: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
export interface Floater { x: number; y: number; text: string; color: string; life: number; big: boolean }
export interface Pickup { x: number; y: number; vy: number; kind: PickupKind; age: number }
export interface Boulder { x: number; y: number; vy: number; tele: number; landed: boolean }
export interface Beam { x: number; y: number; angle: number; len: number; width: number; live: boolean }

export type EngineEvent =
  | { type: 'shoot' } | { type: 'hit' } | { type: 'hurt' } | { type: 'dig' }
  | { type: 'ore'; tile: number } | { type: 'explode' } | { type: 'bomb' } | { type: 'enemyDie'; boss: boolean }
  | { type: 'dock'; scrap: number; cores: number } | { type: 'relay'; refueled: boolean }
  | { type: 'vault' } | { type: 'emp' } | { type: 'raid' } | { type: 'boss'; name: string }
  | { type: 'lowfuel' } | { type: 'cargoFull' } | { type: 'nest' } | { type: 'pickup'; kind: PickupKind }
  | { type: 'tremor' } | { type: 'surge'; on: boolean } | { type: 'ambush'; what: string }
  | { type: 'merchant' } | { type: 'rumble' } | { type: 'warp'; planetId: number }
  | { type: 'planetCleared'; planetId: number; canWarp: boolean }
  | { type: 'bossDown'; index: number } | { type: 'turret' }
  | { type: 'end'; result: RunResult };

export type EngineStatus = 'running' | 'vault' | 'choice' | 'merchant' | 'ended';

const RIG_HX = 0.38;
const RIG_HY = 0.4;
const GRAVITY = 26;
const SHOT_COST = 5;
const OVERRIDE_COOLDOWN = 40;
const DRILL_DPS = 42;
// Fuel per second. A straight dive costs real fuel; plates and detours cost more.
const FUEL_DIG = 2.0;
const FUEL_THRUST = 5.0;
const FUEL_IDLE = 0.25;

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export class DrillEngine {
  planet: PlanetDef;
  world: World;
  readonly stats: RigStats;
  readonly rnd: () => number;
  readonly startPlanetId: number;
  private seed: number;

  time = 0;
  status: EngineStatus = 'running';
  result: RunResult | null = null;
  shake = 0;

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
  slowT = 0;
  burnT = 0;

  // run tally
  cargo: Cargo = emptyCargo();
  bankedScrap = 0;
  bankedCores = 0;
  depth = 0;
  maxDepth = 0;
  depthByPlanet: Record<number, number> = {};
  kills = 0;
  vaultsOpened = 0;
  bossesDown = 0;
  clears: number[] = [];

  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  bombList: Bomb[] = [];
  particles: Particle[] = [];
  floaters: Floater[] = [];
  items: Pickup[] = [];
  boulders: Boulder[] = [];
  beams: Beam[] = [];
  events: EngineEvent[] = [];
  explored: Uint8Array;
  warnings: Array<{ x: number; y: number; t: number }> = []; // ceiling markers for falling shards

  readonly flow = new FlowField();
  private flowT = 0;
  private nextId = 1;
  private spawnT = 6;
  private raidT = 70;
  private raidPending = false;
  private raidsDone = 0;
  private tremorT = 55 + Math.random() * 30;
  private surgeT = 110 + Math.random() * 60;
  surgeLeft = 0;
  private lowFuelWarned = false;
  private vaultTile: { x: number; y: number } | null = null;
  private exploreT = 0;
  private turretCd = 0;
  turretAngle = -Math.PI / 2;
  nearMerchant = false;
  nearRelay = false;

  constructor(planetId: number, stats: RigStats, seed: number = (Date.now() & 0xffff) + 1) {
    this.planet = getPlanet(planetId);
    this.startPlanetId = this.planet.id;
    this.stats = stats;
    this.seed = seed;
    this.rnd = mulberry32(seed + 17);
    this.world = createWorld(this.planet, seed);
    this.explored = new Uint8Array(this.world.w * this.world.h);
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

  /** The boss cavern the rig is standing in, if any. */
  get currentSite(): BossSite | null {
    for (const s of this.world.bossSites) {
      if (this.y > s.top && this.y < s.bottom + 1 && this.x > s.left && this.x < s.right + 1) return s;
    }
    return null;
  }
  get inBossRoom(): boolean { return this.currentSite !== null; }
  get boss(): Enemy | undefined { return this.enemies.find((e) => e.kind === 'boss'); }
  get overrideReady(): boolean { return this.overrideCd <= 0 && this.status === 'running'; }
  /** Headlamp radius (tiles) at the current depth, after power-surge dimming. */
  get lightR(): number {
    const r = lightRadius(this.depth, this.stats.lightBonus);
    return this.surgeLeft > 0 ? r * 0.55 : r;
  }
  get dangerScale(): number { return depthScale(this.depth); }

  private floater(x: number, y: number, text: string, color: string, big = false) {
    this.floaters.push({ x, y, text, color, life: big ? 1.7 : 0.9, big });
  }

  private burst(x: number, y: number, color: string, n: number, speed = 3, size = 0.12) {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const s = speed * (0.3 + this.rnd());
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + this.rnd() * 0.4, max: 0.9, color, size: size * (0.6 + this.rnd()) });
    }
  }

  private addShake(v: number) { this.shake = Math.min(1, Math.max(this.shake, v)); }

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
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.slowT = Math.max(0, this.slowT - dt);
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.damageRig(4 * dt);
      if (this.status !== 'running') return;
    }

    this.growWorld();
    this.updateRig(dt, input);
    this.updateDig(dt, input);
    this.updateDock();
    this.updateStations();
    this.updateWeapons(input);
    this.updateTurret(dt);
    this.updateSpawns(dt);
    this.updateEvents(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateBoulders(dt);
    this.updateItems(dt);
    this.updateBombs(dt);
    this.updateFx(dt);
    this.updateExplored(dt);

    this.shieldDelay = Math.max(0, this.shieldDelay - dt);
    if (this.shieldDelay <= 0) this.shield = Math.min(this.stats.maxShield, this.shield + 8 * dt);
    this.energy = Math.min(this.stats.maxEnergy, this.energy + 14 * dt);

    if (this.fuel < this.stats.maxFuel * 0.2 && !this.lowFuelWarned) {
      this.lowFuelWarned = true;
      this.emit({ type: 'lowfuel' });
    }
    if (this.fuel > this.stats.maxFuel * 0.3) this.lowFuelWarned = false;
  }

  private growWorld() {
    const before = this.world.h;
    ensureRows(this.world, Math.floor(this.y) + 24);
    if (this.world.h !== before) {
      const e = new Uint8Array(this.world.w * this.world.h);
      e.set(this.explored);
      this.explored = e;
    }
  }

  // ------------------------------------------------------------ rig movement

  private updateRig(dt: number, input: Input) {
    const hasFuel = this.fuel > 0;
    const speed = 5 * this.stats.moveSpeed * (hasFuel ? 1 : 0.5) * (this.slowT > 0 ? 0.55 : 1);
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

    const nx = this.x + this.vx * dt;
    if (!this.boxHitsSolid(nx, this.y, RIG_HX, RIG_HY)) this.x = nx;
    else this.vx = 0;
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
    if (!this.grounded && this.boxHitsSolid(this.x, this.y + 0.06, RIG_HX, RIG_HY) && this.vy >= 0) this.grounded = true;

    this.depth = Math.max(0, Math.round(this.y - SURFACE_ROW));
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
    if (this.depth > (this.depthByPlanet[this.planet.id] ?? 0)) this.depthByPlanet[this.planet.id] = this.depth;
    if (!this.thrusting && !this.digging && !this.onPad) this.fuel -= FUEL_IDLE * dt;
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
      this.burst(t.x + 0.5, t.y + 0.5, type === T.PLATE ? '#cbd5e1' : this.planet.dirt[0], 1, type === T.PLATE ? 3.2 : 2.2, 0.1);
      this.emit({ type: 'dig' });
    }
    for (const e of this.enemies) {
      if (e.hp > 0 && this.hitCircles(e).some((c) => dist(c.x, c.y, t.x + 0.5, t.y + 0.5) < 0.9 + c.r * 0.5)) this.hurtEnemy(e, DRILL_DPS * dt, false, false);
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

  /** Remove a tile and apply what it contained. `byDrill` false = bomb blast / worm / bullet. */
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
    if (type === T.CHEST) {
      if (!byDrill) return;
      this.world.tiles[idx(this.world, x, y)] = T.AIR;
      this.openChest(x, y);
      return;
    }
    this.world.tiles[idx(this.world, x, y)] = T.AIR;
    if (isOre(type)) this.collect(type, cx, cy);
    else this.burst(cx, cy, type === T.PLATE ? '#94a3b8' : this.planet.rock[0], type === T.PLATE ? 10 : 4, 2.4);
    if (type === T.CRATE) {
      this.dropLoot(cx, cy, 1 + Math.floor(this.rnd() * 2));
      this.floater(cx, cy - 0.4, 'CRATE', '#fbbf24');
    }
    if (type === T.MIMIC) {
      this.floater(cx, cy - 0.5, "IT'S A TRAP!", '#f87171', true);
      this.emit({ type: 'ambush', what: 'mimic' });
      this.addShake(0.5);
      for (let i = 0; i < 4; i++) this.spawnEnemy(this.rosterKind(false) ?? 'mite', cx + (this.rnd() - 0.5) * 1.4, cy - 0.2 - this.rnd() * 0.4);
    }
    if (type === T.HAZARD) this.hazardBurst(cx, cy);
    if (type === T.NEST) {
      this.emit({ type: 'nest' });
      this.cargo.bonusScrap += Math.round(25 * this.planet.scrapMult * this.stats.oreValueMult);
      this.floater(cx, cy - 0.5, 'NEST CRACKED', this.planet.enemyColor, true);
      if (byDrill) for (let i = 0; i < 3; i++) this.spawnEnemy(this.rosterKind(false) ?? 'mite', cx + (this.rnd() - 0.5), cy + (this.rnd() - 0.5));
    }
  }

  private hazardBurst(cx: number, cy: number) {
    this.emit({ type: 'explode' });
    this.burst(cx, cy, this.planet.hazardColor, 18, 5, 0.16);
    this.addShake(0.35);
    for (const e of this.enemies) if (dist(e.x, e.y, cx, cy) < 2.4) this.hurtEnemy(e, 30, false, false);
    if (dist(this.x, this.y, cx, cy) >= 2.4) return;
    const fx = this.planet.hazardFx;
    this.floater(this.x, this.y - 0.9, this.planet.hazardName.toUpperCase(), this.planet.hazardColor, true);
    if (fx === 'static') this.damageRig(16);
    else if (fx === 'magma') { this.damageRig(14); this.burnT = 3; }
    else if (fx === 'spore') { this.damageRig(10); for (let i = 0; i < 2; i++) this.spawnEnemy('phantom', cx + (this.rnd() - 0.5) * 2, cy); }
    else if (fx === 'vent') { this.damageRig(10); this.slowT = 4; }
    else if (fx === 'rift') { this.damageRig(8); this.riftTeleport(); }
  }

  private riftTeleport() {
    // prefer an existing open spot at least 5 tiles away; otherwise the rift tears a small chamber open
    const spots: Seg[] = [];
    for (let i = 0; i < 80; i++) {
      const nx = this.x + (this.rnd() - 0.5) * 24;
      const ny = this.y + (this.rnd() - 0.5) * 14;
      if (nx < 2 || nx > this.world.w - 2 || ny < SURFACE_ROW + 1) continue;
      if (dist(nx, ny, this.x, this.y) < 5 || this.boxHitsSolid(nx, ny, RIG_HX + 0.1, RIG_HY + 0.1)) continue;
      spots.push({ x: nx, y: ny });
    }
    let dest = spots.length ? spots[0] : null;
    if (!dest) {
      const cx = Math.max(3, Math.min(this.world.w - 4, Math.floor(this.x + (this.rnd() < 0.5 ? -7 : 7))));
      const cy = Math.max(SURFACE_ROW + 3, Math.floor(this.y) + (this.rnd() < 0.5 ? 3 : -3));
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (isBreakable(tileAt(this.world, x, y))) this.world.tiles[idx(this.world, x, y)] = T.AIR;
      dest = { x: cx + 0.5, y: cy + 0.5 };
    }
    this.burst(this.x, this.y, '#fda4af', 20, 5, 0.16);
    this.x = dest.x; this.y = dest.y; this.vx = 0; this.vy = 0;
    this.burst(this.x, this.y, '#fda4af', 20, 5, 0.16);
    this.floater(this.x, this.y - 1, 'RIFT JUMP', '#fda4af', true);
  }

  private openChest(x: number, y: number) {
    const cx = x + 0.5, cy = y + 0.5;
    this.floater(cx, cy - 0.6, 'TREASURE!', '#fde047', true);
    this.burst(cx, cy, '#fde047', 26, 5, 0.16);
    this.dropLoot(cx, cy, 4);
    this.cargo.bonusScrap += Math.round(80 * this.planet.scrapMult * this.stats.oreValueMult);
    this.bankedCores += 1;
    const room = this.world.rooms.find((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1);
    if (room && room.ambush && !room.triggered) this.triggerAmbush(room, cx, cy);
  }

  private triggerAmbush(room: Room, cx: number, cy: number) {
    room.triggered = true;
    this.emit({ type: 'ambush', what: 'treasure' });
    this.addShake(0.6);
    this.floater(cx, cy - 1.2, 'AMBUSH!', '#f87171', true);
    this.spawnEnemy('brute', room.x0 + 0.8, room.y1 - 0.6);
    for (let i = 0; i < 3; i++) this.spawnEnemy(this.rosterKind(false) ?? 'mite', room.x0 + 1 + this.rnd() * 4, room.y0 + 0.6);
  }

  // ------------------------------------------------------------ pickups

  private dropLoot(x: number, y: number, count: number) {
    const table: Array<[PickupKind, number]> = [['scrap', 40], ['fuel', 22], ['repair', 14], ['bomb', 10], ['shield', 8], ['core', 6]];
    const total = table.reduce((n, [, w]) => n + w, 0);
    for (let i = 0; i < count; i++) {
      let r = this.rnd() * total;
      let kind: PickupKind = 'scrap';
      for (const [k, w] of table) { r -= w; if (r <= 0) { kind = k; break; } }
      this.items.push({ x: x + (this.rnd() - 0.5) * 0.6, y: y - 0.2, vy: -3 - this.rnd() * 2, kind, age: 0 });
    }
  }

  private updateItems(dt: number) {
    const keep: Pickup[] = [];
    for (const it of this.items) {
      it.age += dt;
      it.vy += 18 * dt;
      const ny = it.y + it.vy * dt;
      if (this.solidAt(it.x, ny + 0.2)) { it.vy = 0; } else it.y = ny;
      const d = dist(it.x, it.y, this.x, this.y);
      if (d < 2.6 && it.age > 0.4) {
        const f = Math.min(1, dt * 8);
        it.x += (this.x - it.x) * f;
        it.y += (this.y - it.y) * f;
      }
      if (d < 0.65 && it.age > 0.3) { this.takePickup(it.kind, it.x, it.y); continue; }
      if (it.age < 90) keep.push(it);
    }
    this.items = keep;
  }

  private takePickup(kind: PickupKind, x: number, y: number) {
    this.emit({ type: 'pickup', kind });
    const s = this.stats;
    const label =
      kind === 'fuel' ? (this.fuel = Math.min(s.maxFuel, this.fuel + 35), '+35 FUEL')
      : kind === 'repair' ? (this.hull = Math.min(s.maxHull, this.hull + 35), '+35 HULL')
      : kind === 'bomb' ? (this.bombs = Math.min(6, this.bombs + 1), '+1 BOMB')
      : kind === 'shield' ? (this.shield = s.maxShield, 'SHIELD CELL')
      : kind === 'core' ? (this.bankedCores += 1, '+1 NEURO-CORE')
      : (this.cargo.bonusScrap += Math.round(25 * this.planet.scrapMult * s.oreValueMult), '+SCRAP');
    const color = kind === 'fuel' ? '#34d399' : kind === 'repair' ? '#f87171' : kind === 'bomb' ? '#fb923c' : kind === 'shield' ? '#38bdf8' : kind === 'core' ? '#c4b5fd' : '#facc15';
    this.floater(x, y - 0.4, label, color);
  }

  // ------------------------------------------------------------ docking, relays, merchants

  private sellCargo(): { scrap: number; cores: number } | null {
    if (cargoCount(this.cargo) === 0 && this.cargo.bonusScrap === 0) return null;
    const v = cargoValue(this.cargo, this.planet, this.stats.oreValueMult);
    this.bankedScrap += v.scrap;
    this.bankedCores += v.cores;
    this.cargo = emptyCargo();
    return v;
  }

  private updateDock() {
    if (!this.onPad) return;
    const v = this.sellCargo();
    if (v) {
      this.emit({ type: 'dock', scrap: v.scrap, cores: v.cores });
      this.floater(this.x, this.y - 1.2, `SOLD +${v.scrap}${v.cores ? ` +${v.cores} CORE` : ''}`, '#34d399', true);
    }
    this.fuel = this.stats.maxFuel;
    this.hull = this.stats.maxHull;
    this.shield = this.stats.maxShield;
    this.bombs = Math.max(this.bombs, this.stats.bombs);
  }

  private updateStations() {
    this.nearMerchant = this.world.merchants.some((m) => dist(m.x, m.y, this.x, this.y) < 1.6);
    this.nearRelay = false;
    for (const r of this.world.relays) {
      if (dist(r.x, r.y, this.x, this.y) > 1.8) continue;
      this.nearRelay = true;
      const v = this.sellCargo();
      if (v) {
        this.emit({ type: 'dock', scrap: v.scrap, cores: v.cores });
        this.floater(this.x, this.y - 1.2, `SOLD +${v.scrap}${v.cores ? ` +${v.cores} CORE` : ''}`, '#34d399', true);
      }
      if (!r.used) {
        r.used = true;
        this.fuel = Math.min(this.stats.maxFuel, this.fuel + this.stats.maxFuel * 0.5);
        this.hull = Math.min(this.stats.maxHull, this.hull + this.stats.maxHull * 0.4);
        this.shield = this.stats.maxShield;
        this.bombs = Math.max(this.bombs, this.stats.bombs);
        this.emit({ type: 'relay', refueled: true });
        this.floater(this.x, this.y - 1.6, 'RELAY: +50% FUEL  +40% HULL', '#38bdf8', true);
      }
    }
  }

  openMerchant() {
    if (this.status !== 'running' || !this.nearMerchant) return;
    this.status = 'merchant';
    this.emit({ type: 'merchant' });
  }
  closeMerchant() { if (this.status === 'merchant') this.status = 'running'; }

  /** Spend banked scrap on a trader offer. Returns false if you cannot afford it. */
  buyOffer(id: string): boolean {
    const offer = MERCHANT_OFFERS.find((o) => o.id === id);
    if (!offer || this.bankedScrap < offer.cost) return false;
    this.bankedScrap -= offer.cost;
    if (id === 'fuel') this.fuel = Math.min(this.stats.maxFuel, this.fuel + 50);
    else if (id === 'repair') this.hull = Math.min(this.stats.maxHull, this.hull + 50);
    else if (id === 'bombs') this.bombs = Math.min(6, this.bombs + 2);
    else if (id === 'shield') this.shield = this.stats.maxShield;
    return true;
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

  /** The pad turret protects the surface: it picks off raiders and anything that follows you up. */
  private updateTurret(dt: number) {
    const lvl = this.stats.turretLevel;
    if (lvl <= 0 || this.planetSurfaceFar()) return;
    this.turretCd -= dt;
    if (this.turretCd > 0) return;
    const tx = (this.world.padX0 + this.world.padX1 + 1) / 2, ty = SURFACE_ROW - 0.9;
    let best: Enemy | null = null, bd = 11;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.kind === 'boss') continue;
      const d = dist(e.x, e.y, tx, ty);
      if (d < bd && e.alpha > 0.5 && this.hasLineOfSight(tx, ty, e.x, e.y)) { bd = d; best = e; }
    }
    if (!best) return;
    const a = Math.atan2(best.y - ty, best.x - tx);
    this.turretAngle = a;
    this.bullets.push({ x: tx, y: ty, vx: Math.cos(a) * 17, vy: Math.sin(a) * 17, dmg: 5 + lvl * 3, life: 0.9, fromPlayer: true, crit: false, color: '#fde047', r: 0.1, turret: true });
    this.turretCd = 1 / (1.4 + lvl * 0.45);
    this.emit({ type: 'turret' });
  }
  private planetSurfaceFar() { return this.y > SURFACE_ROW + 14; }

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
      this.addShake(0.45);
      const R = 3.2;
      const bx = Math.floor(b.x), by = Math.floor(b.y);
      for (let ty = by - 4; ty <= by + 4; ty++) {
        for (let tx = bx - 4; tx <= bx + 4; tx++) {
          if (dist(tx + 0.5, ty + 0.5, b.x, b.y) <= R && isBreakable(tileAt(this.world, tx, ty))) this.breakTile(tx, ty, false);
        }
      }
      for (const e of [...this.enemies]) {
        if (this.hitCircles(e).some((c) => dist(c.x, c.y, b.x, b.y) <= R + c.r)) this.hurtEnemy(e, 70, false, true);
      }
      if (dist(this.x, this.y, b.x, b.y) <= 2) this.damageRig(22);
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
    this.burnT = 0; this.slowT = 0;
    for (const e of [...this.enemies]) this.hurtEnemy(e, e.kind === 'boss' ? 60 : 55, false, false);
    this.burst(this.x, this.y, '#38bdf8', 40, 9, 0.2);
    this.addShake(0.4);
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
      this.dropLoot(x + 0.5, y + 0.5, 2);
      this.floater(x + 0.5, y, 'VAULT DECRYPTED  +1 CORE', '#34d399', true);
      this.burst(x + 0.5, y + 0.5, '#34d399', 24, 5, 0.16);
    } else {
      this.floater(x + 0.5, y, 'VAULT FRIED', '#f87171', true);
      this.burst(x + 0.5, y + 0.5, '#f87171', 12, 3);
    }
  }

  // ------------------------------------------------------------ enemies: creation

  /** Pick an enemy kind from the planet roster for the current depth. `needSolid` picks tunnellers only. */
  private rosterKind(needSolid: boolean | null): EnemyKind | null {
    const entries = this.planet.roster.filter((r) => r.minDepth <= this.depth && (needSolid === null || (needSolid ? r.kind === 'worm' : r.kind !== 'worm')));
    if (entries.length === 0) return needSolid ? null : 'mite';
    const total = entries.reduce((n, r) => n + r.weight, 0);
    let r = this.rnd() * total;
    for (const e of entries) { r -= e.weight; if (r <= 0) return e.kind; }
    return entries[0].kind;
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const def = ENEMIES[kind];
    const scale = kind === 'boss' ? 1 : this.planet.enemyHpMult * depthScale(this.depth);
    const hp = kind === 'boss' ? this.planet.bossHp : Math.round(def.hp * scale);
    const e: Enemy = {
      id: this.nextId++, kind, x, y, vx: 0, vy: 0, hp, maxHp: hp, radius: def.radius,
      speed: def.speed * (this.planet.id === 2 ? 1.1 : 1),
      contactDps: def.contactDps * Math.min(2, 1 + this.depth / 300),
      shootT: 1 + this.rnd() * 1.5, flash: 0, phase: this.rnd() * 6, angle: this.rnd() * 6.28,
      state: 'hunt', stateT: 0, alpha: 1, home: null, segs: [], slows: false, dmgMult: Math.min(2, 1 + this.depth / 300),
      name: def.name, site: null, bossIndex: 0, atk: 'idle', atkT: 1.5, atkN: 0, patIdx: 0, tx: x, ty: y,
    };
    if (kind === 'sentry') e.home = { x, y };
    if (kind === 'worm') {
      e.state = 'emerge';
      e.stateT = 1.6;
      e.slows = this.planet.id === 4;
      for (let i = 0; i < 8; i++) e.segs.push({ x, y });
    }
    this.enemies.push(e);
    return e;
  }

  private updateSpawns(dt: number) {
    // Stationary guards wake when you get close.
    for (const s of this.world.spawners) {
      if (s.done) continue;
      if (Math.abs(s.x - this.x) < 22 && Math.abs(s.y - this.y) < 22) {
        s.done = true;
        this.spawnEnemy(s.kind, s.x, s.y);
      }
    }

    // Ambient glitches wake as you dig deeper.
    this.spawnT -= dt;
    const ambientCap = Math.min(10, 3 + Math.floor(this.depth / 12));
    if (this.spawnT <= 0 && this.depth > 5 && !this.inBossRoom) {
      this.spawnT = Math.max(3.5, 10 - this.depth / 14) + this.rnd() * 3;
      const live = this.enemies.filter((e) => e.kind !== 'raider' && e.kind !== 'boss' && e.kind !== 'sentry').length;
      if (live < ambientCap) this.spawnAmbient();
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
      for (let i = 0; i < n; i++) this.spawnEnemy('raider', i % 2 === 0 ? 1.5 : this.world.w - 2.5, SURFACE_ROW - 6 - this.rnd() * 3);
    }

    // Bosses wake when the rig drops into their cavern.
    const site = this.currentSite;
    if (site && !site.spawned && !site.done) this.spawnBoss(site);
  }

  private spawnAmbient() {
    const kind = this.rosterKind(null);
    if (!kind) return;
    if (kind === 'worm') {
      for (let tries = 0; tries < 20; tries++) {
        const a = this.rnd() * Math.PI * 2;
        const d = 9 + this.rnd() * 4;
        const sx = Math.floor(this.x + Math.cos(a) * d), sy = Math.floor(this.y + Math.sin(a) * d);
        if (sx < 3 || sx > this.world.w - 4 || sy < SURFACE_ROW + 6) continue;
        const t = tileAt(this.world, sx, sy);
        if (t !== T.DIRT && t !== T.ROCK) continue;
        if (this.world.bossSites.some((s) => sy >= s.top - 1 && sy <= s.bottom + 1)) continue;
        this.spawnEnemy('worm', sx + 0.5, sy + 0.5);
        this.emit({ type: 'rumble' });
        this.addShake(0.25);
        return;
      }
      return;
    }
    // Walkers and flyers spawn inside existing tunnels, preferably ones connected to the rig.
    const flowOk = this.flow.valid;
    for (let tries = 0; tries < 30; tries++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 10 + this.rnd() * 8;
      const sx = Math.floor(this.x + Math.cos(a) * d), sy = Math.floor(this.y + Math.sin(a) * d);
      if (sx < 2 || sx > this.world.w - 3 || sy < SURFACE_ROW + 3) continue;
      if (tileAt(this.world, sx, sy) !== T.AIR) continue;
      if (this.world.bossSites.some((s) => sy >= s.top - 1 && sy <= s.bottom + 1)) continue;
      if (flowOk && tries < 20 && this.flow.at(sx, sy) >= FLOW_INF) continue;
      this.spawnEnemy(kind, sx + 0.5, sy + 0.5);
      return;
    }
  }

  private spawnBoss(site: BossSite) {
    site.spawned = true;
    const cx = (site.left + site.right) / 2 + 0.5;
    const idx0 = site.index;
    const b = this.spawnEnemy('boss', cx, site.top + 4);
    b.site = site;
    b.bossIndex = idx0;
    b.maxHp = b.hp = Math.round(this.planet.bossHp * (1 + 0.65 * idx0));
    b.radius = 1.3;
    b.name = idx0 === 0 ? this.planet.bossName : `${this.planet.bossName} · Guardian ${idx0}`;
    b.dmgMult = 1 + idx0 * 0.25;
    this.emit({ type: 'boss', name: b.name });
    this.addShake(0.8);
    this.floater(cx, site.top + 2, b.name.toUpperCase(), this.planet.primary, true);
  }

  // ------------------------------------------------------------ surprises

  private updateEvents(dt: number) {
    if (this.depth < 8) return;
    // Tremors shake loose rock from the ceiling above you.
    this.tremorT -= dt;
    if (this.tremorT <= 0 && !this.inBossRoom) {
      this.tremorT = 50 + this.rnd() * 45;
      this.startTremor();
    }
    // Signal storms black out the lamps and send a swarm.
    if (this.surgeLeft > 0) {
      this.surgeLeft -= dt;
      if (this.surgeLeft <= 0) {
        this.emit({ type: 'surge', on: false });
        const bonus = Math.round(120 * this.planet.scrapMult * this.stats.oreValueMult);
        this.cargo.bonusScrap += bonus;
        this.floater(this.x, this.y - 1.5, `STORM ENDURED +${bonus}`, '#38bdf8', true);
      }
    } else if (this.depth > 18) {
      this.surgeT -= dt;
      if (this.surgeT <= 0 && !this.inBossRoom) {
        this.surgeT = 110 + this.rnd() * 70;
        this.surgeLeft = 14;
        this.emit({ type: 'surge', on: true });
        this.addShake(0.5);
        for (let i = 0; i < 4; i++) this.spawnAmbient();
      }
    }
  }

  private startTremor() {
    this.emit({ type: 'tremor' });
    this.addShake(0.9);
    const n = 3 + Math.floor(this.rnd() * 3);
    for (let i = 0; i < n; i++) {
      const bx = Math.floor(this.x + (this.rnd() - 0.5) * 7);
      // find the top of the open column above the rig
      let ty = Math.floor(this.y) - 1;
      while (ty > this.y - 12 && tileAt(this.world, bx, ty) === T.AIR) ty--;
      ty++;
      if (ty >= Math.floor(this.y) - 1) continue;
      this.boulders.push({ x: bx + 0.5, y: ty + 0.5, vy: 0, tele: 1.1 + i * 0.25, landed: false });
    }
  }

  private updateBoulders(dt: number) {
    const keep: Boulder[] = [];
    for (const b of this.boulders) {
      if (b.tele > 0) { b.tele -= dt; keep.push(b); continue; }
      b.vy = Math.min(16, b.vy + 20 * dt);
      const ny = b.y + b.vy * dt;
      if (this.solidAt(b.x, ny + 0.4)) {
        this.burst(b.x, b.y + 0.3, '#a8a29e', 14, 3.5, 0.14);
        this.emit({ type: 'explode' });
        this.addShake(0.3);
        continue;
      }
      b.y = ny;
      if (dist(b.x, b.y, this.x, this.y) < 0.75) {
        this.damageRig(18 * Math.min(2, this.dangerScale));
        this.floater(this.x, this.y - 0.9, 'ROCKFALL', '#f87171');
        this.burst(b.x, b.y, '#a8a29e', 14, 3.5, 0.14);
        continue;
      }
      for (const e of [...this.enemies]) if (e.kind !== 'boss' && dist(e.x, e.y, b.x, b.y) < e.radius + 0.4) { this.hurtEnemy(e, 40, false, true); }
      keep.push(b);
    }
    this.boulders = keep;
  }

  // ------------------------------------------------------------ enemies: behaviour

  /** Circles that make up an enemy for hit tests (worms are a chain). */
  hitCircles(e: Enemy): Array<{ x: number; y: number; r: number }> {
    if (e.kind === 'worm' && e.state !== 'emerge') return e.segs.map((s, i) => ({ x: s.x, y: s.y, r: i === 0 ? e.radius : e.radius * 0.8 }));
    if (e.kind === 'worm') return [];
    return [{ x: e.x, y: e.y, r: e.radius }];
  }

  hurtEnemy(e: Enemy, dmg: number, crit: boolean, showNumber: boolean) {
    if (e.hp <= 0) return;
    if (e.kind === 'phantom' && e.alpha < 0.5) return; // intangible
    if (e.kind === 'worm' && e.state === 'emerge') return;
    e.hp -= dmg;
    e.flash = 0.1;
    if (showNumber) this.floater(e.x, e.y - e.radius - 0.2, `${Math.round(dmg)}`, crit ? '#fde047' : '#e2e8f0', crit);
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    this.kills++;
    this.enemies = this.enemies.filter((o) => o !== e);
    const big = e.kind === 'boss';
    this.burst(e.x, e.y, this.planet.enemyColor, big ? 60 : 14, big ? 8 : 4, big ? 0.25 : 0.14);
    if (e.kind === 'worm') for (const s of e.segs) this.burst(s.x, s.y, this.planet.enemyColor, 5, 3);
    this.emit({ type: 'enemyDie', boss: big });
    const drop = Math.round(ENEMIES[e.kind].scrapDrop * this.planet.scrapMult * this.stats.oreValueMult * Math.min(2, this.dangerScale));
    if (drop > 0) {
      this.cargo.bonusScrap += drop;
      this.floater(e.x, e.y - 0.5, `+${drop}`, '#facc15');
    }
    if (!big && e.kind !== 'raider' && this.rnd() < (e.kind === 'brute' ? 0.7 : 0.12)) this.dropLoot(e.x, e.y, e.kind === 'brute' ? 2 : 1);
    if (big) this.onBossKilled(e);
  }

  private onBossKilled(e: Enemy) {
    const index = e.bossIndex;
    if (e.site) { e.site.done = true; }
    this.bossesDown++;
    this.addShake(1);
    const bonus = bossBonus(this.planet, index);
    this.bankedScrap += bonus.scrap;
    this.bankedCores += bonus.cores;
    this.floater(e.x, e.y - 1.5, `+${bonus.scrap} SCRAP  +${bonus.cores} CORES`, '#34d399', true);
    this.dropLoot(e.x, e.y, 5);
    this.bullets = this.bullets.filter((b) => b.fromPlayer);
    this.beams = [];
    this.warnings = [];
    this.emit({ type: 'bossDown', index });
    if (index === 0 && !this.clears.includes(this.planet.id)) {
      this.clears.push(this.planet.id);
      const next = nextPlanet(this.planet.id);
      this.emit({ type: 'planetCleared', planetId: this.planet.id, canWarp: !!next });
      if (next) this.status = 'choice';
    }
  }

  /** After the core boss: carry on to the next planet (keeping hull, cargo and bombs). */
  warp() {
    if (this.status !== 'choice') return;
    const next = nextPlanet(this.planet.id);
    if (!next) { this.status = 'running'; return; }
    this.planet = next;
    this.seed = this.seed * 31 + next.id;
    this.world = createWorld(next, this.seed);
    this.explored = new Uint8Array(this.world.w * this.world.h);
    this.enemies = []; this.bullets = []; this.items = []; this.boulders = []; this.bombList = []; this.beams = []; this.warnings = [];
    this.x = (this.world.padX0 + this.world.padX1 + 1) / 2;
    this.y = SURFACE_ROW - RIG_HY;
    this.vx = 0; this.vy = 0;
    this.fuel = this.stats.maxFuel;
    this.shield = this.stats.maxShield;
    this.hull = Math.min(this.stats.maxHull, this.hull + this.stats.maxHull * 0.5);
    this.bombs = Math.max(this.bombs, this.stats.bombs);
    this.depth = 0;
    this.raidT = 70; this.raidPending = false;
    this.flowT = 0; this.flow.valid = false;
    this.status = 'running';
    this.emit({ type: 'warp', planetId: next.id });
  }

  /** After the core boss: stay on this planet and keep drilling deeper. */
  stay() { if (this.status === 'choice') this.status = 'running'; }

  private fireEnemyBullet(e: Enemy, tx: number, ty: number, speed: number, dmg: number, color: string, spread = 0, extra: Partial<Bullet> = {}) {
    const a = Math.atan2(ty - e.y, tx - e.x) + spread;
    this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg: dmg * e.dmgMult, life: 3, fromPlayer: false, crit: false, color, r: 0.14, ...extra });
  }

  private updateEnemies(dt: number) {
    // Refresh the tunnel flow field toward the rig a few times a second.
    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.3;
      this.flow.rebuild(this.world, Math.floor(this.x), Math.floor(this.y));
    }

    for (const e of [...this.enemies]) {
      if (e.hp <= 0) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.phase += dt;
      const dx = this.x - e.x, dy = this.y - e.y;
      const d = Math.hypot(dx, dy) || 0.001;

      switch (e.kind) {
        case 'mite': this.aiMite(e, dt, d); break;
        case 'bat': this.aiBat(e, dt, d); break;
        case 'drone': this.aiDrone(e, dt, d); break;
        case 'sentry': this.aiSentry(e, dt, d); break;
        case 'worm': this.aiWorm(e, dt); break;
        case 'brute': this.aiBrute(e, dt, d); break;
        case 'raider': this.aiRaider(e, dt, d); break;
        case 'phantom': this.aiPhantom(e, dt, d); break;
        case 'boss': this.aiBoss(e, dt); break;
      }

      if (e.hp <= 0 || this.status === 'ended') continue;
      // contact damage against every body circle
      const touching = this.hitCircles(e).some((c) => dist(c.x, c.y, this.x, this.y) < c.r + RIG_HX) && e.alpha > 0.5 && !(e.kind === 'worm' && e.state === 'emerge');
      if (touching && e.contactDps > 0) {
        this.damageRig(e.contactDps * dt);
        if (e.slows) this.slowT = Math.max(this.slowT, 2.5);
        if (e.kind !== 'boss' && e.kind !== 'brute' && e.kind !== 'worm') this.hurtEnemy(e, 8 * dt, false, false);
      }
    }
  }

  /** Steer an enemy along the flow field through open tiles. Returns false if it has no route. */
  private followFlow(e: Enemy, speed: number, dt: number): boolean {
    const cx = Math.floor(e.x), cy = Math.floor(e.y);
    const here = this.flow.at(cx, cy);
    let tx: number, ty: number;
    if (here >= FLOW_INF) return false;
    const rigCx = Math.floor(this.x), rigCy = Math.floor(this.y);
    if (cx === rigCx && cy === rigCy) { tx = this.x; ty = this.y; }
    else {
      const nb = this.flow.next(this.world, cx, cy);
      if (!nb) { tx = this.x; ty = this.y; }
      else { tx = nb.x + 0.5; ty = nb.y + 0.5; }
    }
    // keep to the middle of the current cell when changing direction, so corners are not clipped
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, speed * dt);
    const nx = e.x + (dx / d) * step, ny = e.y + (dy / d) * step;
    if (tileAt(this.world, Math.floor(nx), Math.floor(ny)) === T.AIR) { e.x = nx; e.y = ny; e.angle = Math.atan2(dy, dx); }
    return true;
  }

  private wander(e: Enemy, speed: number, dt: number) {
    e.stateT -= dt;
    if (e.stateT <= 0) { e.stateT = 1 + this.rnd() * 2; e.angle = this.rnd() * Math.PI * 2; }
    const nx = e.x + Math.cos(e.angle) * speed * 0.35 * dt, ny = e.y + Math.sin(e.angle) * speed * 0.35 * dt;
    if (tileAt(this.world, Math.floor(nx), Math.floor(ny)) === T.AIR) { e.x = nx; e.y = ny; } else e.stateT = 0;
  }

  private aiMite(e: Enemy, dt: number, d: number) {
    // lunge when close with a clear line
    if (e.state === 'lunge') {
      e.stateT -= dt;
      const nx = e.x + Math.cos(e.angle) * e.speed * 2.6 * dt, ny = e.y + Math.sin(e.angle) * e.speed * 2.6 * dt;
      if (e.stateT <= 0 || tileAt(this.world, Math.floor(nx), Math.floor(ny)) !== T.AIR) { e.state = 'hunt'; e.shootT = 2; }
      else { e.x = nx; e.y = ny; }
      return;
    }
    e.shootT -= dt;
    if (d < 3 && e.shootT <= 0 && this.hasLineOfSight(e.x, e.y, this.x, this.y)) {
      e.state = 'lunge'; e.stateT = 0.35; e.angle = Math.atan2(this.y - e.y, this.x - e.x);
      return;
    }
    if (d > 28 || !this.followFlow(e, e.speed, dt)) this.wander(e, e.speed, dt);
  }

  private aiBat(e: Enemy, dt: number, d: number) {
    const flutter = 0.75 + 0.5 * Math.sin(e.phase * 7);
    if (d > 30 || !this.followFlow(e, e.speed * flutter, dt)) this.wander(e, e.speed * 1.4, dt);
  }

  private aiDrone(e: Enemy, dt: number, d: number) {
    if (d > 30 || !this.followFlow(e, e.speed * 0.8, dt)) this.wander(e, e.speed, dt);
    e.shootT -= dt;
    if (e.shootT <= 0 && d < 9 && this.hasLineOfSight(e.x, e.y, this.x, this.y)) {
      e.shootT = 4;
      this.bullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, dmg: 18 * e.dmgMult, life: 9, fromPlayer: false, crit: false, color: '#fb7185', r: 0.22, mine: true, arm: 0.9 });
    }
  }

  private aiSentry(e: Enemy, dt: number, d: number) {
    e.angle = Math.atan2(this.y - e.y, this.x - e.x);
    e.shootT -= dt;
    if (e.state === 'burst') {
      e.stateT -= dt;
      if (e.stateT <= 0) {
        this.fireEnemyBullet(e, this.x, this.y, 8.5, 8, this.planet.hazardColor);
        e.atkN--;
        e.stateT = 0.2;
        if (e.atkN <= 0) e.state = 'hunt';
      }
    } else if (e.shootT <= 0 && d < 11 && this.hasLineOfSight(e.x, e.y, this.x, this.y)) {
      e.shootT = 2.4;
      e.state = 'burst'; e.atkN = 2; e.stateT = 0.25;
    }
  }

  private aiBrute(e: Enemy, dt: number, d: number) {
    e.shootT -= dt;
    if (e.state === 'windup') {
      e.stateT -= dt;
      if (e.stateT <= 0) { e.state = 'charge'; e.stateT = 0.55; e.angle = Math.atan2(this.y - e.y, this.x - e.x); }
      return;
    }
    if (e.state === 'charge') {
      e.stateT -= dt;
      const nx = e.x + Math.cos(e.angle) * 8 * dt, ny = e.y + Math.sin(e.angle) * 8 * dt;
      if (e.stateT <= 0 || tileAt(this.world, Math.floor(nx), Math.floor(ny)) !== T.AIR) { e.state = 'hunt'; e.shootT = 3.2; this.addShake(0.25); }
      else { e.x = nx; e.y = ny; if (dist(e.x, e.y, this.x, this.y) < e.radius + 0.4 && e.stateT > 0.05) { this.damageRig(22 * e.dmgMult); e.stateT = 0.05; } }
      return;
    }
    if (e.shootT <= 0 && d < 7 && this.hasLineOfSight(e.x, e.y, this.x, this.y)) { e.state = 'windup'; e.stateT = 0.7; return; }
    if (d > 28 || !this.followFlow(e, e.speed, dt)) this.wander(e, e.speed, dt);
  }

  private aiRaider(e: Enemy, dt: number, d: number) {
    const hx = this.x + Math.sin(e.phase * 0.7 + e.id) * 5, hy = Math.min(this.y - 3.2, SURFACE_ROW - 2.5);
    const tx = hx - e.x, ty = hy - e.y, td = Math.hypot(tx, ty) || 1;
    e.vx = (tx / td) * e.speed * Math.min(1, td / 2); e.vy = (ty / td) * e.speed * Math.min(1, td / 2);
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.shootT -= dt;
    if (e.shootT <= 0 && d < 11 && this.hasLineOfSight(e.x, e.y, this.x, this.y)) {
      e.shootT = 1.5;
      this.fireEnemyBullet(e, this.x, this.y, 9, 7, '#f87171');
    }
  }

  private aiPhantom(e: Enemy, dt: number, d: number) {
    // Ghosts drift straight through rock, but are only solid (and only dangerous) while visible.
    e.alpha = 0.3 + 0.7 * Math.abs(Math.sin(e.phase * 0.9));
    const sp = e.speed * (e.alpha > 0.5 ? 1 : 1.4);
    e.vx = (this.x - e.x) / d * sp; e.vy = (this.y - e.y) / d * sp;
    e.x += e.vx * dt; e.y += e.vy * dt + Math.sin(e.phase * 3) * 0.4 * dt;
    e.angle = Math.atan2(e.vy, e.vx);
    e.shootT -= dt;
    if (e.shootT <= 0 && d < 9 && e.alpha > 0.6 && !this.solidAt(e.x, e.y) && this.hasLineOfSight(e.x, e.y, this.x, this.y)) {
      e.shootT = 3.2;
      this.fireEnemyBullet(e, this.x, this.y, 5.5, 9, '#e879f9');
    }
  }

  /** Worms burrow: a rumbling warning, then a visible tunnel eaten toward the rig. */
  private aiWorm(e: Enemy, dt: number) {
    if (e.state === 'emerge') {
      e.stateT -= dt;
      if (this.rnd() < dt * 10) this.burst(e.x, e.y, this.planet.dirt[0], 1, 2.5, 0.12);
      if (e.stateT <= 0) e.state = 'hunt';
      return;
    }
    const head = e.segs[0];
    const want = Math.atan2(this.y - head.y, this.x - head.x);
    let da = want - e.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    e.angle += Math.max(-2 * dt, Math.min(2 * dt, da));
    const sp = e.speed;
    const hx = head.x + Math.cos(e.angle) * sp * dt, hy = head.y + Math.sin(e.angle) * sp * dt;
    const ahead = tileAt(this.world, Math.floor(hx), Math.floor(hy));
    if (ahead === T.BEDROCK || ahead === T.PLATE || ahead === T.VAULT || ahead === T.CHEST) {
      e.angle += (this.rnd() < 0.5 ? 1 : -1) * 1.2; // turn away from things it cannot eat
    } else {
      if (ahead !== T.AIR) this.eatTile(Math.floor(hx), Math.floor(hy), e);
      head.x = hx; head.y = hy;
    }
    // the body follows like a rope
    for (let i = 1; i < e.segs.length; i++) {
      const p = e.segs[i - 1], s = e.segs[i];
      const sdx = p.x - s.x, sdy = p.y - s.y, sd = Math.hypot(sdx, sdy);
      const gap = 0.5;
      if (sd > gap) { s.x += (sdx / sd) * (sd - gap); s.y += (sdy / sd) * (sd - gap); }
    }
    e.x = head.x; e.y = head.y;
  }

  private eatTile(x: number, y: number, e: Enemy) {
    const t = tileAt(this.world, x, y);
    if (!isBreakable(t)) return;
    this.world.tiles[idx(this.world, x, y)] = T.AIR;
    this.world.back[idx(this.world, x, y)] = 1; // bare cave wall behind a fresh tunnel
    this.burst(x + 0.5, y + 0.5, this.planet.rock[0], 3, 2.6, 0.12);
    if (this.rnd() < 0.25) this.emit({ type: 'rumble' });
    void e;
  }

  // ------------------------------------------------------------ bosses

  private aiBoss(e: Enemy, dt: number) {
    const site = e.site!;
    const patterns = this.planet.bossPatterns;
    const hpFrac = e.hp / e.maxHp;
    const minX = site.left + 2.5, maxX = site.right - 1.5, hoverY = site.top + 4;
    const rage = hpFrac < 0.5 ? 0.7 : 1;

    e.atkT -= dt;
    // idle hovering between attacks
    if (e.atk === 'idle') {
      const cx = (minX + maxX) / 2 + Math.sin(e.phase * 0.6) * (maxX - minX) * 0.42;
      e.x += Math.sign(cx - e.x) * Math.min(2.6 * dt, Math.abs(cx - e.x));
      e.y += (hoverY - e.y) * Math.min(1, dt * 2);
      if (e.atkT <= 0) {
        const pick = patterns[e.patIdx++ % patterns.length];
        e.atk = pick; e.atkT = 0; e.atkN = 0;
        e.tx = this.x; e.ty = this.y;
      }
    } else {
      this.runBossAttack(e, dt, site, rage);
    }
    e.x = Math.max(minX, Math.min(maxX, e.x));
    e.y = Math.max(site.top + 1.5, Math.min(site.bottom - 1.5, e.y));
    // beams hurt the rig while live
    for (const b of this.beams) {
      if (!b.live) continue;
      const ex = b.x + Math.cos(b.angle) * b.len, ey = b.y + Math.sin(b.angle) * b.len;
      const t = Math.max(0, Math.min(1, ((this.x - b.x) * (ex - b.x) + (this.y - b.y) * (ey - b.y)) / (b.len * b.len)));
      const px = b.x + (ex - b.x) * t, py = b.y + (ey - b.y) * t;
      if (dist(px, py, this.x, this.y) < b.width + 0.3) this.damageRig(34 * e.dmgMult * dt);
    }
  }

  private endAttack(e: Enemy, gap: number) { e.atk = 'idle'; e.atkT = gap; e.atkN = 0; this.beams = []; }

  private runBossAttack(e: Enemy, dt: number, site: BossSite, rage: number) {
    const hpFrac = e.hp / e.maxHp;
    switch (e.atk) {
      case 'ring': {
        const n = hpFrac < 0.5 ? 12 : 8;
        for (let i = 0; i < n; i++) {
          const a = e.phase * 0.5 + (i / n) * Math.PI * 2;
          this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 5.5, vy: Math.sin(a) * 5.5, dmg: 10 * e.dmgMult, life: 4, fromPlayer: false, crit: false, color: this.planet.enemyColor, r: 0.15 });
        }
        this.endAttack(e, 1.8 * rage);
        break;
      }
      case 'aimed': {
        e.atkT -= 0; // timer used as spacing
        if (e.atkN === 0 || (e.atkN < 3 && e.stateT <= 0)) {
          for (const s of [-0.22, 0, 0.22]) this.fireEnemyBullet(e, this.x, this.y, 8.5, 11, this.planet.hazardColor, s);
          e.atkN++;
          e.stateT = 0.4;
        }
        e.stateT -= dt;
        if (e.atkN >= 3 && e.stateT <= 0) this.endAttack(e, 1.6 * rage);
        break;
      }
      case 'dash': {
        // 0.9s telegraph, 0.7s dash, return
        e.atkT += 0;
        e.stateT = (e.stateT || 0);
        if (e.atkN === 0) { e.atkN = 1; e.stateT = 0.9; e.tx = this.x; e.ty = this.y; }
        else if (e.atkN === 1) {
          e.stateT -= dt; e.tx = this.x; e.ty = this.y;
          if (e.stateT <= 0) { e.atkN = 2; e.stateT = 0.7; }
        } else if (e.atkN === 2) {
          e.stateT -= dt;
          const tx = e.tx - e.x, ty = e.ty - e.y, td = Math.hypot(tx, ty) || 1;
          e.x += (tx / td) * 11 * dt; e.y += (ty / td) * 11 * dt;
          if (dist(e.x, e.y, this.x, this.y) < e.radius + 0.4) { this.damageRig(22 * e.dmgMult * dt * 3); }
          if (e.stateT <= 0 || td < 0.5) { e.atkN = 3; e.stateT = 1.0; }
        } else {
          e.stateT -= dt;
          e.y += (site.top + 4 - e.y) * Math.min(1, dt * 2.5);
          if (e.stateT <= 0) this.endAttack(e, 2 * rage);
        }
        break;
      }
      case 'summon': {
        if (e.atkN === 0) {
          e.atkN = 1;
          for (let i = 0; i < 2; i++) {
            const k = this.planet.roster[0].kind === 'phantom' ? 'phantom' : this.planet.roster[0].kind === 'drone' ? 'drone' : 'mite';
            this.spawnEnemy(k, e.x + (i ? 2 : -2), e.y + 1);
          }
          this.floater(e.x, e.y - 2, 'REINFORCEMENTS', '#fbbf24', true);
          e.stateT = 1.2;
        }
        e.stateT -= dt;
        if (e.stateT <= 0) this.endAttack(e, 2 * rage);
        break;
      }
      case 'sweep': {
        // telegraph a line, then sweep it across the rig
        if (e.atkN === 0) { e.atkN = 1; e.stateT = 0.9; e.angle = Math.atan2(this.y - e.y, this.x - e.x) - 1.0; this.beams = [{ x: e.x, y: e.y, angle: e.angle, len: 18, width: 0.05, live: false }]; }
        else if (e.atkN === 1) {
          e.stateT -= dt;
          this.beams[0] = { ...this.beams[0], x: e.x, y: e.y };
          if (e.stateT <= 0) { e.atkN = 2; e.stateT = 2.2; }
        } else {
          e.stateT -= dt;
          e.angle += (2.0 / 2.2) * dt * 1.05;
          this.beams[0] = { x: e.x, y: e.y, angle: e.angle, len: this.beamLen(e.x, e.y, e.angle), width: 0.28, live: true };
          if (e.stateT <= 0) this.endAttack(e, 2 * rage);
        }
        break;
      }
      case 'shards': {
        if (e.atkN === 0) {
          e.atkN = 1; e.stateT = 1.0;
          this.warnings = [];
          for (let i = 0; i < 6; i++) this.warnings.push({ x: i === 0 ? this.x : site.left + 1 + this.rnd() * (site.right - site.left - 1), y: site.top + 0.5, t: 1.0 });
        } else if (e.atkN === 1) {
          e.stateT -= dt;
          for (const w of this.warnings) w.t = e.stateT;
          if (e.stateT <= 0) {
            for (const w of this.warnings) this.bullets.push({ x: w.x, y: w.y, vx: 0, vy: 9, dmg: 14 * e.dmgMult, life: 3, fromPlayer: false, crit: false, color: '#e0f2fe', r: 0.16, slow: true });
            this.warnings = [];
            e.atkN = 2; e.stateT = 0.8;
          }
        } else { e.stateT -= dt; if (e.stateT <= 0) this.endAttack(e, 1.6 * rage); }
        break;
      }
      case 'mines': {
        if (e.atkN === 0) {
          e.atkN = 1;
          for (let i = 0; i < 4; i++) {
            const mx = Math.max(site.left + 1, Math.min(site.right - 1, this.x + (this.rnd() - 0.5) * 12));
            this.bullets.push({ x: mx, y: Math.min(site.bottom - 0.4, this.y + (this.rnd() - 0.5) * 3), vx: 0, vy: 0, dmg: 18 * e.dmgMult, life: 10, fromPlayer: false, crit: false, color: '#fb7185', r: 0.22, mine: true, arm: 1.0 });
          }
          e.stateT = 1.0;
        }
        e.stateT -= dt;
        if (e.stateT <= 0) this.endAttack(e, 1.8 * rage);
        break;
      }
      case 'blink': {
        if (e.atkN === 0) { e.atkN = 1; e.stateT = 0.7; }
        else if (e.atkN === 1) {
          e.stateT -= dt;
          if (e.stateT <= 0) {
            const nx = this.x > (site.left + site.right) / 2 ? site.left + 3 : site.right - 3;
            this.burst(e.x, e.y, this.planet.accent, 24, 6, 0.18);
            e.x = nx; e.y = site.top + 4;
            this.burst(e.x, e.y, this.planet.accent, 24, 6, 0.18);
            for (const s of [-0.3, -0.15, 0, 0.15, 0.3]) this.fireEnemyBullet(e, this.x, this.y, 9, 11, this.planet.accent, s);
            e.atkN = 2; e.stateT = 0.8;
          }
        } else { e.stateT -= dt; if (e.stateT <= 0) this.endAttack(e, 1.5 * rage); }
        break;
      }
      case 'spiral': {
        e.stateT = (e.stateT || 0) - dt;
        if (e.stateT <= 0 && e.atkN < 28) {
          const a = e.atkN * 0.42;
          this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, dmg: 9 * e.dmgMult, life: 4, fromPlayer: false, crit: false, color: this.planet.hazardColor, r: 0.14 });
          e.atkN++;
          e.stateT = 0.09;
        }
        if (e.atkN >= 28) this.endAttack(e, 2 * rage);
        break;
      }
      default:
        this.endAttack(e, 1);
    }
  }

  private beamLen(x: number, y: number, a: number): number {
    for (let l = 0.5; l < 18; l += 0.4) if (this.solidAt(x + Math.cos(a) * l, y + Math.sin(a) * l)) return l;
    return 18;
  }

  // ------------------------------------------------------------ bullets & fx

  private updateBullets(dt: number) {
    const live: Bullet[] = [];
    for (const b of this.bullets) {
      b.life -= dt;
      if (b.mine) {
        if (b.arm !== undefined && b.arm > 0) b.arm -= dt;
        else if (dist(b.x, b.y, this.x, this.y) < 1.1) {
          this.emit({ type: 'explode' });
          this.burst(b.x, b.y, b.color, 18, 5, 0.16);
          this.addShake(0.3);
          this.damageRig(b.dmg);
          continue;
        }
        if (b.life > 0) live.push(b);
        continue;
      }
      const steps = 2;
      let dead = b.life <= 0;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        const bx = Math.floor(b.x), by = Math.floor(b.y);
        const tile = tileAt(this.world, bx, by);
        if (tile !== T.AIR) {
          dead = true;
          this.burst(b.x, b.y, b.color, 3, 1.5, 0.08);
          if (b.fromPlayer && (tile === T.CRATE || tile === T.MIMIC)) this.breakTile(bx, by, false);
        } else if (b.fromPlayer) {
          for (const e of this.enemies) {
            if (e.hp <= 0) continue;
            if (this.hitCircles(e).some((c) => dist(c.x, c.y, b.x, b.y) < c.r + b.r)) {
              if (e.kind === 'phantom' && e.alpha < 0.5) continue;
              this.hurtEnemy(e, b.dmg, b.crit, true);
              this.emit({ type: 'hit' });
              dead = true;
              break;
            }
          }
        } else if (dist(this.x, this.y, b.x, b.y) < RIG_HX + b.r) {
          this.damageRig(b.dmg);
          if (b.slow) this.slowT = Math.max(this.slowT, 2);
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

  /** Remember every tile the headlamp has lit; the minimap draws from this. */
  private updateExplored(dt: number) {
    this.exploreT -= dt;
    if (this.exploreT > 0) return;
    this.exploreT = 0.15;
    if (this.y < SURFACE_ROW) return;
    const R = Math.min(this.lightR, 14), cx = Math.floor(this.x), cy = Math.floor(this.y);
    for (let y = Math.max(0, cy - Math.ceil(R)); y <= cy + Math.ceil(R); y++) {
      for (let x = Math.max(0, cx - Math.ceil(R)); x <= Math.min(this.world.w - 1, cx + Math.ceil(R)); x++) {
        if (y >= this.world.h) continue;
        if (dist(x + 0.5, y + 0.5, this.x, this.y) <= R) this.explored[y * this.world.w + x] = 1;
      }
    }
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
      planetId: this.startPlanetId, outcome, scrap, neuroCores: cores, depth: this.maxDepth,
      kills: this.kills, bossBeaten: this.clears.length > 0, bossesDown: this.bossesDown,
      vaultsOpened: this.vaultsOpened, clears: [...this.clears], depths: { ...this.depthByPlanet },
    };
    this.emit({ type: 'end', result: this.result });
  }
}
