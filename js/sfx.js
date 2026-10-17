'use strict';
// Tiny WebAudio synth shared by both game modes.
const Sfx = {
  ctx: null, muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
  },
  tone(freq, dur, type, vol, slide) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur);
  },
  noise(dur, vol) {
    if (!this.ctx || this.muted) return;
    const n = Math.floor(this.ctx.sampleRate * dur), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    g.gain.value = vol || 0.08; s.buffer = buf; s.connect(g); g.connect(this.ctx.destination); s.start();
  },
  play(name) {
    switch (name) {
      case 'slash': this.noise(0.12, 0.07); this.tone(420, 0.1, 'sawtooth', 0.03, 0.5); break;
      case 'hit': this.tone(180, 0.1, 'square', 0.07, 0.5); this.noise(0.05, 0.06); break;
      case 'hurt': this.tone(140, 0.25, 'sawtooth', 0.08, 0.4); break;
      case 'jump': this.tone(300, 0.12, 'square', 0.03, 1.8); break;
      case 'dash': this.noise(0.25, 0.08); this.tone(250, 0.25, 'sawtooth', 0.04, 2.5); break;
      case 'mine': this.tone(110 + Math.random() * 40, 0.05, 'square', 0.04); break;
      case 'break': this.noise(0.12, 0.08); this.tone(90, 0.1, 'square', 0.05, 0.6); break;
      case 'place': this.tone(160, 0.06, 'square', 0.04); break;
      case 'pickup': this.tone(780, 0.07, 'square', 0.035); this.tone(1170, 0.09, 'square', 0.03); break;
      case 'coin': this.tone(990, 0.06, 'square', 0.03); this.tone(1480, 0.1, 'square', 0.03); break;
      case 'power': this.tone(400, 0.3, 'triangle', 0.07, 3); break;
      case 'craft': this.tone(520, 0.08, 'triangle', 0.06); this.tone(780, 0.14, 'triangle', 0.06); break;
      case 'cast': this.tone(200, 0.4, 'sine', 0.07, 2.2); break;
      case 'summon': this.tone(120, 0.6, 'sawtooth', 0.05, 2); break;
      case 'boss': this.tone(70, 1.2, 'sawtooth', 0.09, 0.7); break;
      case 'die': this.tone(300, 0.5, 'sawtooth', 0.07, 0.25); break;
      case 'night': this.tone(110, 1.4, 'triangle', 0.08, 0.6); break;
      case 'dawn': this.tone(330, 0.9, 'triangle', 0.06, 1.6); break;
      case 'deny': this.tone(110, 0.15, 'square', 0.05); break;
    }
  },
};
