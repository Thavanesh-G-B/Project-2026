/**
 * Canvas renderer for Core Drill. Reads engine state, never mutates it.
 * Tile art is pre-rendered per planet into small offscreen sprites.
 */
import { PlanetDef, SURFACE_ROW, T, TILE } from './balance';
import type { DrillEngine, Enemy } from './engine';
import { mulberry32, tileAt } from './terrain';

export interface Camera { x: number; y: number; zoom: number }
export interface View { w: number; h: number }

type Sprites = Record<number, HTMLCanvasElement[]>;
const spriteCache = new Map<number, Sprites>();

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  return c;
}

function dirtBase(g: CanvasRenderingContext2D, p: PlanetDef, r: () => number, rock: boolean) {
  const cols = rock ? p.rock : p.dirt;
  const grad = g.createLinearGradient(0, 0, 0, TILE);
  grad.addColorStop(0, cols[0]);
  grad.addColorStop(1, cols[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < (rock ? 10 : 16); i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.18)';
    const s = 1 + Math.floor(r() * 3);
    g.fillRect(Math.floor(r() * TILE), Math.floor(r() * TILE), s, s);
  }
  if (rock) {
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(r() * TILE, r() * TILE);
      g.lineTo(r() * TILE, r() * TILE);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    g.moveTo(2, TILE - 4);
    g.lineTo(TILE * 0.6, 3);
    g.stroke();
  }
  // planet flavour: circuit traces (Mainframe) or ember cracks (Foundry)
  g.lineWidth = 1;
  if (p.id === 1) {
    g.strokeStyle = 'rgba(34,211,238,0.16)';
    g.fillStyle = 'rgba(34,211,238,0.3)';
    if (r() < 0.55) {
      const x = 4 + Math.floor(r() * 20), y = 4 + Math.floor(r() * 20);
      g.beginPath();
      g.moveTo(0, y); g.lineTo(x, y); g.lineTo(x, TILE);
      g.stroke();
      g.fillRect(x - 1, y - 1, 3, 3);
    }
  } else if (p.id === 2) {
    g.strokeStyle = 'rgba(249,115,22,0.28)';
    if (r() < 0.5) {
      g.beginPath();
      let x = r() * TILE, y = 0;
      g.moveTo(x, y);
      for (let i = 0; i < 4; i++) { x += (r() - 0.5) * 12; y += 8; g.lineTo(x, y); }
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(0, 0, TILE, 1);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(0, TILE - 1, TILE, 1);
  g.fillRect(TILE - 1, 0, 1, TILE);
}

function blob(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rnd: () => number, fill: string, hi: string) {
  g.fillStyle = fill;
  g.beginPath();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.7 + rnd() * 0.5);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.fillStyle = hi;
  g.beginPath();
  g.arc(cx - r * 0.3, cy - r * 0.35, r * 0.28, 0, Math.PI * 2);
  g.fill();
}

function shard(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, a: string, b: string) {
  g.fillStyle = a;
  g.beginPath(); g.moveTo(cx, cy - h); g.lineTo(cx + w, cy); g.lineTo(cx, cy + h * 0.5); g.closePath(); g.fill();
  g.fillStyle = b;
  g.beginPath(); g.moveTo(cx, cy - h); g.lineTo(cx - w, cy); g.lineTo(cx, cy + h * 0.5); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillRect(cx - 1, cy - h + 3, 2, 3);
}

function buildSprites(p: PlanetDef): Sprites {
  const out: Sprites = {};
  const add = (t: number, n: number, draw: (g: CanvasRenderingContext2D, r: () => number, v: number) => void) => {
    out[t] = [];
    for (let v = 0; v < n; v++) {
      const c = makeCanvas();
      const g = c.getContext('2d')!;
      draw(g, mulberry32(p.id * 977 + t * 131 + v * 17), v);
      out[t].push(c);
    }
  };
  add(T.DIRT, 5, (g, r) => dirtBase(g, p, r, false));
  add(T.ROCK, 4, (g, r) => dirtBase(g, p, r, true));
  add(T.SCRAP, 4, (g, r) => {
    dirtBase(g, p, r, false);
    for (let i = 0; i < 3; i++) blob(g, 7 + r() * 18, 7 + r() * 18, 4 + r() * 2.5, r, '#eab308', '#fef08a');
  });
  add(T.CRYSTAL, 3, (g, r) => {
    dirtBase(g, p, r, true);
    shard(g, 10 + r() * 3, 18, 5, 10, '#e879f9', '#a21caf');
    shard(g, 21 + r() * 3, 21, 4, 8, '#67e8f9', '#0891b2');
    shard(g, 16, 12, 3, 6, '#f0abfc', '#c026d3');
  });
  add(T.CORE, 2, (g, r) => {
    dirtBase(g, p, r, true);
    const grad = g.createRadialGradient(16, 16, 1, 16, 16, 11);
    grad.addColorStop(0, '#ecfdf5');
    grad.addColorStop(0.4, '#34d399');
    grad.addColorStop(1, 'rgba(16,185,129,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(16, 16, 11, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#6ee7b7'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(16, 16, 7, 0, Math.PI * 2); g.stroke();
  });
  add(T.BEDROCK, 2, (g, r) => {
    g.fillStyle = '#080b14'; g.fillRect(0, 0, TILE, TILE);
    g.strokeStyle = 'rgba(148,163,184,0.12)'; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    g.beginPath(); g.moveTo(0, TILE / 2); g.lineTo(TILE, TILE / 2); g.moveTo(TILE / 2, 0); g.lineTo(TILE / 2, TILE); g.stroke();
    g.fillStyle = 'rgba(148,163,184,0.25)';
    for (const [x, y] of [[4, 4], [TILE - 5, 4], [4, TILE - 5], [TILE - 5, TILE - 5]]) g.fillRect(x, y, 2, 2);
    if (r() < 0.5) { g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(2, 2, TILE - 4, 6); }
  });
  add(T.VAULT, 1, (g) => {
    g.fillStyle = '#1e293b'; g.fillRect(1, 1, TILE - 2, TILE - 2);
    g.strokeStyle = p.primary; g.lineWidth = 2; g.strokeRect(3, 3, TILE - 6, TILE - 6);
    g.fillStyle = '#0f172a'; g.fillRect(8, 8, TILE - 16, TILE - 16);
    g.fillStyle = p.primary;
    g.fillRect(12, 15, 8, 8);
    g.strokeStyle = p.primary; g.lineWidth = 2;
    g.beginPath(); g.arc(16, 15, 4, Math.PI, 0); g.stroke();
    g.fillStyle = '#0f172a'; g.fillRect(15, 18, 2, 3);
  });
  return out;
}

function getSprites(p: PlanetDef): Sprites {
  let s = spriteCache.get(p.id);
  if (!s) { s = buildSprites(p); spriteCache.set(p.id, s); }
  return s;
}

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0);
};

