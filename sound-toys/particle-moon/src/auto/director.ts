// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { MusicFeatures } from './listener';

/** What the music is doing, in broad strokes. */
export type Scene = 'drift' | 'groove' | 'build' | 'drop' | 'breakdown';

/** A slider the director plays (0–1 across its range) or a set of options it picks from. */
type SliderId = 'state' | 'depth' | 'spin' | 'orbit' | 'mforce';
type OptionGroup = 'mode' | 'shape' | 'moon' | 'pole';

/** Where the director wants things, per scene. Sliders 0–1 across their range. */
interface Look {
  state: number;
  depth: number;
  spin: number;
  /** The moon's orbit speed (Orbit slider, 0–1). */
  orbit: number;
  mforce: number;
  /** Physics modes and shapes that suit the scene; the director moves between them. */
  modes: readonly string[];
  shapes: readonly string[];
  /** Chance the moon is on after each look change. */
  moon: number;
  /** Seconds to glide to these values. */
  glide: number;
}

/**
 * A move: a slider's offset from its scene value, easing from one place to the next (smoothstep).
 * The director keeps State and Depth moving with these, phrase by phrase, so they never just park.
 */
class Move {
  private from = 0;
  private to = 0;
  private start = 0;
  private length = 1;

  at(now: number): number {
    const t = Math.min(1, Math.max(0, (now - this.start) / this.length));
    return this.from + (this.to - this.from) * t * t * (3 - 2 * t);
  }

  go(now: number, to: number, seconds: number): void {
    this.from = this.at(now);
    this.to = to;
    this.start = now;
    this.length = Math.max(0.05, seconds);
  }
}

/**
 * Moves: with a beat, a new one every MOVE_BARS bars (sooner when the energy is up), easing over
 * 1–4 bars; without, every MOVE_SECONDS. State moves up to ±MOVE_STATE round its scene value, and
 * GESTURE of the time sweeps hard toward Tight or Loose (±GESTURE_STATE) and back a bar or two later.
 * Depth moves up to ±MOVE_DEPTH, never into Deep unless the scene is already there (strong kicks).
 */
const MOVE_BARS: readonly [number, number] = [2, 8];
const MOVE_SECONDS: readonly [number, number] = [6, 20];
const MOVE_STATE = 0.3;
const GESTURE = 0.2;
const GESTURE_STATE = 0.6;
const MOVE_DEPTH = 0.2;
const DEEP_FROM = 0.75;

/** Kicks per second at which the music counts as having a beat. */
const BEAT_RATE = 0.9;
/** Below this, the beat has gone. */
const NO_BEAT_RATE = 0.4;
/** A new scene must hold this long before it's taken (a drop is taken at once). */
const SETTLE = 2.5;
/**
 * Looks (physics mode and shape) change every LOOK_BARS (12–32, in 4-bar steps, high energy favouring
 * the short end) with a beat, or at the next bar
 * when the energy shifts by ENERGY_SHIFT of the track's norm; without a beat, on an energy shift (at
 * least AMBIENT_MIN s apart) or every AMBIENT_EVERY s.
 */
const LOOK_BARS: readonly [number, number] = [12, 32];
/** Energy shifts change the look early, but not within this many bars of the last change. */
const SHIFT_MIN_BARS = 4;
/** Panning: a new spot every PAN_BARS, at most PAN_X / PAN_Y of the screen from centre. */
const PAN_BARS = 32;
const PAN_X = 0.04;
const PAN_Y = 0.03;
/**
 * The view's angle: a new one every ANGLE_BARS with a beat (ANGLE_SECONDS without), up to ANGLE_YAW /
 * ANGLE_PITCH (radians) off straight on, and back to straight on ANGLE_STRAIGHT of the time. ANGLE_SWEEP
 * of the time instead a bigger turn toward side on (ANGLE_SIDE, where the disc's face can be seen
 * moving), held SWEEP_HOLD_BARS, and the next move brings it back. Each move turns at one of the Spin
 * speeds (a turn per this many bars; see SPIN_BARS), so it reads as a move: ANGLE_RATES for the
 * gentle ones, SWEEP_RATES for sweeps and the return from them.
 */
