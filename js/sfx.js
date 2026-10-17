'use strict';
// Audio for both game modes: a synth engine (no audio files).
//  - sounds are layered from filtered noise, enveloped oscillators, inharmonic metal partials and Karplus-Strong plucks
//  - every call is slightly randomised (pitch, level) so repeated sounds never repeat exactly
//  - a darkened stereo reverb, a warm EQ and a compressor sit on the master bus
//  - Sfx.play(name, { pan, vol }) is the original API; the village adds Sfx.at() (positional) and Sfx.env (ambience hints)
//  - Sfx.setMusic('peace' | 'raid' | 'boss' | 'off') runs a generative score: pads, plucked arpeggios and melody, bass, drums
const Sfx = {
  ctx: null, muted: false, musicOn: true, master: null, bus: null, musicBus: null, ambBus: null, verb: null, noiseBuf: null, analyser: null,
  last: {}, mode: 'off', _mt: null, _at: null, _beat: 0, _bar: 0, _phrase: 0, _pl: new Map(), env: { fire: 0, night: 0 },

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    let C = null;
    try { C = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    this.ctx = C;
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    const warm = C.createBiquadFilter(); warm.type = 'highshelf'; warm.frequency.value = 7500; warm.gain.value = -4;          // tame the synthetic fizz
    const body = C.createBiquadFilter(); body.type = 'lowshelf'; body.frequency.value = 160; body.gain.value = 2;
    this.master = C.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(body); body.connect(warm); warm.connect(comp);
    this.analyser = C.createAnalyser(); this.analyser.fftSize = 2048; comp.connect(this.analyser); comp.connect(C.destination);
    this.bus = C.createGain(); this.bus.gain.value = 1; this.bus.connect(this.master);
    this.musicBus = C.createGain(); this.musicBus.gain.value = this.musicOn ? 0.42 : 0; this.musicBus.connect(this.master);
    this.ambBus = C.createGain(); this.ambBus.gain.value = 0.55; this.ambBus.connect(this.master);
    // stereo room reverb: decorrelated channels whose tail gets darker as it decays
    const len = Math.floor(C.sampleRate * 2.1), ir = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) { const k = i / len, white = Math.random() * 2 - 1, a = 0.18 + k * 0.78; lp += (white - lp) * (1 - a); d[i] = lp * Math.pow(1 - k, 2.3) * (1.9 - k); }
    }
    this.verb = C.createConvolver(); this.verb.buffer = ir;
    const vr = C.createGain(); vr.gain.value = 0.4; this.verb.connect(vr); vr.connect(this.master);
    this.verbSend = C.createGain(); this.verbSend.gain.value = 1; this.verbSend.connect(this.verb);
    const nl = C.sampleRate * 2, nb = C.createBuffer(1, nl, C.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    if (this.mode !== 'off') this.setMusic(this.mode, true);
  },

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05); },
  setMusicOn(on) { this.musicOn = on; if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.42 : 0, this.ctx.currentTime, 0.2); },

  // ---------------------------------------------------------------- building blocks
  _out(pan, rev) {
    const C = this.ctx, g = C.createGain(); g.gain.value = 1;
    let tail = g;
    if (pan) { const p = C.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); tail = p; }
    tail.connect(this.bus);
    if (rev) { const s = C.createGain(); s.gain.value = rev; tail.connect(s); s.connect(this.verbSend); }
    return g;
  },
  // enveloped oscillator, optional filter, pitch slide, vibrato; pitch is jittered a little unless exact
  tone(o) {
    if (!this.ctx || this.muted) return;
    const C = this.ctx, t = C.currentTime + (o.at || 0), a = o.a === undefined ? 0.004 : o.a, d = o.dur || 0.2, vol = (o.vol === undefined ? 0.1 : o.vol) * (o.gain || 1);
    const j = o.exact ? 1 : 1 + (Math.random() - 0.5) * 0.03;
    const osc = C.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f * j, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2 * j), t + (o.slide || d));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) { const l = C.createOscillator(), lg = C.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + d + a + 0.05); }
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    let node = osc;
    if (o.filter) { const f = C.createBiquadFilter(); f.type = o.filter.type; f.frequency.value = o.filter.f; f.Q.value = o.filter.q || 0.8; if (o.filter.f2) f.frequency.exponentialRampToValueAtTime(o.filter.f2, t + d); node.connect(f); node = f; }
    node.connect(g); g.connect(this._out(o.pan, o.rev));
    osc.start(t); osc.stop(t + a + d + 0.05);
  },
  // filtered noise burst with a sweeping filter
  noise(o) {
    if (!this.ctx || this.muted) return;
    const C = this.ctx, t = C.currentTime + (o.at || 0), a = o.a === undefined ? 0.003 : o.a, d = o.dur || 0.15, vol = (o.vol === undefined ? 0.1 : o.vol) * (o.gain || 1);
    const j = o.exact ? 1 : 1 + (Math.random() - 0.5) * 0.12;
    const src = C.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = C.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime((o.f || 1000) * j, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2 * j), t + d);
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(f); f.connect(g); g.connect(this._out(o.pan, o.rev));
    src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  },
  // short impact: pitch-dropping body
  thump(f, f2, dur, vol, o) { o = o || {}; this.tone({ f, f2, dur, vol, type: 'sine', pan: o.pan, rev: o.rev, gain: o.gain, at: o.at }); },
  // metal: inharmonic partials that ring and fade at different speeds (swords, anvils, bells)
  ring(f, vol, o) {
    o = o || {};
    [[1, 1, 0.5], [2.76, 0.6, 0.32], [5.4, 0.36, 0.2], [8.93, 0.2, 0.12]].forEach(([r, v, d]) => this.tone({ f: f * r, dur: d * (o.len || 1), a: 0.001, vol: vol * v, type: 'sine', pan: o.pan, rev: o.rev === undefined ? 0.25 : o.rev, at: o.at, exact: false }));
  },
  // Karplus-Strong string: a cached burst of noise through a decaying averaging delay line = a real plucked string
  _pluckBuf(f, bright) {
    const C = this.ctx, key = Math.round(f * 2) + (bright ? 'b' : 'd'), hit = this._pl.get(key); if (hit) return hit;
    const sr = C.sampleRate, N = Math.floor(sr * 1.1), buf = C.createBuffer(1, N, sr), d = buf.getChannelData(0), L = Math.max(2, Math.round(sr / f)), ring = new Float32Array(L);
    let lp = 0; for (let i = 0; i < L; i++) { const w = Math.random() * 2 - 1; lp += (w - lp) * (bright ? 0.9 : 0.45); ring[i] = lp; }
    const decay = f < 120 ? 0.9985 : f < 300 ? 0.998 : 0.9965; let idx = 0, peak = 0;
    for (let n = 0; n < N; n++) { const a = ring[idx], b = ring[(idx + 1) % L]; ring[idx] = (a + b) * 0.5 * decay; d[n] = a; if (Math.abs(a) > peak) peak = Math.abs(a); idx = (idx + 1) % L; }
    for (let n = 0; n < N; n++) d[n] /= peak || 1;
    if (this._pl.size > 90) this._pl.clear();
    this._pl.set(key, buf); return buf;
  },
  pluck(o) {
    if (!this.ctx || this.muted) return;
    const C = this.ctx, t = C.currentTime + (o.at || 0), src = C.createBufferSource(); src.buffer = this._pluckBuf(o.f, o.bright);
    const g = C.createGain(), d = o.dur || 0.9, vol = (o.vol === undefined ? 0.1 : o.vol); g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0.0001, t + d * 0.35, d * 0.28);
    let node = src; if (o.lp) { const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
    node.connect(g); g.connect(this._out(o.pan, o.rev)); src.start(t); src.stop(t + d + 0.3);
  },

  // ---------------------------------------------------------------- one-shot sound effects
  play(name, o) {
    if (!this.ctx || this.muted) return;
    o = o || {};
    const now = performance.now(), lim = THROTTLE[name] || 25;
    if (now - (this.last[name] || 0) < lim) return;
    this.last[name] = now;
    const fn = VOICES[name]; if (!fn) return;
    const v = (o.vol === undefined ? 1 : o.vol) * (0.9 + Math.random() * 0.2);
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
  // peak level (0..1) of the output since the last call: used by the tests to check every voice is audible and not clipping
  peak() {
    if (!this.analyser) return 0;
    const a = new Float32Array(this.analyser.fftSize); this.analyser.getFloatTimeDomainData(a); let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m;
  },

  // ---------------------------------------------------------------- music and ambience
  setMusic(mode, force) {
    if (!this.ctx) { this.mode = mode; return; }
    if (mode === this.mode && !force) return;
    this.mode = mode; clearTimeout(this._mt); clearTimeout(this._at); this._beat = 0; this._bar = 0; this._phrase = 0;
    if (mode === 'off') return;
    this._tickMusic(); this._tickAmbience();
  },
  musicTone(o) { const bus = this.bus; this.bus = this.musicBus; this.tone(o); this.bus = bus; },
  musicNoise(o) { const bus = this.bus; this.bus = this.musicBus; this.noise(o); this.bus = bus; },
  musicPluck(o) { const bus = this.bus; this.bus = this.musicBus; this.pluck(o); this.bus = bus; },
  _tickMusic() {
    const C = this.ctx; if (!C || this.mode === 'off') return;
    const mode = this.mode, bpm = mode === 'peace' ? 76 : mode === 'raid' ? 110 : 124, spb = 60 / bpm;
    const mtof = n => 440 * Math.pow(2, (n - 69) / 12), beat = this._beat % 4, barLen = spb * 4;
    // progressions (midi triads): peace is warm and open, war is minor and tense
    const PEACE = [[[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]], [[48, 55, 64], [55, 59, 62], [57, 60, 64], [53, 57, 60]], [[50, 57, 62], [57, 60, 64], [53, 57, 60], [48, 55, 60]]];
    const WAR = [[[57, 60, 64], [53, 57, 60], [50, 57, 62], [52, 56, 64]], [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]]];
    const prog = mode === 'peace' ? PEACE[this._phrase % PEACE.length] : WAR[this._phrase % WAR.length];
    const chord = prog[this._bar % 4], root = chord[0];
    if (beat === 0) {
      // pad: detuned saws through a slow low-pass, one chord per bar
      for (const n of chord) for (const dt of [-7, 7]) this.musicTone({ f: mtof(n - 12), dur: barLen * 1.05, a: barLen * 0.45, vol: mode === 'peace' ? 0.036 : 0.04, type: 'sawtooth', detune: dt, filter: { type: 'lowpass', f: mode === 'peace' ? 620 : 460, f2: mode === 'peace' ? 1100 : 700, q: 0.6 }, rev: 0.4, exact: true });
      this.musicPluck({ f: mtof(root - 24), dur: 1.4, vol: 0.2, lp: 500 });                      // bass
    }
    if (mode === 'peace') {
      const pat = [0, 1, 2, 1, 2, 1, 0, 1][(this._beat * 2) % 8], n2 = chord[(this._beat * 2 + this._bar) % 3] + 12;
      // plucked arpeggio, two notes per beat
      this.musicPluck({ f: mtof(chord[pat % 3] + 12), vol: 0.07, lp: 2600, pan: -0.25, rev: 0.45, dur: 0.8 });
      this.musicPluck({ f: mtof(n2 + (beat === 2 ? 12 : 0)), vol: 0.05, lp: 2600, pan: 0.25, rev: 0.45, dur: 0.7, at: spb * 0.5 });
      if (beat === 2) this.musicPluck({ f: mtof(root - 24 + 7), dur: 1.0, vol: 0.12, lp: 450 });
      // a sparse pentatonic melody
      if (beat === 0 && this._bar % 2 === 1 || (beat === 2 && Math.random() < 0.45)) {
        const sc = [0, 2, 4, 7, 9], base = root >= 53 ? 72 : 69, len = 2 + (Math.random() * 2 | 0);
        for (let k = 0; k < len; k++) this.musicPluck({ f: mtof(base + sc[(Math.random() * 5) | 0] + (k === len - 1 ? 0 : 0)), vol: 0.075, lp: 3400, bright: true, rev: 0.8, pan: 0.1, dur: 1.1, at: k * spb * (0.5 + Math.random() * 0.25) });
      }
    } else {
      const boss = mode === 'boss';
      // taiko: heavy sine boom with a skin slap on 1 and 3, snare on 2 and 4, driving eighths underneath
      if (beat === 0 || beat === 2) { this.musicTone({ f: 125, f2: 40, dur: 0.3, vol: 0.5, type: 'sine', exact: true }); this.musicNoise({ dur: 0.1, vol: 0.12, f: 260, type: 'lowpass', q: 0.7 }); if (boss) this.musicTone({ f: 98, f2: 34, dur: 0.5, vol: 0.28, type: 'sine', exact: true, at: spb * 0.75 }); }
      if (beat === 1 || beat === 3) this.musicNoise({ dur: 0.14, vol: 0.2, f: 1900, type: 'bandpass', q: 0.7 });
      this.musicNoise({ dur: 0.04, vol: 0.06, f: 7500, type: 'highpass', q: 0.5, at: spb * 0.5 }); this.musicNoise({ dur: 0.04, vol: 0.045, f: 7500, type: 'highpass', q: 0.5 });
      for (let k = 0; k < 2; k++) this.musicPluck({ f: mtof(root - 24 + (k && this._bar % 2 ? 7 : 0)), vol: 0.15, lp: 420, dur: 0.5, at: k * spb * 0.5 });          // pulsing bass ostinato
      if (beat === 0) {                                                                                                                                          // string / brass stab
        for (const n of chord) this.musicTone({ f: mtof(n), dur: spb * 1.6, a: 0.03, vol: boss ? 0.05 : 0.035, type: 'sawtooth', filter: { type: 'lowpass', f: boss ? 1300 : 900, q: 1 }, rev: 0.4, exact: true });
        if (boss) this.musicTone({ f: mtof(root - 12), dur: spb * 1.2, a: 0.02, vol: 0.09, type: 'square', filter: { type: 'lowpass', f: 700, q: 1.2 }, exact: true });
      }
      if (this._bar % 4 === 3 && beat === 2) this.musicNoise({ dur: spb * 1.9, a: spb * 1.7, vol: 0.09, f: 400, f2: 3000, type: 'bandpass', q: 0.9 });    // rising swell before the phrase turns
    }
    this._beat++; if (this._beat % 4 === 0) { this._bar++; if (this._bar % 4 === 0) this._phrase++; }
    this._mt = setTimeout(() => this._tickMusic(), spb * 1000 * 0.985);
  },
  _tickAmbience() {
    const C = this.ctx; if (!C || this.mode === 'off') return;
    const bus = this.bus; this.bus = this.ambBus;
    const calm = this.mode === 'peace';
    // wind gust (stereo drift)
    this.noise({ type: 'bandpass', f: 320, f2: 700, q: 0.7, dur: 3.2, a: 1.4, vol: calm ? 0.04 : 0.06, pan: Math.random() * 1.2 - 0.6, rev: 0.4, exact: true });
    if (calm) for (let k = 0; k < 1 + (Math.random() * 3 | 0); k++) this._bird(0.4 + Math.random() * 2.2);
    else for (let k = 0; k < 2; k++) this._cricket(0.3 + Math.random() * 1.8);           // dusk: crickets and the odd distant crow
    if (!calm && Math.random() < 0.25) this._crow(1 + Math.random());
    if (this.env.fire > 0.05) for (let k = 0; k < 7; k++) this.noise({ type: 'bandpass', f: 2600 + Math.random() * 2400, q: 6, dur: 0.02 + Math.random() * 0.03, vol: 0.045 * this.env.fire * (0.4 + Math.random()), pan: -0.2 + Math.random() * 0.4, at: Math.random() * 2.2 });   // campfire crackle
    this.bus = bus;
    this._at = setTimeout(() => this._tickAmbience(), 2400 + Math.random() * 2000);
  },
  _bird(at) {
    const kind = Math.random(), pan = Math.random() * 1.6 - 0.8, base = 2400 + Math.random() * 1800;
    if (kind < 0.5) { const n = 2 + (Math.random() * 3 | 0); for (let k = 0; k < n; k++) this.tone({ f: base, f2: base * (1.15 + Math.random() * 0.35), dur: 0.07, a: 0.004, vol: 0.022, type: 'sine', at: at + k * 0.11, pan, rev: 0.5, slide: 0.06 }); }
    else { for (let k = 0; k < 5; k++) this.tone({ f: base * 0.8 * (1 + (k % 2) * 0.22), f2: base * 0.8 * (1.05 + (k % 2) * 0.2), dur: 0.05, a: 0.003, vol: 0.02, type: 'sine', at: at + k * 0.065, pan, rev: 0.5 }); }   // a trilling bird
  },
  _cricket(at) { const pan = Math.random() * 1.6 - 0.8, f = 4200 + Math.random() * 600; for (let k = 0; k < 6; k++) this.tone({ f, dur: 0.02, a: 0.002, vol: 0.012, type: 'sine', at: at + k * 0.045, pan, exact: true }); },
  _crow(at) { const pan = Math.random() - 0.5; for (let k = 0; k < 2; k++) { this.tone({ f: 520, f2: 300, dur: 0.22, a: 0.02, vol: 0.03, type: 'sawtooth', at: at + k * 0.3, pan, rev: 0.7, filter: { type: 'bandpass', f: 900, q: 2 } }); } },
};