// ----------------------------------------------------------------- scene

const STARS = (() => {
  const r = mulberry32(99);
  return Array.from({ length: 90 }, () => ({ x: r(), y: r(), s: 0.6 + r() * 1.6, p: r() * 6 }));
})();

export function render(
  g: CanvasRenderingContext2D,
  eng: DrillEngine,
  cam: Camera,
  view: View,
  aim: { x: number; y: number } | null,
  t: number,
) {
  g.save();
  g.clearRect(0, 0, view.w, view.h);
  g.fillStyle = '#04060c';
  g.fillRect(0, 0, view.w, view.h);

  g.translate(view.w / 2, view.h / 2);
  g.scale(cam.zoom, cam.zoom);
  g.translate(-cam.x * TILE, -cam.y * TILE);

  const halfW = view.w / 2 / cam.zoom / TILE + 1;
  const halfH = view.h / 2 / cam.zoom / TILE + 1;
  const x0 = Math.floor(cam.x - halfW), x1 = Math.ceil(cam.x + halfW);
  const y0 = Math.floor(cam.y - halfH), y1 = Math.ceil(cam.y + halfH);

  drawSky(g, eng, cam, view, t, x0, x1);
  drawUndergroundBackdrop(g, eng, x0, x1, y0, y1);
  drawTiles(g, eng, x0, x1, y0, y1, t);
  drawPad(g, eng, t);
  if (eng.digTarget) drawDigProgress(g, eng);
  drawBombs(g, eng, t);
  for (const e of eng.enemies) if (e.kind !== 'boss') drawEnemy(g, eng, e, t);
  drawRig(g, eng, aim, t);
  drawDarkness(g, eng, cam, view);
  const boss = eng.boss;
  if (boss) drawBoss(g, eng, boss, t); // bosses glow through the dark
  drawScanner(g, eng, t);
  drawBullets(g, eng);
  drawParticles(g, eng);
  drawFloaters(g, eng);
  if (aim) drawReticle(g, aim, t, eng);
  g.restore();
}

