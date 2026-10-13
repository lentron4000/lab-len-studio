// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Simulation } from './simulation';

/** Seconds from the first particle leaving the loader to the last one arriving. */
export const BLOOM_SECONDS = 1.8;
/** Share of that time over which particles are born; each then travels for the rest. */
const BIRTH_SHARE = 0.6;
/** How much of a particle's birth time comes from its distance from the centre; the rest is a smooth random field. */
const OUTWARD = 0.45;
/** Waves summed for the random field, and their frequency range (cycles across the shape's radius). */
const WAVES = 3;
const FREQUENCY: readonly [number, number] = [1.5, 3.5];

/**
 * The opening: the loader's single particle multiplies into the shape. Particles are born at the
 * loader's position and ease out to their homes; born hot, they cool as they arrive. The order is
 * broadly centre-outward but follows a smooth random field over the shape, so it fills in soft patches
 * rather than a neat spiral. Drives positions directly; physics waits.
 *
 * Call after `sim.setViewport(…, true)`, which puts every particle at its home.
 */
export class Bloom {
  /** 1 until a particle is born; the renderer skips those. */
  readonly hidden: Uint8Array;
  private readonly hx: Float32Array;
  private readonly hy: Float32Array;
  private readonly hz: Float32Array;
  /** Birth time per particle, 0–1 of the birth window. */
  private readonly birth: Float32Array;

  constructor(
    private readonly sim: Simulation,
    private readonly ox: number,
    private readonly oy: number,
    random: () => number = Math.random,
  ) {
    const n = sim.count;
    this.hx = Float32Array.from(sim.x);
    this.hy = Float32Array.from(sim.y);
    this.hz = Float32Array.from(sim.z);
    this.hidden = new Uint8Array(n).fill(1);
    this.birth = new Float32Array(n);

    const { cx, cy, radius } = sim.viewport;
    const waves = Array.from({ length: WAVES }, () => {
      const angle = random() * Math.PI * 2;
      const k = ((FREQUENCY[0] + random() * (FREQUENCY[1] - FREQUENCY[0])) * Math.PI * 2) / radius;
      return { kx: Math.cos(angle) * k, ky: Math.sin(angle) * k, phase: random() * Math.PI * 2 };
    });
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = this.hx[i] - cx;
      const dy = this.hy[i] - cy;
      let field = 0;
      for (const w of waves) field += Math.sin(w.kx * dx + w.ky * dy + w.phase);
      const b =
        OUTWARD * Math.min(1, Math.hypot(dx, dy) / radius) + (1 - OUTWARD) * (field / WAVES / 2 + 0.5);
      this.birth[i] = b;
      lo = Math.min(lo, b);
      hi = Math.max(hi, b);
    }
    // Spread births over the whole window.
    for (let i = 0; i < n; i++) this.birth[i] = (this.birth[i] - lo) / (hi - lo || 1);
  }

  /** Places the particles for time `t` (seconds). */
  update(t: number): void {
    const { sim, ox, oy } = this;
    const births = BLOOM_SECONDS * BIRTH_SHARE;
    const travel = BLOOM_SECONDS - births;
    for (let i = 0; i < sim.count; i++) {
      const since = t - this.birth[i] * births;
      if (since < 0) continue;
      this.hidden[i] = 0;
      const p = Math.min(1, since / travel);
      const e = 1 - (1 - p) ** 3;
      sim.x[i] = ox + (this.hx[i] - ox) * e;
      sim.y[i] = oy + (this.hy[i] - oy) * e;
      sim.z[i] = this.hz[i] * e;
      sim.excite[i] = 0.9 * (1 - e);
    }
  }

  done(t: number): boolean {
    return t >= BLOOM_SECONDS;
  }
}
