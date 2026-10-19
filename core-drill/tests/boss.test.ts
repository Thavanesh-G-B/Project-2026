import { describe, expect, it } from 'vitest';
import { getPlanet, nextPlanet, PLANETS, SURFACE_ROW, T } from '../src/game/balance';
import { DrillEngine, NO_INPUT } from '../src/game/engine';
import { createWorld, ensureRows, tileAt } from '../src/game/terrain';
import { mk, run } from './helpers';

function intoBoss(planet: number, site = 0, seed = 5) {
  const e = mk(planet, seed);
  ensureRows(e.world, 400);
  const s = e.world.bossSites[site];
  e.x = (s.left + s.right) / 2; e.y = s.bottom - 0.5; e.vx = 0; e.vy = 0;
  e.hull = 1e9; e.shield = 1e9;
  for (const sp of e.world.spawners) sp.done = true;
  run(e, 0.3);
  return { e, s };
}

describe('bosses', () => {
  it('each planet has its own boss, wakes on entry and cycles through its patterns', () => {
    for (const p of PLANETS) {
      const { e } = intoBoss(p.id);
      const boss = e.boss!;
      expect(boss).toBeDefined();
      expect(boss.name).toBe(p.bossName);
      expect(boss.maxHp).toBe(p.bossHp);
      const seen = new Set<string>();
      (e as unknown as { spawnT: number }).spawnT = 1e9;
      for (let t = 0; t < 90 && e.status === 'running'; t += 1 / 60) {
        e.update(1 / 60, { ...NO_INPUT, fire: t % 1 < 0.5, aimX: boss.x, aimY: boss.y });
        seen.add(boss.atk);
        e.hull = 1e9; e.shield = 1e9; boss.hp = boss.maxHp; // survive and keep it alive to watch every attack
        e.enemies = e.enemies.filter((x) => x.kind === 'boss');
      }
      for (const pat of p.bossPatterns) expect(seen.has(pat)).toBe(true);
      expect(Number.isFinite(boss.x) && Number.isFinite(boss.y)).toBe(true);
      expect(boss.x).toBeGreaterThan(e.world.bossSites[0].left);
      expect(boss.x).toBeLessThan(e.world.bossSites[0].right + 1);
    }
  });

  it('killing the core boss secures the planet and offers warp-or-stay', () => {
    const { e } = intoBoss(1);
    const boss = e.boss!;
    e.hurtEnemy(boss, 1e9, false, false);
    expect(e.status).toBe('choice');
    expect(e.clears).toEqual([1]);
    expect(e.bossesDown).toBe(1);
    const evs = e.drainEvents();
    expect(evs.some((x) => x.type === 'planetCleared' && x.canWarp)).toBe(true);
    expect(e.bankedCores).toBeGreaterThanOrEqual(2);
    const t = e.time;
    e.update(1, NO_INPUT);
    expect(e.time).toBe(t); // the choice pauses the world
  });

  it('staying keeps you in the same endless mine, with the next guardian further down', () => {
    const { e } = intoBoss(1);
    e.hurtEnemy(e.boss!, 1e9, false, false);
    e.stay();
    expect(e.status).toBe('running');
    expect(e.planet.id).toBe(1);
    expect(e.world.bossSites[1].index).toBe(1);
    expect(e.world.bossSites[1].top).toBeGreaterThan(e.world.bossSites[0].top);
    // the floor of the cavern is rock: you can keep digging
    e.y = e.world.bossSites[0].bottom - 0.5;
    run(e, 0.2);
    expect(tileAt(e.world, Math.floor(e.x), e.world.bossSites[0].bottom + 1)).not.toBe(T.BEDROCK);
    // a second kill of the same planet's core is not possible: the site is done
    expect(e.world.bossSites[0].done).toBe(true);
  });

  it('guardian bosses are tougher, pay more, and do not offer the choice again', () => {
    const { e, s } = intoBoss(1, 1);
    const g = e.boss!;
    expect(g.bossIndex).toBe(1);
    expect(g.maxHp).toBeGreaterThan(getPlanet(1).bossHp * 1.5);
    expect(g.name).toContain('Guardian');
    const before = e.bankedScrap;
    e.hurtEnemy(g, 1e9, false, false);
    expect(e.status).toBe('running');
    expect(e.clears).toEqual([]);
    expect(e.bankedScrap - before).toBeGreaterThan(250);
    expect(s.done).toBe(true);
  });

  it('warping moves you to the next planet, keeping hull, cargo and bombs but refilling fuel', () => {
    const { e } = intoBoss(1);
    e.hurtEnemy(e.boss!, 1e9, false, false);
    e.hull = 40; e.fuel = 5; e.bombs = 4;
    e.cargo.scrapOre = 7;
    e.warp();
    expect(e.status).toBe('running');
    expect(e.planet.id).toBe(2);
    expect(e.world.planet.id).toBe(2);
    expect(e.onPad || e.y < SURFACE_ROW).toBe(true);
    expect(e.fuel).toBe(e.stats.maxFuel);
    expect(e.hull).toBeGreaterThan(40);
    expect(e.bombs).toBe(4);
    expect(e.cargo.scrapOre).toBe(7);
    expect(e.enemies.length).toBe(0);
    expect(e.depth).toBe(0);
    run(e, 1);
    // finishing the run reports both planets
    e.y = SURFACE_ROW + 30; e.x = 20; run(e, 0.1);
    e.finish('recalled');
    expect(e.result!.clears).toEqual([1]);
    expect(Object.keys(e.result!.depths).map(Number).sort()).toEqual([1, 2]);
    expect(e.result!.planetId).toBe(1);
    expect(e.result!.bossesDown).toBe(1);
  });

  it('the last planet has nothing to warp to, so clearing it keeps you running', () => {
    const { e } = intoBoss(5);
    expect(nextPlanet(5)).toBeNull();
    e.hurtEnemy(e.boss!, 1e9, false, false);
    expect(e.status).toBe('running');
    expect(e.clears).toEqual([5]);
    expect(e.drainEvents().some((x) => x.type === 'planetCleared' && !x.canWarp)).toBe(true);
  });

  it('guardian layout is endless: a boss site exists every four levels as far as you can dig', () => {
    const w = createWorld(getPlanet(2), 8);
    ensureRows(w, 1500);
    expect(w.bossSites.length).toBeGreaterThan(5);
    for (let i = 1; i < w.bossSites.length; i++) expect(w.bossSites[i].band - w.bossSites[i - 1].band).toBe(4);
  });
});

describe('DrillEngine misc', () => {
  it('the explored map only marks tiles that were lit', () => {
    const e = mk();
    e.x = 30; e.y = SURFACE_ROW + 20.5; e.vy = 0;
    run(e, 0.5);
    const w = e.world;
    let near = 0, far = 0;
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (e.explored[y * w.w + x]) { if (Math.hypot(x - e.x, y - e.y) < e.lightR + 4) near++; else far++; }
    expect(near).toBeGreaterThan(50);
    expect(far).toBe(0);
  });
  it('a fresh engine is a valid engine for every planet', () => {
    for (const p of PLANETS) {
      const e = new DrillEngine(p.id, mk().stats, 3);
      run(e, 0.5);
      expect(e.status).toBe('running');
    }
  });
});
