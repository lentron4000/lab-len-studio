// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { gaussian, lerp } from '../lib/math';
import { angularStep } from './divisions';
import type { FormationId } from './formations';
import { Moon } from './moon';
import { PHYSICS_MODES, SOLID, type PhysicsMode } from './physics-modes';
import { Pointer } from './pointer';
import { GLOBE_AXIS, rotation, type Mat3 } from './rotation';
import { Summoning } from './summoning';

/** Where the shape sits on screen, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
  /** Shape radius at the solid end. */
  radius: number;
  cx: number;
  cy: number;
}

/** Physics constants are tuned at this shape radius and scaled with the real one. */
const REFERENCE_RADIUS = 230;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Speed (px/step at the reference radius) above the resting motion where particles start to glow… */
const EXCITE_CALM = 0.6;
/** …and the speed above that where they're fully lit. */
const EXCITE_FULL = 6;
/** Per-step fade: about a second to go dark again. */
const EXCITE_DECAY = Math.exp(-1 / 60 / 0.35);
/**
 * Repel's beam: drive along it and pull toward its line (at full Force), as a share of home-spring
 * stiffness × shape radius, and the moon's radial push left over (a share of its magnet).
 */
const BEAM_PUSH = 0.9;
const BEAM_FOCUS = 0.5;
/** Top of the moon's Force slider. */
const MOON_FORCE_MAX = 2;
const BEAM_RESIDUAL = 0.25;
/** Seconds for evaporated particles to lose their energy (loose, and fully tight). */
const VAPOR_LIFE = 1.5;
const VAPOR_LIFE_TIGHT = 0.6;
/**
 * Gas and water pointer: a solid body (radius in shape radii) the fluid parts round. FLOW_GRIP is how
 * firmly nearby fluid follows the flow round it; behind, WAKE_DRAG pulls the wake along after it and
 * eddies sway it sideways (EDDY_SWAY per px/step of pointer speed, EDDY_SPACING body radii apart,
 * travelling at EDDY_RATE radians per step). Evaporated gas is flung sideways VAPOR_FLING × speed.
 */
const BODY_RADIUS = 0.08;
/** Attract and repel: the pointer's pull or push on a fully tight shape, relative to loose. */
const POLE_TIGHT = 2.5;
/** Attract: particles near the mouse (within about HUDDLE_REACH shape radii) push each other HUDDLE_PACK less. */
const HUDDLE_REACH = 0.25;
const HUDDLE_PACK = 0.33;
/** Pointer energy (speed / POINTER_VAPOR_SPEED) a fully tight shape needs before it evaporates; none when loose. */
const BREAK_ENERGY = 1.2;
/** Pointer speed (px/step) at which fully tight fluid gives way completely (4 when loose). */
const GIVE_SPEED_TIGHT = 24;
/** Pointer speed (px/step) at which the body reaches full size. */
const BODY_FULL_SPEED = 12;
/** Share of the hold home the fluid lets go of where the body passes (near it and in its wake). */
const FLUID_GIVE = 0.9;
const FLOW_GRIP = 0.6;
const WAKE_DRAG = 0.3;
const EDDY_SWAY = 0.08;
const EDDY_SPACING = 2.2;
const EDDY_RATE = 0.12;
const VAPOR_FLING = 0.35;
/** Returning vapour: pull rises by up to RETURN_RAMP× as it closes in, over RETURN_SCALE shape radii. */
const RETURN_RAMP = 12;
const RETURN_SCALE = 0.1;
/** Chance per step that gas under a fast-moving pointer evaporates, and the pointer speed (px/step) for full effect. */
const POINTER_VAPOR = 0.15;
const POINTER_VAPOR_SPEED = 18;
/** Pull back on vapour per shape radius it has drifted past VAPOR_FADE_AT (px/step² at the reference radius). */
const VAPOR_LEASH = 2;
/** Most of the gas one hit can evaporate: the rest stays dense enough to come back. */
const VAPOR_MAX_SHARE = 0.4;
/** Vapour above this drifts outward; below it, it's pulled home (at Loose; Tight turns sooner). */
const VAPOR_HOLD = 0.35;
/** Pull home while condensing (px/step² at the reference radius, before the closeness boost). */
const VAPOR_RETURN = 0.02;
/** Drift from home, in shape radii, at which an evaporating particle has fully faded. */
const VAPOR_FADE_AT = 0.45;
/** Rest between hits: at 100 bpm (REST_BEAT s) evaporation is as tuned; longer rests raise it, to REST_MAX. */
const REST_BEAT = 0.6;
const REST_MIN = 0.5;
const REST_MAX = 3;
/** Depth velocity kept per step while the shape is flat. */
const FLAT_Z_DAMPING = 0.93;
/** Water: seconds for a kick's ripple to cross the shape, at Tight and at Loose; and rings alive at once. */
const RIPPLE_SECONDS: readonly [number, number] = [0.45, 0.8];
const MAX_RIPPLES = 6;
/** Push at the ring's leading edge (and pull at its trailing edge), relative to a one-way push of the same size. */
const RIPPLE_SWING = 3;
/** How far a ring lifts what it passes toward the viewer (a bob), relative to its push. */
const RIPPLE_BOB = 6;
/** How far a full kick's ripple lifts the particles it passes, in shape radii. */
const RIPPLE_LIFT = 0.17;
/** Ring width (shape radii), and how much motion it damps as it passes (0–1, per step at its centre). */
const RIPPLE_WIDTH = 0.35;
const RIPPLE_SETTLE = 0.25;
/** Pull behind the ring relative to the push in front, balanced so the water doesn't drift outward. */
const RIPPLE_PULL = 1.3;
/** A kick's attack: per-frame catch-up of the opening (about four frames to land), and frames its push is spread over. */
const KICK_ATTACK = 0.45;
const KICK_STEPS = 4;
/** Share of the home pull a full blast lets go. */
const BLAST_RELEASE = 0.85;
/** Seconds after a hit before the next can blast fully. */
const BLAST_RECHARGE = 2.5;
/** How much harder than a full kick the shockwave pushes at the top of a blast. */
const BLAST_PUSH = 7.5;
/** Disc swirl: spread of particles' own orbit rates (±), and how firmly loose particles follow the swirl. */
const SWIRL_SPREAD = 0.35;
const SWIRL_GRIP = 0.08;
/** Seconds to morph between disc and globe. */
const MORPH_SECONDS = 1.6;
/**
 * Deep pumping (Depth past PUMP_FROM, full at DEPTH_MAX): a kick hollows the shape, pushing homes out
 * by up to PUMP_HOLLOW radii (most for the middle), stiffens the hold PUMP_SPRING×, and lets go at
 * PUMP_DECAY per step so it snaps back.
 */
