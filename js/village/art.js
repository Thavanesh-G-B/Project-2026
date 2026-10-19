'use strict';
// Village mode, part 3: procedural isometric building sprites (cached per type / level).
// Local coordinates: tile units relative to the footprint centre; z is pixels of height.
const P = (a, b, z) => ({ x: (a - b) * TW / 2, y: (a + b) * TH / 2 - (z || 0) });
const shade = (c, k) => `rgb(${clamp(Math.round(c[0] * k), 0, 255)},${clamp(Math.round(c[1] * k), 0, 255)},${clamp(Math.round(c[2] * k), 0, 255)})`;
function poly(g, pts, fill, stroke, lw) {
  g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); }
}
// draw fn in a face's own texture space (tw x th px), mapped onto the parallelogram
function onFace(g, clipPts, origin, hv, vv, tw, th, fn) {
  g.save();
  g.beginPath(); g.moveTo(clipPts[0].x, clipPts[0].y); for (let i = 1; i < clipPts.length; i++) g.lineTo(clipPts[i].x, clipPts[i].y); g.closePath(); g.clip();
  g.transform(hv.x / tw, hv.y / tw, vv.x / th, vv.y / th, origin.x, origin.y);
  fn(g, tw, th);
  g.restore();
}
// textured box. tex.l / tex.r: (g, tw, th, k) painters for the two visible faces; deco likewise for doors/windows.
function cuboid(g, a0, b0, a1, b1, z0, z1, base, tex, deco) {
  const top = [P(a0, b0, z1), P(a1, b0, z1), P(a1, b1, z1), P(a0, b1, z1)];
  const L = [P(a0, b1, z1), P(a1, b1, z1), P(a1, b1, z0), P(a0, b1, z0)];
  const R = [P(a1, b0, z1), P(a1, b1, z1), P(a1, b1, z0), P(a1, b0, z0)];
  poly(g, L, shade(base, 0.96)); poly(g, R, shade(base, 0.7)); poly(g, top, shade(base, 1.14));
  const th = z1 - z0;
  const lw = (a1 - a0) * 26, rw = (b1 - b0) * 26;
  if (tex && tex.l) onFace(g, L, L[0], { x: (a1 - a0) * 32, y: (a1 - a0) * 16 }, { x: 0, y: th }, lw, th, (c, w, h) => tex.l(c, w, h, 0.96));
  if (tex && tex.r) onFace(g, R, R[0], { x: -(b1 - b0) * 32, y: (b1 - b0) * 16 }, { x: 0, y: th }, rw, th, (c, w, h) => tex.r(c, w, h, 0.7));
  if (deco && deco.l) onFace(g, L, L[0], { x: (a1 - a0) * 32, y: (a1 - a0) * 16 }, { x: 0, y: th }, lw, th, deco.l);
  if (deco && deco.r) onFace(g, R, R[0], { x: -(b1 - b0) * 32, y: (b1 - b0) * 16 }, { x: 0, y: th }, rw, th, deco.r);
  g.strokeStyle = 'rgba(10,12,14,.38)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(L[1].x, L[1].y); g.lineTo(L[2].x, L[2].y); g.stroke();
  poly(g, top, null, 'rgba(255,255,255,.18)');
  poly(g, L, null, 'rgba(0,0,0,.25)'); poly(g, R, null, 'rgba(0,0,0,.3)');
}
function roof(g, a0, b0, a1, b1, z, apex, col, ridge) {
  const cx = (a0 + a1) / 2, cb = (b0 + b1) / 2, ap = P(cx, cb, apex);
  const C = P(a1, b1, z), D = P(a0, b1, z), B = P(a1, b0, z), A = P(a0, b0, z);
  poly(g, [A, B, ap], shade(col, 0.82)); poly(g, [A, D, ap], shade(col, 0.9));
  poly(g, [D, C, ap], shade(col, 1.05)); poly(g, [B, C, ap], shade(col, 0.74));
  g.lineWidth = 1;
  for (let t = 0.18; t < 0.95; t += 0.18) {
    g.strokeStyle = 'rgba(0,0,0,.22)';
    g.beginPath(); g.moveTo(D.x + (ap.x - D.x) * t, D.y + (ap.y - D.y) * t); g.lineTo(C.x + (ap.x - C.x) * t, C.y + (ap.y - C.y) * t); g.stroke();
    g.beginPath(); g.moveTo(B.x + (ap.x - B.x) * t, B.y + (ap.y - B.y) * t); g.lineTo(C.x + (ap.x - C.x) * t, C.y + (ap.y - C.y) * t); g.stroke();
  }
  poly(g, [D, C, ap], null, 'rgba(0,0,0,.3)'); poly(g, [B, C, ap], null, 'rgba(0,0,0,.35)');
  if (ridge) { g.strokeStyle = ridge; g.lineWidth = 2; g.beginPath(); g.moveTo(D.x, D.y); g.lineTo(ap.x, ap.y); g.lineTo(B.x, B.y); g.stroke(); g.beginPath(); g.moveTo(C.x, C.y); g.lineTo(ap.x, ap.y); g.stroke(); }
  return ap;
}

