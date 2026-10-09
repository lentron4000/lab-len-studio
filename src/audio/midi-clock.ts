// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { fitSlope } from '../lib/math';

const TICKS_PER_BEAT = 24;
const STATUS_CLOCK = 0xf8;
const STATUS_START = 0xfa;
const STATUS_SONG_POSITION = 0xf2;
/** Clock counts as present if a tick arrived within this window. */
const ACTIVE_MS = 300;
/** Ticks used for the tempo fit (four beats). */
const FIT_TICKS = 96;

/**
 * Tempo and beats from MIDI clock (e.g. Ableton with Sync enabled on an output port).
 * Exact compared to audio analysis, so it takes priority whenever it is running.
 */
export class MidiClock {
  /** Smoothed tempo from the tick stream, before `multiplier`. */
  bpm = 0;
  /** ½ / ×2 applied to the visual beat grid. */
  multiplier = 1;
  /** Name of the port the clock arrives on. */
  source = '';

  private readonly ticks: number[] = [];
  private lastTickMs = -Infinity;
  private count = 0;

  constructor(
    private readonly onBeat: (timeMs: number) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  isActive(): boolean {
    return this.now() - this.lastTickMs < ACTIVE_MS;
  }

  /** Handles a system message. Returns true if it was consumed (clock, start, song position, other real-time). */
  handle(status: number, data1: number, data2: number, timeMs: number, source = ''): boolean {
    if (status === STATUS_CLOCK) {
      this.tick(timeMs, source);
      return true;
    }
    if (status === STATUS_START) {
      this.count = 0; // the next tick is beat 1
      return true;
    }
    if (status === STATUS_SONG_POSITION) {
      this.count = ((data2 << 7) | data1) * 6; // position is in 16ths
      return true;
    }
    return status >= STATUS_CLOCK; // continue, stop, active sensing
  }

  /** Displayed tempo: multiplier applied, snapped to a whole number within 0.05. */
  displayBpm(): number {
    const v = this.bpm * this.multiplier;
    const r = Math.round(v);
    return Math.abs(v - r) < 0.05 ? r : Math.round(v * 10) / 10;
  }

  private tick(timeMs: number, source: string): void {
    if (this.now() - this.lastTickMs > 1000) this.ticks.length = 0; // resumed after a gap
    this.lastTickMs = timeMs;
    this.source = source;
    this.ticks.push(timeMs);
    if (this.ticks.length > FIT_TICKS) this.ticks.shift();
    if (this.ticks.length >= TICKS_PER_BEAT) {
      const msPerTick = fitSlope(this.ticks);
      if (msPerTick > 0) {
        const bpm = 60000 / (msPerTick * TICKS_PER_BEAT);
        this.bpm = this.bpm ? this.bpm + 0.2 * (bpm - this.bpm) : bpm;
      }
    }
    if (this.count % Math.round(TICKS_PER_BEAT / this.multiplier) === 0) this.onBeat(timeMs);
    this.count++;
  }
}
