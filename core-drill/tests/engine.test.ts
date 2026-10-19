import { beforeEach, describe, expect, it } from 'vitest';
import { cargoCount, emptyCargo, getPlanet, SURFACE_ROW, T } from '../src/game/balance';
import { DrillEngine, Input, NO_INPUT } from '../src/game/engine';
import { generateWorld, idx, tileAt } from '../src/game/terrain';
import { resolveRigStats } from '../src/game/balance';

const stats = () => resolveRigStats({ streakDays: 0 }, []);
const mk = (planet = 1, seed = 7) => new DrillEngine(planet, stats(), seed);
const run = (e: DrillEngine, secs: number, input: Partial<Input> = {}) => {
  for (let t = 0; t < secs; t += 1 / 60) e.update(1 / 60, { ...NO_INPUT, ...input });
};

describe('terrain', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const p = getPlanet(1);
    expect(Array.from(generateWorld(p, 3).tiles)).toEqual(Array.from(generateWorld(p, 3).tiles));
    expect(Array.from(generateWorld(p, 3).tiles)).not.toEqual(Array.from(generateWorld(p, 4).tiles));
  });

  it('has sky, a bedrock pad, walls, ores, nests, vaults and an open boss cavern', () => {
    const p = getPlanet(1);
    const w = generateWorld(p, 5);
    for (let x = 0; x < w.w; x++) expect(tileAt(w, x, 2)).toBe(T.AIR);
    for (let x = w.padX0; x <= w.padX1; x++) expect(tileAt(w, x, SURFACE_ROW)).toBe(T.BEDROCK);
    for (let y = SURFACE_ROW; y < w.h; y++) {
      expect(tileAt(w, 0, y)).toBe(T.BEDROCK);
      expect(tileAt(w, w.w - 1, y)).toBe(T.BEDROCK);
    }
    const count = (t: number) => w.tiles.reduce((n, v) => n + (v === t ? 1 : 0), 0);
    expect(count(T.SCRAP)).toBeGreaterThan(40);
    expect(count(T.CRYSTAL)).toBeGreaterThan(5);
    expect(count(T.VAULT)).toBeGreaterThan(0);
    expect(count(T.NEST)).toBeGreaterThan(0);
    expect(tileAt(w, 30, w.h - 3)).toBe(T.AIR);
    expect(tileAt(w, 30, w.bossTop - 1)).toBe(T.ROCK);
  });

  it('keeps hazards and nests out of the first few metres', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const w = generateWorld(getPlanet(2), seed);
      for (let y = SURFACE_ROW + 1; y < SURFACE_ROW + 5; y++)
        for (let x = 1; x < w.w - 1; x++) expect([T.HAZARD, T.NEST, T.VAULT]).not.toContain(tileAt(w, x, y));
    }
  });
});

