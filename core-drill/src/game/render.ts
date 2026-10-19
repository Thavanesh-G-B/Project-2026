/**
 * Canvas renderer for Core Drill. Reads engine state, never mutates it.
 *
 * Draw order: sky and surface ruins -> back walls -> tiles and mine decoration -> actors ->
 * a fog-of-war layer (only what your lamp, mine lamps and glowing things reach is visible) ->
 * glowing effects, scanner outlines, floating text and the survey minimap.
 */
import { B, D, SURFACE_ROW, T, TILE } from './balance';
import { drawBoss, drawBoulder, drawEnemy, drawItem, drawRig } from './actors';
import type { DrillEngine } from './engine';
import { decorLight, drawDecor, drawHazard, drawNest, getSprites, hash } from './sprites';
import { backAt, decorAt, mulberry32, tileAt } from './terrain';

export interface Camera { x: number; y: number; zoom: number }
export interface View { w: number; h: number }

const STARS = (() => {
  const r = mulberry32(99);
  return Array.from({ length: 90 }, () => ({ x: r(), y: r(), s: 0.6 + r() * 1.6, p: r() * 6 }));
})();

let fogCanvas: HTMLCanvasElement | null = null;

export function render(
  g: CanvasRenderingContext2D,
  eng: DrillEngine,
  cam: Camera,
  view: View,
  aim: { x: number; y: number } | null,
  t: number,
) {
  const dprX = g.canvas.width / view.w;
  g.save();
  g.setTransform(dprX, 0, 0, dprX, 0, 0);
  g.fillStyle = '#04060c';
  g.fillRect(0, 0, view.w, view.h);

  const sh = eng.shake * 7;
  const shx = sh ? (Math.random() - 0.5) * sh : 0, shy = sh ? (Math.random() - 0.5) * sh : 0;
  g.translate(view.w / 2 + shx, view.h / 2 + shy);
  g.scale(cam.zoom, cam.zoom);
  g.translate(-cam.x * TILE, -cam.y * TILE);

  const halfW = view.w / 2 / cam.zoom / TILE + 1.5;
  const halfH = view.h / 2 / cam.zoom / TILE + 1.5;
  const x0 = Math.floor(cam.x - halfW), x1 = Math.ceil(cam.x + halfW);
  const y0 = Math.floor(cam.y - halfH), y1 = Math.ceil(cam.y + halfH);

  drawSky(g, eng, cam, view, t, x0, x1);
  drawSurfaceRuins(g, eng, t);
  drawWorld(g, eng, x0, x1, y0, y1, t);
  drawPad(g, eng, t);
  drawStationLabels(g, eng, t);

  for (const w of eng.warnings) {
    g.fillStyle = `rgba(224,242,254,${0.3 + 0.4 * Math.sin(t * 30)})`;
    g.fillRect(w.x * TILE - 6, w.y * TILE, 12, 5);
    g.strokeStyle = 'rgba(224,242,254,0.25)'; g.setLineDash([3, 5]); g.beginPath(); g.moveTo(w.x * TILE, w.y * TILE); g.lineTo(w.x * TILE, (w.y + 14) * TILE); g.stroke(); g.setLineDash([]);
  }
  if (eng.digTarget) drawDigProgress(g, eng);
  for (const b of eng.boulders) drawBoulder(g, b, t);
  for (const it of eng.items) drawItem(g, it, t);
  drawBombs(g, eng, t);
  for (const e of eng.enemies) if (e.kind !== 'boss') drawEnemy(g, eng, e, t);
  drawRig(g, eng, aim, t);

  drawFog(g, eng, cam, view, dprX, t, shx, shy, x0, x1, y0, y1);

  // things that glow through the dark
  const boss = eng.boss;
  if (boss && eng.inBossRoom) drawBoss(g, eng, boss, t);
  for (const b of eng.beams) drawBeam(g, b, t);
  drawScanner(g, eng, t);
  drawBullets(g, eng);
  drawParticles(g, eng);
  drawFloaters(g, eng);
  if (aim) drawReticle(g, aim, t, eng);
  g.restore();

  // screen-space overlays
  g.save();
  g.setTransform(dprX, 0, 0, dprX, 0, 0);
  drawMinimap(g, eng, view, t);
  g.restore();
}