const ANGLE_BARS: readonly [number, number] = [16, 32];
const ANGLE_SECONDS: readonly [number, number] = [20, 45];
const ANGLE_YAW = 0.6;
const ANGLE_PITCH = 0.45;
const ANGLE_STRAIGHT = 0.25;
const ANGLE_SWEEP = 0.12;
const ANGLE_SIDE = 1.3;
const ANGLE_RATES: readonly number[] = [16, 8];
const SWEEP_RATES: readonly number[] = [8, 4];
const SWEEP_HOLD_BARS: readonly [number, number] = [4, 8];
const ENERGY_SHIFT = 0.25;
const AMBIENT_MIN = 6;
const AMBIENT_EVERY = 30;
/** Chance a groove or drop look spins the globe faster than a bar a turn (½ bar), and of those, a drop's share at a beat a turn. */
const FAST_SPIN_CHANCE = 0.12;
const FASTEST_SPIN_SHARE = 0.4;
/** Kick strength over which Depth goes from its normal range into deep, and how much a groove reaches for it. */
const STRONG_KICK: readonly [number, number] = [0.85, 1.15];
const DEEP = 0.2;
/** A control the performer touches is theirs for this long. */
const HAND_BACK = 30;
/** Slider updates per second (they glide in between). */
const APPLY_RATE = 30;

/** Seconds per turn the spin aims for when a kick drives it. */
const SPIN_SECONDS = 5;
/** Bars per turn for each Spin slider step (see sim/divisions). */
const SPIN_BARS = [0, 32, 16, 8, 4, 2, 1, 0.5, 0.25];

/** Spin slider step nearest one turn per SPIN_SECONDS at this tempo (2 bars with no tempo). */
function spinIndex(bpm: number): number {
  if (!bpm) return 5;
  const bars = (SPIN_SECONDS * bpm) / 240;
  let best = 1;
  for (let i = 1; i < SPIN_BARS.length; i++) {
    if (Math.abs(Math.log(SPIN_BARS[i] / bars)) < Math.abs(Math.log(SPIN_BARS[best] / bars))) best = i;
  }
  return best;
}

/**
 * Bars until the next look change: 12–32 in 4-bar steps, skewed short when the energy (0–1) is high and
 * long when it's low.
 */
function lookBars(energy: number): number {
  const r = Math.random();
  const skew = energy >= 0.5 ? r ** (1 + 6 * (energy - 0.5)) : 1 - (1 - r) ** (1 + 6 * (0.5 - energy));
  const bars = LOOK_BARS[0] + (LOOK_BARS[1] - LOOK_BARS[0]) * skew;
  return Math.round(bars / 4) * 4;
}

/** Physical controls the director moves. Sliders take a 0–1 value; options an id. */
export interface DirectorControls {
  setSlider(id: SliderId, value01: number): void;
  setOption(group: OptionGroup, id: string): void;
  /** A big hit (the drop). */
  fire(strength: number): void;
  /** Moves the shape off centre by these fractions of the screen's width and height. */
  pan(x: number, y: number): void;
  /** Glides the view to this angle (yaw, pitch in radians off straight on) over `seconds`. */
  aim(yaw: number, pitch: number, seconds: number): void;
}

/**
 * AI mode. Reads the music as one of five scenes and plays the controls the way a performer might:
 * drifting and loose through ambient passages, locked to the groove when the kick is in, tightening
 * and gathering through a build, pumping on the drop, letting go in the breakdown. Brightness and
 * energy shade every scene. Sliders glide to each scene's values, and State and Depth keep moving round
 * them phrase by phrase (see Move), with the odd big sweep; each kick also swings State open by itself,
 * in the simulation. The look (physics mode and shape) moves on every 12–32 bars or when the energy
 * shifts. Anything the performer touches is theirs for a while.
 */
