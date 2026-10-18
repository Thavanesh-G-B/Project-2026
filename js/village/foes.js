'use strict';
// Village mode: the raiders, drawn from assets/sprites/foes.png (tools/extract_enemies.py): every frame is the platformer art rebuilt at
// three times the resolution, plus two recoloured raiders (Brute, Bone Lord).
const Foes = {
  img: null,
  load() { return new Promise((res, rej) => { const i = new Image(); i.onload = () => { this.img = i; res(); }; i.onerror = () => rej(new Error('Could not load foes.png')); i.src = 'assets/sprites/foes.png'; }); },
  count(group) { return window.FOES.groups[group].length; },
  frame(group, i) { const g = window.FOES.groups[group]; return g[((i % g.length) + g.length) % g.length]; },
  // feet at (x, y); `scale` is the old sprite scale (1 = the platformer's pixel size), so sizes stay comparable
  char(ctx, group, i, x, y, scale, flip) {
    const f = this.frame(group, i), s = scale / window.FOES.k;
    ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, f[0], f[1], f[2], f[3], f[4] * s, f[5] * s, f[2] * s, f[3] * s);
    ctx.restore();
  },
  height(group, scale) { return -this.frame(group, 0)[5] * scale / window.FOES.k; },
};
