"""Slice the AI-generated reference sheets in assets/source into a packed sprite atlas.

Run from the repo root:  python3 -I tools/extract_sprites.py
Outputs assets/sprites/atlas.png and assets/sprites/atlas.json
Each frame: [x, y, w, h, ox, oy] where (ox, oy) is the top-left of the cropped
frame relative to the anchor (cell centre-x, shared per-group baseline).
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC = 'assets/source/sheet%d.webp'
def load(n): return np.array(Image.open(SRC % n).convert('RGB')).astype(float)

# ---------------------------------------------------------------- keying
def key_player(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(2), a.min(2)
    sat = (mx - mn) / (mx + 1)
    lum = a.mean(2)
    blue = (b > r + 25) & (b > g + 5) & (b > 90)
    skin = (r > 150) & (r > g + 25) & (g > b + 10)
    brown = (r > g + 22) & (g >= b) & (lum > 45) & (sat > 0.35)
    steel = (lum > 150) & (sat < 0.25)
    warm = ((r - b) > 16) & (lum > 40) & (lum < 235)
    m = blue | skin | brown | steel | warm
    m = ndi.binary_opening(m, iterations=1)
    return ndi.binary_closing(m, iterations=2)

def key_bg(colors, tol):
    def f(a):
        d = np.min([np.abs(a - np.array(c)).sum(2) for c in colors], axis=0)
        return d > tol
    return f

def clean(m, link=4, grow=0):
    md = ndi.binary_dilation(m, iterations=link)
    lab, n = ndi.label(md)
    if n == 0: return m
    sizes = ndi.sum(md, lab, range(1, n + 1))
    m = m & (lab == np.argmax(sizes) + 1)
    m = ndi.binary_closing(m, iterations=2)
    m = ndi.binary_fill_holes(m)
    if grow: m = ndi.binary_dilation(m, iterations=grow)
    return m

# ---------------------------------------------------------------- layouts
def row(y0, y1, xs):  # xs: list of (x0,x1)
    return [(x0, y0, x1, y1) for x0, x1 in xs]
def pitch(y0, y1, start, w, step, n):
    return [(start + i * step, y0, start + i * step + w, y1) for i in range(n)]

PX = [3, 130, 258, 386, 514, 642, 769, 897]
def prow(y0, y1, n): return [(PX[i], y0, PX[i] + 124, y1) for i in range(n)]

PLAYER = dict(sheet=1, key=key_player, blank=[(0, 0, .16, .22), (.78, 0, 1, .32)], grow=1, link=2, groups={
    'p_walk':  prow(26, 141, 8),
    'p_slash': prow(166, 280, 7),
    'p_dash':  prow(306, 418, 8),
    'p_death': prow(443, 547, 4),
})

PANEL = [(59, 59, 71), (35, 35, 44)]
ZX_IDLE = [(108, 168), (169, 220), (222, 272)]
ZX_WALK = [(273, 323), (325, 375), (376, 426), (427, 477), (478, 528)]
ZX_ATK = [(539, 591), (592, 644), (646, 698), (699, 752)]
ZX_DIE = [(765, 813), (815, 862), (863, 912), (913, 962), (964, 1011)]
CAST = [(538, 598), (599, 649), (651, 704), (707, 758), (759, 809), (811, 862), (863, 911), (913, 962), (963, 1011)]
def zrow(y0, y1, xs): return row(y0, y1, xs)

ENEMY = dict(sheet=2, key=key_bg(PANEL, 34), blank=[(.70, .86, 1, 1)], grow=0, link=3, groups={
    'zombie_idle': zrow(90, 190, ZX_IDLE), 'zombie_walk': zrow(90, 190, ZX_WALK),
    'zombie_atk': zrow(90, 190, ZX_ATK), 'zombie_die': zrow(90, 190, ZX_DIE),
    'skel_idle': zrow(224, 305, ZX_IDLE), 'skel_walk': zrow(224, 305, ZX_WALK),
    'skel_atk': zrow(224, 305, ZX_ATK), 'skel_die': zrow(224, 305, ZX_DIE),
    'necro_idle': zrow(366, 442, ZX_IDLE), 'necro_walk': zrow(366, 442, ZX_WALK),
    'necro_cast': zrow(366, 442, CAST),
    'necro_summon': zrow(476, 544, CAST[:7]),
    'spawn_walk': zrow(498, 545, [(37, 83), (85, 132), (134, 178), (180, 226)]),
})

BOSS = dict(sheet=3, key=key_bg([(50, 52, 70), (60, 54, 65)], 40), grow=0, link=3, groups={
    'knight_idle': row(84, 147, [(18, 76), (79, 137), (141, 198), (202, 259), (262, 320), (323, 382)]),
    'knight_walk': row(84, 147, [(418, 476), (480, 538), (542, 600), (604, 662), (667, 725), (729, 787), (791, 850)]),
    'knight_swing': row(180, 252, [(18, 76), (79, 137), (142, 198), (202, 259), (263, 337), (340, 422), (426, 495)]),
    'knight_bash': row(180, 252, [(513, 580), (584, 652), (656, 724), (728, 796)]),
    'knight_die': row(180, 252, [(801, 857), (861, 930), (933, 1007)]),
    'king_idle': row(303, 367, [(18, 76), (81, 141), (145, 206), (210, 271), (276, 337)]),
    'king_move': row(303, 367, [(376, 441), (445, 510), (514, 579), (583, 648)]),
    'king_beam': row(388, 452, [(18, 76), (81, 141), (145, 206), (210, 271), (276, 340), (345, 412), (416, 498), (502, 562), (566, 625), (630, 689), (694, 753), (758, 817)]),
    'king_summon': row(473, 537, [(18, 76), (81, 141), (145, 206), (210, 271), (276, 337), (341, 402), (407, 507)]),
    'king_hurt': row(473, 537, [(538, 600)]),
    'king_die': row(473, 537, [(633, 705), (709, 780), (784, 855), (859, 930), (935, 1006)]),
})

# ---------------------------------------------------------------- run
def extract(cfg):
    a = load(cfg['sheet'])
    out = {}
    for gname, cells in cfg['groups'].items():
        frames = []
        for (x0, y0, x1, y1) in cells:
            x0, y0, x1, y1 = x0 + 1, y0 + 1, x1 - 1, y1 - 1
            c = a[y0:y1, x0:x1]
            k = cfg['key'](c)
            for (bx0, by0, bx1, by1) in cfg.get('blank', []):  # corners with sheet labels / torches
                h, w = k.shape
                k[int(by0 * h):int(by1 * h), int(bx0 * w):int(bx1 * w)] = False
            m = clean(k, cfg['link'], cfg['grow'])
            ys, xs = np.where(m)
            if len(ys) < 30: continue
            frames.append((c, m, (x1 - x0) / 2.0, ys.min(), ys.max() + 1, xs.min(), xs.max() + 1))
        base = float(np.median([f[4] for f in frames]))
        out[gname] = []
        for c, m, cx, ty, by, lx, rx in frames:
            rgba = np.dstack([c, m * 255]).astype(np.uint8)[ty:by, lx:rx]
            out[gname].append((Image.fromarray(rgba, 'RGBA'), lx - cx, ty - base))
    return out

def pack(items, width=1024):
    x = y = rowh = 0; placed = []
    for name, im, ox, oy in items:
        w, h = im.size
        if x + w + 1 > width: x, y, rowh = 0, y + rowh + 1, 0
        placed.append((name, im, x, y, ox, oy)); x += w + 1; rowh = max(rowh, h)
    return placed, y + rowh

if __name__ == '__main__':
    items = []
    for cfg in (PLAYER, ENEMY, BOSS):
        for g, fr in extract(cfg).items():
            for i, (im, ox, oy) in enumerate(fr): items.append((f'{g}:{i}', im, ox, oy))
    placed, H = pack(items)
    atlas = Image.new('RGBA', (1024, H), (0, 0, 0, 0)); meta = {}
    for name, im, x, y, ox, oy in placed:
        atlas.paste(im, (x, y)); g, i = name.split(':')
        meta.setdefault(g, []).append([x, y, im.size[0], im.size[1], round(ox, 1), round(oy, 1)])
    atlas.save('assets/sprites/chars.png', optimize=True)
    json.dump(meta, open('assets/sprites/chars.json', 'w'))
    print({k: len(v) for k, v in meta.items()}, atlas.size)
