// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { lerp } from '../lib/math';
import { angularStep } from '../sim/divisions';
import { CAMERA_DISTANCE, type Simulation } from '../sim/simulation';
import { Embers } from './embers';
import { Fireflies } from './fireflies';
import { RefractPainter } from './refract';
import {
  assignColours,
  assignDiscColours,
  createCrispSprites,
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
  NEON_RAMP,
  HEAT,
  NIGHT_BANDS,
  RITUAL_INK,
  RITUAL_RED,
  SMOKE,
  WIRE_BG,
  wireShades,
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
/**
 * Gas and liquid: each particle drawn out a little along its own motion (its last MOTION_STREAK_FRAMES
 * of it), at most this many of its radii beyond the dot: a little for big dots, more as they shrink
 * toward Loose. It starts once the stretch is MOTION_STREAK_FROM of the radius.
 */
const MOTION_STREAK_FRAMES = 8;
const MOTION_STRETCH_BIG = 0.6;
const MOTION_STRETCH_SMALL = 2.1;
const MOTION_STREAK_FROM = 0.12;
/** Glow looks: sprites stamped along a streak, at most. */
const STREAK_STAMPS = 6;
/** Extra vibration on particles huddled round an attracting mouse. */
const HUDDLE_BUZZ = 0.45;
/** At full drift an evaporating particle is drawn this much smaller and fainter. */
const VAPOR_SHRINK = 0.8;
const VAPOR_FAINT = 0.85;
/** Ritual: the step of the heat ramp every particle rests on (blood red). */
const RITUAL_REST = 1;
/** Party and Ritual: the State (scaled by the mode's sizeGain) by which the resting glow is fully back. */
const GLOW_FULL = 0.5;
/** Wire: alpha by depth (far, middle, near), and the stretch (in layout spacings) past which wire tears. */
const WIRE_BANDS = [0.28, 0.6, 1] as const;
const WIRE_TEAR = 6;
/**
 * Wire's colour climbs its ramp (violet → pink → cyan → white) with energy: how far the music's
 * loudness takes the whole wire, and how far a stretch's own stir (a kick, the pointer) takes it on top.
 * The ramp is drawn in this many shades; the loudness eases in and out over WIRE_ENERGY_TAU seconds.
 */
const WIRE_LOUD_REACH = 0.5;
const WIRE_STIR_REACH = 0.75;
const WIRE_SHADES = 12;
const WIRE_ENERGY_TAU = 0.4;
const WIRE_COLOURS = wireShades(WIRE_SHADES);
/** How far a strut has come away before its links to the hubs go. */
const STRUT_LETS_GO = 0.15;
/** Chance per frame that a hot ritual particle sheds an ember, and the excitation it takes. */
const EMBER_RATE = 0.03;
const EMBER_HEAT = 0.65;

/** Day: ink on paper. Night: neon over a dusk sky. Ritual: black on blood red, with a black moon. */
/** Day (ink on white), dark (Night: day inverted), night (Party: neon on dusk), ritual, wire (synthwave) and refract (VHS). */
export type Look = 'day' | 'dark' | 'night' | 'ritual' | 'wire' | 'refract';

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
  readonly refract = new RefractPainter();
  /** Refract: how loud the music is (0–1), and when the last frame was drawn. */
  loud = 0;
  /** Wire: the loudness, eased, that sets the whole wire's place on its ramp. */
  private wireEnergy = 0;
  private lastFrame = 0;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: Record<'night' | 'ritual', HTMLCanvasElement[]>;
  /** The same colours as crisp dots (no glow): what Party and Ritual show at Tight. */
  private readonly crisp: Record<'night' | 'ritual', HTMLCanvasElement[]>;
  private readonly strokes: Record<'night' | 'ritual', string[]>;
  /**
   * Party colour per particle (into NEON_RAMP): the globe's and the disc's, and the point in the morph
   * where each particle changes from one to the other (so the change dissolves through it); `colourOf`
   * is this frame's, remade when the morph moves.
   */
  private readonly globeColour: Uint8Array;
  private readonly discColour: Uint8Array;
  private readonly colourSwitch: Float32Array;
  private readonly colourOf: Uint8Array;
  private colourAt = -1;
  /** Ritual: heat-ramp step per particle this frame, and a fixed per-particle tone so rest isn't flat. */
  private readonly heatOf: Uint8Array;
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
  /** Wire: each particle's screen position and perspective scale this frame. */
  private readonly wireX: Float32Array;
  private readonly wireY: Float32Array;
  private readonly wirePs: Float32Array;
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
    this.sprites = { night: createGlowSprites(NEON_RAMP), ritual: createHeatSprites() };
    this.crisp = {
      night: createCrispSprites(NEON_RAMP),
      ritual: createCrispSprites(HEAT.map(() => RITUAL_INK)),
    };
    this.strokes = { night: NEON_RAMP.map(css), ritual: SMOKE.map(() => css(RITUAL_INK)) };
    this.globeColour = assignColours(sim.sphereX, sim.sphereY, sim.sphereZ);
    this.discColour = assignDiscColours(sim.discX, sim.discY);
    this.colourSwitch = Float32Array.from({ length: sim.count }, () => 0.15 + 0.7 * Math.random());
    this.colourOf = new Uint8Array(sim.count);
    this.heatOf = new Uint8Array(sim.count);
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
    this.wireX = new Float32Array(sim.count);
    this.wireY = new Float32Array(sim.count);
    this.wirePs = new Float32Array(sim.count);
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
    this.refract.resize(this.canvas.width, this.canvas.height, dpr);
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
    if (this.look === 'wire') return this.drawWire(blend);
    if (this.look === 'refract') return this.drawRefract(blend);
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
    this.throughCamera();
    const { radius: R, cx, cy } = sim.viewport;
    const sprites = this.sprites[ritual ? 'ritual' : 'night'];

    ctx.fillStyle = ritual ? RITUAL_RED : glow ? this.duskGradient() : paper;
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
    if (sim.globe !== this.colourAt) {
      this.colourAt = sim.globe;
      for (let i = 0; i < sim.count; i++)
        this.colourOf[i] = sim.globe < this.colourSwitch[i] ? this.discColour[i] : this.globeColour[i];
    }

    this.tracers.draw(ctx, {
      night: glow,
      // Ritual's black smoke lays over the red; added, black would vanish.
      additive: glow && !ritual,
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
    const flashGain = lerp(0.55, 1, open);
    // Party and Ritual: crisp dots at full Tight, the resting glow fading in toward Loose (full by GLOW_FULL).
    const loosening = Math.min(1, (sim.slider * sim.mode.sizeGain) / GLOW_FULL);
    const glowing = loosening * loosening * (3 - 2 * loosening);
    // (Ritual has no glow at all: its heat shows as colour, and only the embers glow.)
    const crispness = ritual ? 1 : 1 - glowing;
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
    const settled = this.streakFrames > 2 ? 1 : 0;
    const spinStreak =
      Math.min(STREAK_GAIN_MAX, (STREAK_FRAMES * topSpin * reach) / Math.max(spin, 1e-6)) *
      (SPIN_STREAKS ? settled : 0);
    // Gas and liquid: a little elongation along each particle's own motion, more the smaller the dots.
    const fluid = Math.max(sim.mode.vapor, sim.mode.ripple) * settled;
    const small = Math.min(1, Math.max(1.15, R / 170) / dot);
    const streak = Math.max(spinStreak, MOTION_STREAK_FRAMES * fluid);
    const streakMax = spinStreak
      ? Math.max(dot, re * topSpin * STREAK_FRAMES)
      : dot * lerp(MOTION_STRETCH_BIG, MOTION_STRETCH_SMALL, small * small);
    const streakFrom = spinStreak ? STREAK_FROM : MOTION_STREAK_FROM;
    this.streakFrames++;
    for (let b = 0; b < BANDS * 2; b++) {
      if (b === BANDS && moon.visible) this.drawMoon(camera);
      const idx = this.bands[b];
      const size = this.bandSize[b];
      if (size === 0) continue;
      if (glow) {
        const bandAlpha = NIGHT_BANDS[b % BANDS];
        const crispSprites = this.crisp[ritual ? 'ritual' : 'night'];
        for (let n = 0; n < size; n++) {
          const i = idx[n];
          const ps = camera / (camera - z[i]);
          const qx = cx + (x[i] - cx) * ps;
          const qy = cy + (y[i] - cy) * ps;
          this.tracers.record(i, qx, qy);
          this.track(i, qx, qy);
          const f = Math.max(flash[i], comet[i] * trails);
          // Evaporating particles lose mass as they drift away: smaller and fainter the further out.
          const r = dot * ps * (2.2 + bloom * f) * (1 - VAPOR_SHRINK * fade[i]);
          const rim = 1 - limb * (1 - Math.min(1, Math.abs(z[i]) / re));
          const rest = base;
          const faint = 1 - VAPOR_FAINT * fade[i];
          const px = qx + (Math.random() - 0.5) * 2 * jitter * (1 + HUDDLE_BUZZ * huddle[i]);
          const py = qy + (Math.random() - 0.5) * 2 * jitter * (1 + HUDDLE_BUZZ * huddle[i]);
          if (crispness > 0) {
            // Toward Tight: a crisp, solid dot at the particle's true size, laid over rather than added up.
            const rc = dot * ps * (1 - VAPOR_SHRINK * fade[i]);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = crispness * bandAlpha * faint;
            ctx.drawImage(crispSprites[colourOf[i]], px - rc, py - rc, rc * 2, rc * 2);
            ctx.globalCompositeOperation = 'lighter';
          }
          if (ritual) {
            if (f > EMBER_HEAT && Math.random() < emberRate * f) this.embers.spawn(px, py, f, R);
            continue;
          }
          // The resting glow comes in toward Loose; a flash or a kick's heat glows at any State.
          ctx.globalAlpha =
            Math.min(1, (rest * rim * glowing + (1 - rest) * f * flashGain) * bandAlpha) * faint;
          const sprite = sprites[colourOf[i]];
          let sx = this.velX[i] * streak;
          let sy = this.velY[i] * streak;
          const sl = Math.hypot(sx, sy);
          if (sl > streakMax) {
            sx *= streakMax / sl;
            sy *= streakMax / sl;
          }
          if (sl > r * streakFrom) {
            // A streak: sprites stamped back along its motion, as solid as the particle all the way.
            const stamps = Math.min(STREAK_STAMPS, Math.ceil(Math.min(sl, streakMax) / r));
            for (let k = stamps; k >= 0; k--) {
              const t = k / stamps;
              ctx.drawImage(sprite, px - sx * t - r, py - sy * t - r, r * 2, r * 2);
            }
          } else {
            ctx.drawImage(sprite, px - r, py - r, r * 2, r * 2);
          }
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
            Math.hypot(this.velX[i], this.velY[i]) * streak > dot * streakFrom
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
   * Heat-ramp step from excitation: every particle rests on blood red (RITUAL_REST) and climbs from there.
   * How hot it can get follows the State slider: a packed solid tops out at ember orange, an open
   * cloud at white.
   */
  private updateHeat(poise: number): void {
    const { excite, count } = this.sim;
    const top = HEAT.length - 1;
    // Every particle rests in the same blood red; stirred up, it climbs the ramp step by step.
    const reach = (top - RITUAL_REST) * lerp(0.55, 1, poise);
    for (let i = 0; i < count; i++) {
      this.heatOf[i] = Math.min(top, RITUAL_REST + ((excite[i] * reach) | 0));
    }
  }

  /**
   * This frame's positions as the camera sees them: turned about the shape's centre by the camera's
   * orbit (click and drag). Nothing to do while it looks straight on.
   */
  private throughCamera(): void {
    const view = this.sim.camera;
    if (view.straight) return;
    const m = view.matrix;
    const { cx, cy } = this.sim.viewport;
    const { drawX: x, drawY: y, drawZ: z } = this;
    for (let i = 0; i < this.sim.count; i++) {
      const ox = x[i] - cx;
      const oy = y[i] - cy;
      const oz = z[i];
      x[i] = cx + m[0] * ox + m[1] * oy + m[2] * oz;
      y[i] = cy + m[3] * ox + m[4] * oy + m[5] * oz;
      z[i] = m[6] * ox + m[7] * oy + m[8] * oz;
    }
  }

  /** The moon's centre this frame (between steps, like the particles), as the camera sees it. */
  moonSeen(): [number, number, number] {
    const { moon, camera: view } = this.sim;
    const { cx, cy } = this.sim.viewport;
    const back = 1 - this.blend;
    const ox = moon.x - moon.vx * back - cx;
    const oy = moon.y - moon.vy * back - cy;
    const oz = moon.z - moon.vz * back;
    if (view.straight) return [cx + ox, cy + oy, oz];
    const m = view.matrix;
    return [
      cx + m[0] * ox + m[1] * oy + m[2] * oz,
      cy + m[3] * ox + m[4] * oy + m[5] * oz,
      m[6] * ox + m[7] * oy + m[8] * oz,
    ];
  }

  /** Depth bands by z (far side lighter), split at the moon's depth for correct occlusion. */
  private sortIntoBands(re: number): void {
    const { moon } = this.sim;
    const z = this.drawZ;
    const count = Math.min(this.sim.count, this.limit);
    const cut = moon.visible ? this.moonSeen()[2] : Infinity;
    this.bandSize.fill(0);
    for (let i = 0; i < count; i++) {
      const t = z[i] / re;
      const depth = t > -0.25 ? 3 : t > -0.55 ? 2 : t > -0.8 ? 1 : 0;
      const b = depth + (z[i] > cut ? BANDS : 0);
      this.bands[b][this.bandSize[b]++] = i;
    }
  }

  /** Refract (VHS): posterized light, torn now and then with the music (see RefractPainter). */
  private drawRefract(blend: number): number {
    const { sim } = this;
    const { drawX: x, drawY: y, drawZ: z } = this;
    for (let i = 0; i < sim.count; i++) {
      x[i] = sim.prevX[i] + (sim.x[i] - sim.prevX[i]) * blend;
      y[i] = sim.prevY[i] + (sim.y[i] - sim.prevY[i]) * blend;
      z[i] = sim.prevZ[i] + (sim.z[i] - sim.prevZ[i]) * blend;
    }
    this.throughCamera();
    const now = performance.now() / 1000;
    const dt = this.lastFrame ? Math.min(0.1, now - this.lastFrame) : 1 / 60;
    this.lastFrame = now;
    this.refract.paint(
      this.ctx,
      sim,
      x,
      y,
      z,
      Math.min(sim.count, this.limit),
      dt,
      this.loud,
      this.moonSeen(),
    );
    return sim.dotRadius();
  }

  /**
   * Wire (synthwave): neon lines between neighbours along the struts of the geodesic globe,
   * glowing over the dark, violet at rest and up through pink and cyan to white with energy. The lines run between
   * the particles themselves, so the wire stretches and wobbles with the physics, and tears where two
   * neighbours are flung far apart. The disc has its own flat frame (rings of hubs, triangulated), and
   * the two crossfade through the morph. While the wire itself comes and goes, the lines fade to neon dots.
   */
  private drawWire(blend: number): number {
    const { ctx, sim } = this;
    const N = Math.min(sim.count, this.limit);
    this.blend = blend;
    const { drawX: x, drawY: y, drawZ: z } = this;
    for (let i = 0; i < sim.count; i++) {
      x[i] = sim.prevX[i] + (sim.x[i] - sim.prevX[i]) * blend;
      y[i] = sim.prevY[i] + (sim.y[i] - sim.prevY[i]) * blend;
      z[i] = sim.prevZ[i] + (sim.z[i] - sim.prevZ[i]) * blend;
    }
    this.throughCamera();
    const { radius: R, cx, cy } = sim.viewport;
    const re = sim.effectiveRadius();
    const camera = R * CAMERA_DISTANCE;
    const dot = sim.dotRadius();
    ctx.fillStyle = WIRE_BG;
    ctx.fillRect(0, 0, this.width, this.height);
    // A little of the tremble, no more: the wire should hum, not fizz.
    const jitter =
      0.3 * (0.9 + sim.state * 1.5 * sim.mode.jitter) * (this.reducedMotion ? 0.3 : 1) * sim.sound;
    const { wireX: qx, wireY: qy, wirePs: ps } = this;
    for (let i = 0; i < N; i++) {
      ps[i] = camera / (camera - z[i]);
      qx[i] = cx + (x[i] - cx) * ps[i] + (Math.random() - 0.5) * 2 * jitter;
      qy[i] = cy + (y[i] - cy) * ps[i] + (Math.random() - 0.5) * 2 * jitter;
    }

    // Where each particle sits on the ramp: the music's energy for all, its own stir on top.
    const now = performance.now() / 1000;
    const dt = this.lastFrame ? Math.min(0.1, now - this.lastFrame) : 1 / 60;
    this.lastFrame = now;
    this.wireEnergy += (this.loud - this.wireEnergy) * (1 - Math.exp(-dt / WIRE_ENERGY_TAU));
    // (The wind-up before a kick drops it back toward violet.)
    const base = WIRE_LOUD_REACH * this.wireEnergy * (1 - sim.dropLevel);
    const shade = (e: number): number =>
      Math.min(WIRE_SHADES - 1, Math.round((base + WIRE_STIR_REACH * e) * (WIRE_SHADES - 1)));
    // The globe's frame and the disc's, crossfading through the morph between them.
    const frames = [
      { layout: sim.wireLines, free: sim.wireStruts?.free, show: sim.wire * sim.globe, lift: 0 },
      // (The disc sits in the middle depth; it's lit as the globe's near face, which it faces you as.)
      {
        layout: sim.discWireLines,
        free: sim.discWireStruts?.free,
        show: sim.wire * (1 - sim.globe),
        lift: 0.35,
      },
    ];
    const show = sim.wireLines ? sim.wire : 0;
    // Struts as bars, not hairlines.
    const width = Math.max(1.6, R / 150);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const moonBehind = sim.moon.visible && this.moonSeen()[2] < 0;
    if (moonBehind) this.drawMoon(camera);
    for (const { layout, free, show: frameShow, lift } of frames) {
      if (!layout || frameShow <= 0.01) continue;
      const { segA, segB, segStrut, segHub, spacing } = layout;
      // Past this length (in shape radii, 3D) a stretch of wire has torn: two neighbours flung apart.
      const tear = spacing * re * WIRE_TEAR;
      // By depth band, then shade.
      const paths = Array.from({ length: 3 * WIRE_SHADES }, () => new Path2D());
      const used = new Uint8Array(3 * WIRE_SHADES);
      for (let k = 0; k < segA.length; k++) {
        const i = segA[k];
        const j = segB[k];
        if (i >= N || j >= N) continue;
        // A strut that has broken loose lets go of its hubs: a bar floating free.
        if (segHub[k] && free && free[segStrut[k]] > STRUT_LETS_GO) continue;
        if (Math.hypot(x[j] - x[i], y[j] - y[i], z[j] - z[i]) > tear) continue;
        const depth = (z[i] + z[j]) / (2 * re) + lift;
        const p =
          (depth < -0.3 ? 0 : depth < 0.3 ? 1 : 2) * WIRE_SHADES +
          shade(Math.max(sim.excite[i], sim.excite[j]));
        paths[p].moveTo(qx[i], qy[i]);
        paths[p].lineTo(qx[j], qy[j]);
        used[p] = 1;
      }
      for (let b = 0; b < 3; b++) {
        const a = WIRE_BANDS[b] * frameShow;
        for (let s = 0; s < WIRE_SHADES; s++) {
          const p = b * WIRE_SHADES + s;
          if (!used[p]) continue;
          ctx.strokeStyle = WIRE_COLOURS[s];
          // Glow: a wide, faint stroke under the line, adding up where wire bunches…
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a * 0.16;
          ctx.lineWidth = width * 5;
          ctx.stroke(paths[p]);
          // …then the line itself, laid over rather than added, so a busy wire keeps its colour.
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = a;
          ctx.lineWidth = width;
          ctx.stroke(paths[p]);
        }
      }
    }
    if (show < 0.99) {
      // While the wire comes and goes: neon dots where it would be, at their true size, so a Tight disc
      // packs into a solid circle. (One path a shade, each filled once: overlaps don't add up into bright spots.)
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1 - show;
      const dots = Array.from({ length: WIRE_SHADES }, () => new Path2D());
      for (let i = 0; i < N; i++) {
        const r = Math.max(0.8, dot * ps[i]);
        const path = dots[shade(sim.excite[i])];
        path.moveTo(qx[i] + r, qy[i]);
        path.arc(qx[i], qy[i], r, 0, Math.PI * 2);
      }
      for (let s = 0; s < WIRE_SHADES; s++) {
        ctx.fillStyle = WIRE_COLOURS[s];
        ctx.fill(dots[s]);
      }
    }
    ctx.restore();
    if (sim.moon.visible && !moonBehind) this.drawMoon(camera);
    return dot;
  }

  /**
   * Day: a black disc. Night: inverted, solid white with a steady soft glow. Ritual: an eclipse,
   * a black disc in a blood-red corona. Wire: the dark with a neon rim. Always fully opaque.
   */
  private drawMoon(camera: number): void {
    const { ctx } = this;
    const { moon } = this.sim;
    const { cx, cy } = this.sim.viewport;
    const [vx, vy, vz] = this.moonSeen();
    const ps = camera / (camera - vz);
    const mx = cx + (vx - cx) * ps;
    const my = cy + (vy - cy) * ps;
    const mr = moon.radius * ps;
    ctx.save();
    ctx.globalAlpha = 1;
    if (this.look === 'ritual') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = css(RITUAL_INK);
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (this.look === 'wire') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = WIRE_BG;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = WIRE_COLOURS[0];
      ctx.lineWidth = Math.max(1, mr / 14);
      ctx.stroke();
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = Math.max(4, mr / 3);
      ctx.stroke();
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
