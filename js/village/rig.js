'use strict';
// Village mode: a small 3D character rig. One skeleton, built from shaded spheroids, is projected from any
// facing, so the hero, guards and villagers keep exactly the same design from every side and animate with
// real joint angles (walk, sword slash, axe chop, spin strike, hurt).
//
// Character space: x = the character's left, y = up, z = forward. The view is orthographic, looking down
// at RIG_PITCH, like the isometric map. `yaw` is the facing on the ground plane: 0 faces the camera,
// PI/2 faces screen-right, PI faces away.
const RIG_PITCH = 0.5236, RIG_CP = Math.cos(RIG_PITCH), RIG_SP = Math.sin(RIG_PITCH);
const RIG_LIGHT = [-0.5, -0.85];                  // screen direction the sun comes from (upper left)
const RIG_OUT = 'rgba(26,17,13,.62)';

const RigPal = {
  hero: { tunic: { l: '#7aa4de', m: '#3f6aa8', d: '#27467c' }, pants: { l: '#b7ad93', m: '#8e846c', d: '#5f5644' }, boots: { l: '#9c6640', m: '#6e442a', d: '#3a2314' }, hair: { l: '#bf8a56', m: '#8a5a34', d: '#573820' }, skin: { l: '#f4c8a4', m: '#e9b690', d: '#c68e6a' }, belt: '#5a3a22', trim: '#e4be5a' },
  villagers: [
    { tunic: { l: '#d8b36a', m: '#b0873c', d: '#7a5a24' }, pants: { l: '#8a7a64', m: '#6a5c48', d: '#463c2e' }, boots: { l: '#7a5a3a', m: '#54402a', d: '#2e2216' }, hair: { l: '#d0b080', m: '#a88a58', d: '#6e5632' }, skin: { l: '#f2c8a6', m: '#e6b08a', d: '#c08a66' }, belt: '#4a3420', trim: '#b8a070', hat: '#c9a45a' },
    { tunic: { l: '#9ec08a', m: '#5f8a4a', d: '#3a5c2e' }, pants: { l: '#a49a82', m: '#7c725c', d: '#524a3a' }, boots: { l: '#7a5a3a', m: '#54402a', d: '#2e2216' }, hair: { l: '#8a6a4a', m: '#5e4430', d: '#372618' }, skin: { l: '#e8b896', m: '#d09a76', d: '#a87454' }, belt: '#4a3420', trim: '#c8b070', hat: '#7a6a44' },
    { tunic: { l: '#c88a7a', m: '#9a5648', d: '#6a342c' }, pants: { l: '#90887a', m: '#6e675a', d: '#464038' }, boots: { l: '#6a4a30', m: '#4a3220', d: '#281a10' }, hair: { l: '#5a4638', m: '#3a2c22', d: '#20170f' }, skin: { l: '#f6d0b0', m: '#eab994', d: '#c8946e' }, belt: '#443020', trim: '#c4a870', hat: '#b09050' },
    { tunic: { l: '#a8a8b8', m: '#76768c', d: '#4a4a5c' }, pants: { l: '#a0967e', m: '#7a7058', d: '#4e4638' }, boots: { l: '#745436', m: '#503a24', d: '#2c1e12' }, hair: { l: '#c4bcae', m: '#8e8878', d: '#5a5648' }, skin: { l: '#ecc0a0', m: '#d8a480', d: '#b0805e' }, belt: '#443020', trim: '#bcae88', hat: '#a08858' },
  ],
  metal: [null, { l: '#d2dae8', m: '#8b94a6', d: '#505a6e' }, { l: '#f6de88', m: '#d4a22c', d: '#82600f' }, { l: '#d0f4ff', m: '#44aee0', d: '#1a64a0' }],
};

// ---- small math helpers
const rigClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => { t = rigClamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => { t = rigClamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
const mix = (a, b, t) => a + (b - a) * t;
function rotX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; }
function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; }
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// limb direction: swing a (forward positive about the x axis), splay outward
function limb(a, splay) { const cs = Math.cos(splay || 0); return [Math.sin(splay || 0), -Math.cos(a) * cs, Math.sin(a) * cs]; }