export class Director {
  enabled = false;
  scene: Scene = 'drift';
  private candidate: Scene = 'drift';
  private candidateFor = 0;
  private sceneFor = 0;
  private lastBeatAt = -Infinity;
  private lastQuietAt = -Infinity;
  /** Beats since the look last changed, beats overall, and the energy and time at that change. */
  private lookBeats = 0;
  /** Beats until the next look change (12–32 bars, picked at each change). */
  private nextLook = 64;
  /** Spin and orbit slider steps (0–8) for the current look. */
  private spinStep = 2;
  private orbitStep = 3;
  private pan = { fromX: 0, fromY: 0, toX: 0, toY: 0, start: -Infinity, length: 1 };
  /** When the view's next angle is due, and whether it's on a sweep (the next move brings it back). */
  private nextAngleAt = 0;
  private sweeping = false;
  /** Where the director last aimed the view (yaw, pitch), to time the next move by how far it goes. */
  private aimYaw = 0;
  private aimPitch = 0;
  private beats = 0;
  private lookEnergy = 0;
  private lookAt = -Infinity;
  private lookScene: Scene | null = null;
  private current: Look | null = null;
  private features: MusicFeatures | null = null;
  private sinceApply = 0;
  /** State and Depth's moves round their scene values, and when the next is due (beats, or seconds without a beat). */
  private readonly moveState = new Move();
  private readonly moveDepth = new Move();
  private nextMoveBeat = 0;
  private nextMoveAt = 0;
  /** After a gesture, the move that brings it back is due sooner. */
  private returning = false;
  private readonly value: Record<SliderId, number> = {
    state: 0,
    depth: 0.5,
    spin: 0,
    orbit: 3 / 8,
    mforce: 0.5,
  };
  /** `mode` is the look's physics: gas or water, or attract / repel (a pole over either). */
  private readonly chosen: Record<OptionGroup, string> = { mode: '', shape: '', moon: '', pole: '' };
  private readonly touched = new Map<string, number>();
  /** The director's clock: real time less the silences, so nothing it's timing runs on while it waits. */
  private now = 0;
  private silentFor = 0;
  private bpm = 0;

  constructor(private readonly controls: DirectorControls) {}

  /** Starts from where the controls are now, so switching on doesn't jump. */
  start(current: Record<SliderId, number>): void {
    Object.assign(this.value, current);
    this.chosen.mode = this.chosen.shape = this.chosen.moon = this.chosen.pole = '';
    this.lookScene = null;
    this.lookBeats = 0;
    this.nextMoveBeat = 0;
    this.nextMoveAt = 0;
    // Pan from wherever the shape sits now; the first angle a little after starting.
    this.pan.start = -Infinity;
    this.nextAngleAt = 0;
    this.sweeping = false;
    this.enabled = true;
  }

  /** The performer moved a control: hand it to them for a while. */
  touch(control: string): void {
    this.touched.set(control, this.now);
  }

  /** Whether the director has `control` (the performer hasn't touched it lately). */
  holds(control: string): boolean {
    return this.free(control);
  }

