'use strict';
// Sprite access. Character frames are [sx, sy, w, h, ox, oy]; (ox, oy) is the frame's
// top-left relative to the feet anchor, so animations keep their baseline.
const Assets = {
  chars: null,
  world: null,
  armor: null,

  async load() {
    const img = src => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not load ' + src));
      i.src = src;
    });
    [this.chars, this.world, this.armor] = await Promise.all([img('assets/sprites/chars.png'), img('assets/sprites/world.png'), img('assets/sprites/armor.png')]);
  },

  count(group) { return SPRITES.chars[group].length; },

  // Draw a character frame with its feet at (x, y). flip mirrors it around x.
  char(ctx, group, i, x, y, scale, flip) {
    const g = SPRITES.chars[group];
    const f = g[((i % g.length) + g.length) % g.length];
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(this.chars, f[0], f[1], f[2], f[3], f[4] * scale, f[5] * scale, f[2] * scale, f[3] * scale);
    ctx.restore();
  },

  tile(ctx, name, x, y, size) {
    const f = SPRITES.world['t_' + name];
    size = size || 32;
    ctx.drawImage(this.world, f[0], f[1], f[2], f[3], x, y, size, size);
  },

  // Draw an item icon fitted into a size x size box centred on (cx, cy).
  item(ctx, name, cx, cy, size) {
    const f = SPRITES.world['i_' + name] || SPRITES.world['t_' + name];
    const s = size / Math.max(f[2], f[3]);
    ctx.drawImage(this.world, f[0], f[1], f[2], f[3], cx - f[2] * s / 2, cy - f[3] * s / 2, f[2] * s, f[3] * s);
  },
};
