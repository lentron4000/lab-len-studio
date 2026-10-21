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

/** Seconds without analysis frames after which the music has stopped (file paused, input gone). */
const NO_FRAMES = 0.5;
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
  /** How far ahead `upcoming` has already looked (wall clock). */
  private lastAhead = nowSeconds();
  private clockBeats = 0;
  /** Wall-clock time of the last analysis frame: without any (paused, stopped) there's no music. */
  private lastFrameAt = -Infinity;

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
    this.lastPoll = this.lastAhead = nowSeconds();
    this.offset = 0;
    this.offsetSet = false;
    this.lastFrameAt = -Infinity;
  }

  /** No music: no frames lately (paused, stopped) or the tracker hears silence. */
  private quiet(now: number): boolean {
    return now - this.lastFrameAt > NO_FRAMES || this.tracker.state(now - this.offset) === 'silent';
  }

  /**
   * Feeds analysis frames (audio-clock times).
   * @param heardAt wall-clock time, in seconds, at which the last frame is heard
   */
  pushFrames(frames: readonly OnsetFrame[], heardAt: number): void {
    const last = frames.at(-1);
    if (!last) return;
    this.lastFrameAt = nowSeconds();
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
    // The beat clock keeps time through breakdowns, but not through silence or a paused file.
    const ownClock = this.tracker.locked; // tap or the demo kick: a set tempo
    if (!this.clock.isActive() && (ownClock || !this.quiet(now))) {
      beats += this.tracker.beats(this.lastPoll - this.offset, now + PAINT_LEAD - this.offset).length;
    }
    this.lastPoll = now + PAINT_LEAD;
    return { kicks, beats };
  }

  /**
   * Beats the beat clock expects within `lead` seconds of `now`, each counted once: for a wind-up that
   * starts before the beat it leads into. (Not under MIDI clock, whose beats come only as they happen.)
   */
  upcoming(now: number, lead: number): number {
    const from = Math.max(this.lastAhead, now);
    this.lastAhead = now + lead;
    if (this.clock.isActive() || (!this.tracker.locked && this.quiet(now))) return 0;
    return this.tracker.beats(from - this.offset, now + lead - this.offset).length;
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

    const now = nowSeconds();
    if (now - this.lastFrameAt > NO_FRAMES) {
      return { bpm: 0, label: mode === 'file' ? 'Paused' : 'No signal', overridden };
    }
    const bpm = t.displayBpm();
    switch (t.state(now - this.offset)) {
      case 'tracking': {
        const o = t.octave;
        return {
          bpm,
          label: o === 1 ? 'Tracking' : `Tracking · ${o > 1 ? `×${o}` : `÷${1 / o}`}`,
          overridden,
        };
      }
      case 'holding':
        return { bpm, label: 'Holding', overridden };
      case 'silent':
        return { bpm: 0, label: 'Silence', overridden };
      default:
        // No tempo until beats have actually been matched (noise can suggest one).
        return { bpm: 0, label: 'Listening…', overridden };
    }
  }
}
