/**
 * Hand-drawn (canvas path) actors: the rig, enemies, bosses, pickups and hazards. Everything
 * is drawn around its centre in pixel space (1 tile = 32px).
 */
import { PlanetDef, SURFACE_ROW, TILE } from './balance';
import type { Boulder, DrillEngine, Enemy, Pickup } from './engine';

type G = CanvasRenderingContext2D;

function rrect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function glow(g: G, x: number, y: number, r: number, color: string, alpha = 0.6) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha;
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
}

// ----------------------------------------------------------------- rig

const BODY = '#f0a818', BODY_HI = '#ffd978', BODY_LO = '#b8700c', STEEL = '#5b6677', STEEL_HI = '#8d99ab', DARK = '#161c27';

/** The mining rig: a tracked heavy digger. Its look follows the upgrades you bought (drill bit, plating, turret, lamps, hopper). */
export function drawRig(g: G, eng: DrillEngine, aim: { x: number; y: number } | null, t: number) {
  const p = eng.planet;
  const L = eng.stats.look;
  const cx = eng.x * TILE, cy = eng.y * TILE;
  const f = eng.facing;
  const moving = Math.abs(eng.vx) > 0.4;
  const hullFrac = eng.hull / eng.stats.maxHull;
  g.save();
  g.translate(cx, cy);

  // ---- thruster flames (side pods)
  if (eng.thrusting) {
    for (const sx of [-1, 1]) {
      const fl = 8 + Math.random() * 7;
      const gr = g.createLinearGradient(0, 8, 0, 8 + fl + 6);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#7dd3fc'); gr.addColorStop(1, 'rgba(56,189,248,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(sx * 13 - 3, 8); g.lineTo(sx * 13 + 3, 8); g.lineTo(sx * 13, 8 + fl + 6); g.closePath(); g.fill();
    }
  }

  // ---- everything below is drawn for a rig facing right and mirrored when facing left
  g.save();
  g.scale(f, 1);

  // exhaust smoke from the stack: heavier while digging or climbing
  const working = eng.digging || eng.thrusting || moving;
  for (let i = 0; i < 3; i++) {
    const k = ((t * (working ? 1.6 : 0.7)) + i / 3) % 1;
    g.globalAlpha = (1 - k) * (working ? 0.5 : 0.22);
    g.fillStyle = '#9ca3af';
    g.beginPath(); g.arc(-11 - k * 4, -18 - k * 12, 1.5 + k * 3.2, 0, 7); g.fill();
  }
  g.globalAlpha = 1;

  // ---- tracks with road wheels
  g.fillStyle = DARK; rrect(g, -17, 3, 34, 11, 5.5); g.fill();
  g.strokeStyle = '#2b3442'; g.lineWidth = 1;
  const roll = (eng.x * 16) % 4;
  for (let i = -15; i < 16; i += 4) { g.beginPath(); g.moveTo(i + roll, 3.5); g.lineTo(i + roll, 5.2); g.moveTo(i + roll, 11.8); g.lineTo(i + roll, 13.5); g.stroke(); }
  for (const wx of [-11, -4, 3, 10]) {
    g.fillStyle = STEEL; g.beginPath(); g.arc(wx, 8.5, 3.3, 0, 7); g.fill();
    g.strokeStyle = DARK; g.lineWidth = 1; g.stroke();
    g.strokeStyle = STEEL_HI; g.lineWidth = 0.9;
    const a = (eng.x * 0.6 + wx) % 6.28;
    g.beginPath(); g.moveTo(wx, 8.5); g.lineTo(wx + Math.cos(a) * 2.6, 8.5 + Math.sin(a) * 2.6); g.stroke();
  }
  g.fillStyle = BODY_LO; g.fillRect(-12, 3, 24, 2); // track guard
  g.fillStyle = BODY; g.fillRect(-12, 1.5, 24, 1.8);

  // ---- hull: engine bay, chassis, hood
  const hull = g.createLinearGradient(0, -10, 0, 4);
  hull.addColorStop(0, BODY_HI); hull.addColorStop(0.35, BODY); hull.addColorStop(1, BODY_LO);
  g.fillStyle = hull;
  rrect(g, -15, -9, 14, 12, 2.5); g.fill();           // engine bay (rear)
  g.strokeStyle = DARK; g.lineWidth = 1.1; g.stroke();
  rrect(g, -1, -3, 17, 8, 2); g.fill(); g.stroke();   // chassis and hood
  g.beginPath(); g.moveTo(9, -3); g.lineTo(16, -1); g.lineTo(16, 5); g.lineTo(9, 5); g.closePath(); g.fill(); g.stroke(); // sloped nose
  // armour plates grow with hull upgrades
  for (let i = 0; i < Math.min(L.hull, 5); i++) {
    g.fillStyle = i % 2 ? STEEL : STEEL_HI;
    g.fillRect(-14 + i * 3.4, -8.2, 2.8, 2.2);
  }
  if (L.hull >= 3) { g.fillStyle = STEEL; g.fillRect(3, 3.2, 12, 1.8); }
  // hazard band and rivets
  g.save(); g.beginPath(); g.rect(-14, 0.5, 29, 2.2); g.clip();
  for (let x = -18; x < 20; x += 5) { g.fillStyle = DARK; g.beginPath(); g.moveTo(x, 2.7); g.lineTo(x + 2.5, 2.7); g.lineTo(x + 5.5, 0.5); g.lineTo(x + 3, 0.5); g.closePath(); g.fill(); }
  g.restore();
  g.fillStyle = BODY_HI; for (const [rx, ry] of [[-13, -7], [-3, -7], [1, -2], [14, 0]]) g.fillRect(rx, ry, 1, 1);
  // engine grille and vent glow while working
  g.fillStyle = DARK; g.fillRect(-13, -4.8, 8, 4);
  g.strokeStyle = working ? '#fb923c' : '#475569'; g.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-12.5, -4.2 + i); g.lineTo(-5.5, -4.2 + i); g.stroke(); }
  // exhaust stack
  g.fillStyle = STEEL; g.fillRect(-12.5, -15, 3, 7); g.fillStyle = DARK; g.fillRect(-13, -16, 4, 1.8);

  // ---- ore hopper on the engine bay deck: the heap grows as you fill the cargo hold
  const fill = Math.min(1, Math.max(0, (eng.cargo.scrapOre + eng.cargo.crystal + eng.cargo.core) / Math.max(1, eng.stats.cargoCap)));
  g.fillStyle = '#2a3342'; g.beginPath(); g.moveTo(-15.5, -9); g.lineTo(-14.5, -13); g.lineTo(-6.5, -13); g.lineTo(-5.5, -9); g.closePath(); g.fill();
  g.strokeStyle = DARK; g.lineWidth = 1; g.stroke();
  if (fill > 0.04) {
    const n = Math.ceil(fill * 6);
    for (let i = 0; i < n; i++) {
      const hx = -13.5 + (i % 3) * 3.2, hy = -13.2 - Math.floor(i / 3) * 2.2 - (i % 2) * 0.6;
      g.fillStyle = i % 3 === 0 && eng.cargo.crystal > 0 ? '#e879f9' : i % 4 === 3 && eng.cargo.core > 0 ? '#34d399' : '#eab308';
      g.beginPath(); g.arc(hx + 1, hy, 1.9, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(hx + 0.2, hy - 1, 0.9, 0.9);
    }
  }

  // ---- cabin: roll cage, glass, pilot
  g.fillStyle = BODY; rrect(g, 0, -13, 12, 11, 2); g.fill();
  g.strokeStyle = DARK; g.lineWidth = 1.1; g.stroke();
  const glass = g.createLinearGradient(2, -12, 10, -4);
  glass.addColorStop(0, '#d6f4ff'); glass.addColorStop(0.5, '#38bdf8'); glass.addColorStop(1, '#0c4a6e');
  g.fillStyle = glass; rrect(g, 2, -11.5, 8, 7, 1.5); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.moveTo(3, -11); g.lineTo(5.5, -11); g.lineTo(3.5, -6); g.lineTo(3, -6); g.closePath(); g.fill();
  g.fillStyle = 'rgba(12,20,32,0.7)'; g.beginPath(); g.arc(5.5, -7.6, 1.9, 0, 7); g.fill(); g.fillRect(4, -6.2, 3, 2); // pilot
  g.fillStyle = '#facc15'; g.fillRect(4.5, -8.6, 2, 0.8); // helmet lamp
  g.strokeStyle = DARK; g.lineWidth = 1; g.beginPath(); g.moveTo(2, -4.5); g.lineTo(10, -4.5); g.moveTo(6, -11.5); g.lineTo(6, -4.5); g.stroke();

  // roof: rotating beacon and the floodlight bar (more lamps with Headlamp upgrades)
  g.fillStyle = STEEL; g.fillRect(1, -14.6, 10, 1.6);
  const lamps = 2 + Math.min(L.lamp, 4);
  for (let i = 0; i < lamps; i++) {
    const lx = 1.6 + i * (8.4 / Math.max(1, lamps - 1)); g.fillStyle = '#fef9c3'; g.fillRect(lx - 0.7, -15.8, 1.4, 1.4);
  }
  glow(g, 12, -13, 9 + L.lamp * 1.4, '#fef08a', 0.28);
  const beacon = Math.floor(t * 3) % 2;
  g.fillStyle = beacon ? '#f97316' : '#7c2d12'; g.fillRect(-1, -16.3, 2.4, 2); if (beacon) glow(g, 0.2, -15.4, 7, '#fb923c', 0.55);

  // headlight on the nose
  g.fillStyle = '#fef9c3'; g.fillRect(15, 0, 1.6, 2.4); glow(g, 17, 1.2, 8, '#fef08a', 0.4);

  // damage: smoke and sparks when the hull is low, scratches when worn
  if (hullFrac < 0.6) { g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(4, -3); g.lineTo(7, 0); g.lineTo(5, 3); g.moveTo(-9, -7); g.lineTo(-6, -4); g.stroke(); }
  g.restore(); // un-mirror

  // ---- boom arm and drill: points where you are digging, rests forward when idle
  let ang = f > 0 ? 0.35 : Math.PI - 0.35;
  let reach = 0.55;
  if (eng.digTarget) {
    const dx = eng.digTarget.x + 0.5 - eng.x, dy = eng.digTarget.y + 0.5 - eng.y;
    ang = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? Math.PI / 2 : -Math.PI / 2) : (dx > 0 ? 0 : Math.PI);
    reach = 1;
  }
  const dir = Math.cos(ang) >= 0 ? 1 : -1;
  const down = Math.sin(ang) > 0.7;
  const baseX = down ? dir * 1 : dir * 13, baseY = down ? 7 : 3;
  const drillLen = (11 + L.drill * 0.8) * reach;
  g.save();
  g.translate(baseX, baseY);
  g.rotate(ang);
  // hydraulic boom: piston and sleeve
  g.fillStyle = STEEL; rrect(g, -1, -2.6, 8 * Math.max(reach, 0.7), 5.2, 1.5); g.fill();
  g.strokeStyle = DARK; g.lineWidth = 0.9; g.stroke();
  g.fillStyle = STEEL_HI; g.fillRect(1, -1.4, 6 * Math.max(reach, 0.7), 1.2);
  g.fillStyle = '#e5e7eb'; g.fillRect(6 * Math.max(reach, 0.7), -1.6, 3 + drillLen * 0.15, 3.2);
  // drill bit: conical, spiral flutes; larger and shinier with upgrades
  const bitStart = 8 * Math.max(reach, 0.7), bitW = 4.6 + L.drill * 0.55;
  const steel = g.createLinearGradient(0, -bitW, 0, bitW);
  steel.addColorStop(0, '#f3f4f6'); steel.addColorStop(0.5, '#9ca3af'); steel.addColorStop(1, '#4b5563');
  g.fillStyle = steel;
  g.beginPath(); g.moveTo(bitStart, -bitW); g.lineTo(bitStart + drillLen * 0.9, 0); g.lineTo(bitStart, bitW); g.closePath(); g.fill();
  g.strokeStyle = DARK; g.lineWidth = 0.9; g.stroke();
  g.strokeStyle = 'rgba(17,24,39,0.8)'; g.lineWidth = 1.3;
  const spin = eng.digging ? t * 40 : 0;
  for (let i = 0; i < 4; i++) {
    const o = ((spin + i * 4.2) % 17) / 17;
    const sx = bitStart + o * drillLen * 0.78, w = bitW * (1 - o * 0.9);
    g.beginPath(); g.moveTo(sx, -w); g.lineTo(sx + 2.4, w); g.stroke();
  }
  const tip = L.drill >= 5 ? '#fde047' : L.drill >= 3 ? '#67e8f9' : '#d1d5db';
  g.fillStyle = tip; g.beginPath(); g.arc(bitStart + drillLen * 0.9, 0, 1.6 + L.drill * 0.12, 0, 7); g.fill();
  if (eng.digging) {
    glow(g, bitStart + drillLen * 0.9, 0, 11, '#fde68a', 0.55);
    for (let i = 0; i < 3; i++) { const k = (t * 9 + i * 0.33) % 1; g.fillStyle = `rgba(255,${200 - i * 30},90,${1 - k})`; g.fillRect(bitStart + drillLen * 0.9 + k * 6, (i - 1) * 3 * k - 0.5, 1.6, 1.6); }
  }
  g.restore();

  // ---- roof gun on a swivel; barrel grows with blaster upgrades
  let ba = f > 0 ? 0 : Math.PI;
  if (aim) ba = Math.atan2(aim.y - (eng.y - 0.1), aim.x - eng.x);
  g.save();
  g.translate(f * 5, -15.6);
  g.fillStyle = STEEL; g.beginPath(); g.arc(0, 1, 3.4, Math.PI, 0); g.fill();
  g.strokeStyle = DARK; g.lineWidth = 0.9; g.stroke();
  g.rotate(ba);
  g.fillStyle = DARK; rrect(g, 0, -2, 11 + L.blaster * 1.4, 4, 1.2); g.fill();
  g.fillStyle = STEEL_HI; g.fillRect(2, -1.2, 5 + L.blaster, 1.4);
  g.fillStyle = p.primary; g.fillRect(9 + L.blaster * 1.4, -2, 3, 4);
  if (L.blaster >= 3) { g.fillStyle = STEEL; g.fillRect(4, 2, 4, 1.6); g.fillRect(4, -3.6, 4, 1.6); }
  if (eng.fireCd > 0.6 / eng.stats.blasterRate) glow(g, 14 + L.blaster * 1.4, 0, 9, '#ffffff', 0.9);
  g.restore();

  if (eng.shield > 0) {
    const recent = eng.shieldDelay > 3.6;
    g.globalAlpha = recent ? 0.6 : 0.12 + 0.05 * Math.sin(t * 3) + L.shield * 0.012;
    g.strokeStyle = '#7dd3fc'; g.lineWidth = recent ? 2.6 : 1.4;
    g.beginPath(); g.arc(0, -3, 25, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  if (eng.slowT > 0) { g.strokeStyle = 'rgba(186,230,253,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, -3, 21 + Math.sin(t * 8), 0, Math.PI * 2); g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]); }
  if (eng.burnT > 0) glow(g, 0, -2, 24, '#f97316', 0.4 + 0.2 * Math.sin(t * 20));
  if (hullFrac < 0.35) {
    for (let i = 0; i < 3; i++) { const k = (t * 1.3 + i / 3) % 1; g.globalAlpha = (1 - k) * 0.5; g.fillStyle = '#374151'; g.beginPath(); g.arc(-3 + i * 3, -16 - k * 14, 2 + k * 3, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    if (Math.sin(t * 17) > 0.8) { g.fillStyle = '#fde68a'; g.fillRect(-6 + (Math.sin(t * 30) * 8), -8, 1.6, 1.6); }
  }
  if (eng.hurtFlash > 0) {
    g.globalAlpha = Math.min(0.55, eng.hurtFlash * 2.5);
    g.fillStyle = '#fecaca'; rrect(g, -16, -14, 32, 27, 5); g.fill();
    g.globalAlpha = 1;
  }
  g.restore();
}

// ----------------------------------------------------------------- enemies

export function drawEnemy(g: G, eng: DrillEngine, e: Enemy, t: number) {
  const p = eng.planet;
  const cx = e.x * TILE, cy = e.y * TILE;
  const toRig = eng.x >= e.x ? 1 : -1;
  g.save();
  g.translate(cx, cy);
  if (e.flash > 0) g.globalAlpha = 0.62;
  switch (e.kind) {
    case 'mite': drawMite(g, e, p, t); break;
    case 'bat': drawBat(g, e, p, toRig, t); break;
    case 'sentry': drawSentry(g, e, p, t); break;
    case 'brute': drawBrute(g, e, p, toRig, t); break;
    case 'raider': drawRaider(g, e, t); break;
    case 'phantom': drawPhantom(g, e, p, t); break;
    case 'drone': drawVoidDrone(g, e, p, t); break;
    default: break;
  }
  g.restore();
  g.globalAlpha = 1;
  if (e.kind === 'worm') drawWorm(g, e, p, t);
  if (e.hp < e.maxHp && e.kind !== 'worm') hpBar(g, cx, cy - e.radius * TILE - 8, 24, e.hp / e.maxHp);
  if (e.kind === 'worm' && e.hp < e.maxHp && e.state !== 'emerge') hpBar(g, e.x * TILE, e.y * TILE - 18, 26, e.hp / e.maxHp);
}

function hpBar(g: G, x: number, y: number, w: number, f: number) {
  g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
  g.fillStyle = f > 0.5 ? '#4ade80' : f > 0.25 ? '#fbbf24' : '#f87171';
  g.fillRect(x - w / 2, y, w * Math.max(0, f), 3);
}

function drawMite(g: G, e: Enemy, p: PlanetDef, t: number) {
  const lunge = e.state === 'lunge';
  g.rotate(e.angle);
  const s = lunge ? 1.15 : 1;
  g.scale(s, s);
  // legs: three per side, two joints each
  g.strokeStyle = '#0b0f17'; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 3; i++) {
      const ph = Math.sin(e.phase * 12 + i * 2.1 + (side > 0 ? 1.5 : 0));
      const bx = -4 + i * 4.4, by = side * 3;
      const kx = bx + (i - 1) * 3 + ph * 2, ky = by + side * 7;
      const fx = kx + (i - 1) * 2 + ph * 3, fy = ky + side * 4.5;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(kx, ky); g.lineTo(fx, fy); g.stroke();
    }
  }
  // abdomen + carapace
  const bg = g.createRadialGradient(-3, -2, 1, -2, 0, 11);
  bg.addColorStop(0, '#4b5563'); bg.addColorStop(1, '#151a24');
  g.fillStyle = bg;
  g.beginPath(); g.ellipse(-4, 0, 8.5, 6.2, 0, 0, 7); g.fill();
  g.strokeStyle = p.enemyColor; g.lineWidth = 1.1; g.stroke();
  g.fillStyle = '#242b38'; g.beginPath(); g.ellipse(3.5, 0, 5.2, 4.2, 0, 0, 7); g.fill(); g.stroke();
  // plating ridges + glowing circuit seam
  g.strokeStyle = `${p.enemyColor}aa`; g.lineWidth = 0.9;
  for (const rx of [-8, -5, -2]) { g.beginPath(); g.moveTo(rx, -4.6); g.lineTo(rx, 4.6); g.stroke(); }
  // eyes + mandibles
  g.fillStyle = '#ef4444'; g.beginPath(); g.arc(6.2, -1.8, 1.5, 0, 7); g.arc(6.2, 1.8, 1.5, 0, 7); g.fill();
  glow(g, 6.2, 0, 7, '#ef4444', lunge ? 0.7 : 0.35);
  g.strokeStyle = '#9ca3af'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(8, -1); g.lineTo(11, -2.6); g.moveTo(8, 1); g.lineTo(11, 2.6); g.stroke();
  void t;
}

function drawBat(g: G, e: Enemy, p: PlanetDef, dir: number, t: number) {
  g.scale(dir, 1);
  const flap = Math.sin(e.phase * 18);
  // wings
  g.fillStyle = '#10151f'; g.strokeStyle = p.enemyColor; g.lineWidth = 1;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, -1);
    g.quadraticCurveTo(s * 9, -9 - flap * 4, s * 16, -2 + flap * 3);
    g.quadraticCurveTo(s * 12, 0, s * 9, 1);
    g.quadraticCurveTo(s * 6, -1, s * 3, 2);
    g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(0, -1); g.lineTo(s * 14, -2 + flap * 2.6); g.moveTo(0, -1); g.lineTo(s * 11, 0.5 + flap * 1.4); g.stroke();
  }
  // body
  g.fillStyle = '#242b38'; g.beginPath(); g.ellipse(0, 1, 4.2, 5.4, 0, 0, 7); g.fill(); g.strokeStyle = p.enemyColor; g.stroke();
  g.fillStyle = '#242b38'; g.beginPath(); g.moveTo(-3.4, -3); g.lineTo(-2, -8); g.lineTo(-0.4, -3); g.moveTo(3.4, -3); g.lineTo(2, -8); g.lineTo(0.4, -3); g.fill();
  g.fillStyle = '#ef4444'; g.fillRect(-2.6, -1.2, 1.9, 1.9); g.fillRect(0.8, -1.2, 1.9, 1.9);
  glow(g, 0, -0.2, 8, '#ef4444', 0.4);
  // rusty antenna with blinking tip
  g.strokeStyle = '#9ca3af'; g.beginPath(); g.moveTo(0, -4); g.lineTo(1, -9); g.stroke();
  g.fillStyle = Math.floor(t * 4) % 2 ? '#fbbf24' : '#78350f'; g.fillRect(0, -10.5, 2, 2);
}

