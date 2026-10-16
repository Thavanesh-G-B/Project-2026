'use strict';
// Tile world: terrain definitions and procedural generation.
const T = 32;            // tile size in px
const WW = 320, WH = 84; // world size in tiles
const SURFACE = 26;      // average ground row

const TID = {
  AIR: 0, GRASS: 1, DIRT: 2, ROOTS: 3, STONE: 4, STONE2: 5, COBBLE: 6, COBBLE2: 7, IRON: 8, GOLD: 9,
  CRYSTAL: 10, BEDROCK: 11, TRUNK: 12, LEAVES: 13, CRATE: 14, MOSS: 15, VAULT: 16, BRICK: 17, PLANK: 18,
};
// spr: sprite name, solid, hard: seconds to mine at tool speed 1, drop: [item, min, max]
const TDEF = [];
function def(id, spr, solid, hard, drop, extra) { TDEF[id] = Object.assign({ spr, solid, hard, drop }, extra); }
def(TID.AIR, null, false, 0, null);
def(TID.GRASS, 'grass', true, 0.35, ['dirt', 1, 1]);
def(TID.DIRT, 'dirt', true, 0.3, ['dirt', 1, 1]);
def(TID.ROOTS, 'dirt_roots', true, 0.3, ['dirt', 1, 1]);
def(TID.STONE, 'stone', true, 0.8, ['stone', 1, 1]);
def(TID.STONE2, 'stone2', true, 0.8, ['stone', 1, 1]);
def(TID.COBBLE, 'cobble', true, 1.0, ['stone', 1, 1]);
def(TID.COBBLE2, 'cobble2', true, 1.0, ['stone', 1, 1]);
def(TID.IRON, 'ore_iron', true, 1.5, ['iron', 1, 2], { glow: 0 });
def(TID.GOLD, 'ore_gold', true, 2.0, ['gold', 1, 2], { glow: 0 });
def(TID.CRYSTAL, 'crystal', true, 1.3, ['crystal', 1, 2], { glow: 1 });
def(TID.BEDROCK, 'brick', true, Infinity, null);
def(TID.TRUNK, 'trunk', false, 0.6, ['wood', 1, 1]);
def(TID.LEAVES, 'leaves', false, 0.15, null, { foliage: true });
def(TID.CRATE, 'crate', true, 0.5, ['wood', 1, 2], { loot: true });
def(TID.MOSS, 'mossrock', true, 0.9, ['stone', 1, 2]);
def(TID.VAULT, 'crate_open', true, Infinity, null, { vault: true });
def(TID.BRICK, 'brick', true, 1.2, ['brick', 1, 1]);
def(TID.PLANK, 'crate', true, 0.5, ['wood', 1, 1]);

// ---- deterministic helpers
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

class World {
  constructor(seed) {
    this.seed = seed;
    this.w = WW; this.h = WH;
    this.t = new Uint8Array(WW * WH);
    this.surf = new Int16Array(WW);
    this.seen = new Uint8Array(WW * WH);   // minimap discovery
    this.vaults = [];
    this.spawn = { x: (WW >> 1) * T + T / 2, y: 0 };
    this.generate();
  }

  get(x, y) {
    if (x < 0 || x >= WW || y >= WH) return TID.BEDROCK;
    if (y < 0) return TID.AIR;
    return this.t[y * WW + x];
  }
  set(x, y, v) { if (x >= 0 && x < WW && y >= 0 && y < WH) this.t[y * WW + x] = v; }
  solid(x, y) { return TDEF[this.get(x, y)].solid; }
  inBounds(x, y) { return x >= 0 && x < WW && y >= 0 && y < WH; }

