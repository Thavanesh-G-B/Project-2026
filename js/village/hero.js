'use strict';
// Village mode: the hero, guards and villagers are all the same pixel-art character (assets/sprites/hero_*.png,
// cut from the reference sheet by tools/extract_hero.py). Eight walk directions come straight from the sheet;
// the sword, axe and death poses face south-east and are mirrored for the other side.
// Variants: 'hero', armour tiers 'a1'..'a3', and four villager outfits 'v0'..'v3'.
// The hero and the guards (variants 'hero' and 'a1'..'a3') are drawn from the "2D HD Character Knight" sheets (assets/sprites/knight,
// cut by tools/extract_knight.py): eight real facings per animation, tinted per armour tier. Villagers keep the old pixel-art person.
// how much each facing's legs are re-animated (profile views already have a good stride in the sheet)
const LEG_AMP = { S: 1, N: 1, SE: 0.9, SW: 0.9, NE: 0.9, NW: 0.9, E: 1, W: 1 };
const Hero = {
  img: {}, ready: false, DIRS: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'], tmp: null,
  load() {
    const A = window.HERO_ATLAS;
    return Promise.all(A.variants.map(v => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => { this.img[v] = i; res(); }; i.onerror = () => rej(new Error('Could not load hero_' + v + '.png')); i.src = 'assets/sprites/hero_' + v + '.png';
    })).concat(this.loadKnight())).then(() => { this.ready = true; this.tmp = document.createElement('canvas'); this.tmp.width = this.tmp.height = 160; });
  },
  // ---------------------------------------------------------------- the knight (hero and guards)
  K: { img: {}, tint: {}, SCALE: 1.0, ROW: { SE: 0, S: 1, SW: 2, W: 3, NW: 4, N: 5, NE: 6, E: 7 }, tmp: null },
  // tier tints: multiplied over the steel-grey knight (cloth tunic -> leather, iron -> cold steel, gold, crystal)
  KTINT: { hero: '', a1: '#c4d2ea', a2: '#ffd36a', a3: '#8fe4ff' },
  isKnight(variant) { return variant === 'hero' || variant === 'a1' || variant === 'a2' || variant === 'a3'; },
  loadKnight() {
    const A = window.KNIGHT_ATLAS; if (!A) return [];
    this.K.tmp = document.createElement('canvas'); this.K.tmp.width = this.K.tmp.height = 200;
    return Object.keys(A.sheets).map(n => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => { this.K.img[n] = i; res(); }; i.onerror = () => rej(new Error('Could not load knight sheet ' + n)); i.src = A.sheets[n].file;
    }));
  },
  // a tinted copy of one sheet, made the first time that armour tier draws it
  kSheet(name, variant) {
    const key = variant + ':' + name, K = this.K; if (K.tint[key]) return K.tint[key];
    const src = K.img[name], c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = this.KTINT[variant] || '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(src, 0, 0);
    return (K.tint[key] = c);
  },
  // eight facings from the on-screen yaw (0 = towards the camera, PI/2 = screen-right), with a little hysteresis so a heading that wobbles at a
  // sector edge does not flicker; returns a sheet row name (S, SE, E, NE, N, NW, W, SW)
  kDir(o) {
    const ref = o.ref, step = Math.PI / 4, yaw = o.yaw || 0;
    let k = ((Math.round(yaw / step) % 8) + 8) % 8;
    if (ref && ref._kd !== undefined && ref._kd !== k) {
      let d = yaw - ref._kd * step; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832;
      if (Math.abs(d) < step / 2 + 0.14) k = ref._kd;
    }
    if (ref) ref._kd = k;
    return this.DIRS[k];
  },
  // which sheet and frame: the 15 frames of a sheet are spread over the action's progress (u 0..1), the walk phase (ph) or the clock (t)
  kPick(o) {
    const kind = o.kind || 'idle', u = Math.max(0, Math.min(1, o.u || 0)), fr = (n, x) => Math.max(0, Math.min(n - 1, Math.floor(x * n)));
    switch (kind) {
      case 'walk': case 'carry': { const ph = ((o.ph || 0) % 6.2832 + 6.2832) % 6.2832; return ['Run', fr(15, ph / 6.2832)]; }
      case 'attack': return ['Melee', fr(15, u)];
      case 'strike': return ['Special1', u < 0.4 ? fr(9, u / 0.4) : 9 + fr(6, (u - 0.4) / 0.6)];      // raise the blade, then bring it down on the impact (0.2s into 0.5s)
      case 'chop': case 'work': return ['Pummel', fr(15, u)];
      case 'cast': return ['CastSpell', fr(15, u)];
      case 'hurt': return ['TakeDamage', fr(15, u)];
      case 'dead': return ['Die', Math.min(14, Math.floor((o.deadT || 0) / 0.07))];
      default: return ['Idle', Math.floor(((o.t || 0) * 8) % 15 + 15) % 15];
    }
  },
  drawKnight(ctx, o) {
    const A = window.KNIGHT_ATLAS, K = this.K, s = (o.s || 1) * K.SCALE, variant = o.variant || 'hero';
    const dir = this.kDir(o), [sheet, f] = this.kPick(o), S = A.sheets[sheet], row = K.ROW[dir];
    const img = variant === 'hero' && !this.KTINT.hero ? K.img[sheet] : this.kSheet(sheet, variant);
    const sx = f * S.w, sy = row * S.h, dx = -(A.anchor[0] - S.ox) * s, dy = -(A.anchor[1] - S.oy) * s;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.alpha !== undefined && o.alpha < 1) ctx.globalAlpha = o.alpha;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (o.flash) {                                           // tinted copy for hits
      const t = K.tmp, g = t.getContext('2d'); g.clearRect(0, 0, 200, 200); g.globalCompositeOperation = 'source-over';
      g.drawImage(img, sx, sy, S.w, S.h, 20, 20, S.w, S.h); g.globalCompositeOperation = 'source-atop'; g.fillStyle = o.flash; g.fillRect(0, 0, 200, 200);
      ctx.drawImage(t, 20, 20, S.w, S.h, dx, dy, S.w * s, S.h * s);
    } else ctx.drawImage(img, sx, sy, S.w, S.h, dx, dy, S.w * s, S.h * s);
    ctx.restore();
    o._name = `${sheet}_${dir}_${f}`; o._flip = false; o._h = (A.anchor[1] - S.oy) * s; o._dir = dir; o._sheet = sheet; o._f = f;
    return o;
  },
  // CSS for the hero panel portrait: the standing knight facing the camera, cut from the Idle sheet and tinted per armour tier with a
  // multiply-blended layer (a canvas data URL would not work: pictures loaded from file:// taint every canvas they touch)
  portraitCss(variant) {
    const A = window.KNIGHT_ATLAS, S = A.sheets.Idle, row = this.K.ROW.S, k = 1;
    const w = S.w * A.cols * k, h = S.h * A.rows * k, px = (56 - S.w * k) / 2, py = (76 - S.h * k) / 2 - row * S.h * k, tint = this.KTINT[variant] || '#ffffff';
    return `background-image:linear-gradient(${tint},${tint}),url(${S.file});background-blend-mode:multiply,normal;background-repeat:no-repeat;background-size:${w}px ${h}px;background-position:${px}px ${py}px`;
  },
  count(d) { let n = 0; while (window.HERO_ATLAS.frames[`w_${d}_${n}`]) n++; return n; },
  // one frame of the sheet: sprite sheet rect and anchor
  frame(name) { return window.HERO_ATLAS.frames[name]; },
  // Which of the eight pictures to show for a heading (yaw: 0 = towards the camera, 90 degrees = screen-right). The pictures are not spread
  // evenly: a heading of 63 degrees (walking along a map axis, "right and a little down") must show the side view, not the front-facing
  // three-quarter one, so the side views take everything between 52 and 128 degrees. The current picture is held a little longer (hysteresis)
  // so a heading that wobbles near a boundary does not flicker between two pictures.
  BINS: [24, 52, 128, 156],
  pickDir(o) {
    let a = (o.yaw || 0) * 180 / Math.PI; a = ((a + 180) % 360 + 360) % 360 - 180;
    const right = a >= 0, ab = Math.abs(a), ref = o.ref, T = this.BINS, bin = x => (x < T[0] ? 0 : x < T[1] ? 1 : x < T[2] ? 2 : x < T[3] ? 3 : 4);
    let bi = bin(ab);
    if (ref && ref._bi !== undefined && ref._bi !== bi) {                       // stay in the current bin until clearly past its edge
      const lo = ref._bi > 0 ? T[ref._bi - 1] - 7 : -999, hi = ref._bi < 4 ? T[ref._bi] + 7 : 999;
      if (ab >= lo && ab < hi) bi = ref._bi;
    }
    let side = right; if (ref && ref._side !== undefined && bi >= 1 && bi <= 3 && bi === ref._bi && Math.abs(a) > 0) side = ref._side;   // do not change sides mid-bin
    const d = bi === 0 ? 0 : bi === 4 ? 4 : (side ? [0, 1, 2, 3, 4][bi] : [0, 7, 6, 5, 4][bi]);
    if (ref) { ref._bi = bi; ref._side = side; ref._dir = d; }
    return d;
  },
  dirOf(yaw) { return ((Math.round(yaw / (Math.PI / 4)) % 8) + 8) % 8; },

  // o: { x, y (feet), s, yaw, kind: idle|walk|carry|attack|chop|work|strike|cast|hurt|dead, u, ph, t, variant, alpha, flash, side, deadT, carry }
  draw(ctx, o) {
    if (!this.ready) return o;
    if (window.KNIGHT_ATLAS && this.isKnight(o.variant || 'hero')) return this.drawKnight(ctx, o);
    return this.drawLegacy(ctx, o);
  },
  drawLegacy(ctx, o) {
    const s = o.s || 1, variant = o.variant || 'hero', kind = o.kind || 'idle';
    let d = this.pickDir(o), name, flip = false, dx = 0, dy = 0;
    const sideOf = () => { const sx = Math.sin(o.yaw || 0); return Math.abs(sx) > 0.2 ? (sx < 0 ? -1 : 1) : (o.side || 1); };
    // The sheet's "south-east" and "north-west" rows do not really face those ways, so the right-hand diagonals are the mirror images
    // of the pictures that do (south-west, north-east): the head and body then always point where the hero is going.
    const MIRROR = { NW: 'NE', SE: 'SW' };
    const walkFrame = (dir, k) => { let dd = this.DIRS[dir], f = false; if (MIRROR[dd]) { dd = MIRROR[dd]; f = true; } const n = this.count(dd); return [`w_${dd}_${((k % n) + n) % n}`, f]; };
    const idleFrame = (dir) => { let dd = this.DIRS[dir], f = false; if (MIRROR[dd]) { dd = MIRROR[dd]; f = true; } return [`w_${dd}_${(window.HERO_ATLAS.idle || {})[dd] || 0}`, f]; };
    switch (kind) {
      case 'walk': case 'carry': {
        if (LEG_AMP[this.DIRS[d]] > 0.3 && this.DIRS[d] !== 'E' && this.DIRS[d] !== 'W') { [name, flip] = idleFrame(d); break; }    // legs are animated in code (drawLegged) from a standing picture
        // side views: the sheet's own frames give the arm swing and torso; the legs are animated in code underneath (its feet never change stance)
        const n = this.count(this.DIRS[d]);
        [name, flip] = walkFrame(d, Math.floor(((o.ph || 0) / 6.2832) * n));
        break; }
      case 'attack': case 'chop': case 'work': case 'hurt': case 'dead': case 'strike': {
        const side = sideOf(); flip = side < 0;
        const u = clamp(o.u || 0, 0, 1);
        if (kind === 'attack') { name = u < 0.3 ? 'atk0' : u < 0.68 ? 'atk1' : 'atk2'; dx = side * (u > 0.3 && u < 0.68 ? 3 : 0); }
        else if (kind === 'chop' || kind === 'work') { name = u < 0.25 ? 'chop2' : u < 0.55 ? 'chop0' : u < 0.82 ? 'chop1' : 'chop2'; dy = name === 'chop1' ? 1 : 0; }
        else if (kind === 'strike') { name = u < 0.4 ? 'atk2' : u < 0.8 ? 'atk1' : 'atk0'; dy = u < 0.4 ? -3 * Math.sin(u / 0.4 * 1.57) : 0; dx = side * (u >= 0.4 && u < 0.8 ? 2 : 0); }
        else if (kind === 'hurt') { [name, flip] = idleFrame(1); if (side < 0) flip = !flip; dx = -side * 3; }
        else { const t = o.deadT || 0; name = t < 0.3 ? 'stagger' : t < 0.7 ? 'dead0' : 'dead1'; }
        break; }
      default: {
        [name, flip] = idleFrame(d);
        dy = Math.sin((o.t || 0) * 2.2 + (o.ph || 0)) * 0.5 - 0.5;   // breathing
      }
    }
    const F = this.frame(name); if (!F) return o;
    const [fx, fy, fw, fh, ax, ay] = F, img = this.img[variant] || this.img.hero;
    ctx.save();
    ctx.translate(o.x + dx * s, o.y + dy * s); if (flip) ctx.scale(-1, 1);
    if (o.alpha !== undefined && o.alpha < 1) ctx.globalAlpha = o.alpha;
    ctx.imageSmoothingEnabled = true;
    if (o.flash) {                                           // tinted copy for hits
      const t = this.tmp, g = t.getContext('2d'); g.clearRect(0, 0, 160, 160); g.globalCompositeOperation = 'source-over';
      g.drawImage(img, fx, fy, fw, fh, 80 - ax, 150 - ay, fw, fh); g.globalCompositeOperation = 'source-atop'; g.fillStyle = o.flash; g.fillRect(0, 0, 160, 160);
      ctx.drawImage(t, 0, 0, 160, 160, -80 * s, -150 * s, 160 * s, 160 * s);
    } else if ((kind === 'walk' || kind === 'carry') && LEG_AMP[this.DIRS[d]]) this.drawLegged(ctx, img, F, s, o, d, flip, this.frame(idleFrame(d)[0]));
    else ctx.drawImage(img, fx, fy, fw, fh, -ax * s, -ay * s, fw * s, fh * s);
    // a carried load, held in front of the belly
    if (o.carry && (kind === 'carry' || kind === 'idle' || kind === 'walk')) this.drawCarry(ctx, o.carry, s, flip, d);
    o._h = fh * s; o._flip = flip; o._name = name;
    ctx.restore();
    return o;
  },
  // The front, back and three-quarter walk frames in the sheet barely move the legs, so the walk is built here from the standing picture,
  // like a paper puppet: the torso bobs and rocks on the hips, the arms (front / back views) swing against the legs, and each leg is cut
  // into thin slices that are shifted by increasing amounts down the leg, so it swings from the hip, bends at the knee and lifts the foot
  // during its swing phase. Side views already have a strong stride in the sheet and are drawn as they are.
  drawLegged(ctx, img, F, s, o, d, flip, FL) {
    const [fx, fy, fw, fh, ax, ay] = F, dn = this.DIRS[d], amp = LEG_AMP[dn], hipY = Math.round(fh * 0.62), diag = dn !== 'S' && dn !== 'N' && dn !== 'E' && dn !== 'W';
    const [lx, ly, lw, lh, lax, lay] = FL, lHip = Math.round(lh * 0.62), legLen = lh - lHip, cut = Math.round(lax);      // the legs come from the standing picture (FL)
    const frontBack = dn === 'S' || dn === 'N', yS = Math.round(fh * 0.27), armW = Math.round(fw * 0.27);
    const ph = o.ph || 0, yaw = o.yaw || 0, hx = Math.sin(yaw) * (diag ? 0.4 : 1), hy = 0.5 * Math.cos(yaw) * (diag ? 2.2 : 1), sgn = flip ? -1 : 1;
    const stride = 8 * amp * s, lift = (diag ? 7 : 6) * amp * s, bob = 2.4 * amp * s * Math.abs(Math.cos(ph)), sway = 0.04 * amp * Math.sin(ph) * sgn;
    const put = (sx, sy, w, h, ox, oy) => { if (w > 0 && h > 0) ctx.drawImage(img, fx + sx, fy + sy, w, h, (sx - ax) * s + ox, (sy - ay) * s + oy, w * s, h * s); };
    // torso, head and arms rock together about the hips
    ctx.save(); ctx.translate(0, (hipY - ay) * s - bob); ctx.rotate(sway); ctx.translate(0, -(hipY - ay) * s);
    if (frontBack) {
      put(0, 0, fw, yS, 0, 0);                                                       // head and shoulders
      put(armW, yS - 1, fw - 2 * armW, hipY - yS + 3, 0, 0);                         // chest (2 rows lower than the hips: overlaps the legs, no seam)
      const swL = Math.sin(ph + Math.PI), swR = Math.sin(ph);                          // each arm swings against the leg on its side
      put(0, yS - 3, armW, hipY - yS + 3, 0, -1.8 * s * swL * amp);                    // (3 rows of shoulder overlap hide the seam)
      put(fw - armW, yS - 3, armW, hipY - yS + 3, 0, -1.8 * s * swR * amp);
    } else put(0, 0, fw, hipY + 2, 0, 0);
    ctx.restore();
    // legs: thin slices, each moved a little further than the one above it
    const SL = 3, n = Math.ceil(legLen / SL);
    for (let side = 0; side < 2; side++) {
      const th = ph + side * Math.PI, sw = Math.sin(th), lf = Math.max(0, Math.cos(th));
      const Sx = hx * stride * sw, Sy = hy * stride * sw - lift * lf, kneeBack = -hx * stride * 0.7 * lf, kneeBackY = -hy * stride * 0.7 * lf;
      const ky = (bob + Sy) / (legLen * s), sx0 = side ? cut : 0, sw0 = side ? lw - cut : cut;
      for (let k = 0; k < n; k++) {
        const t = (k * SL + SL / 2) / legLen, e = t * t * (3 - 2 * t), sy = lHip + k * SL, sh = Math.min(SL, lh - sy);
        const dx = (Sx * t + kneeBack * Math.max(0, (t - 0.3) / 0.7) ** 1.4) * sgn, dy = (lHip - lay) * s - bob + k * SL * s * (1 + ky) + kneeBackY * e;
        if (sw0 > 0) ctx.drawImage(img, lx + sx0, ly + sy, sw0, sh, (sx0 - lax) * s + dx, dy, sw0 * s, sh * (1 + ky) * s + 0.7);
      }
    }
  },
  drawCarry(ctx, what, s, flip, d) {
    const behind = d >= 3 && d <= 5;                            // facing away: the load hides behind the body
    const y = -24 * s, ox = (d === 2 ? 9 : d === 6 ? -9 : 0) * s * (flip ? -1 : 1);
    ctx.save(); ctx.translate(ox, y); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(30,20,12,.7)';
    if (behind) ctx.globalAlpha = 0.0;
    if (what === 'log') {
      ctx.fillStyle = '#8a5e38'; ctx.beginPath(); ctx.roundRect(-11 * s, -3 * s, 22 * s, 6.5 * s, 3 * s); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d4b07a'; ctx.beginPath(); ctx.ellipse(11 * s, 0.2 * s, 1.8 * s, 3.2 * s, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    } else if (what === 'sack') {
      ctx.fillStyle = '#c4a870'; ctx.beginPath(); ctx.ellipse(0, 0, 7 * s, 6 * s, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = '#e8c04a'; ctx.beginPath(); ctx.ellipse(0, 0, 7 * s, 5 * s, 0, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff0a0'; ctx.beginPath(); ctx.ellipse(-2 * s, -1.5 * s, 3 * s, 1.6 * s, 0, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  },
};