function drawSentry(g: G, e: Enemy, p: PlanetDef, t: number) {
  // mounting plate on the ceiling
  g.fillStyle = '#2b3340'; g.fillRect(-9, -13, 18, 5);
  g.strokeStyle = '#0f172a'; g.lineWidth = 1; g.strokeRect(-9, -13, 18, 5);
  g.fillStyle = '#9ca3af'; g.fillRect(-7, -11.4, 1.6, 1.6); g.fillRect(5.4, -11.4, 1.6, 1.6);
  g.strokeStyle = '#4b5563'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -9); g.lineTo(0, -3); g.stroke();
  // rusty turret ball
  const bg = g.createRadialGradient(-3, -2, 1, 0, 0, 11);
  bg.addColorStop(0, '#8b6a52'); bg.addColorStop(0.5, '#5b4636'); bg.addColorStop(1, '#241b14');
  g.fillStyle = bg; g.beginPath(); g.arc(0, 2, 10, 0, 7); g.fill();
  g.strokeStyle = '#0f172a'; g.lineWidth = 1.2; g.stroke();
  g.strokeStyle = 'rgba(154,86,44,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-6, 0); g.lineTo(-2, 6); g.moveTo(3, -3); g.lineTo(7, 3); g.stroke();
  // barrel
  g.save(); g.translate(0, 2); g.rotate(e.angle);
  g.fillStyle = '#111827'; rrect(g, 2, -2.6, 15, 5.2, 1.5); g.fill();
  g.fillStyle = '#4b5563'; g.fillRect(5, -1.6, 7, 3.2);
  const charging = e.state === 'burst';
  g.fillStyle = charging ? '#fef08a' : p.hazardColor; g.fillRect(15, -1.8, 3, 3.6);
  if (charging) glow(g, 19, 0, 10, '#fde047', 0.8);
  g.restore();
  // lens
  g.fillStyle = '#ef4444'; g.beginPath(); g.arc(Math.cos(e.angle) * 3.4, 2 + Math.sin(e.angle) * 3.4, 2, 0, 7); g.fill();
  // sparks from damage
  if (Math.sin(t * 9 + e.id) > 0.93) { g.fillStyle = '#fde68a'; g.fillRect(-6 + (e.id % 5), -1, 2, 2); g.fillRect(4, 6, 1.6, 1.6); }
}