// ----------------------------------------------------------------- sky & surface

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
  for (const s of STARS) {
    const sx = camPx * 0.96 + (s.x - 0.5) * (view.w / cam.zoom) * 1.6;
    const sy = (s.y * SURFACE_ROW - 2) * TILE;
    g.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(t * 1.3 + s.p));
    g.fillStyle = '#e2e8f0';
    g.fillRect(sx, sy, s.s, s.s);
  }
  g.globalAlpha = 1;

  const mx = camPx * 0.9 + 220, my = 2.6 * TILE;
  const mg = g.createRadialGradient(mx - 14, my - 14, 4, mx, my, 54);
  mg.addColorStop(0, p.accent); mg.addColorStop(1, p.skyTop);
  g.fillStyle = mg;
  g.beginPath(); g.arc(mx, my, 50, 0, Math.PI * 2); g.fill();
  g.strokeStyle = p.primary; g.globalAlpha = 0.5; g.lineWidth = 3;
  g.beginPath(); g.ellipse(mx, my, 84, 18, -0.35, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;

  // a derelict orbital station drifting by, one solar wing torn off
  const sx = ((t * 6 + 400) % 1400) - 200 + camPx * 0.8 - 300;
  const sy = 1.9 * TILE + Math.sin(t * 0.3) * 4;
  g.fillStyle = '#0f172a'; g.strokeStyle = p.primary; g.lineWidth = 1.5;
  g.fillRect(sx - 36, sy - 4, 72, 8); g.strokeRect(sx - 36, sy - 4, 72, 8);
  g.fillRect(sx - 6, sy - 14, 12, 28); g.strokeRect(sx - 6, sy - 14, 12, 28);
  g.fillStyle = p.primary; g.globalAlpha = 0.75; g.fillRect(sx - 50, sy - 8, 14, 16); g.globalAlpha = 1;
  g.strokeStyle = p.primary; g.beginPath(); g.moveTo(sx + 36, sy); g.lineTo(sx + 44, sy - 6); g.lineTo(sx + 52, sy + 1); g.stroke();
  g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 4); g.fillStyle = '#f87171'; g.fillRect(sx - 1, sy - 17, 3, 3); g.globalAlpha = 1;

  // distant ruined skyline
  const r = mulberry32(p.id * 31);
  for (let i = -6; i < 40; i++) {
    const w = 40 + r() * 70, h = 30 + r() * 90, off = i * 90 + camPx * 0.6 - 200;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    if (p.id === 2 || p.id === 4) {
      g.beginPath(); g.moveTo(off, horizon); g.lineTo(off + w * 0.5, horizon - h); g.lineTo(off + w, horizon); g.closePath(); g.fill();
    } else {
      g.fillRect(off, horizon - h, w, h);
      if (r() < 0.5) { g.fillRect(off + w * 0.2, horizon - h - 12, 3, 12); }
      g.fillStyle = `${p.primary}55`;
      for (let k = 0; k < 4; k++) if (r() < 0.45) g.fillRect(off + 6 + r() * (w - 14), horizon - h + 8 + r() * (h - 14), 3, 3);
    }
  }
  const hg = g.createLinearGradient(0, horizon - 80, 0, horizon);
  hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(1, `${p.primary}33`);
  g.fillStyle = hg; g.fillRect(x0 * TILE, horizon - 80, (x1 - x0) * TILE, 80);
}

