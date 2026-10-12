import { describe, expect, it } from 'vitest';
import { hitStrength, touch } from '../src/midi/velocity';
import { BLAST_MAX } from '../src/sim/simulation';

describe('velocity', () => {
  it('stretches the usable range to 0–1', () => {
    expect(touch(1)).toBe(0);
    expect(touch(127)).toBe(1);
    expect(touch(64)).toBeCloseTo(0.49, 2);
  });

  it('keeps light hits gentle, a full kick past halfway, and a blast at the top', () => {
    expect(hitStrength(touch(30))).toBeLessThan(0.2);
    const fullKickAt = [...Array(128).keys()].find((v) => hitStrength(touch(v)) >= 1);
    expect(fullKickAt).toBeGreaterThan(70);
    expect(fullKickAt).toBeLessThan(85);
    expect(hitStrength(touch(127))).toBeCloseTo(BLAST_MAX);
  });

  it('never gets weaker as you hit harder', () => {
    for (let v = 1; v < 127; v++)
      expect(hitStrength(touch(v + 1))).toBeGreaterThanOrEqual(hitStrength(touch(v)));
  });
});