function drawBrute(g: G, e: Enemy, p: PlanetDef, dir: number, t: number) {
  const windup = e.state === 'windup', charge = e.state === 'charge';
  g.scale(dir, 1);
  if (charge) g.rotate(0.15);
  const stomp = Math.abs(Math.sin(e.phase * 4)) * 2;
  // legs
  g.fillStyle = '#10151f'; g.strokeStyle = '#0b0f17'; g.lineWidth = 1;
  rrect(g, -9, 8 - stomp * 0.4, 7, 11 + stomp * 0.4, 2); g.fill(); g.stroke();
  rrect(g, 2, 8 + stomp * 0.4, 7, 11 - stomp * 0.4, 2); g.fill(); g.stroke();
  // torso
  const tg = g.createLinearGradient(0, -14, 0, 10);
  tg.addColorStop(0, '#5b6270'); tg.addColorStop(1, '#2a303c');
  g.fillStyle = tg; rrect(g, -13, -13, 26, 24, 5); g.fill();
  g.strokeStyle = windup ? '#ef4444' : p.enemyColor; g.lineWidth = 1.5; g.stroke();
  // furnace chest
  const fg = g.createRadialGradient(0, -1, 1, 0, -1, 8);
  fg.addColorStop(0, windup ? '#fff' : '#fde68a'); fg.addColorStop(0.5, windup ? '#ef4444' : '#f97316'); fg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fg; g.beginPath(); g.arc(0, -1, 8, 0, 7); g.fill();
  g.strokeStyle = '#111827'; g.lineWidth = 1; g.beginPath(); g.moveTo(-6, -1); g.lineTo(6, -1); g.moveTo(-5, 2); g.lineTo(5, 2); g.stroke();
  // shoulders
  g.fillStyle = '#3b4252'; g.beginPath(); g.arc(-13, -9, 6, 0, 7); g.arc(13, -9, 6, 0, 7); g.fill();
  g.strokeStyle = '#0b0f17'; g.stroke();
  g.fillStyle = '#d4a017'; g.fillRect(-16, -11, 6, 2); g.fillRect(10, -11, 6, 2);
  // head with visor
  g.fillStyle = '#1b212c'; rrect(g, -5, -20, 10, 8, 2); g.fill(); g.strokeStyle = '#0b0f17'; g.stroke();
  g.fillStyle = '#ef4444'; g.fillRect(-3.4, -17.4, 6.8, 2); glow(g, 0, -16.4, 8, '#ef4444', windup ? 0.8 : 0.4);
  // drill fist
  const fx = 17 + (charge ? 4 : Math.sin(t * 5) * 1.4);
  g.fillStyle = '#374151'; rrect(g, 10, -3, 8, 10, 2); g.fill(); g.stroke();
  g.fillStyle = '#d1d5db'; g.beginPath(); g.moveTo(fx, -4); g.lineTo(fx + 10, 2); g.lineTo(fx, 8); g.closePath(); g.fill();
  g.strokeStyle = '#111827'; g.beginPath(); g.moveTo(fx + 2, -1); g.lineTo(fx + 5, 5); g.stroke();
  if (windup) glow(g, 0, 0, 30, '#ef4444', 0.25 + 0.2 * Math.sin(t * 30));
}

