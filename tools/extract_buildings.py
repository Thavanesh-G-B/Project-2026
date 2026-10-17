"""Cut building, prop and terrain sprites out of the three reference sheets (assets/source/ref_7/8/9.webp).

Outputs assets/sprites/bld.png and assets/sprites/bld.js (window.BLD_ATLAS: frame rects + anchors).
The sheets have soft baked shadows and (ref 8/9) a grid; the silhouette is found from edges, filled, and the
tan / grey ground shadow is removed so the game can draw its own.
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

def defringe(rgba):
    a = rgba[..., 3] > 0
    core = ndi.binary_erosion(a, structure=np.ones((3, 3)), iterations=2)
    if core.any():
        idx = ndi.distance_transform_edt(~core, return_indices=True)[1]
        near = rgba[..., :3][idx[0], idx[1]].astype(float); cur = rgba[..., :3].astype(float)
        lum = lambda c: c @ np.array([0.3, 0.59, 0.11])
        bad = (a & ~core) & (lum(cur) > lum(near) + 14)
        cur[bad] = near[bad] * 0.6
        rgba[..., :3] = np.clip(cur, 0, 255).astype(np.uint8)
    rgba[~a, :3] = 0
    return rgba

SRC = {n: np.array(Image.open(f'assets/source/ref_{n}.webp').convert('RGB')).astype(float) for n in (7, 8, 9)}

# name: (sheet, (x0, y0, x1, y1), [boxes to blank out], options)
S = {
    # ---- sheet 7: clean cartoon set
    'h_thatch':   (7, (28, 362, 222, 518), [], {}),
    'archer_a':   (7, (290, 366, 402, 520), [], {}),
    'mage_a':     (7, (455, 345, 568, 522), [], {}),
    'mage_b':     (7, (878, 318, 972, 522), [], {}),
    'house_a':    (7, (600, 372, 695, 522), [], {}),
    'house_b':    (7, (732, 372, 834, 522), [], {}),
    'mine_gold':  (7, (440, 196, 602, 318), [], {}),
    'mine_iron':  (7, (245, 198, 412, 318), [], {}),
    'mine_stone': (7, (32, 200, 228, 318), [], {}),
    'logs':       (7, (652, 210, 798, 324), [], {}),
    'stumps':     (7, (820, 220, 952, 320), [], {}),
    'boulders':   (7, (788, 68, 886, 148), [], {}),
    'berry':      (7, (898, 78, 992, 150), [], {}),
    'cactus':     (7, (583, 56, 648, 146), [], {}),
    'blk_grass':  (7, (36, 56, 142, 152), [], {}),
    'blk_dirt':   (7, (160, 56, 272, 152), [], {}),
    'blk_stone':  (7, (288, 56, 398, 152), [], {}),
    'blk_snow':   (7, (414, 56, 524, 152), [], {}),
    # ---- sheet 8: pixel-ish set
    'hall_stone': (8, (515, 350, 668, 526), [], {}),
    'farm':       (8, (668, 390, 824, 522), [], {}),
    'lumber':     (8, (838, 396, 992, 522), [], {}),
    'archer_c':   (8, (32, 362, 140, 520), [], {}),
    'mage_spiral':(8, (200, 330, 300, 520), [], {}),
    'cannon_a':   (8, (345, 420, 474, 524), [], {}),
    # ---- sheet 9: painterly set
    'hall_timber':(9, (18, 52, 264, 302), [], {}),
    'mage_c':     (9, (425, 168, 542, 340), [(538, 250, 600, 340)], {}),
    'cannon_b':   (9, (650, 185, 864, 345), [(852, 185, 870, 345)], {}),
    'tesla':      (9, (850, 195, 1002, 336), [], {}),
    'mine_wood':  (9, (770, 52, 882, 162), [], {}),
    'mine_rock':  (9, (884, 52, 982, 162), [], {}),
}

def cut(sheet, box, blank):
    x0, y0, x1, y1 = box
    a = SRC[sheet][y0:y1, x0:x1].copy()
    for (bx0, by0, bx1, by1) in blank:
        a[max(0, by0 - y0):max(0, by1 - y0), max(0, bx0 - x0):max(0, bx1 - x0)] = np.nan
    nanm = np.isnan(a[..., 0]); a[nanm] = 0
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]); bg = np.median(border, axis=0)
    L = a.mean(2)
    g = np.hypot(ndi.sobel(ndi.gaussian_filter(L, 0.7), 1), ndi.sobel(ndi.gaussian_filter(L, 0.7), 0))
    d = np.abs(a - bg).sum(2)
    edge = (g > 62) | (d > 215)
    edge &= ~nanm
    m = ndi.binary_closing(edge, structure=np.ones((3, 3)), iterations=2)
    m = ndi.binary_fill_holes(m) & ~nanm
    m = ndi.binary_opening(m, structure=np.ones((3, 3)))
    # soft ground shadow: smooth, low-contrast tan / grey regions that sit close to the paper colour
    mx, mn = a.max(2), a.min(2); sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    sd = ndi.generic_filter(L, np.std, size=3)
    shadow = (sd < 5.5) & (sat < 0.36) & (L > 150) & (np.abs(a - bg).sum(2) < 230)
    sl, sn = ndi.label(shadow)
    if sn:
        sizes = ndi.sum(shadow, sl, range(1, sn + 1)); shadow = np.isin(sl, [i + 1 for i, s in enumerate(sizes) if s > 40])
    m &= ~ndi.binary_dilation(shadow, iterations=1) | (g > 90)
    m = ndi.binary_opening(m, structure=np.ones((3, 3)))
    lab, n = ndi.label(m)
    if n == 0: raise SystemExit('empty cut ' + str(box))
    sizes = ndi.sum(m, lab, range(1, n + 1)); keep = [i + 1 for i, s in enumerate(sizes) if s > 0.05 * sizes.max()]
    m = np.isin(lab, keep)
    # peel the light fringe
    for _ in range(1):
        edgep = m & ~ndi.binary_erosion(m, structure=np.ones((3, 3)))
        m &= ~(edgep & (np.abs(a - bg).sum(2) < 70))
    ys, xs = np.where(m)
    ty0, ty1, tx0, tx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.zeros((ty1 - ty0, tx1 - tx0, 4), np.uint8)
    rgba[..., :3] = a[ty0:ty1, tx0:tx1].astype(np.uint8); rgba[..., 3] = m[ty0:ty1, tx0:tx1] * 255
    return rgba

# extra clean-up in sprite coordinates (x0, y0, x1, y1): props that belong to the sheet picture, not to the building
POST = {
    'hall_timber': [(0, 112, 31, 226), (186, 146, 226, 226)],          # signpost on the left, well on the right (the village has its own well)
    'cannon_b': [(24, 20, 33, 31)],                                     # paper seen through a gap in the battlements
    'mage_c': [(0, 56, 24, 76), (65, 80, 80, 105), (0, 108, 12, 124)],  # wisps of the spell effect
}

sheet_of = {n: v[0] for n, v in S.items()}

def finish(name, rgba):
    a = rgba[..., 3] > 0
    for (x0, y0, x1, y1) in POST.get(name, []): a[y0:y1, x0:x1] = False
    # tan ground-shadow crumbs that hug the silhouette edge (sheets 8 and 9 only; stone and snow are grey, not tan)
    if sheet_of[name] != 7:
        for _ in range(3):
            ring = a & ~ndi.binary_erosion(a, structure=np.ones((3, 3)), iterations=3)
            rgb = rgba[..., :3].astype(float); mx, mn = rgb.max(2), rgb.min(2); sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0); lum = rgb @ np.array([0.3, 0.59, 0.11])
            tan = (sat > 0.1) & (sat < 0.36) & (lum > 140) & (lum < 225) & (rgb[..., 0] - rgb[..., 2] > 20) & (rgb[..., 0] >= rgb[..., 1])
            a &= ~(ring & tan)
    lab_, n_ = ndi.label(a, structure=np.ones((3, 3)))
    if n_ > 1:
        sizes = ndi.sum(a, lab_, range(1, n_ + 1)); a = np.isin(lab_, [i + 1 for i, z in enumerate(sizes) if z > 0.04 * sizes.max()])
    rgba = rgba.copy(); rgba[..., 3] = a * 255
    ys, xs = np.where(a); rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    rgba = defringe(rgba)
    # one shared dark outline so sprites from different sheets read as one set (and no pale fringe is left)
    a = rgba[..., 3] > 0
    pad = np.zeros((rgba.shape[0] + 4, rgba.shape[1] + 4, 4), np.uint8); pad[2:-2, 2:-2] = rgba
    pa = pad[..., 3] > 0; ring = ndi.binary_dilation(pa, structure=ndi.generate_binary_structure(2, 1)) & ~pa
    pad[ring] = (38, 26, 20, 255)
    # even out saturation / brightness between the three sheets
    body = pa; rgb = pad[..., :3].astype(float) / 255; mx, mn = rgb.max(2), rgb.min(2)
    S_ = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0); V_ = mx
    kS = float(np.clip(0.40 / max(0.05, S_[body].mean()), 0.8, 1.25)); kV = float(np.clip(0.50 / max(0.05, V_[body].mean()), 0.88, 1.18))
    import colorsys
    flat = rgb[body]; out = np.empty_like(flat)
    h_ = np.zeros(len(flat)); 
    for i, (r, g, b) in enumerate(flat):
        h, sv, vv = colorsys.rgb_to_hsv(r, g, b); out[i] = colorsys.hsv_to_rgb(h, min(1, sv * kS), min(1, vv * kV))
    rgb[body] = out; pad[..., :3] = np.where(ring[..., None], pad[..., :3], (rgb * 255).astype(np.uint8))
    pad[~(pad[..., 3] > 0), :3] = 0
    return pad

frames = {}
for name, (sheet, box, blank, opt) in S.items():
    frames[name] = finish(name, defringe(cut(sheet, box, blank)))
names = list(frames)
PAD = 3; AW = 1400; x = y = rowh = 0; rects = {}
for n in names:
    h, w = frames[n].shape[:2]
    if x + w + PAD > AW: x = 0; y += rowh + PAD; rowh = 0
    rects[n] = [x, y, w, h]; x += w + PAD; rowh = max(rowh, h)
AH = y + rowh + PAD
atlas = np.zeros((AH, AW, 4), np.uint8)
for n in names:
    px, py, w, h = rects[n]; atlas[py:py + h, px:px + w] = frames[n]
Image.fromarray(atlas).save('assets/sprites/bld.png', optimize=True)
open('assets/sprites/bld.js', 'w').write('window.BLD_ATLAS=' + json.dumps({'w': AW, 'h': AH, 'frames': rects}, separators=(',', ':')) + ';\n')
print(len(names), 'sprites', AW, AH)
