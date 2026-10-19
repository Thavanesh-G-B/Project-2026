/**
 * Types shared by the Core Drill module. The study-side shapes (SubjectCategory,
 * Flashcard, SubjectCombatAugment) are structurally identical to the ones in
 * StudyOps' src/types/index.ts, so the real app's values can be passed straight in.
 */

export type SubjectCategory = 'math' | 'science' | 'cs' | 'humanities' | 'languages' | 'arts';

export interface Flashcard {
  id: string;
  subject: SubjectCategory;
  deck: string;
  question: string;
  answer: string;
  hint?: string;
  mastered: boolean;
}

export interface SubjectCombatAugment {
  subject: SubjectCategory;
  name: string;
  effect: string;
  activeUntil: number;
  critChanceBonus: number;
  shieldBonus: number;
  turretRateBonus: number;
  scrapMultiplierBonus: number;
  damageReductionBonus: number;
}

/** The slice of the StudyOps PlayerProfile that Core Drill reads. */
export interface DrillProfile {
  focusEnergy: number;
  techScrap: number;
  neuroCores: number;
  streakDays: number;
  /** Persistent Core Drill progress; undefined on old saves (defaults apply). */
  drill?: DrillSave;
}

export type DrillUpgradeKey = 'drill' | 'fuel' | 'hull' | 'cargo' | 'blaster' | 'shield' | 'lamp' | 'turret';

export interface DrillSave {
  upgrades: Record<DrillUpgradeKey, number>;
  /** planet id -> deepest metres reached */
  bestDepth: Record<number, number>;
  /** planet ids whose boss was beaten */
  cleared: number[];
  /** planet id -> best orbital-patrol wave cleared */
  bestWave?: Record<number, number>;
}

export interface RunResult {
  /** Planet the run started on. */
  planetId: number;
  outcome: 'recalled' | 'destroyed';
  scrap: number;
  neuroCores: number;
  /** Deepest metres reached, across every planet visited in the run. */
  depth: number;
  kills: number;
  /** True if any planet's core boss went down this run. */
  bossBeaten: boolean;
  /** Bosses killed this run, including guardians. */
  bossesDown: number;
  vaultsOpened: number;
  /** Planets whose core boss was beaten this run. */
  clears: number[];
  /** Deepest metres per planet visited this run. */
  depths: Record<number, number>;
}

/** Everything the engine needs to start a run, resolved from profile + augments. */
export interface RigStats {
  maxFuel: number;
  maxHull: number;
  maxShield: number;
  cargoCap: number;
  drillSpeed: number; // multiplier on dig speed
  moveSpeed: number;  // multiplier
  blasterDamage: number;
  blasterRate: number; // shots/sec
  maxEnergy: number;
  critChance: number;
  damageReduction: number; // 0..0.75
  oreValueMult: number;
  bombs: number;
  scanner: boolean;
  lightBonus: number; // extra headlamp radius in tiles
  turretLevel: number; // 0 = no pad turret
  /** Upgrade levels (0-5) that change how the rig looks. */
  look: { drill: number; hull: number; blaster: number; cargo: number; lamp: number; shield: number };
  augmentNames: string[];
}