describe('rig', () => {
  let e: DrillEngine;
  beforeEach(() => { e = mk(); });

  it('starts docked on the pad with full tanks', () => {
    run(e, 0.5);
    expect(e.onPad).toBe(true);
    expect(e.fuel).toBe(e.stats.maxFuel);
    expect(e.depth).toBe(0);
  });

  it('digs down, gains depth and spends fuel', () => {
    run(e, 0.5, { right: true });
    run(e, 1.0, { right: true });
    // walk off the pad and dig straight down
    e.x = e.world.padX1 + 3.5; e.y = SURFACE_ROW - 0.5;
    run(e, 0.3);
    run(e, 6, { down: true });
    expect(e.maxDepth).toBeGreaterThanOrEqual(4);
    expect(e.fuel).toBeLessThan(e.stats.maxFuel);
  });

  it('thrusters climb and drain fuel faster than digging', () => {
    e.x = e.world.padX1 + 4.5; e.y = SURFACE_ROW - 0.4;
    run(e, 0.2);
    const f0 = e.fuel;
    run(e, 1, { up: true });
    expect(e.y).toBeLessThan(SURFACE_ROW - 3);
    expect(f0 - e.fuel).toBeGreaterThan(1.5);
  });

  it('cannot dig bedrock', () => {
    run(e, 0.3);
    run(e, 2, { down: true }); // pad plating
    expect(e.depth).toBe(0);
    expect(e.digTarget).toBeNull();
  });

  it('collects ore, respects cargo capacity and sells on the pad', () => {
    e.x = e.world.padX1 + 3.5; e.y = SURFACE_ROW - 0.4;
    e.world.tiles[idx(e.world, Math.floor(e.x), SURFACE_ROW)] = T.SCRAP;
    run(e, 0.3);
    run(e, 1, { down: true });
    expect(e.cargo.scrapOre).toBe(1);
    // full cargo loses the ore
    e.cargo = { ...emptyCargo(), scrapOre: e.stats.cargoCap };
    e.world.tiles[idx(e.world, Math.floor(e.x), SURFACE_ROW + 1)] = T.SCRAP;
    run(e, 1, { down: true });
    expect(cargoCount(e.cargo)).toBe(e.stats.cargoCap);
    // go back and dock
    e.x = e.world.padX0 + 1; e.y = SURFACE_ROW - 0.4; e.vy = 0;
    run(e, 0.5);
    expect(cargoCount(e.cargo)).toBe(0);
    expect(e.bankedScrap).toBeGreaterThan(0);
  });

  it('hazard pockets hurt when cracked open', () => {
    e.x = e.world.padX1 + 3.5; e.y = SURFACE_ROW - 0.4;
    e.world.tiles[idx(e.world, Math.floor(e.x), SURFACE_ROW)] = T.HAZARD;
    run(e, 0.3);
    const hull = e.hull + e.shield;
    run(e, 1, { down: true });
    expect(e.hull + e.shield).toBeLessThan(hull);
  });

  it('falling from a height damages the hull', () => {
    e.x = e.world.padX1 + 3.5; e.y = 1;
    run(e, 0.1);
    const before = e.hull + e.shield;
    run(e, 2);
    expect(e.hull + e.shield).toBeLessThan(before);
  });
});

describe('combat', () => {
  it('blaster bullets damage and kill enemies, and cost energy', () => {
    const e = mk();
    run(e, 0.2);
    const en = e.spawnEnemy('crawler', e.x + 4, e.y);
    en.speed = 0;
    const hp = en.hp;
    run(e, 0.6, { fire: true, aimX: e.x + 4, aimY: e.y });
    expect(en.hp).toBeLessThan(hp);
    expect(e.energy).toBeLessThan(e.stats.maxEnergy);
    run(e, 3, { fire: true, aimX: e.x + 4, aimY: e.y });
    expect(e.enemies).not.toContain(en);
    expect(e.kills).toBe(1);
    expect(e.cargo.bonusScrap + e.bankedScrap).toBeGreaterThan(0);
  });

  it('enemies hurt the rig and shields absorb first', () => {
    const e = mk();
    run(e, 0.2);
    const shield = e.shield;
    const en = e.spawnEnemy('crawler', e.x + 0.2, e.y);
    en.speed = 0;
    run(e, 0.5);
    expect(e.shield).toBeLessThan(shield);
    expect(e.hull).toBe(e.stats.maxHull);
  });

  it('bombs clear rock and hurt enemies in range', () => {
    const e = mk();
    e.x = e.world.padX1 + 3.5; e.y = SURFACE_ROW - 0.4;
    run(e, 0.2);
    const tx = Math.floor(e.x), ty = SURFACE_ROW + 1;
    expect(tileAt(e.world, tx, ty)).not.toBe(T.AIR);
    const en = e.spawnEnemy('crawler', e.x + 1.5, e.y + 1.5);
    en.speed = 0;
    e.placeBomb();
    expect(e.bombs).toBe(e.stats.bombs - 1);
    run(e, 1.2);
    expect(tileAt(e.world, tx, ty)).toBe(T.AIR);
    expect(en.hp).toBeLessThan(en.maxHp);
  });

  it('override EMP hurts everything, restores shield and starts a cooldown', () => {
    const e = mk();
    run(e, 0.2);
    e.damageRig(40);
    const en = e.spawnEnemy('spitter', e.x + 5, e.y); en.speed = 0;
    e.empBlast();
    expect(e.shield).toBe(e.stats.maxShield);
    expect(en.hp).toBeLessThan(en.maxHp);
    expect(e.overrideReady).toBe(false);
    run(e, 41);
    expect(e.overrideReady).toBe(true);
  });

  it('a raid spawns drones when you are near the surface', () => {
    const e = mk();
    run(e, 75);
    expect(e.enemies.some((x) => x.kind === 'raider')).toBe(true);
  });
});

