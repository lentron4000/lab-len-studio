// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { MusicFeatures } from './listener';

/** What the music is doing, in broad strokes. */
export type Scene = 'drift' | 'groove' | 'build' | 'drop' | 'breakdown';

/** A slider the director plays (0–1 across its range) or a set of options it picks from. */
type SliderId = 'state' | 'depth' | 'spin' | 'mforce';
type OptionGroup = 'mode' | 'shape' | 'moon';

/** Where the director wants things, per scene. Sliders 0–1 across their range. */
interface Look {
  state: number;
  depth: number;
  spin: number;
  mforce: number;
  /** Physics modes and shapes that suit the scene; the director moves between them. */
  modes: readonly string[];
  shapes: readonly string[];
  /** Chance the moon is on after each look change. */
  moon: number;
  /** Seconds to glide to these values. */
  glide: number;
  /** How far State swings open on each beat (0 for none), on top of the glide. */
  swing: number;
}

/** Kicks per second at which the music counts as having a beat. */
const BEAT_RATE = 0.9;
/** Below this, the beat has gone. */
const NO_BEAT_RATE = 0.4;
/** A new scene must hold this long before it's taken (a drop is taken at once). */
const SETTLE = 2.5;
/**
 * Looks (physics mode and shape) change every LOOK_BEATS beats (4 bars) with a beat, or at the next bar
 * when the energy shifts by ENERGY_SHIFT of the track's norm; without a beat, on an energy shift (at
 * least AMBIENT_MIN s apart) or every AMBIENT_EVERY s.
 */
const LOOK_BEATS = 16;
const ENERGY_SHIFT = 0.25;
const AMBIENT_MIN = 6;
const AMBIENT_EVERY = 30;
/** How fast a beat's State swing closes again (s), and how much harder the bar's first beat swings. */
const SWING_TAU = 0.2;
const ACCENT = 1.4;
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

/** Physical controls the director moves. Sliders take a 0–1 value; options an id. */
export interface DirectorControls {
  setSlider(id: SliderId, value01: number): void;
  setOption(group: OptionGroup, id: string): void;
  /** A big hit (the drop). */
  fire(strength: number): void;
}

