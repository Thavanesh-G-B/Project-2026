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

export const setMuted = (m: boolean) => { muted = m; music.setMuted(m); };
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
  pickup: () => { tone({ type: 'sine', from: 700, to: 1100, dur: 0.1, vol: 0.09 }); tone({ type: 'sine', from: 1100, dur: 0.1, vol: 0.06, delay: 0.07 }); },
  relay: () => { [440, 554, 659, 880].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.22, vol: 0.1, delay: i * 0.09 })); },
  rumble: () => throttle('rumble', 500) && (noise(0.7, 0.28, 220), tone({ type: 'sawtooth', from: 55, to: 38, dur: 0.7, vol: 0.12 })),
  tremor: () => { noise(1.4, 0.34, 260); tone({ type: 'sawtooth', from: 48, to: 30, dur: 1.4, vol: 0.16 }); },
  surge: (on: boolean) => { on ? (noise(0.9, 0.2, 3000), tone({ type: 'sawtooth', from: 1200, to: 80, dur: 0.9, vol: 0.12 })) : tone({ type: 'sine', from: 300, to: 900, dur: 0.5, vol: 0.1 }); },
  ambush: () => { [0, 0.12, 0.24].forEach((d) => tone({ type: 'square', from: 180, to: 120, dur: 0.1, vol: 0.12, delay: d })); noise(0.3, 0.25, 900); },
  turret: () => throttle('turret', 80) && tone({ type: 'square', from: 520, to: 260, dur: 0.07, vol: 0.05 }),
  warp: () => { tone({ type: 'sine', from: 120, to: 1600, dur: 1.2, vol: 0.14 }); noise(1.2, 0.18, 4000); },
  cleared: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.34, vol: 0.12, delay: i * 0.11 })); },
  merchant: () => { [523, 659].forEach((f, i) => tone({ type: 'sine', from: f, dur: 0.18, vol: 0.09, delay: i * 0.1 })); },
};

/**
 * Generative ambience: a low drone, a slow minor-scale pad and sparse echoing plucks.
 * `setIntensity` (0..1) adds a pulse for boss fights. Each planet has its own root note.
 */
const ROOTS: Record<number, number> = { 1: 55, 2: 49, 3: 58.27, 4: 61.74, 5: 46.25 };
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];

export const music = (() => {
  let master: GainNode | null = null;
  let timer: number | undefined;
  let nodes: AudioNode[] = [];
  let root = 55;
  let intensity = 0;
  let beat = 0;
  let on = false;
  let mutedM = false;

  const note = (semi: number) => root * Math.pow(2, semi / 12);

  function pluck(freq: number, vol: number, when = 0) {
    const c = ac();
    if (!c || !master) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 1.8);
    osc.connect(g); g.connect(master);
    // a cheap echo
    const d = c.createDelay(1); d.delayTime.value = 0.42;
    const fb = c.createGain(); fb.gain.value = 0.38;
    g.connect(d); d.connect(fb); fb.connect(d); d.connect(master);
    osc.start(t0); osc.stop(t0 + 2);
  }

  function tick() {
    if (!on) return;
    const c = ac();
    if (!c || !master) return;
    beat++;
    if (beat % 2 === 0 && Math.random() < 0.55) pluck(note(MINOR[Math.floor(Math.random() * MINOR.length)] + 12), 0.05);
    if (intensity > 0.3 && !mutedM) {
      const t0 = c.currentTime;
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(90, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
      g.gain.setValueAtTime(0.18 * intensity, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.25);
      if (beat % 4 === 0) pluck(note(MINOR[(beat / 4) % 5] + 24), 0.04 * intensity);
    }
    timer = window.setTimeout(tick, intensity > 0.3 ? 360 : 1700);
  }

  return {
    start(planetId: number) {
      const c = ac();
      if (!c) return;
      this.stop();
      root = ROOTS[planetId] ?? 55;
      master = c.createGain();
      master.gain.value = mutedM || muted ? 0 : 0.55;
      master.connect(c.destination);
      // drone: two detuned saws through a slow low-pass
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      const lfo = c.createOscillator(); const lfoG = c.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 120;
      lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
      const dg = c.createGain(); dg.gain.value = 0.07;
      for (const [mult, det] of [[1, -6], [1.5, 5], [2, 0]] as Array<[number, number]>) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * mult; o.detune.value = det;
        o.connect(lp); o.start(); nodes.push(o);
      }
      lp.connect(dg); dg.connect(master);
      nodes.push(lfo, lp, dg, master);
      on = true; beat = 0; intensity = 0;
      timer = window.setTimeout(tick, 1200);
    },
    setIntensity(v: number) { intensity = Math.max(0, Math.min(1, v)); },
    setMuted(m: boolean) { mutedM = m; if (master) master.gain.value = m ? 0 : 0.55; },
    stop() {
      on = false;
      window.clearTimeout(timer);
      for (const n of nodes) { try { (n as OscillatorNode).stop?.(); } catch { /* already stopped */ } try { n.disconnect(); } catch { /* ok */ } }
      nodes = []; master = null;
    },
  };
})();
