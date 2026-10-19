# Ashen Hollow

Two games share this project: a side-scrolling **survival platformer** (`index.html`) and a Clash of Clans-style **village builder and defender** (`village.html`). Each links to the other.

## Village mode (`village.html`)

An isometric island village in the spirit of Clash of Clans. Gather resources, build and upgrade, then defend against escalating undead raids with your hero, towers, walls, traps and trained guards.

- **Clouds and expansion**: the island is 87 x 87 tiles, but you start with a 25 x 25 territory. Everything else (and the void around the island) is hidden by clouds, and you cannot build on or walk into it. *Expand map* (`E`) pays gold and wood, needs a higher Town Hall, and makes the clouds part to reveal the next ring of land in five stages (25 -> 37 -> 51 -> 69 -> 87). Raids start just inside the cloud bank (at most 30 tiles out), so enemies emerge from the clouds. The forest stands in separate groves with open meadow between them rather than wall to wall, and out in the wild lie **treasure chests**: walk your hero up to one for gold, wood and XP (the further out, the richer; they show as gold dots on the world map).
- **Collectors**: Gold Mines and Lumber Camps fill up over time (even while you are away, up to 30 minutes at half rate). Tap the floating coin or log bubble to collect before they are full.
- **Build**: use the **quick-build bar** on the map (one click per building, with costs on hover) or the **Village shop** (`3`), which has Economy / Defense / Utility / Decor tabs. Then click an empty tile. Builders work in parallel on construction and upgrades; walls can be dragged out in a line. Limits and levels depend on the Town Hall level.
  - Economy: Gold Mine, Lumber Camp, Storage Barn
  - Defense: Archer Tower (ground + air), Cannon (splash, ground), Mortar (long range splash, blind up close), Mage Tower (crystal bolts, ground + air), Wall, Spike Trap
  - Utility: Barracks (guards in iron / gold / crystal armor), Healing Shrine (heals units, mends buildings), Builder's Hut (+1 builder each)
  - Decor: Lantern Post, Flower Garden, Fountain
