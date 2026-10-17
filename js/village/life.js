'use strict';
// Village mode, part 5b: a living village. Cast shadows, a cobbled plaza, props, working villagers, ambient
// wildlife (birds, butterflies, drifting leaves) and the light of the day (a dusk grade while raids last).
const Life = {
  key: '', plaza: null, props: [], butter: [], birds: [], leaves: [], smoke: [], birdT: 4, dusk: 0, glowT: 0,
  SH: { townhall: 96, goldmine: 50, lumbercamp: 46, storage: 48, archer: 112, cannon: 46, mortar: 54, magetower: 124, barracks: 64, shrine: 64, builderhut: 42, wall: 24, lantern: 44, fountain: 30, garden: 0, trap: 0 },

  // (re)build everything that depends on the map seed / Town Hall position
  sync() {
    const hall = V.buildings.find(b => b.type === 'townhall');
    if (!hall) return false;
    const key = V.seed + ':' + hall.i + ',' + hall.j;
    if (key === this.key) return true;
    this.key = key; this.hall = hall;
    this.bakePlaza(hall); this.makeProps(hall);
    this.butter = Array.from({ length: 5 }, (_, k) => ({ i: hall.i + 1.5 + (vhash(k, 1, V.seed) - 0.5) * 12, j: hall.j + 1.5 + (vhash(k, 2, V.seed) - 0.5) * 12, a: vhash(k, 3, V.seed) * 6.28, ph: k * 1.7, c: ['#f6e27a', '#ffffff', '#f0a0c8', '#9cc8ff', '#ffb070'][k] }));
    this.leaves = Array.from({ length: 14 }, (_, k) => ({ x: vhash(k, 4, 9), y: vhash(k, 5, 9), s: 0.6 + vhash(k, 6, 9), ph: k * 2.3, c: ['#8a5a2a', '#a8742e', '#b08a3a', '#6a8a3a'][k % 4] }));
    V.villagers = []; this.smoke = [];
    return true;
  },

  // ---------------------------------------------------------------- plaza
  bakePlaza(hall) {
    const m = 2.6, i0 = Math.floor(hall.i - m), i1 = Math.ceil(hall.i + hall.w + m), j0 = Math.floor(hall.j - m), j1 = Math.ceil(hall.j + hall.d + m + 1.2);
    const x0 = isoX(i0, j1) - 4, y0 = isoY(i0, j0) - 4, W = Math.ceil(isoX(i1, j0) - x0 + 4), H = Math.ceil(isoY(i1, j1) - y0 + 4);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const inside = (i, j) => {
      const dx = Math.max(hall.i - i - 1, 0, i - (hall.i + hall.w)), dy = Math.max(hall.j - j - 1, 0, j - (hall.j + hall.d + 1.2));
      const d = Math.hypot(dx, dy) - (vhash(i, j, V.seed + 61) - 0.5) * 1.3;
      return d < m - 0.35;
    };
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
      if (!inGrid(i, j) || !inside(i, j)) continue;
      const cx = isoX(i + 0.5, j + 0.5) - x0, cy = isoY(i + 0.5, j + 0.5) - y0, tone = vhash(i, j, V.seed + 62);
      g.beginPath(); g.moveTo(cx, cy - TH / 2); g.lineTo(cx + TW / 2, cy); g.lineTo(cx, cy + TH / 2); g.lineTo(cx - TW / 2, cy); g.closePath();
      g.fillStyle = `rgb(${150 + tone * 22 | 0},${142 + tone * 20 | 0},${124 + tone * 18 | 0})`; g.fill();
      g.save(); g.clip();
      for (let s = 0; s < 9; s++) {                                   // individual cobbles
        const u = vhash(i * 5 + s, j, V.seed + 63) - 0.5, v = vhash(i, j * 5 + s, V.seed + 64) - 0.5, px = cx + (u - v) * TW * 0.46, py = cy + (u + v) * TH * 0.46, r = 4.5 + vhash(i + s, j, V.seed + 65) * 3;
        const t2 = vhash(i + s, j + s, V.seed + 66);
        g.fillStyle = `rgb(${172 + t2 * 30 | 0},${164 + t2 * 28 | 0},${146 + t2 * 24 | 0})`; g.beginPath(); g.ellipse(px, py, r, r * 0.52, 0, 0, 6.283); g.fill();
        g.strokeStyle = 'rgba(70,60,46,.55)'; g.lineWidth = 1; g.stroke();
        g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.ellipse(px - r * 0.2, py - r * 0.15, r * 0.5, r * 0.2, 0, 0, 6.283); g.fill();
      }
      g.restore();
    }
    // soften the plaza edge into the meadow: darken a thin outline of the outer tiles
    this.plaza = { canvas: c, x: x0, y: y0 };
    this.plazaSet = new Set(); for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) if (inGrid(i, j) && inside(i, j)) this.plazaSet.add(i + ',' + j);
  },

  surfaceAt(i, j) { const ti = Math.floor(i), tj = Math.floor(j); return this.plazaSet && this.plazaSet.has(ti + ',' + tj) ? 'stone' : isRoad(ti, tj) ? 'dirt' : 'grass'; },

  // ---------------------------------------------------------------- props
  makeProps(hall) {
    const list = [], seed = V.seed, cx = hall.i + hall.w / 2, cy = hall.j + hall.d / 2;
    const taken = new Set();
    const free = (i, j, wild) => inGrid(i, j) && occAt(i, j) === 0 && !isRoad(i, j) && !taken.has(i + ',' + j) && (wild || Terr.has(i, j));
    const place = (type, i, j, extra) => { if (!free(i, j, extra && extra.wild)) return false; taken.add(i + ',' + j); list.push(Object.assign({ type, i, j, v: Math.floor(vhash(i, j, seed + 71) * 3), ph: vhash(i, j, seed + 72) * 6.28 }, extra)); return true; };
    const ring = (n, r0, r1, f) => { let got = 0; for (let k = 0; k < 160 && got < n; k++) { const a = vhash(k, 1, seed + 73) * 6.283, r = r0 + vhash(k, 2, seed + 73) * (r1 - r0); if (f(Math.floor(cx + Math.cos(a) * r), Math.floor(cy + Math.sin(a) * r), got)) got++; } };
    ring(1, 4.2, 6.5, (i, j) => free(i, j) && free(i + 1, j) && free(i, j + 1) && free(i + 1, j + 1) && (taken.add((i + 1) + ',' + j), taken.add(i + ',' + (j + 1)), taken.add((i + 1) + ',' + (j + 1)), place('well', i, j)));
    ring(1, 3.4, 6.8, (i, j) => place('campfire', i, j));
    ring(3, 3.2, 8, (i, j) => place('barrel', i, j));
    ring(3, 3.2, 8, (i, j) => place('crate', i, j));
    ring(2, 4, 9, (i, j) => place('hay', i, j));
    ring(1, 3, 6, (i, j) => place('sign', i, j));
    ring(8, 4, 12, (i, j) => place('bush', i, j));
    ring(3, 3, 7.5, (i, j) => place('torch', i, j));
    // wild scatter over the whole island: boulders, berry bushes and stumps, thicker near the forest
    for (let i = 2; i < GN - 2; i++) for (let j = 2; j < GN - 2; j++) {
      if (Math.hypot(i - cx, j - cy) < 5.5 || occAt(i, j) !== 0 || isRoad(i, j)) continue;
      const h = vhash(i, j, seed + 81), forest = smoothstep(7, 18, Math.max(Math.abs(i - MID), Math.abs(j - MID)));
      const type = h < 0.01 + forest * 0.012 ? 'boulder' : h < 0.026 + forest * 0.02 ? 'berry' : h < 0.034 + forest * 0.014 ? 'stump' : null;
      if (type && !taken.has(i + ',' + j)) place(type, i, j, { wild: true });
    }
    this.props = list.sort((a, b) => (a.i + a.j) - (b.i + b.j));
  },
  // props vanish when a building is placed on top of them
  propLive(p) { if (p.type === 'well') return occAt(p.i, p.j) === 0 && occAt(p.i + 1, p.j + 1) === 0; return occAt(p.i, p.j) === 0; },

  drawProp(ctx, p, t) {
    const x = isoX(p.i + 0.5, p.j + 0.5), y = isoY(p.i + 0.5, p.j + 0.5);
    const sh = (rx, ry, a) => { ctx.fillStyle = `rgba(14,22,12,${a || 0.28})`; ctx.beginPath(); ctx.ellipse(x + 2, y + 2, rx, ry, 0, 0, 6.283); ctx.fill(); };
    const OL = 'rgba(30,20,12,.65)';
    ctx.save();
    switch (p.type) {
      case 'barrel': {
        sh(11, 5); const w = 9, h = 17, g = ctx.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, '#a77a4a'); g.addColorStop(0.45, '#c79a62'); g.addColorStop(1, '#6e4a28');
        ctx.fillStyle = g; ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - w, y - 2); ctx.quadraticCurveTo(x - w - 3, y - h / 2 - 2, x - w + 1, y - h - 2); ctx.lineTo(x + w - 1, y - h - 2); ctx.quadraticCurveTo(x + w + 3, y - h / 2 - 2, x + w, y - 2); ctx.quadraticCurveTo(x, y + 3, x - w, y - 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#d8b07a'; ctx.beginPath(); ctx.ellipse(x, y - h - 2, w - 1, 3.6, 0, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#3a3a42'; ctx.lineWidth = 1.6; for (const k of [0.3, 0.72]) { ctx.beginPath(); ctx.ellipse(x, y - h * k - 1, w + 0.6, 3, 0, 0.1, Math.PI - 0.1); ctx.stroke(); }
        break; }
      case 'crate': {
        sh(14, 6.5); const s = 11 + p.v * 1.5;
        const face = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]); ctx.closePath(); ctx.fill(); ctx.stroke(); };
        ctx.strokeStyle = OL; ctx.lineWidth = 1.2;
        face([x - s, y - s * 0.5 - 2, x, y - 2, x, y - s - 2, x - s, y - s * 1.5 - 2], '#a77a46');
        face([x + s, y - s * 0.5 - 2, x, y - 2, x, y - s - 2, x + s, y - s * 1.5 - 2], '#7a5430');
        face([x - s, y - s * 1.5 - 2, x, y - s - 2, x + s, y - s * 1.5 - 2, x, y - s * 2 - 2], '#c9a066');
        ctx.strokeStyle = 'rgba(40,26,12,.55)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.5 - 2); ctx.lineTo(x, y - s - 2); ctx.moveTo(x - s, y - s * 1.5 - 2); ctx.lineTo(x, y - 2); ctx.stroke();
        break; }
      case 'hay': {
        sh(16, 7);
        const g = ctx.createRadialGradient(x - 5, y - 18, 2, x, y - 10, 20); g.addColorStop(0, '#f0dc8a'); g.addColorStop(0.6, '#d4b45a'); g.addColorStop(1, '#8a6c2c');
        ctx.fillStyle = g; ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.quadraticCurveTo(x - 17, y - 16, x - 3, y - 25); ctx.quadraticCurveTo(x + 14, y - 22, x + 16, y - 2); ctx.quadraticCurveTo(x, y + 4, x - 16, y); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,88,30,.7)'; ctx.lineWidth = 1; for (let k = 0; k < 9; k++) { const a = -12 + k * 3.2; ctx.beginPath(); ctx.moveTo(x + a, y - 3 - (k % 3) * 4); ctx.lineTo(x + a + 2, y - 11 - (k % 4) * 3); ctx.stroke(); }
        break; }
      case 'boulder': case 'berry': case 'stump': {
        const key = p.type === 'boulder' ? 'boulders' : p.type === 'berry' ? 'berry' : 'stumps', F = BLD.f(key), sc = (p.type === 'boulder' ? 0.62 : p.type === 'berry' ? 0.62 : 0.42) * (0.9 + p.v * 0.12);
        const fl = p.v === 1; sh(F[2] * sc * 0.42, F[2] * sc * 0.16, 0.22);
        ctx.translate(x, y + 4); if (fl) ctx.scale(-1, 1);
        ctx.drawImage(BLD.img, F[0], F[1], F[2], F[3], -F[2] * sc / 2, -F[3] * sc, F[2] * sc, F[3] * sc);
        break; }
      case 'bush': {
        sh(14, 5.5, 0.22); const cols = [['#5f8f46', '#3f6c32'], ['#6aa04c', '#46763a'], ['#7a9c44', '#52702e']][p.v];
        for (const [dx, dy, r] of [[-7, -5, 8], [6, -6, 9], [0, -11, 8.5], [-1, -3, 9]]) { const g = ctx.createRadialGradient(x + dx - 2, y + dy - 3, 1, x + dx, y + dy, r); g.addColorStop(0, '#9cc868'); g.addColorStop(0.5, cols[0]); g.addColorStop(1, cols[1]); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, 6.283); ctx.fill(); }
        if (p.v === 1) { ctx.fillStyle = '#e45a5a'; for (const [dx, dy] of [[-6, -8], [4, -5], [1, -13]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, 1.6, 0, 6.283); ctx.fill(); } }
        break; }
      case 'sign': {
        sh(8, 3.5, 0.24);
        ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.fillStyle = '#6e4a28'; ctx.fillRect(x - 1.7, y - 30, 3.4, 30); ctx.strokeRect(x - 1.7, y - 30, 3.4, 30);
        const arrow = (yy, dir, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - 12 * dir, yy - 4); ctx.lineTo(x + 6 * dir, yy - 4); ctx.lineTo(x + 12 * dir, yy); ctx.lineTo(x + 6 * dir, yy + 4); ctx.lineTo(x - 12 * dir, yy + 4); ctx.closePath(); ctx.fill(); ctx.stroke(); };
        arrow(y - 25, 1, '#b88a52'); arrow(y - 16, -1, '#a07844');
        break; }
      case 'torch': {
        sh(7, 3, 0.22);
        ctx.fillStyle = '#4a3220'; ctx.strokeStyle = OL; ctx.lineWidth = 1.1; ctx.fillRect(x - 1.6, y - 28, 3.2, 28); ctx.strokeRect(x - 1.6, y - 28, 3.2, 28);
        ctx.fillStyle = '#2e2a28'; ctx.beginPath(); ctx.moveTo(x - 4.5, y - 30); ctx.lineTo(x + 4.5, y - 30); ctx.lineTo(x + 3, y - 25); ctx.lineTo(x - 3, y - 25); ctx.closePath(); ctx.fill();
        this.flame(ctx, x, y - 31, 1, t + p.ph);
        break; }
      case 'campfire': {
        sh(15, 6.5, 0.3);
        ctx.fillStyle = 'rgba(30,22,16,.5)'; ctx.beginPath(); ctx.ellipse(x, y, 13, 6, 0, 0, 6.283); ctx.fill();
        for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; ctx.fillStyle = k % 2 ? '#8a8478' : '#6a665c'; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 11, y + Math.sin(a) * 5, 3.4, 2.4, 0, 0, 6.283); ctx.fill(); }
        ctx.strokeStyle = '#4a3220'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 8, y - 1); ctx.lineTo(x + 7, y - 4); ctx.moveTo(x - 7, y - 4); ctx.lineTo(x + 8, y - 1); ctx.stroke();
        this.flame(ctx, x, y - 3, 1.7, t + p.ph);
        break; }
      case 'well': {
        const wx = isoX(p.i + 1, p.j + 1), wy = isoY(p.i + 1, p.j + 1);
        ctx.fillStyle = 'rgba(14,22,12,.28)'; ctx.beginPath(); ctx.ellipse(wx + 4, wy + 3, 27, 12, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = OL; ctx.lineWidth = 1.3;
        const stone = ctx.createLinearGradient(wx - 22, 0, wx + 22, 0); stone.addColorStop(0, '#b4b0a2'); stone.addColorStop(0.5, '#9a968a'); stone.addColorStop(1, '#6a675e');
        ctx.fillStyle = stone; ctx.beginPath(); ctx.ellipse(wx, wy - 12, 21, 10.5, 0, 0, Math.PI); ctx.lineTo(wx - 21, wy - 12); ctx.lineTo(wx - 21, wy - 3); ctx.ellipse(wx, wy - 3, 21, 10.5, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c6c2b4'; ctx.beginPath(); ctx.ellipse(wx, wy - 14, 21, 10.5, 0, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1f3e52'; ctx.beginPath(); ctx.ellipse(wx, wy - 14, 15, 7, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = `rgba(150,200,230,${0.3 + 0.2 * Math.sin(t * 2 + p.ph)})`; ctx.beginPath(); ctx.ellipse(wx - 4, wy - 15, 6, 2.2, 0, 0, 6.283); ctx.fill();
        for (const sd of [-1, 1]) { ctx.fillStyle = '#6e4a28'; ctx.fillRect(wx + sd * 19 - 1.8, wy - 44, 3.6, 31); ctx.strokeRect(wx + sd * 19 - 1.8, wy - 44, 3.6, 31); }
        ctx.fillStyle = '#9a4a34'; ctx.beginPath(); ctx.moveTo(wx - 26, wy - 43); ctx.lineTo(wx, wy - 56); ctx.lineTo(wx + 26, wy - 43); ctx.lineTo(wx, wy - 36); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(wx, wy - 40); ctx.lineTo(wx, wy - 26); ctx.stroke(); ctx.fillStyle = '#7a5230'; ctx.fillRect(wx - 3.5, wy - 27, 7, 6);
        break; }
    }
    ctx.restore();
  },
  flame(ctx, x, y, s, t) {
    const f = Math.sin(t * 14) * 0.5 + Math.sin(t * 23) * 0.3;
    for (const [col, k] of [['#ff7a2a', 1], ['#ffc040', 0.66], ['#fff2b0', 0.34]]) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - 4 * k * s, y);
      ctx.quadraticCurveTo(x - 5 * k * s, y - 8 * k * s, x + f * 1.2 * s, y - (13 + f * 2.5) * k * s);
      ctx.quadraticCurveTo(x + 5 * k * s, y - 8 * k * s, x + 4 * k * s, y); ctx.closePath(); ctx.fill();
    }
  },

  // ---------------------------------------------------------------- shadows
  // the sun is upper-left, so shadows fall to the lower right; at dusk it sinks and they stretch out
  drawShadows(ctx, view) {
    const len = 0.5 + this.dusk * 0.35, a = 0.2 + this.dusk * 0.1;
    ctx.fillStyle = `rgba(16,24,18,${a})`;
    for (const b of V.buildings) {
      const h = this.SH[b.type] || 0; if (!h || b.state === 'ruin') continue;
      const hh = b.state === 'building' ? h * 0.5 : h;
      const x0 = isoX(b.i + b.w / 2, b.j + b.d / 2); if (x0 < view.x0 - 200 || x0 > view.x1 + 200) continue;
      const ox = hh * len * 0.9, oy = hh * len * 0.42, pts = [];
      const cs = [[b.i, b.j], [b.i + b.w, b.j], [b.i + b.w, b.j + b.d], [b.i, b.j + b.d]];
      for (const [i, j] of cs) { const px = isoX(i, j), py = isoY(i, j); pts.push([px, py], [px + ox, py + oy]); }
      const hull = this.hull(pts);
      ctx.beginPath(); ctx.moveTo(hull[0][0], hull[0][1]); for (let k = 1; k < hull.length; k++) ctx.lineTo(hull[k][0], hull[k][1]); ctx.closePath(); ctx.fill();
    }
    for (const t of V.trees) {
      if (!t.alive || t.fall || Math.abs(t.i - MID) > Terr.r + 4 || Math.abs(t.j - MID) > Terr.r + 4) continue;
      const x = isoX(t.i + 0.5 + t.ox, t.j + 0.5 + t.oj), y = isoY(t.i + 0.5 + t.ox, t.j + 0.5 + t.oj);
      if (x < view.x0 - 80 || x > view.x1 + 80 || y < view.y0 - 120 || y > view.y1 + 120) continue;
      const k = t.s * (0.8 + this.dusk * 0.5);
      ctx.beginPath(); ctx.ellipse(x + 26 * k, y + 8 * k, 40 * k, 12 * k, 0.16, 0, 6.283); ctx.fill();
    }
  },
  hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let k = p.length - 1; k >= 0; k--) { const q = p[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop(); return lo.concat(up);
  },

  // ---------------------------------------------------------------- villagers
  homeDoor() { const h = this.hall; return { i: h.i + h.w / 2, j: h.j + h.d + 0.55 }; },
  update(dt, t) {
    if (!this.sync()) return;
    // the light follows the raid
    const target = V.raid.active ? 1 : 0; this.dusk += (target - this.dusk) * Math.min(1, dt * 0.7);
    this.updateVillagers(dt);
    this.envT = (this.envT || 0) - dt;
    if (this.envT <= 0 && typeof UI !== 'undefined') {          // ambience hints for the sound engine: is a campfire near the camera?
      this.envT = 0.6; const ci = unIso(UI.cam.x, UI.cam.y);
      let near = 0; for (const p of this.props) if (p.type === 'campfire' && this.propLive(p)) near = Math.max(near, clamp(1 - Math.hypot(p.i - ci.i, p.j - ci.j) / 14, 0, 1));
      Sfx.env.fire = near;
    }
    for (const b of this.butter) { b.a += (Math.random() - 0.5) * dt * 6; b.i += Math.cos(b.a) * dt * 0.7; b.j += Math.sin(b.a) * dt * 0.7; if (Math.hypot(b.i - this.hall.i - 1.5, b.j - this.hall.j - 1.5) > 9) b.a = Math.atan2(this.hall.j + 1.5 - b.j, this.hall.i + 1.5 - b.i); }
    // campfire / torch glow sparks and smoke
    for (const p of this.props) if (p.type === 'campfire' && this.propLive(p) && Math.random() < dt * 4) this.smoke.push({ x: isoX(p.i + 0.5, p.j + 0.5) + rnd(-2, 2), y: isoY(p.i + 0.5, p.j + 0.5) - 14, vx: rnd(4, 9), vy: -rnd(16, 26), r: 3, life: 2.4, max: 2.4 });
    for (const s of this.smoke) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.r += dt * 4.5; s.vx *= 0.99; }
    this.smoke = this.smoke.filter(s => s.life > 0);
    if (this.smoke.length > 80) this.smoke.splice(0, this.smoke.length - 80);
    // birds cross the sky now and then (not during raids)
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = rnd(9, 22);
      if (!V.raid.active) { const n = 2 + Math.floor(Math.random() * 3), dir = Math.random() < 0.5 ? 1 : -1, cx = UI.cam.x + (UI.W / 2 + 120) / UI.cam.zoom * -dir, cy = UI.cam.y - UI.H * 0.32 / UI.cam.zoom + rnd(-40, 60); for (let k = 0; k < n; k++) this.birds.push({ x: cx - dir * k * 26, y: cy + k * 9 * dir + rnd(-8, 8), vx: dir * rnd(55, 75), ph: Math.random() * 6, life: 0 }); }
    }
    for (const b of this.birds) { b.x += b.vx * dt; b.y += Math.sin(t * 1.3 + b.ph) * 4 * dt; b.life += dt; }
    this.birds = this.birds.filter(b => b.life < 26);
  },

  updateVillagers(dt) {
    const hall = this.hall, door = this.homeDoor();
    const built = V.buildings.filter(b => b.state === 'built' && !['wall', 'trap', 'lantern', 'garden'].includes(b.type)).length;
    const want = clamp(2 + Math.floor(built / 2), 2, 7);
    this.spawnT = (this.spawnT || 0) - dt;
    if (V.villagers.length < want && this.spawnT <= 0 && !V.raid.active) {
      this.spawnT = 2.5;
      V.villagers.push({ id: V.nextId++, i: door.i + rnd(-0.6, 0.6), j: door.j, path: [], act: 'idle', wait: rnd(1, 3), walkT: Math.random() * 6, fdir: { x: 0.7, y: 0.7 }, alpha: 0, hidden: false, pal: V.nextId % 4, carry: null, face: 1 });
    }
    for (const v of V.villagers) {
      v.alpha = Math.min(1, v.alpha + dt * 2.5);
      if (V.raid.active) {                                   // run for the Town Hall and hide
        if (!v.hidden) {
          if (v.act !== 'flee') { v.act = 'flee'; v.carry = null; v.path = pathToTile(v, tileOf(door.i), tileOf(door.j)) || []; }
          const moving = followPath(v, dt * 1.8, 1.6); if (moving) { v.walkT += dt * 3; faceFrom(v); }
          if (!moving && Math.hypot(v.i - door.i, v.j - door.j) < 1.6) { v.alpha -= dt * 4; if (v.alpha <= 0) { v.hidden = true; v.alpha = 0; } }
          else if (!moving) v.path = pathToTile(v, tileOf(door.i), tileOf(door.j)) || [];
        }
        continue;
      }
      if (v.hidden) { v.hidden = false; v.act = 'idle'; v.wait = rnd(0.5, 3); v.i = door.i; v.j = door.j; v.alpha = 0; }
      const moving = followPath(v, dt, v.carry ? 0.85 : 1.0);
      if (moving) { v.walkT += dt * 1.5; faceFrom(v); continue; }
      v.wait -= dt; v.work = v.act === 'work' ? (v.work || 0) + dt : 0;
      if (v.wait > 0) continue;
      if (v.act === 'haul') {                                // delivered the load
        if (v.carry) { floatText(v.i, v.j, 46, v.carry === 'log' ? '+wood' : '+gold', v.carry === 'log' ? '#c8a070' : '#ffd966'); sfxAt('place', v.i, v.j); }
        v.carry = null; v.act = 'idle'; v.wait = rnd(2, 5); continue;
      }
      if (v.act === 'goto') {                                // arrived at a worksite
        v.act = 'work'; v.wait = rnd(3.5, 7); if (v.site) lookAt(v, v.site.i + v.site.w / 2, v.site.j + v.site.d / 2); continue;
      }
      if (v.act === 'work') {                                // finished working: carry something home from a collector
        const s = v.site; v.site = null;
        if (s && s.state === 'built' && BDEF[s.type].kind === 'collector') { v.carry = BDEF[s.type].res === 'wood' ? 'log' : 'coins'; v.act = 'haul'; v.wait = 0.2; v.path = pathToTile(v, tileOf(door.i + rnd(-0.8, 0.8)), tileOf(door.j + 0.2)) || []; continue; }
        v.act = 'idle'; v.wait = rnd(1, 3); continue;
      }
      // choose something to do
      const sites = V.buildings.filter(b => (b.state === 'building' || (b.state === 'built' && BDEF[b.type].kind === 'collector')) && Terr.has(b.i, b.j));
      if (sites.length && Math.random() < 0.7) {
        const b = sites[Math.floor(Math.random() * sites.length)];
        const p = pathToTile(v, clamp(tileOf(b.i + b.w / 2 + rnd(-0.6, 0.6)), 1, GN - 2), clamp(tileOf(b.j + b.d + 0.4), 1, GN - 2));
        if (p) { v.site = b; v.path = p; v.act = 'goto'; v.wait = 0; continue; }
      }
      v.act = 'idle'; v.wait = rnd(2, 6);
      const ti = clamp(tileOf(door.i + rnd(-4, 4)), 1, GN - 2), tj = clamp(tileOf(door.j + rnd(-0.5, 4)), 1, GN - 2);
      v.path = pathToTile(v, ti, tj) || [];
    }
  },

  drawVillager(ctx, v, t) {
    if (v.hidden) return;
    const x = isoX(v.i, v.j), y = isoY(v.i, v.j) + 2, moving = v.path && v.path.length > 0 && v.act !== 'work';
    const yaw = turnTo(v, yawOf(v), 10);
    ctx.fillStyle = `rgba(14,22,12,${0.26 * v.alpha})`; ctx.beginPath(); ctx.ellipse(x + 1, y, 11, 4.8, 0, 0, 6.283); ctx.fill();
    const o = { x, y, s: 0.86, yaw, kind: 'idle', u: 0, ph: stridePhase(v, x, y, 0.86), t: t + v.id, variant: 'v' + v.pal, carry: v.carry, alpha: v.alpha, side: v.face || 1 };
    if (moving) o.kind = v.carry ? 'carry' : 'walk';
    else if (v.act === 'work') { o.kind = 'work'; o.u = ((t * 1.1 + v.id * 0.37) % 1); }
    else if (v.carry) o.kind = 'carry';
    Hero.draw(ctx, o);
  },

  // ---------------------------------------------------------------- ambient layers
  drawAmbient(ctx, view, t) {
    for (const s of this.smoke) { const f = 1 - s.life / s.max; ctx.fillStyle = `rgba(210,210,214,${0.32 * (1 - f)})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill(); }
    for (const b of this.butter) {
      const x = isoX(b.i, b.j), y = isoY(b.i, b.j) - 22 - Math.sin(t * 2 + b.ph) * 6, w = Math.abs(Math.sin(t * 15 + b.ph)) * 4 + 1;
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      ctx.fillStyle = b.c; ctx.strokeStyle = 'rgba(40,30,20,.55)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.ellipse(x - w * 0.6, y - 1, w, 2.8, -0.4, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(x + w * 0.6, y - 1, w, 2.8, 0.4, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#33281c'; ctx.fillRect(x - 0.5, y - 3, 1, 5);
    }
    ctx.lineCap = 'round';
    for (const b of this.birds) {
      const f = Math.sin(t * 11 + b.ph) * 4.5, s = Math.min(1, b.life / 2, (26 - b.life) / 2);
      ctx.globalAlpha = s; ctx.strokeStyle = 'rgba(30,34,40,.85)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(b.x - 7, b.y - f); ctx.quadraticCurveTo(b.x - 3, b.y - 3, b.x, b.y); ctx.quadraticCurveTo(b.x + 3, b.y - 3, b.x + 7, b.y - f); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // leaves drift across the screen on the breeze
    const W = view.x1 - view.x0, H = view.y1 - view.y0;
    for (const l of this.leaves) {
      const x = view.x0 + (((l.x * W + t * 14 * l.s) % W) + W) % W, y = view.y0 + (((l.y * H + t * 8 * l.s + Math.sin(t * 0.9 + l.ph) * 30) % H) + H) % H, a = t * 2.4 + l.ph;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(1, Math.abs(Math.cos(a * 0.7)) * 0.8 + 0.2); ctx.fillStyle = l.c; ctx.globalAlpha = 0.8 * (1 - this.dusk * 0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 1.7, 0, 0, 6.283); ctx.fill(); ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  // dusk grade + warm glows (world space, drawn before the clouds)
  drawLight(ctx, view, t) {
    const d = this.dusk;
    if (d > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      const boss = V.enemies.some(e => e.boss && !e.dying);
      ctx.fillStyle = boss ? `rgba(${255 - 90 * d | 0},${255 - 140 * d | 0},${255 - 120 * d | 0},1)` : `rgba(${255 - 110 * d | 0},${255 - 105 * d | 0},${255 - 70 * d | 0},1)`;
      ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0); ctx.restore();
    }
    // additive glows: campfires, torches, lanterns, tower braziers
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, a) => { if (x < view.x0 - r || x > view.x1 + r || y < view.y0 - r || y > view.y1 + r) return; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,170,70,${a})`); g.addColorStop(1, 'rgba(255,120,30,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); };
    const k = 0.1 + d * 0.5;
    for (const p of this.props) { if (!this.propLive(p)) continue; if (p.type === 'campfire') glow(isoX(p.i + 0.5, p.j + 0.5), isoY(p.i + 0.5, p.j + 0.5) - 8, 70 + Math.sin(t * 13 + p.ph) * 4, k * 1.3); else if (p.type === 'torch') glow(isoX(p.i + 0.5, p.j + 0.5), isoY(p.i + 0.5, p.j + 0.5) - 32, 44, k); }
    for (const b of V.buildings) if (b.type === 'lantern' && b.state === 'built') glow(isoX(b.i + 0.5, b.j + 0.5), isoY(b.i + 0.5, b.j + 0.5) - 38, 54, k * 1.1);
    ctx.restore();
  },
  // screen-space vignette
  drawVignette(ctx, W, H) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, 'rgba(10,16,20,0)'); g.addColorStop(1, `rgba(10,16,24,${0.28 + this.dusk * 0.12})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  },
};
