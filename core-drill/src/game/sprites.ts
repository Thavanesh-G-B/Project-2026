/**
 * Pre-rendered tile art and hand-drawn mine decoration. Tiles are painted into 64px canvases
 * (drawn at 32px) so they stay crisp on high-DPI screens. Everything is procedural.
 */
import { B, D, PlanetDef, T, TILE } from './balance';
import { mulberry32 } from './terrain';

const SPR = 64;
const K = SPR / TILE; // drawing happens in 32-unit space, scaled by K

export type Sprites = Record<number, HTMLCanvasElement[]>;
export interface SpriteSet { tiles: Sprites; back: Sprites }
const cache = new Map<number, SpriteSet>();

function sprite(draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SPR; c.height = SPR;
  const g = c.getContext('2d')!;
  g.scale(K, K);
  draw(g);
  return c;
}

export const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0);
};

function grad(g: CanvasRenderingContext2D, a: string, b: string, vertical = true) {
  const gr = vertical ? g.createLinearGradient(0, 0, 0, TILE) : g.createLinearGradient(0, 0, TILE, 0);
  gr.addColorStop(0, a); gr.addColorStop(1, b);
  return gr;
}

function bevel(g: CanvasRenderingContext2D, strength = 1) {
  g.fillStyle = `rgba(255,255,255,${0.09 * strength})`;
  g.fillRect(0, 0, TILE, 1.2); g.fillRect(0, 0, 1.2, TILE);
  g.fillStyle = `rgba(0,0,0,${0.32 * strength})`;
  g.fillRect(0, TILE - 1.4, TILE, 1.4); g.fillRect(TILE - 1.4, 0, 1.4, TILE);
}

function speckle(g: CanvasRenderingContext2D, r: () => number, n: number, light: string, dark: string) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? light : dark;
    const s = 0.6 + r() * 1.6;
    g.fillRect(r() * TILE, r() * TILE, s, s);
  }
}

function baseGround(g: CanvasRenderingContext2D, p: PlanetDef, r: () => number, rock: boolean) {
  const cols = rock ? p.rock : p.dirt;
  g.fillStyle = grad(g, cols[0], cols[1]);
  g.fillRect(0, 0, TILE, TILE);
  // soft mottling
  for (let i = 0; i < 6; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.ellipse(r() * TILE, r() * TILE, 3 + r() * 6, 2 + r() * 4, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  speckle(g, r, rock ? 14 : 22, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.3)');
  if (rock) {
    // faceted stone: a few shaded polygons and cracks
    for (let i = 0; i < 3; i++) {
      const cx = r() * TILE, cy = r() * TILE;
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.14)';
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + r();
        const rr = 5 + r() * 7;
        k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.9;
    for (let i = 0; i < 2; i++) {
      g.beginPath(); let x = r() * TILE, y = r() * 6;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 9; y += 6 + r() * 4; g.lineTo(x, y); }
      g.stroke();
    }
  } else {
    // strata lines and pebbles
    g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1;
    const sy = 6 + r() * 20;
    g.beginPath(); g.moveTo(0, sy); g.bezierCurveTo(10, sy - 3, 20, sy + 3, TILE, sy + (r() - 0.5) * 4); g.stroke();
    for (let i = 0; i < 3; i++) {
      const px = r() * 28 + 2, py = r() * 28 + 2, pr = 1 + r() * 1.6;
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(px + 0.4, py + 0.5, pr, pr * 0.8, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.ellipse(px, py, pr, pr * 0.8, 0, 0, 7); g.fill();
    }
  }
  // per-planet motifs
  g.lineWidth = 0.9;
  if (p.id === 1 && r() < 0.5) {
    const x = 4 + Math.floor(r() * 22), y = 4 + Math.floor(r() * 22);
    g.strokeStyle = 'rgba(34,211,238,0.2)'; g.fillStyle = 'rgba(34,211,238,0.38)';
    g.beginPath(); g.moveTo(0, y); g.lineTo(x, y); g.lineTo(x, TILE); g.stroke(); g.fillRect(x - 1, y - 1, 2.4, 2.4);
  } else if (p.id === 2 && r() < 0.45) {
    g.strokeStyle = 'rgba(249,115,22,0.35)';
    g.beginPath(); let x = r() * TILE, y = 0; g.moveTo(x, y);
    for (let i = 0; i < 4; i++) { x += (r() - 0.5) * 10; y += 8; g.lineTo(x, y); }
    g.stroke();
  } else if (p.id === 3 && r() < 0.5) {
    g.fillStyle = 'rgba(232,121,249,0.28)';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(r() * TILE, r() * TILE, 0.8 + r() * 1.4, 0, 7); g.fill(); }
  } else if (p.id === 4 && r() < 0.55) {
    g.strokeStyle = 'rgba(224,242,254,0.35)';
    const x = r() * TILE, y = r() * TILE;
    g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x + 3, y); g.moveTo(x, y - 3); g.lineTo(x, y + 3); g.stroke();
  } else if (p.id === 5 && r() < 0.5) {
    g.strokeStyle = 'rgba(251,113,133,0.3)';
    const y = r() * TILE; g.beginPath(); g.moveTo(0, y); g.lineTo(TILE * 0.4, y + 2); g.lineTo(TILE * 0.55, y - 3); g.lineTo(TILE, y); g.stroke();
  }
  bevel(g, rock ? 1.1 : 0.9);
}

