// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { describe, expect, it } from 'vitest';
import { MidiClock } from '../src/audio/midi-clock';

const CLOCK = 0xf8;
const START = 0xfa;
const SONG_POSITION = 0xf2;

/** Feeds `beats` worth of 24-ppqn ticks at `bpm`, with optional timing jitter (ms). */
function feed(
  clock: MidiClock,
  setNow: (t: number) => void,
  bpm: number,
  beats: number,
  start = 0,
  jitter = 0,
): number {
  const tickMs = 60000 / bpm / 24;
  let t = start;
  for (let i = 0; i < beats * 24; i++) {
    t = start + i * tickMs + (jitter ? (Math.sin(i * 12.9898) * 43758.5453) % jitter : 0);
    setNow(t);
    clock.handle(CLOCK, 0, 0, t, 'IAC Driver Bus 1');
  }
  return t;
}

function setup(): { clock: MidiClock; beats: number[]; setNow: (t: number) => void } {
  let now = 0;
  const beats: number[] = [];
  const clock = new MidiClock(
    (t) => beats.push(t),
    () => now,
  );
  return {
    clock,
    beats,
    setNow: (t) => {
      now = t;
    },
  };
}

describe('MidiClock', () => {
  it('measures tempo from ticks, even with ±1 ms jitter', () => {
    const { clock, setNow } = setup();
    feed(clock, setNow, 126, 8, 0, 1);
    expect(clock.isActive()).toBe(true);
    expect(clock.displayBpm()).toBe(126);
    expect(clock.source).toBe('IAC Driver Bus 1');
  });

  it('fires a beat every 24 ticks, starting on Start', () => {
    const { clock, beats, setNow } = setup();
    clock.handle(START, 0, 0, 0);
    feed(clock, setNow, 120, 4);
    expect(beats).toHaveLength(4);
    expect(beats[1] - beats[0]).toBeCloseTo(500, 6);
  });

  it('aligns the beat count to Song Position Pointer', () => {
    const { clock, beats, setNow } = setup();
    // Position 2 sixteenths = half a beat: the first beat lands 12 ticks in.
    clock.handle(SONG_POSITION, 2, 0, 0);
    feed(clock, setNow, 120, 1);
    expect(beats).toHaveLength(1);
    expect(beats[0]).toBeCloseTo(12 * (500 / 24), 6);
  });

  it('applies ×2 to the beat grid and the displayed tempo', () => {
    const { clock, beats, setNow } = setup();
    clock.multiplier = 2;
    clock.handle(START, 0, 0, 0);
    feed(clock, setNow, 120, 2);
    expect(beats).toHaveLength(4);
    expect(clock.displayBpm()).toBe(240);
  });

  it('goes inactive 300 ms after the last tick', () => {
    const { clock, setNow } = setup();
    const end = feed(clock, setNow, 120, 1);
    setNow(end + 299);
    expect(clock.isActive()).toBe(true);
    setNow(end + 301);
    expect(clock.isActive()).toBe(false);
  });

  it('ignores non-clock messages', () => {
    const { clock } = setup();
    expect(clock.handle(0x90, 36, 100, 0)).toBe(false);
    expect(clock.handle(0xfe, 0, 0, 0)).toBe(true); // active sensing: consumed, no effect
  });
});
