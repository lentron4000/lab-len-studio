import { describe, expect, it } from 'vitest';
import {
  colourGroups,
  ease,
  fit,
  flavour,
  soften,
  TRANSITIONS,
  turned,
  type Flavour,
} from '../src/transitions';
import { seeded } from '../src/quilt';

describe('transitions', () => {
  it('every tile has fully turned over by the end (no snap on the last frame)', () => {
    const random = seeded(3);
    // Colour groups' greys arrive last: before fitting, some would still be turning at the end.
    const rgb = new Uint8ClampedArray(4000 * 4).map((_, i) =>
      i % 4 === 3 ? 255 : Math.floor(random() * 256),
    );
    for (const kind of TRANSITIONS) {
      const at = fit(colourGroups(rgb, 4000, random), kind.fade);
      for (const a of at) expect(turned(1, a, kind.fade)).toBe(1);
    }
  });

  it('eases in and out: still at both ends, quickest in the middle', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    const slope = (t: number): number => (ease(t + 1e-4) - ease(t)) / 1e-4;
    expect(slope(0.001)).toBeLessThan(0.01);
    expect(slope(0.999)).toBeLessThan(0.01);
    expect(slope(0.5)).toBeGreaterThan(1.4);
  });

  it('eases each tile in and out: still at the start and end of its turn', () => {
    const fade = 0.2;
    const slope = (t: number): number => (turned(t + 1e-4, 0.5, fade) - turned(t, 0.5, fade)) / 1e-4;
    expect(turned(0.5, 0.5, fade)).toBe(0);
    expect(turned(0.7, 0.5, fade)).toBe(1);
    expect(slope(0.5001)).toBeLessThan(0.05);
    expect(slope(0.6999 - 1e-4)).toBeLessThan(0.05);
  });

  it('softens arrivals between neighbours: a lone early tile is pulled toward its neighbours', () => {
    const across = 9;
    const down = 9;
    const at = new Float32Array(across * down).fill(0.8);
    at[4 * across + 4] = 0;
    soften(at, across, down, 1);
    expect(at[4 * across + 4]).toBeGreaterThan(0.6);
    expect(at[4 * across + 4]).toBeLessThan(0.8);
    // Far from it, nothing changes.
    expect(at[0]).toBeCloseTo(0.8, 6);
  });

  const base: Flavour = {
    key: 'hue',
    reverse: false,
    start: 0,
    greysFirst: false,
    jitter: 0,
    drift: 0,
    angle: 0,
  };
  const grey = (v: number): number[] => [v, v, v, 255];

  it('can follow lightness: darks first, or lights first when reversed', () => {
    const rgb = new Uint8ClampedArray([...grey(20), ...grey(240)]);
    const at = colourGroups(rgb, 2, Math.random, { ...base, key: 'light' });
    expect(at[0]).toBeLessThan(at[1]);
    const back = colourGroups(rgb, 2, Math.random, { ...base, key: 'light', reverse: true });
    expect(back[0]).toBeGreaterThan(back[1]);
  });

  it('can drift across the screen: left to right, the left side first', () => {
    // A row of identical colours: only the drift tells them apart.
    const across = 10;
    const rgb = new Uint8ClampedArray(across * 4).map((_, i) => (i % 4 === 3 ? 255 : [200, 40, 40][i % 4]));
    const at = colourGroups(rgb, across, Math.random, { ...base, drift: 0.5, angle: 0 }, across, 1);
    for (let x = 1; x < across; x++) expect(at[x]).toBeGreaterThan(at[x - 1]);
  });

  it('every flavour still finishes by the end', () => {
    const random = seeded(9);
    const rgb = new Uint8ClampedArray(64 * 48 * 4).map((_, i) =>
      i % 4 === 3 ? 255 : Math.floor(random() * 256),
    );
    for (let k = 0; k < 40; k++) {
      const at = fit(colourGroups(rgb, 64 * 48, random, flavour(random), 64, 48), TRANSITIONS[0].fade);
      for (const a of at) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(turned(1, a, TRANSITIONS[0].fade)).toBe(1);
      }
    }
  });
});