  /**
   * @param bpm the transport's tempo (0 when there's none)
   * @param playing whether there's music: without it the director holds everything where it is (no moves,
   *   looks, pans or turns) and its clock stops, so it picks up where it left off when the music comes in.
   */
  update(f: MusicFeatures, dt: number, now: number, bpm = 0, playing = true): void {
    this.bpm = bpm;
    if (!playing && this.enabled) this.silentFor += dt;
    this.now = now - this.silentFor;
    if (!this.enabled || !playing) return;
    now = this.now;
    this.readScene(f, dt, now);
    const look = this.look(f);
    this.current = look;
    this.features = f;
    const k = 1 - Math.exp(-dt / look.glide);
    for (const id of Object.keys(this.value) as SliderId[]) this.value[id] += (look[id] - this.value[id]) * k;
    this.panStep();
    this.angleStep(f);
    this.sinceApply += dt;
    if (this.sinceApply >= 1 / APPLY_RATE) {
      this.sinceApply = 0;
      for (const id of Object.keys(this.value) as SliderId[]) {
        let v = this.value[id];
        if (id === 'state') {
          // (A drop stays tight: there, moves only ever tighten.)
          const move = this.moveState.at(now);
          v = Math.min(1, Math.max(0, v + (this.scene === 'drop' ? Math.min(0, move) : move)));
        }
        if (id === 'depth') {
          // Deep stays for strong kicks: a move can't carry Depth there on its own, nor out of it.
          if (v < DEEP_FROM) v = Math.min(DEEP_FROM, Math.max(0, v + this.moveDepth.at(now)));
        }
        if (this.free(id)) this.controls.setSlider(id, v);
      }
    }
    // A new scene that doesn't suit the current look changes it at once; ambient music changes on its own clock.
    const suits = look.modes.includes(this.chosen.mode) && look.shapes.includes(this.chosen.shape);
    const beat = f.kickRate >= BEAT_RATE;
    // Without a beat, moves come on a clock (slower, as the music drifts).
    if (!beat && now >= this.nextMoveAt) {
      this.planMove(MOVE_SECONDS[0] + Math.random() * (MOVE_SECONDS[1] - MOVE_SECONDS[0]), 0.5, false);
      this.nextMoveAt = now + MOVE_SECONDS[0] + Math.random() * (MOVE_SECONDS[1] - MOVE_SECONDS[0]);
    }
    if (this.lookScene !== this.scene && !suits) this.changeLook();
    else if (!beat && now - this.lookAt > AMBIENT_EVERY) this.changeLook();
    else if (!beat && now - this.lookAt > AMBIENT_MIN && this.energyShifted()) this.changeLook();
  }

  /** A beat from the transport: every 12–32 bars (or on an energy shift) the look moves on. */
  beat(): void {
    if (!this.enabled || !this.current) return;
    this.beats++;
    this.lookBeats++;
    const bar = this.lookBeats % 4 === 0;
    if (this.beats % 4 === 0 && this.beats >= this.nextMoveBeat) {
      // A new move on the bar: sooner and livelier when the energy is up.
      const f = this.features;
      const e = f ? Math.min(1, f.energy / Math.max(0.2, f.baseline * 1.4)) : 0.5;
      const barSeconds = (4 * 60) / (this.bpm || 120);
      const gesture = this.planMove(barSeconds * (1 + Math.floor(Math.random() * 4)), 0.6 + 0.4 * e);
      const bars = gesture
        ? 1 + Math.floor(Math.random() * 2)
        : Math.round(MOVE_BARS[1] - (MOVE_BARS[1] - MOVE_BARS[0]) * e * Math.random());
      this.nextMoveBeat = this.beats + 4 * bars;
      this.nextMoveAt = this.now + bars * barSeconds;
    }
    if (
      this.lookBeats >= this.nextLook ||
      (bar && this.lookBeats >= SHIFT_MIN_BARS * 4 && this.energyShifted())
    )
      this.changeLook();
  }

  /**
   * Starts the next move for State and Depth, easing over `seconds`; `reach` (0–1) scales how far.
   * Returns whether it's a gesture (a hard sweep that the next move brings back; only with a beat).
   */
  private planMove(seconds: number, reach: number, gestures = true): boolean {
    const span = (k: number): number => (Math.random() * 2 - 1) * k * reach;
    let gesture = false;
    let state: number;
    if (this.returning) {
      // Back from a sweep, toward the scene's own value.
      state = span(MOVE_STATE * 0.4);
      this.returning = false;
    } else if (gestures && Math.random() < GESTURE) {
      // A sweep: hard toward whichever end is further from where State sits.
      const base = this.value.state;
      state = (base < 0.5 ? 1 : -1) * GESTURE_STATE * (0.7 + 0.3 * reach);
      gesture = this.returning = true;
    } else state = span(MOVE_STATE);
    this.moveState.go(this.now, state, gesture ? seconds * 0.5 : seconds);
    this.moveDepth.go(this.now, span(MOVE_DEPTH), seconds);
    return gesture;
  }