/**
 * AI mode. Reads the music as one of five scenes and plays the controls the way a performer might:
 * drifting and loose through ambient passages, locked to the groove when the kick is in, tightening
 * and gathering through a build, pumping on the drop, letting go in the breakdown. Brightness and
 * energy shade every scene. Sliders glide, and with a beat State swings open on every beat; the look
 * (physics mode and shape) moves on every four bars or when the energy shifts. Anything the performer
 * touches is theirs for a while.
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
  private beats = 0;
  private lookEnergy = 0;
  private lookAt = -Infinity;
  private lookScene: Scene | null = null;
  private swing = 0;
  private current: Look | null = null;
  private features: MusicFeatures | null = null;
  private sinceApply = 0;
  private readonly value: Record<SliderId, number> = { state: 0, depth: 0.5, spin: 0, mforce: 0.5 };
  private readonly chosen: Record<OptionGroup, string> = { mode: '', shape: '', moon: '' };
  private readonly touched = new Map<string, number>();
  private now = 0;
  private bpm = 0;

  constructor(private readonly controls: DirectorControls) {}

  /** Starts from where the controls are now, so switching on doesn't jump. */
  start(current: Record<SliderId, number>): void {
    Object.assign(this.value, current);
    this.chosen.mode = this.chosen.shape = this.chosen.moon = '';
    this.lookScene = null;
    this.lookBeats = 0;
    this.enabled = true;
  }

  /** The performer moved a control: hand it to them for a while. */
  touch(control: string): void {
    this.touched.set(control, this.now);
  }

  /** @param bpm the transport's tempo (0 when there's none) */
  update(f: MusicFeatures, dt: number, now: number, bpm = 0): void {
    this.bpm = bpm;
    this.now = now;
    if (!this.enabled) return;
    this.readScene(f, dt, now);
    const look = this.look(f);
    this.current = look;
    this.features = f;
    const k = 1 - Math.exp(-dt / look.glide);
    for (const id of Object.keys(this.value) as SliderId[]) this.value[id] += (look[id] - this.value[id]) * k;
    this.swing *= Math.exp(-dt / SWING_TAU);
    this.sinceApply += dt;
    if (this.sinceApply >= 1 / APPLY_RATE) {
      this.sinceApply = 0;
      for (const id of Object.keys(this.value) as SliderId[]) {
        const v = id === 'state' ? Math.min(1, this.value.state + this.swing) : this.value[id];
        if (this.free(id)) this.controls.setSlider(id, v);
      }
    }
    // A new scene that doesn't suit the current look changes it at once; ambient music changes on its own clock.
    const suits = look.modes.includes(this.chosen.mode) && look.shapes.includes(this.chosen.shape);
    const beat = f.kickRate >= BEAT_RATE;
    if (this.lookScene !== this.scene && !suits) this.changeLook();
    else if (!beat && now - this.lookAt > AMBIENT_EVERY) this.changeLook();
    else if (!beat && now - this.lookAt > AMBIENT_MIN && this.energyShifted()) this.changeLook();
  }

  /** A beat from the transport: State swings with it, and every four bars (or on an energy shift) the look moves on. */
  beat(): void {
    if (!this.enabled || !this.current) return;
    this.beats++;
    this.lookBeats++;
    const accent = this.beats % 4 === 1;
    this.swing = Math.max(this.swing, this.current.swing * (accent ? ACCENT : 1));
    const bar = this.lookBeats % 4 === 0;
    if (this.lookBeats >= LOOK_BEATS || (bar && this.lookBeats >= 4 && this.energyShifted()))
      this.changeLook();
  }

  private energyShifted(): boolean {
    const f = this.features;
    return !!f && Math.abs(f.energy - this.lookEnergy) > ENERGY_SHIFT * Math.max(0.2, f.baseline);
  }

  /** Moves to another physics mode and shape that suit the scene (never the same pair twice running). */
  private changeLook(): void {
    const look = this.current;
    if (!look) return;
    const pick = (options: readonly string[], now: string): string => {
      const others = options.filter((o) => o !== now);
      return others.length ? others[Math.floor(Math.random() * others.length)] : options[0];
    };
    this.choose('mode', pick(look.modes, this.chosen.mode));
    this.choose('shape', pick(look.shapes, this.chosen.shape));
    // The moon comes and goes at random, but only here, on the music's own changes.
    this.choose('moon', Math.random() < look.moon ? 'on' : 'off');
    this.lookBeats = 0;
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
    const kickSpin = spinIndex(this.bpm);
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
    const spin = (slower: number): number => Math.max(1, kickSpin - slower) / 8;
    const bright = f.brightness;
    const through = Math.min(1, this.sceneFor / 16); // how far into the scene (builds ramp with it)
    switch (this.scene) {
      case 'drift':
        // Ambient: well into Loose, wandering on slow cycles and opening further as the music swells;
        // brighter tones bring the moon's pull up.
        return {
          state: 0.6 + 0.3 * wander + 0.1 * swell,
          depth: 0.25,
          spin: spin(3),
          mforce: 0.25 + 0.3 * bright + 0.35 * wander2,
          modes: ['water', 'gas', 'attract'],
          shapes: ['globe', 'disc'],
          moon: 0.5,
          glide: 4,
          swing: 0,
        };
      case 'groove':
        return {
          state: 0.05 + 0.3 * e + 0.2 * ambience,
          depth: 0.45 + 0.2 * Math.min(1, f.kickStrength) + DEEP * strongKick,
          spin: spin(0),
          mforce: 0.5,
          // Anything goes in a groove; brighter music leans to the more agitated modes.
          modes: bright > 0.55 ? ['gas', 'repel', 'attract', 'water'] : ['water', 'attract', 'gas', 'repel'],
          shapes: ['disc', 'globe'],
          moon: 0.6,
          glide: 2,
          swing: 0.18 * (0.5 + 0.5 * e),
        };
      case 'build':
        // Gathering: tightening, deepening and spinning faster the longer it builds.
        return {
          state: 0.35 * (1 - through) + 0.05,
          depth: 0.4 + 0.25 * through,
          spin: spin(through < 0.5 ? 2 : through < 0.9 ? 1 : 0),
          mforce: 0.6 + 0.3 * through,
          modes: ['attract', 'water'],
          shapes: ['disc', 'globe'],
          moon: 0.7,
          glide: 1.5,
          swing: 0.15 * through,
        };
      case 'drop':
        // Tight, deep and pumping on every kick.
        return {
          state: 0,
          // Deep only when the kick behind it is strong.
          depth: 0.6 + (0.95 - 0.6) * strongKick,
          spin: spin(0),
          mforce: 0.5,
          modes: ['gas', 'repel'],
          shapes: ['disc', 'globe'],
          moon: 0.8,
          glide: 0.3,
          swing: 0.3,
        };
      case 'breakdown':
        return {
          state: 0.55 + 0.3 * wander + 0.1 * swell,
          depth: 0.25,
          spin: spin(2),
          mforce: 0.3 + 0.4 * wander2,
          modes: ['water', 'gas', 'attract'],
          shapes: ['disc', 'globe'],
          moon: 0.35,
          glide: 3,
          swing: 0,
        };
    }
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
