/**
 * Web Audio-pohjainen äänikontrolleri. Kaikki SFX on synthetisoitu reaaliajassa
 * — ei MP3/OGG-assetteja, ei latencia-ongelmia, kevyt bundle. Stadium-yleisön
 * humu pyörii erillisellä audio-graphilla pelin aikana ja vaimennetaan
 * pelin loputtua.
 */
export class AudioController {
  constructor() {
    this.ctx = null;
    this.crowdNodes = null; // { source, gain }
    this.masterGain = null;
  }

  init() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
    } catch (e) { /* not supported */ }
  }

  /**
   * Plays a near-silent oscillator burst inside a user gesture handler.
   * Mobile Safari and Chrome Android only fully unlock the AudioContext if
   * they observe an actual buffer playing through the destination during
   * the gesture — `resume()` alone is not enough. Call this from the
   * Aloita peli / Pelaa uudelleen click handlers.
   */
  warmUp() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    try {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(this.masterGain || ctx.destination);
      gain.gain.value = 0.001;
      osc.frequency.value = 440;
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) { /* ignore */ }
  }

  _play(fn) {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    try { fn(this.ctx, this.masterGain); } catch (e) { /* ignore */ }
  }

  // ---------- ACTION SFX ----------

  // Crisp ball-strike thump for the forward pass.
  playKickSound() {
    this._play((ctx, dest) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(dest);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.09);
      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.13);
      osc.start(now); osc.stop(now + 0.13);

      // Higher transient "click" for the boot contact
      const click = ctx.createOscillator();
      const clickGain = ctx.createGain();
      click.connect(clickGain); clickGain.connect(dest);
      click.type = 'triangle';
      click.frequency.setValueAtTime(900, now);
      click.frequency.exponentialRampToValueAtTime(380, now + 0.05);
      clickGain.gain.setValueAtTime(0.22, now);
      clickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
      click.start(now); click.stop(now + 0.06);
    });
  }

  // Short whoosh for sidesteps / lane changes.
  playLaneSwapSound() {
    this._play((ctx, dest) => {
      const now = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.18);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const env = Math.sin((i / bufferSize) * Math.PI);
        data[i] = (Math.random() * 2 - 1) * env * 0.55;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(2200, now + 0.12);
      filter.Q.value = 4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
      noise.connect(filter); filter.connect(gain); gain.connect(dest);
      noise.start(now);
    });
  }

  // Rainbow flick: rising whoosh + a soft "tap" as the ball lifts off the heel.
  playRainbowFlickSound() {
    this._play((ctx, dest) => {
      const now = ctx.currentTime;

      // Rising swoosh
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(dest);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(820, now + 0.35);
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc.start(now); osc.stop(now + 0.45);

      // Heel-tap transient at the start
      const tap = ctx.createOscillator();
      const tapGain = ctx.createGain();
      tap.connect(tapGain); tapGain.connect(dest);
      tap.type = 'sine';
      tap.frequency.setValueAtTime(160, now);
      tap.frequency.exponentialRampToValueAtTime(60, now + 0.07);
      tapGain.gain.setValueAtTime(0.4, now);
      tapGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      tap.start(now); tap.stop(now + 0.1);
    });
  }

  // Whistle-blast tackle on collision.
  playCollisionSound() {
    this._play((ctx, dest) => {
      const now = ctx.currentTime;

      // Whistle: short high tone with quick warble
      const whistle = ctx.createOscillator();
      const wGain = ctx.createGain();
      whistle.connect(wGain); wGain.connect(dest);
      whistle.type = 'square';
      whistle.frequency.setValueAtTime(2400, now);
      whistle.frequency.linearRampToValueAtTime(2700, now + 0.18);
      whistle.frequency.linearRampToValueAtTime(2300, now + 0.36);
      wGain.gain.setValueAtTime(0.18, now);
      wGain.gain.setValueAtTime(0.18, now + 0.36);
      wGain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      whistle.start(now); whistle.stop(now + 0.45);

      // Body-thud noise burst
      const bufferSize = Math.floor(ctx.sampleRate * 0.3);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const noiseGain = ctx.createGain();
      noise.connect(noiseGain); noiseGain.connect(dest);
      noiseGain.gain.setValueAtTime(0.4, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      noise.start(now); noise.stop(now + 0.3);

      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.connect(subGain); subGain.connect(dest);
      sub.type = 'sine';
      sub.frequency.setValueAtTime(110, now);
      sub.frequency.exponentialRampToValueAtTime(40, now + 0.2);
      subGain.gain.setValueAtTime(0.45, now);
      subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      sub.start(now); sub.stop(now + 0.25);
    });
  }

  // Crisp two-note chime when the teammate returns the ball.
  playSuccessPassSound() {
    this._play((ctx, dest) => {
      const now = ctx.currentTime;
      const tones = [
        { f: 520, t: 0,    a: 0.30, d: 0.16 },
        { f: 780, t: 0.10, a: 0.32, d: 0.20 },
      ];
      for (const t of tones) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(dest);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(t.f, now + t.t);
        gain.gain.setValueAtTime(0.001, now + t.t);
        gain.gain.linearRampToValueAtTime(t.a, now + t.t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, now + t.t + t.d);
        osc.start(now + t.t); osc.stop(now + t.t + t.d);
      }
    });
  }

  // Three-note "fanfare" when a milestone fires.
  playMilestoneSound() {
    this._play((ctx, dest) => {
      const now = ctx.currentTime;
      const notes = [392, 523, 784]; // G4, C5, G5 — bright triumphant chord-arpeggio
      notes.forEach((f, i) => {
        const t = now + i * 0.10;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(dest);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t);
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.32, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.34);
        osc.start(t); osc.stop(t + 0.34);
      });
    });
  }

  // ---------- AMBIENT CROWD ----------

  startCrowdAmbient() {
    if (!this.ctx) return;
    if (this.crowdNodes) return; // already running

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 4-second pink-ish noise loop, low-pass filtered to feel like distant
    // crowd murmur instead of TV static.
    const bufferSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = b0 + b1 + b2 + white * 0.1848;
      data[i] *= 0.11;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.55, now + 1.5);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);

    this.crowdNodes = { source, gain, filter };
  }

  stopCrowdAmbient() {
    if (!this.ctx || !this.crowdNodes) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const { source, gain } = this.crowdNodes;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.0, now + 0.6);
    setTimeout(() => {
      try { source.stop(); } catch (e) { /* already stopped */ }
    }, 800);
    this.crowdNodes = null;
  }

  // Brief "roar" when a milestone lands, layered on top of the loop.
  playCrowdRoar() {
    this._play((ctx, dest) => {
      const now = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 1.5);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const env = Math.min(1, i / (ctx.sampleRate * 0.2)) * Math.pow(1 - i / bufferSize, 1.6);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1300;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      source.connect(filter); filter.connect(gain); gain.connect(dest);
      source.start(now);
    });
  }
}
