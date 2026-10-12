// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

export const TAU = Math.PI * 2;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Standard normal sample (Box–Muller), clipped to ±3σ so no particle lands far outside the shape. */
export function gaussian(random: () => number = Math.random): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v), -3, 3);
}

/**
 * Least-squares slope of `ys` against `xs` (or against 0..n-1 when `xs` is omitted).
 * Used wherever a period has to be measured from noisy timestamps: taps, MIDI clock ticks, matched beats.
 */
export function fitSlope(ys: readonly number[], xs?: readonly number[]): number {
  const n = ys.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs ? xs[i] : i;
    const y = ys[i];
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}

/** Wall-clock time in seconds, on the same base as event timestamps and requestAnimationFrame. */
export const nowSeconds = (): number => performance.now() / 1000;
