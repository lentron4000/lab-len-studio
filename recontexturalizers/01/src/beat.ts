// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.

/** Beats to the bar: the count runs 1 2 3 4, and a new quilt lands on every 1. */
export const BEATS_PER_BAR = 4;
/** Tempo range (BPM) that can be set or tapped. */
export const BPM_MIN = 40;
export const BPM_MAX = 220;

export const clampBpm = (bpm: number): number => Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));

/**
 * A beat clock: started on a 1, it counts beats at its tempo (times in seconds, on any steady clock).
 * Changing the tempo keeps its place in the bar, so the count carries on rather than jumping. Later,
 * a tempo and downbeat heard in the music can drive it the same way.
 */
export class BeatClock {
  bpm: number;
  /** When beat 0 (a 1) fell, by the current tempo. */
  private origin = 0;
  /** The last whole beat reported. */
  private last = -1;
  running = false;

  constructor(bpm = 120) {
    this.bpm = clampBpm(bpm);
  }

  get beatSeconds(): number {
    return 60 / this.bpm;
  }

  /** Starts counting, with a 1 now. */
  start(now: number): void {
    this.running = true;
    this.origin = now;
    this.last = -1;
  }

  stop(): void {
    this.running = false;
  }

  /** A new tempo, keeping the place in the bar. */
  setBpm(bpm: number, now: number): void {
    const next = clampBpm(bpm);
    if (this.running) {
      const at = (now - this.origin) / this.beatSeconds;
      this.origin = now - (at * 60) / next;
    }
    this.bpm = next;
  }

  /** The beats since the last call: each as its place in the bar (1–4). */
  tick(now: number): number[] {
    if (!this.running) return [];
    const at = Math.floor((now - this.origin) / this.beatSeconds);
    const beats: number[] = [];
    for (let b = this.last + 1; b <= at; b++) beats.push((b % BEATS_PER_BAR) + 1);
    this.last = Math.max(this.last, at);
    return beats;
  }

  /** Beats since the clock started (fractional): where in the music it is. */
  position(now: number): number {
    return (now - this.origin) / this.beatSeconds;
  }

  /** Seconds until the next 1. */
  untilBar(now: number): number {
    const bar = this.beatSeconds * BEATS_PER_BAR;
    const into = (((now - this.origin) % bar) + bar) % bar;
    return into === 0 ? 0 : bar - into;
  }
}

/** Tap tempo: the tempo of the last few taps (a pause of two seconds starts over). */
export class TapTempo {
  private taps: number[] = [];

  /** A tap at `now` (seconds): the tempo so far, once there are two taps. */
  tap(now: number): number | null {
    const last = this.taps.at(-1);
    if (last !== undefined && now - last > 2) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 5) this.taps.shift();
    if (this.taps.length < 2) return null;
    const span = (this.taps.at(-1)! - this.taps[0]) / (this.taps.length - 1);
    return clampBpm(Math.round(60 / span));
  }
}
