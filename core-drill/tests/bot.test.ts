import { describe, expect, it } from 'vitest';
import { coreDepth, getPlanet, resolveRigStats, SURFACE_ROW } from '../src/game/balance';
import { DrillEngine, NO_INPUT } from '../src/game/engine';

/** A blind bot that digs straight down, ignoring enemies, with relays disabled to measure raw fuel cost. */
function dive(planetId: number, seed: number) {
  const e = new DrillEngine(planetId, resolveRigStats({ streakDays: 0 }, []), seed);
  e.x = e.world.padX1 + 3.5; e.y = SURFACE_ROW - 0.4;
  e.hull = 1e9;
  for (const r of e.world.relays) r.used = true;
  const target = coreDepth(getPlanet(planetId));
  let t = 0;
  while (e.depth < target && e.fuel > 0 && t < 400) {
    for (const r of e.world.relays) r.used = true;
    e.update(1 / 60, { ...NO_INPUT, down: true });
    e.enemies.length = 0;
    t += 1 / 60;
  }
  return { reached: e.depth, target, left: e.fuel / e.stats.maxFuel, t };
}

describe('fuel economy (bot)', () => {
  it('a blind straight dive reaches the core boss, if at all, with little fuel to spare', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = dive(1, seed);
      // plates make a straight line expensive: you must find ladder shafts, bomb through, or refuel at relays
      expect(r.reached < r.target || r.left < 0.4).toBe(true);
    }
  });

  it('but the first few levels are comfortable', () => {
    const r = dive(1, 2);
    expect(r.reached).toBeGreaterThan(20);
  });
});
