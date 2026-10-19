'use strict';
// Village mode, part 1: isometric projection, territory, the island terrain and the forest.
const TW = 64, TH = 32;          // isometric tile size in px
const GN = 87;                   // the island is GN x GN tiles
const MID = 43;                  // centre tile index (the Town Hall and the four lanes meet here)
const TERR_R = [12, 18, 25, 34, 43]; // territory radius (Chebyshev, in tiles) per expansion level

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sign = v => (v < 0 ? -1 : 1);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function vhash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Groves: a slow noise field. Dense stands where it is high, open meadow where it is low (used by the ground colour and the tree layout).
let _grove = null;
function groveAt(seed, i, j) {
  if (!_grove || _grove.seed !== seed) _grove = { seed, a: lat(9, seed + 61), b: lat(22, seed + 62) };
  const u = clamp(i / GN, 0, 0.999), v = clamp(j / GN, 0, 0.999);
  return sampleLat(_grove.a, 9, u, v) * 0.68 + sampleLat(_grove.b, 22, u, v) * 0.32;
}

// tile coords (float) <-> iso world px
const isoX = (i, j) => (i - j) * TW / 2;
const isoY = (i, j) => (i + j) * TH / 2;
function unIso(x, y) { const a = x / (TW / 2), b = y / (TH / 2); return { i: (a + b) / 2, j: (b - a) / 2 }; }

const inGrid = (i, j) => i >= 0 && j >= 0 && i < GN && j < GN;
// the four lanes (3 tiles wide) running from the centre to the island edges
const isRoad = (i, j) => (Math.abs(i - MID) <= 1 || Math.abs(j - MID) <= 1);

// ---------------------------------------------------------------- territory (what is not cloud-covered)
const Terr = {
  level: 1,
  get r() { return TERR_R[this.level - 1]; },
  has(i, j) { return Math.max(Math.abs(Math.floor(i) - MID), Math.abs(Math.floor(j) - MID)) <= this.r; },
  levelOf(i, j) { const d = Math.max(Math.abs(i - MID), Math.abs(j - MID)); for (let k = 0; k < TERR_R.length; k++) if (d <= TERR_R[k]) return k + 1; return 99; },
  // raids start just inside the cloud bank, on the four lanes
  spawnPoints() {
    const e = Math.min(this.r + 1.6, 30), lo = 0.8, hi = GN - 1.8;   // far-out raids start 30 tiles from the hall so they stay in view
    return [{ i: MID + 0.5, j: clamp(MID + 0.5 - e, lo, hi) }, { i: MID + 0.5, j: clamp(MID + 0.5 + e, lo, hi) },
      { i: clamp(MID + 0.5 - e, lo, hi), j: MID + 0.5 }, { i: clamp(MID + 0.5 + e, lo, hi), j: MID + 0.5 }];
  },
};

