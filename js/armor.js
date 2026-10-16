'use strict';
// Armor: three pieces (helmet / chestplate / leggings) in three tiers. Defense lowers damage taken, and
// each worn piece recolours the matching body part of the player sprite (hair -> helmet, tunic -> chestplate,
// trousers + boots -> leggings). The recoloured pixels are pre-rendered by tools/extract_armor.py into
// assets/sprites/armor.png, so nothing reads pixels at runtime (that would fail when opened from file://).
const ARMOR_SLOTS = ['head', 'chest', 'legs'];
const ARMOR_PIECES = ['Helmet', 'Chestplate', 'Leggings'];
const ARMOR_TIERS = [
  null,
  { name: 'Iron', icon: 'iron', def: [2, 4, 3], cost: [{ iron: 5 }, { iron: 9, wood: 2 }, { iron: 7 }] },
  { name: 'Gold', icon: 'gold', def: [3, 5, 4], cost: [{ gold: 5 }, { gold: 9 }, { gold: 7 }] },
  { name: 'Crystal', icon: 'crystal', def: [4, 6, 5], cost: [{ crystal: 4, gold: 2 }, { crystal: 8, gold: 4 }, { crystal: 6, gold: 3 }] },
];

function armorDefense(armor) {
  let d = 0;
  ARMOR_SLOTS.forEach((s, i) => { if (armor[s]) d += ARMOR_TIERS[armor[s]].def[i]; });
  return d;
}
function armorReduction(armor) { return Math.min(0.6, armorDefense(armor) * 0.03); }

// Draw a player frame wearing the given armor set (feet at x, y).
function drawPlayerSprite(ctx, group, i, x, y, scale, flip, armor) {
  Assets.char(ctx, group, i, x, y, scale, flip);
  if (!armor || !(group === 'p_walk' || group === 'p_slash' || group === 'p_dash')) return;
  const g = SPRITES.chars[group], f = g[((i % g.length) + g.length) % g.length];
  ARMOR_SLOTS.forEach((slot, si) => {
    const tier = armor[slot];
    if (!tier) return;
    const layerY = (si * 3 + (tier - 1)) * SPRITES.armorH;
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(Assets.armor, f[0], f[1] + layerY, f[2], f[3], f[4] * scale, f[5] * scale, f[2] * scale, f[3] * scale);
    ctx.restore();
  });
}