const PUMP_FROM = 0.65;
const PUMP_HOLLOW = 0.55;
const PUMP_SPRING = 2;
const PUMP_DECAY = 0.86;
/** Share of the per-hit evaporation a full pump holds back, so most of the gas comes back on the beat. */
const PUMP_VAPOR_CUT = 0.7;
/** Strongest pad hit: three times a full kick. */
export const BLAST_MAX = 3;
/** Hit × Depth at which the vapor blast is complete: the hardest pad at the default Depth. */
const DRIVE_MAX = 2;
/** Top of the Depth slider: an ordinary kick there reaches DRIVE_MAX too. */
export const DEPTH_MAX = DRIVE_MAX;
/** Keys struck harder than this (0–1) burst apart when released. */
const RELEASE_BURST_FROM = 0.55;
/** Formations are drawn at this fraction of the shape radius. */
const FORMATION_SCALE = 0.92;
/** The camera sits this many shape radii in front of the centre (perspective strength). */
export const CAMERA_DISTANCE = 4;

/**
 * Particle physics: a disc or globe of particles that can be opened from a packed solid into a
 * cloud, with four behaviours (gas, water, two magnetic poles), pointer gravity, beat shockwaves,
 * a spinning globe and an orbiting moon. Advances in fixed 60 Hz steps.
 *
 * Positions are screen pixels with z toward the viewer. Particle interactions use a uniform grid
 * hashed on x/y with true 3D distances, which keeps the pair search near O(n).
 */
export class Simulation {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Home position on the unit sphere; also used to lay colour out in regions. */
  readonly sphereX: Float32Array;
  readonly sphereY: Float32Array;
  readonly sphereZ: Float32Array;
  /**
   * 0–1 per particle: how stirred up it is. Jumps when a particle moves faster than the mode's
   * resting motion (pointer, moon, shockwave) and fades back over about a second, like
   * bioluminescence in water. The ritual look colours by it.
   */
  readonly excite: Float32Array;
  /**
   * 0–1 per particle: evaporated by a kick (gas). It shrinks and fades, its home spring mostly lets go
   * and it drifts away, then condenses back over a couple of seconds.
   */
  readonly vapor: Float32Array;
  /** Disc swirl: each particle's turn so far about the centre, and its own rate (×spin). */
  private readonly discTurn: Float32Array;
  private readonly swirlRate: Float32Array;
  /**
   * 0–1 per particle: how close it is to an attracting mouse. Those particles pack tighter and buzz
   * harder (the moon's pile is left as it is).
   */
  readonly huddle: Float32Array;
  /** 0–1 per particle: how far an evaporating particle has drifted from home. It shrinks and fades by this. */
  readonly vaporFade: Float32Array;
  readonly pointer = new Pointer();
  /** Formations summoned from the keys. */
  readonly summoning: Summoning;
  readonly moon = new Moon();

  mode: PhysicsMode = PHYSICS_MODES.gas;
  /** State slider, 0 = solid, 1 = cloud. */
  stateTarget = 0.5;
  /**
   * Depth slider: multiplies every hit. Up to 1 it sets how far a full kick pushes the state toward
   * cloud; past 1 (to DEPTH_MAX) even an ordinary kick blasts the shape into vapor.
   */
  depth = 0.65;
  /** Bars per revolution of the globe; 0 = stopped. */
  spinBars = 0;
  bpm = 100;
  /** 0 = disc, 1 = globe; the shape morphs toward it. */
  shapeTarget = 0;

  /** Effective state: the slider pushed toward cloud by the current pulse. */
  state = 0.5;
  /** Current disc → globe blend. */
  globe = 0;
  /** Linear progress of the disc ↔ globe morph (0–1); `globe` is it eased. */
  private morph = 0;
  /** Spin speed in radians per step. */
  spinSpeed = 0;

  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly discX: Float32Array;
  private readonly discY: Float32Array;
  private readonly scatterX: Float32Array;
  private readonly scatterY: Float32Array;
  private readonly scatterZ: Float32Array;
  private readonly next: Int32Array;
  /** Scratch: particle offsets from the centre in shape radii, for matching particles to a formation. */
  private readonly relX: Float32Array;
  private readonly relY: Float32Array;
  private cellHead = new Int32Array(1);
  private pulse = 0;
  /** 0–1: how far past a full kick the last hit went. Opens the shape fully and vaporizes it. */
  private blast = 0;
  /** Water: kicks travelling outward as rings (radius in px, impulse, glow). */
  private ripples: { r: number; amp: number; glow: number; lift: number }[] = [];
  private pendingShock = 0;
  /** How open the kick has the shape right now; it rises over a few frames (attack) rather than at once. */
  private open = 0;
  /** The current kick's push, spread over KICK_STEPS frames so it lands with body rather than as a snap. */
  private kickLeft = 0;
  private kickStrength = 0;
  /** Steps run, and the step of the last hit: the gap between hits sets how readily gas evaporates. */
  private steps = 0;
  private lastHitStep = -Infinity;
  /** Rest before the last hit, relative to a 100 bpm beat (0.5–3): longer rests, more vapour. */
  private rest = 1;
  private spinAngle = 0;
  private view: Viewport = { width: 1, height: 1, radius: 100, cx: 0, cy: 0 };

