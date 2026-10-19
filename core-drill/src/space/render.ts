/**
 * Canvas renderer for the orbital sortie, drawn with the lander-pack sprites (CC0, mattwalkden).
 * Everything is pixel art drawn with smoothing off at an integer-ish scale.
 */
import { ARENA_H, ARENA_W, SHIPS, SpaceEngine } from './engine';
import type { Enemy } from './engine';
import type { SpaceAssets } from './assets';
import { mulberry32 } from '../game/terrain';

export interface SCamera { x: number; y: number }
export interface SView { w: number; h: number }

/** Screen pixels per sprite pixel. */
export const spaceScale = (v: SView) => Math.max(2, Math.round(v.h / 240));

// half-length of each ship type from its centre to its rear, for placing the exhaust
const REAR = [12, 10, 12, 16, 15];

let starCanvas: HTMLCanvasElement | null = null;
function starField(A: SpaceAssets): HTMLCanvasElement {
  if (starCanvas) return starCanvas;
  const c = document.createElement('canvas');
  c.width = 448; c.height = 256;
  const g = c.getContext('2d')!;
  const r = mulberry32(7);
  for (let row = 0; row < 16; row += 2) {
    const off = Math.floor(r() * 112);
    for (let k = -1; k < 5; k++) {
      g.save();
      g.translate(k * 112 + off, row * 16);
      if (r() < 0.5) { g.translate(112, 0); g.scale(-1, 1); }
      g.drawImage(A.stars, 0, 0);
      g.restore();
    }
  }
  // the tile is opaque dark blue; keep only its stars so rows do not show as bands
  try {
    const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    for (let i = 0; i < px.length; i += 4) { const l = px[i] + px[i + 1] + px[i + 2]; if (l < 90) px[i + 3] = 0; }
    g.putImageData(d, 0, 0);
  } catch { /* a tainted canvas keeps the bands; harmless */ }
  starCanvas = c;
  return c;
}

function sprite(g: CanvasRenderingContext2D, img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, x: number, y: number, rot = 0, scale = 1, flipX = false) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  if (flipX) g.scale(-1, 1);
  if (scale !== 1) g.scale(scale, scale);
  g.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  g.restore();
}

export function renderSpace(
  g: CanvasRenderingContext2D, eng: SpaceEngine, cam: SCamera, view: SView, dpr: number, aim: { x: number; y: number } | null, t: number, A: SpaceAssets,
) {
  const S = spaceScale(view);
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  drawBackground(g, eng, cam, view, S, t, A);

  g.translate(view.w / 2, view.h / 2);
  g.scale(S, S);
  g.translate(-cam.x, -cam.y);
  g.imageSmoothingEnabled = false;

  drawArena(g, t);
  for (const a of eng.asteroids) drawAsteroid(g, a, A);
  for (const p of eng.pickups) drawPickup(g, p, t, A);
  for (const b of eng.beams) drawBeam(g, b, t);
  for (const e of eng.enemies) drawEnemy(g, eng, e, t, A);
  drawPlayer(g, eng, t, A);
  for (const b of eng.bullets) drawBullet(g, eng, b, t, A);
  for (const b of eng.blasts) {
    const f = Math.min(7, Math.floor((b.t / 0.55) * 8));
    sprite(g, A.explosion, f * 32, 0, 32, 32, b.x, b.y, 0, b.size);
  }
  for (const s of eng.sparks) { g.globalAlpha = Math.max(0, s.life / s.max); g.fillStyle = s.color; g.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size); }
  g.globalAlpha = 1;
  g.font = '700 6px "Chakra Petch", ui-monospace, monospace';
  g.textAlign = 'center';
  for (const f of eng.floaters) {
    g.globalAlpha = Math.min(1, f.life * 2);
    g.fillStyle = '#000'; g.fillText(f.text, f.x + 0.6, f.y + 0.6);
    g.fillStyle = f.color; g.fillText(f.text, f.x, f.y);
  }
  g.globalAlpha = 1;
  g.textAlign = 'left';
  if (aim) drawReticle(g, aim, t, eng);
  g.restore();

  // screen-space HUD
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  drawHud(g, eng, view, A, t);
  g.restore();
}

