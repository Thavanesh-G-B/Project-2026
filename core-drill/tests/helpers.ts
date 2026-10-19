import { resolveRigStats, SURFACE_ROW, T } from '../src/game/balance';
import { DrillEngine, Input, NO_INPUT } from '../src/game/engine';
import { idx } from '../src/game/terrain';

export const stats = () => resolveRigStats({ streakDays: 0 }, []);
export const mk = (planet = 1, seed = 7, st = stats()) => new DrillEngine(planet, st, seed);

export function run(e: DrillEngine, secs: number, input: Partial<Input> = {}) {
  for (let t = 0; t < secs; t += 1 / 60) e.update(1 / 60, { ...NO_INPUT, ...input });
}

/** Open a rectangle of air (inclusive-exclusive) so tests control the room they stand in. */
export function carve(e: DrillEngine, x0: number, y0: number, x1: number, y1: number, tile: number = T.AIR) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) e.world.tiles[idx(e.world, x, y)] = tile;
}

/** Put the rig on the surface just beside the pad. */
export function besidePad(e: DrillEngine) {
  e.x = e.world.padX1 + 3.5;
  e.y = SURFACE_ROW - 0.4;
  e.vx = 0; e.vy = 0;
}

/** Stand the rig in an empty box deep in the mine, away from natural spawners. */
export function enclosure(e: DrillEngine, cx = 30, cy = 40, hw = 8, hh = 3) {
  carve(e, cx - hw, cy - hh, cx + hw, cy + hh + 1);
  carve(e, cx - hw - 1, cy + hh + 1, cx + hw + 1, cy + hh + 2, T.ROCK);
  e.x = cx; e.y = cy + hh - 0.4; e.vx = 0; e.vy = 0;
  for (const s of e.world.spawners) s.done = true; // keep natural guards out of the experiment
  e.enemies.length = 0;
  run(e, 0.2);
  e.enemies.length = 0;
}
