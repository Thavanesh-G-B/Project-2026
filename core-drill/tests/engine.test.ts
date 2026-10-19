import { beforeEach, describe, expect, it } from 'vitest';
import { cargoCount, emptyCargo, lightRadius, MERCHANT_OFFERS, SURFACE_ROW, T } from '../src/game/balance';
import { DrillEngine, NO_INPUT } from '../src/game/engine';
import { idx, tileAt } from '../src/game/terrain';
import { besidePad, carve, enclosure, mk, run, stats } from './helpers';

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
    besidePad(e);
    run(e, 0.3);
    run(e, 6, { down: true });
    expect(e.maxDepth).toBeGreaterThanOrEqual(4);
    expect(e.fuel).toBeLessThan(e.stats.maxFuel);
  });

  it('thrusters climb and drain fuel faster than digging', () => {
    besidePad(e);
    run(e, 0.2);
    const f0 = e.fuel;
    run(e, 1, { up: true });
    expect(e.y).toBeLessThan(SURFACE_ROW - 3);
    expect(f0 - e.fuel).toBeGreaterThan(3);
  });

  it('cannot dig bedrock', () => {
    run(e, 0.3);
    run(e, 2, { down: true });
    expect(e.depth).toBe(0);
    expect(e.digTarget).toBeNull();
  });

  it('plated floors take a long time to drill through, but a bomb opens them', () => {
    besidePad(e);
    const y = SURFACE_ROW + 12; // first plate row
    carve(e, 33, SURFACE_ROW + 1, 36, y); // open a shaft down to the plate
    e.x = 35.5; e.y = y - 0.6; e.vy = 0;
    run(e, 0.3);
    expect(tileAt(e.world, 35, y)).toBe(T.PLATE);
    run(e, 2, { down: true });
    expect(tileAt(e.world, 35, y)).toBe(T.PLATE); // still there after 2s
    e.placeBomb();
    run(e, 1.3);
    expect(tileAt(e.world, 35, y)).toBe(T.AIR);
  });

  it('collects ore, respects cargo capacity and sells on the pad', () => {
    besidePad(e);
    const col = Math.floor(e.x);
    e.world.tiles[idx(e.world, col, SURFACE_ROW)] = T.SCRAP;
    run(e, 0.3);
    run(e, 1, { down: true });
    expect(e.cargo.scrapOre).toBe(1);
    e.cargo = { ...emptyCargo(), scrapOre: e.stats.cargoCap };
    e.world.tiles[idx(e.world, col, SURFACE_ROW + 1)] = T.SCRAP;
    run(e, 1, { down: true });
    expect(cargoCount(e.cargo)).toBe(e.stats.cargoCap);
    e.x = e.world.padX0 + 1; e.y = SURFACE_ROW - 0.4; e.vy = 0;
    run(e, 0.5);
    expect(cargoCount(e.cargo)).toBe(0);
    expect(e.bankedScrap).toBeGreaterThan(0);
  });

  it('hazard pockets hurt when cracked open, with a planet-specific side effect', () => {
    for (const [planet, check] of [
      [1, (x: DrillEngine) => x.hull + x.shield < x.stats.maxHull + x.stats.maxShield],
      [2, (x: DrillEngine) => x.burnT > 0],
      [4, (x: DrillEngine) => x.slowT > 0],
      [3, (x: DrillEngine) => x.enemies.some((en) => en.kind === 'phantom')],
    ] as Array<[number, (x: DrillEngine) => boolean]>) {
      const x = mk(planet);
      besidePad(x);
      x.world.tiles[idx(x.world, Math.floor(x.x), SURFACE_ROW)] = T.HAZARD;
      run(x, 0.3);
      run(x, 1, { down: true });
      expect(check(x)).toBe(true);
    }
  });

  it('rift pockets on Void-XV throw the rig across the level', () => {
    const x = mk(5);
    besidePad(x);
    x.world.tiles[idx(x.world, Math.floor(x.x), SURFACE_ROW)] = T.HAZARD;
    const x0 = x.x;
    run(x, 0.3);
    run(x, 1, { down: true });
    expect(Math.abs(x.x - x0) + Math.abs(x.y - (SURFACE_ROW - 0.4))).toBeGreaterThan(1.5);
  });

  it('falling from a height damages the hull', () => {
    besidePad(e);
    e.y = 1;
    run(e, 0.1);
    const before = e.hull + e.shield;
    run(e, 2);
    expect(e.hull + e.shield).toBeLessThan(before);
  });

  it('the world grows as the rig sinks and the fog radius closes in', () => {
    const h0 = e.world.h;
    e.y = h0 - 10; e.x = 30;
    run(e, 0.1);
    expect(e.world.h).toBeGreaterThan(h0);
    const shallow = lightRadius(10), deep = lightRadius(100);
    expect(deep).toBeLessThan(shallow - 3);
    e.y = SURFACE_ROW + 60;
    run(e, 0.05);
    expect(e.lightR).toBeCloseTo(lightRadius(e.depth, e.stats.lightBonus), 1);
  });
});

