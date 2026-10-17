"""Cut the isometric hero sheet (assets/source/hero_sheet.webp) into an atlas and recolour variants.

Outputs assets/sprites/hero_<variant>.png (identical layout) and assets/sprites/hero.js (frame table).
Variants: base hero, three armour tiers (iron / gold / crystal) and four villager outfits.
"""
import json, colorsys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

def defringe(rgba):
    """Remove the pale paper halo around a cut-out: edge pixels brighter than the body just inside them are recoloured
    from that body (darkened a little so the silhouette keeps its outline). Transparent pixels get black RGB."""
    a = rgba[..., 3] > 0
    core = ndi.binary_erosion(a, structure=np.ones((3, 3)), iterations=2)
    if core.any():
        idx = ndi.distance_transform_edt(~core, return_indices=True)[1]
        near = rgba[..., :3][idx[0], idx[1]].astype(float); cur = rgba[..., :3].astype(float)
        lum = lambda c: c @ np.array([0.3, 0.59, 0.11])
        ring = a & ~core
        bad = ring & (lum(cur) > lum(near) + 14)
        cur[bad] = near[bad] * 0.6
        rgba[..., :3] = np.clip(cur, 0, 255).astype(np.uint8)
    rgba[~a, :3] = 0
    return rgba

SRC = 'assets/source/hero_sheet.webp'
im = np.array(Image.open(SRC).convert('RGB')).astype(int)
H, W, _ = im.shape
BG = np.array([194, 195, 192])
dist = np.abs(im - BG).sum(2)
fg = dist > 45
# the sheet's grid: 1-2 px wide neutral grey lines. Remove them (and nothing thicker) before cutting.
_mx, _mn, _mean = im.max(2), im.min(2), im.mean(2)
neut = (_mx - _mn <= 14) & (_mean >= 105) & (_mean <= 185)
thin = neut & ~ndi.binary_opening(neut, structure=np.ones((3, 3)))
# a real grid line runs a long way: find the rows / columns that are mostly thin-neutral across a band of the sheet
rows = np.where(thin.sum(1) > 200)[0]; cols = np.where(thin.sum(0) > 90)[0]
lines = np.zeros_like(thin)
for r in rows: lines[max(0, r - 1):r + 2, :] = True
for c in cols: lines[:, max(0, c - 1):c + 2] = True
GRIDPIX = lines & neut
fg &= ~(lines & neut)
fill = ndi.binary_fill_holes(fg)          # light steel blades are enclosed by their dark outline
fg = fill & ~(lines & neut)
core = ndi.binary_opening(fg, structure=np.ones((3, 3)))
lab, n = ndi.label(core, structure=np.ones((3, 3)))
objs = ndi.find_objects(lab)

# cell x positions measured from the sheet (left edge of each component), per row
ROW1 = (86, 160); ROW2 = (186, 261)
# vertical grid lines of the walk sheet: a frame's cell centre is the true horizontal position of the character
GRID = {'N': [17, 63.5, 110.5, 157, 204, 247, 289], 'NE': [289, 334, 383.5, 426.5, 468.5, 511], 'E': [511, 554.5, 596.5, 640, 689.5, 733.5], 'SE': [733.5, 776.5, 819, 866, 912.5, 959.5, 1006.5]}
GRID['S'], GRID['SW'], GRID['W'], GRID['NW'] = GRID['N'], GRID['NE'], GRID['E'], GRID['SE']
LAYOUT = {
    # name: (row y-range, x lefts)
    'N':  (ROW1, [25, 72, 118, 166, 211, 254]),
    'NE': (ROW1, [299, 344, 388, 433, 474]),
    'E':  (ROW1, [518, 561, 605, 648, 694]),
    'SE': (ROW1, [741, 783, 827, 874, 920, 965]),
    'S':  (ROW2, [25, 72, 118, 164, 212, 254]),
    'SW': (ROW2, [298, 342, 388, 433, 475]),
    'W':  (ROW2, [519, 561, 606, 649, 693]),
    'NW': (ROW2, [741, 783, 828, 874, 921, 968]),
}
ACT = {   # name -> (x-left hint, y range, cut boxes to erase (x0,y0,x1,y1): stumps)
    'chop0': (268, (366, 447), [(306, 421, 340, 447)]),
    'chop1': (336, (366, 447), [(373, 428, 400, 447)]),
    'chop2': (403, (366, 447), [(441, 421, 470, 447)]),
    'atk0': (525, (366, 447), []),
    'atk1': (590, (366, 447), [], [(618, 406), (645, 382), (651, 386), (628, 412)]), 'atk2': (654, (366, 447), []),
    'stagger': (682, (462, 546), []),
}