function gear(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth: number, fill: string, hi: string) {
  g.fillStyle = fill;
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.78 : r;
    i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(cx, cy, r * 0.32, 0, 7); g.fill();
  g.fillStyle = hi; g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.35, r * 0.22, 0, 7); g.fill();
}

function shard(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, a: string, b: string) {
  g.fillStyle = a;
  g.beginPath(); g.moveTo(cx, cy - h); g.lineTo(cx + w, cy); g.lineTo(cx, cy + h * 0.5); g.closePath(); g.fill();
  g.fillStyle = b;
  g.beginPath(); g.moveTo(cx, cy - h); g.lineTo(cx - w, cy); g.lineTo(cx, cy + h * 0.5); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(cx - 0.6, cy - h + 2, 1.2, 2.4);
}

function buildSet(p: PlanetDef): SpriteSet {
  const tiles: Sprites = {};
  const back: Sprites = {};
  const add = (target: Sprites, t: number, n: number, draw: (g: CanvasRenderingContext2D, r: () => number, v: number) => void) => {
    target[t] = [];
    for (let v = 0; v < n; v++) {
      const r = mulberry32(p.id * 977 + t * 131 + v * 17 + (target === back ? 5000 : 0));
      target[t].push(sprite((g) => draw(g, r, v)));
    }
  };

  add(tiles, T.DIRT, 6, (g, r) => baseGround(g, p, r, false));
  add(tiles, T.ROCK, 5, (g, r) => baseGround(g, p, r, true));
  add(tiles, T.SCRAP, 5, (g, r) => {
    baseGround(g, p, r, false);
    for (let i = 0; i < 2; i++) gear(g, 8 + r() * 16, 8 + r() * 16, 4 + r() * 2.4, 6 + Math.floor(r() * 3), i ? '#d97706' : '#eab308', '#fef3c7');
    g.fillStyle = '#b45309'; g.save(); g.translate(16 + (r() - 0.5) * 10, 18 + (r() - 0.5) * 8); g.rotate(r() * 3);
    g.fillRect(-4, -1.5, 8, 3); g.fillStyle = '#fde68a'; g.fillRect(-4, -1.5, 8, 0.8); g.restore();
  });
  add(tiles, T.CRYSTAL, 4, (g, r) => {
    baseGround(g, p, r, true);
    g.fillStyle = 'rgba(232,121,249,0.18)'; g.beginPath(); g.arc(16, 16, 11, 0, 7); g.fill();
    shard(g, 10 + r() * 3, 19, 4.6, 10, '#e879f9', '#a21caf');
    shard(g, 21 + r() * 3, 21, 3.8, 8, '#67e8f9', '#0891b2');
    shard(g, 16, 13, 3, 6.5, '#f0abfc', '#c026d3');
  });
  add(tiles, T.CORE, 2, (g, r) => {
    baseGround(g, p, r, true);
    g.fillStyle = '#1f2937'; g.beginPath(); g.arc(16, 16, 10.5, 0, 7); g.fill();
    g.strokeStyle = '#64748b'; g.lineWidth = 1.4; g.stroke();
    const gr = g.createRadialGradient(16, 16, 1, 16, 16, 9);
    gr.addColorStop(0, '#ecfdf5'); gr.addColorStop(0.45, '#34d399'); gr.addColorStop(1, 'rgba(16,185,129,0.1)');
    g.fillStyle = gr; g.beginPath(); g.arc(16, 16, 9, 0, 7); g.fill();
    g.strokeStyle = 'rgba(167,243,208,0.9)'; g.lineWidth = 1; g.beginPath(); g.arc(16, 16, 6, 0.4, 5.6); g.stroke();
  });
  add(tiles, T.BEDROCK, 3, (g, r) => {
    g.fillStyle = '#070a12'; g.fillRect(0, 0, TILE, TILE);
    g.strokeStyle = 'rgba(148,163,184,0.14)'; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    g.beginPath(); g.moveTo(0, TILE / 2); g.lineTo(TILE, TILE / 2); g.moveTo(TILE / 2 + (r() - 0.5) * 8, 0); g.lineTo(TILE / 2, TILE); g.stroke();
    g.fillStyle = 'rgba(148,163,184,0.25)';
    for (const [x, y] of [[4, 4], [TILE - 5, 4], [4, TILE - 5], [TILE - 5, TILE - 5]]) g.fillRect(x, y, 1.6, 1.6);
    speckle(g, r, 14, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.4)');
  });
  add(tiles, T.PLATE, 4, (g, r, v) => {
    g.fillStyle = grad(g, '#59626f', '#3a424e'); g.fillRect(0, 0, TILE, TILE);
    // hazard stripes along the top lip
    for (let x = -8; x < TILE + 8; x += 8) {
      g.fillStyle = '#d4a017';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 4, 0); g.lineTo(x + 8, 6); g.lineTo(x + 4, 6); g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 6, TILE, 1);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, TILE, 0.8);
    // rivets and a panel seam
    for (const [x, y] of [[4, 11], [TILE - 4, 11], [4, TILE - 4], [TILE - 4, TILE - 4]]) {
      g.fillStyle = '#1f2937'; g.beginPath(); g.arc(x + 0.5, y + 0.6, 1.6, 0, 7); g.fill();
      g.fillStyle = '#cbd5e1'; g.beginPath(); g.arc(x, y, 1.3, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(TILE / 2, 7); g.lineTo(TILE / 2, TILE); g.stroke();
    // rust streaks
    for (let i = 0; i < 3; i++) {
      g.fillStyle = `rgba(154,86,44,${0.18 + r() * 0.2})`;
      g.fillRect(3 + r() * 26, 7 + r() * 8, 1.5 + r() * 2, 8 + r() * 14);
    }
    speckle(g, r, 14, 'rgba(255,255,255,0.1)', 'rgba(0,0,0,0.3)');
    if (v === 3) { g.strokeStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.moveTo(6, 10); g.lineTo(14, 20); g.lineTo(11, 30); g.stroke(); }
    bevel(g, 0.8);
  });
  add(tiles, T.CRATE, 3, (g, r) => {
    g.fillStyle = grad(g, '#8a6238', '#5b3f22'); g.fillRect(1, 1, TILE - 2, TILE - 2);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1;
    for (let y = 8; y < TILE; y += 8) { g.beginPath(); g.moveTo(1, y); g.lineTo(TILE - 1, y); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 6; i++) g.fillRect(2 + r() * 24, 2 + r() * 26, 5 + r() * 6, 1);
    g.fillStyle = '#3f4651';
    g.fillRect(1, 1, TILE - 2, 3); g.fillRect(1, TILE - 4, TILE - 2, 3);
    g.fillRect(1, 1, 3, TILE - 2); g.fillRect(TILE - 4, 1, 3, TILE - 2);
    g.strokeStyle = '#3f4651'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(2, 2); g.lineTo(TILE - 2, TILE - 2); g.stroke();
    g.fillStyle = '#cbd5e1';
    for (const [x, y] of [[2.5, 2.5], [TILE - 2.5, 2.5], [2.5, TILE - 2.5], [TILE - 2.5, TILE - 2.5]]) g.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
  });
  add(tiles, T.CHEST, 1, (g) => {
    g.fillStyle = 'rgba(253,224,71,0.2)'; g.beginPath(); g.arc(16, 18, 15, 0, 7); g.fill();
    g.fillStyle = grad(g, '#7c4a1d', '#4a2a10'); g.fillRect(3, 12, 26, 16);
    g.fillStyle = '#92561f'; g.beginPath(); g.moveTo(3, 12); g.quadraticCurveTo(16, 2, 29, 12); g.closePath(); g.fill();
    g.fillStyle = '#facc15'; g.fillRect(3, 11, 26, 2.4); g.fillRect(3, 24, 26, 2.4); g.fillRect(8, 5, 2.4, 22); g.fillRect(21.6, 5, 2.4, 22);
    g.fillStyle = '#fef08a'; g.fillRect(14, 14, 4, 6); g.fillStyle = '#1c1917'; g.fillRect(15.4, 16, 1.2, 2.4);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect(3, 11, 26, 17);
  });
  add(tiles, T.VAULT, 1, (g) => {
    g.fillStyle = '#1e293b'; g.fillRect(1, 1, TILE - 2, TILE - 2);
    g.strokeStyle = p.primary; g.lineWidth = 1.6; g.strokeRect(3, 3, TILE - 6, TILE - 6);
    g.fillStyle = '#0f172a'; g.fillRect(8, 8, TILE - 16, TILE - 16);
    g.fillStyle = p.primary; g.fillRect(12, 15, 8, 8);
    g.strokeStyle = p.primary; g.lineWidth = 1.8; g.beginPath(); g.arc(16, 15, 4, Math.PI, 0); g.stroke();
    g.fillStyle = '#0f172a'; g.fillRect(15.2, 18, 1.6, 3);
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(1, 1, TILE - 2, 1.5);
  });

  // ---- back walls
  add(back, B.CAVE, 4, (g, r) => {
    g.fillStyle = grad(g, '#10141d', '#0a0d14'); g.fillRect(0, 0, TILE, TILE);
    speckle(g, r, 18, 'rgba(255,255,255,0.035)', 'rgba(0,0,0,0.35)');
    g.fillStyle = 'rgba(255,255,255,0.025)';
    g.beginPath(); g.ellipse(r() * TILE, r() * TILE, 7, 4, r() * 3, 0, 7); g.fill();
  });
  add(back, B.WOOD, 3, (g, r) => {
    g.fillStyle = '#241a12'; g.fillRect(0, 0, TILE, TILE);
    for (let x = 0; x < TILE; x += 8) {
      g.fillStyle = grad(g, '#33251a', '#1f160f'); g.fillRect(x + 0.5, 0, 7, TILE);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, 0, 1, TILE);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(x + 3 + r() * 3, 0); g.bezierCurveTo(x + 2, 10, x + 6, 20, x + 3 + r() * 3, TILE); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, TILE, 2.5);
    g.fillStyle = '#4b5563';
    g.fillRect(3.5, 8, 1.2, 1.2); g.fillRect(11.5, 24, 1.2, 1.2); g.fillRect(19.5, 8, 1.2, 1.2); g.fillRect(27.5, 22, 1.2, 1.2);
  });
  add(back, B.STONE, 3, (g, r) => {
    g.fillStyle = '#171b23'; g.fillRect(0, 0, TILE, TILE);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1;
    for (let y = 0; y < TILE; y += 8) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(TILE, y); g.stroke();
      const off = (y / 8) % 2 ? 6 : 14;
      for (let x = off; x < TILE; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 8); g.stroke(); }
    }
    speckle(g, r, 14, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.3)');
  });
  add(back, B.METAL, 3, (g, r) => {
    g.fillStyle = '#12161f'; g.fillRect(0, 0, TILE, TILE);
    g.strokeStyle = `${p.primary}2a`; g.lineWidth = 1;
    g.strokeRect(1.5, 1.5, TILE - 3, TILE - 3);
    g.beginPath(); g.moveTo(1.5, TILE / 2); g.lineTo(TILE - 1.5, TILE / 2); g.stroke();
    g.fillStyle = 'rgba(148,163,184,0.18)';
    for (const [x, y] of [[4, 4], [TILE - 5, 4], [4, TILE - 5], [TILE - 5, TILE - 5]]) g.fillRect(x, y, 1.4, 1.4);
    speckle(g, r, 8, 'rgba(255,255,255,0.04)', 'rgba(0,0,0,0.3)');
  });
  return { tiles, back };
}