// ---------------------------------------------------------------- poses
// Returns the joint angles for an action. `u` is the action's 0..1 progress, `ph` the walk phase.
function rigPose(kind, u, ph, t) {
  const P = { bob: 0, lean: 0.03, twist: 0, lunge: 0, thL: 0.04, thR: -0.04, knL: 0.08, knR: 0.08, aL: -0.12, eL: 0.3, sL: 0.1, aR: 0.35, eR: 0.9, sR: -0.1, pR: 2.05, head: 0, crouch: 0, spin: 0, twoHand: false };
  if (kind === 'idle') {
    const s = Math.sin(t * 1.9);
    P.bob = s * 0.22; P.aL += s * 0.03; P.aR += s * 0.03; P.pR += s * 0.04; P.head = s * 0.02;
  } else if (kind === 'walk') {
    const s = Math.sin(ph), c = Math.cos(ph);
    P.thL = 0.62 * s; P.thR = -0.62 * s;
    P.knL = 0.1 + 0.8 * Math.max(0, c); P.knR = 0.1 + 0.8 * Math.max(0, -c);
    P.aL = -0.62 * s - 0.1; P.eL = 0.35 + 0.25 * Math.max(0, -s);
    P.aR = 0.5 + 0.28 * s; P.eR = 0.85; P.pR = 2.0 - 0.1 * s;
    P.bob = Math.abs(c) * 1.1; P.twist = 0.1 * s; P.lean = 0.07;
  } else if (kind === 'attack') {                                  // sword slash: wind-up, slash, recover
    const w = ease(u / 0.32), s = easeOut((u - 0.32) / 0.28), r = ease((u - 0.64) / 0.36);
    const k = u < 0.32 ? w : u < 0.6 ? 1 : 1 - r;
    const slash = u < 0.32 ? 0 : u < 0.6 ? s : 1 - r;
    P.aR = mix(0.35, -2.5, k) + slash * 3.5; P.eR = mix(0.9, 1.25, k) - slash * 0.8; P.pR = mix(2.05, 3.4, k) - slash * 2.7;
    P.twist = mix(0, 0.7, k) - slash * 1.35; P.lean = mix(0.03, -0.2, k) + slash * 0.5;
    P.lunge = slash * 4.2; P.thR = 0.1 + slash * 0.75; P.knR = 0.2 + slash * 0.3; P.thL = -0.15 - slash * 0.45; P.knL = 0.3 + slash * 0.5;
    P.aL = mix(-0.12, -0.9, k) + slash * 0.6; P.eL = 0.5; P.sL = 0.2 + slash * 0.5; P.crouch = k * 1.4 * (1 - slash * 0.5);
  } else if (kind === 'chop') {                                    // overhead axe swing, both hands on the haft
    const up = ease(u / 0.55), dn = easeOut((u - 0.55) / 0.13), rec = ease((u - 0.78) / 0.22);
    if (u < 0.55) { P.aR = mix(0.3, -2.7, up); P.eR = mix(0.7, 1.25, up); P.pR = mix(2.0, 3.45, up); P.lean = mix(0.05, -0.16, up); }
    else if (u < 0.78) { P.aR = mix(-2.7, 0.7, dn); P.eR = mix(1.25, 0.35, dn); P.pR = mix(3.45, 0.55, dn); P.lean = mix(-0.16, 0.42, dn); P.crouch = dn * 2.2; }
    else { P.aR = mix(0.7, 0.3, rec); P.eR = mix(0.35, 0.7, rec); P.pR = mix(0.55, 2.0, rec); P.lean = mix(0.42, 0.05, rec); P.crouch = (1 - rec) * 2.2; }
    P.aL = P.aR * 0.92; P.eL = P.eR; P.sL = 0.12; P.sR = -0.12; P.twoHand = true;
    P.thL = 0.18; P.thR = -0.12; P.knL = 0.3; P.knR = 0.3;
  } else if (kind === 'strike') {                                  // spin strike: arms wide, whole body turning
    const k = Math.sin(Math.min(1, u) * Math.PI);
    P.aR = 0; P.eR = 0.1; P.sR = -1.35 * k; P.pR = 1.55; P.aL = 0; P.eL = 0.1; P.sL = 1.35 * k; P.crouch = 1.6 * k; P.spin = u * Math.PI * 4; P.lean = 0.1; P.bob = 0.5;
    P.thL = 0.3; P.thR = -0.3; P.knL = 0.5; P.knR = 0.5;
  } else if (kind === 'hurt') {
    P.lean = -0.38; P.aL = -0.5; P.sL = 0.8; P.aR = -0.3; P.sR = -0.8; P.eR = 0.3; P.pR = 1.4; P.head = -0.25; P.thL = 0.2; P.thR = -0.25; P.knL = 0.3; P.knR = 0.4; P.crouch = 0.8;
  } else if (kind === 'carry') {                                   // villager walking with a load held in front
    const s = Math.sin(ph), c = Math.cos(ph);
    P.thL = 0.55 * s; P.thR = -0.55 * s; P.knL = 0.1 + 0.7 * Math.max(0, c); P.knR = 0.1 + 0.7 * Math.max(0, -c);
    P.aL = 0.95; P.eL = 1.15; P.sL = 0.25; P.aR = 0.95; P.eR = 1.15; P.sR = -0.25; P.pR = 1.4; P.bob = Math.abs(c) * 0.9; P.lean = -0.04; P.twoHand = true;
  } else if (kind === 'work') {                                    // villager hammering / hauling in place
    const s = Math.sin(t * 7);
    P.aR = 0.2 + (s > 0 ? -1.5 * s : 0); P.eR = 0.9; P.pR = 1.5; P.aL = 0.6; P.eL = 0.8; P.lean = 0.2 + 0.1 * s; P.crouch = 0.8;
  }
  return P;
}

