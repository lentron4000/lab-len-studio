import { describe, expect, it } from 'vitest';
import { assignByAngle, FORMATIONS, great, samplePoints, type FormationId } from '../src/sim/formations';
import { Summoning } from '../src/sim/summoning';

const ids = Object.keys(FORMATIONS) as FormationId[];

describe('formations', () => {
  it.each(ids)('%s samples exactly the requested points, all inside the unit circle', (id) => {
    for (const f of [FORMATIONS[id], great(id)]) {
      for (const n of [1, 997, 2800]) {
        const pts = samplePoints(f.strokes, n);
        expect(pts.length).toBe(n * 2);
        for (let i = 0; i < n; i++) {
          expect(Number.isFinite(pts[i * 2])).toBe(true);
          expect(Math.hypot(pts[i * 2], pts[i * 2 + 1])).toBeLessThan(1.1);
        }
      }
    }
  });

  it('matches every particle to a distinct target', () => {
    const n = 1500;
    const px = Float32Array.from({ length: n }, () => Math.random() * 2 - 1);
    const py = Float32Array.from({ length: n }, () => Math.random() * 2 - 1);
    const order = assignByAngle(px, py, samplePoints(FORMATIONS.pentagram.strokes, n));
    expect(new Set(order).size).toBe(n);
  });
});

describe('summoning', () => {
  const n = 1200;
  const px = Float32Array.from({ length: n }, () => Math.random() * 2 - 1);
  const py = Float32Array.from({ length: n }, () => Math.random() * 2 - 1);

  it('fades in while held, layers two keys, and fades out on release', () => {
    const s = new Summoning(n);
    s.hold('a', 'circle', false, 1, px, py);
    for (let i = 0; i < 120; i++) s.step(120);
    expect(s.weight).toBeGreaterThan(0.99);
    s.hold('b', 'inverted', false, 1, px, py);
    expect(s.names).toEqual(['Summoning circle', 'Inverted pentagram']);
    expect(s.release('a', px, py)).toBeNull();
    expect(s.names).toEqual(['Inverted pentagram']);
    expect(s.release('b', px, py)).toBe(1);
    expect(s.active).toBe(false);
    for (let i = 0; i < 600; i++) s.step(120);
    expect(s.weight).toBe(0);
  });

  it('ignores a release for a key that was never held', () => {
    const s = new Summoning(n);
    s.hold('a', 'eye', false, 0.5, px, py);
    s.release('zzz', px, py);
    expect(s.active).toBe(true);
  });
});
