import { describe, expect, it } from 'vitest';
import { PLANETS, resolveRigStats } from '../src/game/balance';
import { ARENA_H, ARENA_W, factionRow, NO_SINPUT, SHIPS, SInput, SpaceEngine } from '../src/space/engine';

const stats = (over = {}) => ({ ...resolveRigStats({ streakDays: 0 }, []), ...over });
const mk = (planet = 1, seed = 5, st = stats()) => new SpaceEngine(planet, st, seed);
const run = (e: SpaceEngine, secs: number, input: Partial<SInput> = {}) => { for (let t = 0; t < secs; t += 1 / 60) e.update(1 / 60, { ...NO_SINPUT, aimX: e.x + 100, aimY: e.y, ...input }); };
const clear = (e: SpaceEngine) => { e.enemies.length = 0; e.asteroids.length = 0; e.bullets.length = 0; e.pickups.length = 0; };
const quiet = (e: SpaceEngine) => { clear(e); e.breakT = 1e9; (e as unknown as { rockT: number }).rockT = 1e9; (e as unknown as { crewT: number }).crewT = 1e9; };

describe('flight', () => {
  it('thrust accelerates, drifts when released, and burns fuel', () => {
    const e = mk(); quiet(e);
    const f0 = e.fuel;
    run(e, 1, { moveX: 1 });
    expect(e.vx).toBeGreaterThan(80);
    expect(e.fuel).toBeLessThan(f0);
    const x = e.x;
    run(e, 1, {});
    expect(e.x).toBeGreaterThan(x + 20); // keeps coasting
    expect(e.vx).toBeLessThan(120);
  });

  it('boost goes faster for double the fuel', () => {
    const a = mk(); quiet(a); run(a, 1.5, { moveX: 1 });
    const b = mk(); quiet(b); run(b, 1.5, { moveX: 1, boost: true });
    expect(b.vx).toBeGreaterThan(a.vx + 30);
    expect(b.stats.maxFuel - b.fuel).toBeGreaterThan((a.stats.maxFuel - a.fuel) * 1.5);
  });

  it('an empty tank means drifting, but it trickles back so you are never stuck', () => {
    const e = mk(); quiet(e);
    e.fuel = 0;
    run(e, 0.5, { moveX: 1 });
    expect(e.vx).toBeLessThan(5);
    run(e, 3, {});
    expect(e.fuel).toBeGreaterThan(3);
    run(e, 0.3, { moveX: 1 });
    expect(e.vx).toBeGreaterThan(5);
  });

  it('the arena edge is a wall', () => {
    const e = mk(); quiet(e);
    e.x = ARENA_W - 12; e.vx = 150;
    run(e, 1, {});
    expect(e.x).toBeLessThanOrEqual(ARENA_W);
    expect(e.vx).toBeLessThan(0);
    e.y = 12; e.vy = -200; run(e, 1, {});
    expect(e.y).toBeGreaterThan(0);
    void ARENA_H;
  });

  it('the ship turns toward the cursor', () => {
    const e = mk(); quiet(e);
    run(e, 0.6, { aimX: e.x, aimY: e.y + 100 });
    expect(Math.abs(e.angle - Math.PI / 2)).toBeLessThan(0.05);
  });

  it('hull upgrades change the ship you fly', () => {
    expect(mk(1, 1, stats({ maxHull: 100 })).shipSprite).toBe(1);
    expect(mk(1, 1, stats({ maxHull: 125 })).shipSprite).toBe(2);
    expect(mk(1, 1, stats({ maxHull: 150 })).shipSprite).toBe(3);
    expect(mk(1, 1, stats({ maxHull: 200 })).shipSprite).toBe(4);
  });
});

