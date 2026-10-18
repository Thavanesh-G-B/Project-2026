"""Rebuild the enemy sprites at 3x resolution (assets/sprites/foes.png + foes.js).

The platformer frames in chars.png are small pixel art. Each frame is scaled 2x twice with the EPX / Scale2x rule (which rounds diagonals
without blurring flat colour), softened a touch, sharpened, and brought down to 3x. Two extra raiders are made by recolouring:
the Brute (a ruddy zombie) and the Bone Lord (a steel-blue skeleton).
"""
import json, colorsys
import numpy as np
from PIL import Image, ImageFilter

C = json.load(open('assets/sprites/chars.json')); SRC = Image.open('assets/sprites/chars.png').convert('RGBA')
GROUPS = ['zombie_idle', 'zombie_walk', 'zombie_atk', 'zombie_die', 'skel_idle', 'skel_walk', 'skel_atk', 'skel_die', 'necro_idle', 'necro_walk', 'necro_cast', 'necro_summon',
          'spawn_walk', 'knight_idle', 'knight_walk', 'knight_swing', 'knight_bash', 'knight_die', 'king_idle', 'king_move', 'king_beam', 'king_summon', 'king_hurt', 'king_die']
K = 3

def epx(a):
    H, W = a.shape[:2]; p = np.pad(a, ((1, 1), (1, 1), (0, 0)), mode='edge')
    P = p[1:-1, 1:-1]; A = p[:-2, 1:-1]; B = p[1:-1, 2:]; Cc = p[1:-1, :-2]; D = p[2:, 1:-1]
    eq = lambda x, y: np.all(x == y, axis=2)
    out = np.zeros((H * 2, W * 2, 4), a.dtype)
    out[0::2, 0::2] = np.where((eq(Cc, A) & ~eq(Cc, D) & ~eq(A, B))[..., None], A, P)
    out[0::2, 1::2] = np.where((eq(A, B) & ~eq(A, Cc) & ~eq(B, D))[..., None], B, P)
    out[1::2, 0::2] = np.where((eq(D, Cc) & ~eq(D, B) & ~eq(Cc, A))[..., None], Cc, P)
    out[1::2, 1::2] = np.where((eq(B, D) & ~eq(B, A) & ~eq(D, Cc))[..., None], D, P)
    return out

def upscale(img):
    pad = 2; w, h = img.size
    base = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0)); base.paste(img, (pad, pad))
    a = epx(epx(np.array(base))); r = Image.fromarray(a, 'RGBA')
    rgb = r.convert('RGB').filter(ImageFilter.GaussianBlur(0.8))
    al = r.split()[3].filter(ImageFilter.GaussianBlur(1.0)).point(lambda v: 255 if v > 118 else 0)
    out = rgb.convert('RGBA'); out.putalpha(al)
    out = out.resize((out.size[0] * K // 4, out.size[1] * K // 4), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.0, 80, 2))
    # keep the alpha crisp after the resize
    ar = np.array(out); ar[..., 3] = np.where(ar[..., 3] > 110, 255, 0); ar[ar[..., 3] == 0, :3] = 0
    return Image.fromarray(ar, 'RGBA'), pad

def hsv(rgb):
    r, g, b = [rgb[..., i] / 255.0 for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b); d = mx - mn
    h = np.zeros_like(mx); m = d > 1e-6
    rc = np.where(m, (mx - r) / np.where(m, d, 1), 0); gc = np.where(m, (mx - g) / np.where(m, d, 1), 0); bc = np.where(m, (mx - b) / np.where(m, d, 1), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2 + rc - bc, 4 + gc - rc)); h = np.where(m, (h / 6) % 1.0, 0)
    return h * 360, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx

def retint(img, rules):
    a = np.array(img).copy(); h, s, v = hsv(a[..., :3].astype(float)); op = a[..., 3] > 0
    for (h0, h1, smin, smax, vmin, vmax, to_h, sm, vm) in rules:
        m = op & (h >= h0) & (h <= h1) & (s >= smin) & (s <= smax) & (v >= vmin) & (v <= vmax)
        ys, xs = np.where(m)
        for y, x in zip(ys, xs):
            r, g, b = colorsys.hsv_to_rgb(to_h / 360 if to_h is not None else h[y, x] / 360, min(1, s[y, x] * sm), min(1, v[y, x] * vm)); a[y, x, :3] = (np.array([r, g, b]) * 255).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')

# the zombie: green skin -> ruddy; dark clothes -> darker brown.  the skeleton: bone -> blue steel
BRUTE = [(60, 160, 0.12, 1, 0.12, 1, 14, 1.05, 0.95), (180, 290, 0.05, 0.6, 0.0, 0.5, 20, 0.9, 0.8)]
BONELORD = [(25, 70, 0.04, 0.6, 0.35, 1, 214, 0.9, 0.82), (0, 360, 0.0, 0.1, 0.55, 1, 214, 1.0, 0.9)]
VARIANTS = {'brute': ('zombie', BRUTE), 'bonelord': ('skel', BONELORD)}

frames = {}      # group -> list of (image, ox, oy)
def put(name, srcgroup, rules=None):
    out = []
    for f in C[srcgroup]:
        x, y, w, h, ox, oy = f
        up, pad = upscale(SRC.crop((x, y, x + w, y + h)))
        if rules: up = retint(up, rules)
        out.append((up, (ox - pad) * K, (oy - pad) * K))
    frames[name] = out
for g in GROUPS: put(g, g)
for v, (base, rules) in VARIANTS.items():
    for part in ('idle', 'walk', 'atk', 'die'):
        src = f'{base}_{part}'; put(f'{v}_{part}', src, rules)

# pack
PAD = 3; AW = 2400; x = y = rowh = 0; table = {}; placements = []
for g, lst in frames.items():
    table[g] = []
    for im, ox, oy in lst:
        w, h = im.size
        if x + w + PAD > AW: x = 0; y += rowh + PAD; rowh = 0
        table[g].append([x, y, w, h, ox, oy]); placements.append((im, x, y)); x += w + PAD; rowh = max(rowh, h)
AH = y + rowh + PAD
atlas = Image.new('RGBA', (AW, AH), (0, 0, 0, 0))
for im, px, py in placements: atlas.alpha_composite(im, (px, py))
atlas.save('assets/sprites/foes.png', optimize=True)
open('assets/sprites/foes.js', 'w').write('window.FOES=' + json.dumps({'k': K, 'groups': table}, separators=(',', ':')) + ';\n')
print(len(frames), 'groups', AW, AH)