function drawSky(g: CanvasRenderingContext2D, eng: DrillEngine, cam: Camera, view: View, t: number, x0: number, x1: number) {
  const p = eng.planet;
  const top = (cam.y - view.h / 2 / cam.zoom / TILE) * TILE;
  const horizon = SURFACE_ROW * TILE;
  if (top > horizon) return;
  const skyTop = Math.min(top, 0) - 400;
  const grad = g.createLinearGradient(0, 0, 0, horizon);
  grad.addColorStop(0, p.skyTop);
  grad.addColorStop(1, p.skyBottom);
  g.fillStyle = grad;
  g.fillRect(x0 * TILE, skyTop, (x1 - x0) * TILE, horizon - skyTop);

  const camPx = cam.x * TILE;
  // stars (fixed to screen-ish via slight parallax)
  for (const s of STARS) {
    const sx = camPx * 0.96 + (s.x - 0.5) * (view.w / cam.zoom) * 1.6;
    const sy = (s.y * SURFACE_ROW - 2) * TILE;
    g.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(t * 1.3 + s.p));
    g.fillStyle = '#e2e8f0';
    g.fillRect(sx, sy, s.s, s.s);
  }
  g.globalAlpha = 1;

  // ringed moon
  const mx = camPx * 0.9 - 260, my = 2.2 * TILE;
  const mg = g.createRadialGradient(mx - 14, my - 14, 4, mx, my, 54);
  mg.addColorStop(0, p.accent); mg.addColorStop(1, p.skyTop);
  g.fillStyle = mg;
  g.beginPath(); g.arc(mx, my, 50, 0, Math.PI * 2); g.fill();
  g.strokeStyle = p.primary; g.globalAlpha = 0.5; g.lineWidth = 3;
  g.beginPath(); g.ellipse(mx, my, 84, 18, -0.35, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;

  // orbital station drifting across
  const sx = ((t * 6 + 400) % 1400) - 200 + camPx * 0.8 - 300;
  const sy = 1.6 * TILE + Math.sin(t * 0.3) * 4;
  g.fillStyle = '#0f172a'; g.strokeStyle = p.primary; g.lineWidth = 1.5;
  g.fillRect(sx - 36, sy - 4, 72, 8); g.strokeRect(sx - 36, sy - 4, 72, 8);
  g.fillRect(sx - 6, sy - 14, 12, 28); g.strokeRect(sx - 6, sy - 14, 12, 28);
  g.fillStyle = p.primary; g.fillRect(sx - 50, sy - 8, 14, 16); g.fillRect(sx + 36, sy - 8, 14, 16);
  g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 4); g.fillStyle = '#f87171'; g.fillRect(sx - 1, sy - 17, 3, 3); g.globalAlpha = 1;

  // horizon skyline
  const r = mulberry32(p.id * 31);
  const sky = horizon;
  for (let i = -6; i < 40; i++) {
    const w = 40 + r() * 70, h = 30 + r() * 90, off = i * 90 + camPx * 0.6 - 200;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    if (p.id === 2) {
      g.beginPath(); g.moveTo(off, sky); g.lineTo(off + w * 0.5, sky - h); g.lineTo(off + w, sky); g.closePath(); g.fill();
      if (r() < 0.4) { g.fillStyle = 'rgba(249,115,22,0.55)'; g.fillRect(off + w * 0.5 - 3, sky - h, 6, 5); }
    } else {
      g.fillRect(off, sky - h, w, h);
      g.fillStyle = 'rgba(34,211,238,0.45)';
      for (let k = 0; k < 4; k++) if (r() < 0.6) g.fillRect(off + 6 + r() * (w - 14), sky - h + 8 + r() * (h - 14), 3, 3);
    }
  }
  // soft glow at horizon
  const hg = g.createLinearGradient(0, horizon - 80, 0, horizon);
  hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(1, p.primary + '33');
  g.fillStyle = hg; g.fillRect(x0 * TILE, horizon - 80, (x1 - x0) * TILE, 80);
}

function drawUndergroundBackdrop(g: CanvasRenderingContext2D, eng: DrillEngine, x0: number, x1: number, y0: number, y1: number) {
  const ys = Math.max(y0, SURFACE_ROW);
  if (ys >= y1) return;
  const gr = g.createLinearGradient(0, ys * TILE, 0, y1 * TILE);
  gr.addColorStop(0, '#070a14'); gr.addColorStop(1, '#03050b');
  g.fillStyle = gr;
  g.fillRect(x0 * TILE, ys * TILE, (x1 - x0) * TILE, (y1 - ys) * TILE);

  // The boss cavern gets a tinted, gridded backdrop so the fight reads clearly.
  const w = eng.world;
  const bx0 = w.bossLeft * TILE, bx1 = (w.bossRight + 1) * TILE, by0 = w.bossTop * TILE, by1 = (w.h - 1) * TILE;
  if (by1 > ys * TILE && by0 < y1 * TILE) {
    const bg = g.createLinearGradient(0, by0, 0, by1);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, eng.planet.primary + '2e');
    g.fillStyle = bg;
    g.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    g.strokeStyle = eng.planet.primary + '1a';
    g.lineWidth = 1;
    for (let x = bx0; x <= bx1; x += TILE * 2) { g.beginPath(); g.moveTo(x, by0); g.lineTo(x, by1); g.stroke(); }
    for (let y = by0; y <= by1; y += TILE * 2) { g.beginPath(); g.moveTo(bx0, y); g.lineTo(bx1, y); g.stroke(); }
  }
}

