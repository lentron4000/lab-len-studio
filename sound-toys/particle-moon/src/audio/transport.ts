// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { nowSeconds } from '../lib/math';
import { MidiClock } from './midi-clock';
import { ANALYSIS_RATE, type OnsetFrame } from './onset-core';
import { TapTempo } from './tap-tempo';
import { TempoTracker } from './tempo-tracker';

export type SourceMode = 'off' | 'demo' | 'file' | 'live';

/** Events due since the last poll. */
export interface TransportEvents {
  /** Strengths of kicks heard since the last poll. */
  kicks: number[];
  /** Number of beats crossed since the last poll. */
  beats: number;
}

export interface TempoReadout {
  /** 0 when there is no tempo. */
  bpm: number;
  label: string;
  /** Whether a manual or octave override is active (shows the Auto button). */
  overridden: boolean;
}

/** Beats are released this far ahead so the frame that shows them is painted on the beat. */
const PAINT_LEAD = 0.008;

/**
 * Single source of truth for tempo and beats. Priority: MIDI clock > tap / demo > detected tempo.
 *
 * The tracker runs on the audio clock (exact sample timing). `offset` maps audio-clock time to the
 * wall-clock moment the sound is heard, smoothed so callback jitter doesn't wobble the beat.
 */
export class Transport {
  readonly clock: MidiClock;
  private tracker: TempoTracker;
  private readonly taps = new TapTempo();
  private fps: number;
  private offset = 0;
  private offsetSet = false;
  private kicks: [heardAt: number, strength: number][] = [];
  private lastPoll = nowSeconds();
  private clockBeats = 0;

  constructor(fps = ANALYSIS_RATE) {
    this.fps = fps;
    this.tracker = new TempoTracker(fps);
    this.clock = new MidiClock(() => {
      this.clockBeats++;
    });
  }

  /** Starts tempo detection over (new source or file). */
  reset(fps = this.fps): void {
    this.fps = fps;
    this.tracker = new TempoTracker(fps);
    this.kicks = [];
    this.lastPoll = nowSeconds();
    this.offset = 0;
    this.offsetSet = false;
  }

  /**
   * Feeds analysis frames (audio-clock times).
   * @param heardAt wall-clock time, in seconds, at which the last frame is heard
   */
  pushFrames(frames: readonly OnsetFrame[], heardAt: number): void {
    const last = frames.at(-1);
    if (!last) return;
    const o = heardAt - last.t;
    if (!this.offsetSet || Math.abs(o - this.offset) > 0.25) {
      this.offset = o;
      this.offsetSet = true;
    } else {
      this.offset += 0.02 * (o - this.offset);
    }
    for (const frame of frames) {
      const kick = this.tracker.push(frame, frame.t);
      if (kick) this.kicks.push([frame.t + this.offset, kick]);
    }
  }

  /** Fixed tempo with a beat at wall-clock time `beatAt` (the demo kick). */
  setFixedTempo(bpm: number, beatAt: number): void {
    this.offset = 0;
    this.tracker.setManual(bpm, beatAt);
  }

  tap(): void {
    const t = nowSeconds();
    const period = this.taps.tap(t);
    if (period) {
      this.tracker.setManual(60 / period, t - this.offset);
      this.lastPoll = t;
    }
  }

  halve(): void {
    if (this.clock.isActive()) this.clock.multiplier /= 2;
    else this.tracker.scale(0.5);
  }

  double(): void {
    if (this.clock.isActive()) this.clock.multiplier *= 2;
    else this.tracker.scale(2);
  }

  /** Clears tap, ½ / ×2 and clock overrides and returns to detection. */
  auto(mode: SourceMode): void {
    this.tracker.unlock();
    this.taps.reset();
    this.clock.multiplier = 1;
    if (mode === 'off' || mode === 'demo') this.reset();
  }

  /** Collects kicks and beats due by wall-clock time `now`. Call once per animation frame. */
  poll(now: number): TransportEvents {
    const kicks: number[] = [];
    while (this.kicks.length > 0 && this.kicks[0][0] <= now) kicks.push(this.kicks.shift()![1]);
    let beats = this.clockBeats;
    this.clockBeats = 0;
    if (!this.clock.isActive()) {
      beats += this.tracker.beats(this.lastPoll - this.offset, now + PAINT_LEAD - this.offset).length;
    }
    this.lastPoll = now + PAINT_LEAD;
    return { kicks, beats };
  }

  readout(mode: SourceMode): TempoReadout {
    const t = this.tracker;
    const overridden = mode !== 'demo' && (t.locked || t.octave !== 1 || this.clock.multiplier !== 1);
    if (this.clock.isActive()) {
      const m = this.clock.multiplier;
      const parts = ['MIDI clock'];
      if (this.clock.source) parts.push(this.clock.source);
      if (m !== 1) parts.push(m > 1 ? `×${m}` : `÷${1 / m}`);
      return { bpm: this.clock.displayBpm(), label: parts.join(' · '), overridden };
    }
    if (mode === 'demo') return { bpm: t.displayBpm(), label: 'Demo kick', overridden };
    if (t.locked) return { bpm: t.displayBpm(), label: 'Tap · locked', overridden };
    if (mode !== 'file' && mode !== 'live') return { bpm: 0, label: 'No source', overridden };

    const bpm = t.displayBpm();
    switch (t.state(nowSeconds() - this.offset)) {
      case 'tracking': {
        const o = t.octave;
        return {
          bpm,
          label: o === 1 ? 'Tracking' : `Tracking · ${o > 1 ? `×${o}` : `÷${1 / o}`}`,
          overridden,
        };
      }
      case 'holding':
        return { bpm, label: 'Holding (no beat heard)', overridden };
      case 'silent':
        return { bpm, label: bpm ? 'Holding (silence)' : 'No signal', overridden };
      default:
        return { bpm, label: 'Listening…', overridden };
    }
  }
}
