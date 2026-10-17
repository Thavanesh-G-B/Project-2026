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
function hpBar(x, y, w, f, col) {
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
  ctx.fillStyle = col || (f > 0.5 ? '#78c850' : f > 0.25 ? '#e0b030' : '#d84a3a'); ctx.fillRect(x - w / 2, y, w * clamp(f, 0, 1), 4);
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
  ctx.drawImage(s.canvas, cx - s.ox + shake, cy - s.oy);
  if (b.flash > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35; ctx.drawImage(s.canvas, cx - s.ox + shake, cy - s.oy); ctx.restore(); }
  if (s.flag) drawFlag(cx + s.flag.x, cy + s.flag.y, s.flag.h, s.flag.color, t);
  if (b.type === 'cannon' || b.type === 'mortar') {
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
  if (b.hp < b.maxHp && d.kind !== 'decor') hpBar(cx, cy - 78 - (b.w + b.d) * 4, 36 + b.w * 6, b.hp / b.maxHp);
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
// ---------------------------------------------------------------- front / back walkers
// Only side-view art exists for the hero, so walking towards or away from the camera is drawn in code in the
// same colours: swinging arms, alternating legs, a bobbing body, the sword on the hip (front) or back (back).
const ARM_PAL = [null, { m: '#8b94a6', d: '#505a6e', l: '#d2dae8' }, { m: '#d4a22c', d: '#82600f', l: '#f6de88' }, { m: '#44aee0', d: '#1a64a0', l: '#d0f4ff' }];
function viewOf(u) {
  const d = u.dir; if (!d) return null;
  const sx = d.x - d.y, sy = (d.x + d.y) * 0.5;
  if (Math.abs(sx) < Math.abs(sy) * 0.8) return sy > 0 ? 'front' : 'back';
  return null;
}
function drawWalker(c, x, y, u, view, phase, tiers, moving) {
  const front = view === 'front', OL = 'rgba(30,20,16,.62)';
  const cw = moving ? Math.cos(phase) : 0, bob = moving ? Math.abs(cw) * 1.5 : Math.sin(UI.time * 2) * 0.4;
  const pal = (t, base) => (t ? ARM_PAL[t] : base);
  const hair = pal(tiers.head, { m: '#8a5a34', d: '#573820', l: '#b98250' });
  const tun = pal(tiers.chest, { m: '#3f6aa8', d: '#27467c', l: '#6c96d0' });
  const pants = pal(tiers.legs, { m: '#8e846c', d: '#5f5644', l: '#b4aa90' });
  const boots = pal(tiers.legs, { m: '#6e442a', d: '#3a2314', l: '#94603c' });
  const skin = '#e9b690', skinD = '#c68e6a';
  c.save(); c.translate(x, y); c.scale(u, u); c.lineJoin = 'round'; c.lineCap = 'round';
  const hg = (x0, x1, a, b, cc) => { const g = c.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, a); g.addColorStop(0.55, b); g.addColorStop(1, cc); return g; };
  const stroke = (w) => { c.lineWidth = (w || 0.8) / u * 0.9; c.strokeStyle = OL; c.stroke(); };
  const path = (pts, fill, line) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) c.lineTo(pts[k][0], pts[k][1]); c.closePath(); c.fillStyle = fill; c.fill(); if (line !== false) stroke(); };
  const rr = (x0, y0, w, h, r, fill) => { c.beginPath(); c.roundRect(x0, y0, w, h, r); c.fillStyle = fill; c.fill(); stroke(); };

  // ---- legs: tapered, the one swinging towards the camera is lower
  const legs = [-1, 1].map(side => { const ph = phase + (side > 0 ? Math.PI : 0), sn = moving ? Math.sin(ph) : 0, k = moving ? Math.cos(ph) : 0; return { side, lift: Math.max(0, sn) * 4.4, dy: (front ? 1 : -1) * k * 2.0 }; }).sort((a, b) => a.dy - b.dy);
  for (const L of legs) {
    const hx = L.side * 3.9, hy = -19 - bob, fy = -L.lift + L.dy, bx = hx + L.side * 0.7;
    c.beginPath(); c.moveTo(hx - 3.7, hy); c.lineTo(hx + 3.7, hy); c.quadraticCurveTo(bx + 3.6, (hy + fy) / 2, bx + 2.7, fy - 6.6); c.lineTo(bx - 2.7, fy - 6.6); c.quadraticCurveTo(bx - 3.6, (hy + fy) / 2, hx - 3.7, hy); c.closePath();
    c.fillStyle = hg(hx - 3.7, hx + 3.7, pants.l, pants.m, pants.d); c.fill(); stroke();
    // boot: cuff, shaft, rounded toe
    c.beginPath(); c.moveTo(bx - 3.4, fy - 7.4); c.lineTo(bx + 3.4, fy - 7.4); c.lineTo(bx + 3.9, fy - 1.8); c.quadraticCurveTo(bx + 4.4 + (front ? L.side * 0.6 : 0), fy + 0.8, bx + 1.6, fy + 0.8); c.lineTo(bx - 1.6, fy + 0.8); c.quadraticCurveTo(bx - 4.4 + (front ? L.side * 0.6 : 0), fy + 0.8, bx - 3.9, fy - 1.8); c.closePath();
    c.fillStyle = hg(bx - 4, bx + 4, boots.l, boots.m, boots.d); c.fill(); stroke();
    c.fillStyle = boots.d; c.fillRect(bx - 3.5, fy - 7.4, 7, 1.3); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(bx - 4, fy - 0.4, 8, 1.2);
  }
  // ---- arm: short sleeve, skin forearm with a leather bracer, small hand
  const arm = (side) => {
    const sn = moving ? Math.sin(phase + (side > 0 ? 0 : Math.PI)) : 0, sx = side * 9.5, sy = -34.5 - bob, swing = sn * 3.0 * (front ? 1 : -1), hx = side * (11.2 + (front ? 0.4 : 0.2)), hy = sy + 12.6 + swing;
    c.beginPath(); c.moveTo(sx - 3.2, sy); c.quadraticCurveTo(sx + side * 2.6, sy - 1.6, sx + 3.2, sy + 0.6); c.lineTo(hx + 2.7, sy + 7.4); c.lineTo(hx - 2.7, sy + 7.4); c.closePath();
    c.fillStyle = hg(sx - 3, sx + 3, tun.l, tun.m, tun.d); c.fill(); stroke();
    c.beginPath(); c.moveTo(hx - 2.4, sy + 7.2); c.lineTo(hx + 2.4, sy + 7.2); c.lineTo(hx + 2.2, hy - 1.2); c.lineTo(hx - 2.2, hy - 1.2); c.closePath(); c.fillStyle = skin; c.fill(); stroke();
    c.fillStyle = '#5e3c22'; c.fillRect(hx - 2.6, sy + 8.4, 5.2, 3.6); c.strokeStyle = OL; c.lineWidth = 0.6; c.strokeRect(hx - 2.6, sy + 8.4, 5.2, 3.6);
    c.fillStyle = skin; c.beginPath(); c.ellipse(hx, hy + 0.6, 2.3, 2.7, 0, 0, 6.283); c.fill(); stroke(0.7);
  };
  if (!front) { arm(-1); arm(1); }
  // ---- torso and tunic hem
  c.beginPath(); c.moveTo(-9.6, -35.5 - bob); c.quadraticCurveTo(0, -38.6 - bob, 9.6, -35.5 - bob); c.lineTo(8, -20 - bob); c.lineTo(-8, -20 - bob); c.closePath();
  c.fillStyle = hg(-9.6, 9.6, tun.l, tun.m, tun.d); c.fill(); stroke();
  c.beginPath(); c.moveTo(-8.4, -20.4 - bob); c.lineTo(8.4, -20.4 - bob); c.lineTo(9.6, -14.6 - bob * 0.5); c.quadraticCurveTo(0, -12.8 - bob * 0.5, -9.6, -14.6 - bob * 0.5); c.closePath();
  c.fillStyle = hg(-9.6, 9.6, tun.m, tun.m, tun.d); c.fill(); stroke();
  c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(0, -20 - bob); c.lineTo(0, -13.4 - bob * 0.5); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(-8.2, -35 - bob, 7.5, 1.6);
  c.fillStyle = '#5a3a22'; c.fillRect(-8.2, -24.6 - bob, 16.4, 3.6); c.strokeStyle = OL; c.lineWidth = 0.6; c.strokeRect(-8.2, -24.6 - bob, 16.4, 3.6);
  if (front) { c.fillStyle = '#e4be5a'; c.fillRect(-1.5, -25 - bob, 3, 4.4); rr(-9.4, -22.6 - bob, 4.4, 5.2, 1.2, '#6a4628'); }
  // ---- strap and sword
  c.strokeStyle = '#4a2e1a'; c.lineWidth = 2.1; c.beginPath(); if (front) { c.moveTo(-8.4, -34.6 - bob); c.lineTo(7, -22 - bob); } else { c.moveTo(8.4, -34.6 - bob); c.lineTo(-7.4, -22 - bob); } c.stroke();
  if (front) {
    path([[7.2, -26 - bob], [10.2, -26 - bob], [13.8, -6 - bob], [11.6, -6 - bob]], '#5e3e26');
    rr(6.2, -29.4 - bob, 5.4, 2.2, 1, '#e4be5a'); rr(7.8, -34.2 - bob, 2.2, 4.8, 1, '#7a5632');
  } else {
    path([[6.8, -38 - bob], [9.8, -40 - bob], [-6.8, -21 - bob], [-9.2, -23 - bob]], '#6e4e2e');
    rr(7.6, -47 - bob, 7.2, 2.2, 1, '#e4be5a'); rr(10.2, -53 - bob, 2.2, 6.6, 1, '#7a5632'); c.fillStyle = '#e4be5a'; c.beginPath(); c.arc(11.3, -54 - bob, 1.5, 0, 6.283); c.fill();
  }
  if (front) { arm(-1); arm(1); }
  // ---- head
  const hy = -44.4 - bob;
  c.fillStyle = skinD; c.fillRect(-2.4, hy + 4.6, 4.8, 4);
  if (!front) {
    c.fillStyle = hair.d; c.beginPath(); c.ellipse(1.6, hy + 7.4, 2.7, 3.2, 0.2, 0, 6.283); c.fill(); stroke(0.7);      // tied-back hair
  }
  c.beginPath(); c.ellipse(0, hy, 5.7, 6.5, 0, 0, 6.283); c.fillStyle = hg(-5.7, 5.7, '#f2c4a0', skin, skinD); c.fill(); stroke();
  c.fillStyle = skinD; c.beginPath(); c.ellipse(-5.7, hy + 0.8, 1.2, 1.7, 0, 0, 6.283); c.ellipse(5.7, hy + 0.8, 1.2, 1.7, 0, 0, 6.283); c.fill();   // ears
  if (front) {
    c.fillStyle = hair.d; c.beginPath(); c.moveTo(-6.6, hy + 2.6); c.quadraticCurveTo(-8.4, hy - 4, -4.8, hy - 7.6); c.quadraticCurveTo(0, hy - 10.2, 4.8, hy - 7.6); c.quadraticCurveTo(8.4, hy - 4, 6.6, hy + 2.6); c.quadraticCurveTo(7, hy - 3.2, 3.8, hy - 4.2); c.lineTo(-3.8, hy - 4.2); c.quadraticCurveTo(-7, hy - 3.2, -6.6, hy + 2.6); c.closePath(); c.fill(); stroke();
    c.fillStyle = hair.m; c.beginPath(); c.moveTo(-5.8, hy - 4.8); c.quadraticCurveTo(-4.4, hy - 9.4, 0, hy - 8.8); c.quadraticCurveTo(4.6, hy - 9.4, 5.8, hy - 4.8); c.lineTo(3.4, hy - 3.4); c.lineTo(1.4, hy - 5.4); c.lineTo(-0.6, hy - 3.4); c.lineTo(-2.8, hy - 5.2); c.lineTo(-3.8, hy - 3.2); c.closePath(); c.fill();
    c.fillStyle = hair.l; c.fillRect(-3.8, hy - 8, 2.6, 1.2); c.fillRect(1.2, hy - 7.6, 1.8, 1);
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(-2.4, hy + 0.6, 1.5, 1.2, 0, 0, 6.283); c.ellipse(2.4, hy + 0.6, 1.5, 1.2, 0, 0, 6.283); c.fill();
    c.fillStyle = '#2b1a12'; c.beginPath(); c.arc(-2.3, hy + 0.7, 0.9, 0, 6.283); c.arc(2.5, hy + 0.7, 0.9, 0, 6.283); c.fill();
    c.strokeStyle = hair.d; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-3.9, hy - 1.3); c.lineTo(-1.1, hy - 1); c.moveTo(1.1, hy - 1); c.lineTo(3.9, hy - 1.3); c.stroke();
    c.strokeStyle = skinD; c.lineWidth = 0.9; c.beginPath(); c.moveTo(0, hy + 1.4); c.lineTo(-0.5, hy + 3); c.stroke();
    c.strokeStyle = '#9a5848'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-1.3, hy + 4.4); c.quadraticCurveTo(0, hy + 5, 1.3, hy + 4.4); c.stroke();
  } else {
    c.fillStyle = hair.m; c.beginPath(); c.ellipse(0, hy - 0.6, 6.5, 7, 0, 0, 6.283); c.fill(); stroke();
    c.fillStyle = hair.d; c.beginPath(); c.ellipse(1.2, hy + 2.4, 5.2, 4.4, 0.1, 0, 6.283); c.fill();
    c.strokeStyle = hair.l; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-3.8, hy - 5); c.quadraticCurveTo(-1, hy - 6.6, 2, hy - 5.4); c.moveTo(-4.6, hy - 2); c.quadraticCurveTo(-3, hy - 4.2, -0.8, hy - 3.4); c.stroke();
    c.strokeStyle = hair.d; c.beginPath(); c.moveTo(-2.4, hy + 3.6); c.lineTo(-1.6, hy + 6.4); c.moveTo(3.2, hy + 3); c.lineTo(3.6, hy + 6); c.stroke();
  }
  if (tiers.head) {                                                                                 // helmet over the hair
    const H = ARM_PAL[tiers.head];
    c.fillStyle = H.m; c.beginPath(); c.moveTo(-6.8, hy + (front ? 1.4 : 4)); c.quadraticCurveTo(-7.4, hy - 10, 0, hy - 9.8); c.quadraticCurveTo(7.4, hy - 10, 6.8, hy + (front ? 1.4 : 4)); c.lineTo(5.2, hy + (front ? -2.4 : 2)); c.lineTo(-5.2, hy + (front ? -2.4 : 2)); c.closePath(); c.fill(); stroke();
    c.fillStyle = H.l; c.fillRect(-4.4, hy - 8.4, 2.8, 1.6); c.fillStyle = H.d; c.fillRect(-0.7, hy - 9.8, 1.4, front ? 7.6 : 9);
    if (front) { c.fillStyle = H.d; c.fillRect(-0.9, hy - 2.2, 1.8, 5); c.fillStyle = H.m; c.fillRect(-6.4, hy + 0.6, 1.8, 4.2); c.fillRect(4.6, hy + 0.6, 1.8, 4.2); }
  }
  c.restore();
}