function drawRaider(g: G, e: Enemy, t: number) {
  g.rotate(Math.max(-0.4, Math.min(0.4, e.vx * 0.08)));
  // rotors
  for (const rx of [-13, 13]) {
    g.fillStyle = 'rgba(148,163,184,0.45)'; g.beginPath(); g.ellipse(rx, -5, 9, 1.8, 0, 0, 7); g.fill();
    g.strokeStyle = '#1f2937'; g.lineWidth = 2; g.beginPath(); g.moveTo(rx, -5); g.lineTo(rx * 0.55, 0); g.stroke();
  }
  // body
  g.fillStyle = '#0f172a'; g.strokeStyle = '#f87171'; g.lineWidth = 1.6;
  g.beginPath(); g.ellipse(0, 2, 11, 6.5, 0, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#7f1d1d'; g.beginPath(); g.ellipse(0, -0.5, 6, 5, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#fca5a5'; g.fillRect(-1.6, -1.6, 3.2, 3.2);
  glow(g, 0, 0, 9, '#ef4444', 0.45);
  // under-slung gun and nav lights
  g.fillStyle = '#4b5563'; g.fillRect(-2, 7, 4, 6);
  for (let i = -1; i <= 1; i += 2) { g.globalAlpha = (Math.floor(t * 6) + i) % 2 === 0 ? 1 : 0.25; g.fillStyle = '#f87171'; g.fillRect(i * 8 - 1, 3, 2.4, 2.4); }
  g.globalAlpha = 1;
}

function drawPhantom(g: G, e: Enemy, p: PlanetDef, t: number) {
  g.globalAlpha = Math.max(0.12, e.alpha) * (e.flash > 0 ? 0.7 : 1);
  const w = Math.sin(t * 4 + e.id);
  // tail wisps
  g.strokeStyle = p.enemyColor; g.lineWidth = 2; g.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    g.beginPath(); g.moveTo(i * 3.2, 5);
    g.bezierCurveTo(i * 3.5 + w * 3, 12, i * 2.6 - w * 3, 17, i * 3 + w * 2, 22 + (i % 2) * 3); g.stroke();
  }
  const bg = g.createRadialGradient(0, -2, 1, 0, 0, 14);
  bg.addColorStop(0, '#f5d0fe'); bg.addColorStop(0.55, p.enemyColor); bg.addColorStop(1, 'rgba(76,29,149,0.25)');
  g.fillStyle = bg;
  g.beginPath(); g.moveTo(-11, 6); g.bezierCurveTo(-13, -14, 13, -14, 11, 6);
  for (let i = 0; i < 4; i++) g.quadraticCurveTo(8 - i * 5.5, 11 + w * 1.4, 5.5 - i * 5.5, 6);
  g.closePath(); g.fill();
  g.fillStyle = '#1e1b4b'; g.beginPath(); g.ellipse(-4, -2, 2.4, 3.2, 0, 0, 7); g.ellipse(4, -2, 2.4, 3.2, 0, 0, 7); g.fill();
  g.fillStyle = '#f0abfc'; g.fillRect(-4.6, -3, 1.4, 1.4); g.fillRect(3.4, -3, 1.4, 1.4);
  glow(g, 0, 0, 22, p.enemyColor, 0.3);
  g.globalAlpha = 1;
}

