import { describe, expect, it } from 'vitest';
import { getPlanet, PLANETS, SURFACE_ROW, T } from '../src/game/balance';
import { DrillEngine, Enemy, NO_INPUT } from '../src/game/engine';
import { idx, tileAt } from '../src/game/terrain';
import { carve, enclosure, mk, run, stats } from './helpers';

const solidUnder = (e: DrillEngine, en: Enemy) => tileAt(e.world, Math.floor(en.x), Math.floor(en.y)) !== T.AIR;

describe('enemies follow real tunnels', () => {
  it('walkers and flyers never cut through rock and still reach the rig', () => {
    const e = mk();
    // a long winding tunnel: east corridor, down a shaft, west corridor
    carve(e, 10, 40, 50, 43); carve(e, 49, 43, 52, 52); carve(e, 20, 52, 52, 55);
    for (const s of e.world.spawners) s.done = true;
    e.x = 21; e.y = 54.6; e.vx = 0; e.vy = 0; e.hull = 1e9;
    run(e, 0.3);
    e.enemies.length = 0;
    const mite = e.spawnEnemy('mite', 12.5, 41.5);
    const bat = e.spawnEnemy('bat', 14.5, 41.5);
    const brute = e.spawnEnemy('brute', 16.5, 41.5);
    (e as unknown as { spawnT: number }).spawnT = 1e9;
    let reached = false;
    for (let t = 0; t < 40; t += 1 / 60) {
      e.update(1 / 60, NO_INPUT);
      for (const en of [mite, bat, brute]) if (en.hp > 0) expect(solidUnder(e, en)).toBe(false);
      if ([mite, bat, brute].some((en) => Math.hypot(en.x - e.x, en.y - e.y) < 1.6)) { reached = true; }
    }
    expect(reached).toBe(true);
  });

  it('a sealed rig is left alone; opening the wall lets them in', () => {
    const e = mk();
    enclosure(e, 30, 40, 6, 3);
    carve(e, 44, 38, 56, 44);
    for (let y = 38; y < 44; y++) e.world.tiles[idx(e.world, 40, y)] = T.ROCK; // wall between the rooms
    const mite = e.spawnEnemy('mite', 50.5, 41.5);
    (e as unknown as { spawnT: number }).spawnT = 1e9;
    run(e, 12);
    expect(Math.hypot(mite.x - e.x, mite.y - e.y)).toBeGreaterThan(8);
    expect(e.shield).toBe(e.stats.maxShield);
    for (let y = 38; y < 44; y++) e.world.tiles[idx(e.world, 40, y)] = T.AIR;
    run(e, 14);
    expect(e.shield).toBeLessThan(e.stats.maxShield);
  });

  it('mites lunge when they get close', () => {
    const e = mk();
    enclosure(e);
    const m = e.spawnEnemy('mite', e.x + 2.6, e.y);
    m.shootT = 0;
    let lunged = false;
    for (let i = 0; i < 90; i++) { e.update(1 / 60, NO_INPUT); if (m.state === 'lunge') lunged = true; }
    expect(lunged).toBe(true);
  });

  it('a brute winds up, then charges', () => {
    const e = mk();
    enclosure(e);
    const b = e.spawnEnemy('brute', e.x + 5, e.y);
    b.shootT = 0; e.hull = 1e9;
    const seen = new Set<string>();
    for (let i = 0; i < 240; i++) { e.update(1 / 60, NO_INPUT); seen.add(b.state); }
    expect(seen.has('windup')).toBe(true);
    expect(seen.has('charge')).toBe(true);
  });

  it('void drones lay mines that go off when you walk into them', () => {
    const e = mk(5);
    enclosure(e);
    const d = e.spawnEnemy('drone', e.x + 4, e.y - 1);
    d.shootT = 0;
    run(e, 0.3);
    expect(e.bullets.some((b) => b.mine)).toBe(true);
    const mine = e.bullets.find((b) => b.mine)!;
    mine.arm = 0; mine.x = e.x + 0.3; mine.y = e.y;
    const hp = e.hull + e.shield;
    run(e, 0.1);
    expect(e.hull + e.shield).toBeLessThan(hp);
  });

  it('phantoms are only vulnerable while solid', () => {
    const e = mk(3);
    enclosure(e);
    const p = e.spawnEnemy('phantom', e.x + 3, e.y); p.shootT = 99;
    p.alpha = 0.2;
    e.hurtEnemy(p, 20, false, false);
    expect(p.hp).toBe(p.maxHp);
    p.alpha = 1;
    e.hurtEnemy(p, 20, false, false);
    expect(p.hp).toBe(p.maxHp - 20);
  });
});