/** Headframe, boarded portal, rusted tanks: the dead surface works around the landing pad. */
function drawSurfaceRuins(g: CanvasRenderingContext2D, eng: DrillEngine, t: number) {
  const p = eng.planet;
  const w = eng.world;
  const y = SURFACE_ROW * TILE;
  const hx = (w.padX0 - 11) * TILE;
  // headframe tower
  g.strokeStyle = '#2b3340'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(hx, y); g.lineTo(hx + 36, y - 170); g.moveTo(hx + 96, y); g.lineTo(hx + 60, y - 170); g.stroke();
  g.lineWidth = 2.4; g.strokeStyle = '#3b4352';
  for (let k = 0; k < 6; k++) {
    const yy = y - 20 - k * 25;
    const lx = hx + 36 * (1 - (y - yy) / 170) * 0 + (y - yy) * 0.21, rx = hx + 96 - (y - yy) * 0.21;
    g.beginPath(); g.moveTo(lx, yy); g.lineTo(rx, yy); g.moveTo(lx, yy); g.lineTo(rx, yy - 25); g.stroke();
  }
  g.fillStyle = '#1f2937'; g.strokeStyle = '#4b5563'; g.lineWidth = 3;
  g.beginPath(); g.arc(hx + 48, y - 176, 20, 0, 7); g.fill(); g.stroke();
  g.lineWidth = 2; for (let i = 0; i < 6; i++) { const a = i * 1.047; g.beginPath(); g.moveTo(hx + 48, y - 176); g.lineTo(hx + 48 + Math.cos(a) * 20, y - 176 + Math.sin(a) * 20); g.stroke(); }
  g.strokeStyle = '#111827'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(hx + 28, y - 170); g.quadraticCurveTo(hx + 20, y - 80, hx + 30, y - 6); g.stroke(); // frayed cable
  g.fillStyle = Math.floor(t * 1.4) % 3 ? '#7f1d1d' : '#f87171'; g.fillRect(hx + 44, y - 206, 8, 8);

  // boarded portal into the old workings
  const px = (w.padX0 - 5) * TILE;
  g.fillStyle = '#0a0d14'; g.fillRect(px, y - 74, 66, 74);
  g.fillStyle = '#6f4f2e'; g.fillRect(px - 8, y - 82, 10, 82); g.fillRect(px + 64, y - 82, 10, 82); g.fillRect(px - 8, y - 88, 82, 10);
  g.strokeStyle = '#2b2118'; g.lineWidth = 1; g.strokeRect(px - 8, y - 88, 82, 88);
  g.fillStyle = '#8a6238';
  for (const [by, rot] of [[-62, -0.1], [-44, 0.08], [-26, -0.05]] as Array<[number, number]>) { g.save(); g.translate(px + 33, y + by); g.rotate(rot); g.fillRect(-34, -4, 68, 8); g.strokeStyle = '#2b2118'; g.strokeRect(-34, -4, 68, 8); g.restore(); }
  g.fillStyle = '#d4a017'; g.font = '700 9px "Chakra Petch", monospace'; g.textAlign = 'center'; g.fillText('KEEP OUT', px + 33, y - 94); g.textAlign = 'left';

  // right of the pad: collapsed depot with a rusted tank
  const dx = (w.padX1 + 5) * TILE;
  g.fillStyle = '#1b212c'; g.fillRect(dx, y - 54, 92, 54);
  g.strokeStyle = '#374151'; g.lineWidth = 2; g.strokeRect(dx, y - 54, 92, 54);
  g.fillStyle = '#0a0d14'; g.beginPath(); g.moveTo(dx - 6, y - 54); g.lineTo(dx + 30, y - 76); g.lineTo(dx + 56, y - 60); g.lineTo(dx + 98, y - 54); g.closePath(); g.fill(); // sagging roof
  g.strokeStyle = '#4b3520'; g.stroke();
  g.fillStyle = `${p.primary}22`; for (let i = 0; i < 3; i++) g.fillRect(dx + 8 + i * 28, y - 40, 20, 12);
  g.strokeStyle = '#6f4f2e'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(dx + 8 + i * 28, y - 40); g.lineTo(dx + 28 + i * 28, y - 28); g.stroke(); }
  g.fillStyle = '#0f172a'; g.fillRect(dx + 34, y - 24, 22, 24);
  const tg = g.createLinearGradient(dx + 104, 0, dx + 134, 0); tg.addColorStop(0, '#6b3f27'); tg.addColorStop(1, '#3b2415');
  g.fillStyle = tg; g.fillRect(dx + 104, y - 48, 32, 48); g.fillStyle = '#4b5563'; g.fillRect(dx + 104, y - 38, 32, 3); g.fillRect(dx + 104, y - 14, 32, 3);

  // fence and rails leading to the portal
  g.strokeStyle = '#374151'; g.lineWidth = 1.5;
  for (let fx = (w.padX1 + 18) * TILE; fx < (w.padX1 + 26) * TILE; fx += 24) { g.beginPath(); g.moveTo(fx, y); g.lineTo(fx, y - 20); g.stroke(); }
  g.beginPath(); g.moveTo((w.padX1 + 18) * TILE, y - 16); g.lineTo((w.padX1 + 26) * TILE, y - 14); g.stroke();
  g.fillStyle = '#7b8494'; g.fillRect((w.padX0 - 5) * TILE - 120, y - 3, 120, 2);
}

// ----------------------------------------------------------------- world

