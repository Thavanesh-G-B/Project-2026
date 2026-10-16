"""Slice terrain tiles + item icons from assets/source/sheet4.webp into assets/sprites/world.png/json.
Run from repo root: python3 -I tools/extract_world.py
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
im = Image.open('assets/source/sheet4.webp').convert('RGB')
T = 32
TILES = {  # name: (x0,y0,x1,y1) on the source sheet
    'grass': (16, 50, 104, 141), 'dirt': (109, 50, 196, 141), 'dirt_roots': (201, 50, 288, 141), 'roots': (293, 50, 379, 141),
    'mossrock': (388, 50, 471, 141), 'trunk': (479, 50, 563, 141), 'leaves': (571, 50, 655, 141), 'leaves2': (663, 50, 730, 141),
    'crate_open': (737, 50, 822, 141), 'crate': (829, 50, 914, 141), 'mushroom': (922, 50, 1008, 141),
    'stone': (19, 183, 102, 267), 'stone2': (110, 183, 195, 267), 'cobble': (202, 183, 287, 267), 'cobble2': (293, 183, 378, 267),
    'ore_iron': (388, 183, 471, 267), 'ore_gold': (479, 183, 563, 267), 'crystal': (571, 183, 655, 267), 'brick': (662, 183, 748, 267),
}
ITEMS = {
    'crystals': (23, 326, 160, 394), 'orb': (200, 339, 245, 383), 'stonechunk': (269, 344, 316, 388), 'iron': (367, 339, 480, 384),
    'coin': (530, 343, 569, 381), 'coin2': (591, 332, 645, 391), 'key': (704, 330, 766, 397), 'map': (810, 330, 881, 393),
    'potion_red': (934, 329, 984, 397),
    'pu_health': (60, 455, 134, 531), 'pu_mana': (250, 455, 316, 531), 'pu_boots': (418, 452, 546, 531),
    'pu_attack': (650, 452, 736, 532), 'pu_shield': (850, 452, 964, 533),
}
out, meta, x, y, rh = [], {}, 0, 0, 0
atlas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
def put(name, img):
    global x, y, rh
    w, h = img.size
    if x + w > 512: x, y, rh = 0, y + rh + 1, 0
    atlas.paste(img, (x, y)); meta[name] = [x, y, w, h]; x += w + 1; rh = max(rh, h)
for n, (x0, y0, x1, y1) in TILES.items():
    # inset to drop the rounded dark border, then downscale to a 32px tile
    c = im.crop((x0 + 3, y0 + 3, x1 - 3, y1 - 3)).resize((T, T), Image.LANCZOS)
    put('t_' + n, c.convert('RGBA'))
for n, (x0, y0, x1, y1) in ITEMS.items():
    c = np.array(im.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4))).astype(int)
    lum = c.sum(2) / 3; sat = c.max(2) - c.min(2)
    m = (lum > 62) | (sat > 55)
    md = ndi.binary_dilation(m, iterations=3)
    lab, k = ndi.label(md)
    if k:
        keep = np.argmax(ndi.sum(md, lab, range(1, k + 1))) + 1
        m = m & (lab == keep)
    m = ndi.binary_fill_holes(ndi.binary_closing(m, iterations=2))
    ys, xs = np.where(m)
    rgba = np.dstack([c, m * 255]).astype(np.uint8)[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    put('i_' + n, Image.fromarray(rgba, 'RGBA'))
atlas = atlas.crop((0, 0, 512, y + rh))
atlas.save('assets/sprites/world.png', optimize=True)
json.dump(meta, open('assets/sprites/world.json', 'w'))
print(len(meta), atlas.size)
