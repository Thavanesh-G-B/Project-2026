import { describe, expect, it } from 'vitest';
import {
  cargoValue, defaultDrillSave, emptyCargo, getPlanet, isPlanetUnlocked, normalizeDrillSave,
  PLANETS, resolveRigStats, UPGRADES, upgradeCost,
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

  it('upgrades scale the stats', () => {
    const save = defaultDrillSave();
    save.upgrades = { drill: 5, fuel: 5, hull: 5, cargo: 5, blaster: 5, shield: 5 };
    const s = resolveRigStats({ streakDays: 0, drill: save }, []);
    expect(s.maxFuel).toBe(250);
    expect(s.maxHull).toBe(225);
    expect(s.cargoCap).toBe(74);
    expect(s.drillSpeed).toBeCloseTo(2);
    expect(s.blasterDamage).toBe(25);
  });
});

describe('saves and costs', () => {
  it('normalizes missing or corrupt saves', () => {
    expect(normalizeDrillSave(undefined)).toEqual(defaultDrillSave());
    const n = normalizeDrillSave({ upgrades: { drill: 99, fuel: -3, hull: 'x' as unknown as number } as never, cleared: [1] });
    expect(n.upgrades.drill).toBe(5);
    expect(n.upgrades.fuel).toBe(0);
    expect(n.upgrades.hull).toBe(0);
    expect(n.cleared).toEqual([1]);
  });

  it('upgrade cost grows per level', () => {
    for (const u of UPGRADES) {
      expect(upgradeCost(u, 1)).toBeGreaterThan(upgradeCost(u, 0));
      expect(upgradeCost(u, 4)).toBeGreaterThan(upgradeCost(u, 3));
    }
  });
});

describe('planets and rewards', () => {
  it('unlocks planets in order', () => {
    expect(isPlanetUnlocked(PLANETS[0], [])).toBe(true);
    expect(isPlanetUnlocked(PLANETS[1], [])).toBe(false);
    expect(isPlanetUnlocked(PLANETS[1], [1])).toBe(true);
    expect(isPlanetUnlocked(PLANETS[2], [1, 2])).toBe(false); // not playable yet
  });

  it('values cargo with planet and augment multipliers', () => {
    const c = { ...emptyCargo(), scrapOre: 10, crystal: 4, core: 1, bonusScrap: 20 };
    const base = cargoValue(c, getPlanet(1), 1);
    expect(base.scrap).toBe(10 * 12 + 4 * 35 + 100 + 20);
    expect(base.cores).toBe(2); // 4 crystals = 1 core, plus the quantum core
    expect(cargoValue(c, getPlanet(2), 1).scrap).toBeGreaterThan(base.scrap);
    expect(cargoValue(c, getPlanet(1), 1.4).scrap).toBeGreaterThan(base.scrap);
  });
});