function drawVoidDrone(g: G, e: Enemy, p: PlanetDef, t: number) {
  g.rotate(e.phase * 1.4);
  g.strokeStyle = p.enemyColor; g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, 9, 0, 7); g.stroke();
  g.strokeStyle = '#0b0f17'; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, 10.5, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, 7.5, 0, 7); g.stroke();
  g.fillStyle = '#1f2937';
  for (let i = 0; i < 4; i++) { g.save(); g.rotate(i * Math.PI / 2); g.beginPath(); g.moveTo(9, -2); g.lineTo(15, 0); g.lineTo(9, 2); g.closePath(); g.fill(); g.strokeStyle = p.enemyColor; g.lineWidth = 1; g.stroke(); g.restore(); }
  g.rotate(-e.phase * 1.4);
  const cg = g.createRadialGradient(0, 0, 0, 0, 0, 6);
  cg.addColorStop(0, '#fff'); cg.addColorStop(0.5, p.hazardColor); cg.addColorStop(1, '#4c0519');
  g.fillStyle = cg; g.beginPath(); g.arc(0, 0, 5.4, 0, 7); g.fill();
  glow(g, 0, 0, 16, p.enemyColor, 0.35 + 0.15 * Math.sin(t * 8));
}

function drawWorm(g: G, e: Enemy, p: PlanetDef, t: number) {
  if (e.state === 'emerge') {
    // warning: cracking ground and a dust ring where it will break out
    const k = 1 - Math.max(0, e.stateT) / 1.6;
    g.save(); g.translate(e.x * TILE, e.y * TILE);
    g.strokeStyle = `rgba(255,255,255,${0.2 + 0.4 * k})`; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { const a = i * 1.05 + k * 0.5; g.beginPath(); g.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); g.lineTo(Math.cos(a) * (8 + 8 * k), Math.sin(a) * (8 + 8 * k)); g.stroke(); }
    glow(g, 0, 0, 20 + 10 * k, p.enemyColor, 0.25 * k);
    g.restore();
    return;
  }
  const col = e.slows ? '#7dd3fc' : p.enemyColor;
  // body from tail to head
  for (let i = e.segs.length - 1; i >= 1; i--) {
    const s = e.segs[i];
    const r = (e.radius * 0.8 - i * 0.01) * TILE;
    const sg = g.createRadialGradient(s.x * TILE - 2, s.y * TILE - 2, 1, s.x * TILE, s.y * TILE, r + 2);
    sg.addColorStop(0, '#5b6270'); sg.addColorStop(1, '#1b212c');
    g.fillStyle = sg; g.beginPath(); g.arc(s.x * TILE, s.y * TILE, r, 0, 7); g.fill();
    g.strokeStyle = i % 2 ? col : '#0b0f17'; g.lineWidth = 1.4; g.stroke();
    if (i % 2 === 0) { g.fillStyle = `${col}88`; g.beginPath(); g.arc(s.x * TILE, s.y * TILE, r * 0.4, 0, 7); g.fill(); }
  }
  // head: drill mouth
  const h = e.segs[0];
  g.save(); g.translate(h.x * TILE, h.y * TILE); g.rotate(e.angle);
  if (e.flash > 0) g.globalAlpha = 0.65;
  g.fillStyle = '#2a303c'; g.beginPath(); g.ellipse(-1, 0, 10, 8.6, 0, 0, 7); g.fill(); g.strokeStyle = col; g.lineWidth = 1.6; g.stroke();
  g.fillStyle = '#d1d5db';
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + t * 12;
    g.beginPath(); g.moveTo(Math.cos(a) * 4, Math.sin(a) * 4 * 0.9 + 0);
    g.lineTo(Math.cos(a + 0.2) * 9.5 + 3, Math.sin(a + 0.2) * 8); g.lineTo(Math.cos(a - 0.2) * 9.5 + 3, Math.sin(a - 0.2) * 8); g.closePath(); g.fill();
  }
  g.fillStyle = '#111827'; g.beginPath(); g.arc(4, 0, 3.4, 0, 7); g.fill();
  glow(g, 4, 0, 11, col, 0.75);
  g.fillStyle = '#ef4444'; g.fillRect(-4, -4.6, 2, 2); g.fillRect(-4, 2.6, 2, 2);
  g.restore();
  g.globalAlpha = 1;
}

