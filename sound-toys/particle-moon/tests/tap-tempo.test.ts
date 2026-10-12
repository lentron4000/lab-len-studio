// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { describe, expect, it } from 'vitest';
import { TapTempo } from '../src/audio/tap-tempo';

describe('TapTempo', () => {
  it('needs three taps, then returns the fitted period', () => {
    const taps = new TapTempo();
    expect(taps.tap(0)).toBeNull();
    expect(taps.tap(0.5)).toBeNull();
    expect(taps.tap(1)).toBeCloseTo(0.5, 9);
  });

  it('absorbs one sloppy tap', () => {
    const taps = new TapTempo();
    const times = [0, 0.5, 1.04, 1.5, 2, 2.5];
    let period: number | null = null;
    for (const t of times) period = taps.tap(t);
    expect(period).not.toBeNull();
    expect(60 / period!).toBeCloseTo(120, 0);
  });

  it('starts a new run after a 2 s pause', () => {
    const taps = new TapTempo();
    [0, 0.5, 1].forEach((t) => taps.tap(t));
    expect(taps.tap(10)).toBeNull();
    expect(taps.tap(10.4)).toBeNull();
    expect(taps.tap(10.8)).toBeCloseTo(0.4, 9);
  });

  it('rejects implausible tempos', () => {
    const taps = new TapTempo();
    [0, 0.1, 0.2].forEach((t) => taps.tap(t));
    expect(taps.tap(0.3)).toBeNull(); // 600 BPM
  });
});
