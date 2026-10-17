'use strict';
// Village mode, part 1: isometric projection, the island terrain and the forest.
const TW = 64, TH = 32;          // isometric tile size in px
const GN = 45;                   // island is GN x GN tiles
const MID = (GN - 1) / 2;        // centre tile index (22)

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sign = v => (v < 0 ? -1 : 1);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
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

// tile coords (float) <-> iso world px
const isoX = (i, j) => (i - j) * TW / 2;
const isoY = (i, j) => (i + j) * TH / 2;
function unIso(x, y) { const a = x / (TW / 2), b = y / (TH / 2); return { i: (a + b) / 2, j: (b - a) / 2 }; }

const inGrid = (i, j) => i >= 0 && j >= 0 && i < GN && j < GN;
// the four lanes (3 tiles wide) running from the centre to the island edges
const isRoad = (i, j) => (Math.abs(i - MID) <= 1 || Math.abs(j - MID) <= 1);
const SPAWN_POINTS = [
  { i: MID, j: 0.6 }, { i: MID, j: GN - 1.6 }, { i: 0.6, j: MID }, { i: GN - 1.6, j: MID },
];

// ---------------------------------------------------------------- terrain
const Ground = {
  canvas: null, ox: 0, oy: 0,
  build(seed) {
    const W = GN * TW + 240, H = GN * TH + 300;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    this.canvas = c; this.ox = GN * TW / 2 + 120; this.oy = 120;
    const tp = (i, j) => [this.ox + isoX(i, j), this.oy + isoY(i, j)];
    const diamond = (i, j, col) => {
      const t = tp(i, j), r = tp(i + 1, j), b = tp(i + 1, j + 1), l = tp(i, j + 1);
      g.fillStyle = col; g.beginPath(); g.moveTo(t[0], t[1]); g.lineTo(r[0] + 0.6, r[1]); g.lineTo(b[0], b[1] + 0.6); g.lineTo(l[0] - 0.6, l[1]); g.closePath(); g.fill();
    };
    // cliffs under the two visible edges
    for (let k = 0; k < GN; k++) {
      for (const edge of ['i', 'j']) {
        const i = edge === 'i' ? GN - 1 : k, j = edge === 'j' ? GN - 1 : k;
        const a = edge === 'i' ? tp(GN, k) : tp(k, GN), b = edge === 'i' ? tp(GN, k + 1) : tp(k + 1, GN);
        const depth = 26 + Math.round(vhash(k, edge === 'i' ? 1 : 2, seed) * 8);
        const grad = g.createLinearGradient(0, a[1], 0, a[1] + depth);
        const lit = edge === 'j';
        grad.addColorStop(0, lit ? '#8a6d4e' : '#6d5440'); grad.addColorStop(0.5, lit ? '#6a5240' : '#54402f'); grad.addColorStop(1, '#2d241d');
        g.fillStyle = grad; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0], b[1] + depth); g.lineTo(a[0], a[1] + depth); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
        for (let s = 0; s < 3; s++) { const x = a[0] + (b[0] - a[0]) * (0.2 + 0.3 * s + vhash(k, s, seed) * 0.1); g.beginPath(); g.moveTo(x, a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]))); g.lineTo(x, a[1] + depth - 4 - vhash(k, s + 9, seed) * 8); g.stroke(); }
      }
    }
    // tiles
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) {
      const n = vhash(i, j, seed), n2 = vhash(i >> 2, j >> 2, seed + 3);
      let col;
      if (isRoad(i, j)) {
        const k = Math.round(n * 14 - 7);
        col = `rgb(${142 + k},${118 + k},${88 + k})`;
      } else {
        const k = Math.round((n - 0.5) * 14 + (n2 - 0.5) * 16);
        col = `rgb(${88 + k},${118 + k},${66 + Math.round(k * 0.6)})`;
      }
      diamond(i, j, col);
    }
    // soften the road edges and add texture: grass tufts, pebbles, ruts
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) {
      const cx = this.ox + isoX(i + 0.5, j + 0.5), cy = this.oy + isoY(i + 0.5, j + 0.5);
      const road = isRoad(i, j);
      for (let s = 0; s < 6; s++) {
        const r1 = vhash(i * 7 + s, j, seed + 11), r2 = vhash(i, j * 5 + s, seed + 13);
        const u = (r1 - 0.5) * 0.9, v = (r2 - 0.5) * 0.9;
        const px = cx + (u - v) * TW / 2, py = cy + (u + v) * TH / 2;
        if (road) {
          if (s < 2) { g.fillStyle = 'rgba(88,70,50,.35)'; g.fillRect(px, py, 2, 1); }
          else if (s === 2 && r1 > 0.6) { g.fillStyle = 'rgba(190,176,150,.55)'; g.fillRect(px, py, 2, 1); }
        } else {
          g.strokeStyle = s % 2 ? 'rgba(52,84,44,.55)' : 'rgba(132,164,92,.45)'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + (r1 - 0.5) * 3, py - 2 - r2 * 3); g.stroke();
        }
      }
      // grass creeping over the road shoulders
      if (road) {
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (inGrid(i + di, j + dj) && !isRoad(i + di, j + dj)) {
            g.fillStyle = 'rgba(96,126,70,.55)';
            const ex = cx + (di - dj) * TW / 4, ey = cy + (di + dj) * TH / 4;
            for (let s = 0; s < 4; s++) { const o = (s - 1.5) * 0.18; g.fillRect(ex + (-dj - di * 0) * o * TW / 2 + (vhash(i, j + s, seed) - 0.5) * 6, ey + (vhash(j, i + s, seed) - 0.5) * 3, 3, 2); }
          }
        }
      }
    }
    // rim light along the cliff edge
    g.strokeStyle = 'rgba(190,210,140,.35)'; g.lineWidth = 2;
    g.beginPath(); const a = tp(GN, 0), b = tp(GN, GN), c2 = tp(0, GN);
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c2[0], c2[1]); g.stroke();
  },
  draw(ctx, cam) {
    ctx.drawImage(this.canvas, -this.ox, -this.oy);
  },
};

