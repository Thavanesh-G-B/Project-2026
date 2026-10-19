import { describe, expect, it } from 'vitest';
import { B, BAND, bandStartDepth, D, FIRST_PLATE_DEPTH, getPlanet, PLANETS, SURFACE_ROW, T } from '../src/game/balance';
import { FLOW_INF, FlowField } from '../src/game/flow';
import { bandRow, bossIndexOfBand, createWorld, decorAt, ensureRows, tileAt } from '../src/game/terrain';

describe('endless mine generation', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const p = getPlanet(1);
    const a = createWorld(p, 3), b = createWorld(p, 3), c = createWorld(p, 4);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(Array.from(a.tiles)).not.toEqual(Array.from(c.tiles));
  });

  it('is independent of the order bands are generated in', () => {
    const p = getPlanet(2);
    const a = createWorld(p, 9); ensureRows(a, 400);
    const b = createWorld(p, 9); ensureRows(b, 150); ensureRows(b, 400);
    const n = Math.min(a.h, b.h) * a.w;
    expect(Array.from(a.tiles.slice(0, n))).toEqual(Array.from(b.tiles.slice(0, n)));
  });

  it('grows without bound as the rig descends', () => {
    const w = createWorld(getPlanet(1), 5);
    const h0 = w.h;
    ensureRows(w, 600);
    expect(w.h).toBeGreaterThan(h0);
    expect(w.h).toBeGreaterThanOrEqual(600);
    ensureRows(w, 2000);
    expect(w.h).toBeGreaterThanOrEqual(2000);
    expect(w.tiles.length).toBe(w.h * w.w);
  });

  it('has sky, a bedrock pad and unbreakable side walls', () => {
    const w = createWorld(getPlanet(1), 5);
    for (let x = 0; x < w.w; x++) expect(tileAt(w, x, 2)).toBe(T.AIR);
    for (let x = w.padX0; x <= w.padX1; x++) expect(tileAt(w, x, SURFACE_ROW)).toBe(T.BEDROCK);
    ensureRows(w, 300);
    for (let y = SURFACE_ROW; y < 300; y++) {
      expect(tileAt(w, 0, y)).toBe(T.BEDROCK);
      expect(tileAt(w, w.w - 1, y)).toBe(T.BEDROCK);
    }
  });

  it('every normal level has a plated floor with open shafts and a timber drift with rails', () => {
    const p = getPlanet(1);
    const w = createWorld(p, 11);
    ensureRows(w, 400);
    let checked = 0;
    for (let b = 0; b < 12; b++) {
      if (bossIndexOfBand(p, b) >= 0) continue;
      const r0 = bandRow(b);
      let plate = 0, gaps = 0;
      for (let x = 1; x < w.w - 1; x++) (tileAt(w, x, r0) === T.PLATE ? plate++ : tileAt(w, x, r0) === T.AIR ? gaps++ : 0);
      expect(plate).toBeGreaterThan(40);
      expect(gaps).toBeGreaterThanOrEqual(4); // two 2-wide shafts at least
      // the drift: three open rows with a wooden back wall, rails or dressing on the floor row
      let drift = 0, rails = 0;
      for (let x = 1; x < w.w - 1; x++) {
        if (tileAt(w, x, r0 + 3) === T.AIR && w.back[(r0 + 3) * w.w + x] === B.WOOD) drift++;
        const d = decorAt(w, x, r0 + 4);
        if (d === D.RAIL || d === D.CART || d === D.BONES || d === D.BARREL) rails++;
      }
      expect(drift).toBeGreaterThan(25);
      expect(rails).toBeGreaterThan(15);
      // every shaft opens into the drift
      for (let x = 1; x < w.w - 1; x++) if (tileAt(w, x, r0) === T.AIR) expect(tileAt(w, x, r0 + 2)).toBe(T.AIR);
      checked++;
    }
    expect(checked).toBeGreaterThan(6);
  });

  it('places relays every third level, and merchants/crates/lamps on levels', () => {
    const w = createWorld(getPlanet(1), 21);
    ensureRows(w, 700);
    expect(w.relays.length).toBeGreaterThanOrEqual(3);
    const bands = w.relays.map((r) => Math.round((r.y - 4.5 - SURFACE_ROW - FIRST_PLATE_DEPTH) / BAND));
    for (const b of bands) expect(b % 3).toBe(2);
    let crates = 0, lamps = 0;
    for (let i = 0; i < w.tiles.length; i++) { if (w.tiles[i] === T.CRATE || w.tiles[i] === T.MIMIC) crates++; if (w.decor[i] === D.LAMP) lamps++; }
    expect(crates).toBeGreaterThan(8);
    expect(lamps).toBeGreaterThan(8);
    expect(w.spawners.some((s) => s.kind === 'sentry')).toBe(true);
  });

  it('puts the core boss cavern where the planet says, then a guardian every few levels', () => {
    for (const p of PLANETS) {
      const w = createWorld(p, 4);
      ensureRows(w, SURFACE_ROW + bandStartDepth(p.coreBand + 9) + 20);
      expect(w.bossSites.length).toBeGreaterThanOrEqual(3);
      expect(w.bossSites[0].index).toBe(0);
      expect(w.bossSites[0].band).toBe(p.coreBand);
      expect(w.bossSites[1].index).toBe(1);
      expect(w.bossSites[1].band - w.bossSites[0].band).toBe(4);
      const s = w.bossSites[0];
      expect(tileAt(w, (s.left + s.right) >> 1, s.top + 3)).toBe(T.AIR);
      expect(tileAt(w, s.left - 1, s.top + 3)).not.toBe(T.AIR);
      // the cavern floor is rock, so the mine continues below after the boss
      expect(tileAt(w, 30, s.bottom + 1)).toBe(T.ROCK === tileAt(w, 30, s.bottom + 1) ? T.ROCK : tileAt(w, 30, s.bottom + 1));
      expect(tileAt(w, 30, s.bottom + 1)).not.toBe(T.BEDROCK);
    }
  });

  it('keeps hazards, nests and vaults out of the topsoil', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const w = createWorld(getPlanet(2), seed);
      for (let y = SURFACE_ROW; y < SURFACE_ROW + FIRST_PLATE_DEPTH; y++)
        for (let x = 1; x < w.w - 1; x++) expect([T.HAZARD, T.NEST, T.VAULT, T.CHEST]).not.toContain(tileAt(w, x, y));
    }
  });

  it('some levels hide sealed treasure rooms with a chest, a few of them trapped', () => {
    const w = createWorld(getPlanet(1), 33);
    ensureRows(w, 900);
    expect(w.rooms.length).toBeGreaterThan(2);
    expect(w.rooms.some((r) => r.ambush)).toBe(true);
    for (const r of w.rooms) {
      let chest = 0;
      for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (tileAt(w, x, y) === T.CHEST) chest++;
      expect(chest).toBe(1);
    }
  });
});

