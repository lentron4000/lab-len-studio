// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/** Musical lengths for one revolution (spin) or one orbit (moon), indexed by slider position. */
export const DIVISIONS: readonly { bars: number; label: string }[] = [
  { bars: 0, label: 'Stopped' },
  { bars: 32, label: '32 bars' },
  { bars: 16, label: '16 bars' },
  { bars: 8, label: '8 bars' },
  { bars: 4, label: '4 bars' },
  { bars: 2, label: '2 bars' },
  { bars: 1, label: '1 bar' },
  { bars: 0.5, label: '½ bar' },
  { bars: 0.25, label: '1 beat' },
];

const BEATS_PER_BAR = 4;

/** Seconds for `bars` at `bpm`; 0 when stopped. */
export function divisionSeconds(bars: number, bpm: number): number {
  return bars ? (bars * BEATS_PER_BAR * 60) / bpm : 0;
}

/** Angular speed in radians per simulation step (60 steps/s) for one turn per `bars`. */
export function angularStep(bars: number, bpm: number): number {
  return bars ? (2 * Math.PI) / divisionSeconds(bars, bpm) / 60 : 0;
}