function drawTiles(g: CanvasRenderingContext2D, eng: DrillEngine, x0: number, x1: number, y0: number, y1: number, t: number) {
  const sprites = getSprites(eng.planet);
  const p = eng.planet;
  for (let y = Math.max(0, y0); y <= Math.min(eng.world.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(eng.world.w - 1, x1); x++) {
      const tile = tileAt(eng.world, x, y);
      if (tile === T.AIR) continue;
      const px = x * TILE, py = y * TILE;
      const list = sprites[tile];
      if (tile === T.HAZARD) {
        drawHazard(g, p, px, py, t, x, y);
      } else if (tile === T.NEST) {
        g.drawImage(sprites[T.ROCK][0], px, py);
        drawNest(g, p, px, py, t);
      } else if (list) {
        g.drawImage(list[hash(x, y) % list.length], px, py);
      }
      // crust highlight where the tile touches open air
      if (tileAt(eng.world, x, y - 1) === T.AIR && tile !== T.BEDROCK) {
        g.fillStyle = y === SURFACE_ROW ? p.primary + 'aa' : 'rgba(255,255,255,0.08)';
        g.fillRect(px, py, TILE, y === SURFACE_ROW ? 3 : 2);
      }
      if (tile === T.CORE || tile === T.CRYSTAL) {
        g.globalAlpha = 0.18 + 0.14 * Math.sin(t * 3 + x * 1.7 + y);
        g.fillStyle = tile === T.CORE ? '#34d399' : '#e879f9';
        g.beginPath(); g.arc(px + 16, py + 16, 17, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
    }
  }
}

function drawHazard(g: CanvasRenderingContext2D, p: PlanetDef, px: number, py: number, t: number, x: number, y: number) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3 + x * 0.9 + y * 1.3);
  g.fillStyle = p.id === 2 ? '#7c2d12' : '#0c4a6e';
  g.fillRect(px, py, TILE, TILE);
  const grad = g.createRadialGradient(px + 16, py + 16, 2, px + 16, py + 16, 20);
  grad.addColorStop(0, p.hazardColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.45 + 0.4 * pulse;
  g.fillStyle = grad;
  g.fillRect(px, py, TILE, TILE);
  g.globalAlpha = 1;
  g.fillStyle = p.hazardColor;
  for (let i = 0; i < 3; i++) {
    const bx = px + 6 + ((hash(x + i, y) % 20)), by = py + TILE - ((t * 14 + i * 11 + hash(x, y + i)) % TILE);
    g.fillRect(bx, by, 2, 2);
  }
}

function drawNest(g: CanvasRenderingContext2D, p: PlanetDef, px: number, py: number, t: number) {
  const s = 1 + 0.08 * Math.sin(t * 4);
  g.save();
  g.translate(px + 16, py + 16);
  g.scale(s, s);
  const grad = g.createRadialGradient(0, 0, 2, 0, 0, 14);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.35, p.enemyColor); grad.addColorStop(1, 'rgba(0,0,0,0.0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.fill();
  g.strokeStyle = p.enemyColor; g.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + t * 0.4;
    g.beginPath(); g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); g.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); g.stroke();
  }
  g.restore();
}

