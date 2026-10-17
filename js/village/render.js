'use strict';
// Village mode, part 5: isometric rendering (camera, draw ordering, units, effects).
const canvas = document.getElementById('v');
const ctx = canvas.getContext('2d');

const UI = {
  cam: { x: 0, y: 0, zoom: 1 }, W: 960, H: 540, dpr: 1,
  tool: 'move', place: null, hover: { i: 0, j: 0, ok: false, why: '' }, follow: false, mouse: { x: 0, y: 0, in: false },
  banner: null, time: 0, mapOpen: false,
};
const worldX = sx => (sx - UI.W / 2) / UI.cam.zoom + UI.cam.x;
const worldY = sy => (sy - UI.H / 2) / UI.cam.zoom + UI.cam.y;
const hallCenter = () => { const h = V.buildings.find(b => b.type === 'townhall'); return h ? { i: h.i + h.w / 2, j: h.j + h.d / 2 } : { i: MID + 0.5, j: MID + 0.5 }; };
function centerOn(i, j) { UI.cam.x = isoX(i, j); UI.cam.y = isoY(i, j) - 20; }
function clampCam() {            // you can only look around your own territory (plus a margin into the clouds)
  const c = UI.cam, lo = MID - Terr.r - 5, hi = MID + Terr.r + 6;
  c.x = clamp(c.x, (lo - hi) * TW / 2, (hi - lo) * TW / 2); c.y = clamp(c.y, lo * TH, hi * TH);
}
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  UI.dpr = Math.min(2, window.devicePixelRatio || 1);
  UI.W = Math.max(320, Math.floor(r.width)); UI.H = Math.max(240, Math.floor(r.height));
  canvas.width = UI.W * UI.dpr; canvas.height = UI.H * UI.dpr; canvas.style.width = UI.W + 'px'; canvas.style.height = UI.H + 'px';
}

function drawWater(t) { Clouds.drawSky(ctx, UI.W, UI.H, t, UI.cam); }

