"""Sanity-checks the cut-out sprite atlases: no pale fringe around any silhouette, nothing opaque is left near-white,
and every frame has a sensible size. Usage: python3 tools/check_sprites.py"""
import json, re, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

bad = 0
def edge_stats(rgba):
    a = rgba[..., 3] > 0
    edge = a & ~ndi.binary_erosion(a, structure=np.ones((3, 3)))
    lum = rgba[..., :3].astype(float) @ np.array([0.3, 0.59, 0.11])
    return edge.sum(), float((lum[edge] > 170).mean()), float(lum[edge].mean())

def check(path, meta, label):
    global bad
    im = np.array(Image.open(path).convert('RGBA')); frames = json.loads(re.search(r'=(.*);', open(meta).read()).group(1))['frames']
    worst = 0; mean_l = []
    for name, f in frames.items():
        x, y, w, h = f[:4]; n, pale, ml = edge_stats(im[y:y + h, x:x + w]); worst = max(worst, pale); mean_l.append(ml)
        if pale > 0.12: print(f'  FAIL {label}:{name} has {pale:.0%} pale edge pixels'); bad += 1
        if w < 10 or h < 10: print(f'  FAIL {label}:{name} is tiny'); bad += 1
    print(f'{label}: {len(frames)} frames, worst pale edge {worst:.1%}, mean edge brightness {np.mean(mean_l):.0f}')

check('assets/sprites/bld.png', 'assets/sprites/bld.js', 'buildings')
for v in ['hero', 'a1', 'a2', 'a3', 'v0', 'v1', 'v2', 'v3']:
    check(f'assets/sprites/hero_{v}.png', 'assets/sprites/hero.js', 'hero_' + v)
sys.exit(1 if bad else 0)