// ----------------------------------------------------------------- background

function drawBackground(g: CanvasRenderingContext2D, eng: SpaceEngine, cam: SCamera, view: SView, S: number, t: number, A: SpaceAssets) {
  const p = eng.planet;
  const grad = g.createLinearGradient(0, 0, 0, view.h);
  grad.addColorStop(0, p.skyTop); grad.addColorStop(1, p.skyBottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, view.w, view.h);

  // nebula glow
  const neb = (px: number, py: number, r: number, c: string, a: number, par: number) => {
    const x = view.w / 2 + (px - cam.x) * S * par, y = view.h / 2 + (py - cam.y) * S * par;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * S);
    gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = a; g.fillStyle = gr; g.fillRect(x - r * S, y - r * S, r * S * 2, r * S * 2); g.globalAlpha = 1;
  };
  neb(ARENA_W * 0.2, ARENA_H * 0.3, 260, p.accent, 0.16, 0.12);
  neb(ARENA_W * 0.75, ARENA_H * 0.2, 300, p.primary, 0.12, 0.1);

  // star layers
  const stars = starField(A);
  for (const [par, alpha, sc] of [[0.1, 0.4, 1], [0.25, 0.7, 1.5]] as Array<[number, number, number]>) {
    g.globalAlpha = alpha;
    const tw = 448 * S * sc, th = 256 * S * sc;
    const ox = -((cam.x * par * S) % tw + tw) % tw, oy = -((cam.y * par * S) % th + th) % th;
    for (let x = ox - tw; x < view.w; x += tw) for (let y = oy - th; y < view.h; y += th) g.drawImage(stars, x, y, tw, th);
  }
  g.globalAlpha = 1;

  // the planet we are patrolling
  const px = view.w / 2 + (ARENA_W * 0.82 - cam.x) * S * 0.28, py = view.h / 2 + (ARENA_H * 0.95 - cam.y) * S * 0.28, pr = 230 * S * 0.28 * 1.05;
  const atm = g.createRadialGradient(px, py, pr * 0.9, px, py, pr * 1.18);
  atm.addColorStop(0, `${p.primary}66`); atm.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = atm; g.beginPath(); g.arc(px, py, pr * 1.18, 0, Math.PI * 2); g.fill();
  const pg = g.createRadialGradient(px - pr * 0.35, py - pr * 0.4, pr * 0.1, px, py, pr);
  pg.addColorStop(0, p.accent); pg.addColorStop(0.5, p.primary); pg.addColorStop(1, p.skyTop);
  g.fillStyle = pg; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 3;
  for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(px, py, pr * (0.3 + i * 0.2), 4.2 + i * 0.3, 5.2 + i * 0.3); g.stroke(); }

  // distant wreckage
  const r = mulberry32(31);
  for (let i = 0; i < 6; i++) {
    const wx = r() * ARENA_W, wy = r() * ARENA_H, par = 0.5 + r() * 0.15, frame = Math.floor(r() * 6);
    const x = view.w / 2 + (wx - cam.x) * S * par, y = view.h / 2 + (wy - cam.y) * S * par;
    g.globalAlpha = 0.55;
    g.drawImage(A.debris, frame * 64, 0, 64, 64, x - 32 * S, y - 32 * S, 64 * S, 64 * S);
  }
  g.globalAlpha = 1;
  void t;
}

function drawArena(g: CanvasRenderingContext2D, t: number) {
  g.strokeStyle = `rgba(248,113,113,${0.35 + 0.2 * Math.sin(t * 3)})`;
  g.lineWidth = 2;
  g.setLineDash([8, 6]);
  g.strokeRect(0, 0, ARENA_W, ARENA_H);
  g.setLineDash([]);
}

// ----------------------------------------------------------------- actors

function drawAsteroid(g: CanvasRenderingContext2D, a: { x: number; y: number; rot: number; size: number; variant: number }, A: SpaceAssets) {
  sprite(g, a.variant ? A.asteroidsFg : A.asteroids, a.size * 64, 0, 64, 64, a.x, a.y, a.rot);
}

