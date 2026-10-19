#!/usr/bin/env python3
"""
Recolours the UI pack's pieces (core-drill/src/ui/original, Crusenho, CC BY 4.0) into the village's teal-and-gold
palette and writes them to assets/ui/. Run from the repo root:  python3 -I tools/build_village_ui.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'core-drill' / 'src' / 'ui' / 'original'
OUT = ROOT / 'assets' / 'ui'
OUT.mkdir(parents=True, exist_ok=True)
CREAM, SHADE = (255, 253, 245), (255, 197, 121)
GREY, GREY_HI, GREY_LO = (173, 183, 196), (223, 229, 233), (128, 139, 161)


def recolor(im, mapping):
    im = im.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and (r, g, b) in mapping:
                px[x, y] = mapping[(r, g, b)] + (a,)
    return im


BUTTONS = {  # name: (face, shade)
    'gold': ((226, 189, 106), (180, 143, 70)),
    'teal': ((44, 82, 90), (26, 52, 58)),
    'red': ((190, 84, 70), (122, 44, 38)),
    'green': ((120, 190, 110), (70, 130, 70)),
}
for name, (face, shade) in BUTTONS.items():
    for st, n in (('', 1), ('_hover', 2), ('_down', 4)):
        recolor(Image.open(SRC / f'UI_Flat_Button02a_{n}.png'), {CREAM: face, SHADE: shade}).save(OUT / f'btn_{name}{st}.png')
frame = Image.open(SRC / 'UI_Flat_Frame01a.png')
recolor(frame, {GREY: (22, 41, 47), GREY_HI: (86, 124, 124), GREY_LO: (10, 22, 26)}).save(OUT / 'panel_teal.png')
recolor(frame, {GREY: (28, 52, 58), GREY_HI: (104, 148, 146), GREY_LO: (12, 26, 30)}).save(OUT / 'panel_teal2.png')
slot = Image.open(SRC / 'UI_Flat_FrameSlot01a.png')
recolor(slot, {GREY: (16, 32, 37), GREY_HI: (60, 92, 94), GREY_LO: (8, 18, 22)}).save(OUT / 'slot_teal.png')
Image.open(SRC / 'UI_Flat_Banner01a.png').save(OUT / 'banner.png')
Image.open(SRC / 'UI_Flat_InputField01a.png').save(OUT / 'input.png')
Image.open(SRC / 'UI_Flat_Bar05a.png').save(OUT / 'bar.png')
print('wrote', OUT)
