// VIGIL // FOUNDRY — 100% synthesized audio (Web Audio API, zero files).
// Every sound is layered noise + oscillators built at runtime: distinct
// gunfire per weapon class, a metallic headshot "dink" vs a body "thud",
// reload clicks, velocity-tied footsteps, smoke hiss, flashbang ring decay.
// No AudioContext is created until the first user gesture (deploy click).

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.flashRing = null;
    this.stepPhase = 0;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _noise(dur, filterType, freq, gain, when = 0, q = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, type, gain, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  shot(kind, distance = 0) {
    if (!this.ctx) return;
    const att = 1 / (1 + distance * 0.09);
    const v = Math.min(1, att);
    if (kind === 'rifle') {
      this._noise(0.11, 'lowpass', 3200, 0.9 * v);
      this._noise(0.05, 'highpass', 1800, 0.5 * v);
      this._tone(150, 0.09, 'square', 0.35 * v, 0, 60);
    } else if (kind === 'smg') {
      this._noise(0.08, 'bandpass', 2400, 0.7 * v, 0, 1.4);
      this._tone(190, 0.06, 'square', 0.25 * v, 0, 80);
    } else if (kind === 'pistol') {
      this._noise(0.09, 'bandpass', 1900, 0.6 * v, 0, 1.2);
      this._tone(170, 0.07, 'square', 0.22 * v, 0, 70);
    } else if (kind === 'heavy') {
      this._noise(0.16, 'lowpass', 2200, 1.0 * v);
      this._tone(95, 0.14, 'sawtooth', 0.5 * v, 0, 45);
      this._noise(0.05, 'highpass', 2500, 0.4 * v);
    } else if (kind === 'knife') {
      this._noise(0.12, 'bandpass', 3200, 0.35, 0, 2.5);
    }
  }

  hit(headshot) {
    if (!this.ctx) return;
    if (headshot) { this._tone(2350, 0.09, 'sine', 0.5); this._tone(3120, 0.06, 'sine', 0.3, 0.01); }
    else { this._tone(220, 0.08, 'sine', 0.4, 0, 140); this._noise(0.05, 'lowpass', 700, 0.25); }
  }

  hurt() { this._tone(110, 0.12, 'sawtooth', 0.25, 0, 70); }
  kill() { this._tone(660, 0.07, 'sine', 0.3); this._tone(990, 0.1, 'sine', 0.3, 0.07); }
  reload() {
    this._tone(1400, 0.03, 'square', 0.15);
    this._tone(900, 0.03, 'square', 0.15, 0.18);
    this._tone(1600, 0.04, 'square', 0.2, 0.55);
  }
  dryFire() { this._tone(1100, 0.03, 'square', 0.12); }
  step(speedFrac) {
    if (!this.ctx || speedFrac < 0.05) return;
    this.stepPhase += speedFrac;
    if (this.stepPhase < 0.55) return;
    this.stepPhase = 0;
    this._noise(0.06, 'lowpass', 500 + speedFrac * 300, 0.10 + speedFrac * 0.12);
  }
  smoke() { this._noise(1.6, 'bandpass', 900, 0.25, 0, 0.7); }
  flash() {
    this._tone(4200, 0.4, 'sine', 0.4, 0, 3800);
    this._noise(0.25, 'highpass', 3000, 0.3);
  }
  ring(seconds = 3) {
    if (!this.ctx) return;
    this.stopRing();
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = 3400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + seconds);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + seconds + 0.1);
    this.flashRing = o;
  }
  stopRing() { try { this.flashRing?.stop(); } catch { /* already stopped */ } this.flashRing = null; }
  plant() { this._tone(880, 0.08, 'sine', 0.25); this._tone(880, 0.08, 'sine', 0.25, 0.25); }
  beep() { this._tone(1200, 0.07, 'sine', 0.3); }
  roundWin() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.16, 'triangle', 0.3, i * 0.12)); }
  roundLose() { [392, 330, 262].forEach((f, i) => this._tone(f, 0.18, 'triangle', 0.25, i * 0.13)); }
  buy() { this._tone(980, 0.05, 'sine', 0.25); this._tone(1320, 0.06, 'sine', 0.25, 0.06); }
  denied() { this._tone(180, 0.12, 'square', 0.2); }
}
