"""Pre-render armor colour layers for the player sprite (no runtime pixel reads, so the game also
works from file://). For each slot (head, chest, legs) and tier (iron, gold, crystal) this writes the
recoloured pixels of that body part into assets/sprites/armor.png, same x/y layout as chars.png and
stacked vertically per layer. The game draws the base frame, then the worn layers on top.

Keep ARMOR_TIERS ramps in sync with js/armor.js.
"""
import json
import numpy as np
from PIL import Image

RAMPS = {  # tier -> (dark, mid, light)
    1: ([30, 34, 46], [118, 126, 142], [220, 226, 238]),
    2: ([80, 48, 6], [206, 154, 30], [255, 236, 138]),
    3: ([12, 44, 90], [58, 168, 226], [214, 250, 255]),
}
HEAD_Y, LEG_Y = -61, -32          # body-part bands in sprite px relative to the feet baseline
GROUPS = ['p_walk', 'p_slash', 'p_dash']

def ramp(r, t):
    r = [np.array(c, float) for c in r]
    lo = t < 0.5
    a = np.where(lo[..., None], r[0], r[1]); b = np.where(lo[..., None], r[1], r[2])
    k = np.where(lo, t * 2, (t - 0.5) * 2)[..., None]
    return a + (b - a) * k

def slot_mask(px, yrel, slot):
    r, g, b = px[..., 0].astype(float), px[..., 1].astype(float), px[..., 2].astype(float)
    lum = (r + g + b) / 3
    mx, mn = px[..., :3].max(2).astype(float), px[..., :3].min(2).astype(float)
    sat = (mx - mn) / (mx + 1)
    if slot == 'head':
        return (yrel < HEAD_Y) & (r > g + 6) & (g > b) & (lum < 125)
    if slot == 'chest':
        return (yrel >= HEAD_Y) & (yrel < LEG_Y) & (b > r + 14) & (lum < 175)
    olive = (lum > 62) & (lum < 170) & (np.abs(r - g) < 30) & (b <= r + 4) & (sat < 0.4)
    boot = (r > g + 14) & (lum < 140)
    return (yrel >= LEG_Y) & (olive | boot)

def main():
    meta = json.load(open('assets/sprites/chars.json'))
    atlas = np.array(Image.open('assets/sprites/chars.png').convert('RGBA'))
    frames = [f for g in GROUPS for f in meta[g]]
    H = max(f[1] + f[3] for f in frames) + 1
    layers = []
    for slot in ('head', 'chest', 'legs'):
        for tier in (1, 2, 3):
            layer = np.zeros((H, atlas.shape[1], 4), np.uint8)
            for sx, sy, w, h, ox, oy in frames:
                px = atlas[sy:sy + h, sx:sx + w]
                yrel = (oy + np.arange(h))[:, None] * np.ones((1, w))
                m = slot_mask(px, yrel, slot) & (px[..., 3] > 40)
                lum = px[..., :3].astype(float).mean(2)
                t = np.clip((lum - 26) / 150, 0, 1)
                col = ramp(RAMPS[tier], t)
                out = np.zeros((h, w, 4), np.uint8)
                out[..., :3] = np.clip(col, 0, 255).astype(np.uint8)
                out[..., 3] = np.where(m, 255, 0)
                layer[sy:sy + h, sx:sx + w] = np.where(m[..., None], out, layer[sy:sy + h, sx:sx + w])
            layers.append(layer)
    sheet = np.concatenate(layers, axis=0)
    Image.fromarray(sheet, 'RGBA').save('assets/sprites/armor.png', optimize=True)
    json.dump({'layerH': int(H)}, open('assets/sprites/armor.json', 'w'))
    print('armor layers', sheet.shape, 'layerH', H)

if __name__ == '__main__':
    main()