// ---------------------------------------------------------------- sprites on the map
function shadowAt(x, y, rx, ry, a) { ctx.fillStyle = `rgba(14,22,12,${a || 0.3})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.283); ctx.fill(); }
function wallMask(b) {
  const isW = (i, j) => { const o = occAt(i, j); if (o <= 0) return false; const q = bById(o); return q && q.type === 'wall'; };
  return (isW(b.i + 1, b.j) ? 1 : 0) | (isW(b.i - 1, b.j) ? 2 : 0) | (isW(b.i, b.j + 1) ? 4 : 0) | (isW(b.i, b.j - 1) ? 8 : 0);
}
function drawFlag(x, y, h, color, t) {
  ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  const w = 17, wave = Math.sin(t * 5 + x) * 2.5;
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - h); ctx.quadraticCurveTo(x + w / 2, y - h + 2 + wave, x + w, y - h + 4); ctx.lineTo(x + w - 3, y - h + 8 + wave * 0.5); ctx.lineTo(x + w, y - h + 12); ctx.quadraticCurveTo(x + w / 2, y - h + 9 - wave, x, y - h + 13); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x, y - h, 2, 13);
}
function drawBuilding(b, t) {
  const cx = isoX(b.i + b.w / 2, b.j + b.d / 2), cy = isoY(b.i + b.w / 2, b.j + b.d / 2);
  const d = BDEF[b.type];
  if (b.state === 'ruin') {
    const s = BART.ruin(b.w, b.d); ctx.drawImage(s.canvas, cx - s.ox, cy - s.oy);
    if (V.selected === b) selectionRing(b);
    return;
  }
  const mask = b.type === 'wall' ? wallMask(b) : 0;
  const lvl = b.state === 'building' && !b.up ? 1 : b.level;
  const s = BART.get(b.type, lvl, mask);
  if (b.state === 'building') {
    const prog = 1 - b.buildT / b.buildTotal;
    shadowAt(cx, cy + 4, (b.w + b.d) * 15, (b.w + b.d) * 7, 0.22);
    const sc = BART.scaffold(b.w, b.d);
    if (b.up) { ctx.drawImage(s.canvas, cx - s.ox, cy - s.oy); }
    else {
      ctx.save(); const top = cy - s.oy + s.canvas.height * (1 - prog * 0.92);
      ctx.beginPath(); ctx.rect(cx - s.ox, top, s.canvas.width, s.canvas.height); ctx.clip(); ctx.globalAlpha = 0.9; ctx.drawImage(s.canvas, cx - s.ox, cy - s.oy); ctx.restore();
    }
    ctx.drawImage(sc.canvas, cx - sc.ox, cy - sc.oy);
    const bw = 40, by = cy - 70 - (b.w + b.d) * 6;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(cx - bw / 2 - 1, by - 1, bw + 2, 16);
    ctx.fillStyle = '#d6a64a'; ctx.fillRect(cx - bw / 2, by, bw * prog, 14);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.fillText(Math.ceil(b.buildT) + 's', cx, by + 11);
    return;
  }
  const shake = b.flash > 0 ? (Math.random() - 0.5) * 3 : 0;
  // artillery faces its target: the sprite is mirrored towards the side the target is on, and kicks back when it fires
  const art = b.type === 'cannon' || b.type === 'mortar', flip = art && (Math.cos(b.aim || 0) - Math.sin(b.aim || 0)) > 0, kick = art ? (b.recoil || 0) * 14 * (flip ? -1 : 1) : 0;
  const blit = (alpha) => {
    ctx.save(); if (alpha) ctx.globalAlpha = alpha;
    if (flip) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.drawImage(s.canvas, -s.ox + kick * -1 + shake, cy - s.oy); }
    else ctx.drawImage(s.canvas, cx - s.ox - kick + shake, cy - s.oy);
    ctx.restore();
  };
  blit();
  if (b.flash > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; blit(0.35); ctx.restore(); }
  if (art && b.recoil > 0) {                      // muzzle flash at the barrel end
    const mx = cx + (flip ? 1 : -1) * s.canvas.width * 0.3, my = cy - s.oy + s.canvas.height * 0.36, k = b.recoil * 3.4;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(mx, my, 1, mx, my, 26);
    gr.addColorStop(0, `rgba(255,236,160,${clamp(k, 0, 1)})`); gr.addColorStop(1, 'rgba(255,140,40,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(mx, my, 26, 0, 6.283); ctx.fill(); ctx.restore();
  }
  if (b.level > 1 && d.kind !== 'decor' && d.kind !== 'wall' && d.kind !== 'trap' && BSPR[b.type]) {      // level stars above the roof
    const sy = cy - s.oy + 2, n = b.level;
    ctx.save(); ctx.font = 'bold 12px Georgia, serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(30,20,8,.85)';
    const str = '★'.repeat(n); ctx.strokeText(str, cx, sy); ctx.fillStyle = n === 3 ? '#ffd95a' : '#e8e8f4'; ctx.fillText(str, cx, sy); ctx.restore();
  }
  if (s.flag) drawFlag(cx + s.flag.x, cy + s.flag.y, s.flag.h, s.flag.color, t);
  if (s.turret && (b.type === 'cannon' || b.type === 'mortar')) {
    const a = b.aim, sx = (Math.cos(a) - Math.sin(a)) * TW / 2, sy = (Math.cos(a) + Math.sin(a)) * TH / 2, l = Math.hypot(sx, sy), ux = sx / l, uy = sy / l;
    const mort = b.type === 'mortar', bx = cx, by = cy + s.turret.y, rec = (b.recoil || 0) * 20, len = (mort ? 15 : 26) - rec * (mort ? 0.5 : 1);
    ctx.lineCap = 'round'; ctx.strokeStyle = '#1c1c22'; ctx.lineWidth = mort ? 17 : 12; ctx.beginPath(); ctx.moveTo(bx - ux * 6, by - uy * 6); ctx.lineTo(bx + ux * len, by + uy * len); ctx.stroke();
    ctx.strokeStyle = b.level === 1 ? '#44464e' : b.level === 2 ? '#5a6678' : '#8a7440'; ctx.lineWidth = mort ? 13 : 9; ctx.beginPath(); ctx.moveTo(bx - ux * 6, by - uy * 6); ctx.lineTo(bx + ux * len, by + uy * len); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx - ux * 4, by - uy * 4 - 3); ctx.lineTo(bx + ux * len, by + uy * len - 3); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(bx + ux * (len + 1), by + uy * (len + 1), 4.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#3a2a1c'; ctx.beginPath(); ctx.arc(bx, by + 2, 8, 0, 6.283); ctx.fill();
  }
  if (s.glow) {                                   // pulsing magic / shrine / lantern glow
    const pulse = 0.65 + 0.35 * Math.sin(t * 3 + b.id), gx = cx + s.glow.x, gy = cy + s.glow.y, c = s.glow.color, lamp = b.type === 'lantern', rr = lamp ? 38 : 46;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(gx, gy, 2, gx, gy, rr * (0.8 + 0.2 * pulse));
    gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${(lamp ? 0.5 : 0.55) * pulse})`); gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(gx, gy, rr, 0, 6.283); ctx.fill(); ctx.restore();
    if (b.type === 'magetower' && b.recoil > 0) { ctx.fillStyle = `rgba(255,255,255,${b.recoil * 3})`; ctx.beginPath(); ctx.arc(gx, gy, 14, 0, 6.283); ctx.fill(); }
    if (b.type === 'shrine' && Math.random() < 0.08) V.parts.push({ x: gx + rnd(-10, 10), y: gy + 4, vx: rnd(-6, 6), vy: -26, life: 1.1, max: 1.1, c: '#bfffcf', s: 2.5, g: -4 });
  }
  if (s.spray && Math.random() < 0.5) V.parts.push({ x: cx + s.spray.x + rnd(-2, 2), y: cy + s.spray.y, vx: rnd(-14, 14), vy: rnd(-50, -30), life: 0.7, max: 0.7, c: '#cfeaff', s: 2.2, g: 150 });
  if (b.type === 'trap' && !b.armed) { ctx.fillStyle = 'rgba(30,30,30,.55)'; ctx.beginPath(); ctx.ellipse(cx, cy, 14, 7, 0, 0, 6.283); ctx.fill(); }
  if (b.type === 'goldmine' && Math.random() < 0.04) V.parts.push({ x: cx + rnd(-30, 20), y: cy + rnd(-40, -4), vx: 0, vy: -10, life: 0.5, max: 0.5, c: '#ffe9a0', s: 3, g: 0 });
  // collector bubble
  if (d.kind === 'collector') {
    const ready = b.prod >= Math.min(30, d.store[b.level - 1] * 0.15);
    if (ready) {
      const by = cy - 92 - (b.w + b.d) * 4 + Math.sin(t * 3 + b.id) * 3;
      ctx.fillStyle = 'rgba(20,34,38,.92)'; ctx.beginPath(); ctx.arc(cx, by, 17, 0, 6.283); ctx.fill();
      ctx.strokeStyle = b.prod >= d.store[b.level - 1] - 1 ? '#ff7a5a' : '#e0b660'; ctx.lineWidth = 2.5; ctx.stroke();
      Assets.item(ctx, d.res === 'gold' ? 'coin' : 'trunk', cx, by - 1, 22);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.fillText(Math.floor(b.prod), cx, by + 29);
    }
  }
  if (b.hp < b.maxHp && d.kind !== 'decor') drawBar(cx, cy - 78 - (b.w + b.d) * 4, 40 + b.w * 7, b.hp / b.maxHp, { ent: b, h: 6 });
  if (V.selected === b) selectionRing(b);
}
function diamond(i, j, w, d, fill, stroke, lw) {
  ctx.beginPath(); ctx.moveTo(isoX(i, j), isoY(i, j)); ctx.lineTo(isoX(i + w, j), isoY(i + w, j)); ctx.lineTo(isoX(i + w, j + d), isoY(i + w, j + d)); ctx.lineTo(isoX(i, j + d), isoY(i, j + d)); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
}
function selectionRing(b) {
  const p = 0.5 + 0.5 * Math.sin(UI.time * 5);
  diamond(b.i - 0.08, b.j - 0.08, b.w + 0.16, b.d + 0.16, `rgba(240,200,110,${0.12 + p * 0.1})`, `rgba(250,214,130,${0.7 + p * 0.3})`, 2.5);
  rangeRing(b);
}
function rangeRing(b) {
  const d = BDEF[b.type];
  if (!d.range) return;
  const cx = isoX(b.i + b.w / 2, b.j + b.d / 2), cy = isoY(b.i + b.w / 2, b.j + b.d / 2), r = d.range;
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 45.25, r * 22.6, 0, 0, 6.283); ctx.fill(); ctx.stroke();
}