function drawPad(g: CanvasRenderingContext2D, eng: DrillEngine, t: number) {
  const p = eng.planet;
  const w = eng.world;
  const x0 = w.padX0 * TILE, x1 = (w.padX1 + 1) * TILE, y = SURFACE_ROW * TILE;
  // plate
  g.fillStyle = '#111827'; g.fillRect(x0, y - 6, x1 - x0, 8);
  g.fillStyle = p.primary; g.fillRect(x0, y - 6, x1 - x0, 2);
  for (let x = x0; x < x1; x += 24) {
    g.fillStyle = '#fbbf24'; g.fillRect(x, y - 2, 12, 3);
  }
  // beacon posts
  for (const bx of [x0 + 4, x1 - 8]) {
    g.fillStyle = '#334155'; g.fillRect(bx, y - 26, 4, 20);
    g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 5 + bx); g.fillStyle = '#f87171'; g.fillRect(bx - 1, y - 30, 6, 5); g.globalAlpha = 1;
  }
  // antenna tower + depot
  const ax = x0 - 70;
  g.fillStyle = '#1e293b'; g.fillRect(ax, y - 96, 6, 96);
  g.fillRect(ax - 14, y - 70, 34, 4); g.fillRect(ax - 8, y - 48, 22, 4);
  g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3); g.fillStyle = p.primary; g.fillRect(ax - 2, y - 104, 10, 8); g.globalAlpha = 1;
  const dx = x1 + 40;
  g.fillStyle = '#1e293b'; g.fillRect(dx, y - 54, 90, 54);
  g.strokeStyle = p.primary; g.lineWidth = 2; g.strokeRect(dx, y - 54, 90, 54);
  g.fillStyle = p.primary + '55';
  for (let i = 0; i < 3; i++) g.fillRect(dx + 8 + i * 28, y - 40, 20, 12);
  g.fillStyle = '#0f172a'; g.fillRect(dx + 34, y - 24, 22, 24);
  g.fillStyle = '#334155'; g.fillRect(dx + 100, y - 36, 22, 36);
  g.fillStyle = p.accent; g.fillRect(dx + 100, y - 40, 22, 4);

  // DOCK label
  g.font = '700 12px "Chakra Petch", ui-monospace, monospace';
  g.textAlign = 'center';
  g.fillStyle = p.primary;
  g.globalAlpha = eng.onPad ? 1 : 0.55 + 0.3 * Math.sin(t * 3);
  g.fillText('DOCK  ·  SELL  ·  REFUEL', (x0 + x1) / 2, y - 44);
  g.globalAlpha = 1;
  g.textAlign = 'left';
}

function drawDigProgress(g: CanvasRenderingContext2D, eng: DrillEngine) {
  const d = eng.digTarget!;
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(d.x * TILE + 2, d.y * TILE + TILE - 7, TILE - 4, 5);
  g.fillStyle = '#facc15';
  g.fillRect(d.x * TILE + 2, d.y * TILE + TILE - 7, (TILE - 4) * Math.min(1, eng.digProgress), 5);
  g.strokeStyle = 'rgba(250,204,21,0.8)';
  g.lineWidth = 1.5;
  g.strokeRect(d.x * TILE + 1, d.y * TILE + 1, TILE - 2, TILE - 2);
}