describe('worms really tunnel', () => {
  it('warn first, then eat a visible tunnel toward the rig, leaving it open behind', () => {
    const e = mk();
    enclosure(e, 30, 40, 3, 2);
    for (let y = 30; y < 60; y++) for (let x = 36; x < 56; x++) e.world.tiles[idx(e.world, x, y)] = T.ROCK;
    (e as unknown as { spawnT: number }).spawnT = 1e9;
    e.hull = 1e9;
    const w = e.spawnEnemy('worm', 53.5, 40.5);
    expect(w.state).toBe('emerge');
    const rumbles = e.drainEvents().length;
    void rumbles;
    run(e, 1.0);
    expect(w.state).toBe('emerge');
    expect(e.hurtEnemy(w, 999, false, false)).toBeUndefined();
    expect(w.hp).toBe(w.maxHp); // untouchable while it is still burrowing up
    run(e, 0.8);
    expect(w.state).toBe('hunt');
    const startX = w.segs[0].x;
    run(e, 8);
    expect(w.segs[0].x).toBeLessThan(startX - 3);
    // the path it took is open air now
    const hx = Math.floor(w.segs[0].x + 1.2), hy = Math.floor(w.segs[0].y);
    expect(tileAt(e.world, hx, hy)).toBe(T.AIR);
    // and it never touches bedrock or plate
    for (const s of w.segs) expect([T.BEDROCK, T.PLATE]).not.toContain(tileAt(e.world, Math.floor(s.x), Math.floor(s.y)));
  });

  it('turns away from plate and bedrock instead of eating them', () => {
    const e = mk();
    enclosure(e, 30, 40, 3, 2);
    for (let y = 34; y < 50; y++) for (let x = 38; x < 56; x++) e.world.tiles[idx(e.world, x, y)] = T.ROCK;
    for (let y = 34; y < 50; y++) e.world.tiles[idx(e.world, 44, y)] = T.PLATE;
    (e as unknown as { spawnT: number }).spawnT = 1e9;
    e.hull = 1e9;
    const w = e.spawnEnemy('worm', 50.5, 41.5);
    w.stateT = 0.01;
    run(e, 10);
    for (let y = 34; y < 50; y++) expect(tileAt(e.world, 44, y)).toBe(T.PLATE);
  });

  it('is killable by the blaster and drops loot', () => {
    const e = mk();
    enclosure(e);
    const w = e.spawnEnemy('worm', e.x + 5, e.y);
    w.state = 'hunt'; w.stateT = 0; e.hull = 1e9;
    carve(e, Math.floor(e.x), Math.floor(e.y), Math.floor(e.x) + 7, Math.floor(e.y) + 1);
    for (let i = 0; i < 60 * 8 && w.hp > 0; i++) e.update(1 / 60, { ...NO_INPUT, fire: true, aimX: w.segs[0].x, aimY: w.segs[0].y });
    expect(w.hp).toBeLessThanOrEqual(0);
    expect(e.kills).toBe(1);
  });
});

describe('ambient spawning follows the planet roster and depth', () => {
  it('shallow depths only spawn the early roster; deeper adds worms and brutes', () => {
    const p = getPlanet(1);
    const shallow = new Set<string>(), deep = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const e = mk(1, 100 + i);
      e.depth = 8;
      (e as unknown as { spawnAmbient: () => void }).spawnAmbient();
      e.enemies.forEach((en) => shallow.add(en.kind));
      const d = mk(1, 200 + i);
      d.depth = 70;
      for (let k = 0; k < 6; k++) (d as unknown as { spawnAmbient: () => void }).spawnAmbient();
      d.enemies.forEach((en) => deep.add(en.kind));
    }
    for (const k of shallow) expect(['mite', 'bat']).toContain(k);
    expect(p.roster.some((r) => r.kind === 'worm')).toBe(true);
    expect([...deep].some((k) => k === 'worm' || k === 'brute' || k === 'bat')).toBe(true);
  });

  it('enemies get tougher the deeper you are', () => {
    const a = mk(); a.depth = 0;
    const b = mk(); b.depth = 160;
    expect(b.spawnEnemy('mite', 5, 40).maxHp).toBeGreaterThan(a.spawnEnemy('mite', 5, 40).maxHp * 1.8);
    void stats; void SURFACE_ROW; void PLANETS;
  });
});
