/** Procedural WebAudio effects, in the same zero-asset spirit as StudyOps' utils/audio.ts. */

let ctx: AudioContext | null = null;
let muted = false;
const last: Record<string, number> = {};

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (C) ctx = new C();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export const setMuted = (m: boolean) => { muted = m; };
export const isMuted = () => muted;

function throttle(name: string, ms: number): boolean {
  const now = performance.now();
  if (now - (last[name] ?? 0) < ms) return false;
  last[name] = now;
  return true;
}

interface ToneOpts { type?: OscillatorType; from: number; to?: number; dur: number; vol?: number; delay?: number }

function tone(o: ToneOpts) {
  const c = ac();
  if (!c || muted) return;
  try {
    const t0 = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.from, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    g.gain.setValueAtTime(o.vol ?? 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + o.dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  } catch { /* audio is best-effort */ }
}

function noise(dur: number, vol: number, lp: number, delay = 0) {
  const c = ac();
  if (!c || muted) return;
  try {
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(c.currentTime + delay);
  } catch { /* best-effort */ }
}

export const sfx = {
  shoot: () => throttle('shoot', 40) && tone({ type: 'square', from: 900, to: 220, dur: 0.09, vol: 0.06 }),
  hit: () => throttle('hit', 30) && tone({ type: 'triangle', from: 300, to: 120, dur: 0.07, vol: 0.09 }),
  hurt: () => throttle('hurt', 90) && (noise(0.18, 0.2, 700), tone({ type: 'sawtooth', from: 160, to: 60, dur: 0.18, vol: 0.1 })),
  dig: () => throttle('dig', 70) && noise(0.05, 0.07, 1600),
  ore: (tile: number) => {
    const base = tile === 5 ? 880 : tile === 4 ? 740 : 560;
    tone({ type: 'sine', from: base, to: base * 1.5, dur: 0.12, vol: 0.1 });
    tone({ type: 'sine', from: base * 1.5, dur: 0.1, vol: 0.06, delay: 0.07 });
  },
  explode: () => { noise(0.45, 0.3, 500); tone({ type: 'sawtooth', from: 120, to: 35, dur: 0.4, vol: 0.14 }); },
  bomb: () => tone({ type: 'square', from: 300, to: 300, dur: 0.05, vol: 0.06 }),
  enemyDie: (boss: boolean) => {
    tone({ type: 'sawtooth', from: boss ? 200 : 420, to: 60, dur: boss ? 0.9 : 0.2, vol: boss ? 0.2 : 0.09 });
    if (boss) noise(0.9, 0.3, 800);
  },
  dock: () => { [660, 880, 1100].forEach((f, i) => tone({ type: 'sine', from: f, dur: 0.14, vol: 0.09, delay: i * 0.08 })); },
  vault: () => { tone({ type: 'square', from: 220, to: 440, dur: 0.25, vol: 0.07 }); },
  emp: () => { noise(0.6, 0.25, 2500); tone({ type: 'sine', from: 200, to: 1400, dur: 0.5, vol: 0.12 }); },
  raid: () => { [0, 0.35].forEach((d) => tone({ type: 'sawtooth', from: 520, to: 380, dur: 0.3, vol: 0.1, delay: d })); },
  boss: () => { tone({ type: 'sawtooth', from: 70, to: 40, dur: 1.2, vol: 0.2 }); noise(1.0, 0.18, 300); },
  lowfuel: () => { [0, 0.2].forEach((d) => tone({ type: 'square', from: 440, dur: 0.1, vol: 0.07, delay: d })); },
  cargoFull: () => throttle('cargoFull', 600) && tone({ type: 'square', from: 200, dur: 0.14, vol: 0.07 }),
  nest: () => tone({ type: 'sawtooth', from: 90, to: 200, dur: 0.3, vol: 0.1 }),
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.3, vol: 0.12, delay: i * 0.12 })); },
  lose: () => { [440, 330, 220].forEach((f, i) => tone({ type: 'sawtooth', from: f, dur: 0.35, vol: 0.1, delay: i * 0.2 })); },
  click: () => tone({ type: 'sine', from: 600, to: 900, dur: 0.06, vol: 0.06 }),
};