export function getSprites(p: PlanetDef): SpriteSet {
  let s = cache.get(p.id);
  if (!s) { s = buildSet(p); cache.set(p.id, s); }
  return s;
}

// ----------------------------------------------------------------- animated tiles

export function drawHazard(g: CanvasRenderingContext2D, p: PlanetDef, px: number, py: number, t: number, x: number, y: number) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3 + x * 0.9 + y * 1.3);
  const base = p.id === 2 ? '#5a1d0a' : p.id === 3 ? '#3b0f4a' : p.id === 4 ? '#0b3a52' : p.id === 5 ? '#4a0f24' : '#0c3a5a';
  g.fillStyle = base; g.fillRect(px, py, TILE, TILE);
  const gr = g.createRadialGradient(px + 16, py + 16, 2, px + 16, py + 16, 21);
  gr.addColorStop(0, p.hazardColor); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.45 + 0.4 * pulse;
  g.fillStyle = gr; g.fillRect(px, py, TILE, TILE);
  g.globalAlpha = 1;
  g.fillStyle = p.hazardColor;
  for (let i = 0; i < 3; i++) {
    const bx = px + 6 + (hash(x + i, y) % 20), by = py + TILE - ((t * 14 + i * 11 + hash(x, y + i)) % TILE);
    g.fillRect(bx, by, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
}

export function drawNest(g: CanvasRenderingContext2D, p: PlanetDef, px: number, py: number, t: number, rockSprite: HTMLCanvasElement) {
  g.drawImage(rockSprite, px, py, TILE, TILE);
  const s = 1 + 0.08 * Math.sin(t * 4);
  g.save();
  g.translate(px + 16, py + 16);
  g.scale(s, s);
  const gr = g.createRadialGradient(0, 0, 2, 0, 0, 15);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, p.enemyColor); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 15, 0, 7); g.fill();
  g.strokeStyle = p.enemyColor; g.lineWidth = 1.6;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + t * 0.4;
    g.beginPath(); g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); g.quadraticCurveTo(Math.cos(a + 0.4) * 11, Math.sin(a + 0.4) * 11, Math.cos(a) * 15, Math.sin(a) * 15); g.stroke();
  }
  g.restore();
}

