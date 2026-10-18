'use strict';
// Village mode, part 2: building and enemy data. Level arrays are indexed by level - 1 (levels 1-3).
const BDEF = {
  townhall: { cat: 'core', name: 'Town Hall', w: 3, d: 3, kind: 'core', desc: 'The heart of your village. If it falls, the village falls. Upgrading unlocks more buildings and levels.',
    hp: [1500, 2400, 3600], cap: [500, 800, 1200], cost: [null, { gold: 400, wood: 300 }, { gold: 900, wood: 700 }], time: [0, 25, 45], max: [1, 1, 1] },
  goldmine: { cat: 'Economy', name: 'Gold Mine', w: 2, d: 2, kind: 'collector', res: 'gold', desc: 'Digs gold over time. Tap it to collect before it fills up.',
    hp: [350, 520, 760], rate: [0.9, 1.5, 2.3], store: [260, 480, 800],
    cost: [{ wood: 80, gold: 40 }, { gold: 150, wood: 100 }, { gold: 420, wood: 260 }], time: [8, 20, 40], max: [2, 3, 4] },
  lumbercamp: { cat: 'Economy', name: 'Lumber Camp', w: 2, d: 2, kind: 'collector', res: 'wood', desc: 'Lumberjacks haul wood in. Tap it to collect.',
    hp: [300, 440, 640], rate: [0.7, 1.2, 1.8], store: [200, 360, 600],
    cost: [{ gold: 70 }, { gold: 140, wood: 60 }, { gold: 380, wood: 140 }], time: [6, 16, 34], max: [2, 3, 4] },
  storage: { cat: 'Economy', name: 'Storage Barn', w: 2, d: 2, kind: 'storage', desc: 'Raises how much gold and wood your village can hold.',
    hp: [500, 800, 1200], cap: [400, 800, 1400], cost: [{ gold: 120, wood: 120 }, { gold: 300, wood: 220 }, { gold: 700, wood: 480 }], time: [8, 20, 38], max: [1, 2, 3] },
  archer: { cat: 'Defense', name: 'Archer Tower', w: 2, d: 2, kind: 'defense', air: true, ground: true, desc: 'Fast arrows. Hits ground and flying enemies.',
    hp: [320, 480, 700], dmg: [9, 14, 22], range: 6.5, cd: 0.85, cost: [{ gold: 150, wood: 60 }, { gold: 300, wood: 100 }, { gold: 720, wood: 220 }], time: [10, 24, 44], max: [2, 4, 6] },
  cannon: { cat: 'Defense', name: 'Cannon', w: 2, d: 2, kind: 'defense', ground: true, desc: 'Heavy splash damage. Cannot hit flying enemies.',
    hp: [420, 640, 900], dmg: [30, 48, 74], range: 5.5, cd: 1.7, splash: 1.1, cost: [{ gold: 240, wood: 90 }, { gold: 480, wood: 160 }, { gold: 980, wood: 340 }], time: [14, 28, 50], max: [1, 3, 5] },
  trap: { cat: 'Defense', name: 'Spike Trap', w: 1, d: 1, kind: 'trap', desc: 'Hidden spikes. Bursts when ground enemies step on it, then re-arms after the raid.',
    hp: [100, 100, 100], dmg: [90, 160, 260], cost: [{ gold: 60 }, { gold: 160 }, { gold: 380 }], time: [3, 8, 14], max: [2, 4, 6] },
  wall: { cat: 'Defense', name: 'Wall', w: 1, d: 1, kind: 'wall', desc: 'Blocks ground enemies, who must break through or walk around. Drag to build a line.',
    hp: [350, 600, 950], cost: [{ wood: 14 }, { wood: 40, gold: 30 }, { wood: 90, gold: 90 }], time: [1, 3, 5], max: [25, 50, 80] },
  barracks: { cat: 'Utility', name: 'Barracks', w: 2, d: 2, kind: 'barracks', desc: 'Trains guards who defend the village. They re-train after falling.',
    hp: [450, 700, 1000], guards: [2, 3, 4], ghp: [110, 160, 220], gdmg: [8, 12, 18], cost: [{ gold: 200, wood: 120 }, { gold: 450, wood: 200 }, { gold: 900, wood: 400 }], time: [12, 26, 46], max: [1, 2, 3] },
  mortar: { cat: 'Defense', name: 'Mortar', w: 2, d: 2, kind: 'defense', ground: true, desc: 'Long-range siege tube. Huge splash, slow, and blind up close.',
    hp: [380, 560, 800], dmg: [46, 78, 120], range: 8.6, minRange: 2.2, cd: 3.3, splash: 1.5, cost: [{ gold: 360, wood: 140 }, { gold: 720, wood: 260 }, { gold: 1500, wood: 520 }], time: [18, 34, 60], max: [0, 1, 2] },
  magetower: { cat: 'Defense', name: 'Mage Tower', w: 2, d: 2, kind: 'defense', air: true, ground: true, desc: 'Crystal-powered bolts that burst on impact. Hits air and ground.',
    hp: [300, 450, 650], dmg: [15, 24, 36], range: 6, cd: 1.15, splash: 0.9, cost: [{ gold: 300, wood: 100 }, { gold: 620, wood: 200 }, { gold: 1200, wood: 420 }], time: [16, 30, 52], max: [0, 1, 2] },
  shrine: { cat: 'Utility', name: 'Healing Shrine', w: 2, d: 2, kind: 'shrine', desc: 'Heals your hero and guards, and mends nearby buildings during raids.',
    hp: [350, 520, 760], heal: [6, 10, 16], mend: [2, 4, 7], radius: 6.2, cost: [{ gold: 220, wood: 140 }, { gold: 500, wood: 260 }, { gold: 1000, wood: 500 }], time: [12, 26, 46], max: [0, 1, 2] },
  builderhut: { cat: 'Utility', name: "Builder's Hut", w: 2, d: 2, kind: 'hut', maxLevel: 1, desc: 'Each hut gives you one more builder, so more things can be built at once.',
    hp: [300, 300, 300], cost: [{ gold: 80, wood: 120 }], time: [6], max: [1, 2, 3] },
  lantern: { cat: 'Decor', name: 'Lantern Post', w: 1, d: 1, kind: 'decor', maxLevel: 1, desc: 'A warm light for the paths.', hp: [80, 80, 80], cost: [{ wood: 8 }], time: [1], max: [6, 10, 16] },
  garden: { cat: 'Decor', name: 'Flower Garden', w: 2, d: 2, kind: 'decor', maxLevel: 1, desc: 'Blossoming beds to brighten the village.', hp: [120, 120, 120], cost: [{ gold: 25, wood: 18 }], time: [2], max: [2, 4, 6] },
  fountain: { cat: 'Decor', name: 'Fountain', w: 2, d: 2, kind: 'decor', maxLevel: 1, desc: 'A stone fountain for the village green.', hp: [200, 200, 200], cost: [{ gold: 140, wood: 50 }], time: [3], max: [1, 1, 2] },
};
const SHOP_CATS = ['Economy', 'Defense', 'Utility', 'Decor'];
const SHOP_ORDER = ['goldmine', 'lumbercamp', 'storage', 'archer', 'cannon', 'mortar', 'magetower', 'wall', 'trap', 'barracks', 'shrine', 'builderhut', 'lantern', 'garden', 'fountain'];
// map expansion: level 2..4 pushes the clouds back. Needs the given Town Hall level.
const EXPAND = [null, { gold: 250, wood: 150, th: 1 }, { gold: 700, wood: 450, th: 2 }, { gold: 1500, wood: 1000, th: 3 }];