function drawWorld(g: CanvasRenderingContext2D, eng: DrillEngine, x0: number, x1: number, y0: number, y1: number, t: number) {
  const p = eng.planet;
  const world = eng.world;
  const sp = getSprites(p);
  const ys = Math.max(0, y0), ye = Math.min(world.h - 1, y1);

  // back walls first, so open tiles read as tunnels instead of black holes
  for (let y = Math.max(ys, SURFACE_ROW); y <= ye; y++) {
    for (let x = Math.max(0, x0); x <= Math.min(world.w - 1, x1); x++) {
      if (tileAt(world, x, y) !== T.AIR) continue;
      const bk = backAt(world, x, y) || B.CAVE;
      const list = sp.back[bk];
      g.drawImage(list[hash(x, y) % list.length], x * TILE, y * TILE, TILE, TILE);
    }
  }
  for (let y = ys; y <= ye; y++) {
    for (let x = Math.max(0, x0); x <= Math.min(world.w - 1, x1); x++) {
      const tile = tileAt(world, x, y);
      const px = x * TILE, py = y * TILE;
      if (tile !== T.AIR) {
        if (tile === T.HAZARD) drawHazard(g, p, px, py, t, x, y);
        else if (tile === T.NEST) drawNest(g, p, px, py, t, sp.tiles[T.ROCK][0]);
        else if (tile === T.MIMIC) g.drawImage(sp.tiles[T.CRATE][hash(x, y) % sp.tiles[T.CRATE].length], px, py, TILE, TILE);
        else {
          const list = sp.tiles[tile];
          if (list) g.drawImage(list[hash(x, y) % list.length], px, py, TILE, TILE);
        }
        if (tileAt(world, x, y - 1) === T.AIR && tile !== T.BEDROCK && y > SURFACE_ROW) {
          g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(px, py, TILE, 2);
        } else if (y === SURFACE_ROW && tile !== T.BEDROCK) {
          g.fillStyle = `${p.primary}aa`; g.fillRect(px, py, TILE, 3);
        }
        if (tile === T.CORE || tile === T.CRYSTAL || tile === T.CHEST) {
          g.globalAlpha = 0.16 + 0.12 * Math.sin(t * 3 + x * 1.7 + y);
          g.fillStyle = tile === T.CORE ? '#34d399' : tile === T.CRYSTAL ? '#e879f9' : '#fde047';
          g.beginPath(); g.arc(px + 16, py + 16, 17, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
        }
      } else {
        const d = decorAt(world, x, y);
        if (d !== D.NONE) drawDecor(g, d, px, py, t, x, y, p);
      }
    }
  }
}

function drawPad(g: CanvasRenderingContext2D, eng: DrillEngine, t: number) {
  const p = eng.planet;
  const w = eng.world;
  const x0 = w.padX0 * TILE, x1 = (w.padX1 + 1) * TILE, y = SURFACE_ROW * TILE;
  g.fillStyle = '#111827'; g.fillRect(x0, y - 6, x1 - x0, 8);
  g.fillStyle = p.primary; g.fillRect(x0, y - 6, x1 - x0, 2);
  for (let x = x0; x < x1; x += 24) { g.fillStyle = '#fbbf24'; g.fillRect(x, y - 2, 12, 3); }
  for (const bx of [x0 + 4, x1 - 8]) {
    g.fillStyle = '#334155'; g.fillRect(bx, y - 26, 4, 20);
    g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 5 + bx); g.fillStyle = '#f87171'; g.fillRect(bx - 1, y - 30, 6, 5); g.globalAlpha = 1;
  }
  // pad turret
  if (eng.stats.turretLevel > 0) {
    const tx = (x0 + x1) / 2, ty = y - 8;
    g.fillStyle = '#1f2937'; rrectPath(g, tx - 12, ty - 7, 24, 9, 3); g.fill();
    g.strokeStyle = p.primary; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#374151'; g.beginPath(); g.arc(tx, ty - 8, 8, Math.PI, 0); g.fill(); g.stroke();
    g.save(); g.translate(tx, ty - 10); g.rotate(eng.turretAngle);
    g.fillStyle = '#111827'; g.fillRect(2, -2.2, 14 + eng.stats.turretLevel, 4.4);
    g.fillStyle = p.primary; g.fillRect(12 + eng.stats.turretLevel, -2.2, 4, 4.4);
    g.restore();
    g.fillStyle = '#34d399'; g.fillRect(tx - 1, ty - 9, 2, 2);
  }
  g.font = '700 12px "Chakra Petch", ui-monospace, monospace';
  g.textAlign = 'center';
  g.fillStyle = p.primary;
  g.globalAlpha = eng.onPad ? 1 : 0.55 + 0.3 * Math.sin(t * 3);
  g.fillText('DOCK  ·  SELL  ·  REFUEL', (x0 + x1) / 2, y - 44);
  g.globalAlpha = 1;
  g.textAlign = 'left';
}

function rrectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawStationLabels(g: CanvasRenderingContext2D, eng: DrillEngine, t: number) {
  g.font = '700 10px "Chakra Petch", ui-monospace, monospace';
  g.textAlign = 'center';
  for (const r of eng.world.relays) {
    if (Math.abs(r.y - eng.y) > 14) continue;
    g.fillStyle = r.used ? '#64748b' : '#38bdf8';
    g.fillText(r.used ? 'RELAY (spent)' : 'RELAY · REFUEL', r.x * TILE, (r.y - 1.3) * TILE);
  }
  for (const m of eng.world.merchants) {
    if (Math.abs(m.y - eng.y) > 14) continue;
    g.fillStyle = '#fbbf24';
    g.fillText(eng.nearMerchant && Math.hypot(m.x - eng.x, m.y - eng.y) < 1.7 ? '[E] TRADE' : 'DERELICT TRADER', m.x * TILE, (m.y - 1.2) * TILE + Math.sin(t * 3) * 1);
  }
  g.textAlign = 'left';
}

function drawDigProgress(g: CanvasRenderingContext2D, eng: DrillEngine) {
  const d = eng.digTarget!;
  g.fillStyle = 'rgba(0,0,0,0.55)';
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

// ----------------------------------------------------------------- fog of war

function drawFog(
  g: CanvasRenderingContext2D, eng: DrillEngine, cam: Camera, view: View, dpr: number, t: number,
  shx: number, shy: number, x0: number, x1: number, y0: number, y1: number,
) {
  // fade the dark in as the rig drops below the surface line
  const k = Math.max(0, Math.min(1, (eng.y - SURFACE_ROW + 1.5) / 5));
  if (k <= 0.01) return;
  if (!fogCanvas) fogCanvas = document.createElement('canvas');
  const fc = fogCanvas;
  if (fc.width !== g.canvas.width || fc.height !== g.canvas.height) { fc.width = g.canvas.width; fc.height = g.canvas.height; }
  const f = fc.getContext('2d')!;
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, fc.width, fc.height);
  f.fillStyle = `rgba(2,3,8,${0.985 * k})`;
  f.fillRect(0, 0, fc.width, fc.height);

  f.globalCompositeOperation = 'destination-out';
  f.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (view.w / 2 + shx), dpr * (view.h / 2 + shy));
  f.translate(-cam.x * TILE, -cam.y * TILE);

  const light = (wx: number, wy: number, r: number, strength = 1) => {
    const gr = f.createRadialGradient(wx, wy, 0, wx, wy, r);
    gr.addColorStop(0, `rgba(0,0,0,${strength})`);
    gr.addColorStop(0.5, `rgba(0,0,0,${strength * 0.85})`);
    gr.addColorStop(0.8, `rgba(0,0,0,${strength * 0.35})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = gr;
    f.beginPath(); f.arc(wx, wy, r, 0, Math.PI * 2); f.fill();
  };

  // daylight above ground
  f.fillStyle = '#000'; f.fillRect((x0 - 2) * TILE, (y0 - 40) * TILE, (x1 - x0 + 4) * TILE, (SURFACE_ROW - y0 + 40) * TILE);
  // the rig's headlamp, flickering a little
  const flick = 1 + 0.02 * Math.sin(t * 23) + (eng.surgeLeft > 0 ? 0.08 * Math.sin(t * 41) : 0);
  light(eng.x * TILE, eng.y * TILE, eng.lightR * TILE * flick);

  const world = eng.world;
  for (let y = Math.max(0, y0); y <= Math.min(world.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(world.w - 1, x1); x++) {
      const d = decorAt(world, x, y);
      if (d !== D.NONE) {
        let r = decorLight(d, x, y, t);
        if (eng.surgeLeft > 0 && d === D.LAMP) r *= Math.sin(t * 29 + x) > 0.2 ? 0.5 : 0.1;
        if (r > 0) light((x + 0.5) * TILE, (y + 0.5) * TILE, r * TILE, 0.95);
      }
      const tile = tileAt(world, x, y);
      if (tile === T.CORE) light((x + 0.5) * TILE, (y + 0.5) * TILE, 1.8 * TILE, 0.8);
      else if (tile === T.CRYSTAL || tile === T.NEST || tile === T.HAZARD || tile === T.CHEST) light((x + 0.5) * TILE, (y + 0.5) * TILE, 1.5 * TILE, 0.75);
    }
  }
  for (const b of eng.bullets) light(b.x * TILE, b.y * TILE, (b.mine ? 1.4 : 1.6) * TILE, 0.7);
  for (const b of eng.bombList) light(b.x * TILE, b.y * TILE, 2.5 * TILE, 0.7);
  for (const it of eng.items) light(it.x * TILE, it.y * TILE, 1.5 * TILE, 0.8);
  for (const e of eng.enemies) {
    if (e.kind === 'phantom') light(e.x * TILE, e.y * TILE, 2.2 * TILE, 0.5 * e.alpha);
    else if (e.kind === 'worm' && e.state !== 'emerge') light(e.x * TILE, e.y * TILE, 2.2 * TILE, 0.6);
    else if (e.kind === 'boss') light(e.x * TILE, e.y * TILE, 7 * TILE, 0.9);
    else if (e.kind === 'drone' || e.kind === 'sentry') light(e.x * TILE, e.y * TILE, 1.3 * TILE, 0.5);
  }
  if (eng.hurtFlash > 0.15) light(eng.x * TILE, eng.y * TILE, 5 * TILE, 0.35);
  for (const p of eng.particles) if (p.size > 0.15) light(p.x * TILE, p.y * TILE, 1.2 * TILE, 0.4);

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(fc, 0, 0);
  g.restore();
}

// ----------------------------------------------------------------- effects

function drawScanner(g: CanvasRenderingContext2D, eng: DrillEngine, t: number) {
  if (!eng.stats.scanner) return;
  const R = 10;
  const bx = Math.floor(eng.x), by = Math.floor(eng.y);
  for (let y = by - R; y <= by + R; y++) {
    for (let x = bx - R; x <= bx + R; x++) {
      const tile = tileAt(eng.world, x, y);
      if (tile !== T.SCRAP && tile !== T.CRYSTAL && tile !== T.CORE && tile !== T.VAULT && tile !== T.CHEST) continue;
      if (Math.hypot(x + 0.5 - eng.x, y + 0.5 - eng.y) > R) continue;
      const col = tile === T.CORE ? '#34d399' : tile === T.CRYSTAL ? '#e879f9' : tile === T.VAULT ? '#38bdf8' : tile === T.CHEST ? '#fde047' : '#facc15';
      g.globalAlpha = 0.35 + 0.35 * Math.sin(t * 4 + x + y);
      g.strokeStyle = col; g.lineWidth = 1.5;
      g.strokeRect(x * TILE + 4, y * TILE + 4, TILE - 8, TILE - 8);
    }
  }
  g.globalAlpha = 1;
}

function drawBeam(g: CanvasRenderingContext2D, b: { x: number; y: number; angle: number; len: number; width: number; live: boolean }, t: number) {
  const x = b.x * TILE, y = b.y * TILE;
  g.save();
  g.translate(x, y); g.rotate(b.angle);
  if (!b.live) {
    g.strokeStyle = `rgba(248,113,113,${0.4 + 0.3 * Math.sin(t * 30)})`; g.lineWidth = 2; g.setLineDash([8, 8]);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(b.len * TILE, 0); g.stroke(); g.setLineDash([]);
  } else {
    const gr = g.createLinearGradient(0, -b.width * TILE, 0, b.width * TILE);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.shadowColor = '#f0abfc'; g.shadowBlur = 14;
    g.fillStyle = gr; g.fillRect(0, -b.width * TILE * 1.3, b.len * TILE, b.width * TILE * 2.6);
  }
  g.restore();
}

function drawBullets(g: CanvasRenderingContext2D, eng: DrillEngine) {
  for (const b of eng.bullets) {
    const px = b.x * TILE, py = b.y * TILE;
    if (b.mine) {
      const armed = (b.arm ?? 0) <= 0;
      g.fillStyle = '#111827'; g.beginPath(); g.arc(px, py, 7, 0, 7); g.fill();
      g.strokeStyle = b.color; g.lineWidth = 2; g.stroke();
      g.fillStyle = armed && Math.floor(performance.now() / 180) % 2 ? '#fff' : b.color; g.beginPath(); g.arc(px, py, 2.4, 0, 7); g.fill();
      continue;
    }
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

// ----------------------------------------------------------------- minimap

const MM_COLOR: Record<number, string> = {
  [T.DIRT]: '#4a4038', [T.ROCK]: '#6b7280', [T.SCRAP]: '#eab308', [T.CRYSTAL]: '#e879f9', [T.CORE]: '#34d399',
  [T.BEDROCK]: '#1f2937', [T.PLATE]: '#9ca3af', [T.VAULT]: '#38bdf8', [T.CRATE]: '#a16207', [T.MIMIC]: '#a16207',
  [T.CHEST]: '#fde047', [T.NEST]: '#f87171',
};

/** A survey map of the tiles your lamp has actually lit. Unexplored rock stays blank. */
function drawMinimap(g: CanvasRenderingContext2D, eng: DrillEngine, view: View, t: number) {
  if (eng.y < SURFACE_ROW - 2) return;
  const cell = 2;
  const cols = eng.world.w, rows = 64;
  const mw = cols * cell, mh = rows * cell;
  const mx = view.w - mw - 12, my = view.h - mh - 12;
  const top = Math.max(SURFACE_ROW - 2, Math.floor(eng.y) - rows / 2);
  g.save();
  g.globalAlpha = 0.9;
  g.fillStyle = 'rgba(5,8,17,0.85)'; g.fillRect(mx - 3, my - 14, mw + 6, mh + 17);
  g.strokeStyle = 'rgba(148,163,184,0.3)'; g.lineWidth = 1; g.strokeRect(mx - 3.5, my - 14.5, mw + 7, mh + 18);
  g.font = '700 8px "Chakra Petch", monospace'; g.fillStyle = eng.planet.primary; g.fillText('SURVEY', mx, my - 5);
  g.fillStyle = '#94a3b8'; g.textAlign = 'right'; g.fillText(`${Math.max(0, top - SURFACE_ROW)}–${top - SURFACE_ROW + rows} m`, mx + mw, my - 5); g.textAlign = 'left';
  g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
  const w = eng.world;
  for (let r = 0; r < rows; r++) {
    const y = top + r;
    if (y >= w.h) break;
    for (let x = 0; x < w.w; x++) {
      if (!eng.explored[y * w.w + x] && y > SURFACE_ROW) continue;
      const tile = tileAt(w, x, y);
      if (tile === T.AIR) {
        if (y < SURFACE_ROW) continue;
        g.fillStyle = decorAt(w, x, y) === D.RAIL ? '#92602e' : '#0b1020';
      } else g.fillStyle = MM_COLOR[tile] ?? '#374151';
      g.fillRect(mx + x * cell, my + r * cell, cell, cell);
    }
  }
  for (const s of w.relays) { const r = s.y - top; if (r >= 0 && r < rows && eng.explored[Math.floor(s.y) * w.w + Math.floor(s.x)]) { g.fillStyle = '#38bdf8'; g.fillRect(mx + s.x * cell - 1, my + r * cell - 1, 4, 4); } }
  for (const s of w.merchants) { const r = s.y - top; if (r >= 0 && r < rows && eng.explored[Math.floor(s.y) * w.w + Math.floor(s.x)]) { g.fillStyle = '#fbbf24'; g.fillRect(mx + s.x * cell - 1, my + r * cell - 1, 4, 4); } }
  for (const b of w.bossSites) { const r = b.top - top; if (r >= 0 && r < rows && eng.explored[b.top * w.w + b.left + 3]) { g.fillStyle = b.done ? '#475569' : '#f87171'; g.fillRect(mx + b.left * cell, my + r * cell, (b.right - b.left) * cell, 2); } }
  // pad and rig
  g.fillStyle = '#34d399'; { const r = SURFACE_ROW - top; if (r >= 0 && r < rows) g.fillRect(mx + w.padX0 * cell, my + r * cell - 1, (w.padX1 - w.padX0 + 1) * cell, 2); }
  g.fillStyle = Math.floor(t * 3) % 2 ? '#ffffff' : '#67e8f9';
  g.fillRect(mx + eng.x * cell - 1.5, my + (eng.y - top) * cell - 1.5, 4, 4);
  g.restore();
}
