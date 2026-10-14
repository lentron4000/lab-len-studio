// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Simulation } from './simulation';

/** Seconds for the shape to grow from a point to its full size. */
export const BLOOM_SECONDS = 3;

/**
 * The opening: the circle grows out from its centre. Every particle starts at the centre and eases
 * straight out to its home, so the whole shape scales up from a point. Drives positions directly;
 * physics waits.
 *
 * Call after `sim.setViewport(…, true)`, which puts every particle at its home.
 */
export class Bloom {
  private readonly hx: Float32Array;
  private readonly hy: Float32Array;
  private readonly hz: Float32Array;

  constructor(
    private readonly sim: Simulation,
    private readonly ox: number,
    private readonly oy: number,
  ) {
    this.hx = Float32Array.from(sim.x);
    this.hy = Float32Array.from(sim.y);
    this.hz = Float32Array.from(sim.z);
  }

  /** Places the particles for time `t` (seconds). */
  update(t: number): void {
    const { sim, ox, oy } = this;
    // Ease in and out: starts gently, grows, settles.
    const p = Math.min(1, Math.max(0, t / BLOOM_SECONDS));
    const e = p * p * (3 - 2 * p);
    for (let i = 0; i < sim.count; i++) {
      sim.x[i] = ox + (this.hx[i] - ox) * e;
      sim.y[i] = oy + (this.hy[i] - oy) * e;
      sim.z[i] = this.hz[i] * e;
    }
  }

  done(t: number): boolean {
    return t >= BLOOM_SECONDS;
  }
}