// ----------------------------------------------------------------- bosses

export function drawBoss(g: G, eng: DrillEngine, e: Enemy, t: number) {
  const p = eng.planet;
  const cx = e.x * TILE, cy = e.y * TILE;
  const R = e.radius * TILE;
  const hot = (e.atk === 'dash' || e.atk === 'blink' || e.atk === 'sweep') && e.atkN === 1;
  const accent = hot ? '#f87171' : p.enemyColor;
  g.save();
  g.translate(cx, cy);
  if (e.flash > 0) g.globalAlpha = 0.78;

  if (hot && e.atk === 'dash') {
    g.strokeStyle = 'rgba(248,113,113,0.7)'; g.lineWidth = 2; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(e.tx * TILE - cx, e.ty * TILE - cy); g.stroke(); g.setLineDash([]);
  }
  glow(g, 0, 0, R * 2.1, accent, 0.33);

  switch (p.id) {
    case 1: bossTitan(g, e, R, accent, t); break;
    case 2: bossMeltdown(g, e, R, accent, p, t); break;
    case 3: bossBrain(g, R, accent, t); break;
    case 4: bossKernel(g, e, R, accent, t); break;
    default: bossOmega(g, e, R, accent, p, t); break;
  }
  // tracking eye
  const ea = Math.atan2(eng.y - e.y, eng.x - e.x);
  const pulse = 1 + 0.12 * Math.sin(t * 6);
  const eg = g.createRadialGradient(Math.cos(ea) * 5, Math.sin(ea) * 5, 1, 0, 0, R * 0.5 * pulse);
  eg.addColorStop(0, '#fff'); eg.addColorStop(0.4, hot ? '#ef4444' : p.hazardColor); eg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = eg; g.beginPath(); g.arc(0, 0, R * 0.5 * pulse, 0, 7); g.fill();
  g.fillStyle = '#0b1220'; g.beginPath(); g.arc(Math.cos(ea) * 7, Math.sin(ea) * 7, 5, 0, 7); g.fill();
  g.restore();
  g.globalAlpha = 1;
}

