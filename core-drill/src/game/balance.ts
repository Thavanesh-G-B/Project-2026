/**
 * Static data and pure formulas for Core Drill: planets, tiles, enemies, rig
 * upgrades and how study-side state (profile, augments, streak) maps to rig stats.
 */
import type { DrillProfile, DrillSave, DrillUpgradeKey, RigStats, SubjectCombatAugment } from '../types';

export const TILE = 32;
export const WORLD_W = 60;
export const SURFACE_ROW = 9; // rows 0..8 are sky, row 9 is the first ground row
/** The mine is built from bands of this many rows; each band has a plated floor, a drift and crust. */
export const BAND = 16;
/** Depth (m) of the first plated floor; everything above it is plain topsoil. */
export const FIRST_PLATE_DEPTH = 12;
/** After the planet's core boss, a guardian boss appears every this many bands. */
export const BOSS_EVERY_BANDS = 4;

export enum T {
  AIR = 0,
  DIRT = 1,
  ROCK = 2,
  SCRAP = 3,
  CRYSTAL = 4,
  CORE = 5,
  HAZARD = 6,
  BEDROCK = 7,
  NEST = 8,
  VAULT = 9,
  PLATE = 10,
  CRATE = 11,
  MIMIC = 12,
  CHEST = 13,
}

/** Decoration drawn on open tiles (never blocks movement). */
export enum D {
  NONE = 0,
  POST = 1,
  BEAM = 2,
  RAIL = 3,
  LAMP = 4,
  LAMP_DEAD = 5,
  CART = 6,
  LADDER = 7,
  SIGN = 8,
  PIPE = 9,
  WEB = 10,
  BONES = 11,
  RELAY = 12,
  MERCHANT = 13,
  BARREL = 14,
}

/** Back wall behind open tiles. */
export enum B {
  NONE = 0,
  CAVE = 1,
  WOOD = 2,
  STONE = 3,
  METAL = 4,
}

/** Seconds to dig a tile at drill speed 1.0. Infinity = cannot be dug. */
export const DIG_TIME: Record<number, number> = {
  [T.DIRT]: 0.28,
  [T.ROCK]: 0.62,
  [T.SCRAP]: 0.34,
  [T.CRYSTAL]: 0.5,
  [T.CORE]: 0.8,
  [T.HAZARD]: 0.3,
  [T.NEST]: 0.9,
  [T.VAULT]: 1.0,
  [T.PLATE]: 8.0,
  [T.CRATE]: 0.25,
  [T.MIMIC]: 0.25,
  [T.CHEST]: 0.6,
  [T.BEDROCK]: Infinity,
};

export const isSolid = (t: number) => t !== T.AIR;
export const isOre = (t: number) => t === T.SCRAP || t === T.CRYSTAL || t === T.CORE;
/** Tiles that bombs and burrowing worms can chew through. */
export const isBreakable = (t: number) =>
  t !== T.AIR && t !== T.BEDROCK && t !== T.VAULT && t !== T.CHEST;

export interface OreValue { scrap: number; cores: number }
export const ORE_VALUE: Record<number, OreValue> = {
  [T.SCRAP]: { scrap: 12, cores: 0 },
  [T.CRYSTAL]: { scrap: 35, cores: 0.25 },
  [T.CORE]: { scrap: 100, cores: 1 },
};

// ---------------------------------------------------------------- enemies

