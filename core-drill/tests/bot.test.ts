import { describe, expect, it } from 'vitest';
import { resolveRigStats, SURFACE_ROW } from '../src/game/balance';
import { DrillEngine, NO_INPUT } from '../src/game/engine';

/** A dumb bot: dig straight down to `target` metres, then thrust back up. Measures fuel economics. */
function dive(planet: number, target: number, seed: number) {
  const e = new DrillEngine(planet, resolveRigStats({ streakDays: 0 }, []), seed);
  e.x = e.world.padX1 + 3.5; e.y = SURFACE_ROW - 0.4;
  e.hull = 1e9; // ignore enemies; this measures fuel only
  e.enemies.length = 0;
  let t = 0;
  const step = (inp: Partial<typeof NO_INPUT>) => { e.update(1 / 60, { ...NO_INPUT, ...inp }); e.enemies.length = 0; t += 1 / 60; };
  while (e.depth < target && e.fuel > 0 && t < 400) step({ down: true });
  const fuelDown = e.stats.maxFuel - e.fuel;
  const reached = e.depth;
  // climb: thrust up, dig sideways never needed since the shaft is straight
  while (e.depth > 0 && e.fuel > 0 && t < 800) step({ up: true });
  return { fuelDown, reached, fuelLeft: e.fuel, back: e.depth === 0, t, max: e.stats.maxFuel };
}

describe('fuel economy (bot)', () => {
  it('a straight dive to mid-depth and back is possible but not free', () => {
    const rs = [1, 2, 3, 4, 5].map((s) => dive(1, 40, s));
        for (const r of rs) {
      expect(r.reached).toBeGreaterThanOrEqual(38);
      expect(r.back).toBe(true);
      expect(r.fuelLeft / r.max).toBeGreaterThan(0.2); // doable on the base tank...
      expect(r.fuelLeft / r.max).toBeLessThan(0.7); // ...but it is a real cost
    }
  });
  it('a full dive to the boss on the base tank is tight', () => {
    const rs = [1, 2, 3, 4, 5].map((s) => dive(1, 70, s));
        for (const r of rs) {
      expect(r.reached).toBeGreaterThanOrEqual(68);
      expect(r.fuelDown / r.max).toBeLessThan(0.7); // you can reach the boss on the base tank
      expect(r.fuelDown / r.max).toBeGreaterThan(0.3);
    }
  });
});