describe('combat', () => {
  it('blaster bullets damage and kill enemies, cost energy, and loot is banked', () => {
    const e = mk();
    enclosure(e);
    const en = e.spawnEnemy('mite', e.x + 4, e.y);
    en.speed = 0; en.shootT = 99;
    const hp = en.hp;
    run(e, 0.6, { fire: true, aimX: e.x + 4, aimY: e.y });
    expect(en.hp).toBeLessThan(hp);
    expect(e.energy).toBeLessThan(e.stats.maxEnergy);
    run(e, 3, { fire: true, aimX: e.x + 4, aimY: e.y });
    expect(e.enemies).not.toContain(en);
    expect(e.kills).toBe(1);
    expect(e.cargo.bonusScrap).toBeGreaterThan(0);
  });

  it('enemies hurt the rig and shields absorb first', () => {
    const e = mk();
    enclosure(e);
    const shield = e.shield;
    const en = e.spawnEnemy('mite', e.x + 0.2, e.y);
    en.speed = 0; en.shootT = 99;
    run(e, 0.5);
    expect(e.shield).toBeLessThan(shield);
    expect(e.hull).toBe(e.stats.maxHull);
  });

  it('bombs clear rock and hurt enemies in range', () => {
    const e = mk();
    besidePad(e);
    run(e, 0.2);
    const tx = Math.floor(e.x), ty = SURFACE_ROW + 1;
    expect(tileAt(e.world, tx, ty)).not.toBe(T.AIR);
    const en = e.spawnEnemy('mite', e.x + 1.5, e.y + 1.5);
    en.speed = 0;
    e.placeBomb();
    expect(e.bombs).toBe(e.stats.bombs - 1);
    run(e, 1.2);
    expect(tileAt(e.world, tx, ty)).toBe(T.AIR);
    expect(en.hp).toBeLessThan(en.maxHp);
  });

  it('override EMP hurts everything, restores shield and starts a cooldown', () => {
    const e = mk();
    enclosure(e);
    (e as unknown as { spawnT: number }).spawnT = 1e9; // no ambient visitors during the cooldown wait
    e.damageRig(40);
    e.hull = 1e9;
    const en = e.spawnEnemy('sentry', e.x + 5, e.y - 1); en.shootT = 99;
    e.empBlast();
    expect(e.shield).toBe(e.stats.maxShield);
    expect(en.hp).toBeLessThan(en.maxHp);
    expect(e.overrideReady).toBe(false);
    run(e, 41);
    expect(e.overrideReady).toBe(true);
  });

  it('a raid spawns drones when you are near the surface, and a pad turret shoots them', () => {
    const e = mk(1, 7, { ...stats(), turretLevel: 3 });
    run(e, 75);
    const raiders = e.enemies.filter((x) => x.kind === 'raider');
    expect(raiders.length).toBeGreaterThan(0);
    run(e, 25);
    expect(e.kills).toBeGreaterThan(0); // the turret did the work: nobody shot at anything
  });

  it('a sentry shoots when it can see you and is blocked by rock when it cannot', () => {
    const e = mk();
    enclosure(e);
    const s = e.spawnEnemy('sentry', e.x + 5, e.y - 2.5);
    s.shootT = 0;
    run(e, 3);
    expect(e.shield + e.hull).toBeLessThan(e.stats.maxShield + e.stats.maxHull);
    // wall it off
    const e2 = mk();
    enclosure(e2);
    carve(e2, Math.floor(e2.x) + 2, 36, Math.floor(e2.x) + 3, 44, T.ROCK);
    const s2 = e2.spawnEnemy('sentry', e2.x + 5, e2.y - 1);
    s2.shootT = 0;
    run(e2, 4);
    expect(e2.shield).toBe(e2.stats.maxShield);
  });
});

