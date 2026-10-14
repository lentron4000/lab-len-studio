// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

export type Rgb = readonly [number, number, number];

/** Day: depth bands back to front, so the far side of the globe reads lighter. */
export const DAY_INK = '#111214';
export const DAY_PAPER = '#ffffff';
export const DAY_BANDS = ['#c9cbcf', '#a2a5ab', '#64676d', DAY_INK] as const;

/** Night: day inverted, white on black. Depth bands back to front, so the far side fades into the dark. */
export const DARK_INK = '#ffffff';
export const DARK_PAPER = '#000000';
export const DARK_BANDS = ['#3a3b3e', '#5f6166', '#a3a5aa', DARK_INK] as const;

/** Night: neon, mostly pinks and purples with a little cyan for contrast (last entry). */
export const NEON: readonly Rgb[] = [
  [255, 46, 151],
  [255, 61, 242],
  [190, 70, 255],
  [128, 82, 255],
  [92, 112, 255],
  [45, 226, 255],
];
/**
 * Ritual heat ramp, cold to hot. Particles at rest sit in the first two (blood); stirring them up
 * (excitation) lights them through ember and orange to pale sulphur, like bioluminescence.
 * Drawn on true black: a projector shows any grey as a glowing rectangle.
 */
export const HEAT: readonly Rgb[] = [
  [175, 6, 16],
  [210, 12, 22],
  [232, 22, 24],
  [240, 42, 20],
  [255, 86, 24],
  [255, 150, 48],
  [255, 214, 140],
];
/** Ritual trails read as smoke: the particle's colour mostly lost into warm grey. */
export const SMOKE: readonly Rgb[] = HEAT.map(([r, g, b]) => [
  Math.round(0.3 * r + 0.7 * 96),
  Math.round(0.3 * g + 0.7 * 84),
  Math.round(0.3 * b + 0.7 * 80),
]);
/** Ember colours as they cool: sulphur gold, orange, red. */
export const EMBER: readonly Rgb[] = [
  [255, 200, 64],
  [255, 110, 24],
  [200, 22, 14],
];
export const RITUAL_BLACK = '#000000';
/** Share of particles drawn in the cyan accent. */
export const ACCENT_SHARE = 0.1;
/** Night depth bands: alpha multipliers back to front. */
export const NIGHT_BANDS = [0.2, 0.38, 0.62, 1] as const;
/** Dusk sky, top to bottom. */
export const DUSK: readonly [stop: number, color: string][] = [
  [0, '#0d0820'],
  [0.45, '#1c0f38'],
  [0.78, '#3a1650'],
  [1, '#5e1f55'],
];

export const css = ([r, g, b]: Rgb): string => `rgb(${r},${g},${b})`;

/**
 * A glow sprite per colour: near-white core, saturated halo, soft falloff.
 * Drawn additively, overlapping sprites build toward white the way real light does.
 */
export function createGlowSprites(colours: readonly Rgb[], size = 64): HTMLCanvasElement[] {
  const half = size / 2;
  return colours.map(([r, g, b]) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const tint = (k: number): string =>
      `${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)}`;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, `rgba(${tint(0.6)},1)`);
    grad.addColorStop(0.1, `rgba(${tint(0.15)},0.95)`);
    grad.addColorStop(0.3, `rgba(${r},${g},${b},0.4)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  });
}

/**
 * Ritual sprites: tighter than the night glow, with a hot core only on the hot end of the ramp,
 * so resting particles read as solid red points rather than soft glitter.
 */
export function createHeatSprites(size = 64): HTMLCanvasElement[] {
  const half = size / 2;
  const last = HEAT.length - 1;
  return HEAT.map(([r, g, b], k) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const w = 0.45 * (k / last) ** 2;
    const core = `${Math.round(r + (255 - r) * w)},${Math.round(g + (255 - g) * w)},${Math.round(b + (255 - b) * w)}`;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, `rgba(${core},1)`);
    grad.addColorStop(0.2, `rgba(${r},${g},${b},0.9)`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0.22)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  });
}

/**
 * Colour index per particle: soft regions laid out over the unit sphere (so a spinning globe carries
 * bands of colour), some scatter at region edges, and a sprinkling of the accent.
 */
export function assignColours(sx: Float32Array, sy: Float32Array, sz: Float32Array): Uint8Array {
  const regions = NEON.length - 1;
  const out = new Uint8Array(sx.length);
  for (let i = 0; i < sx.length; i++) {
    const v =
      ((Math.sin(3.1 * sx[i] + 0.4) + Math.sin(2.3 * sy[i] + 1.3) + Math.sin(2.7 * sz[i] + 2.1)) / 3) * 0.5 +
      0.5;
    const k = Math.max(0, Math.min(regions - 1, Math.floor(v * regions + (Math.random() - 0.5) * 1.6)));
    out[i] = Math.random() < ACCENT_SHARE ? regions : k;
  }
  return out;
}