function drawFlame(g: CanvasRenderingContext2D, A: SpaceAssets, x: number, y: number, angle: number, rear: number, power: number, t: number, blue: boolean) {
  if (power <= 0.02) return;
  const img = blue ? A.thruster4 : A.thruster1;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  if (blue) {
    const f = Math.floor(t * 18) % 2;
    g.translate(-rear + 5, 0);
    g.scale(-0.55 - power * 0.45, 0.7 + power * 0.3);
    g.drawImage(img, f * 32, 0, 32, 32, -16, -16, 32, 32);
  } else {
    const f = Math.floor(t * 14 + x) % 4;
    g.translate(-rear - 2, 0);
    g.scale(-1, 1);
    g.drawImage(img, f * 16, 0, 16, 16, -8, -8, 16, 16);
  }
  g.restore();
}

function drawPlayer(g: CanvasRenderingContext2D, eng: SpaceEngine, t: number, A: SpaceAssets) {
  if (eng.status === 'ended' && eng.hull <= 0) return;
  const col = eng.shipSprite;
  drawFlame(g, A, eng.x, eng.y, eng.angle, REAR[col], eng.thrust * (eng.boosting ? 1.2 : 0.8), t, true);
  sprite(g, A.ships, col * 64, 2 * 64, 64, 64, eng.x, eng.y, eng.angle);
  if (eng.hurtFlash > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(0.8, eng.hurtFlash * 4); sprite(g, A.ships, col * 64, 2 * 64, 64, 64, eng.x, eng.y, eng.angle); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  if (eng.shield > 0) {
    const recent = eng.hurtFlash > 0;
    g.strokeStyle = recent ? 'rgba(125,211,252,0.9)' : 'rgba(125,211,252,0.22)';
    g.lineWidth = recent ? 1.6 : 0.8;
    g.beginPath(); g.arc(eng.x, eng.y, 17 + Math.sin(t * 4), 0, Math.PI * 2); g.stroke();
  }
}

function drawEnemy(g: CanvasRenderingContext2D, eng: SpaceEngine, e: Enemy, t: number, A: SpaceAssets) {
  const def = SHIPS[e.kind];
  const sp = Math.hypot(e.vx, e.vy);
  const row = e.boss ? 1 : e.row;
  drawFlame(g, A, e.x, e.y, e.angle, REAR[def.sprite], Math.min(1, sp / 80), t, false);
  const sc = e.boss ? 1.9 : 1;
  sprite(g, A.ships, def.sprite * 64, row * 64, 64, 64, e.x, e.y, e.angle, sc);
  if (e.boss) {
    // twin turrets that track the player
    const ta = Math.atan2(eng.y - e.y, eng.x - e.x);
    for (const [ox, oy] of [[-10, -14], [-10, 14], [12, 0]]) {
      const c = Math.cos(e.angle), s = Math.sin(e.angle);
      sprite(g, A.turrets, 0, 0, 64, 64, e.x + (ox * c - oy * s) * 1.6, e.y + (ox * s + oy * c) * 1.6, ta, 1.2);
    }
  }
  if (e.flash > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.7; sprite(g, A.ships, def.sprite * 64, row * 64, 64, 64, e.x, e.y, e.angle, sc); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  if (e.boss && e.atk === 'dash' && e.atkN === 1) {
    g.strokeStyle = 'rgba(248,113,113,0.6)'; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(e.tx, e.ty); g.stroke(); g.setLineDash([]);
  }
  if (!e.boss && e.hp < e.maxHp) {
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(e.x - 9, e.y - e.r - 6, 18, 3);
    g.fillStyle = '#f87171'; g.fillRect(e.x - 8.5, e.y - e.r - 5.5, 17 * Math.max(0, e.hp / e.maxHp), 2);
  }
}

function drawBullet(g: CanvasRenderingContext2D, eng: SpaceEngine, b: { x: number; y: number; vx: number; vy: number; kind: string; arm?: number; fromPlayer: boolean; crit?: boolean }, t: number, A: SpaceAssets) {
  const ang = Math.atan2(b.vy, b.vx);
  switch (b.kind) {
    case 'pulse': sprite(g, A.fx1, (Math.floor(t * 20) % 3) * 16, 0, 16, 16, b.x, b.y, ang, b.crit ? 1.3 : 1); break;
    case 'orange': sprite(g, A.fx2, (Math.floor(t * 20) % 3) * 16, 0, 16, 16, b.x, b.y, ang); break;
    case 'green': sprite(g, A.fx5, 64 + 0, 0, 64, 64, b.x, b.y, ang, 0.22); break;
    case 'big': sprite(g, eng.hostileRow === 0 ? A.fx5 : A.fx4, 0, 0, 64, 64, b.x, b.y, 0, 0.3); break;
    case 'missile': {
      sprite(g, A.missiles, b.fromPlayer ? 64 : 128, 0, 64, 64, b.x, b.y, ang);
      g.globalAlpha = 0.9;
      g.save(); g.translate(b.x, b.y); g.rotate(ang); g.scale(-0.5, 0.5); g.drawImage(A.thruster4, (Math.floor(t * 20) % 2) * 32, 0, 32, 32, -2, -16, 32, 32); g.restore();
      g.globalAlpha = 1;
      break;
    }
    case 'mine': {
      const armed = (b.arm ?? 0) <= 0;
      g.fillStyle = '#111827'; g.beginPath(); g.arc(b.x, b.y, 5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = armed && Math.floor(t * 6) % 2 ? '#fff' : '#fb7185'; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = '#fb7185';
      for (let i = 0; i < 6; i++) { const a = i * 1.047 + t; g.fillRect(b.x + Math.cos(a) * 6 - 0.8, b.y + Math.sin(a) * 6 - 0.8, 1.6, 1.6); }
      break;
    }
    default: break;
  }
}

function drawPickup(g: CanvasRenderingContext2D, p: { x: number; y: number; kind: string; age: number }, t: number, A: SpaceAssets) {
  const y = p.y + Math.sin(t * 3 + p.x) * 1.2;
  const col = p.kind === 'fuel' ? '#34d399' : p.kind === 'repair' ? '#f87171' : p.kind === 'missile' ? '#fb923c' : p.kind === 'shield' ? '#38bdf8' : p.kind === 'core' ? '#c4b5fd' : p.kind === 'crew' ? '#86efac' : '#facc15';
  const gr = g.createRadialGradient(p.x, y, 0, p.x, y, 12);
  gr.addColorStop(0, `${col}aa`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(p.x, y, 12, 0, Math.PI * 2); g.fill();
  if (p.kind === 'crew') { sprite(g, A.crewIcon, 0, 0, 16, 16, p.x, y); return; }
  if (p.kind === 'missile') { sprite(g, A.missileIcon, 0, 0, 16, 16, p.x, y, 0, 0.8); return; }
  g.fillStyle = col; g.strokeStyle = '#0b1220'; g.lineWidth = 1;
  if (p.kind === 'fuel') { g.fillRect(p.x - 3, y - 4, 6, 8); g.strokeRect(p.x - 3, y - 4, 6, 8); g.fillStyle = '#064e3b'; g.fillRect(p.x - 1, y - 6, 2, 2); }
  else if (p.kind === 'repair') { g.fillRect(p.x - 1.5, y - 4.5, 3, 9); g.fillRect(p.x - 4.5, y - 1.5, 9, 3); }
  else if (p.kind === 'shield') { g.beginPath(); g.moveTo(p.x, y - 5); g.lineTo(p.x + 4, y - 2); g.lineTo(p.x + 3, y + 3); g.lineTo(p.x, y + 5); g.lineTo(p.x - 3, y + 3); g.lineTo(p.x - 4, y - 2); g.closePath(); g.fill(); g.stroke(); }
  else if (p.kind === 'core') { g.beginPath(); g.arc(p.x, y, 4, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.fillRect(p.x - 1, y - 2, 1.5, 1.5); }
  else { g.beginPath(); g.arc(p.x, y, 3.6, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = '#92400e'; g.fillRect(p.x - 0.7, y - 2, 1.4, 4); }
}

function drawBeam(g: CanvasRenderingContext2D, b: { x: number; y: number; angle: number; len: number; live: boolean }, t: number) {
  g.save();
  g.translate(b.x, b.y); g.rotate(b.angle);
  if (!b.live) { g.strokeStyle = `rgba(248,113,113,${0.4 + 0.3 * Math.sin(t * 30)})`; g.lineWidth = 1; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(0, 0); g.lineTo(b.len, 0); g.stroke(); }
  else {
    g.shadowColor = '#f0abfc'; g.shadowBlur = 8;
    const gr = g.createLinearGradient(0, -5, 0, 5);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, -5, b.len, 10);
  }
  g.restore();
}

function drawReticle(g: CanvasRenderingContext2D, aim: { x: number; y: number }, t: number, eng: SpaceEngine) {
  g.strokeStyle = eng.energy >= 4 ? '#67e8f9' : '#f87171';
  g.lineWidth = 0.9;
  const r = 5 + Math.sin(t * 6) * 0.5;
  g.beginPath(); g.arc(aim.x, aim.y, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(aim.x - 9, aim.y); g.lineTo(aim.x - 3, aim.y); g.moveTo(aim.x + 3, aim.y); g.lineTo(aim.x + 9, aim.y); g.moveTo(aim.x, aim.y - 9); g.lineTo(aim.x, aim.y - 3); g.moveTo(aim.x, aim.y + 3); g.lineTo(aim.x, aim.y + 9); g.stroke();
}

// ----------------------------------------------------------------- HUD

function bar(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, frac: number, k: number) {
  g.drawImage(img, 0, 0, 112, 10, x, y, 112 * k, 10 * k);
  const w = Math.round(110 * Math.max(0, Math.min(1, frac)));
  if (w > 0) g.drawImage(img, 1, 17, w, 8, x + k, y + k, w * k, 8 * k);
}

function drawHud(g: CanvasRenderingContext2D, eng: SpaceEngine, view: SView, A: SpaceAssets, t: number) {
  const k = view.w < 760 ? 1.5 : 2;
  const x = 12, y = 12;
  g.font = `700 ${Math.round(5 * k)}px "Chakra Petch", ui-monospace, monospace`;
  g.textBaseline = 'middle';
  const row = (label: string, frac: number, img: HTMLImageElement, yy: number, value: string, tint?: string) => {
    g.fillStyle = '#cbd5e1'; g.fillText(label, x, yy + 5 * k);
    bar(g, img, x + 34 * k, yy, frac, k);
    if (tint) { g.globalCompositeOperation = 'source-atop'; }
    g.fillStyle = '#e2e8f0'; g.fillText(value, x + 34 * k + 116 * k, yy + 5 * k);
  };
  row('HULL', eng.hull / eng.stats.maxHull, A.hullBar, y, `${Math.ceil(eng.hull)}`);
  row('FUEL', eng.fuel / eng.stats.maxFuel, A.fuelBar, y + 14 * k, `${Math.ceil(eng.fuel)}`);
  // shield and weapon energy as slim bars in the same style
  const slim = (label: string, frac: number, yy: number, col: string) => {
    g.fillStyle = '#cbd5e1'; g.fillText(label, x, yy + 3 * k);
    g.fillStyle = '#05080f'; g.fillRect(x + 34 * k, yy, 112 * k, 5 * k);
    g.fillStyle = col; g.fillRect(x + 34 * k + k, yy + k, 110 * k * Math.max(0, Math.min(1, frac)), 3 * k);
    g.strokeStyle = '#e2e8f0'; g.lineWidth = 1; g.strokeRect(x + 34 * k + 0.5, yy + 0.5, 112 * k - 1, 5 * k - 1);
  };
  slim('SHLD', eng.shield / Math.max(1, eng.stats.maxShield), y + 28 * k, '#38bdf8');
  slim('GUN', eng.energy / eng.stats.maxEnergy, y + 37 * k, '#67e8f9');

  // missiles and crew
  const my = y + 48 * k;
  g.drawImage(A.missileIcon, 0, 0, 16, 16, x, my, 16 * k, 16 * k);
  for (let i = 0; i < 12; i++) g.drawImage(A.missileCounter, i < eng.missiles ? 0 : 16, 0, 16, 16, x + 18 * k + i * 8 * k, my + 4 * k, 8 * k, 8 * k);
  g.drawImage(A.crewIcon, 0, 0, 16, 16, x, my + 18 * k, 16 * k, 16 * k);
  g.fillStyle = '#86efac'; g.fillText(`× ${eng.crewRescued}`, x + 20 * k, my + 26 * k);
  g.fillStyle = '#facc15'; g.fillText(`SCRAP ${eng.scrap}   CORES ${eng.cores}`, x + 56 * k, my + 26 * k);

  // radar, top right
  const rw = 112 * k, rh = 64 * k, rx = view.w - rw - 12, ry = 12;
  g.drawImage(A.radar, 0, 0, 112, 64, rx, ry, rw, rh);
  const range = eng.stats.scanner ? 900 : 560;
  const toR = (wx: number, wy: number): [number, number, boolean] => {
    const dx = (wx - eng.x) / range, dy = (wy - eng.y) / range;
    const inside = Math.abs(dx) < 1 && Math.abs(dy) < 1;
    const cx = Math.max(-1, Math.min(1, dx)), cy = Math.max(-1, Math.min(1, dy));
    return [rx + rw / 2 + cx * (rw / 2 - 5 * k), ry + rh / 2 + cy * (rh / 2 - 5 * k), inside];
  };
  for (const a of eng.asteroids) { const [px, py, ins] = toR(a.x, a.y); if (ins) { g.fillStyle = '#64748b'; g.fillRect(px - k, py - k, 2 * k, 2 * k); } }
  for (const p of eng.pickups) { const [px, py, ins] = toR(p.x, p.y); if (ins && (eng.stats.scanner || p.kind === 'crew')) { g.fillStyle = p.kind === 'crew' ? '#86efac' : '#facc15'; g.fillRect(px - k * 0.6, py - k * 0.6, 1.4 * k, 1.4 * k); } }
  for (const e of eng.enemies) {
    const [px, py] = toR(e.x, e.y);
    g.fillStyle = e.boss ? '#fb923c' : '#f87171';
    const s = e.boss ? 3.2 * k : 1.8 * k;
    g.fillRect(px - s / 2, py - s / 2, s, s);
  }
  g.fillStyle = Math.floor(t * 3) % 2 ? '#ffffff' : '#67e8f9';
  g.fillRect(rx + rw / 2 - k, ry + rh / 2 - k, 2 * k, 2 * k);

  // velocity gauges under the radar
  const gy = ry + rh + 8, gw = 128 * k * 0.8;
  for (let i = 0; i < 2; i++) {
    g.drawImage(A.gauges, 0, i * 16, 128, 16, rx + rw - gw, gy + i * 14 * k, gw, 16 * k * 0.8);
    const v = i === 0 ? eng.vx : eng.vy;
    const frac = 0.5 + Math.max(-1, Math.min(1, v / 130)) / 2;
    const bx = rx + rw - gw + (16 + 106 * frac) * k * 0.8;
    g.fillStyle = '#fbbf24'; g.fillRect(bx - 1, gy + i * 14 * k + 2 * k, 2, 10 * k * 0.8);
  }
  g.textBaseline = 'alphabetic';

  // wave and boss strip
  g.textAlign = 'center';
  g.font = `700 ${Math.round(5.5 * k)}px "Chakra Petch", ui-monospace, monospace`;
  g.fillStyle = '#e2e8f0';
  g.fillText(eng.waveActive ? `WAVE ${eng.wave}` : `NEXT WAVE ${Math.max(0, Math.ceil(eng.breakT))}s`, view.w / 2, 22);
  const boss = eng.boss;
  if (boss) {
    const bw = Math.min(420, view.w * 0.5);
    g.fillStyle = '#fca5a5'; g.font = `700 ${Math.round(4.5 * k)}px "Chakra Petch", monospace`; g.fillText(boss.name.toUpperCase(), view.w / 2, 38);
    g.fillStyle = 'rgba(5,8,17,0.85)'; g.fillRect(view.w / 2 - bw / 2, 44, bw, 9);
    g.fillStyle = '#ef4444'; g.fillRect(view.w / 2 - bw / 2 + 1, 45, (bw - 2) * Math.max(0, boss.hp / boss.maxHp), 7);
    g.strokeStyle = '#e2e8f0'; g.strokeRect(view.w / 2 - bw / 2 + 0.5, 44.5, bw - 1, 8);
  }
  g.textAlign = 'left';
}
