'use strict';
// Audio for both game modes: a small synth engine (no audio files).
//  - every sound is layered from filtered noise and enveloped oscillators, with panning and a shared reverb
//  - Sfx.play(name, { pan, vol }) keeps the old API; the village also uses Sfx.at() for positional sound
//  - Sfx.setMusic('peace' | 'raid' | 'boss' | 'off') runs a quiet generative score; ambience (wind, birds) rides along
const Sfx = {
  ctx: null, muted: false, musicOn: true, master: null, bus: null, musicBus: null, ambBus: null, verb: null, noiseBuf: null,
  last: {}, active: 0, mode: 'off', _mt: null, _at: null, _beat: 0, _bar: 0,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    let C = null;
    try { C = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    this.ctx = C;
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master = C.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(comp); comp.connect(C.destination);
    this.bus = C.createGain(); this.bus.gain.value = 1; this.bus.connect(this.master);
    this.musicBus = C.createGain(); this.musicBus.gain.value = this.musicOn ? 0.32 : 0; this.musicBus.connect(this.master);
    this.ambBus = C.createGain(); this.ambBus.gain.value = 0.5; this.ambBus.connect(this.master);
    // a short generated room reverb
    const len = Math.floor(C.sampleRate * 1.6), ir = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb = C.createConvolver(); this.verb.buffer = ir;
    const vr = C.createGain(); vr.gain.value = 0.42; this.verb.connect(vr); vr.connect(this.master);
    this.verbSend = C.createGain(); this.verbSend.gain.value = 1; this.verbSend.connect(this.verb);
    const nl = C.sampleRate * 2, nb = C.createBuffer(1, nl, C.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    if (this.mode !== 'off') this.setMusic(this.mode, true);
  },

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05); },
  setMusicOn(on) { this.musicOn = on; if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.2); },

  // ---------------------------------------------------------------- building blocks
  _out(pan, rev, vol) {
    const C = this.ctx, g = C.createGain(); g.gain.value = 1;
    let tail = g;
    if (pan) { const p = C.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); tail = p; }
    tail.connect(this.bus);
    if (rev) { const s = C.createGain(); s.gain.value = rev; tail.connect(s); s.connect(this.verbSend); }
    return g;
  },
  // enveloped oscillator, optional filter + pitch slide
  tone(o) {
    if (!this.ctx || this.muted) return;
    const C = this.ctx, t = C.currentTime + (o.at || 0), a = o.a === undefined ? 0.004 : o.a, d = o.dur || 0.2, vol = (o.vol === undefined ? 0.1 : o.vol) * (o.gain || 1);
    const osc = C.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.slide || d));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) { const l = C.createOscillator(), lg = C.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + d + a + 0.05); }
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    let node = osc;
    if (o.filter) { const f = C.createBiquadFilter(); f.type = o.filter.type; f.frequency.value = o.filter.f; f.Q.value = o.filter.q || 0.8; if (o.filter.f2) f.frequency.exponentialRampToValueAtTime(o.filter.f2, t + d); node.connect(f); node = f; }
    node.connect(g); g.connect(this._out(o.pan, o.rev, vol));
    osc.start(t); osc.stop(t + a + d + 0.05);
  },
  // filtered noise burst with a sweeping filter
  noise(o) {
    if (!this.ctx || this.muted) return;
    const C = this.ctx, t = C.currentTime + (o.at || 0), a = o.a === undefined ? 0.003 : o.a, d = o.dur || 0.15, vol = (o.vol === undefined ? 0.1 : o.vol) * (o.gain || 1);
    const src = C.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = C.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f || 1000, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t + d);
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(f); f.connect(g); g.connect(this._out(o.pan, o.rev, vol));
    src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  },
  // short impact: pitch-dropping body + noise crack
  thump(f, f2, dur, vol, o) { o = o || {}; this.tone({ f, f2, dur, vol, type: 'sine', pan: o.pan, rev: o.rev, gain: o.gain }); },

  // ---------------------------------------------------------------- one-shot sound effects
  play(name, o) {
    if (!this.ctx || this.muted) return;
    o = o || {};
    const now = performance.now(), lim = THROTTLE[name] || 25;
    if (now - (this.last[name] || 0) < lim) return;
    this.last[name] = now;
    const fn = VOICES[name]; if (!fn) return;
    const v = o.vol === undefined ? 1 : o.vol;
    fn.call(this, { pan: o.pan || 0, g: v, r: Math.random() });
  },
  // positional: pan and loudness from where the sound happens on screen (set Sfx.listener from the game)
  listener: null,
  at(name, wx, wy) {
    const L = this.listener; let pan = 0, vol = 1;
    if (L) { const p = L(wx, wy); pan = p.pan; vol = p.vol; }
    if (vol < 0.05) return;
    this.play(name, { pan, vol });
  },

  // ---------------------------------------------------------------- music and ambience
  setMusic(mode, force) {
    if (!this.ctx) { this.mode = mode; return; }
    if (mode === this.mode && !force) return;
    this.mode = mode; clearTimeout(this._mt); clearTimeout(this._at); this._beat = 0; this._bar = 0;
    if (mode === 'off') return;
    this._tickMusic(); this._tickAmbience();
  },
  _tickMusic() {
    const C = this.ctx; if (!C || this.mode === 'off') return;
    const mode = this.mode, bpm = mode === 'peace' ? 68 : mode === 'raid' ? 104 : 116, spb = 60 / bpm, t0 = C.currentTime + 0.06;
    // Am - F - C - G (peace) / Am - Fmaj - Dm - E (raid, darker)
    const prog = mode === 'peace' ? [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]] : [[57, 60, 64], [53, 57, 60], [50, 57, 62], [52, 56, 64]];
    const chord = prog[this._bar % 4], mtof = n => 440 * Math.pow(2, (n - 69) / 12);
    const barLen = spb * 4;
    if (this._beat % 4 === 0) {
      for (const n of chord) for (const dt of [-6, 6]) this.musicTone({ f: mtof(n - 12), dur: barLen * 1.02, a: barLen * 0.4, vol: mode === 'peace' ? 0.05 : 0.05, type: 'sawtooth', detune: dt, filter: { type: 'lowpass', f: mode === 'peace' ? 700 : 520, q: 0.7 }, at: 0 });
      this.musicTone({ f: mtof(chord[0] - 24), dur: barLen * 0.95, a: 0.05, vol: 0.12, type: 'triangle', at: 0 });
    }
    if (mode === 'peace') {                                    // soft plucked arpeggio
      const n = chord[[0, 1, 2, 1][this._beat % 4]] + 12;
      this.musicTone({ f: mtof(n), dur: spb * 1.6, a: 0.006, vol: 0.075, type: 'triangle', rev: 0.5, pan: ((this._beat % 4) - 1.5) * 0.25, at: 0 });
      if (this._beat % 8 === 6) this.musicTone({ f: mtof(chord[2] + 24), dur: spb * 2.4, a: 0.01, vol: 0.05, type: 'sine', rev: 0.8, at: 0 });
    } else {                                                   // war drums
      const b = this._beat % 4;
      if (b === 0 || b === 2) { this.musicTone({ f: 110, f2: 42, dur: 0.22, vol: 0.4, type: 'sine', at: 0 }); }
      if (b === 1 || b === 3) { this.musicNoise({ dur: 0.12, vol: 0.18, f: 1800, type: 'bandpass', q: 0.8, at: 0 }); }
      if (mode === 'boss' || this._bar % 2) this.musicNoise({ dur: 0.05, vol: 0.07, f: 7000, type: 'highpass', q: 0.5, at: spb * 0.5 });
      if (this._beat % 4 === 0) this.musicTone({ f: mtof(chord[0] - 12), dur: spb * 3.4, a: 0.1, vol: 0.06, type: 'square', filter: { type: 'lowpass', f: 380, q: 1 }, at: 0 });
    }
    this._beat++; if (this._beat % 4 === 0) this._bar++;
    this._mt = setTimeout(() => this._tickMusic(), spb * 1000 * 0.98);
  },
  musicTone(o) { const bus = this.bus; this.bus = this.musicBus; this.tone(o); this.bus = bus; },
  musicNoise(o) { const bus = this.bus; this.bus = this.musicBus; this.noise(o); this.bus = bus; },
  _tickAmbience() {
    const C = this.ctx; if (!C || this.mode === 'off') return;
    const bus = this.bus; this.bus = this.ambBus;
    // wind gust
    this.noise({ type: 'bandpass', f: 380, f2: 620, q: 0.7, dur: 2.8, a: 1.2, vol: this.mode === 'peace' ? 0.035 : 0.05, pan: Math.random() * 1.2 - 0.6, rev: 0.4 });
    if (this.mode === 'peace') for (let k = 0; k < 1 + (Math.random() * 3 | 0); k++) this._bird(0.4 + Math.random() * 2.2);
    this.bus = bus;
    this._at = setTimeout(() => this._tickAmbience(), 2400 + Math.random() * 2200);
  },
  _bird(at) {
    const base = 2600 + Math.random() * 1800, pan = Math.random() * 1.6 - 0.8, n = 2 + (Math.random() * 3 | 0);
    for (let k = 0; k < n; k++) this.tone({ f: base, f2: base * (1.15 + Math.random() * 0.35), dur: 0.07, a: 0.004, vol: 0.022, type: 'sine', at: at + k * 0.11, pan, rev: 0.5, slide: 0.06 });
  },
};

