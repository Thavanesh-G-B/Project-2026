/**
 * Deterministic, endless planet generation. The world is WORLD_W tiles wide and grows
 * downward in bands of BAND rows as the rig descends:
 *
 *   topsoil (12 m)  -> band 0 -> band 1 -> ... (forever)
 *
 * Every band is an abandoned mine level: a riveted PLATE floor with a couple of ladder shafts,
 * a timber-framed drift (rails, lamps, crates, relays, merchants), and ore-bearing crust with
 * caves, hazard pockets, nests, flashcard vaults and sealed treasure rooms. Every few bands the
 * level is replaced by a boss cavern.
 */
import {
  B, BAND, BOSS_EVERY_BANDS, D, EnemyKind, FIRST_PLATE_DEPTH, PlanetDef, SURFACE_ROW, T, WORLD_W,
} from './balance';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Room { x0: number; y0: number; x1: number; y1: number; ambush: boolean; triggered: boolean }
export interface Spawner { x: number; y: number; kind: EnemyKind; done: boolean }
export interface Relay { x: number; y: number; used: boolean }
export interface Merchant { x: number; y: number }
export interface BossSite {
  index: number; // 0 = the planet's core boss, then guardians
  band: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  spawned: boolean;
  done: boolean;
}

export interface World {
  w: number;
  h: number; // rows generated so far
  planet: PlanetDef;
  seed: number;
  tiles: Uint8Array;
  decor: Uint8Array;
  back: Uint8Array;
  padX0: number; // pad covers tile columns [padX0, padX1] on row SURFACE_ROW
  padX1: number;
  bandsBuilt: number;
  nests: Array<{ x: number; y: number }>;
  rooms: Room[];
  spawners: Spawner[];
  relays: Relay[];
  merchants: Merchant[];
  bossSites: BossSite[];
}

export const idx = (w: World, x: number, y: number) => y * w.w + x;
export const inBounds = (w: World, x: number, y: number) => x >= 0 && y >= 0 && x < w.w && y < w.h;
export const tileAt = (w: World, x: number, y: number): number =>
  inBounds(w, x, y) ? w.tiles[idx(w, x, y)] : T.BEDROCK;
export const decorAt = (w: World, x: number, y: number): number => (inBounds(w, x, y) ? w.decor[idx(w, x, y)] : D.NONE);
export const backAt = (w: World, x: number, y: number): number => (inBounds(w, x, y) ? w.back[idx(w, x, y)] : B.NONE);

/** Row where band `b` starts. */
export const bandRow = (b: number) => SURFACE_ROW + FIRST_PLATE_DEPTH + b * BAND;
/** Whether band `b` holds a boss cavern, and which boss it is. */
export function bossIndexOfBand(planet: PlanetDef, b: number): number {
  if (b < planet.coreBand) return -1;
  const d = b - planet.coreBand;
  return d % BOSS_EVERY_BANDS === 0 ? d / BOSS_EVERY_BANDS : -1;
}

function growTo(world: World, rows: number) {
  if (rows <= world.h) return;
  const n = rows * world.w;
  const t = new Uint8Array(n); t.set(world.tiles);
  const d = new Uint8Array(n); d.set(world.decor);
  const b = new Uint8Array(n); b.set(world.back);
  world.tiles = t; world.decor = d; world.back = b;
  world.h = rows;
}

const setT = (w: World, x: number, y: number, t: number) => { if (inBounds(w, x, y)) w.tiles[idx(w, x, y)] = t; };
const setD = (w: World, x: number, y: number, d: number) => { if (inBounds(w, x, y)) w.decor[idx(w, x, y)] = d; };
const setB = (w: World, x: number, y: number, b: number) => { if (inBounds(w, x, y)) w.back[idx(w, x, y)] = b; };

function carveBlob(w: World, cx: number, cy: number, rx: number, ry: number, fill: number, minRow: number, maxRow: number, back?: number) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (y < minRow || y > maxRow || x < 1 || x > w.w - 2) continue;
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1 && w.tiles[idx(w, x, y)] !== T.BEDROCK) {
        w.tiles[idx(w, x, y)] = fill;
        if (fill === T.AIR && back !== undefined) setB(w, x, y, back);
      }
    }
  }
}