export type EnemyKind = 'mite' | 'bat' | 'sentry' | 'worm' | 'brute' | 'raider' | 'phantom' | 'drone' | 'boss';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  radius: number;
  contactDps: number;
  scrapDrop: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  mite: { kind: 'mite', name: 'Rust Mite', hp: 24, speed: 1.9, radius: 0.32, contactDps: 10, scrapDrop: 6 },
  bat: { kind: 'bat', name: 'Scrap Bat', hp: 16, speed: 3.4, radius: 0.3, contactDps: 8, scrapDrop: 7 },
  sentry: { kind: 'sentry', name: 'Ruined Sentry', hp: 55, speed: 0, radius: 0.45, contactDps: 0, scrapDrop: 12 },
  worm: { kind: 'worm', name: 'Drill Worm', hp: 90, speed: 1.5, radius: 0.42, contactDps: 14, scrapDrop: 18 },
  brute: { kind: 'brute', name: 'Pit Brute', hp: 150, speed: 1.3, radius: 0.55, contactDps: 20, scrapDrop: 40 },
  raider: { kind: 'raider', name: 'Raider Drone', hp: 30, speed: 3.2, radius: 0.4, contactDps: 8, scrapDrop: 14 },
  phantom: { kind: 'phantom', name: 'Phantom', hp: 34, speed: 1.8, radius: 0.38, contactDps: 9, scrapDrop: 16 },
  drone: { kind: 'drone', name: 'Void Drone', hp: 26, speed: 3.8, radius: 0.34, contactDps: 7, scrapDrop: 12 },
  boss: { kind: 'boss', name: 'Boss', hp: 1, speed: 2.4, radius: 1.3, contactDps: 24, scrapDrop: 0 },
};

export interface RosterEntry { kind: EnemyKind; minDepth: number; weight: number }

export type BossPattern = 'ring' | 'aimed' | 'dash' | 'summon' | 'sweep' | 'shards' | 'mines' | 'blink' | 'spiral';
export type HazardFx = 'static' | 'magma' | 'spore' | 'vent' | 'rift';

export interface PlanetDef {
  id: number;
  code: string;
  name: string;
  subtitle: string;
  blurb: string;
  playable: boolean;
  requires: number; // planet id that must be cleared first (0 = none)
  launchCost: number; // Focus Energy
  /** Band index (0-based) holding the planet's core boss; guardians follow every BOSS_EVERY_BANDS. */
  coreBand: number;
  hazardName: string;
  hazardFx: HazardFx;
  bossName: string;
  bossHp: number;
  bossPatterns: BossPattern[];
  roster: RosterEntry[];
  scrapMult: number;
  enemyHpMult: number;
  primary: string;
  accent: string;
  skyTop: string;
  skyBottom: string;
  dirt: [string, string];
  rock: [string, string];
  enemyColor: string;
  hazardColor: string;
}

export const bandStartDepth = (band: number) => FIRST_PLATE_DEPTH + band * BAND;
export const coreDepth = (p: PlanetDef) => bandStartDepth(p.coreBand);