  carveCircle(cx, cy, r) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 2 || x >= WW - 2 || y < 2 || y >= WH - 2) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r && this.get(x, y) !== TID.BEDROCK && this.get(x, y) !== TID.VAULT)
          this.set(x, y, TID.AIR);
      }
  }

  generate() {
    const rng = mulberry32(this.seed);
    const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
    const mid = WW >> 1;
    // --- terrain heights
    for (let x = 0; x < WW; x++) {
      let h = SURFACE + 4 * Math.sin(x * 0.045 + ph[0]) + 3 * Math.sin(x * 0.11 + ph[1]) + 1.5 * Math.sin(x * 0.27 + ph[2]);
      const k = Math.min(1, Math.abs(x - mid) / 16);
      h = SURFACE * (1 - k) + h * k;
      this.surf[x] = Math.round(h);
    }
    // --- fill ground
    for (let x = 0; x < WW; x++) {
      const s = this.surf[x], dirtDepth = 4 + Math.floor(rng() * 3);
      for (let y = s; y < WH; y++) {
        let id;
        if (y >= WH - 2) id = TID.BEDROCK;
        else if (y === s) id = TID.GRASS;
        else if (y < s + dirtDepth) id = rng() < 0.25 ? TID.ROOTS : TID.DIRT;
        else { const r = rng(); id = r < 0.55 ? TID.STONE : r < 0.8 ? TID.STONE2 : r < 0.92 ? TID.COBBLE : TID.COBBLE2; }
        this.set(x, y, id);
      }
    }
    // --- caves: noise pockets, worm tunnels and shafts down from the surface
    for (let y = 10; y < WH - 3; y++)
      for (let x = 2; x < WW - 2; x++) {
        const d = y - this.surf[x];
        if (d < 9) continue;
        const n = vnoise(x * 0.065, y * 0.085, this.seed) * 0.65 + vnoise(x * 0.16, y * 0.2, this.seed + 7) * 0.35;
        if (n > 0.635 + (d < 15 ? 0.05 : 0)) this.set(x, y, TID.AIR);
      }
    for (let i = 0; i < 16; i++) {
      let x = 10 + rng() * (WW - 20), y = SURFACE + 14 + rng() * (WH - SURFACE - 24);
      let ang = rng() * 6.28, r = 1.3 + rng() * 1;
      for (let s = 0; s < 70; s++) {
        this.carveCircle(x, y, r);
        ang += (rng() - 0.5) * 0.7;
        x += Math.cos(ang) * 1.4; y += Math.sin(ang) * 0.8;
        if (this.get(Math.floor(x), Math.floor(y) - 6) !== TID.AIR && Math.floor(y) < this.surf[Math.min(WW - 1, Math.max(0, Math.floor(x)))] + 10) y += 1;
      }
    }
    for (let i = 0; i < 9; i++) {
      let x = 20 + (i + 0.5) * (WW - 40) / 9 + (rng() - 0.5) * 10;
      if (Math.abs(x - mid) < 8) x += 18;
      const bottom = this.surf[Math.floor(x)] + 14 + Math.floor(rng() * 6);
      for (let y = this.surf[Math.floor(x)]; y < bottom; y++) { x += (rng() - 0.5) * 0.5; this.carveCircle(x, y, 1.4); }
    }
    // --- ores (crystals prefer cave walls)
    const nearAir = (x, y) => !this.solid(x + 1, y) || !this.solid(x - 1, y) || !this.solid(x, y + 1) || !this.solid(x, y - 1);
    const isStone = id => id >= TID.STONE && id <= TID.COBBLE2;
    const cluster = (x, y, id, n) => {
      for (let i = 0; i < n; i++) {
        const cx = x + Math.floor(rng() * 3) - 1, cy = y + Math.floor(rng() * 3) - 1;
        if (isStone(this.get(cx, cy))) this.set(cx, cy, id);
      }
    };
    for (let y = 12; y < WH - 3; y++)
      for (let x = 2; x < WW - 2; x++) {
        if (!isStone(this.get(x, y))) continue;
        const d = y - this.surf[x], r = rng();
        if (d > 22 && r < 0.010) cluster(x, y, TID.GOLD, 4);
        else if (d > 5 && r < 0.020) cluster(x, y, TID.IRON, 5);
        else if (d > 10 && nearAir(x, y) && r < 0.05) cluster(x, y, TID.CRYSTAL, 2);
      }
    // --- surface decoration: trees, boulders, crates (kept clear of the spawn point)
    let nextTree = 5;
    for (let x = 4; x < WW - 6; x++) {
      if (Math.abs(x - mid) < 7) continue;
      const g = this.surf[x];
      if (x >= nextTree && Math.abs(this.surf[x + 1] - g) <= 1 && Math.abs(this.surf[x - 1] - g) <= 1) {
        const th = 4 + Math.floor(rng() * 3);
        for (let i = 1; i <= th; i++) this.set(x, g - i, TID.TRUNK);
        for (let dy = -2; dy <= 0; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) === 2 && dy !== -1) continue;
            if (this.get(x + dx, g - th + dy) === TID.AIR) this.set(x + dx, g - th + dy, TID.LEAVES);
          }
        nextTree = x + 6 + Math.floor(rng() * 6);
      } else if (rng() < 0.03) {
        this.set(x, g - 1, TID.MOSS);
        if (rng() < 0.4) this.set(x + 1, g - 1, TID.MOSS);
      } else if (rng() < 0.012) {
        this.set(x, g - 1, TID.CRATE);
      }
    }
    for (let i = 0, tries = 0; i < 26 && tries < 4000; tries++) {
      const x = 4 + Math.floor(rng() * (WW - 8)), y = SURFACE + 12 + Math.floor(rng() * (WH - SURFACE - 16));
      if (this.get(x, y) === TID.AIR && this.solid(x, y + 1) && this.get(x, y + 1) !== TID.BEDROCK) { this.set(x, y, TID.CRATE); i++; }
    }
    // --- vaults: unbreakable brick rooms with a locked door and a short tunnel to it
    for (let i = 0, tries = 0; i < 3 && tries < 200; tries++) {
      const iw = 7, ih = 4;
      const left = 20 + Math.floor(rng() * (WW - 50)), top = SURFACE + 22 + Math.floor(rng() * (WH - SURFACE - 36));
      if (this.vaults.some(v => Math.abs(v.x - left) < 40)) continue;
      const dir = rng() < 0.5 ? -1 : 1;
      for (let y = top - 1; y <= top + ih; y++)
        for (let x = left - 1; x <= left + iw; x++) {
          const edge = y === top - 1 || y === top + ih || x === left - 1 || x === left + iw;
          this.set(x, y, edge ? TID.BEDROCK : TID.AIR);
        }
      const dx = dir < 0 ? left - 1 : left + iw;
      this.set(dx, top + ih - 1, TID.VAULT); this.set(dx, top + ih - 2, TID.VAULT);
      for (let k = 1; k <= 7; k++) for (let h = 1; h <= 2; h++) this.set(dx + dir * k, top + ih - h, TID.AIR);
      for (const cx of [2, 4, 6]) this.set(left + cx, top + ih - 1, TID.CRATE);
      this.vaults.push({ x: left, y: top, w: iw, h: ih, door: { x: dx, y: top + ih - 1 }, opened: false });
      i++;
    }
    this.spawn.y = this.surf[mid] * T;
  }

  // Mark tiles near (cx, cy) as seen for the minimap.
  reveal(cx, cy, r) {
    for (let y = Math.max(0, cy - r); y <= Math.min(WH - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(WW - 1, cx + r); x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) this.seen[y * WW + x] = 1;
  }
  revealAll() { this.seen.fill(1); }
}
