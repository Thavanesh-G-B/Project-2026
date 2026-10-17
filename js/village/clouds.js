'use strict';
// Village mode, part 4b: the sky and the cloud bank. Everything outside your territory (and the void around
// the island) is hidden by clouds; expanding the map makes the clouds part and drift away.
const Clouds = {
  spr: [], puffs: [], streaks: [], t0: 0, floorR: 10, floorFrom: 10, floorAt: -9, anim: 0, baked: null, wisps: [], live: true, BS: 0.5, PAD: 15,

  build() {
    this.spr = [];
    for (let v = 0; v < 6; v++) {
      const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      const g = c.getContext('2d'), r = mulberry(300 + v * 31);
      // a cumulus: a wide flat-bottomed mass of many small soft blobs, lit from above, with a blue-grey belly
      const blobs = [];
      for (let k = 0; k < 46; k++) {
        const a = r() * 6.283, d = Math.sqrt(r());
        const x = 150 + Math.cos(a) * d * 108, y = 112 + Math.sin(a) * d * 40 - Math.max(0, 1 - Math.abs(x - 150) / 90) * 14 * r();
        blobs.push({ x, y, rad: 13 + r() * 20 * (1 - d * 0.35) });
      }
      blobs.sort((p, q) => p.y - q.y);
      for (const b of blobs) {
        const lit = clamp(1 - (b.y - 70) / 80, 0, 1), belly = 1 - lit;
        const gr = g.createRadialGradient(b.x - b.rad * 0.2, b.y - b.rad * 0.35, b.rad * 0.05, b.x, b.y, b.rad);
        const top = [252 - belly * 40, 254 - belly * 30, 255 - belly * 18], mid = [236 - belly * 34, 244 - belly * 28, 250 - belly * 16];
        gr.addColorStop(0, `rgba(${top[0] | 0},${top[1] | 0},${top[2] | 0},.95)`); gr.addColorStop(0.55, `rgba(${mid[0] | 0},${mid[1] | 0},${mid[2] | 0},.78)`); gr.addColorStop(1, `rgba(${mid[0] | 0},${mid[1] | 0},${mid[2] | 0},0)`);
        g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, b.rad, 0, 6.283); g.fill();
      }
      this.spr.push(c);
    }
    this.streaks = Array.from({ length: 18 }, (_, k) => ({ x: vhash(k, 1, 77), y: vhash(k, 2, 77), s: 0.5 + vhash(k, 3, 77) * 1.1, v: Math.floor(vhash(k, 4, 77) * 6), sp: 4 + vhash(k, 5, 77) * 10 }));
  },

  // one puff per ~1.7 tiles over the whole map plus a wide ring outside the island; lvl = expansion level that clears it
  layout() {
    this.puffs = []; this.floorR = Terr.r; this.floorAt = -9;
    const PAD = 15, step = 1.45;
    for (let i = -PAD; i < GN + PAD; i += step) for (let j = -PAD; j < GN + PAD; j += step) {
      const ii = i + (vhash(Math.floor(i * 10), Math.floor(j * 10), 5) - 0.5) * step * 0.9, jj = j + (vhash(Math.floor(j * 10), Math.floor(i * 10), 6) - 0.5) * step * 0.9;
      const inIsland = ii >= 0 && jj >= 0 && ii < GN && jj < GN;
      const lvl = inIsland ? Terr.levelOf(ii, jj) : 99;
      if (lvl <= Terr.level) continue;
      this.puffs.push({ i: ii, j: jj, x: isoX(ii, jj), y: isoY(ii, jj), s: 1.15 + vhash(Math.floor(ii * 7), Math.floor(jj * 7), 8) * 0.7, v: Math.floor(vhash(Math.floor(ii * 5), Math.floor(jj * 5), 9) * 6), ph: vhash(Math.floor(ii * 3), Math.floor(jj * 3), 10) * 6.28, lvl, clear: -1 });
    }
    this.puffs.sort((a, b) => a.y - b.y);
    this.bake();
  },


  // The cloud bank barely changes, so paint it once into a half-resolution layer. Only a ring of wisps along the
  // border is animated live, and the whole bank goes live again while the clouds are parting.
  bake() {
    const S = this.BS, ext = (GN + 2 * this.PAD) * 32, x0 = -ext, y0 = -this.PAD * 32 * 0.5 - 40, W = Math.ceil(ext * 2 * S), H = Math.ceil(((GN + this.PAD) * 32 + this.PAD * 16 + 120) * S);
    const c = this.baked && this.baked.canvas.width === W ? this.baked.canvas : document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.setTransform(S, 0, 0, S, -x0 * S, -y0 * S); g.clearRect(x0, y0, W / S, H / S);
    this.drawLayer(g, { x0: x0 - 200, x1: x0 + W / S + 200, y0: y0 - 200, y1: y0 + H / S + 200 }, 0, false);
    this.baked = { canvas: c, x0, y0, w: W / S, h: H / S };
    const r = Terr.r;
    this.wisps = this.puffs.filter(p => { const d = Math.max(Math.abs(p.i - MID), Math.abs(p.j - MID)); return d - r < 3.5 && d - r > -1.5; });
    this.live = false;
  },
  drawLayer(ctx, view, now, animate) {
    const lo = MID - this.floorR, hi = MID + this.floorR + 1, pad = this.PAD + 1;
    ctx.beginPath();
    ctx.moveTo(isoX(-pad, -pad), isoY(-pad, -pad)); ctx.lineTo(isoX(GN + pad, -pad), isoY(GN + pad, -pad)); ctx.lineTo(isoX(GN + pad, GN + pad), isoY(GN + pad, GN + pad)); ctx.lineTo(isoX(-pad, GN + pad), isoY(-pad, GN + pad)); ctx.closePath();
    ctx.moveTo(isoX(lo + 0.6, lo + 0.6), isoY(lo + 0.6, lo + 0.6)); ctx.lineTo(isoX(lo + 0.6, hi - 0.6), isoY(lo + 0.6, hi - 0.6)); ctx.lineTo(isoX(hi - 0.6, hi - 0.6), isoY(hi - 0.6, hi - 0.6)); ctx.lineTo(isoX(hi - 0.6, lo + 0.6), isoY(hi - 0.6, lo + 0.6)); ctx.closePath();
    const gr = ctx.createLinearGradient(0, isoY(-pad, -pad), 0, isoY(GN + pad, GN + pad));
    gr.addColorStop(0, '#d2e0e6'); gr.addColorStop(1, '#e6f0f3');
    ctx.fillStyle = gr; ctx.fill('evenodd');
    for (const p of this.puffs) {
      if (p.dead) continue;
      let a = 1, ox = 0, oy = 0, sc = p.s;
      if (p.clear >= 0 && animate) {
        const f = (now - p.clear) / 2.2;
        if (f >= 1) { p.dead = true; continue; }
        if (f > 0) { a = 1 - f; const cx = p.i - MID, cy = p.j - MID, l = Math.hypot(cx, cy) || 1; ox = (cx - cy) / l * f * 70; oy = (cx + cy) / l * f * 35 - f * 20; sc = p.s * (1 + f * 0.5); }
      }
      const x = p.x + (animate ? Math.sin(now * 0.35 + p.ph) * 6 : 0) + ox, y = p.y + (animate ? Math.sin(now * 0.5 + p.ph * 1.7) * 3 : 0) + oy;
      if (x < view.x0 - 160 || x > view.x1 + 160 || y < view.y0 - 120 || y > view.y1 + 120) continue;
      ctx.globalAlpha = a; ctx.drawImage(this.spr[p.v], x - 150 * sc, y - 120 * sc, 300 * sc, 200 * sc);
    }
    ctx.globalAlpha = 1;
  },

  // the territory grew: puffs that covered the newly opened land break up and drift outward
  expanded(level, instant, now) {
    if (instant) { this.layout(); return; }
    this.floorFrom = this.floorR; this.floorAt = now; this.live = true;
    for (const p of this.puffs) if (p.lvl <= level && p.clear < 0) p.clear = now + vhash(Math.floor(p.i * 4), Math.floor(p.j * 4), 3) * 0.7;
  },

  drawSky(ctx, W, H, t, cam) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7fa6bc'); g.addColorStop(0.55, '#b4cdd8'); g.addColorStop(1, '#dbe8ec');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const sg = ctx.createRadialGradient(W * 0.78, H * 0.12, 10, W * 0.78, H * 0.12, H * 0.8); sg.addColorStop(0, 'rgba(255,248,224,.55)'); sg.addColorStop(1, 'rgba(255,248,224,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    // far, slow cloud streaks (parallax)
    for (const s of this.streaks) {
      const px = ((s.x * (W + 600) + t * s.sp - cam.x * 0.12) % (W + 600)) - 300, py = s.y * H - cam.y * 0.1;
      ctx.globalAlpha = 0.5; ctx.drawImage(this.spr[s.v], px - 150 * s.s, py - 60 * s.s, 300 * s.s, 200 * s.s * 0.7);
    }
    ctx.globalAlpha = 1;
  },

  // drawn in world space, over everything
  draw(ctx, t, view) {
    const now = t;
    if (this.floorAt > 0) {
      const f = clamp((now - this.floorAt) / 2.6, 0, 1); this.floorR = lerp(this.floorFrom, Terr.r, f * f * (3 - 2 * f));
      if (f >= 1) { this.floorAt = -9; this.floorR = Terr.r; this.puffs = this.puffs.filter(p => !p.dead && !(p.clear >= 0)); this.live = false; this.bake(); }
    }
    if (this.live) { this.drawLayer(ctx, view, now, true); return; }
    const b = this.baked, S = this.BS;                              // blit only the part of the baked layer on screen
    const vx0 = Math.max(view.x0, b.x0), vx1 = Math.min(view.x1, b.x0 + b.w), vy0 = Math.max(view.y0, b.y0), vy1 = Math.min(view.y1, b.y0 + b.h);
    if (vx1 > vx0 && vy1 > vy0) ctx.drawImage(b.canvas, (vx0 - b.x0) * S, (vy0 - b.y0) * S, (vx1 - vx0) * S, (vy1 - vy0) * S, vx0, vy0, vx1 - vx0, vy1 - vy0);
    for (const p of this.wisps) {                                   // a few live wisps keep the border drifting
      const x = p.x + Math.sin(now * 0.35 + p.ph) * 7, y = p.y + Math.sin(now * 0.5 + p.ph * 1.7) * 3.5;
      if (x < view.x0 - 160 || x > view.x1 + 160 || y < view.y0 - 120 || y > view.y1 + 120) continue;
      ctx.globalAlpha = 0.55; ctx.drawImage(this.spr[p.v], x - 150 * p.s * 0.8, y - 120 * p.s * 0.8, 300 * p.s * 0.8, 200 * p.s * 0.8);
    }
    ctx.globalAlpha = 1;
  },
};
