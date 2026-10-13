// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { lerp } from '../lib/math';
import { CAMERA_DISTANCE, type Simulation } from '../sim/simulation';
import { Embers } from './embers';
import { Fireflies } from './fireflies';
import {
  assignColours,
  createGlowSprites,
  createHeatSprites,
  css,
  DAY_BANDS,
  DAY_INK,
  DAY_PAPER,
  DUSK,
  NEON,
  HEAT,
  NIGHT_BANDS,
  RITUAL_BLACK,
  SMOKE,
} from './palette';
import { Tracers } from './tracers';

const BANDS = 4;
/** Chance per frame that a hot ritual particle sheds an ember, and the excitation it takes. */
const EMBER_RATE = 0.03;
const EMBER_HEAT = 0.65;

/** Day: ink on paper. Night: neon over a dusk sky. Ritual: blood and ember on black, with a blood moon. */
export type Look = 'day' | 'night' | 'ritual';

/**
 * Canvas 2D renderer. Particles are sorted into four depth bands and split again at the moon's depth,
 * so the moon is painted in the right place: hidden behind the globe on the far pass, covering it on
 * the near pass. Day draws flat ink dots; night and ritual draw additive glow sprites.
 */
export class Renderer {
  look: Look = 'day';
  /** Only particles below this index are drawn (the opening bloom brings them in). */
  limit = Infinity;
  readonly fireflies: Fireflies;
  readonly tracers: Tracers;
  readonly embers = new Embers();

  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: Record<'night' | 'ritual', HTMLCanvasElement[]>;
  private readonly strokes: Record<'night' | 'ritual', string[]>;
  private readonly colourOf: Uint8Array;
  /** Ritual: heat-ramp step per particle this frame, and a fixed per-particle tone so rest isn't flat. */
  private readonly heatOf: Uint8Array;
  private readonly restTone: Float32Array;
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
    this.sprites = { night: createGlowSprites(NEON), ritual: createHeatSprites() };
    this.strokes = { night: NEON.map(css), ritual: SMOKE.map(css) };
    this.colourOf = assignColours(sim.sphereX, sim.sphereY, sim.sphereZ);
    this.heatOf = new Uint8Array(sim.count);
    this.restTone = Float32Array.from({ length: sim.count }, () => Math.random());
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
    if (this.look === 'night') this.fireflies.tick(dt, now, this.sim, this.reducedMotion);
    this.embers.tick(dt, this.sim.viewport.radius);
    this.tracers.tick(dt, this.sim.globe, this.sim.spinSpeed);
  }

  /** Draws a frame. Returns the dot radius, which the readout uses for its density figure. */
  draw(): number {
    const { ctx, sim, look } = this;
    const glow = look !== 'day';
    const ritual = look === 'ritual';
    const { x, y, z, count: N, moon } = sim;
    const { radius: R, cx, cy } = sim.viewport;
    const sprites = this.sprites[ritual ? 'ritual' : 'night'];

    ctx.fillStyle = ritual ? RITUAL_BLACK : glow ? this.duskGradient() : DAY_PAPER;
    ctx.fillRect(0, 0, this.width, this.height);

    const re = sim.effectiveRadius();
    const camera = R * CAMERA_DISTANCE;
    const open = Math.pow(sim.state, 0.7);
    const spacing = R * Math.sqrt(Math.PI / N) * lerp(1, Math.SQRT2, sim.globe);
    // Packed: dots overlap into a solid. Open: small points.
    const dot = lerp(spacing * 0.9, Math.max(1.15, R / 170), open);
    // Ritual keeps only a trace of the jitter: per-frame wobble is what made it glitter.
    const jitter =
      (0.9 + sim.state * 1.5 * sim.mode.jitter) * (this.reducedMotion ? 0.3 : 1) * (ritual ? 0.25 : 1);
    // Night flashes come from the fireflies; ritual heat comes from the physics (excitation).
    const flash = ritual ? sim.excite : this.fireflies.flash;
    // Ritual glow follows the State slider, not the kicked state: on a near-solid setting, kicks that
    // briefly open the shape shouldn't bring the full glow back.
    const poise = Math.pow(sim.stateTarget, 0.7);
    if (ritual) this.updateHeat(poise);

    this.sortIntoBands(re);

    this.tracers.draw(ctx, {
      night: glow,
      openness: lerp(0.2, 1, open),
      // Smoke: wider and fainter than light trails.
      lineWidth: Math.min(ritual ? 5 : 3, Math.max(1, dot * (ritual ? 2.2 : glow ? 1.3 : 0.9))),
      alpha: ritual ? 0.5 : 1,
      flash,
      colourOf: ritual ? this.heatOf : this.colourOf,
      strokes: this.strokes[ritual ? 'ritual' : 'night'],
      motion: ritual ? sim.excite : undefined,
      dayInk: DAY_INK,
    });

    // Night glow. Base brightness is normalised by how much the sprites overlap (coverage), so a packed
    // solid glows instead of clipping to white; the rim of a packed globe is dimmed for the same reason.
    const coverage = (N * (dot * 2.2) ** 2 * 0.47) / (re * re);
    const base = lerp(Math.min(0.5, 0.5 / Math.max(coverage, 1e-3)), 0.14, open);
    const bloom = lerp(1.2, 4.2, open);
    const limb = 0.75 * sim.globe * (1 - open);
    // Ritual: a packed solid glows much less than an open cloud, or the overlap burns it out.
    const flashGain = ritual ? lerp(0.3, 1, poise) : lerp(0.55, 1, open);
    const swell = ritual ? lerp(0.35, 1.3, poise) : 0;
    // Ritual dots at rest: smaller and crisper toward solid (red points, not haze).
    const restSize = lerp(1.1, 1.5, poise);
    // Packed dots are drawn faint so their overlap doesn't burn out; lift them more there.
    const restLift = lerp(5, 2.8, poise);
    const emberRate = EMBER_RATE * lerp(0.25, 1, poise);
    const { comet } = this.tracers;
    const colourOf = ritual ? this.heatOf : this.colourOf;
    const trails = this.tracers.amount;

    ctx.save();
    if (glow) ctx.globalCompositeOperation = 'lighter';
    for (let b = 0; b < BANDS * 2; b++) {
      if (b === BANDS && moon.visible) this.drawMoon(camera);
      const idx = this.bands[b];
      const size = this.bandSize[b];
      if (size === 0) continue;
      if (glow) {
        const bandAlpha = NIGHT_BANDS[b % BANDS];
        for (let n = 0; n < size; n++) {
          const i = idx[n];
          const ps = camera / (camera - z[i]);
          const qx = cx + (x[i] - cx) * ps;
          const qy = cy + (y[i] - cy) * ps;
          this.tracers.record(i, qx, qy);
          const f = Math.max(flash[i], comet[i] * trails);
          const r = dot * ps * (ritual ? restSize + swell * f : 2.2 + bloom * f);
          const rim = 1 - limb * (1 - Math.min(1, Math.abs(z[i]) / re));
          // Ritual rests brighter: at rest it's all deep red, which needs more weight to read on black.
          const rest = ritual ? Math.min(0.85, base * restLift) : base;
          ctx.globalAlpha = Math.min(1, (rest * rim + (1 - rest) * f * flashGain) * bandAlpha);
          const px = qx + (Math.random() - 0.5) * 2 * jitter;
          const py = qy + (Math.random() - 0.5) * 2 * jitter;
          ctx.drawImage(sprites[colourOf[i]], px - r, py - r, r * 2, r * 2);
          if (ritual && f > EMBER_HEAT && Math.random() < emberRate * f) this.embers.spawn(px, py, f, R);
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
    if (ritual) {
      ctx.globalAlpha = 1;
      this.embers.draw(ctx, Math.max(1.2, R / 220));
    }
    ctx.restore();
    this.tracers.endFrame();
    return dot;
  }

  /**
   * Heat-ramp step from excitation, over a resting tone that varies between the two coldest steps.
   * How hot it can get follows the State slider: a packed solid tops out at ember orange, an open
   * cloud at white.
   */
  private updateHeat(poise: number): void {
    const { excite, count } = this.sim;
    const top = HEAT.length - 1;
    const reach = top * lerp(0.55, 1, poise);
    for (let i = 0; i < count; i++) {
      this.heatOf[i] = Math.min(top, (this.restTone[i] * 1.8 + excite[i] * reach) | 0);
    }
  }

  /** Depth bands by z (far side lighter), split at the moon's depth for correct occlusion. */
  private sortIntoBands(re: number): void {
    const { z, moon } = this.sim;
    const count = Math.min(this.sim.count, this.limit);
    const cut = moon.visible ? moon.z : Infinity;
    this.bandSize.fill(0);
    for (let i = 0; i < count; i++) {
      const t = z[i] / re;
      const depth = t > -0.25 ? 3 : t > -0.55 ? 2 : t > -0.8 ? 1 : 0;
      const b = depth + (z[i] > cut ? BANDS : 0);
      this.bands[b][this.bandSize[b]++] = i;
    }
  }

  /**
   * Day: a black disc. Night: inverted, solid white with a steady soft glow. Ritual: an eclipse,
   * a black disc in a blood-red corona. Always fully opaque.
   */
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
    if (this.look === 'ritual') {
      ctx.globalCompositeOperation = 'lighter';
      const haze = ctx.createRadialGradient(mx, my, mr, mx, my, mr * 2.4);
      haze.addColorStop(0, 'rgba(190,18,16,0.28)');
      haze.addColorStop(1, 'rgba(190,18,16,0)');
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.arc(mx, my, mr * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (this.look === 'night') {
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
    ctx.fillStyle = this.look === 'night' ? '#ffffff' : DAY_INK;
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
