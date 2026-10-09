// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Simulation } from '../sim/simulation';

/** Wave front speed in shape radii per second. */
const WAVE_SPEED = 2.6;
const FLASH_DECAY = 0.45; // seconds

/**
 * Night-mode blinking. Each particle blinks on its own slow cycle (2.5–7 s). A pulse sends a flash
 * wave out from the centre; particles it crosses flash and restart their cycle, so on a steady beat
 * the swarm drifts toward blinking together, the way real fireflies synchronise.
 */
export class Fireflies {
  /** Current flash brightness per particle (0–1). */
  readonly flash: Float32Array;
  private readonly phase: Float32Array;
  private readonly rate: Float32Array;
  private waveStart = -1;
  private waveStrength = 0;
  private waveRadius = 0;

  constructor(count: number) {
    this.flash = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.rate = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.phase[i] = Math.random();
      this.rate[i] = 1 / (2.5 + Math.random() * 4.5);
    }
  }

  wave(strength: number, now: number): void {
    if (strength <= 0.2) return;
    this.waveStart = now;
    this.waveStrength = strength;
    this.waveRadius = 0;
  }

  tick(dt: number, now: number, sim: Simulation, reducedMotion: boolean): void {
    const { x, y, z, count } = sim;
    const { cx, cy } = sim.viewport;
    const re = sim.effectiveRadius();
    const front = this.waveStart >= 0 ? (now - this.waveStart) * WAVE_SPEED : -1;
    const decay = Math.exp(-dt / FLASH_DECAY);
    const speed = (1 + sim.state * 0.6) * (reducedMotion ? 0.5 : 1);
    const v = this.waveStrength;
    for (let i = 0; i < count; i++) {
      this.phase[i] += this.rate[i] * dt * speed;
      if (this.phase[i] >= 1) {
        this.phase[i] -= 1;
        this.flash[i] = Math.max(this.flash[i], 0.55 + 0.45 * Math.random());
      }
      this.flash[i] *= decay;
      if (front >= 0) {
        const d = Math.hypot(x[i] - cx, y[i] - cy, z[i]) / re;
        // A share of the particles the front crosses: enough to read as a wave, not a white-out.
        if (d > this.waveRadius && d <= front && Math.random() < 0.12 + 0.25 * v) {
          this.flash[i] = Math.max(this.flash[i], 0.25 + 0.6 * v);
          this.phase[i] = Math.random() * 0.15;
        }
      }
    }
    if (front >= 0) {
      this.waveRadius = front;
      if (front > 2.5) this.waveStart = -1;
    }
  }
}