const SCALE_HERO = 0.6;
function heroArmor() { const t = Math.min(3, Math.floor((V.heroLevel - 1) / 4)); return { head: t, chest: t, legs: t }; }
function drawHero(h, t) {
  const x = isoX(h.i, h.j), y = isoY(h.i, h.j) + 2;
  shadowAt(x, y, 13, 6, 0.3);
  if (h.dead) { Assets.char(ctx, 'p_death', 3, x, y, SCALE_HERO, h.face < 0); return; }
  const busy = h.hurt > 0 || h.strikeT >= 0 || h.atk >= 0 || (h.order && h.order.type === 'chop' && h.chop > 0);
  const walking = h.path && h.path.length > 0, view = !busy && walking ? viewOf(h) : null;
  let g = 'p_walk', i = 0;
  if (h.hurt > 0) { g = 'p_slash'; i = 6; }
  else if (h.strikeT >= 0) { g = 'p_dash'; i = [1, 2, 3, 4, 4, 6, 7][Math.min(6, Math.floor(h.strikeT / 0.4 * 7))]; }
  else if (h.atk >= 0) { g = 'p_slash'; const dur = [0.06, 0.06, 0.06, 0.07, 0.07, 0.07]; let acc = 0, k = 0; for (; k < 5; k++) { acc += dur[k]; if (h.atk < acc) break; } i = [0, 1, 2, 5, 5, 6][k]; }
  else if (h.order && h.order.type === 'chop' && h.chop > 0) { g = 'p_slash'; i = Math.floor(h.chop * 3) % 2 ? 2 : 1; }
  else if (walking) { i = Math.floor(h.walkT * 9); }
  const dim = h.inv > 0 && h.hurt <= 0 && Math.floor(h.inv * 20) % 2 === 0 ? 0.6 : 1;
  ctx.globalAlpha = dim;
  if (view) drawWalker(ctx, x, y, 1.0, view, h.walkT * 7.05, heroArmor(), true);
  else if (h.hurt > 0) drawTinted(ctx, g, i, x, y, SCALE_HERO, h.face < 0, heroArmor(), 'rgba(255,40,40,.5)');
  else drawPlayerSprite(ctx, g, i, x, y, SCALE_HERO, h.face < 0, heroArmor());
  ctx.globalAlpha = 1;
  hpBar(x, y - 58, 28, h.hp / h.maxHp, '#4aa0e8');
  ctx.fillStyle = '#ffe08a'; ctx.font = 'bold 9px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.fillText('Lv' + V.heroLevel, x, y - 62);
}
const tintC = document.createElement('canvas'); tintC.width = 200; tintC.height = 160;
function drawTinted(c, g, i, x, y, scale, flip, armor, color) {
  const t = tintC.getContext('2d'); t.clearRect(0, 0, 200, 160); t.globalCompositeOperation = 'source-over';
  drawPlayerSprite(t, g, i, 100, 120, scale, flip, armor);
  t.globalCompositeOperation = 'source-atop'; t.fillStyle = color; t.fillRect(0, 0, 200, 160);
  c.drawImage(tintC, x - 100, y - 120);
}
function drawGuard(gd, t) {
  const x = isoX(gd.i, gd.j), y = isoY(gd.i, gd.j) + 2;
  shadowAt(x, y, 11, 5, 0.28);
  const tiers = { head: gd.level, chest: gd.level, legs: gd.level }, walking = gd.path && gd.path.length > 0 && gd.atk < 0, view = walking ? viewOf(gd) : null;
  if (view) drawWalker(ctx, x, y, 0.86, view, gd.walkT * 7.05, tiers, true);
  else {
    let g = 'p_walk', i = 0;
    if (gd.atk >= 0) { g = 'p_slash'; i = gd.atk < 0.1 ? 1 : gd.atk < 0.2 ? 2 : 5; }
    else if (walking) i = Math.floor(gd.walkT * 9);
    drawPlayerSprite(ctx, g, i, x, y, 0.5, gd.face < 0, tiers);
  }
  if (gd.hp < gd.maxHp) hpBar(x, y - 42, 20, gd.hp / gd.maxHp, '#4aa0e8');
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
  const [grp, idx] = enemyFrame(e);
  ctx.save();
  if (e.dying && e.d.g.die == null) ctx.globalAlpha = Math.max(0, 1 - e.dieT / 0.7);
  else if (e.dying && e.dieT > (e.boss ? 1.8 : 1.0)) ctx.globalAlpha = Math.max(0, 1 - (e.dieT - (e.boss ? 1.8 : 1.0)) / 0.6);
  Assets.char(ctx, grp, idx, x, y - hover, e.d.scale, e.face < 0);
  if (e.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5; Assets.char(ctx, grp, idx, x, y - hover, e.d.scale, e.face < 0); }
  ctx.restore();
  if (!e.dying && !e.boss && e.hp < e.maxHp) hpBar(x, y - hover - 44 * e.d.scale / 0.55 * 0.62, 22, e.hp / e.maxHp, '#d84a3a');
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
  const t = ts / 1000; UI.time = t;
  const sh = V.shake ? (Math.random() - 0.5) * V.shake : 0, sh2 = V.shake ? (Math.random() - 0.5) * V.shake : 0;
  ctx.setTransform(UI.dpr, 0, 0, UI.dpr, 0, 0);
  drawWater(t);
  const z = UI.cam.zoom;
  ctx.setTransform(UI.dpr * z, 0, 0, UI.dpr * z, UI.dpr * (UI.W / 2 - UI.cam.x * z + sh), UI.dpr * (UI.H / 2 - UI.cam.y * z + sh2));
  ctx.imageSmoothingEnabled = true;
  Ground.draw(ctx);
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
  if (V.hero) L.push({ k: unitDepth(V.hero.i, V.hero.j), f: () => drawHero(V.hero, t) });
  for (const g of V.guards) L.push({ k: unitDepth(g.i, g.j), f: () => drawGuard(g, t) });
  for (const e of V.enemies) L.push({ k: e.flying ? e.i + e.j + 6 : unitDepth(e.i, e.j), f: () => drawEnemy(e, t) });
  L.sort((a, b) => a.k - b.k);
  for (const o of L) o.f();
  for (const p of V.proj) drawProj(p);
  // effects
  for (const r of V.rings) { const f = r.t / 0.5, rr = r.r + (r.max - r.r) * f, col = r.green ? '170,255,190' : r.blue ? '150,200,255' : '255,240,200'; ctx.strokeStyle = `rgba(${col},${0.7 * (1 - f)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(isoX(r.i, r.j), isoY(r.i, r.j), rr * 45.25, rr * 22.6, 0, 0, 6.283); ctx.stroke(); }
  for (const p of V.parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.c; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 13px "Courier New", monospace'; ctx.textAlign = 'center';
  for (const tx of V.texts) { const a = 1 - tx.t / tx.life; ctx.globalAlpha = a; const x = isoX(tx.i, tx.j), y = isoY(tx.i, tx.j) - tx.z - tx.t * 26; ctx.fillStyle = '#000'; ctx.fillText(tx.text, x + 1, y + 1); ctx.fillStyle = tx.color; ctx.fillText(tx.text, x, y); }
  ctx.globalAlpha = 1;
  if (UI.place) drawGhost();
  else if (UI.tool === 'gather' && UI.mouse.in) { const tr = UI.hoverTree; if (tr) { diamond(tr.i, tr.j, 1, 1, 'rgba(230,200,120,.35)', 'rgba(255,230,150,.9)', 2); } }
  Clouds.draw(ctx, t, { x0: vx0, x1: vx1, y0: vy0, y1: vy1 });
  // screen-space overlays
  ctx.setTransform(UI.dpr, 0, 0, UI.dpr, 0, 0);
  const boss = V.enemies.find(e => e.boss && !e.dying);
  if (boss) {
    const bw = Math.min(420, UI.W - 40), bx = UI.W / 2 - bw / 2;
    ctx.fillStyle = '#ffb0a0'; ctx.font = 'bold 14px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.fillText(boss.d.name, UI.W / 2, 84);
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx - 2, 90, bw + 4, 14); ctx.fillStyle = boss.type === 'king' ? '#8a3ad0' : '#d6561f'; ctx.fillRect(bx, 92, bw * boss.hp / boss.maxHp, 10);
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
