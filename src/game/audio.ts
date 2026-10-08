// Procedural ambience placeholders (no audio files): city hum, distant danfo horns, waterfront wash.
// Starts on the first user gesture (browser autoplay rules) and respects the mute setting.

class Ambience {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  city: GainNode | null = null;
  water: GainNode | null = null;
  muted = false;
  private lastHonk = 0;

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.55;
    master.connect(ctx.destination);
    this.master = master;
    // brown noise buffer
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    const mk = (freq: number, q: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(master);
      src.start();
      return g;
    };
    this.city = mk(420, 0.4, 0.35);
    this.water = mk(900, 0.2, 0);
    // occasional distant horns
    const loop = () => {
      if (!this.ctx) return;
      if (Math.random() < 0.55) this.horn(0.05 + Math.random() * 0.05, 330 + Math.random() * 120);
      setTimeout(loop, 2500 + Math.random() * 6000);
    };
    setTimeout(loop, 3000);
  }

  horn(vol: number, base: number) {
    const ctx = this.ctx, m = this.master;
    if (!ctx || !m) return;
    const t = ctx.currentTime;
    const beeps = 1 + Math.floor(Math.random() * 3);
    for (let b = 0; b < beeps; b++) {
      const t0 = t + b * 0.22;
      for (const mul of [1, 1.26]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = base * mul;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
        g.gain.setValueAtTime(vol, t0 + 0.14);
        g.gain.linearRampToValueAtTime(0, t0 + 0.18);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1800;
        o.connect(f).connect(g).connect(m);
        o.start(t0);
        o.stop(t0 + 0.2);
      }
    }
  }

  honk() {
    const now = performance.now();
    if (now - this.lastHonk < 1800) return;
    this.lastHonk = now;
    this.horn(0.16, 360);
  }

  /** 0..1 how close to the water's edge; 0..1 traffic density */
  mix(nearWater: number, busy: number) {
    if (!this.ctx || !this.city || !this.water) return;
    const t = this.ctx.currentTime;
    this.water.gain.setTargetAtTime(nearWater * 0.5, t, 0.8);
    this.city.gain.setTargetAtTime(0.18 + busy * 0.3, t, 0.8);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.1);
  }
}

export const audio = new Ambience();
