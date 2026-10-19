/**
 * Deterministic planet generation. A world is a WORLD_W x (SURFACE_ROW + depthRows)
 * tile grid: sky above, a landing pad on the surface, ore-bearing crust, hazard
 * pockets, enemy nests, flashcard vaults and a sealed boss cavern at the bottom.
 */
import { PlanetDef, SURFACE_ROW, T, WORLD_W } from './balance';

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

export interface World {
  w: number;
  h: number;
  tiles: Uint8Array;
  padX0: number; // pad covers tile columns [padX0, padX1] on row SURFACE_ROW
  padX1: number;
  bossTop: number; // first row of the boss cavern
  bossLeft: number;
  bossRight: number;
  nests: Array<{ x: number; y: number }>;
}

export const idx = (w: World, x: number, y: number) => y * w.w + x;
export const inBounds = (w: World, x: number, y: number) => x >= 0 && y >= 0 && x < w.w && y < w.h;
export const tileAt = (w: World, x: number, y: number): number =>
  inBounds(w, x, y) ? w.tiles[idx(w, x, y)] : T.BEDROCK;

function setIfDiggable(w: World, x: number, y: number, t: number) {
  if (!inBounds(w, x, y)) return;
  const cur = w.tiles[idx(w, x, y)];
  if (cur === T.BEDROCK || cur === T.AIR) return;
  w.tiles[idx(w, x, y)] = t;
}

function carveBlob(w: World, cx: number, cy: number, rx: number, ry: number, fill: number) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1 && inBounds(w, x, y)) {
        if (y > SURFACE_ROW + 1 && x > 0 && x < w.w - 1 && y < w.h - 1) {
          const cur = w.tiles[idx(w, x, y)];
          if (cur !== T.BEDROCK) w.tiles[idx(w, x, y)] = fill;
        }
      }
    }
  }
}

export function generateWorld(planet: PlanetDef, seed: number): World {
  const rnd = mulberry32(seed * 7919 + planet.id * 104729);
  const h = SURFACE_ROW + planet.depthRows;
  const world: World = {
    w: WORLD_W,
    h,
    tiles: new Uint8Array(WORLD_W * h),
    padX0: WORLD_W / 2 - 3,
    padX1: WORLD_W / 2 + 2,
    bossTop: h - 13,
    bossLeft: 10,
    bossRight: WORLD_W - 11,
    nests: [],
  };

  // Crust: dirt, with rock increasing with depth.
  for (let y = SURFACE_ROW; y < h; y++) {
    const depth = y - SURFACE_ROW;
    const t = depth / planet.depthRows;
    for (let x = 0; x < WORLD_W; x++) {
      let tile: number = T.DIRT;
      const rockP = Math.min(0.55, 0.04 + t * 0.55);
      if (depth > 3 && rnd() < rockP) tile = T.ROCK;
      if (depth > 2 && rnd() < 0.065 + (1 - t) * 0.03) tile = T.SCRAP;
      if (depth > 8 && rnd() < 0.014 + t * 0.03) tile = T.CRYSTAL;
      if (depth > 24 && rnd() < 0.003 + t * 0.012) tile = T.CORE;
      world.tiles[idx(world, x, y)] = tile;
    }
  }
  // Unbreakable side walls and floor.
  for (let y = 0; y < h; y++) {
    world.tiles[idx(world, 0, y)] = y >= SURFACE_ROW ? T.BEDROCK : T.AIR;
    world.tiles[idx(world, WORLD_W - 1, y)] = y >= SURFACE_ROW ? T.BEDROCK : T.AIR;
  }
  for (let x = 0; x < WORLD_W; x++) world.tiles[idx(world, x, h - 1)] = T.BEDROCK;
  // Landing pad plating on the surface.
  for (let x = world.padX0; x <= world.padX1; x++) world.tiles[idx(world, x, SURFACE_ROW)] = T.BEDROCK;

  // Caves (open pockets with a rich vein hugging one edge).
  const caves = Math.round(planet.depthRows / 7);
  for (let i = 0; i < caves; i++) {
    const cy = SURFACE_ROW + 8 + rnd() * (planet.depthRows - 26);
    const cx = 4 + rnd() * (WORLD_W - 8);
    const rx = 1.8 + rnd() * 2.6;
    const ry = 1.2 + rnd() * 1.6;
    carveBlob(world, cx, cy, rx, ry, T.AIR);
    if (rnd() < 0.7) carveBlob(world, cx + rx + 1, cy, 1.2, 1.2, rnd() < 0.5 ? T.CRYSTAL : T.SCRAP);
  }

  // Hazard pockets (gas / lava): blobs of hazard tiles you can dig around or through.
  const hazards = Math.round(planet.depthRows / 9);
  for (let i = 0; i < hazards; i++) {
    const cy = SURFACE_ROW + 12 + rnd() * (planet.depthRows - 30);
    const cx = 4 + rnd() * (WORLD_W - 8);
    carveBlob(world, cx, cy, 1.5 + rnd() * 1.4, 1.2 + rnd(), T.HAZARD);
  }

  // Enemy nests, each sitting in a tiny cavity.
  const nests = Math.round(planet.depthRows / 8);
  for (let i = 0; i < nests; i++) {
    const nx = 4 + Math.floor(rnd() * (WORLD_W - 8));
    const ny = SURFACE_ROW + 10 + Math.floor(rnd() * (planet.depthRows - 28));
    if (tileAt(world, nx, ny) === T.AIR) continue;
    world.tiles[idx(world, nx, ny)] = T.NEST;
    world.nests.push({ x: nx, y: ny });
  }

  // Flashcard vault crates, buried in rock.
  const vaults = 5;
  for (let i = 0; i < vaults; i++) {
    const vx = 4 + Math.floor(rnd() * (WORLD_W - 8));
    const vy = SURFACE_ROW + 14 + Math.floor(((i + rnd()) / vaults) * (planet.depthRows - 32));
    world.tiles[idx(world, vx, vy)] = T.VAULT;
  }

  // Boss cavern: wide open room with a bedrock rim, entered through the rock above.
  for (let y = world.bossTop; y < h - 1; y++) {
    for (let x = world.bossLeft; x <= world.bossRight; x++) {
      world.tiles[idx(world, x, y)] = T.AIR;
    }
  }
  for (let x = world.bossLeft - 1; x <= world.bossRight + 1; x++) {
    world.tiles[idx(world, x, world.bossTop - 1)] = T.ROCK;
  }
  for (let y = world.bossTop; y < h - 1; y++) {
    world.tiles[idx(world, world.bossLeft - 1, y)] = T.BEDROCK;
    world.tiles[idx(world, world.bossRight + 1, y)] = T.BEDROCK;
  }

  // Keep the first few metres under the pad dirt-only and safe.
  for (let y = SURFACE_ROW + 1; y < SURFACE_ROW + 5; y++) {
    for (let x = 1; x < WORLD_W - 1; x++) {
      const cur = world.tiles[idx(world, x, y)];
      if (cur === T.HAZARD || cur === T.NEST || cur === T.VAULT) setIfDiggable(world, x, y, T.DIRT);
    }
  }
  return world;
}