function crustTile(rnd: () => number, depth: number): number {
  const t = Math.min(1.6, depth / 120);
  let tile: number = T.DIRT;
  if (rnd() < Math.min(0.62, 0.04 + t * 0.6)) tile = T.ROCK;
  if (depth > 2 && rnd() < 0.065 + (1 - Math.min(1, t)) * 0.03) tile = T.SCRAP;
  if (depth > 8 && rnd() < 0.014 + t * 0.028) tile = T.CRYSTAL;
  if (depth > 24 && rnd() < 0.003 + t * 0.011) tile = T.CORE;
  return tile;
}

export function createWorld(planet: PlanetDef, seed: number): World {
  const world: World = {
    w: WORLD_W, h: 0, planet, seed,
    tiles: new Uint8Array(0), decor: new Uint8Array(0), back: new Uint8Array(0),
    padX0: WORLD_W / 2 - 3, padX1: WORLD_W / 2 + 2,
    bandsBuilt: 0, nests: [], rooms: [], spawners: [], relays: [], merchants: [], bossSites: [],
  };
  buildTopsoil(world);
  ensureRows(world, SURFACE_ROW + 60);
  return world;
}

function buildTopsoil(world: World) {
  const rows = SURFACE_ROW + FIRST_PLATE_DEPTH;
  growTo(world, rows);
  const rnd = mulberry32(world.seed * 7919 + world.planet.id * 104729);
  for (let y = SURFACE_ROW; y < rows; y++) {
    for (let x = 0; x < world.w; x++) {
      const tile = x === 0 || x === world.w - 1 ? T.BEDROCK : crustTile(rnd, y - SURFACE_ROW);
      setT(world, x, y, tile);
    }
  }
  for (let y = 0; y < SURFACE_ROW; y++) { setT(world, 0, y, T.AIR); setT(world, world.w - 1, y, T.AIR); }
  for (let x = world.padX0; x <= world.padX1; x++) setT(world, x, SURFACE_ROW, T.BEDROCK);
  // a few buried crates in the topsoil teach "break crates for loot"
  for (let i = 0; i < 3; i++) {
    const x = 4 + Math.floor(rnd() * (world.w - 8));
    const y = SURFACE_ROW + 3 + Math.floor(rnd() * 7);
    if (x < world.padX0 - 1 || x > world.padX1 + 1) setT(world, x, y, T.CRATE);
  }
}

/** Generate whatever bands are needed so that rows up to `row` + a margin exist. */
export function ensureRows(world: World, row: number) {
  const need = row + 48;
  while (world.h < need) buildBand(world, world.bandsBuilt++);
}

function buildBand(world: World, band: number) {
  const planet = world.planet;
  const r0 = bandRow(band);
  growTo(world, r0 + BAND);
  const rnd = mulberry32(world.seed * 100003 + planet.id * 7919 + band * 977 + 13);
  const bossIdx = bossIndexOfBand(planet, band);
  const startDepth = r0 - SURFACE_ROW;

  // crust everywhere first
  for (let i = 0; i < BAND; i++) {
    const y = r0 + i;
    for (let x = 0; x < world.w; x++) {
      setT(world, x, y, x === 0 || x === world.w - 1 ? T.BEDROCK : crustTile(rnd, startDepth + i));
      setD(world, x, y, D.NONE);
      setB(world, x, y, B.NONE);
    }
  }
  // plated floor on the first row, with ladder shafts
  for (let x = 1; x < world.w - 1; x++) setT(world, x, r0, T.PLATE);

  let cx0 = 0, cx1 = 0;
  if (bossIdx >= 0) {
    buildBossCavern(world, rnd, band, bossIdx, r0);
    cx0 = 8; cx1 = world.w - 9;
    carveShafts(world, rnd, r0, cx0 + 2, cx1 - 2, 2, 1);
  } else {
    // the drift: rows 2..4 are open, framed in timber
    const len = 30 + Math.floor(rnd() * 20);
    cx0 = 2 + Math.floor(rnd() * (world.w - 4 - len));
    cx1 = cx0 + len;
    buildDrift(world, rnd, band, r0, cx0, cx1);
    carveShafts(world, rnd, r0, cx0 + 3, cx1 - 3, 2, 0);
    buildCrust(world, rnd, band, r0, startDepth);
  }
}