def find_obj(xl, yr):
    best = None
    for i, s in enumerate(objs):
        x0, x1, y0, y1 = s[1].start, s[1].stop, s[0].start, s[0].stop
        if abs(x0 - xl) <= 6 and y0 >= yr[0] - 6 and y1 <= yr[1] + 8 and (lab[s] == i + 1).sum() > 300:
            if best is None or (lab[s] == i + 1).sum() > best[1]: best = (i, (lab[s] == i + 1).sum())
    return best[0] + 1 if best else None

def cut(label_id, yr, erase=(), keep_shadowless=True, weapon=False, restore=(), cellx=None):
    comp = lab == label_id
    # recover thin detail around the opened component, but only close to it
    if weapon:       # thin blades vanish in the opening: follow the connected pixels out from the body, inside a window
        win = np.zeros_like(fg); sy, sx = ndi.find_objects(comp.astype(int))[0]
        win[max(0, sy.start - 30):sy.stop + 4, max(0, sx.start - 6):sx.stop + 40] = True
        grow = ndi.binary_propagation(ndi.binary_dilation(comp, iterations=2) & fg, mask=fg & win)
    else:
        grow = ndi.binary_dilation(comp, iterations=3) & fg
    m = grow.copy()
    if restore:      # a pale blade that crosses a grid line: take every non-paper pixel inside a hand-placed polygon
        from PIL import ImageDraw
        pm = Image.new('L', (W, H), 0); ImageDraw.Draw(pm).polygon(restore, fill=255)
        m |= (np.array(pm) > 0) & (dist > 14)
    ys, xs = np.where(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb = im[y0:y1, x0:x1].copy(); mm = m[y0:y1, x0:x1].copy()
    for (ex0, ey0, ex1, ey1) in erase:
        mm[max(0, ey0 - y0):max(0, ey1 - y0), max(0, ex0 - x0):max(0, ex1 - x0)] = False
    # the baked ground shadow: neutral mid-grey, only near the soles
    mx = rgb.max(2); mn = rgb.min(2); mean = rgb.mean(2)
    shadow = (mx - mn <= 16) & (mean >= 95) & (mean <= 160)
    hh = mm.shape[0]
    low = np.zeros_like(mm); low[int(hh * (0.74 if weapon else 0.0)):, :] = True
    sh0 = shadow & low & mm
    shc = None
    if sh0.sum() > 40:                                                  # the sheet's own ground shadow marks where the feet really are
        sl, sn = ndi.label(sh0, structure=np.ones((3, 3)))
        big = int(np.argmax(ndi.sum(sh0, sl, range(1, sn + 1)))) + 1
        yy, xx = np.where(sl == big)
        if len(yy) > 40: shc = (float(xx.mean()) + x0, float(yy.mean()) + y0)
    mm &= ~(shadow & low)
    # drop the specks that removing the shadow leaves behind, and any light halo
    halo = (np.abs(rgb - BG).sum(2) < (52 if weapon else 80))        # steel blades are nearly as light as the paper
    mm &= ~halo
    for _ in range(2):      # peel light fringe pixels off the silhouette edge
        edge = mm & ~ndi.binary_erosion(mm, structure=np.ones((3, 3)))
        mm &= ~(edge & (rgb.mean(2) > 160))
    cl, cn = ndi.label(mm, structure=np.ones((3, 3)))
    if cn > 1:
        sizes = ndi.sum(mm, cl, range(1, cn + 1)); main = int(np.argmax(sizes)) + 1; keep = [main]
        for k, sz in enumerate(sizes):
            if k + 1 == main or sz < 25: continue
            px = rgb[cl == k + 1]; neutral = (px.max(1) - px.min(1)).mean() < 16 and px.mean() < 185
            if not (neutral and sz < 160): keep.append(k + 1)         # weapon pieces stay, grid-line crumbs go
        mm = np.isin(cl, keep)
    # a sheet grid line that crosses the figure leaves a transparent hairline: bridge it with the colours on either side
    gp = GRIDPIX[y0:y1, x0:x1]; rgbf = rgb.astype(float)
    for _ in range(2):
        for axis in (0, 1):
            a_, b_ = np.roll(mm, 1, axis), np.roll(mm, -1, axis)
            bridge = gp & ~mm & a_ & b_
            if bridge.any(): rgbf[bridge] = (np.roll(rgbf, 1, axis)[bridge] + np.roll(rgbf, -1, axis)[bridge]) / 2; mm = mm | bridge
    rgb = rgbf.astype(rgb.dtype)
    # small enclosed holes (the whites of the eyes, bright highlights) belong to the figure: the light-pixel clean-up removed them
    hl, hn = ndi.label(ndi.binary_fill_holes(mm) & ~mm)
    for k in range(1, hn + 1):
        if (hl == k).sum() <= 70: mm = mm | (hl == k)
    ys, xs = np.where(mm)
    ty0, ty1, tx0, tx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb = rgb[ty0:ty1, tx0:tx1]; mm = mm[ty0:ty1, tx0:tx1]
    rgba = np.zeros(rgb.shape[:2] + (4,), np.uint8); rgba[..., :3] = rgb; rgba[..., 3] = mm * 255
    global LAST_ORIGIN; LAST_ORIGIN = (x0 + tx0, y0 + ty0)
    # anchor: the centre of the baked ground shadow (same place in every frame, so the feet do not jitter); else tunic / sole
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    blue = mm & (b > r + 25)
    ax = float(np.where(blue)[1].mean()) if blue.sum() > 30 else mm.shape[1] / 2
    ay = mm.shape[0] - 1
    if shc is not None:
        ay = min(mm.shape[0] - 1, max(0.0, shc[1] - LAST_ORIGIN[1]))
        if not weapon: ax = shc[0] - LAST_ORIGIN[0]
    if cellx is not None: ax = cellx - LAST_ORIGIN[0]
    rgba = defringe(rgba)
    return rgba, ax, ay

frames = {}
order = []
for d, (yr, xs_) in LAYOUT.items():
    for k, xl in enumerate(xs_):
        oid = find_obj(xl, yr)
        assert oid, (d, k, xl)
        g = GRID[d]; frames[f'w_{d}_{k}'] = cut(oid, yr, cellx=(g[k] + g[k + 1]) / 2)
for name, spec in ACT.items():
    xl, yr, erase = spec[:3]; restore = spec[3] if len(spec) > 3 else ()
    oid = find_obj(xl, yr); assert oid, name
    frames[name] = cut(oid, yr, erase, weapon=name.startswith(('chop', 'atk')), restore=restore)
    if name == 'atk1':    # redraw the blade cleanly (the original crosses a grid line)
        from PIL import ImageDraw
        rgba, ax, ay = frames[name]; ox, oy = LAST_ORIGIN
        # clear the noisy blade area, then draw a crisp one
        for yy in range(rgba.shape[0]):
            for xx in range(rgba.shape[1]):
                gx, gy = xx + ox, yy + oy
                if gx >= 631 and 376 <= gy <= 406 and (gx - 631) * 19 + (gy - 406) * -24 < 0 or (gx >= 636 and gy < 395): rgba[yy, xx, 3] = 0
        pil = Image.fromarray(rgba, 'RGBA'); d = ImageDraw.Draw(pil)
        P = lambda x, y: (x - ox, y - oy)
        d.polygon([P(627, 402), P(646, 385), P(649, 386), P(631, 408)], fill=(70, 80, 98, 255))
        d.polygon([P(628, 403), P(645, 387), P(647, 387), P(631, 406)], fill=(214, 224, 238, 255))
        d.line([P(629, 403), P(645, 388)], fill=(250, 253, 255, 255), width=1)
        d.line([P(622, 410), P(633, 398)], fill=(60, 44, 30, 255), width=2)
        frames[name] = (np.array(pil), ax, ay)
# death sequence: standing stagger and the two lying frames
for k, xl in enumerate([746, 819]):
    oid = find_obj(xl, (462, 546)); assert oid, xl
    frames[f'dead{k}'] = cut(oid, (462, 546), weapon=True)
print(len(frames), 'frames', [k for k in frames if k.startswith('dead')])

# ---------------------------------------------------------------- recolour
def ramp(stops):
    stops = [tuple(int(s[i:i + 2], 16) for i in (1, 3, 5)) for s in stops]
    def f(t):
        t = min(1, max(0, t)); a = t * (len(stops) - 1); i = min(len(stops) - 2, int(a)); u = a - i
        return tuple(stops[i][c] * (1 - u) + stops[i + 1][c] * u for c in range(3))
    return f

def classify(rgba, ay_h):
    rgb = rgba[..., :3].astype(float) / 255; a = rgba[..., 3] > 0
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(2); mn = rgb.min(2); v = mx; s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    hh = rgba.shape[0]; yy = np.arange(hh)[:, None] * np.ones((1, rgba.shape[1]))
    blue = a & (B > R + 0.06) & (s > 0.2)
    tunic = blue & (v >= 0.4)
    pants = blue & (v < 0.4)
    brown = a & (R > B + 0.05) & (s > 0.25) & (R >= G)
    hair = brown & (v < 0.5) & (yy < hh * 0.26)
    boots = brown & (v < 0.55) & (yy > hh * 0.8)
    return tunic, pants, hair, boots, v

def recolor(rgba, spec, lying=False):
    out = rgba.copy(); tunic, pants, hair, boots, v = classify(rgba, 0)
    if lying:        # lying frames: no reliable head / boot zones
        hair = np.zeros_like(hair); boots = np.zeros_like(boots)
    for mask, key, lo, hi in ((tunic, 'tunic', 0.38, 0.95), (pants, 'pants', 0.1, 0.4), (hair, 'hair', 0.15, 0.5), (boots, 'boots', 0.15, 0.55)):
        f = spec.get(key)
        if not f or not mask.any(): continue
        t = np.clip((v - lo) / (hi - lo), 0, 1)
        cols = np.array([f(x) for x in t[mask]])
        out[..., :3][mask] = np.clip(cols, 0, 255).astype(np.uint8)
    return out

METAL = {
    1: dict(tunic=ramp(['#3a4252', '#8b94a6', '#e4eaf5']), pants=ramp(['#1e232e', '#4a5366', '#7a8498']), hair=ramp(['#3a4252', '#8b94a6', '#e4eaf5']), boots=ramp(['#1a1e28', '#3c4454', '#6a7488'])),
    2: dict(tunic=ramp(['#5a4208', '#d4a22c', '#fff0b0']), pants=ramp(['#2e2208', '#7a5c18', '#b08a34']), hair=ramp(['#5a4208', '#d4a22c', '#fff0b0']), boots=ramp(['#2e2208', '#6a4e14', '#a07c2c'])),
    3: dict(tunic=ramp(['#0c3560', '#44aee0', '#e0faff']), pants=ramp(['#0a2038', '#1f5a8a', '#4a92c0']), hair=ramp(['#0c3560', '#44aee0', '#e0faff']), boots=ramp(['#0a2038', '#1a4c78', '#3c82b0'])),
}
VILL = [
    dict(tunic=ramp(['#5a3e14', '#b0873c', '#ecd08a']), pants=ramp(['#2c2218', '#5e4a30', '#8e7650']), hair=ramp(['#5e4018', '#c4a060', '#f4e0a4'])),
    dict(tunic=ramp(['#2a4420', '#6a9a50', '#bcdca0']), pants=ramp(['#2a2418', '#54482e', '#807048'])),
    dict(tunic=ramp(['#5a2218', '#a85a48', '#e8b4a0']), pants=ramp(['#241c14', '#4c3e2c', '#74644a']), hair=ramp(['#0e0c0c', '#2c2622', '#5c544c'])),
    dict(tunic=ramp(['#34344a', '#7c7c98', '#cacadc']), pants=ramp(['#2a261e', '#58503c', '#847a5c']), hair=ramp(['#585450', '#9c988e', '#dcd8d0'])),
]
VARIANTS = [('hero', {}), ('a1', METAL[1]), ('a2', METAL[2]), ('a3', METAL[3])] + [(f'v{k}', VILL[k]) for k in range(4)]

# ---------------------------------------------------------------- pack
names = list(frames)
PAD = 2; AW = 1024
x = y = 0; rowh = 0; rects = {}
for nme in names:
    rgba, ax, ay = frames[nme]; h, w = rgba.shape[:2]
    if x + w + PAD > AW: x = 0; y += rowh + PAD; rowh = 0
    rects[nme] = [x, y, w, h, round(ax, 1), ay]
    x += w + PAD; rowh = max(rowh, h)
AH = y + rowh + PAD
for vname, spec in VARIANTS:
    atlas = np.zeros((AH, AW, 4), np.uint8)
    for nme in names:
        rgba, ax, ay = frames[nme]; px, py, w, h = rects[nme][:4]
        out = recolor(rgba, spec, lying=nme.startswith('dead')) if spec else rgba
        atlas[py:py + h, px:px + w] = out
    Image.fromarray(atlas).save(f'assets/sprites/hero_{vname}.png', optimize=True)
idle = {}
for d in LAYOUT:
    best = None; k = 0
    while f'w_{d}_{k}' in frames:
        rgba = frames[f'w_{d}_{k}'][0]; h = rgba.shape[0]; low = rgba[int(h * 0.82):, :, 3] > 0
        cols = np.where(low.any(0))[0]; spread = (cols.max() - cols.min()) if len(cols) else 99
        if best is None or spread < best[0]: best = (spread, k)
        k += 1
    idle[d] = best[1]
open('assets/sprites/hero.js', 'w').write('window.HERO_ATLAS=' + json.dumps({'w': AW, 'h': AH, 'frames': rects, 'variants': [v for v, _ in VARIANTS], 'idle': idle}, separators=(',', ':')) + ';\n')
print('atlas', AW, AH)
