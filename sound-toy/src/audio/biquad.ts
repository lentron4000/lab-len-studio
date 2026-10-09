// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/** Second-order IIR section, Direct Form I, with coefficients normalised by a0. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

/** Low- or high-pass biquad from the RBJ Audio EQ Cookbook. */
export function createBiquad(
  type: 'lowpass' | 'highpass',
  freq: number,
  q: number,
  sampleRate: number,
): Biquad {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const [b0, b1, b2] =
    type === 'lowpass' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

export function biquadStep(f: Biquad, x: number): number {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}
