# Ashen Hollow

Two games share this project: a side-scrolling **survival platformer** (`index.html`) and a Clash of Clans-style **village builder and defender** (`village.html`). Each links to the other.

## Village mode (`village.html`)

An isometric island village in the spirit of Clash of Clans. Gather resources, build and upgrade, then defend against escalating undead raids with your hero, towers, walls, traps and trained guards.

- **Collectors**: Gold Mines and Lumber Camps fill up over time (even while you are away, up to 30 minutes at half rate). Tap the floating coin or log bubble to collect before they are full.
- **Build**: open the *Village shop* (`3`), pick a building and click an empty tile. Builders (Town Hall level + 1) work in parallel on construction and upgrades; walls can be dragged out in a line. Everything is capped by the Town Hall level, and storage is limited until you build Storage Vaults.
- **Defenses**: Archer Towers (hit ground and air), Cannons (splash, ground only), Walls (enemies must break through or walk around), Spike Traps, and Barracks that train guards wearing Iron / Gold / Crystal armor by level.
- **Raids**: *Start raid N* sends zombies, skeletons, necromancers and necro-spawn from the island lanes. Skeletons and the Cursed Knight (raid 5, 15, ...) hunt your defenses, the flying Necromancer King (raid 10, 20, ...) goes for the Town Hall. Lose the Town Hall and the village falls; other destroyed buildings become ruins you can rebuild at half price.
- **Hero**: left-click inspects and collects, right-click commands (move, attack an enemy, chop a tree). `Space` is *Hero strike*, a shockwave on an 8 s cooldown. The idle hero hunts enemies on its own during raids. It levels up with kills and respawns at the Town Hall if it falls.
- Camera: drag to pan, wheel to zoom, *Follow hero*, *Village* (recentre), *World map* (jump anywhere). Progress is saved in the browser automatically.

Keys: `1` move/inspect, `2` gather tree, `3` shop, `R` start raid, `Space` strike, `F` follow, `M` map, `P` pause, `Esc` cancel.

---

## Platformer mode (`index.html`)

A 2D side-scrolling survival platformer that runs in the browser (HTML5 canvas, no build step, no dependencies).
All character, enemy, boss, terrain and item art is sliced from the four reference sprite sheets in `assets/source/`.

## Play

Open `index.html` in a browser, or serve the folder (`python3 -m http.server`) and visit `http://localhost:8000`.

## Goal

Mine, build and craft by day. At dusk the undead rise on the surface and underground caves are always dangerous.
Survive the nights, defeat **The Cursed Knight** (night 3) and **The Necromancer King** (night 6) to win; afterwards you can keep going in endless mode.
Surface undead burn in sunlight at dawn, so a shelter of blocks will get you through the night.

## Controls

| Input | Action |
| --- | --- |
| `A` `D` / arrows | Move |
| `W` / `Space` / `Up` | Jump (variable height) |
| `J` / `Z` | Sword slash (also destroys enemy projectiles) |
| `K` / `X` / `Shift` | Dash attack (30 mana, brief invulnerability) |
| Mouse hold left | Mine the tile under the cursor (range ~4.8 tiles) |
| Mouse hold right | Place the selected block |
| `1`-`4` / mouse wheel | Select block: dirt, stone, brick, wood planks |
| `5` `6` `7` | Use Speed Boots / Attack Boost / Defense Shield (25 s each) |
| `Q` / `R` | Health potion / Mana potion |
| `C` | Crafting menu: Items / Gear / Armor tabs (click, or arrows + Enter; Left/Right or Tab switches tab) |
| `F` | Open a vault door (needs a Vault Key) |
| `M` | Toggle minimap |
| `P` / `Esc` | Pause |
| `N` | Toggle sound |

## Systems

- **Procedural world** (320x84 tiles): forest surface with trees, boulders and crates; caves, ore (iron, gold), glowing crystals, and three locked brick vaults deep underground.
- **Day/night cycle** with sky, stars, darkness and a light radius around you; deep caves are dark even by day.
- **Enemies**: zombies, skeletons, necromancers (ranged dark orbs + summon Necro-Spawn), plus two bosses with multi-phase attacks.
- **Crafting**: potions, bricks, buffs, and three tiers each of sword and pickaxe.
- **Armor**: helmet, chestplate and leggings in Iron, Gold and Crystal tiers. Each piece adds defense (3% less damage per point, max 60%) and recolours that part of your character, so you can see what you wear. Crafting a piece equips it; mix tiers freely.
- **Fall damage**: drops of about 4 tiles or less are free (a jump never hurts). Longer falls cost HP, up to ~38 per fall. Armor and the shield buff do not soften landings, so build down or dig carefully.
- **Blocks**: seamless textures with variants, outlined and lit edges where a block borders air, grass caps, ore veins on stone, and a dark brick background wall so you can tell open space from solid ground.
- **Pickups**: coins, resources, potions, boots/attack/shield power-ups, vault keys and the treasure map (reveals the whole minimap).

## Project layout

```
index.html            page shell
js/assets.js          sprite atlas access
js/sfx.js             shared audio
js/village/*.js       village mode: core (iso, terrain, trees), data, art (building sprites), sim, render, ui
village.html          village mode page
js/world.js           tiles + world generation
js/tiles.js           block textures and edge lighting
js/armor.js           armor tiers, defense, layered sprite drawing
js/entities.js        physics, player, enemies, bosses, projectiles, pickups, audio
js/game.js            loop, input, spawning, day/night, rendering, HUD, crafting
assets/source/        the original reference sheets
assets/sprites/       generated atlases (chars.png, world.png, atlas.js)
tools/                sprite extraction (Python) and headless tests (Node + Playwright)
```

### Rebuilding the sprite atlases

`tools/build_assets.sh` re-slices `assets/source/*.webp` (needs `pip install pillow scipy opencv-python-headless`).
Frame rectangles live in `tools/extract_sprites.py` and `tools/extract_world.py`; the player is cut out with GrabCut so the legs survive in every walk frame. `tools/extract_armor.py` pre-renders the armor colour layers.

### Tests

```
NODE_PATH=$(npm root -g) node tools/smoke_test.js <screenshot-dir>     # load, move, slash, dash
NODE_PATH=$(npm root -g) node tools/scenario_test.js <screenshot-dir>  # night, bosses, mining, crafting, caves
NODE_PATH=$(npm root -g) node tools/feature_test.js <screenshot-dir>   # walk cycle, armor crafting/visuals, fall damage
NODE_PATH=$(npm root -g) node tools/soak_test.js <screenshot-dir>      # 14 simulated minutes, death/victory/vault flows
NODE_PATH=$(npm root -g) node tools/village_test.js <screenshot-dir>   # village: shop, placing, build, collect, upgrade, raid, save/load
NODE_PATH=$(npm root -g) node tools/village_soak.js                    # a bot plays 12 raids including both bosses
```