describe('vaults, boss and run end', () => {
  it('cracking a vault pauses the run until resolved; correct answer pays a core', () => {
    const e = mk();
    e.x = e.world.padX1 + 3.5; e.y = SURFACE_ROW - 0.4;
    e.world.tiles[idx(e.world, Math.floor(e.x), SURFACE_ROW)] = T.VAULT;
    run(e, 0.3);
    run(e, 2, { down: true });
    expect(e.status).toBe('vault');
    const t = e.time;
    e.update(1, NO_INPUT);
    expect(e.time).toBe(t);
    e.resolveVault(true);
    expect(e.status).toBe('running');
    expect(e.bankedCores).toBe(1);
    expect(e.vaultsOpened).toBe(1);
  });

  it('a wrong vault answer pays nothing', () => {
    const e = mk();
    e.x = e.world.padX1 + 3.5; e.y = SURFACE_ROW - 0.4;
    e.world.tiles[idx(e.world, Math.floor(e.x), SURFACE_ROW)] = T.VAULT;
    run(e, 0.3);
    run(e, 2, { down: true });
    e.resolveVault(false);
    expect(e.bankedCores).toBe(0);
    expect(e.vaultsOpened).toBe(0);
  });

  it('death keeps half the cargo; recall away from the pad charges a fee; docked recall is free', () => {
    const base = { ...emptyCargo(), scrapOre: 10 };
    const a = mk(); a.cargo = { ...base }; a.damageRig(9999);
    expect(a.status).toBe('ended');
    expect(a.result?.outcome).toBe('destroyed');
    expect(a.result?.scrap).toBe(60);

    const b = mk(); b.cargo = { ...base }; b.y = SURFACE_ROW + 20; b.x = 20; b.finish('recalled');
    expect(b.result?.scrap).toBe(90);

    const c = mk(); c.cargo = { ...base }; run(c, 0.3); c.finish('recalled');
    expect(c.result?.scrap).toBeGreaterThanOrEqual(120);
  });

  it('holding recall for 2.5s ends the run', () => {
    const e = mk();
    for (let i = 0; i < 200; i++) e.setRecall(true, 1 / 60);
    expect(e.status).toBe('ended');
    expect(e.result?.outcome).toBe('recalled');
  });

  it('entering the boss cavern wakes the boss; killing it clears the planet and pays a bonus', () => {
    const e = mk();
    e.x = (e.world.bossLeft + e.world.bossRight) / 2; e.y = e.world.bossTop + 6; e.vy = 0;
    run(e, 0.2);
    const boss = e.boss!;
    expect(boss).toBeDefined();
    expect(boss.hp).toBe(getPlanet(1).bossHp);
    e.hurtEnemy(boss, 99999, false, false);
    expect(e.status).toBe('ended');
    expect(e.result?.outcome).toBe('cleared');
    expect(e.result?.bossBeaten).toBe(true);
    expect(e.result?.neuroCores).toBeGreaterThanOrEqual(2);
  });

  it('boss fires bullet rings and dashes', () => {
    const e = mk();
    e.x = (e.world.bossLeft + e.world.bossRight) / 2; e.y = e.world.bossTop + 10; e.vy = 0;
    e.hull = 1e9;
    run(e, 3);
    expect(e.bullets.some((b) => !b.fromPlayer)).toBe(true);
    run(e, 8);
    expect(e.status).toBe('running');
  });
});