/** Open a few two-wide ladder shafts through the plated floor (and the rock under it). */
function carveShafts(world: World, rnd: () => number, r0: number, xa: number, xb: number, shafts: number, _unused: number) {
  void _unused;
  const n = shafts + (rnd() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const x = xa + Math.floor(rnd() * Math.max(1, xb - xa - 1));
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        setT(world, x + dx, r0 + dy, T.AIR);
        setB(world, x + dx, r0 + dy, B.WOOD);
        setD(world, x + dx, r0 + dy, dx === 0 ? D.LADDER : D.NONE);
      }
    }
  }
}

function buildDrift(world: World, rnd: () => number, band: number, r0: number, cx0: number, cx1: number) {
  const top = r0 + 2, mid = r0 + 3, floor = r0 + 4;
  for (let x = cx0; x <= cx1; x++) {
    for (let y = top; y <= floor; y++) {
      setT(world, x, y, T.AIR);
      setB(world, x, y, B.WOOD);
      setD(world, x, y, D.NONE);
    }
  }
  // timber frames every 6 tiles, rails along the floor
  for (let x = cx0; x <= cx1; x++) setD(world, x, floor, D.RAIL);
  for (let x = cx0 + 3; x < cx1; x += 6) {
    setD(world, x, top, D.BEAM);
    setD(world, x, mid, D.POST);
    setD(world, x, floor, D.POST);
  }
  // pipes along the ceiling where there is no beam
  if (rnd() < 0.6) for (let x = cx0; x <= cx1; x++) if (world.decor[idx(world, x, top)] === D.NONE) setD(world, x, top, D.PIPE);
  // lamps (a third of them dead)
  for (let x = cx0 + 6; x < cx1 - 2; x += 8 + Math.floor(rnd() * 3)) {
    setD(world, x, top, rnd() < 0.34 ? D.LAMP_DEAD : D.LAMP);
  }
  setD(world, cx0, top, D.WEB);
  setD(world, cx1, top, D.WEB);
  setD(world, cx0 + 1, mid, D.SIGN);

  // dressing on the floor: wrecks, barrels, carts
  const dressing = [D.BONES, D.BARREL, D.CART, D.BARREL];
  for (let i = 0; i < 4; i++) {
    const x = cx0 + 4 + Math.floor(rnd() * (cx1 - cx0 - 8));
    if (world.decor[idx(world, x, floor)] === D.RAIL) setD(world, x, floor, dressing[i]);
  }

  // loot crates standing on the drift floor, one of them maybe a mimic
  const crates = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < crates; i++) {
    const x = cx0 + 3 + Math.floor(rnd() * (cx1 - cx0 - 6));
    if (tileAt(world, x, floor) === T.AIR && world.decor[idx(world, x, floor)] !== D.POST) {
      setT(world, x, floor, band > 0 && rnd() < 0.15 ? T.MIMIC : T.CRATE);
      setD(world, x, floor, D.NONE);
    }
  }

  // relay station every third level, otherwise sometimes a derelict merchant
  const midX = Math.floor((cx0 + cx1) / 2);
  if (band % 3 === 2) {
    world.relays.push({ x: midX + 0.5, y: floor + 0.5, used: false });
    setT(world, midX, floor, T.AIR);
    setD(world, midX, floor, D.RELAY);
    setD(world, midX - 1, top, D.LAMP);
    setD(world, midX + 1, top, D.LAMP);
  } else if (band >= 1 && rnd() < 0.16) {
    const mx = cx0 + 6 + Math.floor(rnd() * (cx1 - cx0 - 12));
    setT(world, mx, floor, T.AIR);
    setD(world, mx, floor, D.MERCHANT);
    setD(world, mx, top, D.LAMP);
    world.merchants.push({ x: mx + 0.5, y: floor + 0.5 });
  }

  // guards: a sentry bolted to the ceiling, a couple of mites, now and then a brute
  const sx = cx0 + 8 + Math.floor(rnd() * Math.max(1, cx1 - cx0 - 16));
  world.spawners.push({ x: sx + 0.5, y: top + 0.35, kind: 'sentry', done: false });
  for (let i = 0; i < 2; i++) {
    world.spawners.push({ x: cx0 + 4 + rnd() * (cx1 - cx0 - 8), y: floor + 0.3, kind: world.planet.roster[0].kind === 'phantom' ? 'phantom' : 'mite', done: false });
  }
  if (band >= 2 && rnd() < 0.35) world.spawners.push({ x: cx1 - 4 - rnd() * 6, y: floor + 0.2, kind: 'brute', done: false });
}

