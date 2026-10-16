'use strict';
// Block art. Terrain textures are generated procedurally (periodic noise, so they tile without
// seams, with 4 variants per block). Ore/crystal overlays and the foliage/crate/boulder tiles
// come from the reference sheet. Every solid block gets neighbour-aware edge lighting: an outline
// plus a highlight/shadow wherever it borders air, and grass caps on exposed grass.
const TileArt = (() => {
  const S = T;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));
  const add = (c, k) => [clamp255(c[0] + k), clamp255(c[1] + k), clamp255(c[2] + k)];

  // periodic value noise with n lattice cells across the tile
  function pn(x, y, n, seed) {
    const cs = S / n, gx = x / cs, gy = y / cs, xi = Math.floor(gx), yi = Math.floor(gy), xf = gx - xi, yf = gy - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a, b) => hash2(((a % n) + n) % n, ((b % n) + n) % n, seed);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y, seed) => pn(x, y, 4, seed) * 0.55 + pn(x, y, 8, seed + 11) * 0.3 + pn(x, y, 16, seed + 23) * 0.15;

  function paint(fn) {
    const c = mk(), g = c.getContext('2d'), img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const p = fn(x, y), i = (y * S + x) * 4;
      img.data[i] = p[0]; img.data[i + 1] = p[1]; img.data[i + 2] = p[2]; img.data[i + 3] = p[3] === undefined ? 255 : p[3];
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------- base textures
  function dirt(seed, roots) {
    const rootPx = new Set();
    if (roots) for (let k = 0; k < 3; k++) {
      let x = hash2(k, 1, seed) * S, y = hash2(k, 2, seed) * 6, a = 1.2 + hash2(k, 3, seed) * 0.8;
      for (let t = 0; t < 30; t++) { rootPx.add((((Math.round(x) % S) + S) % S) + ',' + Math.round(y)); x += Math.cos(a); y += Math.sin(a); a += (hash2(k, t + 5, seed) - 0.5) * 0.9; }
    }
    return paint((x, y) => {
      const n = fbm(x, y, seed), h = hash2(x, y, seed + 9);
      let c = [121, 78, 47];
      if (n < 0.4) c = [100, 63, 39]; else if (n > 0.64) c = [142, 95, 58];
      if (h > 0.985) c = [168, 120, 80]; else if (h < 0.02) c = [82, 52, 32];
      if (pn(x, y, 8, seed + 5) > 0.86 && h > 0.6) c = [146, 132, 118];
      if (rootPx.has(x + ',' + y)) c = [64, 39, 23];
      return c;
    });
  }
  function stone(seed, cracks) {
    return paint((x, y) => {
      const n = fbm(x, y, seed), h = hash2(x, y, seed + 3);
      let c = [88, 94, 108];
      if (n < 0.38) c = [73, 79, 94]; else if (n > 0.62) c = [104, 111, 126];
      if (h > 0.975) c = [126, 133, 148]; else if (h < 0.02) c = [56, 60, 74];
      if (Math.abs(pn(x, y, 4, seed + 7) - 0.5) < (cracks ? 0.03 : 0.011)) c = [52, 56, 70];
      return c;
    });
  }
  // periodic Voronoi cobblestones; tone shifts the palette (wall variant is darker and bluer)
  function cobble(seed, tone, mortar) {
    const pts = [];
    for (let gx = 0; gx < 2; gx++) for (let gy = 0; gy < 2; gy++) pts.push([gx * 16 + 3 + hash2(gx, gy, seed) * 10, gy * 16 + 3 + hash2(gx, gy, seed + 1) * 10]);
    return paint((x, y) => {
      let d1 = 1e9, d2 = 1e9, id = 0;
      for (let i = 0; i < pts.length; i++) for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const d = Math.hypot(x - (pts[i][0] + ox), y - (pts[i][1] + oy));
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1;
      if (edge < 2.2) return mortar;
      const t = hash2(id, 3, seed), h = hash2(x, y, seed + 4);
      let c = add(tone, Math.round(t * 16 - 8));
      if (edge < 4.2) c = add(c, -12);               // stones get darker toward the seams
      if (x % S < 16 && y % S < 16 && edge > 6) c = add(c, 5);
      if (h > 0.96) c = add(c, 12); else if (h < 0.04) c = add(c, -12);
      return c;
    });
  }
  function bricks(seed, base, mortar) {
    return paint((x, y) => {
      const row = Math.floor(y / 8), off = (row % 2) * 8, lx = (x + off) % 16, ly = y % 8;
      if (ly === 7 || lx === 15) return mortar;
      const id = hash2(row, Math.floor((x + off) / 16), seed);
      let c = add(base, Math.round((id - 0.5) * 18));
      if (ly === 0) c = add(c, 16); else if (ly === 6) c = add(c, -12);
      if (hash2(x, y, seed + 2) > 0.95) c = add(c, 10);
      return c;
    });
  }
  function planks(seed) {
    return paint((x, y) => {
      const ly = y % 8, board = Math.floor(y / 8);
      if (ly === 7) return [112, 74, 38];
      let c = [184, 132, 74];
      c = add(c, Math.round((hash2(board, 1, seed) - 0.5) * 20));
      if (ly === 0) c = add(c, 14);
      if (Math.abs(pn(x * 0.5 + board * 7, y * 2, 4, seed) - 0.5) < 0.05) c = add(c, -16); // grain
      if ((x === 3 || x === 28) && (ly === 3)) c = [84, 54, 28];                           // nails
      return c;
    });
  }
  function vaultDoor() {
    return paint((x, y) => {
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (edge < 2) return edge === 0 ? [150, 112, 30] : [236, 196, 78];
      if ((x === 4 || x === S - 5) && (y === 4 || y === S - 5)) return [255, 226, 130];     // rivets
      let c = x % 8 === 0 ? [40, 43, 58] : [58, 62, 82];
      if (Math.hypot(x - 15.5, y - 13) < 4.2) c = [20, 20, 30];                               // keyhole
      if (x >= 14 && x <= 17 && y >= 14 && y <= 21) c = [20, 20, 30];
      if (Math.hypot(x - 15.5, y - 13) < 5.6 && Math.hypot(x - 15.5, y - 13) >= 4.2) c = [236, 196, 78];
      return c;
    });
  }

  // ---------------------------------------------------------------- tile registry
  const NV = 4;
  const bases = [];   // bases[id] = [canvas x NV]
  function overlay(base, name) {
    const f = SPRITES.world[name], g = base.getContext('2d');
    g.drawImage(Assets.world, f[0], f[1], f[2], f[3], 0, 0, S, S);
    return base;
  }
  function build() {
    const v = fn => Array.from({ length: NV }, (_, i) => fn(i * 101 + 7));
    bases[TID.GRASS] = v(s => dirt(s, false));
    bases[TID.DIRT] = v(s => dirt(s, false));
    bases[TID.ROOTS] = v(s => dirt(s, true));
    bases[TID.STONE] = v(s => stone(s, false));
    bases[TID.STONE2] = v(s => stone(s + 50, true));
    bases[TID.COBBLE] = v(s => cobble(s, [92, 98, 112], [48, 52, 66]));
    bases[TID.COBBLE2] = v(s => cobble(s + 30, [84, 90, 106], [44, 48, 62]));
    bases[TID.IRON] = v(s => overlay(stone(s + 9, false), 'o_iron'));
    bases[TID.GOLD] = v(s => overlay(stone(s + 17, true), 'o_gold'));
    bases[TID.CRYSTAL] = v(s => overlay(stone(s + 23, false), 'o_crystal'));
    bases[TID.BEDROCK] = v(s => bricks(s, [50, 52, 74], [20, 20, 32]));
    bases[TID.BRICK] = v(s => bricks(s, [118, 98, 112], [58, 46, 58]));
    bases[TID.PLANK] = v(s => planks(s));
    bases[TID.VAULT] = [vaultDoor()];
    walls.length = 0;
    for (let i = 0; i < NV; i++) walls.push(cobble(i * 71 + 5, [32, 34, 54], [18, 19, 31]));
  }
  const walls = [];
  const edged = new Map();

  // bit mask of exposed sides: 1 up, 2 down, 4 left, 8 right
  function grassCap(g, seed, m) {
    const paintPx = (x, y, depth, jag) => {
      const c = y === 0 ? [142, 216, 78] : y < depth - 1 ? (hash2(x, y, seed) > 0.7 ? [110, 196, 62] : [84, 170, 52]) : [56, 120, 40];
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(x, y, 1, 1);
    };
    if (m & 1) for (let x = 0; x < S; x++) {
      const d = 4 + Math.floor(hash2(x, 1, seed) * 3) + (x % 7 === 3 ? 2 : 0);
      for (let y = 0; y < d; y++) paintPx(x, y, d);
    }
    if (m & 4) for (let y = 0; y < S; y++) { const d = 2 + Math.floor(hash2(1, y, seed) * 2); for (let x = 0; x < d; x++) { const c = x === 0 ? [118, 200, 66] : [76, 150, 48]; g.fillStyle = `rgb(${c})`; g.fillRect(x, y, 1, 1); } }
    if (m & 8) for (let y = 0; y < S; y++) { const d = 2 + Math.floor(hash2(2, y, seed) * 2); for (let x = 0; x < d; x++) { const c = x === 0 ? [118, 200, 66] : [76, 150, 48]; g.fillStyle = `rgb(${c})`; g.fillRect(S - 1 - x, y, 1, 1); } }
  }
  function finish(id, variant, m) {
    const key = id * 256 + variant * 16 + m;
    let c = edged.get(key);
    if (c) return c;
    c = mk();
    const g = c.getContext('2d'), base = bases[id][variant % bases[id].length];
    g.drawImage(base, 0, 0);
    if (id === TID.GRASS) grassCap(g, variant * 13 + 3, m);
    const shade = (a, x, y, w, h) => { g.fillStyle = a; g.fillRect(x, y, w, h); };
    if (m & 1) { shade('rgba(255,255,255,.20)', 0, 1, S, 2); }
    if (m & 4) { shade('rgba(255,255,255,.10)', 1, 0, 1, S); }
    if (m & 2) { shade('rgba(0,0,0,.22)', 0, S - 5, S, 3); shade('rgba(0,0,0,.20)', 0, S - 3, S, 2); }
    if (m & 8) { shade('rgba(0,0,0,.18)', S - 3, 0, 2, S); }
    const ol = 'rgba(8,6,16,.62)';                                            // outline on exposed sides
    if (m & 1) shade(ol, 0, 0, S, 1);
    if (m & 2) shade(ol, 0, S - 1, S, 1);
    if (m & 4) shade(ol, 0, 0, 1, S);
    if (m & 8) shade(ol, S - 1, 0, 1, S);
    // round off corners where two exposed sides meet
    if ((m & 1) && (m & 4)) g.clearRect(0, 0, 1, 1);
    if ((m & 1) && (m & 8)) g.clearRect(S - 1, 0, 1, 1);
    if ((m & 2) && (m & 4)) g.clearRect(0, S - 1, 1, 1);
    if ((m & 2) && (m & 8)) g.clearRect(S - 1, S - 1, 1, 1);
    edged.set(key, c);
    return c;
  }

  // wall (background) with ambient-occlusion shadows next to solid blocks; m = solid neighbours
  function wallTile(variant, m) {
    const key = 1e6 + variant * 16 + m;
    let c = edged.get(key);
    if (c) return c;
    c = mk();
    const g = c.getContext('2d');
    g.drawImage(walls[variant % NV], 0, 0);
    const ao = (x0, y0, x1, y1, x2, y2, x3, y3) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x2, y2, x3, y3);
    };
    if (m & 1) ao(0, 0, 0, 9, 0, 0, S, 9);
    if (m & 2) ao(0, S, 0, S - 7, 0, S - 7, S, 7);
    if (m & 4) ao(0, 0, 9, 0, 0, 0, 9, S);
    if (m & 8) ao(S, 0, S - 9, 0, S - 9, 0, 9, S);
    edged.set(key, c);
    return c;
  }

  return {
    build,
    draw(ctx, id, x, y, tx, ty, m) {
      const b = bases[id];
      if (!b) return false;
      ctx.drawImage(finish(id, hash2(tx, ty, 7) * NV | 0, id === TID.VAULT ? 0 : m), x, y);
      return true;
    },
    wall(ctx, x, y, tx, ty, m) { ctx.drawImage(wallTile(hash2(tx, ty, 5) * NV | 0, m), x, y); },
    // a block icon (HUD, pickups) drawn as a free-standing block
    icon(ctx, id, cx, cy, size) { ctx.drawImage(finish(id, 0, 15), cx - size / 2, cy - size / 2, size, size); },
  };
})();