describe('weapons', () => {
  it('pulse guns kill ships, cost energy, and pay out scrap', () => {
    const e = mk(); quiet(e);
    (e as unknown as { spawnShip: (k: string) => void }).spawnShip('fighter');
    const f = e.enemies[0]; f.x = e.x + 120; f.y = e.y; f.t = 99; f.vx = f.vy = 0; f.dir = 0;
    const hp = f.hp;
    run(e, 0.5, { fire: true });
    expect(f.hp).toBeLessThan(hp);
    expect(e.energy).toBeLessThan(e.stats.maxEnergy);
    for (let i = 0; i < 240 && e.enemies.includes(f); i++) e.update(1 / 60, { ...NO_SINPUT, fire: true, aimX: f.x, aimY: f.y });
    expect(e.enemies.includes(f)).toBe(false);
    expect(e.kills).toBe(1);
    expect(e.scrap).toBeGreaterThan(0);
  });

  it('a missile homes in and damages everything near the blast', () => {
    const e = mk(); quiet(e);
    const sp = (e as unknown as { spawnShip: (k: string) => void }).spawnShip.bind(e);
    sp('gunship'); sp('gunship');
    const [a, b] = e.enemies;
    a.x = e.x + 200; a.y = e.y - 30; b.x = a.x + 12; b.y = a.y; a.t = b.t = 99; a.vx = a.vy = b.vx = b.vy = 0; a.dir = b.dir = 0;
    const ha = a.hp, hb = b.hp, m = e.missiles;
    e.fireMissile();
    expect(e.missiles).toBe(m - 1);
    run(e, 3);
    expect(a.hp < ha || !e.enemies.includes(a)).toBe(true);
    expect(b.hp < hb || !e.enemies.includes(b)).toBe(true);
  });

  it('cannot fire a missile with none left', () => {
    const e = mk(); quiet(e); e.missiles = 0;
    e.fireMissile();
    expect(e.bullets.length).toBe(0);
  });

  it('override pulses everything, restores shield, and goes on cooldown', () => {
    const e = mk(); quiet(e);
    (e as unknown as { spawnShip: (k: string) => void }).spawnShip('heavy');
    const h = e.enemies[0]; h.x = e.x + 100; h.y = e.y; h.t = h.t2 = 99;
    e.damageShip(30);
    const hp = h.hp;
    e.empBlast();
    expect(e.shield).toBe(e.stats.maxShield);
    expect(h.hp).toBeLessThan(hp);
    expect(e.overrideReady).toBe(false);
    run(e, 41);
    expect(e.overrideReady).toBe(true);
  });
});

describe('hostiles', () => {
  it('each ship type behaves its own way', () => {
    const e = mk(); quiet(e); e.hull = 1e9;
    const sp = (e as unknown as { spawnShip: (k: string) => void }).spawnShip.bind(e);
    for (const k of ['scout', 'fighter', 'gunship', 'heavy']) sp(k);
    e.enemies.forEach((en, i) => { en.x = e.x + 200 + i * 20; en.y = e.y + i * 30; en.t = 0; en.t2 = 0; });
    let missile = false, shots = false;
    for (let i = 0; i < 60 * 4; i++) { e.update(1 / 60, { ...NO_SINPUT }); if (e.bullets.some((b) => b.kind === 'missile' && !b.fromPlayer)) missile = true; if (e.bullets.some((b) => !b.fromPlayer && b.kind !== 'missile')) shots = true; }
    expect(e.enemies.some((x) => x.kind === 'scout')).toBe(false); // the scout rammed itself
    expect(shots).toBe(true);
    expect(missile).toBe(true); // the heavy launched a missile
  });

  it('enemy fire hurts, shields absorb first, and death ends the sortie', () => {
    const e = mk(); quiet(e);
    const s = e.shield;
    e.damageShip(10);
    expect(e.shield).toBe(s - 10);
    expect(e.hull).toBe(e.stats.maxHull);
    e.scrap = 100;
    e.damageShip(9999);
    expect(e.status).toBe('ended');
    expect(e.result?.outcome).toBe('destroyed');
    expect(e.result?.scrap).toBe(50);
  });

  it('retreat keeps everything', () => {
    const e = mk(); quiet(e); e.scrap = 100; e.cores = 3;
    for (let i = 0; i < 150; i++) e.setRecall(true, 1 / 60);
    expect(e.result?.outcome).toBe('retreat');
    expect(e.result?.scrap).toBe(100);
    expect(e.result?.neuroCores).toBe(3);
  });

  it('factions: green and red hostiles, player always blue', () => {
    expect(PLANETS.map((p) => factionRow(p.id))).toEqual([0, 1, 1, 0, 1]);
    for (const k of Object.keys(SHIPS)) expect(SHIPS[k as keyof typeof SHIPS].sprite).toBeLessThan(5);
  });
});

