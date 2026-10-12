// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { BLAST_MAX } from '../sim/simulation';

/** Velocities below this read as the lightest touch, and above TOP as the hardest. */
const BOTTOM = 10;
const TOP = 120;

/**
 * MIDI velocity (1–127) → touch (0–1). Keys and pads rarely send the extremes, so the usable
 * range is stretched to fill 0–1.
 */
export function touch(velocity: number): number {
  return Math.min(1, Math.max(0, (velocity - BOTTOM) / (TOP - BOTTOM)));
}

/**
 * Touch → hit strength for `Simulation.fire`. Curved so light hits stay gentle: a full kick (1)
 * lands a little past halfway, and the top of the range blasts the shape into vapor (BLAST_MAX).
 */
export function hitStrength(t: number): number {
  return 0.1 + (BLAST_MAX - 0.1) * t ** 2.2;
}
