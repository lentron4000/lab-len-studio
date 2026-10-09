// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { angularStep } from './divisions';

const DEG = Math.PI / 180;
/** Orbit inclined 14° so the near pass crosses the lower face of the globe and the far pass goes behind it. */
const INCLINATION = 14 * DEG;
/** Orbit plane leaned −10° on screen. */
const LEAN = -10 * DEG;
const ORBIT_RADIUS = 1.45; // × shape radius
const MOON_RADIUS = 0.22; // × shape radius

/** The moon: position, velocity and size in screen pixels (z toward the viewer). */
export class Moon {
  enabled = true;
  /** Bars per orbit, from the Orbit slider. */
  bars = 8;
  /** Force multiplier, from the Force slider. */
  force = 1;

  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  radius = 0;
  /** Fades the moon in and out (0–1) when toggled. */
  presence = 0;

  private phase = 2.2;
  private omega = 0;

  /** Advances one simulation step around a centre (cx, cy) for a shape of radius `r`. */
  step(cx: number, cy: number, r: number, bpm: number): void {
    this.presence += ((this.enabled ? 1 : 0) - this.presence) * 0.05;
    this.omega += (angularStep(this.bars, bpm) - this.omega) * 0.04;
    // Retrograde: against the globe's spin, so the near pass meets the surface head-on.
    this.phase -= this.omega;

    const orbit = r * ORBIT_RADIUS;
    const x0 = orbit * Math.cos(this.phase);
    const z0 = orbit * Math.sin(this.phase);
    const y1 = z0 * Math.sin(INCLINATION);
    const z1 = z0 * Math.cos(INCLINATION);
    const nx = cx + x0 * Math.cos(LEAN) - y1 * Math.sin(LEAN);
    const ny = cy + x0 * Math.sin(LEAN) + y1 * Math.cos(LEAN);

    this.vx = nx - this.x;
    this.vy = ny - this.y;
    this.vz = z1 - this.z;
    this.x = nx;
    this.y = ny;
    this.z = z1;
    this.radius = r * MOON_RADIUS * this.presence;
  }

  get visible(): boolean {
    return this.presence > 0.02;
  }
}
