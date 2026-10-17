'use strict';
// Village mode: the hero, guards and villagers are all the same pixel-art character (assets/sprites/hero_*.png,
// cut from the reference sheet by tools/extract_hero.py). Eight walk directions come straight from the sheet;
// the sword, axe and death poses face south-east and are mirrored for the other side.
// Variants: 'hero', armour tiers 'a1'..'a3', and four villager outfits 'v0'..'v3'.
// how much each facing's legs are re-animated (profile views already have a good stride in the sheet)
const LEG_AMP = { S: 1, N: 1, SE: 0.75, SW: 0.75, NE: 0.75, NW: 0.75, E: 0.25, W: 0.25 };
const Hero = {
  img: {}, ready: false, DIRS: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'], tmp: null,
  load() {
    const A = window.HERO_ATLAS;
    return Promise.all(A.variants.map(v => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => { this.img[v] = i; res(); }; i.onerror = () => rej(new Error('Could not load hero_' + v + '.png')); i.src = 'assets/sprites/hero_' + v + '.png';
    }))).then(() => { this.ready = true; this.tmp = document.createElement('canvas'); this.tmp.width = this.tmp.height = 160; });
  },
  count(d) { let n = 0; while (window.HERO_ATLAS.frames[`w_${d}_${n}`]) n++; return n; },
  // one frame of the sheet: sprite sheet rect and anchor
  frame(name) { return window.HERO_ATLAS.frames[name]; },
  // direction index (0 = S) from a yaw where 0 faces the camera and PI/2 faces screen-right
  dirOf(yaw) { return ((Math.round(yaw / (Math.PI / 4)) % 8) + 8) % 8; },

  // o: { x, y (feet), s, yaw, kind: idle|walk|carry|attack|chop|work|strike|hurt|dead, u, ph, t, variant, alpha, flash, side, deadT, carry }
  draw(ctx, o) {
    if (!this.ready) return o;
    const s = o.s || 1, variant = o.variant || 'hero', kind = o.kind || 'idle';
    let d = this.dirOf(o.yaw || 0), name, flip = false, dx = 0, dy = 0;
    const sideOf = () => { const sx = Math.sin(o.yaw || 0); return Math.abs(sx) > 0.2 ? (sx < 0 ? -1 : 1) : (o.side || 1); };
    const walkFrame = (dir, k) => { let dd = this.DIRS[dir], f = false; if (dd === 'NW') { dd = 'NE'; f = true; } const n = this.count(dd); return [`w_${dd}_${((k % n) + n) % n}`, f]; };
    const idleFrame = (dir) => { let dd = this.DIRS[dir], f = false; if (dd === 'NW') { dd = 'NE'; f = true; } return [`w_${dd}_${(window.HERO_ATLAS.idle || {})[dd] || 0}`, f]; };
    switch (kind) {
      case 'walk': case 'carry': {
        const n = this.count(this.DIRS[d] === 'NW' ? 'NE' : this.DIRS[d]);
        [name, flip] = walkFrame(d, Math.floor(((o.ph || 0) / 6.2832) * n));
        break; }
      case 'attack': case 'chop': case 'work': case 'hurt': case 'dead': case 'strike': {
        const side = sideOf(); flip = side < 0;
        const u = clamp(o.u || 0, 0, 1);
        if (kind === 'attack') { name = u < 0.3 ? 'atk0' : u < 0.68 ? 'atk1' : 'atk2'; dx = side * (u > 0.3 && u < 0.68 ? 3 : 0); }
        else if (kind === 'chop' || kind === 'work') { name = u < 0.25 ? 'chop2' : u < 0.55 ? 'chop0' : u < 0.82 ? 'chop1' : 'chop2'; dy = name === 'chop1' ? 1 : 0; }
        else if (kind === 'strike') { name = u < 0.4 ? 'atk2' : u < 0.8 ? 'atk1' : 'atk0'; dy = u < 0.4 ? -3 * Math.sin(u / 0.4 * 1.57) : 0; dx = side * (u >= 0.4 && u < 0.8 ? 2 : 0); }
        else if (kind === 'hurt') { [name] = idleFrame(1); flip = side < 0; dx = -side * 3; }
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
    } else if ((kind === 'walk' || kind === 'carry') && LEG_AMP[this.DIRS[d]]) this.drawLegged(ctx, img, F, s, o, d, flip);
    else ctx.drawImage(img, fx, fy, fw, fh, -ax * s, -ay * s, fw * s, fh * s);
    // a carried load, held in front of the belly
    if (o.carry && (kind === 'carry' || kind === 'idle' || kind === 'walk')) this.drawCarry(ctx, o.carry, s, flip, d);
    o._h = fh * s; o._flip = flip; o._name = name;
    ctx.restore();
    return o;
  },
  // The front, back and three-quarter walk frames in the sheet barely move the legs, so the legs are re-animated here: the
  // picture is split at the hips, the torso bobs on every step, and each leg swings along the walking direction and lifts in
  // its swing phase (a shear about the hip, so the leg stays attached). Side views already have a strong stride and are untouched.
  drawLegged(ctx, img, F, s, o, d, flip) {
    const [fx, fy, fw, fh, ax, ay] = F, amp = LEG_AMP[this.DIRS[d]], hipY = Math.round(fh * 0.62), legLen = fh - hipY, cut = Math.round(ax);
    const ph = o.ph || 0, yaw = o.yaw || 0, hx = Math.sin(yaw), hy = 0.5 * Math.cos(yaw);
    const stride = 5.2 * amp * s, lift = 3.6 * amp * s, bob = 2.0 * amp * s * Math.abs(Math.cos(ph));
    ctx.drawImage(img, fx, fy, fw, hipY, -ax * s, -ay * s - bob, fw * s, hipY * s);                       // torso
    for (let side = 0; side < 2; side++) {
      const th = ph + side * Math.PI, sw = Math.sin(th), lf = Math.max(0, Math.cos(th));
      const Sx = hx * stride * sw, Sy = hy * stride * sw - lift * lf;                                    // foot displacement on screen
      const kx = (flip ? -Sx : Sx) / (legLen * s), ky = (bob + Sy) / (legLen * s);
      const sx0 = side ? cut : 0, sw0 = side ? fw - cut : cut; if (sw0 <= 0) continue;
      ctx.save(); ctx.translate(0, (hipY - ay) * s - bob); ctx.transform(1, 0, kx, 1 + ky, 0, 0);
      ctx.drawImage(img, fx + sx0, fy + hipY, sw0, legLen, (sx0 - ax) * s, 0, sw0 * s, legLen * s); ctx.restore();
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