export const PLANETS: PlanetDef[] = [
  {
    id: 1, code: 'PLT-01', name: 'Mainframe-IV', subtitle: 'Abandoned server-vault mines',
    blurb: 'A played-out data quarry. Rusted rigs, dead lamps, and crawlers nesting in the old timber drifts.',
    playable: true, requires: 0, launchCost: 40, coreBand: 3,
    hazardName: 'Static Pocket', hazardFx: 'static',
    bossName: 'Trojan Prime Titan', bossHp: 640, bossPatterns: ['ring', 'dash', 'summon'],
    roster: [
      { kind: 'mite', minDepth: 4, weight: 6 }, { kind: 'bat', minDepth: 16, weight: 3 },
      { kind: 'worm', minDepth: 30, weight: 2 }, { kind: 'brute', minDepth: 52, weight: 1 },
    ],
    scrapMult: 1.0, enemyHpMult: 1.0,
    primary: '#06b6d4', accent: '#3b82f6', skyTop: '#030712', skyBottom: '#0b2545',
    dirt: ['#2a3340', '#1d2430'], rock: ['#3a4658', '#283243'], enemyColor: '#22d3ee', hazardColor: '#7dd3fc',
  },
  {
    id: 2, code: 'PLT-02', name: 'Foundry-VII', subtitle: 'Collapsed smelter shafts',
    blurb: 'Slag rivers cut through ruined foundry levels. Overclocked glitches, richer ore, a core that runs hot.',
    playable: true, requires: 1, launchCost: 60, coreBand: 4,
    hazardName: 'Magma Pocket', hazardFx: 'magma',
    bossName: 'Thermal Meltdown Core', bossHp: 900, bossPatterns: ['ring', 'aimed', 'spiral', 'dash'],
    roster: [
      { kind: 'mite', minDepth: 4, weight: 5 }, { kind: 'bat', minDepth: 10, weight: 4 },
      { kind: 'worm', minDepth: 24, weight: 3 }, { kind: 'brute', minDepth: 42, weight: 2 },
    ],
    scrapMult: 1.3, enemyHpMult: 1.25,
    primary: '#f59e0b', accent: '#ef4444', skyTop: '#120804', skyBottom: '#3a1608',
    dirt: ['#4a3322', '#35231a'], rock: ['#5e4430', '#443123'], enemyColor: '#fb923c', hazardColor: '#f97316',
  },
  {
    id: 3, code: 'PLT-03', name: 'Neural-IX', subtitle: 'Spore-choked synapse mines',
    blurb: 'Glowing fungal veins and phantoms that drift through the rock. Hold your light close.',
    playable: true, requires: 2, launchCost: 80, coreBand: 5,
    hazardName: 'Spore Pocket', hazardFx: 'spore',
    bossName: 'Synapse Devourer AI', bossHp: 1200, bossPatterns: ['sweep', 'summon', 'aimed', 'ring'],
    roster: [
      { kind: 'phantom', minDepth: 4, weight: 5 }, { kind: 'mite', minDepth: 6, weight: 4 },
      { kind: 'worm', minDepth: 28, weight: 2 }, { kind: 'brute', minDepth: 46, weight: 2 },
    ],
    scrapMult: 1.4, enemyHpMult: 1.4,
    primary: '#a855f7', accent: '#ec4899', skyTop: '#0a0512', skyBottom: '#2a0f45',
    dirt: ['#35283f', '#261c30'], rock: ['#4a3a5c', '#352a44'], enemyColor: '#c084fc', hazardColor: '#e879f9',
  },
  {
    id: 4, code: 'PLT-04', name: 'Cryo-XII', subtitle: 'Frozen coolant tunnels',
    blurb: 'Ice-locked drifts, venting coolant that slows your rig, and frost worms that ambush from the walls.',
    playable: true, requires: 3, launchCost: 100, coreBand: 6,
    hazardName: 'Coolant Vent', hazardFx: 'vent',
    bossName: 'Absolute Zero Kernel', bossHp: 1500, bossPatterns: ['shards', 'aimed', 'ring', 'dash'],
    roster: [
      { kind: 'mite', minDepth: 4, weight: 4 }, { kind: 'bat', minDepth: 12, weight: 3 },
      { kind: 'worm', minDepth: 18, weight: 4 }, { kind: 'brute', minDepth: 40, weight: 2 },
    ],
    scrapMult: 1.6, enemyHpMult: 1.55,
    primary: '#38bdf8', accent: '#e0f2fe', skyTop: '#030b14', skyBottom: '#0c2c4a',
    dirt: ['#2c4258', '#20323f'], rock: ['#3d5c7a', '#2d465d'], enemyColor: '#bae6fd', hazardColor: '#e0f2fe',
  },
  {
    id: 5, code: 'PLT-05', name: 'Void-XV', subtitle: 'Singularity dig site',
    blurb: 'Warped rock, rift pockets that throw you across the level, and corrupted drones laying mines.',
    playable: true, requires: 4, launchCost: 120, coreBand: 7,
    hazardName: 'Rift', hazardFx: 'rift',
    bossName: 'Omega Glitch Entity', bossHp: 2000, bossPatterns: ['ring', 'sweep', 'mines', 'blink', 'aimed'],
    roster: [
      { kind: 'drone', minDepth: 4, weight: 5 }, { kind: 'mite', minDepth: 6, weight: 3 },
      { kind: 'worm', minDepth: 26, weight: 3 }, { kind: 'brute', minDepth: 40, weight: 2 },
    ],
    scrapMult: 2.0, enemyHpMult: 1.7,
    primary: '#f43f5e', accent: '#fb7185', skyTop: '#120409', skyBottom: '#3a0a1c',
    dirt: ['#3f2a35', '#2e1d27'], rock: ['#573a48', '#402a35'], enemyColor: '#fb7185', hazardColor: '#fda4af',
  },
];