- **Raids**: *Start raid N* sends zombies, skeletons, necromancers and necro-spawn from the four lanes. Skeletons and the Cursed Knight (raid 5, 15, ...) hunt your defenses, the flying Necromancer King (raid 10, 20, ...) goes for the Town Hall. Lose the Town Hall and the village falls; other destroyed buildings become ruins you can rebuild at half price.
- **Hero**: left-click inspects and collects, right-click commands (move, attack an enemy, chop a tree). `Space` is *Hero strike*, a shockwave on an 8 s cooldown. The idle hero hunts enemies on its own during raids. It levels up with kills and respawns at the Town Hall if it falls. The hero, the guards and the villagers are one pixel-art character (cut from `assets/source/hero_sheet.webp`): eight walk directions, a sword swing with a bright arc, a spin strike, a three-swing axe chop (the tree shakes with every blow, then topples and drops wood) and a death fall. Armour tiers (iron, gold, crystal) and four villager outfits are recoloured copies. Heavy hits freeze the frame for a beat. The walk animation is driven by the distance actually walked, so feet never skate, and the front, back and three-quarter views are walked like a paper puppet built from the standing picture (torso bob and sway, arms swinging against the legs, legs cut into slices that swing from the hip, bend at the knee and lift the foot), because the source sheet barely moves them. (Even its side-view walk keeps the feet in the same wide stance in every frame, so those legs are animated in code too, under the sheet's arm swing.) Its "south-east" and "north-west" rows do not really face those ways, so those two diagonals are mirror images of the south-west and north-east ones and the head and body always point where he is walking. Click-walk paths are string-pulled into a few straight legs and the sprite only changes facing once the heading has clearly turned, so a unit never wobbles between directions; `W A S D` move along the same eight directions as the pictures. When chopping, the hero walks to a spot level with the tree and swings towards it. Units are depth-sorted so a hero standing in front of a building is drawn in front of it.
- **Hero panel**: click the hero (or the *Hero* button, `C`) to see his name and title, HP / mana / XP, damage per hit, attack speed and damage per second, reach, strike damage, armor (and how much damage it blocks), kills and more. From there: *Hero strike* (30 mana; he raises the sword, then slams it down for a shockwave), *Second Wind* (45 mana, heals 35 %), *Attack nearest*, *Stop*, *Return to hall*, a stance switch (aggressive / defensive / hold) and a list of raiders with an *Attack* button each, so you can send him after one specific enemy. Left-clicking an enemy on the map shows its stats and an *Attack this enemy* button; right-click still attacks directly. Mana regenerates over time; armor (iron / gold / crystal) reduces damage taken.
- **Raiders**: every enemy is drawn from a 3x rebuilt version of the platformer art (edge-aware upscaling, `tools/extract_enemies.py`), larger on the map, with a soft glow around the necromancers, the Cursed Knight, the Necromancer King and the new **Brute** (raid 4+, a big ruddy zombie) and **Bone Lord** (raid 6+, an armoured steel-blue skeleton), and a lean into the blow when they attack.
- **Buildings**: drawn from the reference art in `assets/source/ref_7/8/9.webp` (cut out by `tools/extract_buildings.py`): thatched, timber and stone town halls, three kinds of archer and mage towers, cannons that turn to face their target and flash when they fire, mines, lumber camp, barn, shrine and builder's hut. Every sprite gets the same dark outline and colour balance so the three sheets read as one set, and each is scaled to fit its footprint so neighbours never overlap sideways. Upgrades change how a building looks, not just its size: the town hall's roof goes brown, slate blue, crimson with flags; barracks banners red, blue, gold; mage crystals cyan, violet, amber; the shrine's blue, green, gold; cannons steel then gold; mines, camps and barns fill up with gold, logs and crates; and they show level stars; clicking a building's picture selects it. Boulders, berry bushes and stumps are scattered across the island.
- **Life**: villagers (2 to 7, growing with your village) hammer on construction sites, haul logs and coins home from the collectors and run for the Town Hall when a raid starts. A cobbled plaza, a well, barrels, crates, hay, torches, a campfire and bushes dress the village; buildings and trees cast sun shadows, birds, butterflies and drifting leaves move about, and the light turns to dusk (with torch glow) while a raid lasts.
- **Bars and sound**: rounded health bars with a pale damage trail, an ornate boss bar, and a HUD with Hall / Hero / XP / raid-progress bars. All sound is synthesised live (no files): sword whooshes and steel rings, flesh hits, axe chops and creaking trees, hammering, bowstring twangs (real Karplus-Strong plucks), cannons, coins, surface-dependent footsteps (grass, dirt, cobbles) and groaning monsters, panned and faded by where they happen on screen, plus a generative score (warm pads, plucked arpeggios and a sparse melody in peace; taiko, bass ostinato and stabs in raids and boss fights) over an ambience of wind, birds, campfire crackle, and crickets and crows at dusk. `Sound` and `Music` buttons toggle them.
- **Look**: per-pixel meadow, forest floor and dirt lanes with ruts and shoulders, tufts, flowers and stones; layered cliffs; five broadleaf species (oak, lime, olive, autumn, birch) and spruce with lit leaf clusters, barked trunks and soft shadows.
- Camera: drag to pan (limited to your territory), wheel to zoom, *Follow hero*, *Village* (recentre), *World map* (jump anywhere). Progress is saved in the browser automatically.

- **Research and training**: build an **Academy** (Town Hall 2) to open *Research* (`T`): nine upgrades of up to five levels each (Prospecting, Forestry, Deep Granary, Masonry, Carpentry, Fletching, Gunnery, Arcana, Drill Yard) for gold and wood, gated by Town Hall level. Every hero level above 1 earns a skill point for *Hero training* (Might, Vigor, Focus, Fleet foot). From hero level 3, **Battle Cry** (`B`) boosts the hero's damage and the nearby guards for 8 s.
- **More buildings**: the **Tesla Coil** (Town Hall 2) chains lightning through several enemies, ground or air; the **Trading Post** (Town Hall 2) swaps wood for gold and back at a lossy rate.
- **Options** (`O`): raid difficulty (Easy to Brutal, scaling raider health, damage, numbers and rewards), game speed 1x to 3x, auto-collect from mines and camps, damage numbers, health bars and swaying trees. Saved on the device.
- **HUD**: the top-right panel shows the hero portrait and level, Hall / Hero / Mana / XP bars (plus a raid-progress bar during raids), clickable ability buttons with cooldown sweeps, damage, armour, kills, unspent skill points and your income per minute.

Keys: `W A S D` / arrows walk the hero, `B` Battle Cry, `T` research, `O` options, `J` attack nearest, `H` Second Wind, `X` stop, `C` select hero, `1` move/inspect, `2` gather tree, `3` shop, `E` expand map, `R` start raid, `Space` strike, `F` follow, `M` map, `P` pause, `Esc` cancel.

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
js/village/*.js       village mode: core (iso, terrain, trees), data, art (building sprites), clouds, hero (character sprites), life (shadows, props, villagers, light, chests), sim, render, ui, ui2 (research, options, market, HUD)
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
python3 tools/check_sprites.py                                          # no pale fringe around any cut-out sprite
NODE_PATH=$(npm root -g) node tools/sfx_meter.js                       # plays every sound voice and prints its output level
NODE_PATH=$(npm root -g) node tools/village_life_test.js <screenshot-dir>  # village: character sprites, hero panel and abilities, chop and fall, villagers, dusk, every sound voice
NODE_PATH=$(npm root -g) node tools/village_v2_test.js <screenshot-dir>   # village: big map, sparse forest, research, hero training, Battle Cry, Tesla, market, options, chests
NODE_PATH=$(npm root -g) node tools/village_soak.js                    # a bot plays 12 raids including both bosses
```


## Core Drill: Planetfall (`core-drill.html`)

An endless mining game with combat, built for the StudyOps study app. **Just open `core-drill.html` in a browser** (double-click, no install, works offline apart from fonts). Reopen the abandoned mines of five worlds: dig down level by level through timber drifts and steel plate floors, fight tunnelling worms, brutes, sentries and bosses, and see only as far as your headlamp reaches. After a planet's core boss you can warp to the next world or stay and dig deeper forever. Progress saves in your browser; "+ Simulate study session" earns Focus Energy like studying would. Source, tests and the StudyOps integration script live in [`core-drill/`](core-drill/README.md).

Controls: `A/D` drive, `W` thrusters, `S` dig down (hold `A/D` against rock to dig sideways), mouse/`Space` fire, `B` bomb, `F` flashcard Override, `E` trade, hold `R` to recall.

**New:** an *orbital patrol* mode (top-down space fight above each planet, built from the Lunar Lander sprite pack) and a pixel UI skin shared with the village. Every pack used is listed in [CREDITS.md](CREDITS.md).