describe('loot, stations and surprises', () => {
  it('cracking a crate drops pickups the rig collects', () => {
    const e = mk();
    besidePad(e);
    e.world.tiles[idx(e.world, Math.floor(e.x), SURFACE_ROW)] = T.CRATE;
    run(e, 0.3);
    run(e, 0.8, { down: true });
    expect(e.items.length + e.cargo.bonusScrap + e.bankedCores).toBeGreaterThan(0);
    run(e, 3);
    expect(e.items.length).toBeLessThanOrEqual(1);
  });

  it('each pickup kind has its effect', () => {
    const e = mk();
    enclosure(e);
    e.fuel = 10; e.hull = 10; e.bombs = 0; e.shield = 0;
    const before = e.cargo.bonusScrap;
    for (const kind of ['fuel', 'repair', 'bomb', 'shield', 'scrap', 'core'] as const) e.items.push({ x: e.x, y: e.y, vy: 0, kind, age: 1 });
    run(e, 0.3);
    expect(e.fuel).toBeGreaterThan(30);
    expect(e.hull).toBeGreaterThan(30);
    expect(e.bombs).toBe(1);
    expect(e.shield).toBeGreaterThan(0);
    expect(e.cargo.bonusScrap).toBeGreaterThan(before);
    expect(e.bankedCores).toBe(1);
    expect(e.items.length).toBe(0);
  });

  it('a mimic crate springs an ambush', () => {
    const e = mk();
    besidePad(e);
    e.world.tiles[idx(e.world, Math.floor(e.x), SURFACE_ROW)] = T.MIMIC;
    run(e, 0.3);
    run(e, 0.8, { down: true });
    expect(e.enemies.length).toBeGreaterThanOrEqual(4);
  });

  it('a treasure chest pays out, and a trapped room springs an ambush once', () => {
    const e = mk();
    besidePad(e);
    run(e, 0.2);
    const x = Math.floor(e.x), y = SURFACE_ROW;
    e.world.tiles[idx(e.world, x, y)] = T.CHEST;
    e.world.rooms.push({ x0: x - 2, y0: y - 1, x1: x + 3, y1: y + 3, ambush: true, triggered: false });
    run(e, 1.2, { down: true });
    expect(e.bankedCores).toBeGreaterThanOrEqual(1);
    expect(e.enemies.some((en) => en.kind === 'brute')).toBe(true);
    expect(e.world.rooms[e.world.rooms.length - 1].triggered).toBe(true);
  });

  it('a relay sells cargo and refuels once, then only sells', () => {
    const e = mk();
    run(e, 0.2);
    enclosure(e);
    const r = { x: e.x, y: e.y, used: false };
    e.world.relays.push(r);
    e.fuel = 20; e.hull = 30;
    e.cargo = { ...emptyCargo(), scrapOre: 5 };
    run(e, 0.2);
    expect(r.used).toBe(true);
    expect(e.fuel).toBeCloseTo(20 + e.stats.maxFuel * 0.5, 0);
    expect(e.hull).toBeGreaterThan(60);
    expect(cargoCount(e.cargo)).toBe(0);
    expect(e.bankedScrap).toBeGreaterThan(0);
    e.fuel = 20; e.cargo = { ...emptyCargo(), scrapOre: 2 };
    run(e, 0.2);
    expect(e.fuel).toBeLessThan(25); // no second refuel
    expect(cargoCount(e.cargo)).toBe(0);
  });

  it('the derelict trader sells things for banked scrap only', () => {
    const e = mk();
    enclosure(e);
    e.world.merchants.push({ x: e.x, y: e.y });
    run(e, 0.1);
    expect(e.nearMerchant).toBe(true);
    e.openMerchant();
    expect(e.status).toBe('merchant');
    const t = e.time;
    e.update(1, NO_INPUT);
    expect(e.time).toBe(t); // the world waits while you shop
    e.fuel = 10; e.bankedScrap = 50;
    expect(e.buyOffer('fuel')).toBe(false); // costs 70
    e.bankedScrap = 100;
    expect(e.buyOffer('fuel')).toBe(true);
    expect(e.fuel).toBe(60);
    expect(e.bankedScrap).toBe(100 - MERCHANT_OFFERS.find((o) => o.id === 'fuel')!.cost);
    e.closeMerchant();
    expect(e.status).toBe('running');
  });

  it('tremors drop boulders that hurt, and signal storms dim your lamp then pay a bonus', () => {
    const e = mk();
    enclosure(e, 30, 40, 4, 8);
    e.depth = 20;
    (e as unknown as { startTremor: () => void }).startTremor();
    expect(e.boulders.length).toBeGreaterThan(0);
    const hull = e.hull + e.shield;
    run(e, 4);
    expect(e.boulders.length).toBe(0);
    expect(e.hull + e.shield).toBeLessThanOrEqual(hull);

    const s = mk();
    enclosure(s);
    run(s, 0.1);
    const normal = s.lightR;
    s.surgeLeft = 10;
    expect(s.lightR).toBeLessThan(normal * 0.7);
    const before = s.cargo.bonusScrap;
    s.surgeLeft = 0.05;
    run(s, 0.2);
    expect(s.cargo.bonusScrap).toBeGreaterThan(before);
  });

  it('cracking a vault pauses the run until resolved; a right answer pays, a wrong one does not', () => {
    for (const ok of [true, false]) {
      const e = mk();
      besidePad(e);
      e.world.tiles[idx(e.world, Math.floor(e.x), SURFACE_ROW)] = T.VAULT;
      run(e, 0.3);
      run(e, 2, { down: true });
      expect(e.status).toBe('vault');
      const t = e.time;
      e.update(1, NO_INPUT);
      expect(e.time).toBe(t);
      e.resolveVault(ok);
      expect(e.status).toBe('running');
      expect(e.bankedCores).toBe(ok ? 1 : 0);
      expect(e.vaultsOpened).toBe(ok ? 1 : 0);
    }
  });
});

describe('run end', () => {
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

  it('holding recall for 2.5s ends the run, and the result lists depth per planet', () => {
    const e = mk();
    for (let i = 0; i < 200; i++) e.setRecall(true, 1 / 60);
    expect(e.status).toBe('ended');
    expect(e.result?.outcome).toBe('recalled');
    expect(e.result?.depths).toBeDefined();
    expect(e.result?.clears).toEqual([]);
  });
});
