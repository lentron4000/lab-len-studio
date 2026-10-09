// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { fitSlope } from '../lib/math';

const MAX_TAPS = 8;
const RESET_AFTER = 2; // seconds without a tap starts a new run
const MIN_TAPS = 3;
const MIN_PERIOD = 0.25; // 240 BPM
const MAX_PERIOD = 1.6; // 37.5 BPM

/** Tap tempo with a least-squares fit over the last eight taps, so one sloppy tap doesn't swing it. */
export class TapTempo {
  private taps: number[] = [];

  /** Registers a tap at time `t` (seconds). Returns the beat period once three or more taps agree. */
  tap(t: number): number | null {
    const last = this.taps.at(-1);
    if (last !== undefined && t - last > RESET_AFTER) this.taps = [];
    this.taps.push(t);
    if (this.taps.length > MAX_TAPS) this.taps.shift();
    if (this.taps.length < MIN_TAPS) return null;
    const period = fitSlope(this.taps);
    return period > MIN_PERIOD && period < MAX_PERIOD ? period : null;
  }

  reset(): void {
    this.taps = [];
  }
}
