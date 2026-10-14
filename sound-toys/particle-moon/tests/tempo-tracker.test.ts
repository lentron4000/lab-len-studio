// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { describe, expect, it } from 'vitest';
import { OnsetCore, type OnsetFrame } from '../src/audio/onset-core';
import { TempoTracker } from '../src/audio/tempo-tracker';
import { renderTrack, SAMPLE_RATE, TRACKS, type Track, type TrackSpec } from './synth';

const BLOCK = 128; // AudioWorklet render quantum

interface RunResult {
  tracker: TempoTracker;
  kicks: number[];
  beats: number[];
  /** Displayed BPM sampled once per second. */
  timeline: number[];
  end: number;
}

/** Runs a track through the same path as the app: 128-sample blocks → OnsetCore → TempoTracker. */
function run(track: Track, onFrame?: (t: number, tracker: TempoTracker) => void): RunResult {
  const core = new OnsetCore(SAMPLE_RATE);
  const tracker = new TempoTracker(core.fps);
  const frames: OnsetFrame[] = [];
  const kicks: number[] = [];
  const beats: number[] = [];
  const timeline: number[] = [];
  let last = 0;
  for (let s = 0; s < track.samples.length; s += BLOCK) {
    frames.length = 0;
    core.process(track.samples.subarray(s, s + BLOCK), s, frames);
    for (const f of frames) {
      if (tracker.push(f, f.t)) kicks.push(f.t);
      beats.push(...tracker.beats(last, f.t));
      if (Math.floor(f.t) !== Math.floor(last)) timeline.push(tracker.displayBpm());
      onFrame?.(f.t, tracker);
      last = f.t;
    }
  }
  return { tracker, kicks, beats, timeline, end: last };
}

/** Median absolute distance (ms) from beats in the last `window` seconds to the true beat grid. */
function beatError(r: RunResult, beatSeconds: number, window = 8): number {
  const errs = r.beats
    .filter((b) => b > r.end - window)
    .map((b) => {
      const ph = b / beatSeconds;
      return Math.abs((ph - Math.round(ph)) * beatSeconds * 1000);
    })
    .sort((a, b) => a - b);
  return errs[errs.length >> 1] ?? Infinity;
}

function kickStats(
  r: RunResult,
  kickTimes: number[],
  tolerance = 0.03,
): { recall: number; falsePositives: number } {
  const found = kickTimes.filter((t) => r.kicks.some((k) => Math.abs(k - t) < tolerance)).length;
  const falsePositives = r.kicks.filter((k) => !kickTimes.some((t) => Math.abs(k - t) < tolerance)).length;
  return { recall: kickTimes.length ? found / kickTimes.length : 1, falsePositives };
}

const track = (spec: TrackSpec): Track => renderTrack(spec);

describe('TempoTracker on four-on-the-floor tracks', () => {
  it.each([
    ['house 124 with an 8 s breakdown', TRACKS.house],
    ['techno 132 with 16th hats and bass', TRACKS.techno],
    ['fractional tempo 122.5', TRACKS.fractional],
  ])('%s: exact tempo, beat clock within 15 ms, ≥95% of kicks', (_name, spec) => {
    const t = track(spec);
    const r = run(t);
    expect(r.tracker.displayBpm()).toBeCloseTo(spec.bpm, 0);
    expect(Math.abs(r.tracker.displayBpm() - spec.bpm)).toBeLessThanOrEqual(0.15);
    expect(r.tracker.state(r.end)).toBe('tracking');
    expect(beatError(r, t.beatSeconds)).toBeLessThan(15);
    const k = kickStats(r, t.kickTimes);
    expect(k.recall).toBeGreaterThanOrEqual(0.95);
    expect(k.falsePositives).toBeLessThanOrEqual(1);
  });

  it('locks within 5 s and holds the tempo through a breakdown', () => {
    const r = run(track(TRACKS.house));
    // timeline[i] is the reading at the end of second i+1.
    expect(r.timeline[4]).toBe(124);
    // Breakdown 16–24 s: no kicks, so the clock runs on its last period (allowed to drift by 0.1).
    for (const bpm of r.timeline.slice(15, 24)) expect(Math.abs(bpm - 124)).toBeLessThanOrEqual(0.15);
  });
});

