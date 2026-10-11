// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { lerp } from '../lib/math';
import { angularStep } from './divisions';
import {
  assignByAngle,
  FORMATIONS,
  great,
  samplePoints,
  strokeLength,
  type Formation,
  type FormationId,
} from './formations';

/** Steps (1/60 s) for the eye to open, and between blinks. */
const EYE_OPEN_STEPS = 40;
const BLINK_EVERY = 6 * 60;
const BLINK_STEPS = 14;
/** Drawn size at the lightest and hardest touch, as a fraction of the full formation. */
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.08;
/** Fade back to the physics after release, per step: a soft key lingers (~3 s), a hard one lets go (~0.6 s). */
const RELEASE_SOFT = 0.006;
const RELEASE_HARD = 0.03;
/** Intensity follows its input over a few frames, so a knob or pressure doesn't step. */
const INTENSITY_FOLLOW = 0.15;

interface Layer {
  formation: Formation;
  /** Drawn size: harder keys draw the shape larger. */
  scale: number;
  angle: number;
  /** Steps since summoned. */
  age: number;
}

/**
 * Pulls the particles into formations while keys are held. Each held key is a layer; layers share
 * the particles in proportion to their stroke length, so two keys draw two shapes at once (a
 * circle round a pentagram). On release the weight fades and the physics takes the shape apart.
 *
 * Targets are in unit coordinates (radius 1, y down); the simulation scales them to the shape.
 */
export class Summoning {
  /** 0–1: how strongly particles are held to their targets. */
  weight = 0;
  /** Spring stiffness at full weight; harder keys hold tighter. */
  strength = 0.05;
  /**
   * 0–1: how hard the held seal burns (glow, tremble, swell). Follows the larger of `knob` (the
   * Intensity control) and `pressure` (aftertouch, if the controller sends it).
   */
  intensity = 0;
  knob = 0;
  pressure = 0;
  /** Per particle: current target, after turning and blinking. */
  readonly tx: Float32Array;
  readonly ty: Float32Array;

  private readonly held = new Map<string, { id: FormationId; great: boolean; velocity: number }>();
  private layers: Layer[] = [];
  private base = new Float32Array(0);
  private layerOf = new Uint8Array(0);
  private rise = 0.04;
  private fall = RELEASE_SOFT;

  constructor(private readonly count: number) {
    this.tx = new Float32Array(count);
    this.ty = new Float32Array(count);
  }

  get active(): boolean {
    return this.held.size > 0;
  }

  /** Names of what's held, for a readout. */
  get names(): string[] {
    return this.layers.map((l) => l.formation.name);
  }

  /**
   * A key went down. `source` identifies it (so its release can be matched); velocity 0–1 sets how
   * fast and hard the particles rush in. `px`/`py` are particle offsets from the centre, in radii.
   */
  hold(
    source: string,
    id: FormationId,
    isGreat: boolean,
    velocity: number,
    px: Float32Array,
    py: Float32Array,
  ): void {
    this.held.set(source, { id, great: isGreat, velocity });
    this.rise = lerp(0.02, 0.1, velocity);
    this.strength = lerp(0.03, 0.08, velocity);
    this.rebuild(px, py);
  }

  /**
   * A key came up. Returns its velocity if it was the last key held (the formation now fades, at a
   * rate set by how hard it was struck), or null if other keys are still holding a shape.
   */
  release(source: string, px: Float32Array, py: Float32Array): number | null {
    const key = this.held.get(source);
    if (!key) return null;
    this.held.delete(source);
    // Another key still down: re-form into what's left. Otherwise keep the shape and let it fade.
    if (this.held.size > 0) {
      this.rebuild(px, py);
      return null;
    }
    this.fall = lerp(RELEASE_SOFT, RELEASE_HARD, key.velocity);
    this.pressure = 0;
    return key.velocity;
  }

  releaseAll(): void {
    this.held.clear();
    this.pressure = 0;
  }

  /** Advances one step: fades the weight and moves the targets (turning, blinking). */
  step(bpm: number): void {
    const goal = this.held.size > 0 ? 1 : 0;
    this.weight += (goal - this.weight) * (goal ? this.rise : this.fall);
    this.intensity += (Math.max(this.knob, this.pressure) - this.intensity) * INTENSITY_FOLLOW;
    if (this.weight < 1e-3 && !goal) {
      this.weight = 0;
      return;
    }
    const turns = this.layers.map((l) => {
      l.age++;
      if (l.formation.turnBars) l.angle += angularStep(l.formation.turnBars, bpm);
      return {
        cos: Math.cos(l.angle) * l.scale,
        sin: Math.sin(l.angle) * l.scale,
        open: l.formation.blinks ? eyeOpen(l.age) : 1,
      };
    });
    for (let i = 0; i < this.count; i++) {
      const t = turns[this.layerOf[i]];
      const x = this.base[i * 2];
      const y = this.base[i * 2 + 1];
      this.tx[i] = x * t.cos - y * t.sin;
      this.ty[i] = (x * t.sin + y * t.cos) * t.open;
    }
  }

  private rebuild(px: Float32Array, py: Float32Array): void {
    const previous = new Map(this.layers.map((l) => [l.formation.name, l]));
    this.layers = [...this.held.values()].map(({ id, great: g, velocity }) => {
      const formation = g ? great(id) : FORMATIONS[id];
      const scale = lerp(MIN_SCALE, MAX_SCALE, velocity);
      // A shape that was already up keeps its turn and age, so adding a second key doesn't reset it.
      const kept = previous.get(formation.name);
      return kept ? { ...kept, scale } : { formation, scale, angle: 0, age: 0 };
    });
    const lengths = this.layers.map((l) => l.formation.strokes.reduce((sum, s) => sum + strokeLength(s), 0));
    const total = lengths.reduce((a, b) => a + b, 0);
    const points = new Float32Array(this.count * 2);
    const layerOf = new Uint8Array(this.count);
    let offset = 0;
    this.layers.forEach((layer, k) => {
      const n =
        k === this.layers.length - 1 ? this.count - offset : Math.round((this.count * lengths[k]) / total);
      points.set(samplePoints(layer.formation.strokes, n), offset * 2);
      layerOf.fill(k, offset, offset + n);
      offset += n;
    });
    const order = assignByAngle(px, py, points);
    this.base = new Float32Array(this.count * 2);
    this.layerOf = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const j = order[i];
      this.base[i * 2] = points[j * 2];
      this.base[i * 2 + 1] = points[j * 2 + 1];
      this.layerOf[i] = layerOf[j];
    }
  }
}

/** Eye lids: open over EYE_OPEN_STEPS after summoning, then a quick blink every few seconds. */
function eyeOpen(age: number): number {
  const opening = Math.min(1, age / EYE_OPEN_STEPS);
  const eased = opening * opening * (3 - 2 * opening);
  const phase = age % BLINK_EVERY;
  const blink = age > BLINK_EVERY && phase < BLINK_STEPS ? Math.sin((Math.PI * phase) / BLINK_STEPS) : 0;
  return Math.max(0.04, eased * (1 - blink));
}
