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
  mode: string;
  shape: string;
  moon: string;
  /** Seconds to glide to these values. */
  glide: number;
}

/** Kicks per second at which the music counts as having a beat. */
const BEAT_RATE = 0.9;
/** Below this, the beat has gone. */
const NO_BEAT_RATE = 0.4;
/** A new scene must hold this long before it's taken (a drop is taken at once). */
const SETTLE = 2.5;
/** At least this long between physics-mode or shape changes, so it doesn't flicker between looks. */
const MODE_HOLD = 14;
const SHAPE_HOLD = 30;
/** A control the performer touches is theirs for this long. */
const HAND_BACK = 30;
/** Slider updates per second (they glide in between). */
const APPLY_RATE = 15;

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
 * energy shade every scene. Sliders glide; looks only change between scenes. Anything the performer
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
  private modeAt = -Infinity;
  private shapeAt = -Infinity;
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
    const k = 1 - Math.exp(-dt / look.glide);
    for (const id of Object.keys(this.value) as SliderId[]) this.value[id] += (look[id] - this.value[id]) * k;
    this.sinceApply += dt;
    if (this.sinceApply >= 1 / APPLY_RATE) {
      this.sinceApply = 0;
      for (const id of Object.keys(this.value) as SliderId[]) {
        if (this.free(id)) this.controls.setSlider(id, this.value[id]);
      }
    }
    this.choose('moon', look.moon, 0);
    this.choose('mode', look.mode, MODE_HOLD);
    this.choose('shape', look.shape, SHAPE_HOLD);
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
    const spin = (slower: number): number => Math.max(1, kickSpin - slower) / 8;
    const bright = f.brightness;
    const through = Math.min(1, this.sceneFor / 16); // how far into the scene (builds ramp with it)
    switch (this.scene) {
      case 'drift':
        // Ambient: loose and floating, opening as it swells; brighter tones bring the moon closer.
        return {
          state: 0.35 + 0.5 * ambience,
          depth: 0.25,
          spin: spin(3),
          mforce: 0.3 + 0.4 * bright,
          mode: 'water',
          shape: 'globe',
          moon: 'on',
          glide: 4,
        };
      case 'groove':
        return {
          state: 0.05 + 0.3 * e + 0.2 * ambience,
          depth: 0.45 + 0.2 * Math.min(1, f.kickStrength),
          spin: spin(0),
          mforce: 0.5,
          mode: bright > 0.55 ? 'gas' : 'water',
          shape: 'disc',
          moon: 'on',
          glide: 2,
        };
      case 'build':
        // Gathering: tightening, deepening and spinning faster the longer it builds.
        return {
          state: 0.35 * (1 - through) + 0.05,
          depth: 0.5 + 0.3 * through,
          spin: spin(through < 0.5 ? 2 : through < 0.9 ? 1 : 0),
          mforce: 0.6 + 0.3 * through,
          mode: 'attract',
          shape: 'disc',
          moon: 'on',
          glide: 1.5,
        };
      case 'drop':
        // Tight, deep and pumping on every kick.
        return {
          state: 0,
          depth: 0.95,
          spin: spin(0),
          mforce: 0.5,
          mode: 'gas',
          shape: 'disc',
          moon: 'on',
          glide: 0.3,
        };
      case 'breakdown':
        return {
          state: 0.45 + 0.45 * ambience,
          depth: 0.25,
          spin: spin(2),
          mforce: 0.4,
          mode: 'water',
          shape: 'disc',
          moon: 'off',
          glide: 3,
        };
    }
  }

  private choose(group: OptionGroup, id: string, hold: number): void {
    if (this.chosen[group] === id || !this.free(group)) return;
    const at = group === 'mode' ? this.modeAt : group === 'shape' ? this.shapeAt : -Infinity;
    // Looks change only between scenes' early moments (or on the drop), and not too often.
    if (this.chosen[group] && this.now - at < hold && this.scene !== 'drop') return;
    this.chosen[group] = id;
    if (group === 'mode') this.modeAt = this.now;
    if (group === 'shape') this.shapeAt = this.now;
    this.controls.setOption(group, id);
  }

  private free(control: string): boolean {
    const at = this.touched.get(control);
    return at === undefined || this.now - at > HAND_BACK;
  }
}