// ---------------------------------------------------------------- terrain
const lat = (n, seed) => { const a = new Float32Array((n + 2) * (n + 2)); for (let y = 0; y < n + 2; y++) for (let x = 0; x < n + 2; x++) a[y * (n + 2) + x] = vhash(x, y, seed); return a; };
function sampleLat(a, n, u, v) {      // u, v in [0,1]
  const x = u * n, y = v * n, xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, w = n + 2;
  const p = yi * w + xi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a0 = a[p], b0 = a[p + 1], c0 = a[p + w], d0 = a[p + w + 1];
  return a0 + (b0 - a0) * sx + (c0 - a0) * sy + (a0 - b0 - c0 + d0) * sx * sy;
}
const Ground = {
  strips: [], W: 0, H: 0, ox: 0, oy: 0, STRIP: 640,
  // The island is painted in horizontal strips (each a separate canvas): one canvas this big would break iOS's canvas size limit,
  // and strips also let the pixel pass walk only the diamond that is actually land.
  build(seed) {
    const W = GN * TW + 240, H = GN * TH + 320;
    this.W = W; this.H = H; this.ox = GN * TW / 2 + 120; this.oy = 120; this.strips = [];
    const ox = this.ox, oy = this.oy;
    const tp = (i, j) => [ox + isoX(i, j), oy + isoY(i, j)];
    const L1 = lat(8, seed + 1), L2 = lat(30, seed + 2), L3 = lat(120, seed + 3), L4 = lat(240, seed + 4);
    const GRASS = [[40, 62, 32], [66, 96, 44], [98, 130, 58], [134, 160, 76], [164, 178, 92]];
    const DIRT = [[108, 84, 58], [140, 112, 78], [168, 140, 100], [188, 164, 124]];
    const ramp = (R, t) => { t = clamp(t, 0, 0.999) * (R.length - 1); const k = t | 0, f = t - k, a = R[k], b = R[k + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
    for (let ys = 0; ys < H; ys += this.STRIP) {
      const h = Math.min(this.STRIP, H - ys), c = document.createElement('canvas'); c.width = W; c.height = h;
      const g = c.getContext('2d'); g.translate(0, -ys);
      this.cliffs(g, seed, tp, ys, ys + h);
      // ---- per-pixel meadow, forest floor and dirt lanes (value noise sampled from coarse lattices)
      const gc = document.createElement('canvas'); gc.width = W; gc.height = h;
      const gg = gc.getContext('2d'), img = gg.createImageData(W, h), d = img.data;
      for (let y = ys; y < ys + h; y++) {
        const py = y - oy, lo = Math.max(-2 * py, 2 * py - 64 * GN), hi = Math.min(2 * py, 64 * GN - 2 * py);
        if (hi < lo) continue;
        for (let x = Math.max(0, Math.floor(ox + lo)), xe = Math.min(W - 1, Math.ceil(ox + hi)); x <= xe; x++) {
          const px = x - ox;
          const fi = (px / 32 + py / 16) / 2, fj = (py / 16 - px / 32) / 2;
          if (fi < 0 || fj < 0 || fi >= GN || fj >= GN) continue;
          const u = fi / GN, v = fj / GN;
          const n1 = sampleLat(L1, 8, u, v), n2 = sampleLat(L2, 30, u, v), n3 = sampleLat(L3, 120, u, v), n4 = sampleLat(L4, 240, u, v);
          const dc = Math.max(Math.abs(fi - MID - 0.5), Math.abs(fj - MID - 0.5));
          const forest = smoothstep(8, 18, dc + (n2 - 0.5) * 6) * (0.25 + 0.75 * smoothstep(0.42, 0.62, groveAt(seed, fi, fj)));   // darker floor only under the groves
          // lane weight with organic edges
          const ld = Math.min(Math.abs(fi - MID - 0.5), Math.abs(fj - MID - 0.5));
          const plaza = smoothstep(4.6, 3.0, Math.hypot(fi - MID - 0.5, fj - MID - 0.5) + (n2 - 0.5) * 1.2);
          let rw = Math.max(smoothstep(0, 1, (1.5 + (n2 - 0.5) * 0.9 + (n3 - 0.5) * 0.35 - ld) / 0.5), plaza);
          // grass
          let t = 0.2 + n1 * 0.32 + n2 * 0.3 + n3 * 0.14 + n4 * 0.1 - forest * 0.2;
          let gcol = ramp(GRASS, t);
          if (forest > 0.35 && n2 > 0.62) { const k = (n2 - 0.62) * 2.4 * forest; gcol = [gcol[0] + (96 - gcol[0]) * k, gcol[1] + (78 - gcol[1]) * k, gcol[2] + (48 - gcol[2]) * k]; }  // leaf litter
          // dirt
          let dt = 0.25 + n2 * 0.4 + n3 * 0.2 + n4 * 0.2;
          let dcol = ramp(DIRT, dt);
          const rut = Math.abs(ld - 0.62) < 0.1 || Math.abs(ld - 0.0) < 0.12 ? 0.9 : 1;      // wheel ruts
          if (rw > 0.05) { const peb = vhash(x, y, seed + 9); if (peb > 0.992) dcol = [196, 190, 178]; else if (peb < 0.006) dcol = [84, 66, 46]; dcol = [dcol[0] * rut, dcol[1] * rut, dcol[2] * rut]; }
          const edge = smoothstep(0.1, 0.55, rw) * (1 - smoothstep(0.55, 0.95, rw));          // dry, trampled shoulder
          let col = [gcol[0] + (dcol[0] - gcol[0]) * rw, gcol[1] + (dcol[1] - gcol[1]) * rw, gcol[2] + (dcol[2] - gcol[2]) * rw];
          if (edge > 0) { col[0] += 10 * edge; col[1] += 6 * edge; col[2] -= 4 * edge; }
          const speck = (vhash(x, y, seed + 5) - 0.5) * 12;
          // soft ambient occlusion toward the island rim, slight sun from the upper left
          const rim = Math.min(fi, fj, GN - fi, GN - fj);
          const ao = 0.78 + 0.22 * smoothstep(0, 2.2, rim);
          const sun = 1.04 - (fi + fj) / (GN * 2) * 0.1;
          const k = ao * sun;
          const idx = ((y - ys) * W + x) * 4;
          d[idx] = clamp(col[0] * k + speck, 0, 255); d[idx + 1] = clamp(col[1] * k + speck, 0, 255); d[idx + 2] = clamp(col[2] * k + speck * 0.7, 0, 255);
          d[idx + 3] = clamp(rim * 40, 0, 255);
        }
      }
      gg.putImageData(img, 0, 0);
      g.drawImage(gc, 0, ys);
      this.details(g, seed, ox, oy, ys, ys + h);
      this.strips.push({ y: ys, h, canvas: c });
    }
  },
  // layered earth cliffs below the two front edges, with a grass fringe, strata, roots and a ragged bottom
  cliffs(g, seed, tp, y0, y1) {
    for (const edge of ['i', 'j']) {
      const lit = edge === 'j';
      for (let k = 0; k < GN; k++) {
        const a = edge === 'i' ? tp(GN, k) : tp(k, GN), b = edge === 'i' ? tp(GN, k + 1) : tp(k + 1, GN);
        if (Math.max(a[1], b[1]) + 90 < y0 || Math.min(a[1], b[1]) - 4 > y1) continue;      // belongs to another strip
        const depth = 34 + Math.round(vhash(k, edge === 'i' ? 1 : 2, seed) * 14) + Math.round(Math.sin(k * 0.35) * 5);
        const grad = g.createLinearGradient(0, a[1], 0, a[1] + depth);
        grad.addColorStop(0, lit ? '#8f7452' : '#6f563f'); grad.addColorStop(0.35, lit ? '#7a5f45' : '#5d4733'); grad.addColorStop(0.75, lit ? '#5a4535' : '#46372b'); grad.addColorStop(1, '#241c17');
        g.fillStyle = grad; g.beginPath(); g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        const steps = 5;
        for (let s = steps; s >= 0; s--) {
          const f = s / steps, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
          const jag = depth - 6 + Math.round((vhash(k * 7 + s, edge === 'i' ? 3 : 4, seed) - 0.5) * 14) - (s % 2) * 3;
          g.lineTo(x, y + jag);
        }
        g.closePath(); g.fill();
        // strata
        g.lineWidth = 1.2;
        for (let s = 0; s < 4; s++) {
          const yo = 6 + s * 8 + vhash(k, s, seed) * 4;
          g.strokeStyle = s % 2 ? 'rgba(30,20,14,.28)' : 'rgba(200,170,130,.16)';
          g.beginPath(); g.moveTo(a[0], a[1] + yo); g.lineTo(b[0], b[1] + yo + (vhash(k, s + 9, seed) - 0.5) * 3); g.stroke();
        }
        // pebbles and cracks
        for (let s = 0; s < 6; s++) {
          const f = vhash(k, s + 20, seed), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f + 6 + vhash(k, s + 30, seed) * (depth - 14);
          g.fillStyle = s % 2 ? 'rgba(20,14,10,.35)' : 'rgba(210,190,160,.22)'; g.beginPath(); g.ellipse(x, y, 1.5 + vhash(k, s + 40, seed) * 2.5, 1.2 + vhash(k, s + 50, seed), 0, 0, 6.283); g.fill();
        }
        // moss, grass fringe and hanging roots
        for (let s = 0; s < 8; s++) {
          const f = (s + vhash(k, s + 60, seed)) / 8, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
          const len = 3 + vhash(k, s + 70, seed) * 6;
          g.strokeStyle = vhash(k, s + 80, seed) > 0.5 ? '#4a7036' : '#5f8a40'; g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + (vhash(k, s + 90, seed) - 0.5) * 3, y + len); g.stroke();
          if (vhash(k, s + 100, seed) > 0.82) { g.strokeStyle = '#3a2a1e'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y + 4); g.quadraticCurveTo(x + 3, y + 12, x + (vhash(k, s, seed) - 0.5) * 8, y + 22 + vhash(k, s + 1, seed) * 10); g.stroke(); }
        }
        if (vhash(k, 111, seed) > 0.7) { g.fillStyle = 'rgba(76,110,52,.55)'; const f = vhash(k, 112, seed); g.beginPath(); g.ellipse(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f + 12, 6, 3.5, 0, 0, 6.283); g.fill(); }
      }
    }
  },
  // vector details on top of the pixel meadow: tufts, flowers, stones, mushrooms, fallen leaves
  details(g, seed, ox, oy, y0, y1) {
    const FL = ['#f4f0e0', '#f1d65a', '#c58ad8', '#e8847a', '#9cc4ee'];
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) {
      const dc = Math.max(Math.abs(i - MID - 0.5), Math.abs(j - MID - 0.5)), road = isRoad(i, j);
      const cx = ox + isoX(i + 0.5, j + 0.5), cy = oy + isoY(i + 0.5, j + 0.5);
      if (cy < y0 - 30 || cy > y1 + 30) continue;                       // belongs to another strip
      const forest = smoothstep(8, 18, dc) * (0.25 + 0.75 * smoothstep(0.42, 0.62, groveAt(seed, i + 0.5, j + 0.5)));
      const at = (s) => { const u = vhash(i * 3 + s, j, seed + 41) - 0.5, v = vhash(i, j * 3 + s, seed + 42) - 0.5; return [cx + (u - v) * TW * 0.5 * 0.9, cy + (u + v) * TH * 0.5 * 0.9]; };
      if (!road) {
        const nt = 3 + Math.floor(vhash(i, j, seed + 43) * 3);
        for (let s = 0; s < nt; s++) {                       // grass tufts: a fan of curved blades
          const [x, y] = at(s), h = 4 + vhash(i + s, j, seed + 44) * 5;
          for (let b = -1; b <= 1; b++) {
            g.strokeStyle = (b + s) % 2 ? 'rgba(52,88,38,.8)' : 'rgba(150,186,92,.75)'; g.lineWidth = 1.1;
            g.beginPath(); g.moveTo(x + b * 1.4, y); g.quadraticCurveTo(x + b * 2.4, y - h * 0.6, x + b * 3.4 + (b === 0 ? 0 : b * 0.8), y - h); g.stroke();
          }
        }
        if (forest < 0.5 && vhash(i, j, seed + 45) > 0.86) {  // wildflowers in the clearing
          const [x, y] = at(7), c = FL[Math.floor(vhash(i, j, seed + 46) * FL.length)];
          for (let f = 0; f < 3; f++) { g.fillStyle = c; g.beginPath(); g.arc(x + f * 2.6 - 2, y - f % 2 * 1.4, 1.5, 0, 6.283); g.fill(); g.fillStyle = 'rgba(40,70,30,.8)'; g.fillRect(x + f * 2.6 - 2.3, y - f % 2 * 1.4 + 1, 0.8, 2.5); }
        }
        if (forest > 0.3 && vhash(i, j, seed + 47) > 0.9) {   // leaf litter
          const [x, y] = at(8);
          for (let f = 0; f < 5; f++) { g.fillStyle = ['#8a5a2a', '#a8742e', '#6a4a28', '#b08a3a'][f % 4]; g.globalAlpha = 0.65; g.fillRect(x + f * 2 - 4, y + (f * 7 % 3) - 1, 2, 1.4); }
          g.globalAlpha = 1;
        }
        if (vhash(i, j, seed + 48) > 0.955) {                 // a stone with a highlight
          const [x, y] = at(9), r = 2.5 + vhash(i, j, seed + 49) * 3;
          g.fillStyle = 'rgba(20,28,14,.3)'; g.beginPath(); g.ellipse(x + 1, y + 1.5, r + 1, r * 0.55, 0, 0, 6.283); g.fill();
          g.fillStyle = '#7d8079'; g.beginPath(); g.ellipse(x, y, r, r * 0.65, 0, 0, 6.283); g.fill(); g.fillStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.2, r * 0.45, r * 0.25, 0, 0, 6.283); g.fill();
        }
        if (forest > 0.4 && vhash(i, j, seed + 50) > 0.985) {  // mushrooms
          const [x, y] = at(10); g.fillStyle = '#e8dcc0'; g.fillRect(x - 0.7, y - 3, 1.5, 3); g.fillStyle = '#c84a38'; g.beginPath(); g.ellipse(x, y - 3.4, 3, 1.8, 0, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.fillRect(x - 1, y - 4.2, 1, 1);
        }
      } else {
        // wheel ruts' pebbles and the occasional weed on the lane
        if (vhash(i, j, seed + 51) > 0.8) { const [x, y] = at(11); g.fillStyle = 'rgba(70,52,36,.5)'; g.fillRect(x, y, 3, 1); g.fillStyle = 'rgba(206,196,176,.7)'; g.fillRect(x + 4, y + 1, 2, 1.5); }
      }
    }
  },
  draw(ctx) {
    const c = UI.cam, z = c.zoom, top = c.y - UI.H / 2 / z + this.oy - 4, bot = c.y + UI.H / 2 / z + this.oy + 4;      // only strips on screen
    for (const s of this.strips) if (s.y < bot && s.y + s.h > top) ctx.drawImage(s.canvas, -this.ox, s.y - this.oy);
  },
};