function plates(g: G, e: Enemy, R: number, accent: string, n: number, speed: number) {
  for (let i = 0; i < n; i++) {
    const a = e.phase * speed + (i / n) * Math.PI * 2;
    g.save(); g.rotate(a); g.translate(R * 1.28, 0);
    g.fillStyle = '#0f172a'; g.strokeStyle = accent; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-8, -10); g.lineTo(10, -6); g.lineTo(10, 6); g.lineTo(-8, 10); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}

function bossTitan(g: G, e: Enemy, R: number, accent: string, t: number) {
  plates(g, e, R, accent, 6, 0.8);
  // trojan crest
  g.fillStyle = '#7f1d1d'; g.strokeStyle = '#111827'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-6, -R * 0.95); g.quadraticCurveTo(0, -R * 1.7 + Math.sin(t * 3) * 3, 10, -R * 0.8); g.lineTo(2, -R * 0.9); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#0b1220'; g.strokeStyle = accent; g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; const x = Math.cos(a) * R, y = Math.sin(a) * R; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = `${accent}88`; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, R * 0.72, 0, 7); g.stroke();
  g.fillStyle = '#d4a017'; for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.fillRect(Math.cos(a) * R * 0.86 - 2, Math.sin(a) * R * 0.86 - 2, 4, 4); }
}

function bossMeltdown(g: G, e: Enemy, R: number, accent: string, p: PlanetDef, t: number) {
  plates(g, e, R, accent, 5, 1.2);
  const sg = g.createRadialGradient(-R * 0.3, -R * 0.3, 2, 0, 0, R);
  sg.addColorStop(0, '#fde68a'); sg.addColorStop(0.35, '#f97316'); sg.addColorStop(1, '#3a0d05');
  g.fillStyle = sg; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  g.strokeStyle = '#1c0a05'; g.lineWidth = 2.4;
  for (let i = 0; i < 7; i++) { const a = i * 0.9 + e.phase * 0.15; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.25); g.lineTo(Math.cos(a + 0.35) * R * 0.62, Math.sin(a + 0.35) * R * 0.62); g.lineTo(Math.cos(a - 0.1) * R * 0.97, Math.sin(a - 0.1) * R * 0.97); g.stroke(); }
  g.strokeStyle = p.hazardColor; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R, 0, 7); g.stroke();
  for (let i = 0; i < 4; i++) { const a = e.phase * 2 + i * 1.57; glow(g, Math.cos(a) * R * 1.05, Math.sin(a) * R * 1.05, 12, '#fb923c', 0.8); }
  void t;
}

function bossBrain(g: G, R: number, accent: string, t: number) {
  // tentacles
  g.strokeStyle = accent; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const base = (i / 6) * Math.PI * 2 + 0.3;
    g.lineWidth = 5;
    g.beginPath();
    let px = Math.cos(base) * R * 0.8, py = Math.sin(base) * R * 0.8;
    g.moveTo(px, py);
    for (let k = 1; k <= 4; k++) {
      const a = base + Math.sin(t * 2 + i + k * 0.8) * 0.5;
      px += Math.cos(a) * R * 0.38; py += Math.sin(a) * R * 0.38;
      g.lineTo(px, py);
    }
    g.stroke();
    glow(g, px, py, 10, '#f0abfc', 0.8);
  }
  // wobbly brain mass
  const gr = g.createRadialGradient(-R * 0.3, -R * 0.3, 2, 0, 0, R);
  gr.addColorStop(0, '#f5d0fe'); gr.addColorStop(0.5, '#a855f7'); gr.addColorStop(1, '#2e1065');
  g.fillStyle = gr; g.strokeStyle = '#1e1b4b'; g.lineWidth = 2.4;
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rr = R * (1 + 0.08 * Math.sin(a * 5 + t * 2));
    i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.9) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.9);
  }
  g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(30,27,75,0.7)'; g.lineWidth = 1.8;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(0, 0, R * (0.35 + i * 0.16), -0.6 + i, 1.4 + i, false); g.stroke(); }
}