// ---------------------------------------------------------------- units
// ---------------------------------------------------------------- bars
// Rounded bars with a dark rim, a vertical gloss, a gradient that follows the health colour, and a pale
// "damage trail" that drains behind the real value so you can see how big a hit was.
function barColors(f) {
  return f > 0.6 ? ['#a6e66a', '#58b034', '#2f7a1e'] : f > 0.3 ? ['#ffd96a', '#e0a020', '#9a6410'] : ['#ff8a72', '#e0402e', '#8a1e14'];
}
function rr(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawBar(x, y, w, f, o) {
  o = o || {}; f = clamp(f, 0, 1);
  const h = o.h || 6, ent = o.ent, x0 = x - w / 2;
  let trail = f;
  if (ent) {                                    // the trail lags the value: it holds, then drains
    if (ent._bt === undefined || ent._bt < f) ent._bt = f;
    if (ent._bf !== undefined && f < ent._bf - 0.001) ent._bhold = 0.35;
    ent._bf = f; ent._bhold = Math.max(0, (ent._bhold || 0) - UI.dt);
    if (!ent._bhold) ent._bt = Math.max(f, ent._bt - UI.dt * 0.6);
    trail = ent._bt;
  }
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,12,.78)'; rr(x0 - 1.5, y - 1.5, w + 3, h + 3, (h + 3) / 2); ctx.fill();
  ctx.fillStyle = '#2a3036'; rr(x0, y, w, h, h / 2); ctx.fill();
  if (trail > f + 0.002) { ctx.fillStyle = '#f4efe0'; rr(x0, y, Math.max(h, w * trail), h, h / 2); ctx.fill(); }
  if (f > 0.001) {
    const c = o.col || barColors(f), fw = Math.max(h, w * f), g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, c[0]); g.addColorStop(0.5, c[1]); g.addColorStop(1, c[2]);
    ctx.fillStyle = g; rr(x0, y, fw, h, h / 2); ctx.fill();
    ctx.save(); rr(x0, y, fw, h, h / 2); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(x0, y + 0.6, fw, h * 0.32);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x0, y + h * 0.78, fw, h * 0.22);
    ctx.restore();
  }
  if (o.ticks) { ctx.fillStyle = 'rgba(0,0,0,.42)'; for (let k = 1; k < o.ticks; k++) ctx.fillRect(x0 + w * k / o.ticks - 0.5, y + 0.5, 1, h - 1); }
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 0.8; rr(x0, y, w, h, h / 2); ctx.stroke();
  ctx.restore();
}
function nameTag(x, y, text, color) {
  ctx.font = 'bold 10px Georgia, serif'; ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,12,.85)'; ctx.strokeText(text, x, y); ctx.fillStyle = color || '#ffe9a8'; ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------- people (one pixel-art character, eight facings)