// ---------------------------------------------------------------- the drawing
// o: { x, y (feet on screen), s (scale), yaw, kind, u, ph, t, pal, tiers {head,chest,legs}, tool: 'sword'|'axe'|'none',
//      carry: 'sack'|'log'|null, hat, flash: 0..1 (red hit tint) }
function drawRig(ctx, o) {
  const pal = o.pal || RigPal.hero, tiers = o.tiers || {}, S = o.s || 1;
  const P = rigPose(o.kind || 'idle', o.u || 0, o.ph || 0, o.t || 0);
  const yaw = (o.yaw || 0) + P.spin, cy = Math.cos(yaw), sy = Math.sin(yaw);
  // projection of a character-space point
  const prj = (p) => { const gx = p[0] * cy + p[2] * sy, gz = -p[0] * sy + p[2] * cy; return { x: o.x + gx * S, y: o.y + (-p[1] * RIG_CP + gz * RIG_SP) * S, z: gz }; };
  const parts = [];
  const metal = (slot, base) => (tiers[slot] ? RigPal.metal[tiers[slot]] : base);
  const cTun = metal('chest', pal.tunic), cPants = metal('legs', pal.pants), cBoots = metal('legs', pal.boots), cHair = metal('head', pal.hair);

  // draw one spheroid given three axis vectors (character space, already scaled by the radii)
  const ell = (center, a1, a2, a3, col, bias, extra) => {
    let A = 0, B = 0, C = 0;
    for (const a of [a1, a2, a3]) { const gx = a[0] * cy + a[2] * sy, gz = -a[0] * sy + a[2] * cy, X = gx, Y = -a[1] * RIG_CP + gz * RIG_SP; A += X * X; B += X * Y; C += Y * Y; }
    const m = (A + C) / 2, dd = Math.sqrt(((A - C) / 2) ** 2 + B * B), rx = Math.sqrt(m + dd), ry = Math.sqrt(Math.max(0.05, m - dd)), th = 0.5 * Math.atan2(2 * B, A - C);
    const q = prj(center);
    parts.push({ z: q.z + (bias || 0), f: () => {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(th); ctx.scale(rx * S, ry * S);
      const lx = Math.cos(-th) * RIG_LIGHT[0] - Math.sin(-th) * RIG_LIGHT[1], ly = Math.sin(-th) * RIG_LIGHT[0] + Math.cos(-th) * RIG_LIGHT[1];
      const g = ctx.createRadialGradient(lx * 0.42, ly * 0.42, 0.04, 0, 0, 1.05);
      g.addColorStop(0, col.l); g.addColorStop(0.5, col.m); g.addColorStop(1, col.d);
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.2832); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 0.8 / (Math.max(rx, ry) * S); ctx.strokeStyle = RIG_OUT; ctx.stroke();
      ctx.restore();
      if (extra) extra(q, rx * S, ry * S, th);
    } });
  };
  // elongated limb segment from p0 to p1 with radii
  const seg = (p0, p1, rw0, col, bias) => {
    const mid = vmul(vadd(p0, p1), 0.5), d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, u = vmul(d, 1 / L);
    // two perpendicular unit vectors
    let r = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const p1v = [u[1] * r[2] - u[2] * r[1], u[2] * r[0] - u[0] * r[2], u[0] * r[1] - u[1] * r[0]], pl = Math.hypot(p1v[0], p1v[1], p1v[2]) || 1, e1 = vmul(p1v, 1 / pl);
    const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    ell(mid, vmul(u, L / 2 + rw0 * 0.55), vmul(e1, rw0), vmul(e2, rw0), col, bias);
  };
  const line = (p0, p1, w, color, zb, hi) => {
    const a = prj(p0), b = prj(p1);
    parts.push({ z: (a.z + b.z) / 2 + (zb || 0), f: () => {
      ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(20,14,10,.7)'; ctx.lineWidth = (w + 1.1) * S; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = w * S; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (hi) { ctx.strokeStyle = hi; ctx.lineWidth = w * 0.32 * S; ctx.beginPath(); ctx.moveTo(a.x - 0.4 * S, a.y - 0.4 * S); ctx.lineTo(b.x - 0.4 * S, b.y - 0.4 * S); ctx.stroke(); }
    } });
  };

  // ---- skeleton
  const pelvisY = 21.2 - P.crouch + P.bob;
  const lungeV = [0, 0, P.lunge];
  const pelvis = vadd([0, pelvisY, 0], lungeV);
  const waist = vadd(pelvis, [0, 2.2, 0]);
  const T = (p) => vadd(waist, rotY(rotX(p, P.lean), P.twist));              // torso-local -> character space
  const legs = [{ side: 1, th: P.thL, kn: P.knL, col: 'L' }, { side: -1, th: P.thR, kn: P.knR, col: 'R' }];
  for (const L of legs) {
    const hip = vadd(pelvis, [L.side * 3.4, -0.6, 0]);
    // keep the feet on the ground when crouching: shorten the legs' reach through a larger knee bend
    const th = L.th + P.crouch * 0.22, kn = L.kn + P.crouch * 0.4;
    const knee = vadd(hip, vmul(limb(th, 0.03 * L.side), 9.8)), ankle = vadd(knee, vmul(limb(th - kn, 0), 9.6));
    seg(hip, knee, 3.1, cPants, -0.2); seg(knee, ankle, 2.6, cPants, -0.1);
    if (tiers.legs) ell(knee, [2.6, 0, 0], [0, 2.4, 0], [0, 0, 2.7], cPants, 0.2);
    const toe = vadd(ankle, rotX([0, -0.6, 3.6], th - kn)), heel = vadd(ankle, rotX([0, -1.0, -1.4], th - kn));
    ell(vmul(vadd(toe, heel), 0.5), [2.7, 0, 0], [0, 1.9, 0], vmul(rotX([0, 0, 1], th - kn), 4.4), cBoots, 0.1);
    seg(vadd(ankle, [0, 3.2, 0]), vadd(ankle, [0, -0.2, 0]), 2.8, cBoots, 0.05);
  }
  // hips + tunic skirt
  ell(vadd(pelvis, [0, -1.2, 0]), [7.1, 0, 0], [0, 3.6, 0], [0, 0, 4.7], cTun, -0.05);
  // torso
  const tc = T([0, 7.2, 0]);
  const ax = rotY(rotX([7.4, 0, 0], P.lean), P.twist), ay = rotY(rotX([0, 8.4, 0], P.lean), P.twist), az = rotY(rotX([0, 0, 4.9], P.lean), P.twist);
  ell(tc, ax, ay, az, cTun, 0.0);
  const belt = T([0, 2.0, 0]);
  ell(belt, rotY([7.0, 0, 0], P.twist), [0, 1.25, 0], rotY([0, 0, 4.7], P.twist), { l: '#7a5232', m: pal.belt, d: '#33200f' }, 0.03);
  const buckle = T([0, 2.0, 4.6]);
  ell(buckle, [1.5, 0, 0], [0, 1.4, 0], [0, 0, 0.5], { l: '#fff0a8', m: pal.trim, d: '#8a6a20' }, 0.08);
  ell(T([7.0, 1.2, 2.0]), [2.2, 0, 0], [0, 2.4, 0], [0, 0, 1.8], { l: '#8a5e38', m: '#5e3e26', d: '#33200f' }, 0.04);                 // pouch
  // baldric strap over the chest and back
  for (const zf of [4.55, -4.55]) line(T([-5.2, 14.4, zf * 0.9]), T([4.2, 2.6, zf]), 1.7, '#4a2e1a', zf > 0 ? 0.06 : -0.06);
  // neck, head, hair
  const neck = T([0, 15.8, 0.2]);
  ell(neck, [1.9, 0, 0], [0, 2.3, 0], [0, 0, 1.9], pal.skin, -0.04);
  const hc = vadd(neck, rotY(rotX([0, 6.0 + P.head * 4, 0.5], P.head), 0)), hax = [5.0, 0, 0], hay = [0, 5.7, 0], haz = [0, 0, 5.2];
  const hrot = (v) => rotY(v, P.twist * 0.6);
  ell(hc, hrot(hax), hrot(hay), hrot(haz), pal.skin, 0.0);
  // eyes and brows (only when they face the camera)
  const face = (p) => vadd(hc, hrot(p));
  for (const sd of [1, -1]) {
    const e = face([sd * 2.0, 0.5, 4.75]), nrm = hrot([sd * 0.4, 0, 0.9]), vis = -nrm[0] * sy + nrm[2] * cy;
    if (vis > 0.16) {
      const q = prj(e), wscale = rigClamp(vis * 1.1, 0.3, 1);
      parts.push({ z: q.z + 0.5, f: () => {
        ctx.save(); ctx.translate(q.x, q.y); ctx.scale(wscale, 1);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, 1.35 * S, 1.1 * S, 0, 0, 6.28); ctx.fill();
        ctx.fillStyle = '#2b1a12'; ctx.beginPath(); ctx.arc(0.15 * S, 0.1 * S, 0.8 * S, 0, 6.28); ctx.fill();
        ctx.strokeStyle = pal.hair.d; ctx.lineWidth = 0.8 * S; ctx.beginPath(); ctx.moveTo(-1.5 * S, -1.5 * S); ctx.lineTo(1.5 * S, -1.8 * S); ctx.stroke();
        ctx.restore();
      } });
    }
  }
  { const nz = face([0, -1.4, 5.2]), nrm = hrot([0, 0, 1]), vis = -nrm[0] * sy + nrm[2] * cy;                      // nose and mouth
    if (vis > 0.25) { const q = prj(nz), m = prj(face([0, -3.1, 4.7])); parts.push({ z: q.z + 0.5, f: () => { ctx.fillStyle = pal.skin.d; ctx.beginPath(); ctx.ellipse(q.x, q.y, 0.9 * S, 0.7 * S, 0, 0, 6.28); ctx.fill(); ctx.strokeStyle = '#9a5848'; ctx.lineWidth = 0.7 * S; ctx.beginPath(); ctx.moveTo(m.x - 1.1 * S, m.y); ctx.lineTo(m.x + 1.1 * S, m.y); ctx.stroke(); } }); } }
  // hair: back mass, top cap, fringe, side locks, tied tail
  if (tiers.head) {
    const H = RigPal.metal[tiers.head];
    ell(face([0, 1.0, -0.2]), hrot([6.0, 0, 0]), hrot([0, 5.3, 0]), hrot([0, 0, 6.1]), H, 0.12);
    ell(face([0, 3.8, 0]), hrot([5.2, 0, 0]), hrot([0, 2.6, 0]), hrot([0, 0, 5.4]), H, 0.14);
    ell(face([0, 0.1, 5.6]), hrot([0.8, 0, 0]), hrot([0, 4.4, 0]), hrot([0, 0, 0.9]), { l: H.m, m: H.d, d: '#1a1a22' }, 0.15);        // nose guard
    ell(face([0, 6.4, -0.6]), hrot([0.9, 0, 0]), hrot([0, 2.2, 0]), hrot([0, 0, 4.2]), { l: '#e8605a', m: '#b83a38', d: '#701c20' }, 0.13);  // crest
  } else {
    ell(face([0, 0.6, -1.9]), hrot([5.9, 0, 0]), hrot([0, 5.9, 0]), hrot([0, 0, 5.0]), cHair, 0.05);
    ell(face([0, 3.4, -0.4]), hrot([5.5, 0, 0]), hrot([0, 3.0, 0]), hrot([0, 0, 5.3]), cHair, 0.1);
    ell(face([0, 4.6, 2.9]), hrot([4.4, 0, 0]), hrot([0, 1.8, 0]), hrot([0, 0, 2.2]), cHair, 0.14);
    ell(face([2.9, 3.2, 3.2]), hrot([1.2, 0, 0]), hrot([0, 1.6, 0]), hrot([0, 0, 1.8]), cHair, 0.14); ell(face([-2.9, 3.2, 3.2]), hrot([1.2, 0, 0]), hrot([0, 1.6, 0]), hrot([0, 0, 1.8]), cHair, 0.14);
    ell(face([4.9, -0.4, 0.5]), hrot([1.1, 0, 0]), hrot([0, 3.1, 0]), hrot([0, 0, 2.0]), cHair, 0.1); ell(face([-4.9, -0.4, 0.5]), hrot([1.1, 0, 0]), hrot([0, 3.1, 0]), hrot([0, 0, 2.0]), cHair, 0.1);
    ell(face([0, -2.6, -5.2]), hrot([1.9, 0, 0]), hrot([0, 3.7, 0]), hrot([0, 0, 1.9]), cHair, 0.02);                   // tied tail
  }
  if (pal.hat && !tiers.head) {                                                       // villager straw hat
    const hatc = { l: '#e8cf90', m: pal.hat, d: '#7a5e2c' };
    ell(face([0, 4.6, 0]), hrot([9.0, 0, 0]), hrot([0, 0.9, 0]), hrot([0, 0, 9.0]), hatc, 0.16); ell(face([0, 6.2, 0]), hrot([4.6, 0, 0]), hrot([0, 2.6, 0]), hrot([0, 0, 4.6]), hatc, 0.17);
  }
  // pauldrons for armoured chests
  if (tiers.chest) for (const sd of [1, -1]) ell(T([sd * 8.4, 14.2, 0]), [3.6, 0, 0], [0, 2.6, 0], [0, 0, 3.4], RigPal.metal[tiers.chest], 0.1);

  // ---- arms
  const arm = (side, a, e, sp, isR) => {
    const sh = T([side * 8.2, 14.2, 0]), up = vadd(sh, vmul(limb(a, side * (0.12 + Math.abs(sp))), 7.9)), fa = vadd(up, vmul(limb(a + e, side * (0.08 + Math.abs(sp) * 0.5)), 7.2));
    ell(sh, [3.4, 0, 0], [0, 3.2, 0], [0, 0, 3.3], cTun, 0.02);
    seg(sh, up, 2.6, cTun, 0.03);
    seg(up, fa, 2.1, { l: pal.skin.l, m: pal.skin.m, d: pal.skin.d }, 0.04);
    seg(vadd(up, vmul(limb(a + e, side * 0.1), 1.2)), vadd(up, vmul(limb(a + e, side * 0.1), 4.2)), 2.35, { l: '#8a5e38', m: pal.belt, d: '#33200f' }, 0.05);       // bracer
    ell(fa, [2.2, 0, 0], [0, 2.2, 0], [0, 0, 2.2], pal.skin, 0.08);
    return { sh, up, fa };
  };
  const armL = arm(1, P.aL, P.eL, P.sL, false), armR = arm(-1, P.aR, P.eR, P.sR, true);
  // ---- tool in the right hand (a sword by default, an axe while chopping)
  const hand = armR.fa, tool = o.tool || 'sword';
  if (tool === 'sword') {
    const dir = (() => { const p = P.pR; const d = [-0.1, -Math.cos(p), Math.sin(p)]; const dd = rotY(rotX(d, P.lean), P.twist); const l = Math.hypot(dd[0], dd[1], dd[2]); return vmul(dd, 1 / l); })();
    const gp = vadd(hand, vmul(dir, 1.2)), tip = vadd(hand, vmul(dir, 16.5));
    line(vadd(hand, vmul(dir, -2.6)), gp, 1.8, '#6a4a2a', 0.3);                                       // grip
    const side = rotY([0, 0, 1], 0), gdir = [dir[2], 0, -dir[0]], gl = Math.hypot(gdir[0], gdir[2]) || 1;
    line(vadd(gp, vmul(gdir, -2.6 / gl)), vadd(gp, vmul(gdir, 2.6 / gl)), 1.5, pal.trim, 0.31);       // crossguard
    line(gp, tip, 2.4, '#c8d0dc', 0.32, '#ffffff');                                                       // blade
    o._tip = prj(tip); o._base = prj(vadd(hand, vmul(dir, 5)));
  } else if (tool === 'axe') {
    const p = P.pR, d0 = [-0.05, -Math.cos(p), Math.sin(p)], dd = rotY(rotX(d0, P.lean), P.twist), l = Math.hypot(dd[0], dd[1], dd[2]), dir = vmul(dd, 1 / l);
    const end = vadd(hand, vmul(dir, 14)), tail = vadd(hand, vmul(dir, -3));
    line(tail, end, 2.0, '#7a5230', 0.3, '#b98a58');
    const cross = [dir[2], 0, -dir[0]], cl = Math.hypot(cross[0], cross[2]) || 1, cv = vmul(cross, 1 / cl);
    const head = vadd(end, vmul(dir, -1.2));
    line(vadd(head, vmul(cv, -4.4)), vadd(head, vmul(cv, 1.6)), 4.6, '#aab4c2', 0.33, '#f0f4fa');      // blade
    line(vadd(head, vmul(cv, 1.6)), vadd(head, vmul(cv, 3.2)), 3, '#5a6270', 0.32);                    // poll
    o._tip = prj(vadd(head, vmul(cv, -4.8))); o._base = prj(hand);
  }
  // ---- carried load (villagers)
  if (o.carry) {
    const front = vadd(waist, rotY([0, 6.2, 8.2], P.twist));
    if (o.carry === 'sack') ell(front, [5.2, 0, 0], [0, 5.0, 0], [0, 0, 4.2], { l: '#e2cfa0', m: '#b89c64', d: '#7a6034' }, 0.2);
    else if (o.carry === 'log') { line(vadd(front, [-7, 0, 0]), vadd(front, [7, 0, 0]), 4.6, '#8a5e38', 0.2, '#c8a070'); ell(vadd(front, [7, 0, 0]), [0.6, 0, 0], [0, 2.3, 0], [0, 0, 2.3], { l: '#e2c08a', m: '#c09a66', d: '#8a6a40' }, 0.22); }
    else if (o.carry === 'coins') ell(front, [4.6, 0, 0], [0, 3.6, 0], [0, 0, 3.6], { l: '#fff0a8', m: '#e2b83a', d: '#8a6414' }, 0.2);
  }
  if (o.measure) return o;
  parts.sort((a, b) => a.z - b.z);
  ctx.save();
  if (o.alpha !== undefined && o.alpha < 1) ctx.globalAlpha = o.alpha;
  for (const p of parts) p.f();
  ctx.restore();
  return o;
}
// where the blade tip was `back` of the way through the action (for slash trails)
function rigTipAt(o, kind, u) { const c = Object.assign({}, o, { kind, u, _tip: null, measure: true }); drawRig(null, c); return { tip: c._tip, base: c._base }; }
