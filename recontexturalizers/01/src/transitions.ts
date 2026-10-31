// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.

/**
 * Transitions from one quilt to the next, tile by tile: each tile of the screen (a pixel at the
 * current resolution) has an arrival time in the transition (0–1) and turns over to the new quilt from
 * then, over `fade`.
 */
export type Kind = 'colour';

export interface Transition {
  kind: Kind;
  name: string;
  /** Length in seconds. */
  seconds: number;
  /** How long each tile takes to turn over (share of the transition). */
  fade: number;
}

/** The one in use (Space). Colours come in as they are: nothing is tinted or pushed on the way. */
export const TRANSITIONS: readonly Transition[] = [
  { kind: 'colour', name: 'Colour groups', seconds: 2.4, fade: 0.22 },
];

/**
 * Rescales arrival times (in place) so the last tile has fully turned over by the end: arrivals run
 * from 0 to 1 − fade. (Otherwise late tiles would still be turning when it ends, and snap.)
 */
export function fit(arrival: Float32Array, fade: number): Float32Array {
  let max = 0;
  for (const a of arrival) if (a > max) max = a;
  // (A hair under, so single-precision rounding can't leave the last tile a whisker short.)
  const k = max > 0 ? ((1 - fade) * (1 - 1e-5)) / max : 0;
  for (let i = 0; i < arrival.length; i++) arrival[i] *= k;
  return arrival;
}

/** Eases a transition's time in and out (smoothstep), so it gathers pace and slows into the end. */
export function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * How one transition runs (each rolls its own, so no two feel alike). What the flood follows: hue
 * (round the colour wheel) or lightness; which way; where on the wheel it starts; whether greys and
 * whites come last or first; how ragged its fronts are; and a drift across the screen mixed in.
 */
export interface Flavour {
  key: 'hue' | 'light';
  reverse: boolean;
  start: number;
  greysFirst: boolean;
  /** Random spread of each tile's arrival (share of the transition). */
  jitter: number;
  /** A sweep across the screen: its share of each arrival (0: none), and its direction (radians). */
  drift: number;
  angle: number;
}

/** Rolls a transition's flavour. */
export function flavour(random: () => number): Flavour {
  return {
    key: random() < 0.65 ? 'hue' : 'light',
    reverse: random() < 0.5,
    start: random(),
    greysFirst: random() < 0.3,
    jitter: 0.04 + 0.16 * random(),
    drift: random() < 0.5 ? 0 : 0.15 + 0.25 * random(),
    angle: random() * 2 * Math.PI,
  };
}

/** The flavour Colour groups had before it varied: round the wheel from a random hue, greys last. */
const PLAIN: Omit<Flavour, 'start'> = {
  key: 'hue',
  reverse: false,
  greysFirst: false,
  jitter: 0.1,
  drift: 0,
  angle: 0,
};

/**
 * Colour groups: the new quilt floods in one colour family at a time (by hue round the wheel, or by
 * lightness), as its flavour says; greys and whites (little colour to go by) come last, or first.
 * `rgb` is each tile's new colour, `across` × `down` of them (for the drift across the screen).
 */
export function colourGroups(
  rgb: Uint8ClampedArray,
  count: number,
  random: () => number,
  f: Flavour = { ...PLAIN, start: random() },
  across = count,
  down = 1,
): Float32Array {
  const at = new Float32Array(count);
  const cos = Math.cos(f.angle);
  const sin = Math.sin(f.angle);
  // The drift: each tile's place along its direction, 0 to 1 across the screen.
  const reach = Math.abs(cos) * across + Math.abs(sin) * down || 1;
  const from = Math.min(0, cos * across) + Math.min(0, sin * down);
  const span = 1 - f.jitter;
  for (let i = 0; i < count; i++) {
    const r = rgb[i * 4];
    const g = rgb[i * 4 + 1];
    const b = rgb[i * 4 + 2];
    const [h, s] = hueSat(r, g, b);
    let order: number;
    if (f.key === 'light') order = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    else if (s < 0.22) order = f.greysFirst ? 0.1 * random() : 0.9 + 0.1 * random();
    else order = f.greysFirst ? 0.12 + ((h - f.start + 1) % 1) * 0.88 : ((h - f.start + 1) % 1) * 0.86;
    if (f.reverse) order = 1 - order;
    if (f.drift) {
      const x = i % across;
      const y = Math.floor(i / across);
      const along = (x * cos + y * sin - from) / reach;
      order = order * (1 - f.drift) + along * f.drift;
    }
    at[i] = order * span + f.jitter * random();
  }
  return at;
}

/** How far a tile has turned over (0–1) at time t, given its arrival and the transition's fade. */
export function turned(t: number, arrival: number, fade: number): number {
  if (fade <= 0) return t >= arrival ? 1 : 0;
  // Eased in and out (smoothstep): each tile starts and settles softly, rather than at a constant rate.
  const u = Math.min(1, Math.max(0, (t - arrival) / fade));
  return u * u * (3 - 2 * u);
}

/**
 * Evens out arrival times between near neighbours (a box blur of `radius` tiles, in place), so a
 * transition moves in soft fronts rather than as speckle, while still following the colours.
 */
export function soften(arrival: Float32Array, across: number, down: number, radius: number): Float32Array {
  if (radius < 1) return arrival;
  const tmp = new Float32Array(arrival.length);
  // Across, then down; at the edges the window is clipped (averaged over what's there).
  for (let y = 0; y < down; y++) {
    const row = y * across;
    for (let x = 0; x < across; x++) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= across) continue;
        sum += arrival[row + xx];
        count++;
      }
      tmp[row + x] = sum / count;
    }
  }
  for (let x = 0; x < across; x++)
    for (let y = 0; y < down; y++) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= down) continue;
        sum += tmp[yy * across + x];
        count++;
      }
      arrival[y * across + x] = sum / count;
    }
  return arrival;
}

/** Hue (0–1) and saturation (0–1) of an RGB colour. */
function hueSat(r: number, g: number, b: number): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return [0, 0];
  const d = max - min;
  const s = d / max;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s];
}
