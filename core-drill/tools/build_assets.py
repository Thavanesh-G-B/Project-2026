#!/usr/bin/env python3
"""
Build the game's image assets from the three uploaded packs (extracted by hand into one folder each):

    python3 -I tools/build_assets.py <lander_dir> <ui_dir>

  lander_dir  the "Lunar Lander Upload" folder (Matt Walkden, CC0)
  ui_dir      the "Complete_UI_Essential_Pack_Free/01_Flat_Theme/Sprites" folder (Crusenho, CC BY 4.0)

Writes src/assets/lander/*.png (ships, weapons, effects, backgrounds, HUD) and src/ui/*.png (recoloured
buttons, frames, bars). The UI pack ships white/grey/blue/orange pieces; the game needs a family that sits on a
dark background, so the cream and grey faces are re-mapped to a small palette here.
"""
import shutil
import sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent.parent

LANDER = {
    'Ships/Spaceships.png': 'ships.png', 'Ships/Guns.png': 'guns.png', 'Ships/Turrets.png': 'turrets.png',
    'Ships/Missiles.png': 'missiles.png', 'Ships/Tracked_Vehicle.png': 'rover.png',
    'Effects/Explosion.png': 'explosion.png', 'Effects/Fx_01.png': 'fx1.png', 'Effects/Fx_02.png': 'fx2.png',
    'Effects/Fx_03.png': 'fx3.png', 'Effects/Fx_04.png': 'fx4.png', 'Effects/Fx_05.png': 'fx5.png',
    'Effects/Thruster_01.png': 'thruster1.png', 'Effects/Thruster_02.png': 'thruster2.png',
    'Effects/Thruster_03.png': 'thruster3.png', 'Effects/Thruster_04.png': 'thruster4.png',
    'Space Background/Asteroids.png': 'asteroids.png', 'Space Background/Asteroids_Foreground.png': 'asteroids_fg.png',
    'Space Background/Star_Tiles.png': 'stars.png', 'Space Background/debris.png': 'debris.png',
    'Moon Background/Surface_Layer1.png': 'moon1.png', 'Moon Background/Surface_Layer2.png': 'moon2.png',
    'Moon Background/Surface_Layer3.png': 'moon3.png', 'Moon Background/Surface_Layer4.png': 'moon4.png',
    'Moon Tiles/TileSheet-v1.png': 'props.png',
    'UI/Hull_Bar.png': 'hull_bar.png', 'UI/Fuel_Bar.png': 'fuel_bar.png', 'UI/Radar_Frame.png': 'radar.png',
    'UI/Velocity_Gauges.png': 'gauges.png', 'UI/Crew_Icon.png': 'crew_icon.png', 'UI/Crew_Counter.png': 'crew_counter.png',
    'UI/Missiles_Icon.png': 'missile_icon.png', 'UI/Missile_Counter.png': 'missile_counter.png',
}

CREAM, SHADE = (255, 253, 245), (255, 197, 121)
FACES = {  # name: (face, shade)
    'blue': ((38, 122, 233), (27, 74, 185)),
    'orange': ((255, 166, 31), (227, 111, 31)),
    'green': ((72, 196, 122), (30, 128, 82)),
    'red': ((236, 82, 82), (164, 42, 52)),
    'grey': ((173, 183, 196), (128, 139, 161)),
    'dark': ((30, 40, 62), (18, 26, 44)),
}


def recolor(im, mapping):
    im = im.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and (r, g, b) in mapping:
                px[x, y] = mapping[(r, g, b)] + (a,)
    return im


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    lander, ui = Path(sys.argv[1]), Path(sys.argv[2])
    out_l = HERE / 'src' / 'assets' / 'lander'
    out_u = HERE / 'src' / 'ui'
    out_l.mkdir(parents=True, exist_ok=True)
    out_u.mkdir(parents=True, exist_ok=True)
    for src, dst in LANDER.items():
        shutil.copy(lander / src, out_l / dst)

    # buttons: four states of the rounded button in six colours
    for name, (face, shade) in FACES.items():
        for st, n in (('', 1), ('_hover', 2), ('_down', 4)):
            im = Image.open(ui / f'UI_Flat_Button02a_{n}.png')
            recolor(im, {CREAM: face, SHADE: shade}).save(out_u / f'btn_{name}{st}.png')
    # panels: the grey frame becomes the dark family; blue and orange frames are used as they are
    g = Image.open(ui / 'UI_Flat_Frame01a.png')
    recolor(g, {(173, 183, 196): (22, 31, 52), (223, 229, 233): (70, 90, 130), (128, 139, 161): (10, 15, 28)}).save(out_u / 'panel_dark.png')
    recolor(g, {(173, 183, 196): (34, 46, 74), (223, 229, 233): (96, 120, 170), (128, 139, 161): (14, 20, 38)}).save(out_u / 'panel_mid.png')
    shutil.copy(ui / 'UI_Flat_Frame01a.png', out_u / 'panel_grey.png')
    shutil.copy(ui / 'UI_Flat_Frame02a.png', out_u / 'panel_blue.png')
    shutil.copy(ui / 'UI_Flat_Frame03a.png', out_u / 'panel_orange.png')
    s = Image.open(ui / 'UI_Flat_FrameSlot01a.png')
    recolor(s, {(173, 183, 196): (14, 20, 36), (223, 229, 233): (50, 66, 100), (128, 139, 161): (8, 12, 22)}).save(out_u / 'slot_dark.png')
    shutil.copy(ui / 'UI_Flat_FrameSlot03a.png', out_u / 'slot_orange.png')
    shutil.copy(ui / 'UI_Flat_FrameSlot02a.png', out_u / 'slot_blue.png')
    for n, d in (('Banner01a', 'banner.png'), ('InputField01a', 'input.png'), ('Bar05a', 'bar.png'), ('Bar08a', 'bar_blue.png'), ('Bar11a', 'bar_orange.png'),
                 ('ToggleOn01a', 'toggle_on.png'), ('ToggleOff01a', 'toggle_off.png'), ('IconCheck01a', 'icon_check.png'), ('IconCross01a', 'icon_cross.png')):
        shutil.copy(ui / f'UI_Flat_{n}.png', out_u / d)
    print('assets written to', out_l, 'and', out_u)


main()