// minimum gap (ms) between repeats of the same sound
const THROTTLE = { step: 150, stepStone: 150, stepDirt: 150, hit: 40, hurt: 90, chop: 120, hammer: 90, arrow: 70, mine: 90, zombie: 600, skeleton: 500, coin: 60, pickup: 50, clang: 60 };

const VOICES = {
  slash(o) {                                              // sword through air: a rising-then-falling whoosh and a thin edge hiss
    this.noise({ type: 'bandpass', f: 500, f2: 3000, q: 1.0, dur: 0.2, a: 0.07, vol: 0.14 * o.g, pan: o.pan });
    this.noise({ type: 'highpass', f: 4200, dur: 0.12, a: 0.05, vol: 0.035 * o.g, pan: o.pan, at: 0.03 });
    this.tone({ f: 260, f2: 130, dur: 0.14, a: 0.05, vol: 0.025 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'lowpass', f: 900 } });
  },
  hit(o) {                                                // blade on flesh: wet thump + bone crack + a little steel
    const j = 0.85 + o.r * 0.3;
    this.thump(165 * j, 52, 0.14, 0.2 * o.g, { pan: o.pan });
    this.noise({ type: 'lowpass', f: 2200, f2: 260, q: 0.7, dur: 0.11, vol: 0.14 * o.g, pan: o.pan });
    this.noise({ type: 'bandpass', f: 1500 * j, q: 2.5, dur: 0.035, vol: 0.1 * o.g, pan: o.pan, at: 0.006 });
    this.ring(1100 * j, 0.012 * o.g, { pan: o.pan, len: 0.5, rev: 0.15 });
  },
  clang(o) { this.noise({ type: 'bandpass', f: 3000, q: 1.5, dur: 0.02, vol: 0.12 * o.g, pan: o.pan }); this.ring(820 + o.r * 260, 0.06 * o.g, { pan: o.pan, rev: 0.3 }); },
  thud(o) { this.thump(105, 38, 0.22, 0.26 * o.g, { pan: o.pan, rev: 0.2 }); this.noise({ type: 'lowpass', f: 650, f2: 140, dur: 0.18, vol: 0.16 * o.g, pan: o.pan }); },
  hurt(o) { this.tone({ f: 240 + o.r * 40, f2: 95, dur: 0.26, vol: 0.12 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'lowpass', f: 1000, f2: 320 } }); this.noise({ type: 'lowpass', f: 900, f2: 200, dur: 0.12, vol: 0.1 * o.g, pan: o.pan }); this.thump(120, 60, 0.1, 0.12 * o.g, { pan: o.pan }); },
  jump(o) { this.tone({ f: 280, f2: 520, dur: 0.1, vol: 0.05 * o.g, type: 'triangle', pan: o.pan }); this.noise({ type: 'highpass', f: 2500, dur: 0.05, vol: 0.03 * o.g, pan: o.pan }); },
  dash(o) { this.noise({ type: 'bandpass', f: 500, f2: 4200, q: 0.9, dur: 0.3, a: 0.04, vol: 0.2 * o.g, pan: o.pan, rev: 0.25 }); this.tone({ f: 200, f2: 620, dur: 0.28, vol: 0.07 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'lowpass', f: 1600 } }); },
  charge(o) {                                             // hero strike gathering power: a rising shimmer
    this.tone({ f: 220, f2: 880, dur: 0.22, a: 0.05, vol: 0.09 * o.g, type: 'sawtooth', pan: o.pan, rev: 0.5, filter: { type: 'lowpass', f: 600, f2: 3000 } });
    this.tone({ f: 660, f2: 2400, dur: 0.22, a: 0.08, vol: 0.035 * o.g, type: 'sine', pan: o.pan, rev: 0.6, vib: [24, 18] });
    this.noise({ type: 'highpass', f: 3000, f2: 7000, dur: 0.22, a: 0.1, vol: 0.04 * o.g, pan: o.pan });
  },
  strike(o) {                                             // the slam: sub boom, shock crack, steel ring, falling debris
    this.thump(110, 32, 0.5, 0.42 * o.g, { pan: o.pan, rev: 0.4 });
    this.noise({ type: 'lowpass', f: 3500, f2: 160, dur: 0.55, vol: 0.2 * o.g, rev: 0.5, pan: o.pan });
    this.noise({ type: 'highpass', f: 2600, dur: 0.06, vol: 0.12 * o.g, pan: o.pan });
    this.ring(640, 0.05 * o.g, { pan: o.pan, len: 1.6, rev: 0.5 });
    for (let k = 0; k < 5; k++) this.noise({ type: 'bandpass', f: 900 + Math.random() * 1400, q: 3, dur: 0.04, vol: 0.05 * o.g, pan: o.pan, at: 0.1 + k * 0.06 });
  },
  mine(o) { this.thump(140 + o.r * 60, 70, 0.07, 0.1 * o.g, { pan: o.pan }); this.noise({ type: 'bandpass', f: 2400, q: 2, dur: 0.04, vol: 0.06 * o.g, pan: o.pan }); },
  chop(o) {                                               // axe in wood: resonant knock, splinter crack, a little ring
    this.thump(175 + o.r * 30, 78, 0.14, 0.26 * o.g, { pan: o.pan });
    this.noise({ type: 'bandpass', f: 850, f2: 480, q: 4, dur: 0.09, vol: 0.24 * o.g, pan: o.pan });
    this.noise({ type: 'highpass', f: 3500, dur: 0.03, vol: 0.1 * o.g, pan: o.pan, at: 0.01 });
    this.tone({ f: 320, f2: 200, dur: 0.12, vol: 0.05 * o.g, type: 'triangle', pan: o.pan, at: 0.015 });
    this.noise({ type: 'bandpass', f: 1400, q: 5, dur: 0.05, vol: 0.05 * o.g, pan: o.pan, at: 0.05 });
  },
  creak(o) { this.tone({ f: 190, f2: 330, dur: 0.5, a: 0.1, vol: 0.09 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'bandpass', f: 600, q: 6 }, vib: [26, 30] }); this.noise({ type: 'bandpass', f: 700, f2: 1500, q: 4, dur: 0.5, a: 0.1, vol: 0.09 * o.g, pan: o.pan }); },
  crash(o) {                                              // a tree comes down: groan, tearing crackle, a swish of leaves
    VOICES.creak.call(this, o);
    this.noise({ type: 'bandpass', f: 1800, f2: 400, q: 0.6, dur: 0.55, a: 0.08, vol: 0.14 * o.g, pan: o.pan, rev: 0.3 });
    for (let k = 0; k < 8; k++) this.noise({ type: 'bandpass', f: 1500 - k * 100, q: 3, dur: 0.04, vol: 0.07 * o.g, pan: o.pan, at: 0.03 + k * 0.06 });
    this.noise({ type: 'highpass', f: 4000, dur: 0.5, a: 0.15, vol: 0.04 * o.g, pan: o.pan });
    this.thump(92, 34, 0.5, 0.26 * o.g, { pan: o.pan, rev: 0.3, at: 0.2 }); VOICES.thud.call(this, { pan: o.pan, g: o.g * 0.7, r: o.r });
  },
  break(o) { this.noise({ type: 'lowpass', f: 2600, f2: 300, dur: 0.28, vol: 0.18 * o.g, pan: o.pan, rev: 0.25 }); this.thump(100, 40, 0.22, 0.16 * o.g, { pan: o.pan }); for (let k = 0; k < 3; k++) this.noise({ type: 'bandpass', f: 1600 + k * 500, q: 3, dur: 0.04, vol: 0.06 * o.g, pan: o.pan, at: 0.04 + k * 0.05 }); },
  hammer(o) {                                             // hammer on timber + a bright nail ping
    this.thump(205, 88, 0.07, 0.18 * o.g, { pan: o.pan }); this.noise({ type: 'bandpass', f: 2000, q: 2.5, dur: 0.035, vol: 0.12 * o.g, pan: o.pan });
    this.ring(1500 + o.r * 400, 0.018 * o.g, { pan: o.pan, len: 0.7, rev: 0.35 });
  },
  place(o) { this.thump(150, 70, 0.1, 0.16 * o.g, { pan: o.pan }); this.noise({ type: 'lowpass', f: 1200, dur: 0.07, vol: 0.09 * o.g, pan: o.pan }); this.noise({ type: 'bandpass', f: 2200, q: 3, dur: 0.02, vol: 0.05 * o.g, pan: o.pan, at: 0.01 }); },
  pickup(o) { this.tone({ f: 784, dur: 0.1, vol: 0.06 * o.g, type: 'triangle', pan: o.pan, rev: 0.2 }); this.tone({ f: 1175, dur: 0.14, vol: 0.05 * o.g, type: 'triangle', at: 0.06, pan: o.pan, rev: 0.2 }); },
  coin(o) {                                               // a little shower of coins: metal partials at different pitches
    const j = 1 + o.r * 0.08;
    this.ring(2100 * j, 0.045 * o.g, { pan: o.pan, len: 0.7, rev: 0.4 }); this.ring(2900 * j, 0.022 * o.g, { pan: o.pan, len: 0.6, rev: 0.4, at: 0.05 }); this.ring(2500 * j, 0.02 * o.g, { pan: o.pan, len: 0.5, rev: 0.4, at: 0.1 });
    this.noise({ type: 'highpass', f: 6500, dur: 0.05, vol: 0.03 * o.g, pan: o.pan });
  },
  power(o) { for (let k = 0; k < 4; k++) this.tone({ f: 392 * Math.pow(1.26, k), dur: 0.3, vol: 0.05 * o.g, type: 'triangle', at: k * 0.05, pan: o.pan, rev: 0.5 }); },
  craft(o) { this.tone({ f: 523, dur: 0.1, vol: 0.07 * o.g, type: 'triangle', pan: o.pan, rev: 0.3 }); this.tone({ f: 784, dur: 0.18, vol: 0.07 * o.g, type: 'triangle', at: 0.08, pan: o.pan, rev: 0.3 }); VOICES.hammer.call(this, { pan: o.pan, g: o.g * 0.7, r: o.r }); },
  upgrade(o) { [392, 494, 587, 784].forEach((f, k) => this.tone({ f, dur: 0.32, vol: 0.06 * o.g, type: 'triangle', at: k * 0.09, pan: o.pan, rev: 0.5 })); this.noise({ type: 'highpass', f: 5000, dur: 0.3, a: 0.2, vol: 0.03 * o.g, rev: 0.5 }); this.ring(1568, 0.02 * o.g, { at: 0.3, rev: 0.6, len: 1.4 }); },
  done(o) { [523, 659, 784, 1047].forEach((f, k) => this.tone({ f, dur: 0.4, vol: 0.055 * o.g, type: 'triangle', at: k * 0.08, pan: o.pan, rev: 0.6 })); VOICES.hammer.call(this, { pan: o.pan, g: o.g * 0.6, r: o.r }); },
  click(o) { this.tone({ f: 1100, f2: 700, dur: 0.03, vol: 0.05 * o.g, type: 'triangle', filter: { type: 'lowpass', f: 3500 } }); this.noise({ type: 'bandpass', f: 3000, q: 2, dur: 0.012, vol: 0.03 * o.g }); },
  open(o) { this.noise({ type: 'bandpass', f: 600, f2: 1800, q: 0.8, dur: 0.14, a: 0.03, vol: 0.05 * o.g }); this.tone({ f: 520, f2: 780, dur: 0.1, vol: 0.035 * o.g, type: 'triangle' }); },
  deny(o) { this.tone({ f: 150, f2: 105, dur: 0.17, vol: 0.08 * o.g, type: 'square', filter: { type: 'lowpass', f: 650 } }); },
  step(o) { const k = 0.8 + o.r * 0.5; this.noise({ type: 'lowpass', f: 520 * k, f2: 170, q: 0.8, dur: 0.075, vol: 0.085 * o.g, pan: o.pan }); this.noise({ type: 'bandpass', f: 1800 * k, q: 1.5, dur: 0.03, vol: 0.02 * o.g, pan: o.pan }); this.thump(92 * k, 55, 0.05, 0.05 * o.g, { pan: o.pan }); },
  stepStone(o) { const k = 0.85 + o.r * 0.4; this.noise({ type: 'bandpass', f: 1700 * k, f2: 900, q: 1.4, dur: 0.05, vol: 0.09 * o.g, pan: o.pan }); this.noise({ type: 'highpass', f: 4500, dur: 0.012, vol: 0.05 * o.g, pan: o.pan }); this.thump(130 * k, 70, 0.045, 0.06 * o.g, { pan: o.pan }); },
  stepDirt(o) { const k = 0.8 + o.r * 0.4; this.noise({ type: 'lowpass', f: 900 * k, f2: 250, q: 0.8, dur: 0.09, vol: 0.09 * o.g, pan: o.pan }); this.noise({ type: 'bandpass', f: 2600 * k, q: 3, dur: 0.02, vol: 0.03 * o.g, pan: o.pan, at: 0.01 }); this.thump(100 * k, 55, 0.05, 0.05 * o.g, { pan: o.pan }); },
  arrow(o) {                                              // bowstring twang, then the arrow's whistle
    this.pluck({ f: 150 + o.r * 25, vol: 0.2 * o.g, dur: 0.28, lp: 1800, bright: true, pan: o.pan, rev: 0.1 });
    this.noise({ type: 'bandpass', f: 3600, f2: 1300, q: 1.6, dur: 0.22, a: 0.02, vol: 0.06 * o.g, pan: o.pan, at: 0.02 });
  },
  cannon(o) { this.thump(92, 28, 0.55, 0.5 * o.g, { pan: o.pan, rev: 0.5 }); this.noise({ type: 'lowpass', f: 3600, f2: 110, dur: 0.6, vol: 0.3 * o.g, pan: o.pan, rev: 0.5 }); this.noise({ type: 'highpass', f: 2200, dur: 0.05, vol: 0.12 * o.g, pan: o.pan }); this.tone({ f: 62, f2: 36, dur: 0.9, a: 0.02, vol: 0.12 * o.g, type: 'sine', rev: 0.6, at: 0.05 }); },
  mortar(o) { this.thump(70, 24, 0.55, 0.5 * o.g, { pan: o.pan, rev: 0.6 }); this.noise({ type: 'lowpass', f: 2200, f2: 100, dur: 0.65, vol: 0.26 * o.g, pan: o.pan, rev: 0.6 }); this.tone({ f: 1300, f2: 340, dur: 0.95, a: 0.1, vol: 0.028 * o.g, type: 'sine', at: 0.25, pan: o.pan, rev: 0.4 }); },
  explode(o) { this.thump(80, 26, 0.6, 0.45 * o.g, { pan: o.pan, rev: 0.6 }); this.noise({ type: 'lowpass', f: 3500, f2: 90, dur: 0.8, vol: 0.32 * o.g, pan: o.pan, rev: 0.6 }); this.noise({ type: 'bandpass', f: 1800, q: 1.5, dur: 0.3, vol: 0.1 * o.g, pan: o.pan, at: 0.05 }); for (let k = 0; k < 6; k++) this.noise({ type: 'bandpass', f: 800 + Math.random() * 1600, q: 3, dur: 0.04, vol: 0.05 * o.g, pan: o.pan, at: 0.18 + k * 0.07 }); },
  magic(o) { this.tone({ f: 520, f2: 1500, dur: 0.3, vol: 0.06 * o.g, type: 'sine', pan: o.pan, rev: 0.6, vib: [18, 14] }); this.tone({ f: 780, f2: 2200, dur: 0.26, vol: 0.03 * o.g, type: 'triangle', pan: o.pan, rev: 0.6, at: 0.03 }); this.noise({ type: 'highpass', f: 5500, dur: 0.25, a: 0.05, vol: 0.03 * o.g, pan: o.pan, rev: 0.5 }); this.ring(1760, 0.012 * o.g, { pan: o.pan, rev: 0.7, len: 1.4, at: 0.1 }); },
  cast(o) { this.tone({ f: 180, f2: 460, dur: 0.5, a: 0.1, vol: 0.07 * o.g, type: 'sine', pan: o.pan, rev: 0.6, vib: [7, 8] }); this.noise({ type: 'bandpass', f: 400, f2: 1600, q: 1, dur: 0.45, a: 0.1, vol: 0.05 * o.g, pan: o.pan, rev: 0.5 }); },
  summon(o) { this.tone({ f: 70, f2: 150, dur: 0.9, a: 0.2, vol: 0.12 * o.g, type: 'sawtooth', pan: o.pan, rev: 0.6, filter: { type: 'lowpass', f: 500 } }); this.noise({ type: 'bandpass', f: 300, f2: 1200, q: 1.2, dur: 0.8, a: 0.2, vol: 0.06 * o.g, rev: 0.7 }); },
  heal(o) { [659, 784, 988, 1319].forEach((f, k) => this.tone({ f, dur: 0.55, vol: 0.04 * o.g, type: 'sine', at: k * 0.07, pan: o.pan, rev: 0.7 })); this.ring(2093, 0.01 * o.g, { pan: o.pan, rev: 0.7, len: 1.6, at: 0.2 }); },
  zombie(o) {                                             // a throaty moan with a wobbling vowel
    const f = 70 + o.r * 30;
    this.tone({ f, f2: f * 0.7, dur: 0.8, a: 0.14, vol: 0.13 * o.g, type: 'sawtooth', pan: o.pan, rev: 0.4, filter: { type: 'lowpass', f: 330 + o.r * 150, f2: 170 }, vib: [5 + o.r * 3, 6] });
    this.tone({ f: f * 3, f2: f * 2.2, dur: 0.6, a: 0.12, vol: 0.03 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'bandpass', f: 520, q: 4 }, vib: [6, 10] });
    this.noise({ type: 'bandpass', f: 220, q: 2, dur: 0.5, a: 0.1, vol: 0.05 * o.g, pan: o.pan });
  },
  skeleton(o) { for (let k = 0; k < 4 + (o.r * 3 | 0); k++) this.noise({ type: 'bandpass', f: 2200 + Math.random() * 1800, q: 5, dur: 0.025, vol: 0.17 * o.g, pan: o.pan, at: k * 0.035 + Math.random() * 0.02 }); this.ring(1900, 0.02 * o.g, { pan: o.pan, len: 0.3, rev: 0.2 }); },
  die(o) { this.tone({ f: 300, f2: 55, dur: 0.5, vol: 0.1 * o.g, type: 'sawtooth', pan: o.pan, filter: { type: 'lowpass', f: 1200, f2: 200 }, rev: 0.3 }); this.noise({ type: 'lowpass', f: 1200, f2: 150, dur: 0.3, vol: 0.1 * o.g, pan: o.pan }); this.thump(90, 40, 0.3, 0.14 * o.g, { pan: o.pan, at: 0.12 }); },
  horn(o) {                                               // war horn: two brass notes with a breathy attack
    for (const [f, at, d] of [[110, 0, 0.9], [146.8, 0.85, 1.3]]) { this.tone({ f, dur: d, a: 0.16, vol: 0.15 * o.g, type: 'sawtooth', at, rev: 0.6, filter: { type: 'lowpass', f: 700, f2: 1100, q: 1.2 }, exact: true }); this.tone({ f: f * 2.005, dur: d, a: 0.2, vol: 0.05 * o.g, type: 'square', at, rev: 0.6, filter: { type: 'lowpass', f: 900 }, exact: true }); this.noise({ type: 'bandpass', f: 900, q: 1.2, dur: 0.3, a: 0.05, vol: 0.03 * o.g, at, rev: 0.5 }); }
  },
  night(o) { VOICES.horn.call(this, o); },
  boss(o) { this.tone({ f: 58, f2: 38, dur: 1.4, a: 0.05, vol: 0.28 * o.g, type: 'sawtooth', rev: 0.7, filter: { type: 'lowpass', f: 420 }, vib: [9, 8] }); this.noise({ type: 'lowpass', f: 700, f2: 120, dur: 1.2, a: 0.05, vol: 0.2 * o.g, rev: 0.6 }); this.tone({ f: 130, f2: 60, dur: 1, vol: 0.1 * o.g, type: 'square', at: 0.1, filter: { type: 'lowpass', f: 300 }, rev: 0.5 }); },
  dawn(o) { [392, 523, 659, 784].forEach((f, k) => this.tone({ f, dur: 1.1, a: 0.05, vol: 0.05 * o.g, type: 'triangle', at: k * 0.16, rev: 0.8 })); [784, 1047].forEach((f, k) => this.pluck({ f, vol: 0.1 * o.g, dur: 1.2, rev: 0.8, at: 0.7 + k * 0.2, lp: 4000, bright: true })); },
  cloud(o) { this.noise({ type: 'bandpass', f: 500, f2: 2200, q: 0.6, dur: 1.8, a: 0.5, vol: 0.11 * o.g, rev: 0.7 }); [330, 440, 554, 659].forEach((f, k) => this.tone({ f, dur: 1.6, a: 0.3, vol: 0.04 * o.g, type: 'sine', at: 0.2 + k * 0.18, rev: 0.9 })); },
  fire(o) { this.noise({ type: 'bandpass', f: 900, f2: 300, q: 0.8, dur: 0.4, a: 0.05, vol: 0.06 * o.g, pan: o.pan }); },
};