function buildCrust(world: World, rnd: () => number, band: number, r0: number, startDepth: number) {
  const first = r0 + 5, last = r0 + BAND - 1;
  const planet = world.planet;
  const rich = Math.min(2, startDepth / 120);

  // natural caves with a rich vein hugging one edge
  const caves = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < caves; i++) {
    const cy = first + 2 + rnd() * (last - first - 4);
    const cx = 4 + rnd() * (world.w - 8);
    const rx = 1.8 + rnd() * 2.4, ry = 1.2 + rnd() * 1.4;
    carveBlob(world, cx, cy, rx, ry, T.AIR, first, last - 1, B.CAVE);
    if (rnd() < 0.7) carveBlob(world, cx + rx + 1, cy, 1.2, 1.2, rnd() < 0.5 + rich * 0.15 ? T.CRYSTAL : T.SCRAP, first, last - 1);
    if (rnd() < 0.5) world.spawners.push({ x: cx, y: cy, kind: planet.roster[Math.floor(rnd() * Math.min(2, planet.roster.length))].kind, done: false });
  }

  // hazard pockets
  for (let i = 0; i < 1 + Math.floor(rnd() * 2); i++) {
    carveBlob(world, 4 + rnd() * (world.w - 8), first + 1 + rnd() * (last - first - 2), 1.5 + rnd() * 1.3, 1.2 + rnd(), T.HAZARD, first, last);
  }

  // nests
  for (let i = 0; i < 1 + Math.floor(rnd() * 2); i++) {
    const nx = 4 + Math.floor(rnd() * (world.w - 8));
    const ny = first + 1 + Math.floor(rnd() * (last - first - 2));
    if (tileAt(world, nx, ny) !== T.AIR) { setT(world, nx, ny, T.NEST); world.nests.push({ x: nx, y: ny }); }
  }

  // vault crates buried in rock
  for (let i = 0; i < 1 + Math.floor(rnd() * 2); i++) {
    const vx = 3 + Math.floor(rnd() * (world.w - 6));
    const vy = first + 1 + Math.floor(rnd() * (last - first - 2));
    if (tileAt(world, vx, vy) !== T.AIR) setT(world, vx, vy, T.VAULT);
  }

  // a sealed treasure room, sometimes trapped
  if (rnd() < 0.55) {
    const rw = 6, rh = 4;
    const x0 = 4 + Math.floor(rnd() * (world.w - rw - 8));
    const y0 = first + 1 + Math.floor(rnd() * Math.max(1, last - first - rh - 2));
    for (let y = y0 - 1; y <= y0 + rh; y++) {
      for (let x = x0 - 1; x <= x0 + rw; x++) {
        const inside = x >= x0 && x < x0 + rw && y >= y0 && y < y0 + rh;
        if (inside) { setT(world, x, y, T.AIR); setB(world, x, y, B.STONE); setD(world, x, y, D.NONE); }
        else setT(world, x, y, T.ROCK);
      }
    }
    setT(world, x0 + Math.floor(rw / 2), y0 + rh - 1, T.CHEST);
    setD(world, x0 + 1, y0, D.LAMP_DEAD);
    setD(world, x0 + rw - 2, y0 + rh - 1, D.BONES);
    world.rooms.push({ x0, y0, x1: x0 + rw, y1: y0 + rh, ambush: rnd() < 0.4 && band > 0, triggered: false });
  }
}

function buildBossCavern(world: World, rnd: () => number, band: number, bossIdx: number, r0: number) {
  const left = 8, right = world.w - 9;
  const top = r0 + 2, bottom = r0 + BAND - 2;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      setT(world, x, y, T.AIR);
      setB(world, x, y, B.METAL);
    }
  }
  // gantry posts along the walls
  for (let x = left + 3; x < right; x += 8) { setD(world, x, top, D.LAMP_DEAD); setD(world, x, bottom, D.BARREL); }
  void rnd;
  world.bossSites.push({ index: bossIdx, band, top, bottom, left, right, spawned: false, done: false });
}
