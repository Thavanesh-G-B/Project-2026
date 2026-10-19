import { describe, expect, it } from 'vitest';
import { applyRunResult, applySortieResult, buyUpgrade, launchPlanet, markPlanetCleared } from '../src/game/progress';
import { sortieCost, getPlanet } from '../src/game/balance';
import type { DrillProfile, RunResult } from '../src/types';

const base = (): DrillProfile => ({ focusEnergy: 100, techScrap: 500, neuroCores: 1, streakDays: 0 });
const run = (o: Partial<RunResult> = {}): RunResult => ({
  planetId: 1, outcome: 'recalled', scrap: 120, neuroCores: 2, depth: 40, kills: 3, bossBeaten: false, bossesDown: 0,
  vaultsOpened: 1, clears: [], depths: { 1: 40 }, ...o,
});

describe('profile reducers', () => {
  it('launch deducts focus energy and never goes negative', () => {
    expect(launchPlanet(base(), 1, 40).focusEnergy).toBe(60);
    expect(launchPlanet(base(), 1, 400).focusEnergy).toBe(0);
  });

  it('banks a run and tracks best depth per planet without ever lowering it', () => {
    const a = applyRunResult(base(), run({ depths: { 1: 40, 2: 15 } }));
    expect(a.techScrap).toBe(620);
    expect(a.neuroCores).toBe(3);
    expect(a.drill?.bestDepth).toEqual({ 1: 40, 2: 15 });
    const b = applyRunResult(a, run({ depths: { 1: 10, 2: 90 } }));
    expect(b.drill?.bestDepth).toEqual({ 1: 40, 2: 90 });
  });

  it('depth is not capped any more: the mine is endless', () => {
    expect(applyRunResult(base(), run({ depths: { 1: 1234 } })).drill?.bestDepth[1]).toBe(1234);
  });

  it('records every cleared planet once and ignores negative payouts', () => {
    const a = applyRunResult(base(), run({ clears: [1, 2], bossBeaten: true }));
    const b = applyRunResult(a, run({ clears: [2, 3], scrap: -50, neuroCores: -1 }));
    expect(b.drill?.cleared).toEqual([1, 2, 3]);
    expect(b.techScrap).toBe(a.techScrap);
    expect(b.neuroCores).toBe(a.neuroCores);
  });

  it('falls back to the plain depth for results without a per-planet map', () => {
    const r = { ...run(), depths: {} };
    expect(applyRunResult(base(), r).drill?.bestDepth[1]).toBe(40);
  });

  it('markPlanetCleared saves an unlock immediately and is idempotent', () => {
    const a = markPlanetCleared(base(), 1);
    expect(a.drill?.cleared).toEqual([1]);
    expect(markPlanetCleared(a, 1)).toBe(a);
  });

  it('buys an upgrade at the table price and refuses when short or maxed', () => {
    const a = buyUpgrade(base(), 'drill', 1);
    expect(a.drill?.upgrades.drill).toBe(1);
    expect(a.techScrap).toBe(440);
    expect(buyUpgrade({ ...base(), techScrap: 10 }, 'hull')).toEqual({ ...base(), techScrap: 10 });
    let p = { ...base(), techScrap: 1e6 };
    for (let i = 0; i < 9; i++) p = buyUpgrade(p, 'fuel');
    expect(p.drill?.upgrades.fuel).toBe(5);
    expect(buyUpgrade({ ...base(), techScrap: 1e6 }, 'turret').drill?.upgrades.turret).toBe(1);
    expect(buyUpgrade({ ...base(), techScrap: 1e6 }, 'lamp').drill?.upgrades.lamp).toBe(1);
  });

  it('banks an orbital patrol and keeps the best wave per planet', () => {
    const r = { planetId: 2, outcome: 'retreat' as const, scrap: 200, neuroCores: 1, wave: 6, kills: 20, bossesDown: 1, crewRescued: 3, asteroids: 9 };
    const a = applySortieResult(base(), r);
    expect(a.techScrap).toBe(700);
    expect(a.neuroCores).toBe(2);
    expect(a.drill?.bestWave?.[2]).toBe(6);
    expect(applySortieResult(a, { ...r, wave: 3, scrap: -5, neuroCores: -1 }).drill?.bestWave?.[2]).toBe(6);
    expect(applySortieResult(a, { ...r, scrap: -5, neuroCores: -1 }).techScrap).toBe(a.techScrap);
  });

  it('a patrol costs less than a dig', () => {
    for (const id of [1, 2, 3, 4, 5]) expect(sortieCost(getPlanet(id))).toBeLessThan(getPlanet(id).launchCost);
  });
});
