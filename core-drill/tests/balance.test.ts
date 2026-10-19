import { describe, expect, it } from 'vitest';
import {
  BAND, bandStartDepth, cargoValue, coreDepth, defaultDrillSave, depthScale, emptyCargo, FIRST_PLATE_DEPTH, getPlanet,
  isPlanetUnlocked, lightRadius, nextPlanet, normalizeDrillSave, PLANETS, resolveRigStats, UPGRADES, upgradeCost,
} from '../src/game/balance';
import type { SubjectCombatAugment } from '../src/types';

const aug = (over: Partial<SubjectCombatAugment>): SubjectCombatAugment => ({
  subject: 'math', name: 'x', effect: '', activeUntil: Date.now() + 60_000,
  critChanceBonus: 0, shieldBonus: 0, turretRateBonus: 0, scrapMultiplierBonus: 0, damageReductionBonus: 0, ...over,
});

describe('rig stats', () => {
  it('has sane baseline stats with no augments', () => {
    const s = resolveRigStats({ streakDays: 0 }, []);
    expect(s.maxFuel).toBe(100);
    expect(s.maxHull).toBe(100);
    expect(s.critChance).toBeCloseTo(0.05);
    expect(s.scanner).toBe(false);
    expect(s.turretLevel).toBe(0);
    expect(s.lightBonus).toBe(0);
  });

  it('streak raises the fuel tank up to a cap', () => {
    expect(resolveRigStats({ streakDays: 4 }, []).maxFuel).toBe(108);
    expect(resolveRigStats({ streakDays: 99 }, []).maxFuel).toBe(120);
  });

  it('applies only active augments', () => {
    const live = aug({ subject: 'math', critChanceBonus: 0.25 });
    const dead = aug({ subject: 'cs', turretRateBonus: 0.3, activeUntil: Date.now() - 1 });
    const s = resolveRigStats({ streakDays: 0 }, [live, dead]);
    expect(s.critChance).toBeCloseTo(0.3);
    expect(s.scanner).toBe(true);
    expect(s.drillSpeed).toBe(1);
  });

  it('maps each subject buff onto a rig stat', () => {
    expect(resolveRigStats({ streakDays: 0 }, [aug({ subject: 'cs', turretRateBonus: 0.3 })]).drillSpeed).toBeCloseTo(1.3);
    expect(resolveRigStats({ streakDays: 0 }, [aug({ subject: 'science', shieldBonus: 40, damageReductionBonus: 0.1 })]).maxShield).toBe(28);
    expect(resolveRigStats({ streakDays: 0 }, [aug({ subject: 'humanities', scrapMultiplierBonus: 0.4 })]).oreValueMult).toBeCloseTo(1.4);
    expect(resolveRigStats({ streakDays: 0 }, [aug({ subject: 'arts', damageReductionBonus: 0.25 })]).moveSpeed).toBeCloseTo(1.15);
  });

  it('caps damage reduction and crit', () => {
    const s = resolveRigStats({ streakDays: 0 }, [aug({ damageReductionBonus: 5, critChanceBonus: 5 })]);
    expect(s.damageReduction).toBe(0.75);
    expect(s.critChance).toBe(0.75);
  });

  it('upgrades scale the stats, including lamp and pad turret', () => {
    const save = defaultDrillSave();
    save.upgrades = { drill: 5, fuel: 5, hull: 5, cargo: 5, blaster: 5, shield: 5, lamp: 5, turret: 3 };
    const s = resolveRigStats({ streakDays: 0, drill: save }, []);
    expect(s.maxFuel).toBe(250);
    expect(s.maxHull).toBe(225);
    expect(s.cargoCap).toBe(74);
    expect(s.drillSpeed).toBeCloseTo(2);
    expect(s.blasterDamage).toBe(25);
    expect(s.lightBonus).toBeCloseTo(4.5);
    expect(s.turretLevel).toBe(3);
  });
});