describe('TempoTracker on other grooves', () => {
  it('downtempo 87 (kick on 1 and 3): exact tempo and phase', () => {
    const t = track(TRACKS.downtempo);
    const r = run(t);
    expect(r.tracker.displayBpm()).toBe(87);
    expect(beatError(r, t.beatSeconds)).toBeLessThan(10);
  });

  it.each([
    ['dubstep 140 (half-time)', TRACKS.dubstep],
    ['drum and bass 174', TRACKS.dnb],
  ])('%s reads at half tempo, and ×2 restores it on the right phase', (_name, spec) => {
    const t = track(spec);
    let scaled = false;
    const r = run(t, (time, tracker) => {
      if (!scaled && time > 6) {
        expect(tracker.displayBpm()).toBe(spec.bpm / 2);
        tracker.scale(2);
        scaled = true;
      }
    });
    expect(r.tracker.displayBpm()).toBe(spec.bpm);
    expect(beatError(r, t.beatSeconds)).toBeLessThan(10);
  });

  it('holds a settled tempo, then follows a sustained change from 124 to 128 and settles exactly', () => {
    const a = renderTrack({ bpm: 124, seconds: 20, kicks: [0, 1, 2, 3], bass: true });
    const b = renderTrack({ bpm: 128, seconds: 30, kicks: [0, 1, 2, 3], bass: true });
    const samples = new Float32Array(a.samples.length + b.samples.length);
    samples.set(a.samples);
    samples.set(b.samples, a.samples.length);
    const r = run({ samples, kickTimes: [], beatSeconds: 60 / 128 });
    expect(r.timeline[18]).toBe(124);
    // Electronic tracks rarely change tempo, so a settled tempo resists for a while…
    expect(r.timeline[23]).toBe(124);
    // …but a sustained change still wins.
    expect(r.timeline[45]).toBeCloseTo(128, 0);
    expect(r.tracker.displayBpm()).toBe(128);
  });
});

describe('TempoTracker on ambient material', () => {
  it('finds the tempo from a quiet kick under a loud pad', () => {
    const t = track(TRACKS.ambientSoftKick);
    const r = run(t);
    expect(Math.abs(r.tracker.displayBpm() - 75)).toBeLessThanOrEqual(0.3);
    expect(r.tracker.combSource).toBe('kick');
    expect(beatError(r, t.beatSeconds)).toBeLessThan(15);
  });

  it('reports no tempo for a beatless pad', () => {
    const r = run(track(TRACKS.ambientNoBeat));
    expect(r.tracker.displayBpm()).toBe(0);
    expect(r.tracker.strength).toBeLessThan(1);
  });

  // Chance peaks in noise depend on the noise itself, so check several realisations.
  const seeds = Array.from({ length: 8 }, (_, i) => (i + 1) * 2654435761);
  it('never invents a tempo from a beatless pad, across 8 noise seeds', () => {
    for (const seed of seeds)
      expect(run(renderTrack(TRACKS.ambientNoBeat, seed)).tracker.displayBpm()).toBe(0);
  });
  it('finds a quiet kick under a loud pad, across 8 noise seeds', () => {
    for (const seed of seeds) {
      expect(
        Math.abs(run(renderTrack(TRACKS.ambientSoftKick, seed)).tracker.displayBpm() - 75),
      ).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('TempoTracker manual control', () => {
  it('setManual fixes the tempo and phase; unlock returns to detection', () => {
    const tracker = new TempoTracker(100);
    tracker.setManual(120, 10);
    expect(tracker.locked).toBe(true);
    expect(tracker.displayBpm()).toBe(120);
    expect(tracker.beats(10, 12)).toEqual([10.5, 11, 11.5, 12]);
    tracker.unlock();
    expect(tracker.locked).toBe(false);
    expect(tracker.displayBpm()).toBe(0);
  });
});

describe('TempoTracker with no music', () => {
  it('hears no kicks and no tempo in quiet room noise with low thumps', () => {
    // A live input in a quiet room: noise around −50 dBFS and a soft low thump about once a second.
    const seconds = 30;
    const samples = new Float32Array(seconds * SAMPLE_RATE);
    let seed = 12345;
    const rand = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    for (let i = 0; i < samples.length; i++) samples[i] = rand() * 0.004;
    for (let t = 0.5; t < seconds; t += 0.9 + 0.3 * Math.abs(rand())) {
      const start = Math.floor(t * SAMPLE_RATE);
      for (let k = 0; k < 0.15 * SAMPLE_RATE && start + k < samples.length; k++) {
        samples[start + k] +=
          0.006 * Math.sin((2 * Math.PI * 55 * k) / SAMPLE_RATE) * Math.exp(-k / (0.05 * SAMPLE_RATE));
      }
    }
    const r = run({ samples, kickTimes: [], beatSeconds: 1 });
    expect(r.kicks.length).toBe(0);
    expect(r.tracker.displayBpm()).toBe(0);
  });
});
