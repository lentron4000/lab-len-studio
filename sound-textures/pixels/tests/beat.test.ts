import { describe, expect, it } from 'vitest';
import { BeatClock, BPM_MAX, TapTempo } from '../src/beat';

describe('beat clock', () => {
  it('counts 1 2 3 4 1 at its tempo, from a 1 when started', () => {
    const c = new BeatClock(120);
    c.start(10);
    expect(c.tick(10)).toEqual([1]);
    expect(c.tick(10.4)).toEqual([]);
    expect(c.tick(11.6)).toEqual([2, 3, 4]);
    expect(c.tick(12)).toEqual([1]);
  });

  it('keeps its place in the bar when the tempo changes', () => {
    const c = new BeatClock(120);
    c.start(0);
    c.tick(0.75); // beats 1 and 2 (0.5 s each)
    c.setBpm(60, 0.75); // halfway through beat 2: 0.5 s of beat 2 left at 60 BPM
    expect(c.tick(1.2)).toEqual([]);
    expect(c.tick(1.26)).toEqual([3]);
  });

  it('knows how long until the next 1', () => {
    const c = new BeatClock(120);
    c.start(0);
    expect(c.untilBar(0.5)).toBeCloseTo(1.5, 6);
    expect(c.untilBar(2)).toBe(0);
  });
});

describe('tap tempo', () => {
  it('takes the tempo from steady taps, and starts over after a pause', () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(0.5)).toBe(120);
    expect(t.tap(1)).toBe(120);
    expect(t.tap(5)).toBeNull();
    expect(t.tap(5.4)).toBe(150);
    expect(t.tap(5.401)).toBe(BPM_MAX);
  });
});