export const getPlanet = (id: number): PlanetDef => PLANETS.find((p) => p.id === id) ?? PLANETS[0];
export const nextPlanet = (id: number): PlanetDef | null => PLANETS.find((p) => p.id === id + 1 && p.playable) ?? null;

export function isPlanetUnlocked(planet: PlanetDef, cleared: number[]): boolean {
  return planet.playable && (planet.requires === 0 || cleared.includes(planet.requires));
}

// ---------------------------------------------------------------- upgrades

export interface UpgradeDef {
  key: DrillUpgradeKey;
  name: string;
  perLevel: string;
  baseCost: number;
  max: number;
}

export const UPGRADES: UpgradeDef[] = [
  { key: 'drill', name: 'Diamond Drill Bit', perLevel: '+20% dig speed', baseCost: 60, max: 5 },
  { key: 'fuel', name: 'Fuel Cell Stack', perLevel: '+30 fuel capacity', baseCost: 70, max: 5 },
  { key: 'hull', name: 'Plated Hull', perLevel: '+25 hull', baseCost: 80, max: 5 },
  { key: 'cargo', name: 'Cargo Bay', perLevel: '+10 ore slots', baseCost: 60, max: 5 },
  { key: 'blaster', name: 'Pulse Blaster', perLevel: '+3 damage, faster fire', baseCost: 90, max: 5 },
  { key: 'shield', name: 'Deflector Grid', perLevel: '+10 shield', baseCost: 70, max: 5 },
  { key: 'lamp', name: 'Headlamp Array', perLevel: '+0.9 light radius', baseCost: 65, max: 5 },
  { key: 'turret', name: 'Pad Defence Turret', perLevel: 'builds / upgrades the auto-turret', baseCost: 110, max: 5 },
];

export const upgradeCost = (def: UpgradeDef, level: number): number =>
  Math.round(def.baseCost * Math.pow(1.75, level));

export const defaultDrillSave = (): DrillSave => ({
  upgrades: { drill: 0, fuel: 0, hull: 0, cargo: 0, blaster: 0, shield: 0, lamp: 0, turret: 0 },
  bestDepth: {},
  cleared: [],
});

/** Old saves have no `drill` field (or fewer upgrade keys); fill gaps without trusting stored shapes. */
export function normalizeDrillSave(save?: Partial<DrillSave>): DrillSave {
  const d = defaultDrillSave();
  if (!save) return d;
  for (const k of Object.keys(d.upgrades) as DrillUpgradeKey[]) {
    const v = save.upgrades?.[k];
    d.upgrades[k] = typeof v === 'number' && v >= 0 ? Math.min(5, Math.floor(v)) : 0;
  }
  d.bestDepth = { ...(save.bestDepth ?? {}) };
  d.cleared = Array.isArray(save.cleared) ? [...save.cleared] : [];
  return d;
}

// ---------------------------------------------------------------- rig stats

const activeAugments = (augments: SubjectCombatAugment[], now: number) =>
  augments.filter((a) => a.activeUntil > now);