function bossKernel(g: G, e: Enemy, R: number, accent: string, t: number) {
  // orbiting ice shards
  for (let i = 0; i < 8; i++) {
    const a = e.phase * 0.9 + (i / 8) * Math.PI * 2;
    g.save(); g.rotate(a); g.translate(R * 1.4, 0); g.rotate(Math.PI / 2);
    g.fillStyle = '#e0f2fe'; g.strokeStyle = accent; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(4, 0); g.lineTo(0, 9); g.lineTo(-4, 0); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  // faceted crystal
  const pts = 8;
  g.fillStyle = '#0c2c4a'; g.strokeStyle = accent; g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i < pts; i++) { const a = (i / pts) * Math.PI * 2 + e.phase * 0.1; const rr = R * (i % 2 ? 0.8 : 1.08); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(224,242,254,0.55)'; g.lineWidth = 1.3;
  for (let i = 0; i < pts; i += 2) { const a = (i / pts) * Math.PI * 2 + e.phase * 0.1; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R * 1.05, Math.sin(a) * R * 1.05); g.stroke(); }
  g.fillStyle = 'rgba(224,242,254,0.14)'; g.beginPath(); g.moveTo(-R * 0.6, -R * 0.2); g.lineTo(0, -R * 0.9); g.lineTo(R * 0.3, -R * 0.1); g.closePath(); g.fill();
  void t;
}

function bossOmega(g: G, e: Enemy, R: number, accent: string, p: PlanetDef, t: number) {
  // glitching rings
  g.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    g.save(); g.rotate(e.phase * (0.7 + i * 0.35) * (i % 2 ? -1 : 1));
    g.strokeStyle = i === 0 ? accent : i === 1 ? p.accent : '#38bdf8';
    g.setLineDash([R * 0.6, R * 0.25]);
    g.beginPath(); g.arc(0, 0, R * (1.15 + i * 0.22), 0, 7); g.stroke();
    g.restore();
  }
  g.setLineDash([]);
  // chromatic-split cube
  const off = 2 + Math.sin(t * 13) * 1.8;
  for (const [dx, col] of [[-off, 'rgba(56,189,248,0.7)'], [off, 'rgba(244,63,94,0.7)']] as Array<[number, string]>) {
    g.save(); g.translate(dx, 0); g.rotate(e.phase * 0.5);
    g.fillStyle = col; g.fillRect(-R * 0.78, -R * 0.78, R * 1.56, R * 1.56); g.restore();
  }
  g.save(); g.rotate(e.phase * 0.5);
  g.fillStyle = '#0b0710'; g.strokeStyle = accent; g.lineWidth = 3;
  g.fillRect(-R * 0.78, -R * 0.78, R * 1.56, R * 1.56); g.strokeRect(-R * 0.78, -R * 0.78, R * 1.56, R * 1.56);
  g.strokeStyle = `${accent}88`; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(-R * 0.78, 0); g.lineTo(R * 0.78, 0); g.moveTo(0, -R * 0.78); g.lineTo(0, R * 0.78); g.stroke();
  g.restore();
  // scanline glitch bars
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 3; i++) g.fillRect(-R, ((t * 40 + i * 31) % (R * 2)) - R, R * 2, 2);
}

// ----------------------------------------------------------------- misc world objects

export function drawItem(g: G, it: Pickup, t: number) {
  const x = it.x * TILE, y = it.y * TILE + Math.sin(t * 4 + it.x) * 1.6;
  const col = it.kind === 'fuel' ? '#34d399' : it.kind === 'repair' ? '#f87171' : it.kind === 'bomb' ? '#fb923c' : it.kind === 'shield' ? '#38bdf8' : it.kind === 'core' ? '#c4b5fd' : '#facc15';
  glow(g, x, y, 15, col, 0.5);
  g.save(); g.translate(x, y);
  g.lineWidth = 1.3; g.strokeStyle = '#0b1220';
  if (it.kind === 'fuel') { g.fillStyle = col; rrect(g, -4, -6, 8, 11, 2); g.fill(); g.stroke(); g.fillStyle = '#064e3b'; g.fillRect(-1.5, -9, 3, 3); g.fillStyle = '#ecfdf5'; g.fillRect(-2, -2, 4, 1.6); }
  else if (it.kind === 'repair') { g.fillStyle = col; g.fillRect(-2, -6, 4, 12); g.fillRect(-6, -2, 12, 4); g.strokeRect(-2, -6, 4, 12); }
  else if (it.kind === 'bomb') { g.fillStyle = '#111827'; g.beginPath(); g.arc(0, 1, 5.4, 0, 7); g.fill(); g.strokeStyle = col; g.stroke(); g.fillStyle = col; g.fillRect(-0.8, -7, 1.8, 3); }
  else if (it.kind === 'shield') { g.fillStyle = col; g.beginPath(); g.moveTo(0, -6); g.lineTo(5.5, -3); g.lineTo(4, 4); g.lineTo(0, 7); g.lineTo(-4, 4); g.lineTo(-5.5, -3); g.closePath(); g.fill(); g.stroke(); }
  else if (it.kind === 'core') { const gr = g.createRadialGradient(0, 0, 0.5, 0, 0, 6); gr.addColorStop(0, '#fff'); gr.addColorStop(1, col); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 5.4, 0, 7); g.fill(); g.stroke(); }
  else { g.fillStyle = col; g.beginPath(); g.arc(0, 0, 5.4, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#92400e'; g.fillRect(-1, -3, 2, 6); g.fillRect(-3, -1, 6, 2); }
  g.restore();
}

export function drawBoulder(g: G, b: Boulder, t: number) {
  const x = b.x * TILE, y = b.y * TILE;
  if (b.tele > 0) {
    // warning: dust falling from the ceiling and a flashing marker
    g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 24);
    g.fillStyle = '#f87171'; g.fillRect(x - 5, y - 12, 10, 3);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(168,162,158,0.7)'; g.fillRect(x - 1 + Math.sin(t * 30) * 2, y - 4 + ((t * 30) % 10), 2, 2);
  }
  g.save(); g.translate(x, y + (b.tele > 0 ? Math.sin(t * 40) * 1 : 0)); g.rotate(b.y * 0.7);
  const gr = g.createRadialGradient(-3, -3, 1, 0, 0, 12);
  gr.addColorStop(0, '#a8a29e'); gr.addColorStop(1, '#44403c');
  g.fillStyle = gr; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const r = 11 + ((i * 37) % 5) - 2; i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fill(); g.strokeStyle = '#1c1917'; g.lineWidth = 1.6; g.stroke();
  g.restore();
}

export const SURFACE_Y = SURFACE_ROW * TILE;