  /** Slow pans: over each PAN_BARS the shape eases to a new spot on screen. */
  private panStep(): void {
    const p = this.pan;
    const t = (this.now - p.start) / p.length;
    if (t >= 1) {
      p.fromX = p.toX;
      p.fromY = p.toY;
      p.toX = (Math.random() * 2 - 1) * PAN_X;
      p.toY = (Math.random() * 2 - 1) * PAN_Y;
      p.start = this.now;
      p.length = (PAN_BARS * 4 * 60) / (this.bpm || 100);
      return;
    }
    const e = t * t * (3 - 2 * t);
    this.controls.pan(p.fromX + (p.toX - p.fromX) * e, p.fromY + (p.toY - p.fromY) * e);
  }

  /**
   * The view's angle: now and then a new one, glided to gradually; the odd sweep toward side on, which
   * the next move brings back. (Not while the performer has the view.)
   */
  private angleStep(f: MusicFeatures): void {
    if (this.now < this.nextAngleAt) return;
    const beat = f.kickRate >= BEAT_RATE;
    const bar = (4 * 60) / (this.bpm || 120);
    const pick = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);
    const every = beat ? Math.round(pick(ANGLE_BARS) / 4) * 4 * bar : pick(ANGLE_SECONDS);
    const side = Math.random() < 0.5 ? -1 : 1;
    let yaw: number;
    let pitch: number;
    let rates = ANGLE_RATES;
    if (!this.sweeping && Math.random() < ANGLE_SWEEP) {
      yaw = side * ANGLE_SIDE * (0.85 + 0.15 * Math.random());
      pitch = (Math.random() * 2 - 1) * ANGLE_PITCH * 0.4;
      rates = SWEEP_RATES;
      this.sweeping = true;
    } else if (this.sweeping || Math.random() < ANGLE_STRAIGHT) {
      if (this.sweeping) rates = SWEEP_RATES;
      yaw = this.sweeping ? side * ANGLE_YAW * 0.3 * Math.random() : 0;
      pitch = 0;
      this.sweeping = false;
    } else {
      yaw = side * ANGLE_YAW * (0.3 + 0.7 * Math.random());
      pitch = (Math.random() * 2 - 1) * ANGLE_PITCH;
    }
    // At a Spin speed: as long as a turn of this size takes at one turn per `rate` bars.
    const rate = rates[Math.floor(Math.random() * rates.length)];
    const turn = Math.hypot(yaw - this.aimYaw, pitch - this.aimPitch);
    const seconds = Math.max(0.4, (turn / (2 * Math.PI)) * rate * bar);
    this.nextAngleAt =
      this.now + (this.sweeping ? seconds + pick(SWEEP_HOLD_BARS) * bar : Math.max(every, seconds + bar));
    if (!this.free('view')) return;
    this.controls.aim(yaw, pitch, seconds);
    this.aimYaw = yaw;
    this.aimPitch = pitch;
  }

  /**
   * Spin and moon orbit for the new look. With a kick: near the tempo-suited speed, a step either way.
   * Without one, or with little energy: anywhere in the range, to keep things exploring. The disc stays at
   * or under half speed; the globe can go faster, and to full only rarely, on a strong drop.
   */
  private pickSpeeds(f: MusicFeatures, globe: boolean): void {
    const kick = f.kickRate >= BEAT_RATE;
    const e = Math.min(1, f.energy / Math.max(0.2, f.baseline * 1.4));
    // Disc at most half speed; the globe usually up to a bar a turn, now and then ½ bar in a groove or a
    // drop, and a beat a turn only rarely, in a drop.
    const hot = this.scene === 'groove' || this.scene === 'drop';
    const top = !globe
      ? 4
      : hot && Math.random() < FAST_SPIN_CHANCE
        ? this.scene === 'drop' && Math.random() < FASTEST_SPIN_SHARE
          ? 8
          : 7
        : 6;
    const step = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo + 1));
    const suited = spinIndex(this.bpm);
    const explore = !kick || e < 0.4;
    this.spinStep = Math.min(top, explore ? step(1, top) : Math.max(1, suited + step(-1, 1)));
    this.orbitStep = explore ? step(1, 6) : Math.min(7, Math.max(1, suited - 1 + step(-1, 1)));
  }

  private energyShifted(): boolean {
    const f = this.features;
    return !!f && Math.abs(f.energy - this.lookEnergy) > ENERGY_SHIFT * Math.max(0.2, f.baseline);
  }

  /** Moves to another physics mode and shape that suit the scene (never the same pair twice running). */
  private changeLook(): void {
    const look = this.current;
    const f = this.features;
    if (!look || !f) return;
    const pick = (options: readonly string[], now: string): string => {
      const others = options.filter((o) => o !== now);
      return others.length ? others[Math.floor(Math.random() * others.length)] : options[0];
    };
    // The moon comes and goes at random, but only here, on the music's own changes.
    const moon = Math.random() < look.moon ? 'on' : 'off';
    this.choose('moon', moon);
    // Attract and repel are poles for the moon: without it, only gas and liquid.
    const modes = moon === 'on' ? look.modes : look.modes.filter((m) => m !== 'attract' && m !== 'repel');
    this.choosePhysics(pick(modes.length ? modes : ['water', 'gas'], this.chosen.mode), look.modes);
    const shape = pick(look.shapes, this.chosen.shape);
    this.choose('shape', shape);
    this.pickSpeeds(f, shape === 'globe' || (this.chosen.shape === 'globe' && !this.free('shape')));
    this.lookBeats = 0;
    this.nextLook =
      4 *
      lookBars(
        this.features ? Math.min(1, this.features.energy / Math.max(0.2, this.features.baseline * 1.4)) : 0.5,
      );
    this.lookAt = this.now;
    this.lookScene = this.scene;
    this.lookEnergy = this.features?.energy ?? 0;
  }

  private readScene(f: MusicFeatures, dt: number, now: number): void {
    const beat = f.kickRate >= BEAT_RATE;
    if (beat) this.lastBeatAt = now;
    if (f.kickRate < NO_BEAT_RATE) this.lastQuietAt = now;
    let next: Scene;
    if (beat && now - this.lastQuietAt < 6 && f.energy > f.baseline * 1.02 && this.scene !== 'drop')
      next = 'drop';
    else if (this.scene === 'drop' && this.sceneFor < 10 && beat) next = 'drop';
    else if (f.rise > 0.25 && f.energy > 0.15 && (!beat || f.rise > 0.4)) next = 'build';
    else if (beat) next = 'groove';
    else if (now - this.lastBeatAt < 30) next = 'breakdown';
    else next = 'drift';

    this.sceneFor += dt;
    if (next === this.candidate) this.candidateFor += dt;
    else {
      this.candidate = next;
      this.candidateFor = 0;
    }
    const take = next === 'drop' ? next !== this.scene : this.candidateFor >= SETTLE && next !== this.scene;
    if (take) {
      if (next === 'drop') this.controls.fire(1.6 + f.kickStrength);
      this.scene = next;
      this.sceneFor = 0;
    }
  }

  /** The look for the current scene, shaded by the music's energy and brightness. */
  private look(f: MusicFeatures): Look {
    const e = Math.min(1, f.energy / Math.max(0.2, f.baseline * 1.4));
    // How ambient it is: no kick, few hats, quieter than usual. Ambient passages open up looser.
    const ambience =
      0.5 * (1 - Math.min(1, f.kickRate / 1.5)) + 0.25 * (1 - Math.min(1, f.hatRate / 4)) + 0.25 * (1 - e);
    // Spin to the tempo: with the kick driving, about one turn every SPIN_SECONDS; without it, slower
    // divisions of that same speed so it stays in time.
    // Slow, unsynchronised cycles (0–1) that keep loose, kickless passages moving without looping.
    const t = this.now;
    const wander =
      0.5 + 0.3 * Math.sin((t / 23) * 2 * Math.PI) + 0.2 * Math.sin((t / 37) * 2 * Math.PI + 1.3);
    const wander2 =
      0.5 + 0.3 * Math.sin((t / 29) * 2 * Math.PI + 2.1) + 0.2 * Math.sin((t / 47) * 2 * Math.PI);
    const swell = Math.max(0, f.rise);
    // Depth's deep end (past 0.75 on the slider) is kept for a strong, present kick.
    const strongKick =
      f.kickRate >= BEAT_RATE
        ? Math.min(1, Math.max(0, (f.kickStrength - STRONG_KICK[0]) / (STRONG_KICK[1] - STRONG_KICK[0])))
        : 0;
    const bright = f.brightness;
    const through = Math.min(1, this.sceneFor / 16); // how far into the scene (builds ramp with it)
    switch (this.scene) {
      case 'drift':
        // Ambient: well into Loose, wandering on slow cycles and opening further as the music swells;
        // brighter tones bring the moon's pull up.
        return {
          state: 0.6 + 0.3 * wander + 0.1 * swell,
          depth: 0.25,
          spin: this.spinStep / 8,
          orbit: this.orbitStep / 8,
          mforce: 0.25 + 0.3 * bright + 0.35 * wander2,
          modes: ['water', 'gas', 'attract'],
          shapes: ['globe', 'disc'],
          moon: 0.5,
          glide: 4,
        };
      case 'groove':
        return {
          state: 0.05 + 0.45 * e + 0.25 * ambience,
          depth: 0.45 + 0.2 * Math.min(1, f.kickStrength) + DEEP * strongKick,
          spin: this.spinStep / 8,
          orbit: this.orbitStep / 8,
          mforce: 0.5,
          // Anything goes in a groove; brighter music leans to the more agitated modes.
          modes: bright > 0.55 ? ['gas', 'repel', 'attract', 'water'] : ['water', 'attract', 'gas', 'repel'],
          shapes: ['disc', 'globe'],
          moon: 0.6,
          glide: 2,
        };
      case 'build':
        // Gathering: tightening, deepening and spinning faster the longer it builds.
        return {
          state: 0.35 * (1 - through) + 0.05,
          depth: 0.4 + 0.25 * through,
          spin: this.spinStep / 8,
          orbit: this.orbitStep / 8,
          mforce: 0.6 + 0.3 * through,
          modes: ['attract', 'water'],
          shapes: ['disc', 'globe'],
          moon: 0.7,
          glide: 1.5,
        };
      case 'drop':
        // Tight, deep and pumping on every kick.
        return {
          state: 0,
          // Deep only when the kick behind it is strong.
          depth: 0.6 + (0.95 - 0.6) * strongKick,
          spin: this.spinStep / 8,
          orbit: this.orbitStep / 8,
          mforce: 0.5,
          modes: ['gas', 'repel'],
          shapes: ['disc', 'globe'],
          moon: 0.8,
          glide: 0.3,
        };
      case 'breakdown':
        return {
          state: 0.55 + 0.3 * wander + 0.1 * swell,
          depth: 0.25,
          spin: this.spinStep / 8,
          orbit: this.orbitStep / 8,
          mforce: 0.3 + 0.4 * wander2,
          modes: ['water', 'gas', 'attract'],
          shapes: ['disc', 'globe'],
          moon: 0.35,
          glide: 3,
        };
    }
  }

  /**
   * Attract and repel are poles over gas or liquid: a pole look turns that pole on (over one of the
   * look's base modes, or either), a gas or liquid look turns any pole off.
   */
  private choosePhysics(id: string, options: readonly string[]): void {
    if (this.chosen.mode === id) return;
    this.chosen.mode = id;
    const isPole = id === 'attract' || id === 'repel';
    this.choose('pole', isPole ? id : 'off');
    const bases = options.filter((m) => m === 'gas' || m === 'water');
    const from = bases.length ? bases : ['gas', 'water'];
    const base = isPole ? from[Math.floor(Math.random() * from.length)] : id;
    // (`chosen.mode` holds the look, so the base mode is set directly.)
    if (this.free('mode')) this.controls.setOption('mode', base);
  }

  private choose(group: OptionGroup, id: string): void {
    if (this.chosen[group] === id || !this.free(group)) return;
    this.chosen[group] = id;
    this.controls.setOption(group, id);
  }

  private free(control: string): boolean {
    const at = this.touched.get(control);
    return at === undefined || this.now - at > HAND_BACK;
  }
}