// ---------------------------------------------------------------- trees
// Foliage is built from hundreds of small lit leaf clusters on a handful of canopy lobes, over a barked trunk
// with branches, so each species reads as a real tree rather than a flat ball.
const TREE_SPECIES = {
  oak: { trunk: [[104, 78, 56], [70, 52, 38], [40, 30, 22]], ramp: [[28, 50, 30], [48, 82, 38], [78, 118, 48], [116, 152, 66], [162, 188, 98]], lobes: 6, lobeR: [24, 31], w: 58, h: 46, cy: 112 },
  lime: { trunk: [[110, 86, 62], [76, 58, 42], [44, 33, 24]], ramp: [[40, 68, 30], [66, 100, 38], [104, 140, 50], [148, 176, 66], [196, 214, 112]], lobes: 5, lobeR: [22, 28], w: 50, h: 40, cy: 114 },
  autumn: { trunk: [[100, 76, 54], [68, 50, 36], [38, 28, 20]], ramp: [[80, 34, 20], [140, 64, 24], [196, 110, 30], [226, 158, 48], [244, 208, 98]], lobes: 6, lobeR: [23, 30], w: 54, h: 42, cy: 116 },
  olive: { trunk: [[104, 80, 58], [72, 54, 40], [42, 31, 22]], ramp: [[48, 58, 28], [88, 98, 40], [132, 140, 54], [176, 178, 76], [214, 212, 120]], lobes: 5, lobeR: [22, 28], w: 52, h: 40, cy: 114 },
  birch: { trunk: [[226, 222, 212], [168, 164, 156], [96, 92, 88]], ramp: [[54, 86, 40], [88, 128, 52], [128, 168, 66], [170, 202, 92], [214, 232, 140]], lobes: 5, lobeR: [18, 24], w: 46, h: 46, cy: 122, airy: true },
};
const Trees = {
  sprites: [], W: 180, H: 240, BX: 90, BY: 214,
  build() {
    const kinds = ['oak', 'oak', 'lime', 'olive', 'autumn', 'birch', 'oak', 'lime', 'olive', 'birch'];
    const raw = kinds.map((k, n) => this.broadleaf(k, 11 + n * 17)).concat([this.conifer(101, false), this.conifer(113, true), this.conifer(127, false)]);
    this.sprites = raw.map(c => this.crop(c));
  },
  // trim the transparent margin: drawing cost follows the destination rectangle, not the visible pixels
  crop(c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, o = document.createElement('canvas'); o.width = w; o.height = h;
    o.getContext('2d').drawImage(c, -x0, -y0);
    o.ox = x0 - this.BX; o.oy = y0 - this.BY;        // top-left of the visible part, relative to the trunk base
    return o;
  },
  newCanvas() { const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; const g = c.getContext('2d'); g.translate(this.BX, this.BY); return [c, g]; },
  shadow(g, rx) {
    const gr = g.createRadialGradient(10, 2, 2, 10, 2, rx);
    gr.addColorStop(0, 'rgba(8,18,8,.42)'); gr.addColorStop(0.6, 'rgba(8,18,8,.22)'); gr.addColorStop(1, 'rgba(8,18,8,0)');
    g.fillStyle = gr; g.save(); g.scale(1, 0.38); g.beginPath(); g.arc(10, 2 / 0.38, rx, 0, 6.283); g.fill(); g.restore();
  },
  trunk(g, sp, r, h, thick, lean) {
    const [lt, mid, dk] = sp.trunk, top = -h;
    // root flare + tapered trunk with a slight curve
    g.beginPath(); g.moveTo(-thick - 6, 3); g.quadraticCurveTo(-thick - 1, -8, -thick * 0.62, -20);
    g.quadraticCurveTo(-thick * 0.5 + lean * 0.4, -h * 0.55, -thick * 0.42 + lean, top);
    g.lineTo(thick * 0.42 + lean, top); g.quadraticCurveTo(thick * 0.5 + lean * 0.4, -h * 0.55, thick * 0.62, -20); g.quadraticCurveTo(thick + 1, -8, thick + 7, 3); g.closePath();
    const gr = g.createLinearGradient(-thick, 0, thick, 0); gr.addColorStop(0, `rgb(${lt})`); gr.addColorStop(0.5, `rgb(${mid})`); gr.addColorStop(1, `rgb(${dk})`);
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    for (let k = 0; k < 26; k++) {                                // bark furrows
      const x = (r() - 0.5) * thick * 1.9, y0 = -r() * h, len = 8 + r() * 22;
      g.strokeStyle = r() > 0.35 ? `rgba(${dk},.55)` : `rgba(${lt},.35)`; g.lineWidth = 0.9 + r() * 0.8;
      g.beginPath(); g.moveTo(x, y0); g.quadraticCurveTo(x + (r() - 0.5) * 3, y0 - len / 2, x + (r() - 0.5) * 2, y0 - len); g.stroke();
    }
    if (sp === TREE_SPECIES.birch) for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(30,28,26,.7)'; g.fillRect((r() - 0.5) * thick * 1.5, -r() * h, 2 + r() * 4, 1.4); }
    g.restore();
  },
  branch(g, sp, x0, y0, x1, y1, w) {
    g.strokeStyle = `rgb(${sp.trunk[1]})`; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (x1 - x0) * 0.1, (y0 + y1) / 2 - 6, x1, y1); g.stroke();
    g.strokeStyle = `rgba(${sp.trunk[2]},.6)`; g.lineWidth = w * 0.4; g.beginPath(); g.moveTo(x0 + 1, y0 + 1); g.quadraticCurveTo((x0 + x1) / 2 + 1, (y0 + y1) / 2 - 5, x1, y1 + 1); g.stroke();
  },
  broadleaf(kind, seed) {
    const sp = TREE_SPECIES[kind], r = mulberry(seed), [c, g] = this.newCanvas();
    this.shadow(g, 50);
    const th = 7 + r() * 3, cy0 = -sp.cy + 8, trunkH = -cy0 + 14 + r() * 6, lean = (r() - 0.5) * 8;
    this.trunk(g, sp, r, trunkH, th, lean);
    const CW = sp.w * 1.12, CH = sp.h * 1.1;                      // canopy ellipsoid radii
    const ramp = sp.ramp, rc = (t, a) => { t = clamp(t, 0, 0.999) * (ramp.length - 1); const k = t | 0, f = t - k, A = ramp[k], B = ramp[k + 1]; return `rgb(${(A[0] + (B[0] - A[0]) * f) | 0},${(A[1] + (B[1] - A[1]) * f) | 0},${(A[2] + (B[2] - A[2]) * f) | 0})`; };
    // lobes define a bumpy silhouette; many small ones merge into one mass
    const lobes = [], ringN = sp.airy ? 6 : 8, rj = r() * 6.283;
    const addLobe = (ang, d, k) => lobes.push({ x: lean + Math.cos(ang) * CW * d, y: cy0 - 2 + Math.sin(ang) * CH * d * 0.9, r: sp.lobeR[0] * (k + r() * 0.25) });
    for (let k = 0; k < 4; k++) addLobe(r() * 6.283, 0.05 + r() * 0.3, 0.95);                        // dense core
    for (let k = 0; k < ringN; k++) addLobe(rj + (k / ringN) * 6.283 + (r() - 0.5) * 0.45, 0.58 + r() * 0.2, 0.8);   // bumpy rim
    for (let k = 0; k < 4; k++) addLobe(rj + k * 1.6 + 0.7, 0.34 + r() * 0.18, 0.85);
    // limbs reaching up into the canopy (visible under the foliage)
    for (let k = 0; k < 4; k++) { const yb = -trunkH * (0.58 + k * 0.11); this.branch(g, sp, lean * 0.6, yb, lean + (k % 2 ? 1 : -1) * (12 + r() * 22), cy0 + 16 + r() * 18, 3.4 - k * 0.55); }
    // shaded interior first: big dark blobs show through the gaps between leaves
    for (const L of lobes) { g.fillStyle = rc(0.04 + r() * 0.1); g.beginPath(); g.ellipse(L.x, L.y + 3, L.r * 1.05, L.r * 0.95, 0, 0, 6.283); g.fill(); }
    // leaf clusters: back to front, lit by the canopy's own normal (light from the upper left)
    const total = sp.airy ? 560 : 900, pts = [];
    for (let k = 0; k < total; k++) {
      const L = lobes[Math.floor(r() * lobes.length)], a = r() * 6.283, d = Math.sqrt(r()) * L.r * 1.02;
      pts.push({ x: L.x + Math.cos(a) * d, y: L.y + Math.sin(a) * d * 0.92, lobe: L });
    }
    pts.sort((p, q) => (p.y + (r() - 0.5) * 6) - (q.y + (r() - 0.5) * 6));
    for (const p of pts) {
      const nx = clamp((p.x - lean) / CW, -1, 1), ny = clamp((p.y - cy0) / CH, -1, 1), nz = Math.sqrt(Math.max(0, 1 - nx * nx * 0.8 - ny * ny * 0.8));
      let lit = -nx * 0.5 - ny * 0.75 + nz * 0.5;                    // facing the sun
      const ll = ((p.y - p.lobe.y) / p.lobe.r) * -0.22 + ((p.x - p.lobe.x) / p.lobe.r) * -0.1;   // each lobe's own top is brighter
      const t = clamp(0.34 + lit * 0.5 + ll + (r() - 0.5) * 0.3, 0.03, 0.99);
      const sz = 2.2 + r() * 3.4, rot = r() * 3.14;
      g.fillStyle = rc(t); g.beginPath(); g.ellipse(p.x, p.y, sz, sz * 0.55, rot, 0, 6.283); g.fill();
      if (t > 0.66 && r() > 0.55) { g.fillStyle = rc(Math.min(0.99, t + 0.2)); g.beginPath(); g.ellipse(p.x - 0.8, p.y - 0.9, sz * 0.5, sz * 0.25, rot, 0, 6.283); g.fill(); }
    }
    // bright sun-kissed tips along the upper-left crown, and a few dangling leaves underneath
    for (let k = 0; k < 40; k++) { const a = Math.PI * (1.0 + r() * 0.65), L = lobes[Math.floor(r() * lobes.length)]; g.fillStyle = rc(0.82 + r() * 0.17); g.beginPath(); g.ellipse(L.x + Math.cos(a) * L.r * 0.92, L.y + Math.sin(a) * L.r * 0.82, 2 + r() * 1.5, 1.1, r(), 0, 6.283); g.fill(); }
    for (let k = 0; k < 26; k++) { const L = lobes[Math.floor(r() * lobes.length)], a = 0.3 + r() * 2.5; g.fillStyle = rc(0.08 + r() * 0.22); g.beginPath(); g.ellipse(L.x + Math.cos(a) * L.r * 0.95, L.y + Math.sin(a) * L.r * 0.9, 2.2, 1.3, r(), 0, 6.283); g.fill(); }
    return c;
  },
  conifer(seed, snowy) {
    const r = mulberry(seed), [c, g] = this.newCanvas();
    this.shadow(g, 34);
    const trunk = [[96, 72, 52], [64, 46, 32], [36, 26, 18]];
    this.trunk(g, { trunk }, r, 60, 5.5, (r() - 0.5) * 3);
    const ramp = [[22, 44, 34], [34, 68, 44], [54, 98, 56], [84, 132, 74], [128, 170, 106]];
    const rc = (t) => { t = clamp(t, 0, 0.999) * (ramp.length - 1); const k = t | 0, f = t - k, a = ramp[k], b = ramp[k + 1]; return `rgb(${(a[0] + (b[0] - a[0]) * f) | 0},${(a[1] + (b[1] - a[1]) * f) | 0},${(a[2] + (b[2] - a[2]) * f) | 0})`; };
    const tiers = 7;
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1), y = -36 - f * 118, reach = 38 - f * 30 + r() * 4, drop = 16 - f * 6;
      const nb = 16 - t;
      for (let side = 0; side < 2; side++) for (let k = 0; k < nb; k++) {
        const ang = (k / nb) * Math.PI * 0.96 + 0.05, dir = side ? -1 : 1;
        const bx = Math.cos(ang) * reach * dir * (0.4 + r() * 0.6), by = y + Math.sin(ang) * 3 + (1 - Math.abs(Math.cos(ang))) * 6;
        const ex = bx * 1.25, ey = by + drop * (0.5 + Math.abs(Math.cos(ang))) + r() * 4;
        // a drooping bough: a dark underside stroke, then lit needles along it
        g.strokeStyle = rc(0.12 + f * 0.1); g.lineWidth = 5.5 - f * 2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, y - 2); g.quadraticCurveTo(bx * 0.7, by - 6, ex, ey); g.stroke();
        const lit = clamp(0.5 + (dir < 0 ? 0.28 : -0.12) + (1 - f) * 0.04 + (r() - 0.5) * 0.3, 0.1, 0.95);
        g.strokeStyle = rc(lit); g.lineWidth = 3.4 - f * 1.2;
        g.beginPath(); g.moveTo(0, y - 3.5); g.quadraticCurveTo(bx * 0.7, by - 8.5, ex, ey - 2.2); g.stroke();
        for (let n = 0; n < 7; n++) { const u = 0.25 + n / 9, px = ex * u, py = lerp(y - 3, ey, u) - Math.sin(u * 3.14) * 5; g.strokeStyle = rc(clamp(lit + (r() - 0.5) * 0.25, 0.05, 0.98)); g.lineWidth = 0.9; g.beginPath(); g.moveTo(px, py); g.lineTo(px + dir * 1.5, py + 4 + r() * 2.5); g.moveTo(px, py); g.lineTo(px - dir * 1.2, py + 3.5); g.stroke(); }
      }
    }
    g.fillStyle = rc(0.8); g.beginPath(); g.moveTo(0, -176); g.lineTo(-5, -150); g.lineTo(5, -150); g.closePath(); g.fill();
    if (snowy) { g.globalAlpha = 0.0; }
    return c;
  },
  // deterministic forest layout: a wide clearing around the town hall, lanes kept open, then separate groves with open meadow between them
  // (a slow noise field decides where a grove stands; stray single trees fill in the meadow thinly)
  generate(seed) {
    const list = [];
    for (let i = 1; i < GN - 1; i++) for (let j = 1; j < GN - 1; j++) {
      if (isRoad(i, j)) continue;
      const d = Math.max(Math.abs(i - MID), Math.abs(j - MID));
      if (d < 9) continue;
      const grove = smoothstep(0.5, 0.64, groveAt(seed, i, j)), edgeFade = smoothstep(8.5, 15, d);
      const p = edgeFade * (0.012 + grove * (0.2 + vhash(i >> 2, j >> 2, seed + 21) * 0.17));
      if (vhash(i, j, seed + 5) < p) {
        const conifer = vhash(i >> 3, j >> 3, seed + 24) > 0.62 || vhash(i, j, seed + 8) > 0.9;
        list.push({
          i, j, v: conifer ? 10 + Math.floor(vhash(i, j, seed + 9) * 3) : Math.floor(vhash(i, j, seed + 9) * 10), s: 0.8 + vhash(i, j, seed + 2) * 0.3, alive: true,
          ox: (vhash(i, j, seed + 31) - 0.5) * 0.55, oj: (vhash(i, j, seed + 32) - 0.5) * 0.55, ph: vhash(i, j, seed + 33) * 6.28,
        });
      }
    }
    return list;
  },
  draw(ctx, t, time, sway) {
    const sp = this.sprites[t.v], sc = t.s * 0.72, x = isoX(t.i + 0.5 + t.ox, t.j + 0.5 + t.oj), y = isoY(t.i + 0.5 + t.ox, t.j + 0.5 + t.oj);
    if (t.fall) {                                   // a felled tree topples about its base, accelerating, and fades into the ground
      const f = clamp(t.fall.t / 0.95, 0, 1), ang = t.fall.dir * (f * f * 1.45 + Math.sin(f * 14) * 0.012 * (1 - f));
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = f > 0.72 ? 1 - (f - 0.72) / 0.28 : 1;
      ctx.drawImage(sp, sp.ox * sc, sp.oy * sc, sp.width * sc, sp.height * sc);
      ctx.restore(); return;
    }
    if (!sway && !t.shake) { ctx.drawImage(sp, x + sp.ox * sc, y + sp.oy * sc, sp.width * sc, sp.height * sc); return; }
    let sh = sway ? Math.sin(time * 1.1 + t.ph) * 0.012 + Math.sin(time * 2.3 + t.ph * 2) * 0.004 : 0;
    if (t.shake > 0) sh += Math.sin(time * 52) * t.shake * 0.11;      // each axe blow rattles the whole crown
    ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, sh, 1, 0, 0);
    ctx.drawImage(sp, sp.ox * sc, sp.oy * sc, sp.width * sc, sp.height * sc);
    ctx.restore();
  },
};