const heroTier = () => heroTierNow();
// facing on screen: 0 = towards the camera, PI/2 = screen-right, PI = away, -PI/2 = screen-left
function yawOf(u) { const f = u.fdir || { x: 0.7, y: 0.7 }; return Math.atan2(f.x - f.y, f.x + f.y); }
function turnTo(u, target, rate) {
  if (u.yawS === undefined) { u.yawS = target; return u.yawS; }
  let d = target - u.yawS; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832;
  u.yawS += d * Math.min(1, UI.dt * rate); return u.yawS;
}
// the bright crescent a sword leaves: an arc in front of the fighter, sweeping across during the slash
function swordArc(x, y, side, u) {
  const k = clamp((u - 0.3) / 0.38, 0, 1); if (k <= 0 || u > 0.85) return;
  const a0 = side > 0 ? -2.3 : -0.84, dir = side > 0 ? 1 : -1, cy = y - 28, R = 30;
  ctx.save(); ctx.lineCap = 'round';
  for (let n = 0; n < 9; n++) {
    const t1 = k - n * 0.07, t0 = k - (n + 1) * 0.07; if (t0 < 0) break;
    ctx.strokeStyle = `rgba(255,248,222,${0.8 * (1 - n / 9) * (1 - clamp((u - 0.68) / 0.17, 0, 1))})`; ctx.lineWidth = 7 - n * 0.6;
    ctx.beginPath(); ctx.ellipse(x + side * 4, cy, R, R * 0.8, 0, a0 + dir * 1.9 * Math.max(0, t0), a0 + dir * 1.9 * t1, dir < 0); ctx.stroke();
  }
  ctx.restore();
}
function unitRing(x, y, rx, color, pulse) {
  const p = 0.5 + 0.5 * Math.sin(UI.time * 5);
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.65 + 0.35 * p; ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.5, 0, 0, 6.283); ctx.stroke();
  ctx.globalAlpha = 0.12 + 0.08 * p; ctx.fillStyle = color; ctx.fill(); ctx.restore();
}
// Walk animation follows the ground: the phase advances with the distance actually travelled on screen (one full
// stride cycle per 62 px at sprite scale 1), so the feet do not skate however fast a unit moves.
function stridePhase(u, x, y, s) {
  const lx = u._lx, ly = u._ly; u._lx = x; u._ly = y;
  if (lx === undefined) return u._ph || 0;
  const d = Math.hypot(x - lx, y - ly);
  if (d > 0.05 && d < 60) u._ph = (u._ph || 0) + d / (62 * s) * 6.2832;
  return u._ph || 0;
}
function drawHero(h, t) {
  const x = isoX(h.i, h.j), y = isoY(h.i, h.j) + 2, S = 1.0;
  const moving = (h.path && h.path.length > 0) || h.kbMove, yaw = turnTo(h, yawOf(h), 14), sph = stridePhase(h, x, y, S);
  const dim = h.inv > 0 && h.hurt <= 0 && Math.floor(h.inv * 20) % 2 === 0 ? 0.6 : 1;
  const tier = heroTier(), variant = tier ? 'a' + tier : 'hero';
  const o = { ref: h, x, y, s: S, yaw, kind: 'idle', u: 0, ph: 0, t, variant, alpha: dim, side: h.face || 1 };
  if (h.dead) {
    shadowAt(x, y, 17, 6, 0.28);
    o.kind = 'dead'; o.deadT = Math.max(0, 12 - h.respawn); o.alpha = 0.95; Hero.draw(ctx, o); return;
  }
  shadowAt(x, y, 15, 6.5, 0.3);
  if (V.selHero) unitRing(x, y, 24, '#ffe08a');
  if (h.hurt > 0) { o.kind = 'hurt'; o.flash = 'rgba(255,50,40,.45)'; }
  else if (h.strikeT >= 0) { o.kind = 'strike'; o.u = clamp(h.strikeT / 0.5, 0, 1); }
  else if (h.atk >= 0) { o.kind = 'attack'; o.u = clamp(h.atk / 0.39, 0, 1); }
  else if (h.chopping) { o.kind = 'chop'; o.u = (h.chop % 0.9) / 0.9; }
  else if (moving) { o.kind = 'walk'; o.ph = sph; }
  Hero.draw(ctx, o); h._flip = o._flip; h._frame = o._name;
  if (o.kind === 'attack') swordArc(x, y, Math.abs(Math.sin(yaw)) > 0.2 ? Math.sign(Math.sin(yaw)) : (h.face || 1), o.u);
  if (o.kind === 'strike') {                                 // charge: light gathers on the raised blade; slam: ground flash
    const side = Math.abs(Math.sin(yaw)) > 0.2 ? Math.sign(Math.sin(yaw)) : (h.face || 1);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (o.u < 0.45) { const k = o.u / 0.45, gx = x + side * 6, gy = y - 74, r = 10 + k * 26; const gr = ctx.createRadialGradient(gx, gy, 1, gx, gy, r); gr.addColorStop(0, `rgba(210,240,255,${0.5 + 0.4 * k})`); gr.addColorStop(1, 'rgba(120,190,255,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(gx, gy, r, 0, 6.283); ctx.fill(); }
    else { const k = clamp((o.u - 0.4) / 0.4, 0, 1); ctx.strokeStyle = `rgba(190,235,255,${0.8 * (1 - k)})`; ctx.lineWidth = 5 * (1 - k) + 1; ctx.beginPath(); ctx.ellipse(x, y - 2, 20 + k * 90, 9 + k * 40, 0, 0, 6.283); ctx.stroke(); const gr = ctx.createRadialGradient(x, y - 2, 2, x, y - 2, 60 * (0.4 + k)); gr.addColorStop(0, `rgba(220,245,255,${0.45 * (1 - k)})`); gr.addColorStop(1, 'rgba(120,190,255,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y - 2, 60 * (0.4 + k), 30 * (0.4 + k), 0, 0, 6.283); ctx.fill(); }
    ctx.restore();
  }
  drawBar(x, y - 74, 36, h.hp / h.maxHp, { ent: h, h: 6, col: ['#8fd0ff', '#3f90e0', '#1f5aa0'] });
  nameTag(x, y - 80, 'Lv ' + V.heroLevel);
}
function drawGuard(gd, t) {
  const x = isoX(gd.i, gd.j), y = isoY(gd.i, gd.j) + 2;
  shadowAt(x, y, 14, 5.5, 0.28);
  const sph = stridePhase(gd, x, y, 0.94), yaw = turnTo(gd, yawOf(gd), 12), walking = gd.path && gd.path.length > 0 && gd.atk < 0;
  const o = { ref: gd, x, y, s: 0.94, yaw, kind: 'idle', u: 0, ph: 0, t: t + gd.id, variant: 'a' + clamp(gd.level, 1, 3), side: gd.face || 1 };
  if (gd.atk >= 0) { o.kind = 'attack'; o.u = clamp(gd.atk / 0.45, 0, 1); }
  else if (walking) { o.kind = 'walk'; o.ph = sph; }
  if (gd.hurt > 0) o.flash = 'rgba(255,50,40,.4)';
  Hero.draw(ctx, o);
  if (o.kind === 'attack') swordArc(x, y, o.side, o.u);
  if (gd.hp < gd.maxHp) drawBar(x, y - 70, 28, gd.hp / gd.maxHp, { ent: gd, h: 5, col: ['#8fd0ff', '#3f90e0', '#1f5aa0'] });
}
function enemyFrame(e) {
  const g = e.d.g, t = e.walkT;
  const loop = (grp, fps) => [grp, Math.floor(t * fps) % Assets.count(grp)];
  if (e.dying) {
    if (g.die) { const n = Assets.count(g.die), per = e.boss ? 0.28 : 0.13; return [g.die, Math.min(n - 1, Math.floor(e.dieT / per))]; }
    return [g.idle || g.walk, 0];
  }
  switch (e.type) {
    case 'zombie': case 'skeleton':
      if (e.atk >= 0) return [g.atk, Math.min(3, Math.floor(e.atk / 0.55 * 4))];
      return (e.path && e.path.length) || e.dir && !e.blocker ? loop(g.walk, 6) : loop(g.idle, 3);
    case 'spawn': return loop(g.walk, 8);
    case 'necro':
      if (e.atk >= 0) return [g.cast, Math.min(5, Math.floor(e.atk / 0.8 * 6))];
      return e.path && e.path.length ? loop(g.walk, 5) : loop(g.idle, 3);
    case 'knight':
      if (e.atk >= 0) return [g.swing, Math.min(6, Math.floor(e.atk / 0.55 * 7))];
      return e.path && e.path.length ? loop(g.walk, 6) : loop(g.idle, 4);
    case 'king':
      if (e.atk >= 0) return [g.beam, Math.min(6, Math.floor(e.atk / 0.8 * 7))];
      return loop(g.walk, 5);
  }
  return [g.idle || g.walk, 0];
}
function drawEnemy(e, t) {
  const x = isoX(e.i, e.j), y = isoY(e.i, e.j) + 2;
  const hover = e.flying && !e.dying ? 26 + Math.sin(e.hover * 3) * 3 : 0;
  shadowAt(x, y, e.boss ? 20 : 12, e.boss ? 9 : 5, e.flying ? 0.18 : 0.3);
  if (V.selEnemy === e) unitRing(x, y, e.boss ? 34 : 20, '#ff8a70');
  if (V.hero && V.hero.order && V.hero.order.type === 'attack' && V.hero.order.e === e && !e.dying) {     // the hero's current target
    const k = 0.5 + 0.5 * Math.sin(UI.time * 8), yy = y - hover - (e.boss ? 100 : 62) - k * 3;
    ctx.save(); ctx.fillStyle = '#ff5a40'; ctx.strokeStyle = 'rgba(40,10,6,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 7, yy - 9); ctx.lineTo(x + 7, yy - 9); ctx.lineTo(x, yy); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
  }
  const [grp, idx] = enemyFrame(e);
  ctx.save();
  if (e.dying && e.d.g.die == null) ctx.globalAlpha = Math.max(0, 1 - e.dieT / 0.7);
  else if (e.dying && e.dieT > (e.boss ? 1.8 : 1.0)) ctx.globalAlpha = Math.max(0, 1 - (e.dieT - (e.boss ? 1.8 : 1.0)) / 0.6);
  Assets.char(ctx, grp, idx, x, y - hover, e.d.scale, e.face < 0);
  if (e.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5; Assets.char(ctx, grp, idx, x, y - hover, e.d.scale, e.face < 0); }
  ctx.restore();
  if (!e.dying && !e.boss && e.hp < e.maxHp) drawBar(x, y - hover - 44 * e.d.scale / 0.55 * 0.62, 26, e.hp / e.maxHp, { ent: e, h: 5, col: ['#ff9a80', '#d8402c', '#7a1810'] });
}
function drawProj(p) {
  const x = isoX(p.i, p.j), arc = p.kind === 'ball' ? Math.sin(Math.min(1, 1 - Math.hypot(p.ti - p.i, p.tj - p.j) / Math.max(0.01, p.d0 || 1)) * Math.PI) * 28 : 0;
  const y = isoY(p.i, p.j) - p.z - arc;
  if (p.kind === 'arrow') {
    const dx = (p.ti - p.tj) - (p.i - p.j), dy = ((p.ti + p.tj) - (p.i + p.j)) * 0.5, l = Math.hypot(dx, dy) || 1;
    ctx.strokeStyle = '#f0e0b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - dx / l * 10, y - dy / l * 10); ctx.lineTo(x + dx / l * 4, y + dy / l * 4); ctx.stroke();
  } else if (p.kind === 'ball') {
    shadowAt(x, isoY(p.i, p.j), 6, 3, 0.3); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.fill(); ctx.fillStyle = '#666'; ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 2, 0, 6.283); ctx.fill();
  } else {
    const grp = p.kind === 'skull' ? 'king_beam' : 'necro_cast', idx = p.kind === 'skull' ? 7 + Math.floor(p.t * 12) % 5 : 6 + Math.floor(p.t * 10) % 2;
    const f = SPRITES.chars[grp][idx], sc = p.kind === 'skull' ? 0.7 : 0.9;
    const dx = (p.ti - p.tj) - (p.i - p.j), dy = ((p.ti + p.tj) - (p.i + p.j)) * 0.5;
    let a = Math.atan2(dy, dx), flip = false; if (Math.cos(a) < 0) { flip = true; a = Math.atan2(dy, -dx); }
    ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1); ctx.rotate(a);
    ctx.drawImage(Assets.chars, f[0], f[1], f[2], f[3], -f[2] * sc / 2, -f[3] * sc / 2, f[2] * sc, f[3] * sc); ctx.restore();
  }
}

// ---------------------------------------------------------------- placement ghost
function placeAnchor(type, mi, mj) {
  const d = BDEF[type];
  return { i: Math.round(mi - d.w / 2), j: Math.round(mj - d.d / 2) };
}
function drawGhost() {
  const pl = UI.place; if (!pl || !UI.mouse.in) return;
  const d = BDEF[pl.type], h = UI.hover, ok = !h.why;
  // grid around the cursor
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
  for (let i = h.i - 4; i <= h.i + d.w + 4; i++) for (let j = h.j - 4; j <= h.j + d.d + 4; j++) if (inGrid(i, j)) {
    ctx.beginPath(); ctx.moveTo(isoX(i, j), isoY(i, j)); ctx.lineTo(isoX(i + 1, j), isoY(i + 1, j)); ctx.lineTo(isoX(i + 1, j + 1), isoY(i + 1, j + 1)); ctx.stroke();
  }
  for (let j = h.j; j < h.j + d.d; j++) for (let i = h.i; i < h.i + d.w; i++) {
    const free = inGrid(i, j) && V.occ[j * GN + i] === 0 && i >= 1 && j >= 1 && i < GN - 1 && j < GN - 1 && Terr.has(i, j);
    diamond(i, j, 1, 1, free && ok ? 'rgba(110,220,110,.35)' : free ? 'rgba(230,200,90,.3)' : 'rgba(230,80,70,.42)', 'rgba(255,255,255,.35)', 1);
  }
  const s = BART.get(pl.type, 1, pl.type === 'wall' ? 0 : 0), cx = isoX(h.i + d.w / 2, h.j + d.d / 2), cy = isoY(h.i + d.w / 2, h.j + d.d / 2);
  ctx.globalAlpha = 0.72; ctx.drawImage(s.canvas, cx - s.ox, cy - s.oy); ctx.globalAlpha = 1;
  if (d.range) rangeRing({ type: pl.type, i: h.i, j: h.j, w: d.w, d: d.d });
}

// ---------------------------------------------------------------- depth ordering
// Painter's order by (i + j) is wrong for things standing beside or in front of a big footprint: a unit just in
// front of the Town Hall has a smaller sum than the Hall's far corner, so the Hall was painted over its body and
// only the legs showed. A unit is in front of a rectangle when it lies beyond its front edge on either axis.
function unitDepth(u, v) {
  let k = u + v;
  for (const b of V.buildings) {
    if (u < b.i - 3 || u > b.i + b.w + 3 || v < b.j - 3 || v > b.j + b.d + 3) continue;
    const bk = b.i + b.j + b.w + b.d - 0.2 + (b.state === 'ruin' ? -1 : 0);
    k = (u >= b.i + b.w || v >= b.j + b.d) ? Math.max(k, bk + 0.02) : Math.min(k, bk - 0.02);
  }
  for (const t of V.trees) {
    if (!t.alive || Math.abs(t.i + 0.5 - u) > 2.2 || Math.abs(t.j + 0.5 - v) > 2.2) continue;
    const tk = t.i + t.j + 1 + t.ox + t.oj;
    k = (u >= t.i + 1 + t.ox || v >= t.j + 1 + t.oj) ? Math.max(k, tk + 0.02) : Math.min(k, tk - 0.02);
  }
  return k;
}

// ---------------------------------------------------------------- frame
function render(ts) {
  const t = ts / 1000; UI.dt = Math.min(0.1, Math.max(0.001, t - (UI.time || t))); UI.time = t;
  const sh = V.shake ? (Math.random() - 0.5) * V.shake : 0, sh2 = V.shake ? (Math.random() - 0.5) * V.shake : 0;
  ctx.setTransform(UI.dpr, 0, 0, UI.dpr, 0, 0);
  drawWater(t);
  const z = UI.cam.zoom;
  ctx.setTransform(UI.dpr * z, 0, 0, UI.dpr * z, UI.dpr * (UI.W / 2 - UI.cam.x * z + sh), UI.dpr * (UI.H / 2 - UI.cam.y * z + sh2));
  ctx.imageSmoothingEnabled = true;
  Ground.draw(ctx);
  const view0 = { x0: worldX(-160), x1: worldX(UI.W + 160), y0: worldY(-260), y1: worldY(UI.H + 100) };
  const lifeOn = Life.sync();
  if (lifeOn) { const pz = Life.plaza; ctx.drawImage(pz.canvas, pz.x, pz.y); Life.drawShadows(ctx, view0); }
  // gather drawables with a depth key
  const L = [];
  const vx0 = worldX(-160), vx1 = worldX(UI.W + 160), vy0 = worldY(-260), vy1 = worldY(UI.H + 100);
  const sway = UI.cam.zoom > 0.85, reach = Terr.r + 4;     // trees under the cloud bank are never drawn
  for (const tr of V.trees) {
    if (!tr.alive || Math.abs(tr.i - MID) > reach || Math.abs(tr.j - MID) > reach) continue;
    const x = isoX(tr.i + 0.5, tr.j + 0.5), y = isoY(tr.i + 0.5, tr.j + 0.5);
    if (x < vx0 || x > vx1 || y < vy0 || y > vy1 + 120) continue;
    L.push({ k: tr.i + tr.j + 1 + tr.ox + tr.oj, f: () => Trees.draw(ctx, tr, t, sway) });
  }
  for (const b of V.buildings) {
    const x = isoX(b.i + b.w / 2, b.j + b.d / 2), y = isoY(b.i + b.w / 2, b.j + b.d / 2);
    if (x < vx0 - 100 || x > vx1 + 100 || y < vy0 - 100 || y > vy1 + 100) continue;
    L.push({ k: b.i + b.j + b.w + b.d - 0.2 + (b.state === 'ruin' ? -1 : 0), f: () => drawBuilding(b, t) });
  }
  if (lifeOn) {
    for (const p of Life.props) if ((!p.wild || Terr.has(p.i, p.j)) && Math.abs(isoX(p.i, p.j) - UI.cam.x) < UI.W / z / 2 + 200 && Math.abs(isoY(p.i, p.j) - UI.cam.y) < UI.H / z / 2 + 200 && Life.propLive(p)) L.push({ k: p.i + p.j + (p.type === 'well' ? 2 : 1), f: () => Life.drawProp(ctx, p, t) });
    for (const v of V.villagers) if (!v.hidden) L.push({ k: unitDepth(v.i, v.j), f: () => Life.drawVillager(ctx, v, t) });
  }
  if (V.hero) L.push({ k: unitDepth(V.hero.i, V.hero.j), f: () => drawHero(V.hero, t) });
  for (const g of V.guards) L.push({ k: unitDepth(g.i, g.j), f: () => drawGuard(g, t) });
  for (const e of V.enemies) L.push({ k: e.flying ? e.i + e.j + 6 : unitDepth(e.i, e.j), f: () => drawEnemy(e, t) });
  L.sort((a, b) => a.k - b.k);
  for (const o of L) o.f();
  for (const p of V.proj) drawProj(p);
  // effects
  for (const r of V.rings) { const f = r.t / 0.5, rr = r.r + (r.max - r.r) * f, col = r.green ? '170,255,190' : r.blue ? '150,200,255' : '255,240,200'; ctx.strokeStyle = `rgba(${col},${0.7 * (1 - f)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(isoX(r.i, r.j), isoY(r.i, r.j), rr * 45.25, rr * 22.6, 0, 0, 6.283); ctx.stroke(); }
  for (const f of V.slashFx) {                       // impact slash: a white crescent with sparks where a blow lands
    const k = f.t / 0.32, x = isoX(f.i, f.j), y = isoY(f.i, f.j) - 26;
    ctx.save(); ctx.translate(x, y); ctx.rotate(f.a - 0.5); ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.moveTo(-26 * (0.6 + k), 8); ctx.quadraticCurveTo(0, -18 * (1 - k * 0.4), 26 * (0.6 + k), 8); ctx.quadraticCurveTo(0, -4, -26 * (0.6 + k), 8); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (const p of V.parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.c; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 13px "Courier New", monospace'; ctx.textAlign = 'center';
  for (const tx of V.texts) { const a = 1 - tx.t / tx.life; ctx.globalAlpha = a; const x = isoX(tx.i, tx.j), y = isoY(tx.i, tx.j) - tx.z - tx.t * 26; ctx.fillStyle = '#000'; ctx.fillText(tx.text, x + 1, y + 1); ctx.fillStyle = tx.color; ctx.fillText(tx.text, x, y); }
  ctx.globalAlpha = 1;
  if (lifeOn) { Life.drawAmbient(ctx, view0, t); Life.drawLight(ctx, view0, t); }
  if (UI.place) drawGhost();
  else if (UI.tool === 'gather' && UI.mouse.in) { const tr = UI.hoverTree; if (tr) { diamond(tr.i, tr.j, 1, 1, 'rgba(230,200,120,.35)', 'rgba(255,230,150,.9)', 2); } }
  Clouds.draw(ctx, t, { x0: vx0, x1: vx1, y0: vy0, y1: vy1 });
  // screen-space overlays
  ctx.setTransform(UI.dpr, 0, 0, UI.dpr, 0, 0);
  Life.drawVignette(ctx, UI.W, UI.H);
  const boss = V.enemies.find(e => e.boss && !e.dying);
  if (boss) {
    const bw = Math.min(460, UI.W - 40), bx = UI.W / 2 - bw / 2, by = 96, f = boss.hp / boss.maxHp, kc = boss.type === 'king' ? ['#c28aff', '#8a3ad0', '#4a1a80'] : ['#ff9a5a', '#d6561f', '#7a2208'];
    ctx.save();
    ctx.font = 'bold 16px Georgia, serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,10,12,.9)'; ctx.strokeText(boss.d.name, UI.W / 2, by - 8); ctx.fillStyle = '#ffd8c0'; ctx.fillText(boss.d.name, UI.W / 2, by - 8);
    drawBar(UI.W / 2, by, bw, f, { ent: boss, h: 14, col: kc, ticks: 10 });
    // ornate end caps
    for (const sd of [-1, 1]) { const ex = UI.W / 2 + sd * (bw / 2 + 12), ey = by + 7; ctx.fillStyle = '#c9a050'; ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ex, ey - 11); ctx.lineTo(ex + sd * 9, ey); ctx.lineTo(ex, ey + 11); ctx.lineTo(ex - sd * 5, ey); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  if (UI.banner) {
    const b = UI.banner, a = b.t < 0.4 ? b.t / 0.4 : b.t > 2.6 ? (3 - b.t) / 0.4 : 1;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fillStyle = 'rgba(8,14,18,.55)'; ctx.fillRect(0, UI.H * 0.26 - 44, UI.W, 100);
    ctx.fillStyle = '#f3ead0'; ctx.font = 'bold 40px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText(b.text, UI.W / 2, UI.H * 0.26 + 4);
    ctx.fillStyle = '#c9d8d0'; ctx.font = '15px "Courier New", monospace'; ctx.fillText(b.sub, UI.W / 2, UI.H * 0.26 + 34);
    ctx.globalAlpha = 1;
  }
  if (V.paused) { ctx.fillStyle = 'rgba(8,14,18,.5)'; ctx.fillRect(0, 0, UI.W, UI.H); ctx.fillStyle = '#f3ead0'; ctx.font = 'bold 34px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('Paused', UI.W / 2, UI.H / 2); }
}
