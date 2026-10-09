// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/** Frames of position history kept per particle. */
const LENGTH = 14;
/** At most this many particles draw a trail in a frame. */
const BUDGET = 400;
/** Brightness levels used to batch strokes. */
const LEVELS = 4;
/** Spin speed (radians per step) at which trails reach full strength. */
const FULL_SPIN = 0.004;

/**
 * Light trails while the globe spins: on brightly flashing particles (night) and on random
 * short-lived "comets". Keeps a ring buffer of smoothed screen positions for every particle.
 *
 * Cost control: trails are limited to the ~400 brightest, and drawn as one path per
 * (colour, brightness level, half), so a frame is about 50 strokes however many trails there are.
 */
export class Tracers {
  readonly comet: Float32Array;
  /** 0–1: how much the globe is spinning; trails scale with it. */
  amount = 0;
  private readonly histX: Float32Array;
  private readonly histY: Float32Array;
  private readonly smoothX: Float32Array;
  private readonly smoothY: Float32Array;
  private readonly intensity: Float32Array;
  private readonly histogram = new Int32Array(20);
  private groups: number[][] = [];
  private head = 0;
  private frames = 0;

  constructor(private readonly count: number) {
    this.comet = new Float32Array(count);
    this.histX = new Float32Array(count * LENGTH);
    this.histY = new Float32Array(count * LENGTH);
    this.smoothX = new Float32Array(count);
    this.smoothY = new Float32Array(count);
    this.intensity = new Float32Array(count);
  }

  /** Positions jumped (resize): don't draw trails across the jump. */
  reset(): void {
    this.frames = 0;
  }

  tick(dt: number, globe: number, spinSpeed: number): void {
    this.amount = globe * Math.min(1, Math.abs(spinSpeed) / FULL_SPIN);
    const decay = Math.exp(-dt / 0.8);
    for (let i = 0; i < this.count; i++) {
      if (!this.comet[i]) continue;
      this.comet[i] *= decay;
      if (this.comet[i] < 0.03) this.comet[i] = 0;
    }
    if (this.amount > 0.05) {
      const spawn = this.count * 0.0004 * this.amount * (dt * 60);
      for (let k = 0; k < spawn || Math.random() < spawn - k; k++) {
        this.comet[(Math.random() * this.count) | 0] = 0.6 + 0.4 * Math.random();
      }
    }
  }

  /** Records particle i's screen position for this frame (smoothed so thermal jitter doesn't zigzag). */
  record(i: number, px: number, py: number): void {
    if (this.frames) {
      this.smoothX[i] += 0.35 * (px - this.smoothX[i]);
      this.smoothY[i] += 0.35 * (py - this.smoothY[i]);
    } else {
      this.smoothX[i] = px;
      this.smoothY[i] = py;
    }
    const slot = i * LENGTH + this.head;
    this.histX[slot] = this.smoothX[i];
    this.histY[slot] = this.smoothY[i];
  }

  /** Call after every particle has been recorded for the frame. */
  endFrame(): void {
    this.frames++;
  }

  /**
   * Draws trails from the history recorded so far, then advances the ring so this frame's
   * positions land in a fresh slot. Call before the particles are drawn and recorded.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    opts: {
      night: boolean;
      openness: number;
      lineWidth: number;
      flash: Float32Array;
      colourOf: Uint8Array;
      strokes: readonly string[];
      dayInk: string;
    },
  ): void {
    const span = Math.min(this.frames, LENGTH);
    if (this.amount > 0.05 && span > 2) this.stroke(ctx, span, opts);
    this.head = (this.head + 1) % LENGTH;
  }

  private stroke(ctx: CanvasRenderingContext2D, span: number, o: Parameters<Tracers['draw']>[1]): void {
    const histogram = this.histogram.fill(0);
    for (let i = 0; i < this.count; i++) {
      const flicker = o.night ? Math.max(0, (o.flash[i] - 0.3) / 0.5) : 0;
      const v = Math.min(1, Math.max(flicker, this.comet[i])) * this.amount * o.openness;
      this.intensity[i] = v;
      if (v >= 0.05) histogram[Math.min(19, (v * 20) | 0)]++;
    }
    // Threshold that keeps roughly BUDGET trails, brightest first.
    let threshold = 0.05;
    let cumulative = 0;
    for (let b = 19; b >= 1; b--) {
      cumulative += histogram[b];
      if (cumulative > BUDGET) {
        threshold = (b + 1) / 20;
        break;
      }
    }
    const groupCount = o.strokes.length * LEVELS;
    if (this.groups.length !== groupCount) this.groups = Array.from({ length: groupCount }, () => []);
    for (const g of this.groups) g.length = 0;
    for (let i = 0; i < this.count; i++) {
      const v = this.intensity[i];
      if (v < threshold) continue;
      const colour = o.night ? o.colourOf[i] : 0;
      this.groups[colour * LEVELS + Math.min(LEVELS - 1, (v * LEVELS) | 0)].push(i);
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.lineWidth;
    ctx.globalCompositeOperation = o.night ? 'lighter' : 'source-over';
    for (let g = 0; g < this.groups.length; g++) {
      const list = this.groups[g];
      if (list.length === 0) continue;
      const level = (g % LEVELS) + 1;
      const len = Math.max(3, Math.round(span * (0.4 + 0.15 * level)));
      ctx.strokeStyle = o.night ? o.strokes[Math.floor(g / LEVELS)] : o.dayInk;
      // Newer half bright, older half faint.
      for (let half = 0; half < 2; half++) {
        const j0 = half ? len >> 1 : 0;
        const j1 = half ? len - 1 : len >> 1;
        ctx.globalAlpha = (level / LEVELS) * (half ? 0.22 : 0.6) * (o.night ? 1 : 0.5);
        ctx.beginPath();
        for (const i of list) {
          const base = i * LENGTH;
          for (let j = j0; j <= j1; j++) {
            const slot = base + ((this.head - j + LENGTH) % LENGTH);
            if (j === j0) ctx.moveTo(this.histX[slot], this.histY[slot]);
            else ctx.lineTo(this.histX[slot], this.histY[slot]);
          }
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