// ---- face textures
const stoneTex = (base, seed) => (g, w, h, k) => {
  const r = mulberry(seed);
  g.fillStyle = shade(base, k * 0.55); g.fillRect(0, 0, w, h);
  for (let y = 0, row = 0; y < h; y += 8, row++) {
    const off = row % 2 ? 7 : 0;
    for (let x = -off; x < w; x += 14) { g.fillStyle = shade(base, k * (0.86 + r() * 0.26)); g.fillRect(x + 0.6, y + 0.6, 12.8, 6.8); }
  }
  g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 0, w, 2);
};
const plankTex = (base, seed) => (g, w, h, k) => {
  const r = mulberry(seed);
  for (let x = 0; x < w; x += 6) { g.fillStyle = shade(base, k * (0.88 + r() * 0.24)); g.fillRect(x, 0, 5.2, h); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + 5.2, 0, 0.8, h); }
};
const logTex = (base, seed) => (g, w, h, k) => {
  const r = mulberry(seed);
  for (let y = 0; y < h; y += 7) {
    g.fillStyle = shade(base, k * (0.86 + r() * 0.2)); g.fillRect(0, y, w, 6.4);
    g.fillStyle = 'rgba(255,230,180,.16)'; g.fillRect(0, y, w, 1.5);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y + 6.4, w, 0.8);
  }
};
const plasterTex = (base, seed) => (g, w, h, k) => {
  const r = mulberry(seed);
  g.fillStyle = shade(base, k); g.fillRect(0, 0, w, h);
  for (let n = 0; n < 40; n++) { g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`; g.fillRect(r() * w, r() * h, 2 + r() * 5, 1.5); }
};
const arch = (g, x, y, w, h, fill) => {
  g.fillStyle = fill; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill();
};
const windowDeco = (x, y, w, h, glow) => (g) => {
  g.fillStyle = '#2a2018'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle = glow || '#e8b85a'; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + w / 2 - 0.5, y, 1, h); g.fillRect(x, y + h / 2 - 0.5, w, 1);
};

const STONE = [128, 126, 116], STONE_D = [98, 98, 96], WOOD = [150, 106, 66], WOOD_D = [112, 78, 48];
const TRIM = [[168, 120, 76], [168, 178, 196], [236, 192, 72]];     // per level: bronze, steel, gold
const ROOFC = [[160, 82, 58], [74, 104, 140], [138, 52, 70]];

// ---- reference-sheet sprites (tools/extract_buildings.py): every building that has one is drawn from the atlas.
const BLD = {
  img: null,
  load() { return new Promise((res, rej) => { const i = new Image(); i.onload = () => { this.img = i; res(); }; i.onerror = () => rej(new Error('Could not load bld.png')); i.src = 'assets/sprites/bld.png'; }); },
  f(k) { return window.BLD_ATLAS.frames[k]; },
};
// type -> per level [sprite, target height in px]. The width is always capped to the footprint (w + d) * 32 so a building
// never spills over its neighbours; `lift` pulls the sprite's front corner in from the footprint's front corner.
const BSPR = {
  townhall:   { lv: [['hall_timber', 215], ['hall_timber_2', 225], ['hall_timber_3', 235]], lift: 0.16 },
  barracks:   { lv: [['hall_stone', 150], ['hall_stone_2', 156], ['hall_stone_3', 162]], lift: 0.12 },
  archer:     { lv: [['archer_c', 140], ['archer_c_2', 150], ['archer_c_3', 160]], lift: 0.12 },
  magetower:  { lv: [['mage_c', 150], ['mage_c_2', 157], ['mage_c_3', 165]], lift: 0.14, glow: [[0.5, 0.1, [120, 200, 255]], [0.5, 0.1, [190, 130, 255]], [0.5, 0.1, [255, 190, 90]]] },
  cannon:     { lv: [['cannon_b', 120], ['cannon_b_2', 128], ['cannon_b_3', 136]], lift: 0.12 },
  mortar:     { lv: [['cannon_a', 100], ['cannon_a_2', 106], ['cannon_a_3', 112]], lift: 0.12 },
  goldmine:   { lv: [['mine_gold', 94], ['mine_gold_2', 98], ['mine_gold_3', 102]], lift: 0.1 },
  lumbercamp: { lv: [['lumber', 100], ['lumber_2', 106], ['lumber_3', 112]], lift: 0.1 },
  storage:    { lv: [['farm', 92], ['farm_2', 96], ['farm_3', 100]], lift: 0.1 },
  builderhut: { lv: [['house_b', 105]], lift: 0.12 },
  tesla:      { lv: [['tesla', 132]], lift: 0.12, glow: [0.5, 0.06, [130, 210, 255]] },
  academy:    { lv: [['house_a', 124]], lift: 0.12 },
  market:     { lv: [['h_thatch', 104]], lift: 0.1 },
  shrine:     { lv: [['mage_spiral', 150], ['mage_spiral_2', 157], ['mage_spiral_3', 165]], lift: 0.14, glow: [[0.5, 0.04, [130, 220, 255]], [0.5, 0.04, [130, 255, 160]], [0.5, 0.04, [255, 220, 120]]] },
};

const BART = {
  cache: new Map(),
  fromAtlas(type, L) {
    const m = BSPR[type], [key, th] = m.lv[Math.min(L, m.lv.length) - 1], F = BLD.f(key), def = BDEF[type];
    // the scale comes from the base picture, so a level that adds flags or stacked goods is drawn at the same size as its plain version
    const FB = BLD.f(key.replace(/_[23]$/, '')), [fx, fy, fw, fh] = F, sc = Math.min(th / FB[3], (def.w + def.d) * 32 / fw);
    const W = Math.ceil(fw * sc) + 24, H = Math.ceil(fh * sc) + 16;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(BLD.img, fx, fy, fw, fh, 12, 4, fw * sc, fh * sc);
    // ox: horizontal centre; oy: distance from the canvas top to the footprint centre. The sprite's bottom corner sits on the
    // footprint's front corner (half a diamond below its centre), pulled in a little by `lift`.
    const half = (def.w + def.d) * 8, front = half * (1 - (m.lift || 0));
    const out = { canvas: c, ox: W / 2, oy: H - 4 - front, sprite: key, scale: sc };
    if (m.glow) { const gl = Array.isArray(m.glow[0]) ? m.glow[Math.min(L, m.glow.length) - 1] : m.glow; out.glow = { x: 0, y: -(H - 4 - front) + 4 + fh * sc * gl[1], color: gl[2] }; }
    return out;
  },
  // returns {canvas, ox, oy, flag?, turret?}; draw at (centreX - ox, centreY - oy)
  get(type, level, mask) {
    const key = type + level + (mask || 0);
    let s = this.cache.get(key);
    if (!s) { s = this.make(type, level, mask || 0); this.cache.set(key, s); }
    return s;
  },
  canvasFor(w, d, up) {
    const W = (w + d) * 32 + 48, H = up + (w + d) * 8 + 24;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.translate(W / 2, up + 6 + 0);
    return { c, g, ox: W / 2, oy: up + 6 };
  },
  shadow(g, w, d) {
    g.fillStyle = 'rgba(16,24,14,.2)'; g.beginPath(); g.ellipse(2, 3 + (w + d) * 2, (w + d) * 14, (w + d) * 6.5, 0, 0, 6.283); g.fill();
  },
  make(type, L, mask) {
    if (BSPR[type] && BLD.img) return this.fromAtlas(type, L);
    const def = BDEF[type] || { w: 2, d: 2 };
    const up = type === 'townhall' ? 150 : (type === 'archer' || type === 'magetower') ? 130 : 96;
    const { c, g, ox, oy } = this.canvasFor(def.w, def.d, up);
    const out = { canvas: c, ox, oy };
    const trim = TRIM[L - 1], rc = ROOFC[L - 1];
    if (type !== 'wall' && type !== 'trap' && type !== 'garden' && type !== 'lantern') this.shadow(g, def.w, def.d);
    switch (type) {
      case 'townhall': {
        cuboid(g, -1.5, -1.5, 1.5, 1.5, 0, 8, STONE_D, { l: stoneTex(STONE_D, 1), r: stoneTex(STONE_D, 2) });
        const towers = [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].sort((p, q) => (p[0] + p[1]) - (q[0] + q[1]));
        const drawTower = ([a, b]) => {
          cuboid(g, a - 0.3, b - 0.3, a + 0.3, b + 0.3, 8, 52, STONE, { l: stoneTex(STONE, 3), r: stoneTex(STONE, 4) });
          roof(g, a - 0.38, b - 0.38, a + 0.38, b + 0.38, 52, 76, rc);
        };
        drawTower(towers[0]); drawTower(towers[1]);
        cuboid(g, -1.05, -1.05, 1.05, 1.05, 8, 46, STONE, { l: stoneTex(STONE, 5), r: stoneTex(STONE, 6) }, {
          l: (c2, w, h) => { windowDeco(w * 0.2, 6, 6, 11)(c2); windowDeco(w * 0.72, 6, 6, 11)(c2); arch(c2, w * 0.43, h - 24, 12, 24, '#1c1510'); c2.fillStyle = shade(trim, 1); c2.fillRect(w * 0.43 - 1, h - 26, 14, 2); },
          r: (c2, w, h) => { windowDeco(w * 0.25, 8, 6, 11)(c2); windowDeco(w * 0.65, 8, 6, 11)(c2); c2.fillStyle = shade(trim, 0.9); c2.fillRect(0, h - 5, w, 2); },
        });
        const ap = roof(g, -1.18, -1.18, 1.18, 1.18, 46, 98, rc, shade(trim, 1));
        drawTower(towers[2]); drawTower(towers[3]);
        out.flag = { x: ap.x, y: ap.y - 4, h: 30, color: L === 1 ? '#c9953a' : L === 2 ? '#4aa0d8' : '#e8c24a' };
        break;
      }
      case 'goldmine': {
        const r = mulberry(11 + L);
        const blob = (x, y, rx, ry, col) => { const gr = g.createRadialGradient(x - rx * 0.3, y - ry * 0.4, 2, x, y, rx); gr.addColorStop(0, shade(col, 1.25)); gr.addColorStop(1, shade(col, 0.7)); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 6.283); g.fill(); };
        const rock = [118, 108, 96];
        blob(-14, -4, 36, 22, shade2(rock, 0.8)); blob(10, -20, 34, 28, rock); blob(-8, -34, 24, 22, shade2(rock, 1.1)); blob(24, -4, 20, 14, shade2(rock, 0.9));
        for (let k = 0; k < 7; k++) { g.fillStyle = k % 2 ? '#e8c14a' : '#c9962c'; g.beginPath(); g.arc(-26 + r() * 62, -10 - r() * 40, 2 + r() * 2.5, 0, 6.283); g.fill(); }
        // mine entrance: timber frame
        g.fillStyle = '#17110c'; g.beginPath(); g.ellipse(6, -8, 13, 15, 0, 0, 6.283); g.fill();
        g.fillStyle = shade(WOOD, 1); g.fillRect(-8, -26, 5, 28); g.fillRect(14, -26, 5, 28); g.fillRect(-10, -29, 32, 5);
        g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-8, -26, 1.5, 28); g.fillRect(14, -26, 1.5, 28);
        // cart with gold
        g.fillStyle = '#5c3e26'; poly(g, [{ x: 28, y: 8 }, { x: 50, y: 18 }, { x: 50, y: 30 }, { x: 28, y: 20 }], '#6a482c', '#2a1c10');
        poly(g, [{ x: 28, y: 8 }, { x: 28, y: 20 }, { x: 8, y: 12 }, { x: 8, y: 0 }], '#7a5434', '#2a1c10');
        for (let k = 0; k < 8 + L * 3; k++) { g.fillStyle = k % 3 ? '#f1cd5a' : '#d9a737'; g.beginPath(); g.arc(14 + r() * 28, 4 + r() * 8 + (r() - 0.5) * 4, 3 + r() * 1.6, 0, 6.283); g.fill(); }
        g.fillStyle = '#222'; g.beginPath(); g.arc(30, 24, 4, 0, 6.283); g.arc(48, 30, 4, 0, 6.283); g.fill();
        if (L >= 2) { g.fillStyle = shade(trim, 1); g.fillRect(-12, -33, 36, 3); }
        if (L >= 3) { g.fillStyle = '#ffe9a0'; g.beginPath(); g.arc(24, -30, 3.5, 0, 6.283); g.fill(); }
        break;
      }
      case 'lumbercamp': {
        cuboid(g, -0.95, -0.95, 0.35, 0.35, 0, 20, WOOD, { l: logTex(WOOD, 7), r: logTex(WOOD_D, 8) }, {
          l: (c2, w, h) => { windowDeco(w * 0.15, 5, 7, 8, '#f0c860')(c2); arch(c2, w * 0.58, h - 16, 9, 16, '#241810'); },
          r: (c2, w, h) => { windowDeco(w * 0.4, 5, 6, 8, '#d8a850')(c2); },
        });
        roof(g, -1.1, -1.1, 0.5, 0.5, 20, 44, [110, 76, 50], shade(trim, 0.9));
        // log pile + axe stump
        for (let row = 0; row < 3; row++) for (let k = 0; k < 3 - row; k++) {
          const x = 22 + k * 11 + row * 5.5, y = 22 - row * 8;
          g.fillStyle = '#7a5434'; g.fillRect(x - 12, y - 4, 14, 8);
          g.fillStyle = '#c8a070'; g.beginPath(); g.ellipse(x + 2, y, 3.5, 4, 0, 0, 6.283); g.fill(); g.strokeStyle = '#8a6240'; g.beginPath(); g.arc(x + 2, y, 1.6, 0, 6.283); g.stroke();
        }
        g.fillStyle = '#6c4a2e'; g.beginPath(); g.ellipse(-6, 34, 8, 4, 0, 0, 6.283); g.fill(); g.fillRect(-14, 24, 16, 10);
        g.fillStyle = '#c8a070'; g.beginPath(); g.ellipse(-6, 24, 8, 4, 0, 0, 6.283); g.fill();
        g.strokeStyle = '#4a3220'; g.lineWidth = 2; g.beginPath(); g.moveTo(-6, 24); g.lineTo(-1, 12); g.stroke(); g.fillStyle = '#c9d0d6'; g.fillRect(-8, 10, 8, 4);
        if (L >= 2) { g.fillStyle = shade(trim, 1); g.fillRect(-26, 8, 3, 18); }
        break;
      }
      case 'storage': {
        cuboid(g, -0.9, -0.9, 0.9, 0.9, 0, 26, STONE, { l: stoneTex(STONE, 9), r: stoneTex(STONE, 10) }, {
          l: (c2, w, h) => { c2.fillStyle = shade(trim, 1); c2.fillRect(0, h * 0.42, w, 3); arch(c2, w * 0.36, h - 20, 16, 20, '#2b2118'); c2.fillStyle = shade(trim, 1.1); c2.fillRect(w * 0.36 + 7, h - 12, 2, 4); },
          r: (c2, w, h) => { c2.fillStyle = shade(trim, 0.9); c2.fillRect(0, h * 0.42, w, 3); },
        });
        cuboid(g, -1.0, -1.0, 1.0, 1.0, 26, 32, trim.map(v => v * 0.82), null);
        cuboid(g, -0.55, -0.55, 0.55, 0.55, 32, 40, [96, 90, 84], { l: stoneTex(STONE_D, 11), r: stoneTex(STONE_D, 12) });
        g.fillStyle = shade(trim, 1); g.beginPath(); g.arc(0, P(0, 0, 46).y, 5 + L, 0, 6.283); g.fill();
        // barrels
        for (const [bx, by] of [[34, 20], [44, 26]]) { g.fillStyle = '#7a5434'; g.fillRect(bx - 6, by - 10, 12, 14); g.fillStyle = '#3a2a1a'; g.fillRect(bx - 6, by - 6, 12, 1.6); g.fillRect(bx - 6, by, 12, 1.6); g.fillStyle = '#9a7048'; g.beginPath(); g.ellipse(bx, by - 10, 6, 3, 0, 0, 6.283); g.fill(); }
        break;
      }
      case 'archer': {
        cuboid(g, -0.85, -0.85, 0.85, 0.85, 0, 8, STONE_D, { l: stoneTex(STONE_D, 13), r: stoneTex(STONE_D, 14) });
        cuboid(g, -0.55, -0.55, 0.55, 0.55, 8, 66, STONE, { l: stoneTex(STONE, 15), r: stoneTex(STONE, 16) }, {
          l: (c2, w, h) => { arch(c2, w * 0.4, h - 22, 8, 22, '#1e1812'); c2.fillStyle = '#1c1510'; c2.fillRect(w * 0.45, 12, 2.5, 12); c2.fillRect(w * 0.45, 32, 2.5, 12); },
          r: (c2, w, h) => { c2.fillStyle = '#1c1510'; c2.fillRect(w * 0.45, 14, 2.5, 12); c2.fillRect(w * 0.45, 34, 2.5, 12); },
        });
        cuboid(g, -0.78, -0.78, 0.78, 0.78, 66, 72, WOOD_D, { l: plankTex(WOOD, 17), r: plankTex(WOOD_D, 18) });
        for (const [a, b] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].sort((p, q) => (p[0] + p[1]) - (q[0] + q[1])))
          cuboid(g, a - 0.13, b - 0.13, a + 0.13, b + 0.13, 72, 84, STONE, { l: stoneTex(STONE, 19), r: stoneTex(STONE, 20) });
        const hp = P(0, 0, 80);
        g.fillStyle = '#e0b890'; g.beginPath(); g.arc(hp.x, hp.y - 8, 5, 0, 6.283); g.fill();
        g.fillStyle = shade(TRIM[L - 1], 1); g.beginPath(); g.arc(hp.x, hp.y - 10, 5.4, Math.PI, 0); g.fill();
        g.fillStyle = '#4a6a98'; g.fillRect(hp.x - 4, hp.y - 3, 8, 8);
        out.flag = { x: P(0.55, -0.55, 84).x, y: P(0.55, -0.55, 84).y, h: 22, color: ['#c9953a', '#4aa0d8', '#e8c24a'][L - 1] };
        break;
      }
      case 'cannon': {
        cuboid(g, -0.8, -0.8, 0.8, 0.8, 0, 12, STONE, { l: stoneTex(STONE, 21), r: stoneTex(STONE, 22) });
        cuboid(g, -0.6, -0.6, 0.6, 0.6, 12, 17, WOOD, { l: plankTex(WOOD, 23), r: plankTex(WOOD_D, 24) });
        g.fillStyle = shade(trim, 1); g.fillRect(-20, P(0, 0, 14).y + 8, 40, 2);
        out.turret = { x: 0, y: P(0, 0, 24).y };
        break;
      }
      case 'wall': {
        const stone = L === 1 ? [140, 134, 120] : L === 2 ? [128, 134, 146] : [150, 138, 110];
        const tx = { l: stoneTex(stone, 30 + L), r: stoneTex(stone, 40 + L) };
        const arms = [];   // far arms first, near arms last
        if (mask & 2) arms.push([-0.5, -0.2, -0.2, 0.2]);
        if (mask & 8) arms.push([-0.2, -0.5, 0.2, -0.2]);
        const hA = 22 + L * 4, hP = hA + 6;                     // arms / posts get taller with the level
        for (const a of arms) cuboid(g, a[0], a[1], a[2], a[3], 0, hA, stone, tx);
        cuboid(g, -0.27, -0.27, 0.27, 0.27, 0, hP, stone, tx);
        if (mask & 1) cuboid(g, 0.2, -0.2, 0.5, 0.2, 0, hA, stone, tx);
        if (mask & 4) cuboid(g, -0.2, 0.2, 0.2, 0.5, 0, hA, stone, tx);
        cuboid(g, -0.33, -0.33, 0.33, 0.33, hP, hP + 5, stone.map(v => v * 0.9), null);
        break;
      }
      case 'trap': {
        cuboid(g, -0.42, -0.42, 0.42, 0.42, 0, 3, [86, 80, 76], { l: stoneTex([86, 80, 76], 50), r: stoneTex([86, 80, 76], 51) });
        const top = P(0, 0, 3);
        g.fillStyle = '#b9bcc0';
        for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [0, 0], [-0.2, 0.2], [0.2, 0.2]]) { const p = P(a, b, 3); g.beginPath(); g.moveTo(p.x - 3, p.y); g.lineTo(p.x, p.y - 7); g.lineTo(p.x + 3, p.y); g.closePath(); g.fill(); }
        break;
      }
      case 'mortar': {
        cuboid(g, -0.85, -0.85, 0.85, 0.85, 0, 12, STONE, { l: stoneTex(STONE, 70), r: stoneTex(STONE, 71) });
        // sunken firing pit with sandbags
        poly(g, [P(-0.62, -0.62, 12), P(0.62, -0.62, 12), P(0.62, 0.62, 12), P(-0.62, 0.62, 12)], '#2e2a26');
        for (const [a, b] of [[-0.62, -0.1], [-0.1, -0.62], [0.52, 0.3], [0.3, 0.52]]) { const p0 = P(a, b, 14); g.fillStyle = '#b8a272'; g.beginPath(); g.ellipse(p0.x, p0.y, 7, 4, 0, 0, 6.283); g.fill(); g.strokeStyle = '#6a5a38'; g.lineWidth = 1; g.stroke(); }
        g.fillStyle = shade(trim, 1); g.fillRect(-16, P(0, 0.85, 8).y + 4, 32, 2);
        out.turret = { x: 0, y: P(0, 0, 18).y };
        break;
      }
      case 'magetower': {
        cuboid(g, -0.8, -0.8, 0.8, 0.8, 0, 8, STONE_D, { l: stoneTex(STONE_D, 72), r: stoneTex(STONE_D, 73) });
        const cr = L === 1 ? [90, 130, 210] : L === 2 ? [100, 190, 230] : [180, 120, 230];
        cuboid(g, -0.5, -0.5, 0.5, 0.5, 8, 64, [112, 118, 140], { l: stoneTex([112, 118, 140], 74), r: stoneTex([112, 118, 140], 75) }, {
          l: (c2, w, h) => { c2.fillStyle = shade(cr, 1.1); c2.fillRect(0, 16, w, 3); c2.fillRect(0, h - 22, w, 3); arch(c2, w * 0.36, h - 18, 8, 18, '#161826'); c2.fillStyle = shade(cr, 1.3); c2.fillRect(w * 0.45, 28, 2.5, 8); },
          r: (c2, w, h) => { c2.fillStyle = shade(cr, 0.9); c2.fillRect(0, 16, w, 3); c2.fillRect(0, h - 22, w, 3); c2.fillStyle = shade(cr, 1.2); c2.fillRect(w * 0.45, 28, 2.5, 8); },
        });
        cuboid(g, -0.66, -0.66, 0.66, 0.66, 64, 70, [86, 92, 118], null);
        const tp = P(0, 0, 70);
        // floating crystal with a soft halo
        const halo = g.createRadialGradient(tp.x, tp.y - 24, 2, tp.x, tp.y - 24, 34); halo.addColorStop(0, `rgba(${cr[0]},${cr[1]},${cr[2]},.8)`); halo.addColorStop(1, `rgba(${cr[0]},${cr[1]},${cr[2]},0)`);
        g.fillStyle = halo; g.beginPath(); g.arc(tp.x, tp.y - 24, 34, 0, 6.283); g.fill();
        const f = SPRITES.world['i_crystals'], sc = 34 / Math.max(f[2], f[3]);
        g.drawImage(Assets.world, f[0], f[1], f[2], f[3], tp.x - f[2] * sc / 2, tp.y - 24 - f[3] * sc / 2, f[2] * sc, f[3] * sc);
        out.glow = { x: tp.x, y: tp.y - 24, color: cr };
        break;
      }
      case 'shrine': {
        cuboid(g, -0.95, -0.95, 0.95, 0.95, 0, 5, [186, 180, 164], { l: stoneTex([186, 180, 164], 76), r: stoneTex([186, 180, 164], 77) });
        cuboid(g, -0.72, -0.72, 0.72, 0.72, 5, 10, [200, 194, 176], { l: stoneTex([200, 194, 176], 78), r: stoneTex([200, 194, 176], 79) });
        cuboid(g, -0.26, -0.26, 0.26, 0.26, 10, 48, [214, 208, 190], { l: stoneTex([214, 208, 190], 80), r: stoneTex([214, 208, 190], 81) }, {
          l: (c2, w, h) => { c2.fillStyle = shade(trim, 1.05); c2.fillRect(0, 6, w, 3); c2.fillRect(0, h - 10, w, 3); },
          r: (c2, w, h) => { c2.fillStyle = shade(trim, 0.85); c2.fillRect(0, 6, w, 3); c2.fillRect(0, h - 10, w, 3); },
        });
        for (const [a, b] of [[-0.78, 0.78], [0.78, -0.78]]) {      // braziers
          cuboid(g, a - 0.12, b - 0.12, a + 0.12, b + 0.12, 10, 22, [120, 116, 108], null);
          const q = P(a, b, 26); g.fillStyle = '#ff9a3a'; g.beginPath(); g.moveTo(q.x - 4, q.y + 2); g.quadraticCurveTo(q.x, q.y - 10, q.x + 4, q.y + 2); g.fill();
        }
        const tp = P(0, 0, 58), halo = g.createRadialGradient(tp.x, tp.y, 2, tp.x, tp.y, 30); halo.addColorStop(0, 'rgba(150,255,170,.85)'); halo.addColorStop(1, 'rgba(150,255,170,0)');
        g.fillStyle = halo; g.beginPath(); g.arc(tp.x, tp.y, 30, 0, 6.283); g.fill();
        g.fillStyle = '#d6ffe0'; g.beginPath(); g.arc(tp.x, tp.y, 7, 0, 6.283); g.fill(); g.fillStyle = '#7cdc96'; g.beginPath(); g.arc(tp.x + 1, tp.y + 1, 5, 0, 6.283); g.fill();
        g.strokeStyle = shade(trim, 1); g.lineWidth = 2; g.beginPath(); g.ellipse(tp.x, tp.y, 13, 5, 0, 0, 6.283); g.stroke();
        out.glow = { x: tp.x, y: tp.y, color: [150, 255, 170] };
        break;
      }
      case 'builderhut': {
        cuboid(g, -0.85, -0.85, 0.85, 0.85, 0, 4, STONE_D, { l: stoneTex(STONE_D, 82), r: stoneTex(STONE_D, 83) });
        cuboid(g, -0.78, -0.78, 0.78, 0.78, 4, 24, [214, 196, 160], { l: plasterTex([214, 196, 160], 84), r: plasterTex([200, 182, 146], 85) }, {
          l: (c2, w, h) => { arch(c2, w * 0.4, h - 17, 11, 17, '#3a2818'); windowDeco(w * 0.08, 5, 6, 7, '#f0c860')(c2); c2.fillStyle = '#7a5434'; for (const x of [0, w * 0.33, w * 0.7, w - 2]) c2.fillRect(x, 0, 2, h); c2.fillRect(0, 0, w, 2); },
          r: (c2, w, h) => { windowDeco(w * 0.3, 5, 7, 8, '#f0c860')(c2); c2.fillStyle = '#7a5434'; for (const x of [0, w * 0.5, w - 2]) c2.fillRect(x, 0, 2, h); c2.fillRect(0, 0, w, 2); },
        });
        roof(g, -0.95, -0.95, 0.95, 0.95, 24, 46, [136, 84, 62], '#5a3a28');
        // chimney, plank pile and hammer sign
        cuboid(g, 0.3, -0.5, 0.52, -0.28, 36, 52, [128, 120, 110], null);
        for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#b98a54' : '#a97a46'; g.fillRect(26, 22 - k * 3, 26, 3); }
        g.strokeStyle = '#4a3220'; g.lineWidth = 2; g.beginPath(); g.moveTo(-34, 26); g.lineTo(-34, 6); g.stroke(); g.fillStyle = '#c9a070'; g.fillRect(-46, 4, 24, 12); g.fillStyle = '#3a2818'; g.fillRect(-38, 8, 8, 2); g.fillRect(-35, 8, 2, 6);
        break;
      }
      case 'lantern': {
        g.fillStyle = '#2e2218'; g.fillRect(-2, -34, 4, 36); g.fillRect(-6, 0, 12, 3);
        g.fillStyle = '#3a2a1c'; g.fillRect(-7, -45, 14, 3); poly(g, [{ x: -6, y: -42 }, { x: 6, y: -42 }, { x: 5, y: -30 }, { x: -5, y: -30 }], '#ffd36a', '#3a2a1c', 1.2);
        g.fillStyle = '#fff2b8'; g.beginPath(); g.ellipse(0, -36, 2.4, 4, 0, 0, 6.283); g.fill();
        g.fillStyle = '#3a2a1c'; g.beginPath(); g.moveTo(-8, -45); g.lineTo(0, -52); g.lineTo(8, -45); g.closePath(); g.fill();
        out.glow = { x: 0, y: -36, color: [255, 200, 110] };
        break;
      }
      case 'garden': {
        poly(g, [P(-0.95, -0.95, 0), P(0.95, -0.95, 0), P(0.95, 0.95, 0), P(-0.95, 0.95, 0)], '#4a3a28');
        poly(g, [P(-0.82, -0.82, 1), P(0.82, -0.82, 1), P(0.82, 0.82, 1), P(-0.82, 0.82, 1)], '#5a4630');
        const r = mulberry(91), cols = ['#f4f0e0', '#f1d65a', '#c58ad8', '#e8847a', '#9cc4ee', '#f08ab0'];
        for (let k = 0; k < 46; k++) {
          const a = (r() - 0.5) * 1.55, b = (r() - 0.5) * 1.55, p0 = P(a, b, 2);
          g.strokeStyle = '#3f7a3a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p0.x, p0.y - 6 - r() * 5); g.stroke();
          g.fillStyle = cols[Math.floor(r() * cols.length)]; g.beginPath(); g.arc(p0.x, p0.y - 8 - r() * 4, 2.3 + r() * 1.2, 0, 6.283); g.fill();
        }
        cuboid(g, -0.98, -0.98, 0.98, -0.88, 0, 6, [150, 108, 64], { l: plankTex([150, 108, 64], 92), r: plankTex([120, 84, 50], 93) });
        cuboid(g, -0.98, -0.98, -0.88, 0.98, 0, 6, [150, 108, 64], { l: plankTex([150, 108, 64], 94), r: plankTex([120, 84, 50], 95) });
        cuboid(g, 0.88, -0.98, 0.98, 0.98, 0, 6, [150, 108, 64], { l: plankTex([150, 108, 64], 96), r: plankTex([120, 84, 50], 97) });
        cuboid(g, -0.98, 0.88, 0.98, 0.98, 0, 6, [150, 108, 64], { l: plankTex([150, 108, 64], 98), r: plankTex([120, 84, 50], 99) });
        break;
      }
      case 'fountain': {
        cuboid(g, -0.9, -0.9, 0.9, 0.9, 0, 12, [190, 186, 172], { l: stoneTex([190, 186, 172], 100), r: stoneTex([190, 186, 172], 101) });
        poly(g, [P(-0.72, -0.72, 11), P(0.72, -0.72, 11), P(0.72, 0.72, 11), P(-0.72, 0.72, 11)], '#4a9cc4');
        poly(g, [P(-0.72, -0.72, 11), P(0.72, -0.72, 11), P(0.72, 0.72, 11), P(-0.72, 0.72, 11)], 'rgba(255,255,255,.18)');
        cuboid(g, -0.14, -0.14, 0.14, 0.14, 11, 34, [200, 196, 182], { l: stoneTex([200, 196, 182], 102), r: stoneTex([200, 196, 182], 103) });
        cuboid(g, -0.34, -0.34, 0.34, 0.34, 34, 38, [206, 202, 188], null);
        poly(g, [P(-0.28, -0.28, 38), P(0.28, -0.28, 38), P(0.28, 0.28, 38), P(-0.28, 0.28, 38)], '#6ab4d8');
        out.spray = { x: 0, y: P(0, 0, 38).y };
        break;
      }
      case 'barracks': {
        cuboid(g, -0.95, -0.95, 0.95, 0.95, 0, 7, STONE_D, { l: stoneTex(STONE_D, 60), r: stoneTex(STONE_D, 61) });
        cuboid(g, -0.88, -0.88, 0.88, 0.88, 7, 28, WOOD, { l: plankTex(WOOD, 62), r: plankTex(WOOD_D, 63) }, {
          l: (c2, w, h) => { arch(c2, w * 0.38, h - 18, 14, 18, '#251a12'); c2.strokeStyle = '#c9d0d6'; c2.lineWidth = 1.5; c2.beginPath(); c2.moveTo(w * 0.1, 4); c2.lineTo(w * 0.22, 16); c2.moveTo(w * 0.22, 4); c2.lineTo(w * 0.1, 16); c2.stroke(); },
          r: (c2, w, h) => { windowDeco(w * 0.3, 6, 7, 9, '#e8b85a')(c2); windowDeco(w * 0.62, 6, 7, 9, '#e8b85a')(c2); },
        });
        const ap = roof(g, -1.05, -1.05, 1.05, 1.05, 28, 54, L === 1 ? [88, 100, 128] : L === 2 ? [70, 110, 120] : [120, 80, 110], shade(trim, 1));
        out.flag = { x: ap.x, y: ap.y - 2, h: 24, color: ['#6a8fd0', '#4ac0b0', '#d070b0'][L - 1] };
        break;
      }
    }
    return out;
  },
  scaffold(w, d) {
    const key = 'scaf' + w + d;
    let s = this.cache.get(key);
    if (s) return s;
    const { c, g, ox, oy } = this.canvasFor(w, d, 120);
    const hw = w / 2, hd = d / 2, H = 40 + 10 * (w + d) / 2;
    poly(g, [P(-hw, -hd, 0), P(hw, -hd, 0), P(hw, hd, 0), P(-hw, hd, 0)], 'rgba(96,74,52,.65)');
    g.strokeStyle = '#8a6a44'; g.lineWidth = 3;
    for (const [a, b] of [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]]) { const p0 = P(a, b, 0), p1 = P(a, b, H); g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke(); }
    g.lineWidth = 2; g.strokeStyle = '#a98254';
    for (const z of [H * 0.4, H * 0.8]) { const pts = [P(-hw, hd, z), P(hw, hd, z), P(hw, -hd, z)]; g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo(pts[1].x, pts[1].y); g.lineTo(pts[2].x, pts[2].y); g.stroke(); }
    g.lineWidth = 1.5; const a0 = P(-hw, hd, 0), a1 = P(hw, hd, H * 0.8); g.beginPath(); g.moveTo(a0.x, a0.y); g.lineTo(a1.x, a1.y); g.stroke();
    s = { canvas: c, ox, oy }; this.cache.set(key, s); return s;
  },
  ruin(w, d) {
    const key = 'ruin' + w + d;
    let s = this.cache.get(key);
    if (s) return s;
    const { c, g, ox, oy } = this.canvasFor(w, d, 40);
    const r = mulberry(w * 31 + d);
    poly(g, [P(-w / 2, -d / 2, 0), P(w / 2, -d / 2, 0), P(w / 2, d / 2, 0), P(-w / 2, d / 2, 0)], 'rgba(52,44,38,.7)');
    for (let k = 0; k < 6 + w * d * 2; k++) {
      const a = (r() - 0.5) * w * 0.9, b = (r() - 0.5) * d * 0.9, p = P(a, b, 0), sz = 5 + r() * 9;
      poly(g, [{ x: p.x - sz, y: p.y }, { x: p.x - sz * 0.3, y: p.y - sz * 0.8 }, { x: p.x + sz * 0.7, y: p.y - sz * 0.5 }, { x: p.x + sz, y: p.y + 2 }], shade([96 + r() * 30, 92 + r() * 28, 84 + r() * 24], 1), 'rgba(0,0,0,.4)');
    }
    g.strokeStyle = '#3a2a1e'; g.lineWidth = 3;
    for (let k = 0; k < 3; k++) { const p = P((r() - 0.5) * w * 0.6, (r() - 0.5) * d * 0.6, 0); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + (r() - 0.5) * 24, p.y - 8 - r() * 10); g.stroke(); }
    s = { canvas: c, ox, oy }; this.cache.set(key, s); return s;
  },
};
function shade2(c, k) { return [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255)]; }
