// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { lerp } from '../lib/math';
import { CAMERA_DISTANCE, type Simulation } from '../sim/simulation';
import { Fireflies } from './fireflies';
import {
  assignColours,
  createGlowSprites,
  css,
  DAY_BANDS,
  DAY_INK,
  DAY_PAPER,
  DUSK,
  NEON,
  NIGHT_BANDS,
} from './palette';
import { Tracers } from './tracers';

const BANDS = 4;

/**
 * Canvas 2D renderer. Particles are sorted into four depth bands and split again at the moon's depth,
 * so the moon is painted in the right place: hidden behind the globe on the far pass, covering it on
 * the near pass. Day draws flat ink dots; night draws additive glow sprites over a dusk sky.
 */
export class Renderer {
  night = false;
  readonly fireflies: Fireflies;
  readonly tracers: Tracers;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: HTMLCanvasElement[];
  private readonly strokes: string[];
  private readonly colourOf: Uint8Array;
  /** Particle indices per band; 0–3 behind the moon, 4–7 in front. */
  private readonly bands: Int32Array[];
  private readonly bandSize = new Int32Array(BANDS * 2);
  private width = 1;
  private height = 1;
  private dusk: CanvasGradient | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sim: Simulation,
    private readonly reducedMotion: boolean,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Sound Toy: 2D canvas is not available');
    this.ctx = ctx;
    this.fireflies = new Fireflies(sim.count);
    this.tracers = new Tracers(sim.count);
    this.sprites = createGlowSprites();
    this.strokes = NEON.map(css);
    this.colourOf = assignColours(sim.sphereX, sim.sphereY, sim.sphereZ);
    this.bands = Array.from({ length: BANDS * 2 }, () => new Int32Array(sim.count));
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dusk = null;
    this.tracers.reset();
  }

  /** Per-frame effects that run on real time rather than simulation steps. */
  tick(dt: number, now: number): void {
    if (this.night) this.fireflies.tick(dt, now, this.sim, this.reducedMotion);
    this.tracers.tick(dt, this.sim.globe, this.sim.spinSpeed);
  }

  /** Draws a frame. Returns the dot radius, which the readout uses for its density figure. */
  draw(): number {
    const { ctx, sim, night } = this;
    const { x, y, z, count: N, moon } = sim;
    const { radius: R, cx, cy } = sim.viewport;

    ctx.fillStyle = night ? this.duskGradient() : DAY_PAPER;
    ctx.fillRect(0, 0, this.width, this.height);

    const re = sim.effectiveRadius();
    const camera = R * CAMERA_DISTANCE;
    const open = Math.pow(sim.state, 0.7);
    const spacing = R * Math.sqrt(Math.PI / N) * lerp(1, Math.SQRT2, sim.globe);
    // Packed: dots overlap into a solid. Open: small points.
    const dot = lerp(spacing * 0.9, Math.max(1.15, R / 170), open);
    const jitter = (0.9 + sim.state * 1.5 * sim.mode.jitter) * (this.reducedMotion ? 0.3 : 1);

    this.sortIntoBands(re);

    this.tracers.draw(ctx, {
      night,
      openness: lerp(0.2, 1, open),
      lineWidth: Math.min(3, Math.max(1, dot * (night ? 1.3 : 0.9))),
      flash: this.fireflies.flash,
      colourOf: this.colourOf,
      strokes: this.strokes,
      dayInk: DAY_INK,
    });

    // Night glow. Base brightness is normalised by how much the sprites overlap (coverage), so a packed
    // solid glows instead of clipping to white; the rim of a packed globe is dimmed for the same reason.
    const coverage = (N * (dot * 2.2) ** 2 * 0.47) / (re * re);
    const base = lerp(Math.min(0.5, 0.5 / Math.max(coverage, 1e-3)), 0.14, open);
    const bloom = lerp(1.2, 4.2, open);
    const limb = 0.75 * sim.globe * (1 - open);
    const flashGain = lerp(0.55, 1, open);
    const { flash } = this.fireflies;
    const { comet } = this.tracers;
    const trails = this.tracers.amount;

    ctx.save();
    if (night) ctx.globalCompositeOperation = 'lighter';
    for (let b = 0; b < BANDS * 2; b++) {
      if (b === BANDS && moon.visible) this.drawMoon(camera);
      const idx = this.bands[b];
      const size = this.bandSize[b];
      if (size === 0) continue;
      if (night) {
        const bandAlpha = NIGHT_BANDS[b % BANDS];
        for (let n = 0; n < size; n++) {
          const i = idx[n];
          const ps = camera / (camera - z[i]);
          const qx = cx + (x[i] - cx) * ps;
          const qy = cy + (y[i] - cy) * ps;
          this.tracers.record(i, qx, qy);
          const f = Math.max(flash[i], comet[i] * trails);
          const r = dot * ps * (2.2 + bloom * f);
          const rim = 1 - limb * (1 - Math.min(1, Math.abs(z[i]) / re));
          ctx.globalAlpha = Math.min(1, (base * rim + (1 - base) * f * flashGain) * bandAlpha);
          const px = qx + (Math.random() - 0.5) * 2 * jitter;
          const py = qy + (Math.random() - 0.5) * 2 * jitter;
          ctx.drawImage(this.sprites[this.colourOf[i]], px - r, py - r, r * 2, r * 2);
        }
      } else {
        ctx.fillStyle = DAY_BANDS[b % BANDS];
        ctx.beginPath();
        for (let n = 0; n < size; n++) {
          const i = idx[n];
          const ps = camera / (camera - z[i]);
          const qx = cx + (x[i] - cx) * ps;
          const qy = cy + (y[i] - cy) * ps;
          this.tracers.record(i, qx, qy);
          const r = dot * ps;
          const px = qx + (Math.random() - 0.5) * 2 * jitter;
          const py = qy + (Math.random() - 0.5) * 2 * jitter;
          ctx.moveTo(px + r, py);
          ctx.arc(px, py, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
    ctx.restore();
    this.tracers.endFrame();
    return dot;
  }

  /** Depth bands by z (far side lighter), split at the moon's depth for correct occlusion. */
  private sortIntoBands(re: number): void {
    const { z, count, moon } = this.sim;
    const cut = moon.visible ? moon.z : Infinity;
    this.bandSize.fill(0);
    for (let i = 0; i < count; i++) {
      const t = z[i] / re;
      const depth = t > -0.25 ? 3 : t > -0.55 ? 2 : t > -0.8 ? 1 : 0;
      const b = depth + (z[i] > cut ? BANDS : 0);
      this.bands[b][this.bandSize[b]++] = i;
    }
  }

  /** Day: a black disc. Night: inverted, solid white with a steady soft glow. Always fully opaque. */
  private drawMoon(camera: number): void {
    const { ctx } = this;
    const { moon } = this.sim;
    const { cx, cy } = this.sim.viewport;
    const ps = camera / (camera - moon.z);
    const mx = cx + (moon.x - cx) * ps;
    const my = cy + (moon.y - cy) * ps;
    const mr = moon.radius * ps;
    ctx.save();
    ctx.globalAlpha = 1;
    if (this.night) {
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(mx, my, mr, mx, my, mr * 1.9);
      halo.addColorStop(0, 'rgba(255,255,255,0.16)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(mx, my, mr * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.night ? '#ffffff' : DAY_INK;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private duskGradient(): CanvasGradient {
    if (!this.dusk) {
      const g = this.ctx.createLinearGradient(0, 0, 0, this.height);
      for (const [stop, colour] of DUSK) g.addColorStop(stop, colour);
      this.dusk = g;
    }
    return this.dusk;
  }
}