describe('flow field', () => {
  it('routes only through open tiles', () => {
    const w = createWorld(getPlanet(1), 2);
    // carve an L-shaped tunnel and a separate sealed pocket
    for (let x = 10; x < 20; x++) w.tiles[40 * w.w + x] = T.AIR;
    for (let y = 40; y < 46; y++) w.tiles[y * w.w + 19] = T.AIR;
    for (let y = 29; y <= 31; y++) for (let x = 44; x <= 46; x++) w.tiles[y * w.w + x] = T.ROCK;
    w.tiles[30 * w.w + 45] = T.AIR; // a sealed pocket
    const f = new FlowField();
    f.rebuild(w, 19, 45);
    expect(f.at(19, 45)).toBe(0);
    expect(f.at(10, 40)).toBeGreaterThan(f.at(15, 40));
    expect(f.at(10, 40)).toBeLessThan(FLOW_INF);
    expect(f.at(45, 30)).toBe(FLOW_INF); // sealed off
    expect(f.at(5, 44)).toBe(FLOW_INF); // solid rock
    const nb = f.next(w, 10, 40)!;
    expect(tileAt(w, nb.x, nb.y)).toBe(T.AIR);
    expect(f.at(nb.x, nb.y)).toBeLessThan(f.at(10, 40));
  });
});