// ---------------------------------------------------------------- trees
const TREE_PAL = [
  [[128, 160, 84], [88, 124, 60], [54, 86, 46]],     // fresh green
  [[104, 144, 80], [70, 110, 58], [42, 76, 46]],     // deep green
  [[178, 172, 94], [136, 134, 68], [94, 94, 52]],    // autumn olive
  [[150, 160, 84], [108, 128, 62], [68, 94, 46]],    // yellow green
];
const rgbS = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const Trees = {
  sprites: [],
  build() {
    const mk = (draw) => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 150;
      const g = c.getContext('2d'); g.translate(60, 130); draw(g); return c;
    };
    const oak = (pal, seed) => mk(g => {
      const r = mulberry(seed);
      g.fillStyle = 'rgba(10,20,10,.28)'; g.beginPath(); g.ellipse(2, 2, 30, 12, 0, 0, 6.283); g.fill();
      // trunk
      const tw = 9 + r() * 3;
      g.fillStyle = '#5a4030'; g.beginPath(); g.moveTo(-tw / 2 - 2, 2); g.lineTo(-tw / 2, -40); g.lineTo(tw / 2, -40); g.lineTo(tw / 2 + 3, 2); g.closePath(); g.fill();
      g.fillStyle = '#3e2c22'; g.beginPath(); g.moveTo(1, 2); g.lineTo(1, -40); g.lineTo(tw / 2, -40); g.lineTo(tw / 2 + 3, 2); g.closePath(); g.fill();
      // canopy blobs
      const blobs = [];
      for (let k = 0; k < 9; k++) { const a = r() * 6.283, d = k === 0 ? 0 : 10 + r() * 14; blobs.push([Math.cos(a) * d * 1.15, -62 + Math.sin(a) * d * 0.8 - (k === 0 ? 4 : 0), 15 + r() * 8]); }
      blobs.sort((p, q) => p[1] - q[1]);
      for (const [x, y, rad] of blobs) {
        const gr = g.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
        gr.addColorStop(0, rgbS(pal[0])); gr.addColorStop(0.55, rgbS(pal[1])); gr.addColorStop(1, rgbS(pal[2]));
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill();
      }
      // leaf speckle
      for (let k = 0; k < 90; k++) {
        const a = r() * 6.283, d = Math.sqrt(r()) * 30, x = Math.cos(a) * d * 1.1, y = -62 + Math.sin(a) * d * 0.75;
        g.fillStyle = r() > 0.5 ? rgbS(pal[0]) : rgbS(pal[2]); g.globalAlpha = 0.55; g.fillRect(x, y, 2, 2);
      }
      g.globalAlpha = 1;
    });
    const pine = (seed) => mk(g => {
      const r = mulberry(seed);
      g.fillStyle = 'rgba(10,20,10,.28)'; g.beginPath(); g.ellipse(2, 2, 22, 9, 0, 0, 6.283); g.fill();
      g.fillStyle = '#4a352a'; g.fillRect(-3, -14, 6, 16);
      const tiers = 4, base = [[46, 80, 52], [64, 104, 62], [34, 62, 44]];
      for (let t = 0; t < tiers; t++) {
        const y = -12 - t * 19, w = 26 - t * 4.5, h = 30;
        g.fillStyle = rgbS(base[2]); g.beginPath(); g.moveTo(0, y - h); g.lineTo(w + 2, y); g.lineTo(-w - 2, y); g.closePath(); g.fill();
        g.fillStyle = rgbS(base[1]); g.beginPath(); g.moveTo(0, y - h); g.lineTo(-w - 2, y); g.lineTo(-2, y - 2); g.closePath(); g.fill();
        g.fillStyle = rgbS(base[0]); g.beginPath(); g.moveTo(0, y - h); g.lineTo(w + 2, y); g.lineTo(3, y - 2); g.closePath(); g.fill();
        for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(150,190,110,.35)'; g.fillRect((r() - 0.5) * w * 1.3, y - r() * h * 0.8, 2, 1); }
      }
    });
    this.sprites = [oak(TREE_PAL[0], 1), oak(TREE_PAL[1], 2), oak(TREE_PAL[2], 3), oak(TREE_PAL[3], 4), oak(TREE_PAL[0], 5), pine(6), pine(7), oak(TREE_PAL[2], 8)];
  },
  // deterministic forest layout: a clearing around the town hall, roads kept open
  generate(seed) {
    const list = [];
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) {
      if (isRoad(i, j)) continue;
      const d = Math.max(Math.abs(i - MID), Math.abs(j - MID));
      if (d < 7) continue;
      const clump = vhash(i >> 2, j >> 2, seed + 21);
      const p = clamp((d - 7) / 6, 0, 1) * (0.35 + clump * 0.55);
      if (vhash(i, j, seed + 5) < p) list.push({
        i, j, v: Math.floor(vhash(i, j, seed + 9) * this.sprites.length), s: 0.88 + vhash(i, j, seed + 2) * 0.28, alive: true,
        ox: (vhash(i, j, seed + 31) - 0.5) * 0.5, oj: (vhash(i, j, seed + 32) - 0.5) * 0.5,
      });
    }
    return list;
  },
  draw(ctx, t) {
    const sp = this.sprites[t.v], x = isoX(t.i + 0.5 + t.ox, t.j + 0.5 + t.oj), y = isoY(t.i + 0.5 + t.ox, t.j + 0.5 + t.oj);
    const sway = Math.sin(performance.now() / 1300 + t.i * 0.7 + t.j) * 0.6;
    ctx.drawImage(sp, x - 60 * t.s + sway, y - 130 * t.s + 14, 120 * t.s, 150 * t.s);
  },
};