describe('saves and costs', () => {
  it('normalizes missing or corrupt saves, including saves from before lamp/turret existed', () => {
    expect(normalizeDrillSave(undefined)).toEqual(defaultDrillSave());
    const n = normalizeDrillSave({ upgrades: { drill: 99, fuel: -3, hull: 'x' as unknown as number } as never, cleared: [1] });
    expect(n.upgrades.drill).toBe(5);
    expect(n.upgrades.fuel).toBe(0);
    expect(n.upgrades.hull).toBe(0);
    expect(n.upgrades.lamp).toBe(0);
    expect(n.upgrades.turret).toBe(0);
    expect(n.cleared).toEqual([1]);
  });

  it('upgrade cost grows per level and every key has a shop entry', () => {
    expect(UPGRADES.map((u) => u.key).sort()).toEqual(Object.keys(defaultDrillSave().upgrades).sort());
    for (const u of UPGRADES) {
      expect(upgradeCost(u, 1)).toBeGreaterThan(upgradeCost(u, 0));
      expect(upgradeCost(u, 4)).toBeGreaterThan(upgradeCost(u, 3));
    }
  });
});

describe('planets, depth and visibility', () => {
  it('all five planets are playable and unlock in order', () => {
    expect(PLANETS.every((p) => p.playable)).toBe(true);
    expect(isPlanetUnlocked(PLANETS[0], [])).toBe(true);
    expect(isPlanetUnlocked(PLANETS[1], [])).toBe(false);
    expect(isPlanetUnlocked(PLANETS[1], [1])).toBe(true);
    expect(isPlanetUnlocked(PLANETS[4], [1, 2, 3])).toBe(false);
    expect(isPlanetUnlocked(PLANETS[4], [1, 2, 3, 4])).toBe(true);
    expect(nextPlanet(1)?.id).toBe(2);
    expect(nextPlanet(5)).toBeNull();
  });

  it('core bosses get deeper planet by planet and sit on band boundaries', () => {
    for (let i = 1; i < PLANETS.length; i++) expect(coreDepth(PLANETS[i])).toBeGreaterThan(coreDepth(PLANETS[i - 1]));
    expect(coreDepth(PLANETS[0])).toBe(bandStartDepth(PLANETS[0].coreBand));
    expect(bandStartDepth(1) - bandStartDepth(0)).toBe(BAND);
    expect(bandStartDepth(0)).toBe(FIRST_PLATE_DEPTH);
  });

  it('every planet has a roster, a boss pattern list and a distinct palette', () => {
    for (const p of PLANETS) {
      expect(p.roster.length).toBeGreaterThan(1);
      expect(p.bossPatterns.length).toBeGreaterThan(1);
    }
    expect(new Set(PLANETS.map((p) => p.primary)).size).toBe(5);
  });

  it('your light shrinks as you go down and a lamp upgrade widens it', () => {
    expect(lightRadius(0)).toBeGreaterThan(lightRadius(60));
    expect(lightRadius(60)).toBeGreaterThan(lightRadius(110));
    expect(lightRadius(500)).toBeCloseTo(lightRadius(110));
    expect(lightRadius(80, 2)).toBeCloseTo(lightRadius(80) + 2);
    expect(lightRadius(110)).toBeGreaterThan(3);
  });

  it('enemies scale with depth', () => {
    expect(depthScale(0)).toBe(1);
    expect(depthScale(160)).toBeCloseTo(2);
  });

  it('values cargo with planet and augment multipliers', () => {
    const c = { ...emptyCargo(), scrapOre: 10, crystal: 4, core: 1, bonusScrap: 20 };
    const base = cargoValue(c, getPlanet(1), 1);
    expect(base.scrap).toBe(10 * 12 + 4 * 35 + 100 + 20);
    expect(base.cores).toBe(2);
    expect(cargoValue(c, getPlanet(2), 1).scrap).toBeGreaterThan(base.scrap);
    expect(cargoValue(c, getPlanet(1), 1.4).scrap).toBeGreaterThan(base.scrap);
  });
});