// Enemy templates. speed in tiles/s; scale = sprite scale on the isometric map.
const EDATA = {
  zombie: { name: 'Zombie', hp: 46, speed: 0.95, dmg: 14, cd: 1.0, range: 0.9, scale: 0.8, target: 'any', gold: 2, xp: 2,
    g: { idle: 'zombie_idle', walk: 'zombie_walk', atk: 'zombie_atk', die: 'zombie_die' } },
  skeleton: { name: 'Skeleton', hp: 42, speed: 1.5, dmg: 11, cd: 0.8, range: 0.9, scale: 0.88, target: 'defense', gold: 3, xp: 3,
    g: { idle: 'skel_idle', walk: 'skel_walk', atk: 'skel_atk', die: 'skel_die' } },
  brute: { name: 'Brute', hp: 190, speed: 0.78, dmg: 30, cd: 1.3, range: 1.0, scale: 1.0, target: 'any', gold: 6, xp: 6,
    g: { idle: 'brute_idle', walk: 'brute_walk', atk: 'brute_atk', die: 'brute_die' } },
  bonelord: { name: 'Bone Lord', hp: 120, speed: 1.25, dmg: 20, cd: 0.9, range: 0.95, scale: 0.98, target: 'defense', gold: 7, xp: 7,
    g: { idle: 'bonelord_idle', walk: 'bonelord_walk', atk: 'bonelord_atk', die: 'bonelord_die' } },
  necro: { name: 'Necromancer', hp: 54, speed: 0.85, dmg: 18, cd: 2.2, range: 5.2, scale: 0.9, target: 'any', gold: 7, xp: 6, ranged: true,
    g: { idle: 'necro_idle', walk: 'necro_walk', cast: 'necro_cast', summon: 'necro_summon' } },
  spawn: { name: 'Necro-Spawn', hp: 16, speed: 2.1, dmg: 7, cd: 0.6, range: 0.8, scale: 0.9, target: 'any', gold: 1, xp: 1,
    g: { walk: 'spawn_walk', idle: 'spawn_walk' } },
  knight: { name: 'Cursed Knight', hp: 900, speed: 0.8, dmg: 70, cd: 1.5, range: 1.3, scale: 1.6, target: 'defense', boss: true, gold: 120, xp: 40,
    g: { idle: 'knight_idle', walk: 'knight_walk', swing: 'knight_swing', die: 'knight_die' } },
  king: { name: 'Necromancer King', hp: 1200, speed: 1.0, dmg: 42, cd: 1.8, range: 6.0, scale: 1.6, target: 'townhall', boss: true, flying: true, ranged: true, gold: 250, xp: 80,
    g: { idle: 'king_idle', walk: 'king_move', beam: 'king_beam', summon: 'king_summon', hurt: 'king_hurt', die: 'king_die' } },
};

const HERO_DEF = { name: 'Aldric', hp: 220, dmg: 18, speed: 2.6, range: 1.35, cd: 0.55, strikeCd: 8, strikeDmg: 3.2, strikeRadius: 2.6, mana: 100, manaRegen: 3.5, strikeMana: 30, healMana: 45, healPct: 0.35, healCd: 20, armorRed: [0, 0.12, 0.22, 0.32], armorName: ['Cloth tunic', 'Iron armor', 'Gold armor', 'Crystal armor'], titles: ['Wanderer', 'Squire', 'Knight', 'Champion'] };

const hallLevel = () => (V.buildings.find(b => b.type === 'townhall') || { level: 1 }).level;
const maxCount = type => BDEF[type].max[hallLevel() - 1];