  constructor(count: number) {
    this.count = count;
    const f = (): Float32Array => new Float32Array(count);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.discX = f();
    this.discY = f();
    this.sphereX = f();
    this.sphereY = f();
    this.sphereZ = f();
    this.scatterX = f();
    this.scatterY = f();
    this.scatterZ = f();
    this.excite = f();
    this.vapor = f();
    this.discTurn = f();
    this.swirlRate = f();
    this.huddle = f();
    this.vaporFade = f();
    this.summoning = new Summoning(count);
    this.relX = f();
    this.relY = f();
    this.next = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      // Phyllotaxis disc: even density with no rings.
      const r = Math.sqrt((i + 0.5) / count);
      const a = i * GOLDEN_ANGLE;
      this.discX[i] = r * Math.cos(a);
      this.discY[i] = r * Math.sin(a);
      // Fibonacci sphere.
      const sy = 1 - (2 * (i + 0.5)) / count;
      const sr = Math.sqrt(1 - sy * sy);
      this.sphereX[i] = Math.cos(a) * sr;
      this.sphereY[i] = sy;
      this.sphereZ[i] = Math.sin(a) * sr;
      // Inner particles orbit faster than outer ones, and each a little differently.
      this.swirlRate[i] = lerp(1.6, 0.6, r) * (1 + SWIRL_SPREAD * (Math.random() * 2 - 1));
      // Gaussian scatter that loosens the shape toward the cloud end.
      this.scatterX[i] = gaussian();
      this.scatterY[i] = gaussian();
      this.scatterZ[i] = gaussian();
    }
  }

  /** The State slider as this mode uses it: capped at its loosest (see PhysicsMode.looseCap). */
  get slider(): number {
    return Math.min(this.stateTarget, this.mode.looseCap);
  }

  get viewport(): Readonly<Viewport> {
    return this.view;
  }

  /** Shape radius after opening (the cloud is 30% wider than the solid). */
  effectiveRadius(): number {
    return this.view.radius * (1 + 0.3 * this.state);
  }

  /** Updates the shape's place on screen. `reset` snaps every particle home (on resize). */
  setViewport(view: Viewport, reset: boolean): void {
    this.view = view;
    if (!reset) return;
    const re = this.effectiveRadius();
    const sc = view.radius * 0.2 * this.state;
    for (let i = 0; i < this.count; i++) {
      this.x[i] = view.cx + this.discX[i] * re + this.scatterX[i] * sc;
      this.y[i] = view.cy + this.discY[i] * re + this.scatterY[i] * sc;
      this.z[i] = 0;
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
  }

  /**
   * A key went down: pull the particles into a formation while it's held. Velocity 0–1 sets how
   * hard they rush in and how large the shape is drawn.
   */
  summon(source: string, id: FormationId, isGreat: boolean, velocity: number): void {
    this.updateOffsets();
    this.summoning.hold(source, id, isGreat, velocity, this.relX, this.relY);
  }

  /**
   * The key came up. If it was the last one, the formation ends the way it was struck: a soft key
   * dissolves slowly, a hard one bursts apart (into vapor at the very top).
   */
  dismiss(source: string): void {
    this.updateOffsets();
    const velocity = this.summoning.release(source, this.relX, this.relY);
    if (velocity !== null && velocity > RELEASE_BURST_FROM) {
      this.fire(1 + (BLAST_MAX - 1) * ((velocity - RELEASE_BURST_FROM) / (1 - RELEASE_BURST_FROM)) ** 1.5);
    }
  }

  private updateOffsets(): void {
    const { cx, cy } = this.view;
    const re = this.effectiveRadius();
    for (let i = 0; i < this.count; i++) {
      this.relX[i] = (this.x[i] - cx) / re;
      this.relY[i] = (this.y[i] - cy) / re;
    }
  }

  /**
   * A kick or beat: pushes the state toward cloud and sends a shockwave out from the centre.
   * Strength 1 is a full kick. Up to BLAST_MAX goes further: the shape opens all the way, its springs
   * let go and the shockwave blows the particles into a hot mist that condenses back over a second.
   */
  fire(strength: number): void {
    this.pulse = Math.max(this.pulse, strength);
    // Drive: the hit scaled by Depth. Past 1 it blasts; a hard pad at the default Depth and an
    // ordinary kick at full Depth both reach DRIVE_MAX.
    const drive = strength * this.depth;
    const gap = (this.steps - this.lastHitStep) / 60;
    // A blast needs time to recharge: a hit after a pause blasts fully, one straight after another only
    // partly, so steady kicks at Deep hit hard but the shape still comes back between beats.
    const recharge = Math.min(1, gap / BLAST_RECHARGE);
    this.blast = Math.max(this.blast, Math.min(1, Math.max(0, (drive - 1) / (DRIVE_MAX - 1))) * recharge);
    this.pendingShock = Math.max(this.pendingShock, strength);
    // Grows faster than the gap, so slower tempos are more vaporous overall, not just per hit.
    this.rest = Math.min(REST_MAX, Math.max(REST_MIN, (gap / REST_BEAT) ** 1.8));
    this.lastHitStep = this.steps;
  }

  /** Advances one 1/60 s step. Returns mean kinetic energy (px²/step²) for the readout. */
  step(): number {
    this.steps++;
    const { mode, moon, pointer, count: N, x, y, z, vx, vy, vz } = this;
    // The State slider, capped at the mode's loosest (water stops at 75%).
    const slider = this.slider;
    const { radius: R, cx, cy, width: W, height: H } = this.view;

    // Gas holds a kick's opening a little longer, so its churn has time to show.
    // Deep pumps: past the default Depth a kick lets go faster, so the shape snaps back.
    const deep =
      Math.min(1, Math.max(0, (this.depth - PUMP_FROM) / (DEPTH_MAX - PUMP_FROM))) * (1 - this.mode.ripple);
    this.pulse *= lerp(lerp(0.925, 0.955, this.mode.vapor), PUMP_DECAY, deep);
    this.blast *= 0.965;
    // Water doesn't blast: a harder hit is a bigger ripple, and the droplets keep their hold so they return.
    const blast = this.blast * (1 - mode.ripple);
    // A rippling mode doesn't open all at once on a kick; the ripple carries the kick instead.
    // The kick opens the shape over a few frames (attack), then lets go at the usual rate.
    const openTarget = Math.min(1, this.pulse * this.depth * (1 - mode.ripple) + blast);
    this.open += (openTarget - this.open) * (openTarget > this.open ? KICK_ATTACK : 1);
    this.state = slider + (1 - slider) * this.open;
    const e = this.state;
    // In the blast range the shockwave grows much faster than the drive: that's what vaporizes.
    // `drive` and `shock` are this step's new hit (zero otherwise); its push is spread over KICK_STEPS.
    const drive = this.pendingShock * this.depth;
    const shock = drive * lerp(1, BLAST_PUSH, blast) * (R / 220) * 2.4;
    if (this.pendingShock) {
      this.kickLeft = KICK_STEPS;
      this.kickStrength = this.pendingShock;
    }
    this.pendingShock = 0;
    const kickDrive = this.kickLeft ? this.kickStrength * this.depth : 0;
    const shockGlow = Math.min(1, this.kickStrength * 0.35 + kickDrive * 0.5);
    const kickShock = this.kickLeft
      ? (kickDrive * lerp(1, BLAST_PUSH, blast) * (R / 220) * 2.4) / KICK_STEPS
      : 0;
    if (this.kickLeft) this.kickLeft--;
    if (shock && mode.ripple) {
      // The ring both pushes particles and lifts their homes outward as it passes (a travelling bulge).
      // Harder hits grow the ring faster than the hit itself, so Deep reads clearly bigger.
      const surge = Math.min(2, (drive / 0.65) ** 0.3);
      this.ripples.push({
        r: 0,
        amp: shock * surge,
        glow: shockGlow,
        lift: Math.min(2.2, drive * surge) * R * RIPPLE_LIFT,
      });
      if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
    }
    const instantShock = kickShock * (1 - mode.ripple);

    // A held formation takes over from the mode: a stiff spring to its target, calm damping, and no
    // thermostat, wall or spin to fight it. `fw` eases in so the swarm accelerates into place.
    const summoning = this.summoning;
    summoning.step(this.bpm);
    // A blast tears a held formation apart for a moment; it re-forms as the blast fades.
    const held = summoning.weight * summoning.weight * (3 - 2 * summoning.weight);
    const fw = held * (1 - 0.85 * blast);
    // Intensity makes a held seal burn: it trembles, swells a little and glows (see the excite floor).
    const burn = summoning.intensity * fw;

    const scale = R / REFERENCE_RADIUS;
    // Gas's pull home follows the slider, not each kick's opening: otherwise steady kicks hold it fully
    // open, the pull fades to nothing and the gas never comes back between beats.
    // (A blast still lets go fully.)
    const eHome = lerp(e, slider, mode.vapor * (1 - blast));
    const k =
      lerp(
        lerp(SOLID.spring, mode.spring, eHome) * (1 - (1 - mode.homeWeight) * Math.sqrt(eHome)),
        summoning.strength,
        fw,
      ) *
      (1 - BLAST_RELEASE * blast * (1 - 0.7 * deep)) *
      // …and the hold home stiffens, both carrying particles out to the hollowed shape and snapping them back.
      (1 + PUMP_SPRING * deep * Math.min(1, this.open * 3));
    // Deep: a kick pushes every home outward by about the same distance, so the middle empties (a ring).
    const hollow = PUMP_HOLLOW * deep * this.open;
    const containK = mode.contain * e * (1 - fw) * (1 - blast);
    const re = this.effectiveRadius();
    // Ripples cross the shape in RIPPLE_SECONDS: quicker when tight, slower when loose.
    const rippleSpeed = re / (60 * lerp(RIPPLE_SECONDS[0], RIPPLE_SECONDS[1], slider));
    const rippleWidth = re * RIPPLE_WIDTH;
    const rippleShare = rippleSpeed / (rippleWidth * Math.sqrt(Math.PI));
    // Loose droplets ride the wave like things floating on it: a little more swing, and a bob.
    // Tight water rides the moving resting places alone (a push on top just makes it bounce); loose
    // droplets have no resting place to follow, so they get the push.
    const rippleSwing = RIPPLE_SWING * lerp(0.2, 1.4, slider ** 1.5);
    for (const ring of this.ripples) ring.r += rippleSpeed;
    this.ripples = this.ripples.filter((ring) => ring.r < re * 1.8);
    const ripples = this.ripples;
    const containR = re * mode.containRadius;
    // Gas: the openness a kick adds (beyond the slider) makes it wander and slow, not speed up.
    const kickOpen = slider < 1 ? Math.max(0, (e - slider) / (1 - slider)) : 0;
    // (Not during a blast: that should still fling it.)
    const gassy = Math.min(1, mode.vapor * kickOpen * (1 - fw) * (1 - blast) * this.rest);
    const targetSpeed = mode.speed * lerp(e, slider, mode.vapor) * scale * (1 - fw);
    const damping = lerp(lerp(SOLID.damping, mode.damping, e), 0.9, fw) * (1 - 0.1 * gassy);
    const formR = re * FORMATION_SCALE * (1 + 0.3 * burn);
    const thermal = (lerp(SOLID.thermal, mode.thermal, e) * (1 + 10 * gassy) + burn * 1.5) * scale;
    // Share of particles a kick evaporates: grows with the hit's force, mostly from the edge.
    const evaporate =
      mode.vapor *
      (1 - fw) *
      Math.min(VAPOR_MAX_SHARE * (1 - PUMP_VAPOR_CUT * deep), 0.16 * drive ** 1.6 * this.rest);
    const vapor = this.vapor;
    // Tight gas makes a shorter, quicker round trip than loose: less drift, an earlier turn, a harder pull.
    const looseness = slider;
    const vaporDrift = 0.2 * scale * lerp(0.85, 1, looseness);
    const returnPace = lerp(3, 0.6, looseness);
    // Tight vapour loses its energy quickly and heads home; loose lingers.
    const vaporDecay = Math.exp(-1 / 60 / lerp(VAPOR_LIFE_TIGHT, VAPOR_LIFE, looseness));
    const vaporHold = lerp(0.42, VAPOR_HOLD, looseness);
    const scatter = R * 0.2 * e;

    // Shape morph and spin.
    // Timed S-curve: starts gently, glides, settles, rather than lurching off at full speed.
    const morphStep = 1 / (60 * MORPH_SECONDS);
    this.morph += Math.max(-morphStep, Math.min(morphStep, this.shapeTarget - this.morph));
    const m = this.morph;
    this.globe = m * m * m * (m * (m * 6 - 15) + 10);
    const gw = this.globe;
    // Spin. The globe turns rigidly on its tilted axis. The disc swirls: every particle orbits the centre
    // at its own rate (inner faster, each a little different), so they slide past one another.
    const targetSpin = angularStep(this.spinBars, this.bpm);
    this.spinSpeed += (targetSpin - this.spinSpeed) * 0.04;
    this.spinAngle += this.spinSpeed;
    const M = rotation(GLOBE_AXIS, this.spinAngle);
    const dM: Mat3 | null =
      gw > 0 && Math.abs(this.spinSpeed) > 1e-6 && fw < 1
        ? rotation(GLOBE_AXIS, this.spinSpeed * gw * (1 - fw))
        : null;
    const swirl = this.spinSpeed * (1 - fw);
    const swirlGrip = SWIRL_GRIP * (1 - gw);
    const camera = R * CAMERA_DISTANCE;

    // Moon. Gas and water: it displaces fluid (potential flow round a moving sphere) and pushes a bow wave.
    // Attract and repel: a short-range magnet acting on the cloud beneath it. Both are sized against the
    // current spring stiffness so the effect stays visible at any state.
    moon.step(cx, cy, R, this.bpm);
    const moonOn = moon.visible;
    const mr = moon.radius;
    const magnet = mode.alwaysOn
      ? Math.sign(mode.pointerGravity) * Math.max(k, 0.02) * R * lerp(0.4, 1, e) * moon.presence * moon.force
      : 0;
    const magnetReach2 = (R * 0.65) ** 2;
    const flowR = mr * 5;
    const flowR2 = flowR * flowR;
    const mr3 = mr * mr * mr;
    const pressK = (Math.max(k, 0.02) * R * lerp(0.9, 1.5, e) + 1.2 * scale) * moon.presence * moon.force;
    const pressReach2 = (mr * 2.2) ** 2;
    const moonSpeed = Math.hypot(moon.vx, moon.vy, moon.vz) || 1e-6;
    // In disc mode the moon acts as if it passes through the disc's plane. A held formation is a flat
    // seal the moon orbits around (true 3D distance), feeling only a little of its pull.
    const zWeight = lerp(0.15 + 0.85 * gw, 1, fw);
    const moonGrip = 1 - 0.6 * fw;

    // Repel: the moon presses a beam into the shape, aimed at its centre. Gentle, it's broad and shallow,
    // like a hand pushed into a balloon; at full Force it narrows and reaches halfway through (the
    // centre), never further. The push fades out toward that depth, so particles bank up at the end.
    const beam = mode.alwaysOn && mode.pointerGravity < 0 && moonOn;
    const beamForce = Math.min(1, moon.force / MOON_FORCE_MAX);
    let ux = 0;
    let uy = 0;
    let uz = 0;
    let beamEnd = 0;
    if (beam) {
      const bx = cx - moon.x;
      const by = cy - moon.y;
      const bz = -moon.z * zWeight;
      const bl = Math.hypot(bx, by, bz) || 1;
      ux = bx / bl;
      uy = by / bl;
      uz = bz / bl;
      // From the shape's near surface, a third of the way to the centre at the gentlest, all of it at full.
      beamEnd = bl - re + re * lerp(0.35, 1, beamForce);
    }
    const beamFade = re * 0.4;
    // Sized against the home spring, so the dent goes as deep as Force says whatever the State.
    const beamOn = Math.min(1, moon.force * 4) * moonGrip;
    const beamPush = k * re * BEAM_PUSH * lerp(0.6, 1, beamForce) * beamOn;
    const beamFocus = k * re * BEAM_FOCUS * beamForce * beamOn;
    const beamWidth = mr * lerp(1.5, 0.75, beamForce);
    const beamCore2 = beamWidth * beamWidth;
    const beamCapture = beamWidth * 2;
    const beamCapture2 = beamCapture * beamCapture;

    // Pointer: gravity scales with movement in the fluid modes; poles are always on.
    pointer.step();
    const sweepVapor =
      mode.vapor *
      (1 - fw) *
      POINTER_VAPOR *
      lerp(0.35, 1, slider) *
      // Energy from the pointer's speed, less what it takes to break the shape loose: tight needs a fast
      // sweep before anything evaporates, loose gives way at once. Grows faster than the excess.
      Math.min(
        2,
        Math.max(
          0,
          Math.hypot(pointer.vx, pointer.vy) / POINTER_VAPOR_SPEED - lerp(BREAK_ENERGY, 0, slider),
        ) ** 1.5,
      );
    // Loose water flings easily, so the pointer is gentler there (see PhysicsMode.loosePointer).
    const pointerScale = lerp(1, mode.loosePointer, slider);
    // Magnetic poles hold harder against a tight shape, whose springs otherwise hold it in place.
    const poleBoost = mode.alwaysOn ? lerp(POLE_TIGHT, 1, slider) : 1;
    const gravity =
      mode.pointerGravity *
      (mode.alwaysOn ? 1 : 0.25 + 0.75 * pointer.activity) *
      (R / 220) *
      pointerScale *
      poleBoost;
    const soft = Math.max(18, R * 0.13);
    const soft2 = soft * soft;
    const wakeR2 = (R * 0.35) ** 2;
    const huddleReach2 = (R * HUDDLE_REACH) ** 2;
    // Gas and water: the pointer is a solid body moving through the fluid (see the fluid branch below).
    const fluidPointer = !mode.alwaysOn;
    const pvx = pointer.vx;
    const pvy = pointer.vy;
    const pSpeed = Math.hypot(pvx, pvy);
    const pux = pSpeed > 1e-3 ? pvx / pSpeed : 0;
    const puy = pSpeed > 1e-3 ? pvy / pSpeed : 0;
    const body = Math.max(10, R * BODY_RADIUS);
    const body2 = body * body;
    // Its solid core only exists while it moves: still, it pushes nothing; full size at BODY_FULL_SPEED.
    const core = body * Math.min(1, pSpeed / BODY_FULL_SPEED);
    const flowReach = body * 5;
    // Faster pointer, longer wake (shape radii, capped).
    const wakeLength = Math.min(R * 1.6, body * (2 + pSpeed * 0.5));
    const eddyPhase = this.steps * EDDY_RATE;

    if (e > 0.02) this.interact(re, e, scale, gw, W, H);

    let ke = 0;
    const zPin = 0.08 * (1 - gw);
    // A flat shape (the disc, or a held formation) bleeds off depth motion. Without this, the moon's
    // nudges in z ring on a frictionless pin: particles bob toward the camera, swelling and glowing.
    const zDamp = lerp(1, FLAT_Z_DAMPING, Math.max(1 - gw, fw));
    const vmax = 25 * scale;
    // Excitation: speed above the mode's resting motion at the slider's state (gas always flies; that
    // alone shouldn't glow, but a kick that heats it should).
    const calm = mode.speed * slider * scale * 1.15 + EXCITE_CALM * scale;
    const exciteGain = 1 / (EXCITE_FULL * scale);
    const excite = this.excite;
    for (let i = 0; i < N; i++) {
      // The body spins rigidly; physics runs on top of the rotation.
      if (dM) {
        const ox = x[i] - cx;
        const oy = y[i] - cy;
        const oz = z[i];
        x[i] = cx + dM[0] * ox + dM[1] * oy + dM[2] * oz;
        y[i] = cy + dM[3] * ox + dM[4] * oy + dM[5] * oz;
        z[i] = dM[6] * ox + dM[7] * oy + dM[8] * oz;
        const a = vx[i];
        const b = vy[i];
        const c = vz[i];
        vx[i] = dM[0] * a + dM[1] * b + dM[2] * c;
        vy[i] = dM[3] * a + dM[4] * b + dM[5] * c;
        vz[i] = dM[6] * a + dM[7] * b + dM[8] * c;
      }

      // Home: the (swirling) disc point blended toward the rotating sphere point, loosened by the scatter.
      if (swirl) {
        this.discTurn[i] += swirl * this.swirlRate[i];
        if (this.discTurn[i] > Math.PI) this.discTurn[i] -= 2 * Math.PI;
        else if (this.discTurn[i] < -Math.PI) this.discTurn[i] += 2 * Math.PI;
      }
      const turnCos = Math.cos(this.discTurn[i]);
      const turnSin = Math.sin(this.discTurn[i]);
      const dhx = (this.discX[i] * turnCos - this.discY[i] * turnSin) * re;
      const dhy = (this.discX[i] * turnSin + this.discY[i] * turnCos) * re;
      const sx = this.sphereX[i];
      const sy = this.sphereY[i];
      const sz = this.sphereZ[i];
      const shx = (M[0] * sx + M[1] * sy + M[2] * sz) * re;
      const shy = (M[3] * sx + M[4] * sy + M[5] * sz) * re;
      const shz = (M[6] * sx + M[7] * sy + M[8] * sz) * re;
      // The disc's scatter turns with it; the globe's stays put as before.
      const scx = this.scatterX[i];
      const scy = this.scatterY[i];
      const sdx = scx + (scx * turnCos - scy * turnSin - scx) * (1 - gw);
      const sdy = scy + (scx * turnSin + scy * turnCos - scy) * (1 - gw);
      let hx = cx + dhx + (shx - dhx) * gw + sdx * scatter;
      let hy = cy + dhy + (shy - dhy) * gw + sdy * scatter;
      let hz = shz * gw + this.scatterZ[i] * scatter * gw;
      if (hollow) {
        // Out along the home's own direction from the centre (its disc / sphere point, so even the middle has one).
        const ux = this.discX[i] + (this.sphereX[i] - this.discX[i]) * gw;
        const uy = this.discY[i] + (this.sphereY[i] - this.discY[i]) * gw;
        const uz = this.sphereZ[i] * gw;
        const ul = Math.hypot(ux, uy, uz) || 1;
        const push = hollow * re * (1 - 0.5 * Math.min(1, ul));
        hx += (ux / ul) * push;
        hy += (uy / ul) * push;
        hz += (uz / ul) * push;
      }
      if (ripples.length) {
        const px = x[i] - cx;
        const py = y[i] - cy;
        const pz = z[i];
        const pd = Math.hypot(px, py, pz) || 1;
        let lift = 0;
        // Like a real drop, the middle settles quickly and the ring carries the motion outward: lift is
        // weakest at the centre, so it isn't swept empty on every beat.
        const rim = 0.2 + 0.8 * Math.min(1, pd / re);
        for (const ring of ripples) {
          const q = (pd - ring.r) / rippleWidth;
          if (q * q < 9) lift += ring.lift * rim * Math.exp(-q * q);
        }
        if (lift) {
          hx += (px / pd) * lift;
          hy += (py / pd) * lift;
          hz += (pz / pd) * lift;
        }
      }
      if (fw > 0) {
        // Formations are flat and face the viewer, like a seal on the wall.
        hx += (cx + summoning.tx[i] * formR - hx) * fw;
        hy += (cy + summoning.ty[i] * formR - hy) * fw;
        hz -= hz * fw;
      }
      const v = vapor[i];
      // No pull home while mostly vapour; it returns over the last stretch of condensing.
      const ki = v ? 0 : k;
      let ax = (hx - x[i]) * ki;
      let ay = (hy - y[i]) * ki;
      let az = (hz - z[i]) * ki - z[i] * zPin;
      ax += (Math.random() - 0.5) * thermal;
      ay += (Math.random() - 0.5) * thermal;
      az += (Math.random() - 0.5) * thermal * gw;

      const ox = x[i] - cx;
      const oy = y[i] - cy;
      const oz = z[i];
      if (ripples.length) {
        // Each ring is a wave: it pushes outward as it arrives and pulls back in as it passes, so particles
        // bob out and back with no net drift (loose water would otherwise pile up against its wall).
        const od = Math.hypot(ox, oy, oz) || 1;
        const rim = 0.3 + 0.7 * Math.min(1, od / re);
        for (const ring of ripples) {
          const q = (od - ring.r) / rippleWidth;
          if (q * q > 9) continue;
          const g = Math.exp(-q * q);
          // The pull behind the ring is a little stronger than the push in front: particles have moved out
          // by the time it reaches them, so an even pull would leave them, and the centre, drifting outward.
          const f = (ring.amp * rim * rippleSwing * q * (q < 0 ? RIPPLE_PULL : 1) * g * rippleShare) / od;
          vx[i] += ox * f;
          vy[i] += oy * f;
          vz[i] += oz * f;
          // The crest lifts what it passes toward the viewer, then it settles: a bob, felt most when loose.
          vz[i] += ring.amp * RIPPLE_BOB * slider * q * g * rippleShare;
          // Water is thick where the ring passes: damp the motion so it rises and settles, not rings.
          const thick = 1 - RIPPLE_SETTLE * g;
          vx[i] *= thick;
          vy[i] *= thick;
          vz[i] *= thick;
          if (this.excite[i] < ring.glow * rim * g) this.excite[i] = ring.glow * rim * g;
        }
      }
      if (instantShock) {
        const od = Math.hypot(ox, oy, oz) || 1;
        const rim = 0.3 + 0.7 * Math.min(1, od / re);
        const f = (instantShock * rim) / od;
        vx[i] += ox * f;
        vy[i] += oy * f;
        vz[i] += oz * f;
        // The shockwave lights the shape too, brightest at the rim, in every mode.
        this.excite[i] = Math.max(this.excite[i], shockGlow * rim);
        if (evaporate && !v && Math.random() < evaporate * rim)
          vapor[i] = Math.max(vapor[i], 0.6 + 0.4 * Math.random());
      }
      if (v) {
        const dx = hx - x[i];
        const dy = hy - y[i];
        const d = Math.hypot(dx, dy) || 1;
        this.vaporFade[i] = Math.min(1, d / (re * VAPOR_FADE_AT));
        if (v > vaporHold) {
          // Vapour wanders and drifts outward, slowly, and stops drifting once it has faded out.
          const od = Math.hypot(ox, oy) || 1;
          const drift = vaporDrift * (1 - this.vaporFade[i]);
          ax += ((ox / od) * drift + (Math.random() - 0.5) * thermal * 2) * v;
          ay += ((oy / od) * drift + (Math.random() - 0.5) * thermal * 2) * v;
          // A leash: vapour that has drifted past where it fades out is drawn gently back, so constant
          // kicks (which keep it from ever condensing) can't carry it off the screen.
          const past = d / re - VAPOR_FADE_AT;
          if (past > 0) {
            // (Slack during a blast, so a big hit still flings it; it reins in as the blast fades.)
            const leash = past * VAPOR_LEASH * scale * (1 - blast);
            ax += (dx / d) * leash;
            ay += (dy / d) * leash;
          }
        } else {
          // Condensing: pulled home, harder the closer it gets, so it lingers far out and rushes in.
          // Ramps up steeply on approach; Tight pulls harder, Loose lets it linger.
          // Exponential ramp: barely a pull far out, rising steeply as it closes in.
          const pull =
            VAPOR_RETURN *
            scale *
            returnPace *
            (1 - v / vaporHold + 0.2) *
            (1 + RETURN_RAMP * Math.exp(-d / (re * RETURN_SCALE)));
          ax += (dx / d) * pull;
          ay += (dy / d) * pull;
        }
        const next = v * vaporDecay;
        // Home (or nearly condensed): back to the ordinary spring.
        if (next < 0.02 || (v <= vaporHold && d < re * 0.03)) {
          vapor[i] = 0;
          this.vaporFade[i] = 0;
        } else {
          vapor[i] = next;
        }
      }
      if (containK) {
        if (gw < 0.5) {
          const od = Math.hypot(ox, oy);
          if (od > containR) {
            const f = (containK * (od - containR)) / od;
            ax -= ox * f;
            ay -= oy * f;
          }
        } else {
          // Globe: hold free particles in a shell (a water film, a gas atmosphere).
          const od = Math.hypot(ox, oy, oz) || 1;
          const rin = re * mode.shellInner;
          const rout = re * mode.shellOuter;
          const over = od > rout ? od - rout : od < rin ? od - rin : 0;
          if (over) {
            const f = (mode.shellStrength * e * over) / od;
            ax -= ox * f;
            ay -= oy * f;
            az -= oz * f;
          }
        }
      }
      if (targetSpeed) {
        // Thermostat: nudge each particle's speed toward the target so gas keeps flying straight.
        const sp = Math.hypot(vx[i], vy[i], vz[i] * gw);
        if (sp > 1e-3) {
          const f = 0.04 * (targetSpeed / sp - 1);
          vx[i] += vx[i] * f;
          vy[i] += vy[i] * f;
          vz[i] += vz[i] * f;
        } else {
          const a = Math.random() * 2 * Math.PI;
          vx[i] = Math.cos(a) * targetSpeed;
          vy[i] = Math.sin(a) * targetSpeed;
        }
      }
      this.huddle[i] = 0;
      if (pointer.active && !fluidPointer) {
        // Attract and repel: the pointer is a magnetic pole. It acts where the particle appears on screen.
        const ps = camera / (camera - z[i]);
        const dx = pointer.x - (cx + ox * ps);
        const dy = pointer.y - (cy + oy * ps);
        const d2 = dx * dx + dy * dy;
        if (gravity > 0) this.huddle[i] = Math.exp(-d2 / huddleReach2);
        const inv = 1 / Math.pow(d2 + soft2, 1.5);
        ax += gravity * dx * inv;
        ay += gravity * dy * inv;
        if (d2 < wakeR2) {
          const w = mode.pointerWake * pointerScale * (1 - d2 / wakeR2);
          ax += pvx * w;
          ay += pvy * w;
        }
      } else if (pointer.active) {
        // Gas and water: the pointer is a solid body moving through the fluid, like a cylinder in a flow
        // tank. Ahead and alongside, the fluid parts and slides round it (potential flow); it can't pass
        // through; behind, a wake drags along after it and sheds eddies to alternate sides.
        const ps = camera / (camera - z[i]);
        const rx = cx + ox * ps - pointer.x;
        const ry = cy + oy * ps - pointer.y;
        const r2 = rx * rx + ry * ry;
        const r = Math.sqrt(r2) || 1e-3;
        // The fluid gives way where the body passes: near it and in its wake the hold home lets go, so even
        // tight water and gas are pushed aside and stirred, then settle back once it has gone by.
        let give = 0;
        if (r < flowReach && pSpeed > 0.2) {
          give = Math.max(give, 1 - r / flowReach);
          const nx = rx / r;
          const ny = ry / r;
          const un = pvx * nx + pvy * ny;
          const k2 = body2 / Math.max(r2, body2);
          const w = FLOW_GRIP * pointerScale * (1 - r / flowReach);
          ax += (k2 * (2 * un * nx - pvx) - vx[i]) * w;
          ay += (k2 * (2 * un * ny - pvy) - vy[i]) * w;
        }
        if (core > 1 && r < core) {
          // Solid: out to the surface, and no closing speed into it.
          x[i] += (rx / r) * (core - r);
          y[i] += (ry / r) * (core - r);
          const vn = (vx[i] - pvx) * (rx / r) + (vy[i] - pvy) * (ry / r);
          if (vn < 0) {
            vx[i] -= vn * (rx / r);
            vy[i] -= vn * (ry / r);
          }
        }
        // Wake: behind the body (along its path), within a band that widens as it trails off.
        const behind = -(rx * pux + ry * puy);
        const side = rx * -puy + ry * pux;
        if (pSpeed > 0.5 && behind > 0 && behind < wakeLength) {
          const width = body * (1.2 + behind / body / 6);
          if (Math.abs(side) < width * 1.5) {
            const fall = 1 - behind / wakeLength;
            const core = Math.exp(-((side / width) ** 2));
            give = Math.max(give, fall * core);
            // Dragged along after the body, strongest close behind.
            const drag = WAKE_DRAG * pointerScale * fall * core;
            ax += (pvx - vx[i]) * drag;
            ay += (pvy - vy[i]) * drag;
            // Eddies: a sideways sway that alternates down the wake and travels with it.
            const sway =
              EDDY_SWAY *
              pointerScale *
              pSpeed *
              fall *
              core *
              Math.min(1, behind / (body * 2)) *
              Math.sin((behind / (body * EDDY_SPACING)) * Math.PI * 2 - eddyPhase);
            ax += -puy * sway;
            ay += pux * sway;
            // Gas: what the body passes through evaporates; faster sweeps throw the vapour further out.
            if (sweepVapor && !vapor[i] && Math.random() < sweepVapor * core * fall) {
              // More energy, longer as vapour (it turns home once it drops below the hold level).
              const energy = Math.min(1, pSpeed / (POINTER_VAPOR_SPEED * 2.5));
              vapor[i] = Math.min(
                0.95,
                vaporHold + 0.05 + (0.9 - vaporHold) * energy * (0.6 + 0.4 * Math.random()),
              );
              const fling = VAPOR_FLING * pSpeed * Math.sign(side || 1);
              vx[i] += -puy * fling;
              vy[i] += pux * fling;
            }
          }
        }
        if (give) {
          // Tight holds firm against a slow hand (it snaps back); a fast one, or loose fluid, gives way.
          const g =
            FLUID_GIVE *
            pointerScale *
            Math.min(1, give * 1.5) *
            Math.min(1, pSpeed / lerp(GIVE_SPEED_TIGHT, 4, slider));
          ax += (x[i] - hx) * ki * g;
          ay += (y[i] - hy) * ki * g;
        }
      }
      if (moonOn) {
        const mx = moon.x - x[i];
        const my = moon.y - y[i];
        const mz = (moon.z - z[i]) * zWeight;
        const m2 = mx * mx + my * my + mz * mz;
        const md = Math.sqrt(m2) || 1e-3;
        if (magnet) {
          // Gaussian reach: only the cloud under the moon's path responds. Repel keeps a little of it
          // so particles don't sit on the moon; its real force is the beam.
          const f = ((beam ? magnet * BEAM_RESIDUAL : magnet) * moonGrip * Math.exp(-m2 / magnetReach2)) / md;
          ax += mx * f;
          ay += my * f;
          az += mz * f;
          if (beam) {
            // Position along the beam (from the moon) and squared distance from its line.
            const along = -(mx * ux + my * uy + mz * uz);
            if (along > -mr && along < beamEnd) {
              const qx = -mx - along * ux;
              const qy = -my - along * uy;
              const qz = -mz - along * uz;
              const q2 = qx * qx + qy * qy + qz * qz;
              if (q2 < beamCapture2 * 4) {
                // Fades in over the moon's radius and out as it nears its full depth.
                const reach = Math.min(1, (along + mr) / mr) * Math.min(1, (beamEnd - along) / beamFade);
                const push = beamPush * Math.exp(-q2 / beamCore2) * reach;
                ax += ux * push;
                ay += uy * push;
                az += uz * push;
                const focus = (beamFocus * Math.exp(-q2 / beamCapture2) * reach) / beamCapture;
                ax -= qx * focus;
                ay -= qy * focus;
                az -= qz * focus;
              }
            }
          }
        } else if (m2 < flowR2 && md > mr * 0.5) {
          // Displaced fluid: pushed ahead, sliding round the sides, closing in behind.
          const nx = -mx / md;
          const ny = -my / md;
          const nz = -mz / md;
          const un = moon.vx * nx + moon.vy * ny + moon.vz * nz;
          const k3 = (3.5 * moon.force * mr3) / (2 * md * md * md);
          const ufx = k3 * (3 * un * nx - moon.vx);
          const ufy = k3 * (3 * un * ny - moon.vy);
          const ufz = k3 * (3 * un * nz - moon.vz);
          const w = Math.min(0.6, 0.5 * moon.force) * (1 - md / flowR) * moonGrip;
          ax += (ufx - vx[i]) * w;
          ay += (ufy - vy[i]) * w;
          az += (ufz - vz[i]) * w;
        }
        if (!magnet && m2 < flowR2 * 1.5) {
          // Pressure: fluid is shoved aside, hardest along the direction of travel (bow wave).
          const nx = -mx / md;
          const ny = -my / md;
          const nz = -mz / md;
          const ahead = Math.max(0, (nx * moon.vx + ny * moon.vy + nz * moon.vz) / moonSpeed);
          const f = pressK * moonGrip * Math.exp(-m2 / pressReach2) * (0.5 + ahead);
          ax += nx * f;
          ay += ny * f;
          az += nz * f;
        }
        if (md < mr) {
          // Solid surface: push out and reflect the approaching velocity.
          const nx = -mx / md;
          const ny = -my / md;
          const nz = -mz / md;
          const push = mr - md;
          x[i] += nx * push;
          y[i] += ny * push;
          z[i] += (nz * push) / zWeight;
          const vn = (vx[i] - moon.vx) * nx + (vy[i] - moon.vy) * ny + (vz[i] - moon.vz) * nz;
          if (vn < 0) {
            vx[i] -= 1.1 * vn * nx;
            vy[i] -= 1.1 * vn * ny;
            vz[i] -= 1.1 * vn * nz;
          }
        }
      }

      // The swirl's own motion here: it carries loose particles round and doesn't count as being stirred up.
      let tvx = 0;
      let tvy = 0;
      if (swirl) {
        const want = swirl * this.swirlRate[i] * (1 - gw);
        tvx = -(y[i] - cy) * want;
        tvy = (x[i] - cx) * want;
      }
      if (swirl && swirlGrip) {
        // Loose particles are carried round by the swirl itself, not only dragged by their home.
        const sx = x[i] - cx;
        const sy = y[i] - cy;
        const r2 = sx * sx + sy * sy || 1;
        const along = ((vx[i] - tvx) * -sy + (vy[i] - tvy) * sx) / r2;
        ax -= -sy * along * swirlGrip * e;
        ay -= sx * along * swirlGrip * e;
      }
      const drag = damping * (1 - 0.06 * v * (1 - blast));
      let nvx = (vx[i] + ax) * drag;
      let nvy = (vy[i] + ay) * drag;
      let nvz = (vz[i] + az) * drag * zDamp;
      const sp2 = nvx * nvx + nvy * nvy + nvz * nvz;
      if (sp2 > vmax * vmax) {
        const f = vmax / Math.sqrt(sp2);
        nvx *= f;
        nvy *= f;
        nvz *= f;
      }
      vx[i] = nvx;
      vy[i] = nvy;
      vz[i] = nvz;
      x[i] += nvx;
      y[i] += nvy;
      z[i] += nvz;
      ke += sp2;
      const stir = Math.min(1, (Math.hypot(nvx - tvx, nvy - tvy, nvz) - calm) * exciteGain);
      excite[i] = stir > excite[i] ? excite[i] + (stir - excite[i]) * 0.5 : excite[i] * EXCITE_DECAY;
      if (excite[i] < burn * 0.85) excite[i] = burn * 0.85;
    }
    return ke / N;
  }

  /** Particle–particle repulsion, cohesion and viscosity over a uniform grid (half-neighbourhood scan). */
  private interact(re: number, e: number, scale: number, gw: number, W: number, H: number): void {
    const { mode, count: N, x, y, z, vx, vy, vz, next, huddle } = this;
    const spacing = re * Math.sqrt(Math.PI / N) * (1 + gw);
    const h = mode.range * spacing;
    const cols = Math.ceil(W / h) + 2;
    const rows = Math.ceil(H / h) + 2;
    const cells = cols * rows;
    if (this.cellHead.length < cells) this.cellHead = new Int32Array(cells);
    const head = this.cellHead;
    head.fill(-1, 0, cells);
    for (let i = 0; i < N; i++) {
      const c = Math.min(cols - 1, Math.max(0, (x[i] / h + 1) | 0));
      const r = Math.min(rows - 1, Math.max(0, (y[i] / h + 1) | 0));
      const id = r * cols + c;
      next[i] = head[id];
      head[id] = i;
    }
    const rep = mode.repulsion * e * scale;
    const coh = mode.cohesion * e * scale;
    const visc = mode.viscosity * e;
    const h2 = h * h;
    const offsets = [0, 1, cols - 1, cols, cols + 1];
    for (let id = 0; id < cells; id++) {
      for (let i = head[id]; i !== -1; i = next[i]) {
        for (let o = 0; o < 5; o++) {
          const nid = id + offsets[o];
          if (nid >= cells) continue;
          for (let j = o === 0 ? next[i] : head[nid]; j !== -1; j = next[j]) {
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const dz = z[j] - z[i];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= h2 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const q = 1 - d / h;
            const close = 1 - HUDDLE_PACK * Math.max(huddle[i], huddle[j]);
            const push = rep * close * q * q - coh * q * (1 - q);
            const nx = dx / d;
            const ny = dy / d;
            const nz = dz / d;
            vx[i] -= nx * push;
            vy[i] -= ny * push;
            vz[i] -= nz * push;
            vx[j] += nx * push;
            vy[j] += ny * push;
            vz[j] += nz * push;
            if (visc) {
              const fx = (vx[j] - vx[i]) * visc * q;
              const fy = (vy[j] - vy[i]) * visc * q;
              const fz = (vz[j] - vz[i]) * visc * q;
              vx[i] += fx;
              vy[i] += fy;
              vz[i] += fz;
              vx[j] -= fx;
              vy[j] -= fy;
              vz[j] -= fz;
            }
          }
        }
      }
    }
  }
}
