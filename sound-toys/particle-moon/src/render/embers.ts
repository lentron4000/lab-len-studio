// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { createCrispSprites, RITUAL_INK } from './palette';

/** Most embers alive at once. */
const POOL = 360;

/**
 * Ritual sparks. Flaring particles shed embers that rise like heat off a fire, wander on a slow
 * turbulence, and go out: black ash on the red ground. Screen-space only: they
 * don't touch the simulation. Speeds are in shape radii, so they look the same at any window size.
 */
export class Embers {
  private readonly x = new Float32Array(POOL);
  private readonly y = new Float32Array(POOL);
  private readonly vx = new Float32Array(POOL);
  private readonly vy = new Float32Array(POOL);
  private readonly age = new Float32Array(POOL);
  private readonly life = new Float32Array(POOL);
  private readonly size = new Float32Array(POOL);
  private readonly seed = new Float32Array(POOL);
  private readonly sprites = createCrispSprites([RITUAL_INK], 16);
  private next = 0;
  private time = 0;

  /** Starts an ember at a screen position. `heat` (0–1) sets how fast and far it goes. */
  spawn(px: number, py: number, heat: number, radius: number): void {
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    this.x[i] = px;
    this.y[i] = py;
    this.vx[i] = (Math.random() - 0.5) * 0.15 * radius;
    this.vy[i] = -(0.12 + 0.25 * heat * Math.random()) * radius;
    this.age[i] = 0;
    this.life[i] = 1.4 + 2.2 * Math.random() * (0.5 + heat);
    this.size[i] = 1 + Math.random() * 1.6;
    this.seed[i] = Math.random() * 100;
  }

  tick(dt: number, radius: number): void {
    this.time += dt;
    const drag = Math.exp(-dt / 1.6);
    const lift = 0.1 * radius * dt;
    const swirl = 0.35 * radius * dt;
    for (let i = 0; i < POOL; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const s = this.seed[i];
      this.vx[i] = this.vx[i] * drag + Math.sin(this.time * 1.7 + s) * swirl;
      this.vy[i] = this.vy[i] * drag - lift;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }

  /** Laid over (source-over), not added: black on red. `scale` is the particle dot size. */
  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.globalCompositeOperation = 'source-over';
    const last = this.sprites.length - 1;
    for (let i = 0; i < POOL; i++) {
      if (this.age[i] >= this.life[i]) continue;
      const t = this.age[i] / this.life[i];
      // Flickers as it cools; the brief fade-in stops it popping on.
      const flicker = 0.75 + 0.25 * Math.sin(this.time * 23 + this.seed[i] * 7);
      ctx.globalAlpha = Math.min(1, t * 12) * (1 - t) * flicker;
      const r = scale * this.size[i] * (2.4 - t);
      ctx.drawImage(
        this.sprites[Math.min(last, (t * this.sprites.length) | 0)],
        this.x[i] - r,
        this.y[i] - r,
        r * 2,
        r * 2,
      );
    }
  }
}
