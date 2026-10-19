import { describe, expect, it } from 'vitest';
import { applyRunResult, buyUpgrade, launchPlanet } from '../src/game/progress';
import type { DrillProfile, RunResult } from '../src/types';

const base = (): DrillProfile => ({ focusEnergy: 100, techScrap: 500, neuroCores: 1, streakDays: 0 });
const run = (o: Partial<RunResult> = {}): RunResult => ({
  planetId: 1, outcome: 'recalled', scrap: 120, neuroCores: 2, depth: 40, kills: 3, bossBeaten: false, vaultsOpened: 1, ...o,
});

describe('profile reducers', () => {
  it('launch deducts focus energy and never goes negative', () => {
    expect(launchPlanet(base(), 1, 40).focusEnergy).toBe(60);
    expect(launchPlanet(base(), 1, 400).focusEnergy).toBe(0);
  });

  it('banks a run and tracks best depth without ever lowering it', () => {
    const a = applyRunResult(base(), run());
    expect(a.techScrap).toBe(620);
    expect(a.neuroCores).toBe(3);
    expect(a.drill?.bestDepth[1]).toBe(40);
    const b = applyRunResult(a, run({ depth: 10 }));
    expect(b.drill?.bestDepth[1]).toBe(40);
  });

  it('records boss clears once and ignores negative payouts', () => {
    const a = applyRunResult(base(), run({ bossBeaten: true, outcome: 'cleared' }));
    const b = applyRunResult(a, run({ bossBeaten: true, outcome: 'cleared', scrap: -50, neuroCores: -1 }));
    expect(b.drill?.cleared).toEqual([1]);
    expect(b.techScrap).toBe(a.techScrap);
    expect(b.neuroCores).toBe(a.neuroCores);
  });

  it('caps best depth at the planet depth', () => {
    expect(applyRunResult(base(), run({ depth: 9999 })).drill?.bestDepth[1]).toBe(72);
  });

  it('buys an upgrade at the server-side price and refuses when short or maxed', () => {
    const a = buyUpgrade(base(), 'drill', 1);
    expect(a.drill?.upgrades.drill).toBe(1);
    expect(a.techScrap).toBe(440); // price comes from the table, not the claimed cost
    expect(buyUpgrade({ ...base(), techScrap: 10 }, 'hull')).toEqual({ ...base(), techScrap: 10 });
    let p = { ...base(), techScrap: 1e6 };
    for (let i = 0; i < 9; i++) p = buyUpgrade(p, 'fuel');
    expect(p.drill?.upgrades.fuel).toBe(5);
  });
});
