// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Simulation } from './simulation';

/** Seconds from the first particle leaving the loader to the last one arriving. */
export const BLOOM_SECONDS = 1.8;
/** Share of that time over which particles are born; each then travels for the rest. */
const BIRTH_SHARE = 0.6;

/**
 * The opening: the loader's single particle multiplies into the shape. Particles are born in index
 * order, which is centre-outward on the disc (phyllotaxis), at the loader's position, and ease out to
 * their homes. Born hot, they cool as they arrive. Drives positions directly; physics waits.
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

  /** Places the particles for time `t` (seconds) and returns how many have been born. */
  update(t: number): number {
    const { sim, ox, oy } = this;
    const n = sim.count;
    const births = BLOOM_SECONDS * BIRTH_SHARE;
    const travel = BLOOM_SECONDS - births;
    const born = Math.min(n, Math.ceil((t / births) * n));
    for (let i = 0; i < born; i++) {
      const p = Math.min(1, Math.max(0, (t - (i / n) * births) / travel));
      const e = 1 - (1 - p) ** 3;
      sim.x[i] = ox + (this.hx[i] - ox) * e;
      sim.y[i] = oy + (this.hy[i] - oy) * e;
      sim.z[i] = this.hz[i] * e;
      sim.excite[i] = 0.9 * (1 - e);
    }
    return born;
  }

  done(t: number): boolean {
    return t >= BLOOM_SECONDS;
  }
}
