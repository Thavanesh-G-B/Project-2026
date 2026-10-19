/**
 * Static data and pure formulas for Core Drill: planets, tiles, enemies, rig
 * upgrades and how study-side state (profile, augments, streak) maps to rig stats.
 */
import type { DrillProfile, DrillSave, DrillUpgradeKey, RigStats, SubjectCombatAugment } from '../types';

export const TILE = 32;
export const WORLD_W = 60;
export const SURFACE_ROW = 9; // rows 0..8 are sky, row 9 is the first ground row

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
  [T.BEDROCK]: Infinity,
};

export const isSolid = (t: number) => t !== T.AIR;
export const isOre = (t: number) => t === T.SCRAP || t === T.CRYSTAL || t === T.CORE;

export interface OreValue { scrap: number; cores: number }
export const ORE_VALUE: Record<number, OreValue> = {
  [T.SCRAP]: { scrap: 12, cores: 0 },
  [T.CRYSTAL]: { scrap: 35, cores: 0.25 },
  [T.CORE]: { scrap: 100, cores: 1 },
};

export type EnemyKind = 'crawler' | 'spitter' | 'raider' | 'boss';

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
  crawler: { kind: 'crawler', name: 'Bit-Crawler', hp: 28, speed: 1.7, radius: 0.34, contactDps: 11, scrapDrop: 6 },
  spitter: { kind: 'spitter', name: 'Slag Spitter', hp: 38, speed: 1.2, radius: 0.36, contactDps: 6, scrapDrop: 9 },
  raider: { kind: 'raider', name: 'Raider Drone', hp: 30, speed: 3.2, radius: 0.4, contactDps: 8, scrapDrop: 14 },
  boss: { kind: 'boss', name: 'Boss', hp: 1, speed: 2.4, radius: 1.3, contactDps: 24, scrapDrop: 0 },
};

export interface PlanetDef {
  id: number;
  code: string;
  name: string;
  subtitle: string;
  blurb: string;
  playable: boolean;
  requires: number; // planet id that must be cleared first (0 = none)
  launchCost: number; // Focus Energy
  depthRows: number;
  hazardName: string;
  bossName: string;
  bossHp: number;
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

export const PLANETS: PlanetDef[] = [
  {
    id: 1, code: 'PLT-01', name: 'Mainframe-IV', subtitle: 'Server-vault world',
    blurb: 'Glitch-ridden data crust. Bit-crawlers nest in the circuitry; static pockets discharge when cracked open.',
    playable: true, requires: 0, launchCost: 40, depthRows: 72,
    hazardName: 'Static Pocket', bossName: 'Trojan Prime Titan', bossHp: 640, scrapMult: 1.0, enemyHpMult: 1.0,
    primary: '#06b6d4', accent: '#3b82f6', skyTop: '#030712', skyBottom: '#0b2545',
    dirt: ['#12304a', '#0c2238'], rock: ['#1d3f66', '#142c4a'], enemyColor: '#22d3ee', hazardColor: '#7dd3fc',
  },
  {
    id: 2, code: 'PLT-02', name: 'Foundry-VII', subtitle: 'Molten silicon world',
    blurb: 'Overclocked glitches and slag geysers. Richer ore, tougher swarms, and a core that runs hot.',
    playable: true, requires: 1, launchCost: 60, depthRows: 82,
    hazardName: 'Magma Pocket', bossName: 'Thermal Meltdown Core', bossHp: 900, scrapMult: 1.3, enemyHpMult: 1.25,
    primary: '#f59e0b', accent: '#ef4444', skyTop: '#120804', skyBottom: '#3a1608',
    dirt: ['#4a2a14', '#35200f'], rock: ['#5e3a1c', '#432915'], enemyColor: '#fb923c', hazardColor: '#f97316',
  },
  {
    id: 3, code: 'PLT-03', name: 'Neural-IX', subtitle: 'Spore synapse world',
    blurb: 'Phantom glitches phase through the rock. Coming in the next build.',
    playable: false, requires: 2, launchCost: 80, depthRows: 90,
    hazardName: 'Spore Pocket', bossName: 'Synapse Devourer AI', bossHp: 1200, scrapMult: 1.4, enemyHpMult: 1.4,
    primary: '#a855f7', accent: '#ec4899', skyTop: '#0a0512', skyBottom: '#2a0f45',
    dirt: ['#3b1f5c', '#2a1544'], rock: ['#4d2a75', '#381e57'], enemyColor: '#c084fc', hazardColor: '#e879f9',
  },
  {
    id: 4, code: 'PLT-04', name: 'Cryo-XII', subtitle: 'Frozen coolant world',
    blurb: 'Frost burrowers ambush from the walls. Coming in the next build.',
    playable: false, requires: 3, launchCost: 100, depthRows: 90,
    hazardName: 'Coolant Vent', bossName: 'Absolute Zero Kernel', bossHp: 1500, scrapMult: 1.6, enemyHpMult: 1.55,
    primary: '#38bdf8', accent: '#e0f2fe', skyTop: '#030b14', skyBottom: '#0c2c4a',
    dirt: ['#1c4a6e', '#143850'], rock: ['#2b6a94', '#1f5174'], enemyColor: '#bae6fd', hazardColor: '#e0f2fe',
  },
  {
    id: 5, code: 'PLT-05', name: 'Void-XV', subtitle: 'Quantum singularity',
    blurb: 'Warped gravity and corrupted drones. Coming in the next build.',
    playable: false, requires: 4, launchCost: 120, depthRows: 100,
    hazardName: 'Rift', bossName: 'Omega Glitch Entity', bossHp: 2000, scrapMult: 2.0, enemyHpMult: 1.7,
    primary: '#f43f5e', accent: '#fb7185', skyTop: '#120409', skyBottom: '#3a0a1c',
    dirt: ['#4a1a2c', '#361220'], rock: ['#661f38', '#4a1628'], enemyColor: '#fb7185', hazardColor: '#fda4af',
  },
];

export const getPlanet = (id: number): PlanetDef => PLANETS.find((p) => p.id === id) ?? PLANETS[0];

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
];

export const upgradeCost = (def: UpgradeDef, level: number): number =>
  Math.round(def.baseCost * Math.pow(1.75, level));

export const defaultDrillSave = (): DrillSave => ({
  upgrades: { drill: 0, fuel: 0, hull: 0, cargo: 0, blaster: 0, shield: 0 },
  bestDepth: {},
  cleared: [],
});

/** Old saves have no `drill` field; fill gaps without trusting stored shapes. */
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
    augmentNames: active.map((a) => a.name),
  };
}

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

/** Fraction of cargo kept: full on a recall/win, half if the rig is destroyed. */
export const KEEP_ON_DEATH = 0.5;
/** Emergency recall keeps the cargo but charges this fraction of its value. */
export const RECALL_FEE = 0.25;

export const BOSS_BONUS = (planet: PlanetDef) => ({ scrap: Math.round(250 * planet.scrapMult), cores: 2 });
