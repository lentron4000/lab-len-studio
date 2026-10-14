import { describe, expect, it } from 'vitest';
import { OnsetCore, type OnsetFrame } from '../src/audio/onset-core';
import { MusicListener } from '../src/auto/listener';
import { Simulation } from '../src/sim/simulation';
import { renderTrack, SAMPLE_RATE, TRACKS, type TrackSpec } from './synth';

/** Runs a synthetic track through the app's analysis and the listener; returns snare times and features. */
function listen(spec: TrackSpec): { snareTimes: number[]; listener: MusicListener } {
  const track = renderTrack(spec);
  const core = new OnsetCore(SAMPLE_RATE);
  const listener = new MusicListener();
  const snareTimes: number[] = [];
  for (let s = 0; s + 128 <= track.samples.length; s += 128) {
    const frames: OnsetFrame[] = [];
    core.process(track.samples.subarray(s, s + 128), s, frames);
    if (!frames.length) continue;
    const now = s / SAMPLE_RATE;
    listener.push(frames, now);
    listener.tick(128 / SAMPLE_RATE, now);
    for (const _ of listener.takeSnares()) snareTimes.push(now);
  }
  return { snareTimes, listener };
}

describe('listening', () => {
  it('hears the snares in tracks that have them', () => {
    for (const spec of [TRACKS.downtempo, TRACKS.dnb]) {
      const { snareTimes } = listen(spec);
      const bars = (spec.seconds * spec.bpm) / 240;
      // Two snares a bar: most of them heard.
      expect(snareTimes.length).toBeGreaterThan(bars * 2 * 0.7);
      expect(snareTimes.length).toBeLessThan(bars * 2 * 1.3);
    }
  });

  it('hears no snares in a kick-and-hat track or an ambient pad', () => {
    expect(listen(TRACKS.techno).snareTimes.length).toBeLessThan(4);
    expect(listen(TRACKS.ambientNoBeat).snareTimes.length).toBe(0);
  });

  it('shimmers with busy hats, barely for a pad', () => {
    expect(listen(TRACKS.techno).listener.features.shimmer).toBeGreaterThan(0.3);
    expect(listen(TRACKS.ambientNoBeat).listener.features.shimmer).toBeLessThan(0.2);
  });
});

describe('snare nudge', () => {
  it('turns the shape a little forward and springs back', () => {
    const sim = new Simulation(800);
    sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
    const n = sim as unknown as { nudge: number };
    sim.nudgeSpin(1);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      sim.step();
      peak = Math.max(peak, n.nudge);
    }
    expect(peak * (180 / Math.PI)).toBeGreaterThan(2);
    expect(peak * (180 / Math.PI)).toBeLessThan(8);
    expect(Math.abs(n.nudge)).toBeLessThan(peak * 0.1);
  });
});