describe('waves', () => {
  it('start after a short breather, grow, and pay a bonus when cleared', () => {
    const e = mk();
    e.asteroids.length = 0;
    run(e, 3.2);
    expect(e.wave).toBe(1);
    const events = e.drainEvents();
    expect(events.some((x) => x.type === 'wave')).toBe(true);
    run(e, 1);
    expect(e.enemies.length).toBeGreaterThan(0);
    const w1 = e.enemies.length + (e as unknown as { spawnQueue: unknown[] }).spawnQueue.length;
    // kill everything that exists or will exist
    for (let i = 0; i < 600 && e.waveActive; i++) { e.enemies.forEach((en) => { en.hp = 0.1; }); e.enemies.forEach((en) => e.hurtEnemy(en, 5, false)); e.update(1 / 60, { ...NO_SINPUT }); e.hull = 1e9; }
    expect(e.waveActive).toBe(false);
    expect(e.drainEvents().some((x) => x.type === 'waveClear')).toBe(true);
    e.breakT = 0;
    run(e, 0.1);
    expect(e.wave).toBe(2);
    expect(w1).toBeGreaterThan(0);
  });

  it('unlock tougher hulls as waves climb and a boss every fifth wave', () => {
    const kindsAt = (wave: number) => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 10; seed++) {
        const e = mk(1, seed); quiet(e); e.hull = 1e9; e.wave = wave - 1;
        (e as unknown as { startWave: () => void }).startWave();
        for (let t = 0; t < 12; t += 1 / 60) { e.update(1 / 60, { ...NO_SINPUT }); e.hull = 1e9; }
        e.enemies.forEach((x) => seen.add(x.kind));
        expect(e.boss).toBeUndefined();
      }
      return seen;
    };
    expect(kindsAt(7).has('heavy')).toBe(true);
    expect(kindsAt(3).has('heavy')).toBe(false);
    expect(kindsAt(3).has('gunship')).toBe(false);
    expect(kindsAt(1).has('fighter')).toBe(false);
    const b = mk(); quiet(b); b.hull = 1e9; b.wave = 4;
    (b as unknown as { startWave: () => void }).startWave();
    expect(b.wave).toBe(5);
    expect(b.boss).toBeDefined();
    expect(b.boss!.name).toBe(b.planet.bossName);
  });

  it('every planet boss cycles through its attacks, can be killed, and pays', () => {
    for (const p of PLANETS) {
      const e = mk(p.id); quiet(e); e.hull = 1e9; e.shield = 1e9;
      e.wave = 4; (e as unknown as { startWave: () => void }).startWave();
      const boss = e.boss!;
      expect(boss.maxHp).toBeGreaterThan(p.bossHp * 0.5);
      const seen = new Set<string>();
      for (let t = 0; t < 70; t += 1 / 60) {
        e.update(1 / 60, { ...NO_SINPUT, aimX: boss.x, aimY: boss.y });
        seen.add(boss.atk);
        e.hull = 1e9; e.shield = 1e9; boss.hp = boss.maxHp;
        e.enemies = e.enemies.filter((x) => x.boss);
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(boss.x + boss.y)).toBe(true);
      const before = e.scrap;
      e.hurtEnemy(boss, 1e9, false);
      expect(e.bossesDown).toBe(1);
      expect(e.scrap - before).toBeGreaterThan(200);
      expect(e.cores).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('asteroids, pickups and crew', () => {
  it('rocks split when shot, small ones drop loot, and ramming one hurts', () => {
    const e = mk(); quiet(e);
    e.spawnAsteroid(0, true);
    const a = e.asteroids[0]; a.x = e.x + 80; a.y = e.y; a.vx = a.vy = 0; a.hp = 5;
    run(e, 1, { fire: true });
    expect(e.asteroids.length).toBeGreaterThanOrEqual(2); // it broke into pieces
    expect(e.asteroidsDestroyed).toBe(1);
    const c = mk(); quiet(c);
    c.spawnAsteroid(0, true);
    const r = c.asteroids[0]; r.x = c.x + 30; r.y = c.y; r.vx = r.vy = 0;
    c.vx = 90;
    const hp = c.hull + c.shield;
    run(c, 0.4, {});
    expect(c.hull + c.shield).toBeLessThan(hp);
  });

  it('each pickup does its thing', () => {
    const e = mk(); quiet(e);
    e.fuel = 5; e.hull = 10; e.missiles = 0; e.shield = 0;
    for (const kind of ['fuel', 'repair', 'missile', 'shield', 'scrap', 'core'] as const) e.pickups.push({ x: e.x, y: e.y, vx: 0, vy: 0, kind, age: 1 });
    run(e, 0.2);
    expect(e.fuel).toBeGreaterThan(30);
    expect(e.hull).toBeGreaterThan(30);
    expect(e.missiles).toBe(2);
    expect(e.shield).toBeGreaterThan(0);
    expect(e.scrap).toBeGreaterThan(0);
    expect(e.cores).toBe(1);
    expect(e.pickups.length).toBe(0);
  });

  it('three rescued crew make a Neuro-Core', () => {
    const e = mk(); quiet(e);
    for (let i = 0; i < 3; i++) e.pickups.push({ x: e.x, y: e.y, vx: 0, vy: 0, kind: 'crew', age: 1 });
    run(e, 0.2);
    expect(e.crewRescued).toBe(3);
    expect(e.cores).toBe(1);
  });

  it('augment multipliers raise payouts', () => {
    const a = mk(1, 5, stats({ oreValueMult: 1 })); quiet(a);
    const b = mk(1, 5, stats({ oreValueMult: 1.4 })); quiet(b);
    for (const e of [a, b]) e.pickups.push({ x: e.x, y: e.y, vx: 0, vy: 0, kind: 'scrap', age: 1 });
    run(a, 0.2); run(b, 0.2);
    expect(b.scrap).toBeGreaterThan(a.scrap);
  });
});