// ----------------------------------------------------------------- decoration

function timber(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vertical: boolean) {
  const gr = vertical ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#6f4f2e'); gr.addColorStop(0.5, '#8a6238'); gr.addColorStop(1, '#4b3520');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.8;
  if (vertical) { g.beginPath(); g.moveTo(x + w * 0.35, y); g.lineTo(x + w * 0.4, y + h); g.moveTo(x + w * 0.7, y); g.lineTo(x + w * 0.65, y + h); g.stroke(); }
  else { g.beginPath(); g.moveTo(x, y + h * 0.35); g.lineTo(x + w, y + h * 0.4); g.moveTo(x, y + h * 0.7); g.lineTo(x + w, y + h * 0.65); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function drawDecor(g: CanvasRenderingContext2D, d: number, px: number, py: number, t: number, x: number, y: number, p: PlanetDef) {
  g.save();
  g.translate(px, py);
  switch (d) {
    case D.POST:
      timber(g, 12, 0, 8, TILE, true);
      g.fillStyle = '#3f4651'; g.fillRect(11, 4, 10, 2.4); g.fillRect(11, 24, 10, 2.4);
      break;
    case D.BEAM:
      timber(g, 0, 0, TILE, 9, false);
      g.fillStyle = '#4b3520';
      g.beginPath(); g.moveTo(0, 9); g.lineTo(11, 9); g.lineTo(0, 20); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(TILE, 9); g.lineTo(TILE - 11, 9); g.lineTo(TILE, 20); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.strokeRect(0.5, 0.5, TILE - 1, 8);
      g.fillStyle = '#9ca3af'; g.fillRect(14, 3, 1.6, 1.6); g.fillRect(17, 3, 1.6, 1.6);
      break;
    case D.RAIL:
      for (let sx = 2; sx < TILE; sx += 11) { g.fillStyle = '#4b3520'; g.fillRect(sx, 27, 7, 4); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(sx, 30, 7, 1); }
      g.fillStyle = '#7b8494'; g.fillRect(0, 25.5, TILE, 2); g.fillStyle = '#c0c7d4'; g.fillRect(0, 25.5, TILE, 0.7);
      g.fillStyle = 'rgba(154,86,44,0.4)'; g.fillRect(((hash(x, y) % 24) | 0), 26, 5, 1.4);
      break;
    case D.LAMP:
    case D.LAMP_DEAD: {
      const alive = d === D.LAMP;
      const flick = alive ? (hash(x, y) % 5 === 0 ? 0.6 + 0.4 * Math.sin(t * 17 + x) : 1) : 0;
      g.strokeStyle = '#374151'; g.lineWidth = 1; g.beginPath(); g.moveTo(16, 0); g.lineTo(16, 8); g.stroke();
      g.fillStyle = '#374151'; g.fillRect(12, 8, 8, 3);
      if (alive) {
        const gr = g.createRadialGradient(16, 14, 1, 16, 14, 14);
        gr.addColorStop(0, `rgba(255,214,120,${0.55 * flick})`); gr.addColorStop(1, 'rgba(255,180,60,0)');
        g.fillStyle = gr; g.fillRect(0, 0, TILE, 30);
      }
      g.fillStyle = alive ? `rgba(255,226,150,${0.6 + 0.4 * flick})` : '#2b3340';
      g.beginPath(); g.ellipse(16, 14, 4, 4.4, 0, 0, 7); g.fill();
      g.strokeStyle = '#1f2937'; g.lineWidth = 1; g.stroke();
      if (!alive) { g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(14, 12); g.lineTo(17, 15); g.lineTo(15, 17); g.stroke(); }
      break;
    }
    case D.CART: {
      for (let sx = 2; sx < TILE; sx += 11) { g.fillStyle = '#4b3520'; g.fillRect(sx, 27, 7, 4); }
      g.fillStyle = '#7b8494'; g.fillRect(0, 25.5, TILE, 2);
      g.fillStyle = '#6b4a2a'; g.beginPath(); g.moveTo(3, 12); g.lineTo(29, 12); g.lineTo(26, 24); g.lineTo(6, 24); g.closePath(); g.fill();
      g.strokeStyle = '#2b2118'; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = '#3f4651'; g.fillRect(3, 12, 26, 2.2); g.fillRect(4, 19, 24, 1.6);
      g.fillStyle = '#eab308'; for (const [ox, oy, r] of [[10, 11, 3], [16, 9.6, 3.6], [22, 11, 3]]) { g.beginPath(); g.arc(ox, oy, r, Math.PI, 0); g.fill(); }
      g.fillStyle = '#111827'; for (const wx of [9, 23]) { g.beginPath(); g.arc(wx, 25, 3.2, 0, 7); g.fill(); g.strokeStyle = '#9ca3af'; g.lineWidth = 0.8; g.stroke(); }
      break;
    }
    case D.LADDER:
      g.fillStyle = '#6f4f2e'; g.fillRect(9, 0, 2.6, TILE); g.fillRect(20.4, 0, 2.6, TILE);
      g.fillStyle = '#8a6238'; for (let ry = 3; ry < TILE; ry += 8) g.fillRect(9, ry, 14, 2.2);
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(9, 0, 0.8, TILE);
      break;
    case D.SIGN:
      g.fillStyle = '#4b3520'; g.fillRect(15, 14, 2.4, 18);
      g.fillStyle = '#d4a017'; g.beginPath(); g.moveTo(16, 3); g.lineTo(27, 21); g.lineTo(5, 21); g.closePath(); g.fill();
      g.strokeStyle = '#1c1917'; g.lineWidth = 1.4; g.stroke();
      g.fillStyle = '#1c1917'; g.fillRect(15.2, 9, 1.8, 7); g.fillRect(15.2, 17.4, 1.8, 1.8);
      break;
    case D.PIPE: {
      const gr = g.createLinearGradient(0, 4, 0, 12);
      gr.addColorStop(0, '#8b5e3c'); gr.addColorStop(0.5, '#a97142'); gr.addColorStop(1, '#5a3b22');
      g.fillStyle = gr; g.fillRect(0, 4, TILE, 8);
      g.fillStyle = '#374151'; g.fillRect(14, 3, 4, 10);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 5, TILE, 1.4);
      if (hash(x, y) % 6 === 0) {
        g.fillStyle = 'rgba(203,213,225,0.35)';
        for (let i = 0; i < 3; i++) { const k = ((t * 1.4 + i * 0.33) % 1); g.beginPath(); g.arc(16 + Math.sin(k * 6 + i) * 2, 13 + k * 10, 1.5 + k * 3, 0, 7); g.globalAlpha = 0.5 * (1 - k); g.fill(); g.globalAlpha = 1; }
      }
      break;
    }
    case D.WEB:
      g.strokeStyle = 'rgba(226,232,240,0.28)'; g.lineWidth = 0.8;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, 0); g.lineTo(TILE * 0.8, i * 7.5); g.stroke(); }
      for (const r of [8, 14, 20]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI / 2); g.stroke(); }
      break;
    case D.BONES:
      g.fillStyle = '#3b424d'; g.fillRect(9, 20, 15, 5);
      g.fillStyle = '#4b5563'; g.fillRect(7, 15, 8, 8);
      g.fillStyle = '#111827'; g.fillRect(9, 17, 2.6, 2.6); g.fillRect(12.4, 17, 2.6, 2.6);
      g.fillStyle = '#7f1d1d'; g.fillRect(9.6, 17.6, 1.4, 1.4);
      g.strokeStyle = '#6b7280'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(14, 24); g.lineTo(22, 18); g.moveTo(18, 25); g.lineTo(27, 24); g.moveTo(11, 25); g.lineTo(5, 27); g.stroke();
      break;
    case D.BARREL:
      g.fillStyle = grad(g, '#8a4b2c', '#56301c'); g.fillRect(8, 10, 16, 21);
      g.fillStyle = '#374151'; g.fillRect(8, 13, 16, 2.2); g.fillRect(8, 25, 16, 2.2);
      g.fillStyle = '#d4a017'; g.fillRect(13, 17, 6, 6); g.fillStyle = '#1c1917'; g.fillRect(15, 18, 2, 3);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeRect(8.5, 10.5, 15, 20);
      break;
    case D.RELAY: {
      g.fillStyle = '#1f2937'; g.fillRect(4, 10, 24, 22);
      g.strokeStyle = p.primary; g.lineWidth = 1.4; g.strokeRect(4.5, 10.5, 23, 21);
      const on = 0.7 + 0.3 * Math.sin(t * 3);
      g.fillStyle = p.primary; g.globalAlpha = on; g.fillRect(8, 14, 16, 9); g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(9, 16, 10, 1.4); g.fillRect(9, 19, 7, 1.4);
      g.fillStyle = '#34d399'; g.fillRect(8, 26, 3, 2.4); g.fillStyle = '#fbbf24'; g.fillRect(13, 26, 3, 2.4);
      g.strokeStyle = '#9ca3af'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(16, 10); g.lineTo(16, 3); g.stroke();
      g.beginPath(); g.arc(16, 3, 3, Math.PI, 0); g.stroke();
      break;
    }
    case D.MERCHANT: {
      const bob = Math.sin(t * 2) * 0.8;
      g.fillStyle = '#111827'; for (const wx of [10, 22]) { g.beginPath(); g.arc(wx, 29, 3, 0, 7); g.fill(); }
      g.fillStyle = grad(g, '#7a5a36', '#4b3520'); g.fillRect(6, 11 + bob, 20, 17);
      g.strokeStyle = '#2b2118'; g.lineWidth = 1; g.strokeRect(6.5, 11.5 + bob, 19, 16);
      g.fillStyle = '#9ca3af'; g.fillRect(10, 5 + bob, 12, 8);
      g.fillStyle = '#facc15'; g.fillRect(12, 7.4 + bob, 2.6, 2.6); g.fillRect(17.4, 7.4 + bob, 2.6, 2.6);
      g.strokeStyle = '#9ca3af'; g.beginPath(); g.moveTo(26, 14 + bob); g.lineTo(30, 18 + bob); g.stroke();
      g.fillStyle = 'rgba(253,224,71,0.9)'; g.fillRect(28, 18 + bob, 3, 4);
      const gl = g.createRadialGradient(29.5, 20 + bob, 0, 29.5, 20 + bob, 9);
      gl.addColorStop(0, 'rgba(253,224,71,0.4)'); gl.addColorStop(1, 'rgba(253,224,71,0)');
      g.fillStyle = gl; g.fillRect(18, 10 + bob, 14, 20);
      g.fillStyle = '#fbbf24'; g.fillRect(9, 17 + bob, 14, 2.2); g.fillStyle = '#e5e7eb'; g.fillRect(11, 21 + bob, 4, 4); g.fillStyle = '#f87171'; g.fillRect(17, 21 + bob, 4, 4);
      break;
    }
    default:
      break;
  }
  g.restore();
}

/** Whether a decor type emits light, and how far (tiles). */
export function decorLight(d: number, x: number, y: number, t: number): number {
  if (d === D.LAMP) return (hash(x, y) % 5 === 0 ? 0.65 + 0.35 * Math.sin(t * 17 + x) : 1) * 3.6;
  if (d === D.RELAY) return 3.0;
  if (d === D.MERCHANT) return 3.0;
  return 0;
}
