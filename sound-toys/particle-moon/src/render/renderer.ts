// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { lerp } from '../lib/math';
import { angularStep } from '../sim/divisions';
import { CAMERA_DISTANCE, type Simulation } from '../sim/simulation';
import { Embers } from './embers';
import { Fireflies } from './fireflies';
import {
  assignColours,
  createGlowSprites,
  createHeatSprites,
  css,
  DARK_BANDS,
  DARK_INK,
  DARK_PAPER,
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
/** Spin streaks (each particle drawn out along its motion): off for now; true brings them back. */
const SPIN_STREAKS: boolean = false;
/** Spinning, each particle is drawn as a streak: its smoothed screen motion over this many frames. */
const STREAK_FRAMES = 7;
/**
 * Streak length follows the Spin setting: a turn every STREAK_TOP_BARS draws the longest streaks (the
 * rim's motion over STREAK_FRAMES), faster spins keep that length, and each halving of speed below it
 * takes an even step down, to nothing STREAK_OCTAVES halvings below. Multipliers past STREAK_GAIN_MAX
 * frames are clipped so other motion (a kick) can't smear across the screen while the spin is slow.
 */
const STREAK_TOP_BARS = 2;
const STREAK_OCTAVES = 5;
const STREAK_GAIN_MAX = 28;
/** A particle starts to stretch once its streak is this fraction of its own radius. */
const STREAK_FROM = 0.3;
/** Glow looks: sprites stamped along a streak, at most. */
const STREAK_STAMPS = 6;
/** Extra vibration on particles huddled round an attracting mouse. */
const HUDDLE_BUZZ = 0.45;
/** At full drift an evaporating particle is drawn this much smaller and fainter. */
const VAPOR_SHRINK = 0.8;
const VAPOR_FAINT = 0.85;
/** Chance per frame that a hot ritual particle sheds an ember, and the excitation it takes. */
const EMBER_RATE = 0.03;
const EMBER_HEAT = 0.65;

/** Day: ink on paper. Night: neon over a dusk sky. Ritual: blood and ember on black, with a blood moon. */
/** Day (ink on white), dark (Night: day inverted), night (Party: neon on dusk) and ritual. */
export type Look = 'day' | 'dark' | 'night' | 'ritual';

/**
 * Canvas 2D renderer. Particles are sorted into four depth bands and split again at the moon's depth,
 * so the moon is painted in the right place: hidden behind the globe on the far pass, covering it on
 * the near pass. Day draws flat ink dots; night and ritual draw additive glow sprites.
 */
export class Renderer {
  look: Look = 'day';
  /** Only particles below this index are drawn (0 hides them all until the layout is final). */
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
  /** Day: fading (evaporating) particles in a band, drawn one by one after the batch. */
  private readonly fadeX: Float32Array;
  private readonly fadeY: Float32Array;
  private readonly fadeI: Int32Array;
  /** Last screen position and smoothed screen velocity per particle (for streaks). */
  private readonly lastX: Float32Array;
  private readonly lastY: Float32Array;
  private readonly velX: Float32Array;
  private readonly velY: Float32Array;
  private streakFrames = 0;
  /** This frame's positions, between the last two simulation steps (see draw). */
  private readonly drawX: Float32Array;
  private readonly drawY: Float32Array;
  private readonly drawZ: Float32Array;
  /** How far this frame lies between the last two steps (0–1), for the moon. */
  private blend = 1;
  /** Simulation steps' worth of time this frame covers, so streaks measure motion per step. */
  private frameSteps = 1;
  /** Day: streaking particles in a band, stroked after the dots. */
  private readonly streakI: Int32Array;
  private readonly streakX: Float32Array;
  private readonly streakY: Float32Array;
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
    this.fadeX = new Float32Array(sim.count);
    this.fadeY = new Float32Array(sim.count);
    this.fadeI = new Int32Array(sim.count);
    this.lastX = new Float32Array(sim.count);
    this.lastY = new Float32Array(sim.count);
    this.velX = new Float32Array(sim.count);
    this.velY = new Float32Array(sim.count);
    this.drawX = new Float32Array(sim.count);
    this.drawY = new Float32Array(sim.count);
    this.drawZ = new Float32Array(sim.count);
    this.streakI = new Int32Array(sim.count);
    this.streakX = new Float32Array(sim.count);
    this.streakY = new Float32Array(sim.count);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dusk = null;
    this.tracers.reset();
    this.resetStreaks();
  }

  /** Per-frame effects that run on real time rather than simulation steps. */
  tick(dt: number, now: number): void {
    if (this.look === 'night') this.fireflies.tick(dt, now, this.sim, this.reducedMotion);
    this.embers.tick(dt, this.sim.viewport.radius);
    // While spinning the particles draw their own streaks, so the separate spin trails stay off.
    this.tracers.tick(dt, 0);
  }

  /**
   * Draws a frame. Returns the dot radius, which the readout uses for its density figure.
   * @param blend where this frame falls between the last two simulation steps (0 = the one before, 1 = the
   *   latest). The display rarely refreshes in step with the simulation (120 Hz screens, frame jitter), and
   *   drawing only whole steps makes everything judder: a flickering double behind each particle.
   * @param frameSteps simulation steps' worth of time since the last frame
   */
  draw(blend = 1, frameSteps = 1): number {
    const { ctx, sim, look } = this;
    const glow = look === 'night' || look === 'ritual';
    // Day and Night (dark) draw flat dots in ink on paper; Night is day inverted.
    const dark = look === 'dark';
    const ink = dark ? DARK_INK : DAY_INK;
    const paper = dark ? DARK_PAPER : DAY_PAPER;
    const bands = dark ? DARK_BANDS : DAY_BANDS;
    const ritual = look === 'ritual';
    const { count: N, moon, vaporFade: fade, huddle } = sim;
    this.blend = blend;
    this.frameSteps = Math.max(0.25, frameSteps);
    const { drawX: x, drawY: y, drawZ: z } = this;
    for (let i = 0; i < N; i++) {
      x[i] = sim.prevX[i] + (sim.x[i] - sim.prevX[i]) * blend;
      y[i] = sim.prevY[i] + (sim.y[i] - sim.prevY[i]) * blend;
      z[i] = sim.prevZ[i] + (sim.z[i] - sim.prevZ[i]) * blend;
    }
    const { radius: R, cx, cy } = sim.viewport;
    const sprites = this.sprites[ritual ? 'ritual' : 'night'];

    ctx.fillStyle = ritual ? RITUAL_BLACK : glow ? this.duskGradient() : paper;
    ctx.fillRect(0, 0, this.width, this.height);

    const re = sim.effectiveRadius();
    const camera = R * CAMERA_DISTANCE;
    const open = Math.pow(sim.state, 0.7);
    const dot = sim.dotRadius();
    // Ritual keeps only a trace of the jitter: per-frame wobble is what made it glitter.
    const jitter =
      (0.9 + sim.state * 1.5 * sim.mode.jitter) *
      (this.reducedMotion ? 0.3 : 1) *
      (ritual ? 0.25 : 1) *
      // No sound, no vibration: silence leaves the shape perfectly still.
      sim.sound;
    // Night flashes come from the fireflies; ritual heat comes from the physics (excitation).
    const flash = ritual ? sim.excite : this.fireflies.flash;
    // Ritual glow follows the State slider, not the kicked state: on a near-solid setting, kicks that
    // briefly open the shape shouldn't bring the full glow back.
    const poise = Math.pow(sim.slider, 0.7);
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
      dayInk: ink,
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
    // Streaks: how far each particle's motion is drawn out (0 when not spinning).
    const spin = Math.abs(sim.spinSpeed);
    const topSpin = angularStep(STREAK_TOP_BARS, sim.bpm || 120);
    const reach =
      spin > 1e-6 ? Math.max(0, 1 + Math.log2(Math.min(spin, topSpin) / topSpin) / STREAK_OCTAVES) : 0;
    // Frames of motion that make the rim's streak `reach` of its length at the top setting.
    const streak =
      Math.min(STREAK_GAIN_MAX, (STREAK_FRAMES * topSpin * reach) / Math.max(spin, 1e-6)) *
      (this.streakFrames > 2 && SPIN_STREAKS ? 1 : 0);
    const streakMax = Math.max(dot, re * topSpin * STREAK_FRAMES);
    this.streakFrames++;
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
          this.track(i, qx, qy);
          const f = Math.max(flash[i], comet[i] * trails);
          // Evaporating particles lose mass as they drift away: smaller and fainter the further out.
          const r =
            dot * ps * (ritual ? restSize + swell * f : 2.2 + bloom * f) * (1 - VAPOR_SHRINK * fade[i]);
          const rim = 1 - limb * (1 - Math.min(1, Math.abs(z[i]) / re));
          // Ritual rests brighter: at rest it's all deep red, which needs more weight to read on black.
          const rest = ritual ? Math.min(0.85, base * restLift) : base;
          ctx.globalAlpha =
            Math.min(1, (rest * rim + (1 - rest) * f * flashGain) * bandAlpha) * (1 - VAPOR_FAINT * fade[i]);
          const px = qx + (Math.random() - 0.5) * 2 * jitter * (1 + HUDDLE_BUZZ * huddle[i]);
          const py = qy + (Math.random() - 0.5) * 2 * jitter * (1 + HUDDLE_BUZZ * huddle[i]);
          const sprite = sprites[colourOf[i]];
          let sx = this.velX[i] * streak;
          let sy = this.velY[i] * streak;
          const sl = Math.hypot(sx, sy);
          if (sl > streakMax) {
            sx *= streakMax / sl;
            sy *= streakMax / sl;
          }
          if (sl > r * STREAK_FROM) {
            // A streak: sprites stamped back along its motion, as solid as the particle all the way.
            const stamps = Math.min(STREAK_STAMPS, Math.ceil(Math.min(sl, streakMax) / r));
            for (let k = stamps; k >= 0; k--) {
              const t = k / stamps;
              ctx.drawImage(sprite, px - sx * t - r, py - sy * t - r, r * 2, r * 2);
            }
          } else {
            ctx.drawImage(sprite, px - r, py - r, r * 2, r * 2);
          }
          if (ritual && f > EMBER_HEAT && Math.random() < emberRate * f) this.embers.spawn(px, py, f, R);
        }
      } else {
        ctx.fillStyle = bands[b % BANDS];
        ctx.beginPath();
        let fading = 0;
        let streaking = 0;
        for (let n = 0; n < size; n++) {
          const i = idx[n];
          const ps = camera / (camera - z[i]);
          const qx = cx + (x[i] - cx) * ps;
          const qy = cy + (y[i] - cy) * ps;
          this.tracers.record(i, qx, qy);
          this.track(i, qx, qy);
          const px = qx + (Math.random() - 0.5) * 2 * jitter * (1 + HUDDLE_BUZZ * huddle[i]);
          const py = qy + (Math.random() - 0.5) * 2 * jitter * (1 + HUDDLE_BUZZ * huddle[i]);
          if (
            streak &&
            fade[i] <= 0.02 &&
            Math.hypot(this.velX[i], this.velY[i]) * streak > dot * STREAK_FROM
          ) {
            // Stroked as a streak below.
            this.streakX[streaking] = px;
            this.streakY[streaking] = py;
            this.streakI[streaking++] = i;
            continue;
          }
          if (fade[i] > 0.02) {
            // Drawn on their own below, so each can fade.
            this.fadeX[fading] = px;
            this.fadeY[fading] = py;
            this.fadeI[fading++] = i;
            continue;
          }
          const r = dot * ps;
          ctx.moveTo(px + r, py);
          ctx.arc(px, py, r, 0, Math.PI * 2);
        }
        ctx.fill();
        if (streaking) {
          // Each streaking particle as a round-ended line back along its motion: the particle is its trail.
          ctx.strokeStyle = bands[b % BANDS];
          ctx.lineWidth = dot * 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let n = 0; n < streaking; n++) {
            const i = this.streakI[n];
            let sx = this.velX[i] * streak;
            let sy = this.velY[i] * streak;
            const sl = Math.hypot(sx, sy);
            if (sl > streakMax) {
              sx *= streakMax / sl;
              sy *= streakMax / sl;
            }
            ctx.moveTo(this.streakX[n] - sx, this.streakY[n] - sy);
            ctx.lineTo(this.streakX[n], this.streakY[n]);
          }
          ctx.stroke();
        }
        for (let n = 0; n < fading; n++) {
          const i = this.fadeI[n];
          const r = dot * (camera / (camera - z[i])) * (1 - VAPOR_SHRINK * fade[i]);
          ctx.globalAlpha = 1 - VAPOR_FAINT * fade[i];
          ctx.beginPath();
          ctx.arc(this.fadeX[n], this.fadeY[n], r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
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

  /** Records particle i's screen position and updates its smoothed screen velocity (px per simulation step). */
  private track(i: number, qx: number, qy: number): void {
    if (this.streakFrames > 1) {
      const per = 1 / this.frameSteps;
      this.velX[i] += ((qx - this.lastX[i]) * per - this.velX[i]) * 0.4;
      this.velY[i] += ((qy - this.lastY[i]) * per - this.velY[i]) * 0.4;
    }
    this.lastX[i] = qx;
    this.lastY[i] = qy;
  }

  /** Positions jumped (resize, opening): forget motion so nothing streaks across the jump. */
  resetStreaks(): void {
    this.streakFrames = 0;
    this.velX.fill(0);
    this.velY.fill(0);
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
    const { moon } = this.sim;
    const z = this.drawZ;
    const count = Math.min(this.sim.count, this.limit);
    const cut = moon.visible ? moon.z - moon.vz * (1 - this.blend) : Infinity;
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
    // Between steps, like the particles.
    const back = 1 - this.blend;
    const ps = camera / (camera - (moon.z - moon.vz * back));
    const mx = cx + (moon.x - moon.vx * back - cx) * ps;
    const my = cy + (moon.y - moon.vy * back - cy) * ps;
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
    ctx.fillStyle = this.look === 'night' ? '#ffffff' : this.look === 'dark' ? DARK_INK : DAY_INK;
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