// minimum gap (ms) between repeats of the same sound
const THROTTLE = { step: 150, hit: 40, hurt: 90, chop: 120, hammer: 90, arrow: 70, mine: 90, zombie: 600, skeleton: 500, coin: 60, pickup: 50 };

const VOICES = {
  slash(o) { this.noise({ type: 'bandpass', f: 700, f2: 3400, q: 1.1, dur: 0.17, a: 0.01, vol: 0.12 * o.g, pan: o.pan }); this.tone({ f: 420, f2: 160, dur: 0.12, vol: 0.03 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'lowpass', f: 1400 } }); },
  hit(o) { const j = 0.85 + o.r * 0.3; this.thump(170 * j, 55, 0.13, 0.17 * o.g, { pan: o.pan }); this.noise({ type: 'lowpass', f: 1800, f2: 300, q: 0.7, dur: 0.1, vol: 0.12 * o.g, pan: o.pan }); this.tone({ f: 1500 * j, f2: 700, dur: 0.05, vol: 0.03 * o.g, type: 'square', pan: o.pan }); },
  thud(o) { this.thump(110, 40, 0.2, 0.2 * o.g, { pan: o.pan, rev: 0.2 }); this.noise({ type: 'lowpass', f: 700, f2: 150, dur: 0.16, vol: 0.14 * o.g, pan: o.pan }); },
  hurt(o) { this.tone({ f: 260, f2: 90, dur: 0.28, vol: 0.12 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'lowpass', f: 900, f2: 300 } }); this.noise({ type: 'lowpass', f: 900, f2: 200, dur: 0.12, vol: 0.1 * o.g, pan: o.pan }); },
  jump(o) { this.tone({ f: 280, f2: 520, dur: 0.1, vol: 0.05 * o.g, type: 'triangle', pan: o.pan }); this.noise({ type: 'highpass', f: 2500, dur: 0.05, vol: 0.03 * o.g, pan: o.pan }); },
  dash(o) { this.noise({ type: 'bandpass', f: 500, f2: 4200, q: 0.9, dur: 0.3, a: 0.02, vol: 0.14 * o.g, pan: o.pan, rev: 0.25 }); this.tone({ f: 200, f2: 620, dur: 0.28, vol: 0.05 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'lowpass', f: 1600 } }); },
  strike(o) { VOICES.dash.call(this, o); this.thump(120, 38, 0.4, 0.22 * o.g, { pan: o.pan, rev: 0.4 }); this.noise({ type: 'lowpass', f: 2400, f2: 200, dur: 0.5, vol: 0.12 * o.g, rev: 0.5, pan: o.pan }); },
  mine(o) { this.thump(140 + o.r * 60, 70, 0.07, 0.1 * o.g, { pan: o.pan }); this.noise({ type: 'bandpass', f: 2400, q: 2, dur: 0.04, vol: 0.06 * o.g, pan: o.pan }); },
  chop(o) {                                               // axe in wood: dull body knock + crack
    this.thump(190, 80, 0.13, 0.22 * o.g, { pan: o.pan });
    this.noise({ type: 'bandpass', f: 900, f2: 500, q: 3, dur: 0.07, vol: 0.2 * o.g, pan: o.pan });
    this.noise({ type: 'highpass', f: 3500, dur: 0.025, vol: 0.09 * o.g, pan: o.pan, at: 0.012 });
    this.tone({ f: 330, f2: 210, dur: 0.1, vol: 0.05 * o.g, type: 'triangle', pan: o.pan, at: 0.015 });
  },
  crash(o) {                                              // a tree comes down
    this.noise({ type: 'bandpass', f: 1800, f2: 400, q: 0.6, dur: 0.5, a: 0.05, vol: 0.14 * o.g, pan: o.pan, rev: 0.3 });
    for (let k = 0; k < 5; k++) this.noise({ type: 'bandpass', f: 1200 - k * 120, q: 2.5, dur: 0.05, vol: 0.07 * o.g, pan: o.pan, at: 0.08 + k * 0.07 });
    this.thump(95, 36, 0.45, 0.24 * o.g, { pan: o.pan, rev: 0.3, gain: 1 }); VOICES.thud.call(this, { pan: o.pan, g: o.g * 0.8, r: o.r });
  },
  break(o) { this.noise({ type: 'lowpass', f: 2600, f2: 300, dur: 0.28, vol: 0.18 * o.g, pan: o.pan, rev: 0.25 }); this.thump(100, 40, 0.22, 0.16 * o.g, { pan: o.pan }); for (let k = 0; k < 3; k++) this.noise({ type: 'bandpass', f: 1600 + k * 500, q: 3, dur: 0.04, vol: 0.06 * o.g, pan: o.pan, at: 0.04 + k * 0.05 }); },
  hammer(o) {                                             // building: hammer on timber + a bright nail ping
    this.thump(210, 90, 0.07, 0.16 * o.g, { pan: o.pan }); this.noise({ type: 'bandpass', f: 2000, q: 2.5, dur: 0.035, vol: 0.12 * o.g, pan: o.pan });
    this.tone({ f: 1150 + o.r * 120, dur: 0.18, vol: 0.05 * o.g, type: 'triangle', pan: o.pan, rev: 0.35, at: 0.01 }); this.tone({ f: 2420, dur: 0.1, vol: 0.02 * o.g, type: 'sine', pan: o.pan, at: 0.01 });
  },
  place(o) { this.thump(150, 70, 0.1, 0.14 * o.g, { pan: o.pan }); this.noise({ type: 'lowpass', f: 1200, dur: 0.07, vol: 0.09 * o.g, pan: o.pan }); },
  pickup(o) { this.tone({ f: 784, dur: 0.1, vol: 0.06 * o.g, type: 'triangle', pan: o.pan, rev: 0.2 }); this.tone({ f: 1175, dur: 0.14, vol: 0.05 * o.g, type: 'triangle', at: 0.06, pan: o.pan, rev: 0.2 }); },
  coin(o) { const j = 1 + o.r * 0.06; this.tone({ f: 1318 * j, dur: 0.12, vol: 0.07 * o.g, type: 'triangle', pan: o.pan, rev: 0.3 }); this.tone({ f: 1975 * j, dur: 0.22, vol: 0.06 * o.g, type: 'sine', at: 0.07, pan: o.pan, rev: 0.4 }); this.noise({ type: 'highpass', f: 6000, dur: 0.05, vol: 0.03 * o.g, pan: o.pan }); },
  power(o) { for (let k = 0; k < 4; k++) this.tone({ f: 392 * Math.pow(1.26, k), dur: 0.3, vol: 0.05 * o.g, type: 'triangle', at: k * 0.05, pan: o.pan, rev: 0.5 }); },
  craft(o) { this.tone({ f: 523, dur: 0.1, vol: 0.07 * o.g, type: 'triangle', pan: o.pan, rev: 0.3 }); this.tone({ f: 784, dur: 0.18, vol: 0.07 * o.g, type: 'triangle', at: 0.08, pan: o.pan, rev: 0.3 }); },
  upgrade(o) { [392, 494, 587, 784].forEach((f, k) => this.tone({ f, dur: 0.32, vol: 0.06 * o.g, type: 'triangle', at: k * 0.09, pan: o.pan, rev: 0.5 })); this.noise({ type: 'highpass', f: 5000, dur: 0.3, a: 0.2, vol: 0.03 * o.g, rev: 0.5 }); },
  done(o) { [523, 659, 784, 1047].forEach((f, k) => this.tone({ f, dur: 0.4, vol: 0.055 * o.g, type: 'triangle', at: k * 0.08, pan: o.pan, rev: 0.6 })); VOICES.hammer.call(this, { pan: o.pan, g: o.g * 0.6, r: o.r }); },
  click(o) { this.tone({ f: 900, f2: 600, dur: 0.035, vol: 0.05 * o.g, type: 'square', filter: { type: 'lowpass', f: 3000 } }); },
  open(o) { this.noise({ type: 'bandpass', f: 600, f2: 1800, q: 0.8, dur: 0.14, a: 0.03, vol: 0.05 * o.g }); this.tone({ f: 520, f2: 780, dur: 0.1, vol: 0.03 * o.g, type: 'triangle' }); },
  deny(o) { this.tone({ f: 150, f2: 110, dur: 0.16, vol: 0.07 * o.g, type: 'square', filter: { type: 'lowpass', f: 700 } }); },
  step(o) { const k = 0.8 + o.r * 0.5; this.noise({ type: 'lowpass', f: 480 * k, f2: 180, q: 0.8, dur: 0.07, vol: 0.075 * o.g, pan: o.pan }); this.thump(95 * k, 55, 0.05, 0.04 * o.g, { pan: o.pan }); },
  arrow(o) { this.noise({ type: 'bandpass', f: 3200, f2: 1100, q: 1.4, dur: 0.2, a: 0.01, vol: 0.07 * o.g, pan: o.pan }); this.tone({ f: 190, f2: 140, dur: 0.12, vol: 0.05 * o.g, type: 'triangle', pan: o.pan }); },
  cannon(o) { this.thump(95, 30, 0.45, 0.4 * o.g, { pan: o.pan, rev: 0.5 }); this.noise({ type: 'lowpass', f: 3200, f2: 120, dur: 0.5, vol: 0.28 * o.g, pan: o.pan, rev: 0.5 }); },
  mortar(o) { this.thump(70, 24, 0.5, 0.42 * o.g, { pan: o.pan, rev: 0.6 }); this.noise({ type: 'lowpass', f: 2200, f2: 100, dur: 0.6, vol: 0.24 * o.g, pan: o.pan, rev: 0.6 }); this.tone({ f: 1200, f2: 380, dur: 0.9, a: 0.1, vol: 0.025 * o.g, type: 'sine', at: 0.25, pan: o.pan, rev: 0.4 }); },
  explode(o) { this.thump(80, 26, 0.55, 0.38 * o.g, { pan: o.pan, rev: 0.6 }); this.noise({ type: 'lowpass', f: 3500, f2: 90, dur: 0.7, vol: 0.3 * o.g, pan: o.pan, rev: 0.6 }); this.noise({ type: 'bandpass', f: 1800, q: 1.5, dur: 0.3, vol: 0.1 * o.g, pan: o.pan, at: 0.05 }); },
  magic(o) { this.tone({ f: 520, f2: 1500, dur: 0.3, vol: 0.06 * o.g, type: 'sine', pan: o.pan, rev: 0.6, vib: [18, 14] }); this.tone({ f: 780, f2: 2200, dur: 0.26, vol: 0.03 * o.g, type: 'triangle', pan: o.pan, rev: 0.6, at: 0.03 }); this.noise({ type: 'highpass', f: 5500, dur: 0.25, a: 0.05, vol: 0.03 * o.g, pan: o.pan, rev: 0.5 }); },
  cast(o) { this.tone({ f: 180, f2: 460, dur: 0.5, a: 0.1, vol: 0.07 * o.g, type: 'sine', pan: o.pan, rev: 0.6, vib: [7, 8] }); this.noise({ type: 'bandpass', f: 400, f2: 1600, q: 1, dur: 0.45, a: 0.1, vol: 0.05 * o.g, pan: o.pan, rev: 0.5 }); },
  summon(o) { this.tone({ f: 70, f2: 150, dur: 0.9, a: 0.2, vol: 0.12 * o.g, type: 'sawtooth', pan: o.pan, rev: 0.6, filter: { type: 'lowpass', f: 500 } }); this.noise({ type: 'bandpass', f: 300, f2: 1200, q: 1.2, dur: 0.8, a: 0.2, vol: 0.06 * o.g, rev: 0.7 }); },
  heal(o) { [659, 784, 988].forEach((f, k) => this.tone({ f, dur: 0.45, vol: 0.04 * o.g, type: 'sine', at: k * 0.07, pan: o.pan, rev: 0.7 })); },
  zombie(o) { const f = 70 + o.r * 30; this.tone({ f, f2: f * 0.7, dur: 0.7, a: 0.12, vol: 0.12 * o.g, type: 'sawtooth', pan: o.pan, rev: 0.4, filter: { type: 'lowpass', f: 320 + o.r * 150, f2: 180 }, vib: [5 + o.r * 3, 6] }); this.noise({ type: 'bandpass', f: 220, q: 2, dur: 0.5, a: 0.1, vol: 0.05 * o.g, pan: o.pan }); },
  skeleton(o) { for (let k = 0; k < 4 + (o.r * 3 | 0); k++) this.noise({ type: 'bandpass', f: 2200 + Math.random() * 1800, q: 5, dur: 0.025, vol: 0.07 * o.g, pan: o.pan, at: k * 0.035 + Math.random() * 0.02 }); },
  die(o) { this.tone({ f: 300, f2: 55, dur: 0.5, vol: 0.1 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'lowpass', f: 1200, f2: 200 }, rev: 0.3 }); this.noise({ type: 'lowpass', f: 1200, f2: 150, dur: 0.3, vol: 0.1 * o.g, pan: o.pan }); },
  horn(o) {                                               // war horn: two brass notes
    for (const [f, at, d] of [[110, 0, 0.9], [146.8, 0.85, 1.3]]) { this.tone({ f, dur: d, a: 0.16, vol: 0.15 * o.g, type: 'sawtooth', at, rev: 0.6, filter: { type: 'lowpass', f: 700, f2: 1100, q: 1.2 } }); this.tone({ f: f * 2.005, dur: d, a: 0.2, vol: 0.05 * o.g, type: 'square', at, rev: 0.6, filter: { type: 'lowpass', f: 900 } }); }
  },
  night(o) { VOICES.horn.call(this, o); },
  boss(o) { this.tone({ f: 58, f2: 38, dur: 1.4, a: 0.05, vol: 0.28 * o.g, type: 'sawtooth', rev: 0.7, filter: { type: 'lowpass', f: 420 }, vib: [9, 8] }); this.noise({ type: 'lowpass', f: 700, f2: 120, dur: 1.2, a: 0.05, vol: 0.2 * o.g, rev: 0.6 }); this.tone({ f: 130, f2: 60, dur: 1, vol: 0.1 * o.g, type: 'square', at: 0.1, filter: { type: 'lowpass', f: 300 }, rev: 0.5 }); },
  dawn(o) { [392, 523, 659, 784].forEach((f, k) => this.tone({ f, dur: 1.1, a: 0.05, vol: 0.05 * o.g, type: 'triangle', at: k * 0.16, rev: 0.8 })); },
  cloud(o) { this.noise({ type: 'bandpass', f: 500, f2: 2200, q: 0.6, dur: 1.8, a: 0.5, vol: 0.11 * o.g, rev: 0.7 }); [330, 440, 554, 659].forEach((f, k) => this.tone({ f, dur: 1.6, a: 0.3, vol: 0.04 * o.g, type: 'sine', at: 0.2 + k * 0.18, rev: 0.9 })); },
  fire(o) { this.noise({ type: 'bandpass', f: 900, f2: 300, q: 0.8, dur: 0.4, a: 0.05, vol: 0.06 * o.g, pan: o.pan }); },
};