export function resolveRigStats(
  profile: Pick<DrillProfile, 'streakDays' | 'drill'>,
  augments: SubjectCombatAugment[],
  now: number = Date.now(),
): RigStats {
  const up = normalizeDrillSave(profile.drill).upgrades;
  const active = activeAugments(augments, now);
  const has = (s: string) => active.some((a) => a.subject === s);
  const sum = (f: (a: SubjectCombatAugment) => number) => active.reduce((n, a) => n + f(a), 0);

  const streakFuel = Math.min(Math.max(profile.streakDays, 0), 10) * 2;
  const shieldBase = 20 + up.shield * 10;

  return {
    maxFuel: 100 + up.fuel * 30 + streakFuel,
    maxHull: 100 + up.hull * 25,
    maxShield: Math.round(shieldBase * (1 + sum((a) => a.shieldBonus) / 100)),
    cargoCap: 24 + up.cargo * 10,
    drillSpeed: (1 + up.drill * 0.2) * (1 + sum((a) => a.turretRateBonus)),
    moveSpeed: has('arts') ? 1.15 : 1,
    blasterDamage: 10 + up.blaster * 3,
    blasterRate: (4 + up.blaster * 0.5) * (1 + sum((a) => a.turretRateBonus)),
    maxEnergy: 60,
    critChance: Math.min(0.75, 0.05 + sum((a) => a.critChanceBonus)),
    damageReduction: Math.min(0.75, sum((a) => a.damageReductionBonus)),
    oreValueMult: 1 + sum((a) => a.scrapMultiplierBonus),
    bombs: 2,
    scanner: has('math'),
    lightBonus: up.lamp * 0.9,
    turretLevel: up.turret,
    augmentNames: active.map((a) => a.name),
  };
}

/** How far (tiles) the rig's headlamp reaches at a depth. It closes in as you go down. */
export function lightRadius(depth: number, bonus = 0): number {
  const t = Math.max(0, Math.min(1, depth / 110));
  return 10.5 - 5.7 * t + bonus;
}

/** Enemy health and damage scale gently with depth so an endless dive keeps pushing back. */
export const depthScale = (depth: number) => 1 + Math.max(0, depth) / 160;

// ---------------------------------------------------------------- rewards

export interface Cargo { scrapOre: number; crystal: number; core: number; bonusScrap: number }
export const emptyCargo = (): Cargo => ({ scrapOre: 0, crystal: 0, core: 0, bonusScrap: 0 });
export const cargoCount = (c: Cargo) => c.scrapOre + c.crystal + c.core;

export function cargoValue(c: Cargo, planet: PlanetDef, oreMult: number): { scrap: number; cores: number } {
  const ore =
    c.scrapOre * ORE_VALUE[T.SCRAP].scrap +
    c.crystal * ORE_VALUE[T.CRYSTAL].scrap +
    c.core * ORE_VALUE[T.CORE].scrap;
  const cores =
    c.crystal * ORE_VALUE[T.CRYSTAL].cores + c.core * ORE_VALUE[T.CORE].cores;
  return {
    scrap: Math.round(ore * planet.scrapMult * oreMult + c.bonusScrap),
    cores: Math.floor(cores),
  };
}

/** Fraction of unsold cargo kept: half if the rig is destroyed. */
export const KEEP_ON_DEATH = 0.5;
/** Emergency recall keeps the cargo but charges this fraction of its value. */
export const RECALL_FEE = 0.25;

/** Bonus for a boss kill; guardians (index > 0) pay more. */
export const bossBonus = (planet: PlanetDef, bossIndex: number) => ({
  scrap: Math.round((250 + bossIndex * 150) * planet.scrapMult),
  cores: 2 + bossIndex,
});

// ---------------------------------------------------------------- pickups & merchant

export type PickupKind = 'fuel' | 'repair' | 'bomb' | 'scrap' | 'core' | 'shield';

export interface MerchantOffer { id: string; label: string; detail: string; cost: number }
export const MERCHANT_OFFERS: MerchantOffer[] = [
  { id: 'fuel', label: 'Fuel cell', detail: '+50 fuel', cost: 70 },
  { id: 'repair', label: 'Repair kit', detail: '+50 hull', cost: 60 },
  { id: 'bombs', label: 'Bomb pack', detail: '+2 bombs', cost: 80 },
  { id: 'shield', label: 'Shield cell', detail: 'full shield', cost: 40 },
];