function drawBombs(g: CanvasRenderingContext2D, eng: DrillEngine, t: number) {
  for (const b of eng.bombList) {
    g.fillStyle = '#111827'; g.beginPath(); g.arc(b.x * TILE, b.y * TILE + 4, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fb923c'; g.lineWidth = 2; g.stroke();
    g.fillStyle = Math.floor(t * 12) % 2 ? '#fb923c' : '#fde047';
    g.fillRect(b.x * TILE - 1, b.y * TILE - 6, 3, 4);
  }
}

// ----------------------------------------------------------------- rig

function drawRig(g: CanvasRenderingContext2D, eng: DrillEngine, aim: { x: number; y: number } | null, t: number) {
  const p = eng.planet;
  const cx = eng.x * TILE, cy = eng.y * TILE;
  g.save();
  g.translate(cx, cy);

  // thruster flame
  if (eng.thrusting) {
    const fl = 8 + Math.random() * 7;
    const gr = g.createLinearGradient(0, 10, 0, 10 + fl + 8);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, '#38bdf8'); gr.addColorStop(1, 'rgba(56,189,248,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(-6, 10); g.lineTo(6, 10); g.lineTo(0, 10 + fl + 8); g.closePath(); g.fill();
  }

  // drill bit
  let ang = 0;
  let showDrill = false;
  if (eng.digTarget) {
    const dx = eng.digTarget.x + 0.5 - eng.x, dy = eng.digTarget.y + 0.5 - eng.y;
    ang = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? Math.PI / 2 : -Math.PI / 2) : (dx > 0 ? 0 : Math.PI);
    showDrill = true;
  }
  if (showDrill || eng.digging) {
    g.save();
    g.rotate(ang);
    g.fillStyle = '#9ca3af';
    g.beginPath(); g.moveTo(8, -8); g.lineTo(24, 0); g.lineTo(8, 8); g.closePath(); g.fill();
    g.strokeStyle = '#374151'; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const o = ((t * 40 + i * 5) % 15);
      g.beginPath(); g.moveTo(8 + o * 0.9, -8 + o * 0.5); g.lineTo(8 + o * 0.9, 8 - o * 0.5); g.stroke();
    }
    g.restore();
  }

  // treads
  g.fillStyle = '#0b1220';
  roundRect(g, -13, 5, 26, 8, 4); g.fill();
  g.strokeStyle = '#475569'; g.lineWidth = 1;
  const roll = (eng.x * 14) % 5;
  for (let i = -12; i < 13; i += 5) { g.beginPath(); g.moveTo(i + roll, 6); g.lineTo(i + roll, 12); g.stroke(); }
  // hull
  const hg = g.createLinearGradient(0, -12, 0, 8);
  hg.addColorStop(0, '#94a3b8'); hg.addColorStop(1, '#334155');
  g.fillStyle = hg;
  roundRect(g, -12, -9, 24, 17, 5); g.fill();
  g.strokeStyle = p.primary; g.lineWidth = 1.5; g.stroke();
  // cockpit
  g.fillStyle = 'rgba(103,232,249,0.9)';
  g.beginPath(); g.ellipse(eng.facing * 2, -6, 7, 5, 0, Math.PI, 0); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(eng.facing * 2 - 3, -9, 3, 2);

  // blaster toward aim
  let ba = eng.facing > 0 ? 0 : Math.PI;
  if (aim) ba = Math.atan2(aim.y - (eng.y - 0.1), aim.x - eng.x);
  g.save();
  g.translate(0, -4);
  g.rotate(ba);
  g.fillStyle = '#1f2937'; g.fillRect(2, -2.5, 16, 5);
  g.fillStyle = p.primary; g.fillRect(14, -2.5, 4, 5);
  if (eng.fireCd > 0.6 / eng.stats.blasterRate) { g.fillStyle = '#fff'; g.beginPath(); g.arc(21, 0, 4, 0, Math.PI * 2); g.fill(); }
  g.restore();

  // shield bubble
  if (eng.shield > 0) {
    const recent = eng.shieldDelay > 3.6;
    g.globalAlpha = recent ? 0.55 : 0.12 + 0.05 * Math.sin(t * 3);
    g.strokeStyle = '#7dd3fc'; g.lineWidth = recent ? 2.5 : 1.5;
    g.beginPath(); g.arc(0, 0, 21, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  if (eng.hurtFlash > 0) {
    g.globalAlpha = Math.min(0.7, eng.hurtFlash * 3);
    g.fillStyle = '#fca5a5';
    roundRect(g, -12, -9, 24, 17, 5); g.fill();
    g.globalAlpha = 1;
  }
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ----------------------------------------------------------------- enemies

function drawEnemy(g: CanvasRenderingContext2D, eng: DrillEngine, e: Enemy, t: number) {
  const p = eng.planet;
  const cx = e.x * TILE, cy = e.y * TILE;
  const dir = eng.x >= e.x ? 1 : -1;
  g.save();
  g.translate(cx, cy);
  if (e.flash > 0) g.globalAlpha = 0.65;
  if (e.kind === 'crawler') {
    g.scale(dir, 1);
    g.strokeStyle = p.enemyColor; g.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      const w = Math.sin(e.phase * 12 + i * 2) * 3;
      g.beginPath(); g.moveTo(i * 5, 2); g.lineTo(i * 5 - 4, 9 + w); g.moveTo(i * 5, 2); g.lineTo(i * 5 + 4, 9 - w); g.stroke();
    }
    for (let i = 2; i >= 0; i--) {
      const sw = Math.sin(e.phase * 8 - i) * 1.5;
      g.fillStyle = i === 0 ? p.enemyColor : '#0f172a';
      g.strokeStyle = p.enemyColor; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(-i * 6, sw, 6 - i * 0.7, 5 - i * 0.6, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = '#fff'; g.fillRect(2, -3, 3, 3);
    g.fillStyle = '#ef4444'; g.fillRect(3, -2, 2, 2);
  } else if (e.kind === 'spitter') {
    const charge = e.shootT < 0.5;
    const bob = Math.sin(e.phase * 3) * 2;
    g.translate(0, bob);
    g.strokeStyle = p.enemyColor; g.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      g.beginPath(); g.moveTo(i * 4, 6); g.quadraticCurveTo(i * 5 + Math.sin(e.phase * 5 + i) * 3, 12, i * 4, 16); g.stroke();
    }
    const gr = g.createRadialGradient(0, 0, 2, 0, 0, 12);
    gr.addColorStop(0, charge ? '#fff' : p.hazardColor); gr.addColorStop(1, p.enemyColor + '33');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.fill();
    g.strokeStyle = p.enemyColor; g.stroke();
    g.fillStyle = '#0f172a'; g.beginPath(); g.arc(dir * 3, -1, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = charge ? '#fef08a' : '#ef4444'; g.beginPath(); g.arc(dir * 4, -1, 2, 0, Math.PI * 2); g.fill();
  } else if (e.kind === 'raider') {
    g.rotate(Math.max(-0.4, Math.min(0.4, e.vx * 0.08)));
    g.fillStyle = '#0f172a'; g.strokeStyle = '#f87171'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(0, 2, 15, 6, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = 'rgba(248,113,113,0.75)';
    g.beginPath(); g.ellipse(0, -1, 7, 6, 0, Math.PI, 0); g.fill();
    for (let i = -1; i <= 1; i++) {
      g.globalAlpha = 0.4 + 0.6 * ((Math.floor(t * 6) + i) % 2 === 0 ? 1 : 0);
      g.fillStyle = '#fca5a5'; g.fillRect(i * 8 - 1, 3, 3, 3);
    }
    g.globalAlpha = 1;
    const fl = g.createLinearGradient(0, 8, 0, 18);
    fl.addColorStop(0, 'rgba(251,146,60,0.9)'); fl.addColorStop(1, 'rgba(251,146,60,0)');
    g.fillStyle = fl; g.fillRect(-3, 8, 6, 10);
  }
  g.restore();
  g.globalAlpha = 1;
  if (e.hp < e.maxHp) {
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(cx - 12, cy - 20, 24, 3);
    g.fillStyle = '#f87171'; g.fillRect(cx - 12, cy - 20, 24 * Math.max(0, e.hp / e.maxHp), 3);
  }
}

function drawBoss(g: CanvasRenderingContext2D, eng: DrillEngine, e: Enemy, t: number) {
  const p = eng.planet;
  const cx = e.x * TILE, cy = e.y * TILE;
  const R = e.radius * TILE;
  const hot = e.dashState === 'telegraph';
  g.save();
  g.translate(cx, cy);
  if (e.flash > 0) g.globalAlpha = 0.75;

  if (hot) {
    g.strokeStyle = 'rgba(248,113,113,0.7)'; g.lineWidth = 2; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(e.dashTx * TILE - cx, e.dashTy * TILE - cy); g.stroke(); g.setLineDash([]);
  }
  // aura
  const au = g.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 2);
  au.addColorStop(0, (hot ? '#f87171' : p.enemyColor) + '55'); au.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = au; g.beginPath(); g.arc(0, 0, R * 2, 0, Math.PI * 2); g.fill();

  // orbiting armour plates
  const plates = 6;
  for (let i = 0; i < plates; i++) {
    const a = e.phase * (p.id === 2 ? 1.2 : 0.8) + (i / plates) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.translate(R * 1.25, 0);
    g.fillStyle = '#0f172a'; g.strokeStyle = hot ? '#f87171' : p.enemyColor; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-8, -10); g.lineTo(10, -6); g.lineTo(10, 6); g.lineTo(-8, 10); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  // body
  g.fillStyle = '#0b1220'; g.strokeStyle = hot ? '#f87171' : p.enemyColor; g.lineWidth = 3;
  g.beginPath();
  if (p.id === 2) g.arc(0, 0, R, 0, Math.PI * 2);
  else for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; const x = Math.cos(a) * R, y = Math.sin(a) * R; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.closePath(); g.fill(); g.stroke();
  if (p.id === 2) {
    g.strokeStyle = p.hazardColor; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + e.phase * 0.2;
      g.beginPath(); g.moveTo(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3); g.lineTo(Math.cos(a + 0.3) * R * 0.95, Math.sin(a + 0.3) * R * 0.95); g.stroke();
    }
  } else {
    g.strokeStyle = p.enemyColor + '88'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, R * 0.7, 0, Math.PI * 2); g.stroke();
  }
  // eye tracks the rig
  const ea = Math.atan2(eng.y - e.y, eng.x - e.x);
  const pulse = 1 + 0.12 * Math.sin(t * 6);
  const eg = g.createRadialGradient(Math.cos(ea) * 5, Math.sin(ea) * 5, 1, 0, 0, R * 0.5 * pulse);
  eg.addColorStop(0, '#fff'); eg.addColorStop(0.4, hot ? '#ef4444' : p.hazardColor); eg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = eg; g.beginPath(); g.arc(0, 0, R * 0.5 * pulse, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0b1220'; g.beginPath(); g.arc(Math.cos(ea) * 7, Math.sin(ea) * 7, 5, 0, Math.PI * 2); g.fill();
  g.restore();
  g.globalAlpha = 1;
}

// ----------------------------------------------------------------- effects

function drawDarkness(g: CanvasRenderingContext2D, eng: DrillEngine, cam: Camera, view: View) {
  const depthFrac = Math.max(0, Math.min(1, (eng.y - SURFACE_ROW) / eng.planet.depthRows));
  const underground = eng.y > SURFACE_ROW - 0.5;
  const a = underground ? Math.min(0.82, 0.18 + 0.64 * Math.pow(depthFrac, 0.8)) * (eng.inBossRoom ? 0.3 : 1) : 0;
  if (a <= 0.01) return;
  const sx = (eng.x - cam.x) * TILE * cam.zoom + view.w / 2;
  const sy = (eng.y - cam.y) * TILE * cam.zoom + view.h / 2;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const R = 8.5 * TILE * cam.zoom;
  const gr = g.createRadialGradient(sx, sy, R * 0.18, sx, sy, R);
  gr.addColorStop(0, 'rgba(2,4,10,0)');
  gr.addColorStop(1, `rgba(2,4,10,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, view.w, view.h);
  g.restore();
}

function drawScanner(g: CanvasRenderingContext2D, eng: DrillEngine, t: number) {
  if (!eng.stats.scanner) return;
  const R = 10;
  const bx = Math.floor(eng.x), by = Math.floor(eng.y);
  for (let y = by - R; y <= by + R; y++) {
    for (let x = bx - R; x <= bx + R; x++) {
      const tile = tileAt(eng.world, x, y);
      if (tile !== T.SCRAP && tile !== T.CRYSTAL && tile !== T.CORE && tile !== T.VAULT) continue;
      if (Math.hypot(x + 0.5 - eng.x, y + 0.5 - eng.y) > R) continue;
      const col = tile === T.CORE ? '#34d399' : tile === T.CRYSTAL ? '#e879f9' : tile === T.VAULT ? '#38bdf8' : '#facc15';
      g.globalAlpha = 0.35 + 0.35 * Math.sin(t * 4 + x + y);
      g.strokeStyle = col; g.lineWidth = 1.5;
      g.strokeRect(x * TILE + 4, y * TILE + 4, TILE - 8, TILE - 8);
    }
  }
  g.globalAlpha = 1;
}

function drawBullets(g: CanvasRenderingContext2D, eng: DrillEngine) {
  for (const b of eng.bullets) {
    const px = b.x * TILE, py = b.y * TILE;
    const gr = g.createRadialGradient(px, py, 0, px, py, b.r * TILE * 3);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, b.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(px, py, b.r * TILE * 3, 0, Math.PI * 2); g.fill();
    if (b.fromPlayer) {
      g.strokeStyle = b.color; g.lineWidth = 2; g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px - b.vx * 0.012 * TILE, py - b.vy * 0.012 * TILE); g.stroke();
      g.globalAlpha = 1;
    }
  }
}

function drawParticles(g: CanvasRenderingContext2D, eng: DrillEngine) {
  for (const p of eng.particles) {
    g.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
    g.fillStyle = p.color;
    g.fillRect(p.x * TILE, p.y * TILE, p.size * TILE, p.size * TILE);
  }
  g.globalAlpha = 1;
}

function drawFloaters(g: CanvasRenderingContext2D, eng: DrillEngine) {
  g.textAlign = 'center';
  for (const f of eng.floaters) {
    g.globalAlpha = Math.min(1, f.life * 2);
    g.font = `${f.big ? 700 : 600} ${f.big ? 15 : 12}px "Chakra Petch", ui-monospace, monospace`;
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(f.text, f.x * TILE, f.y * TILE);
    g.fillStyle = f.color;
    g.fillText(f.text, f.x * TILE, f.y * TILE);
  }
  g.globalAlpha = 1;
  g.textAlign = 'left';
}

function drawReticle(g: CanvasRenderingContext2D, aim: { x: number; y: number }, t: number, eng: DrillEngine) {
  const x = aim.x * TILE, y = aim.y * TILE;
  const ready = eng.energy >= 5;
  g.strokeStyle = ready ? '#67e8f9' : '#f87171';
  g.lineWidth = 1.5;
  g.globalAlpha = 0.85;
  g.beginPath(); g.arc(x, y, 8 + Math.sin(t * 6), 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(x - 13, y); g.lineTo(x - 5, y); g.moveTo(x + 5, y); g.lineTo(x + 13, y);
  g.moveTo(x, y - 13); g.lineTo(x, y - 5); g.moveTo(x, y + 5); g.lineTo(x, y + 13); g.stroke();
  g.globalAlpha = 1;
}
