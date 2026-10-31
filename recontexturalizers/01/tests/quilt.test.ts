import { describe, expect, it } from 'vitest';
import { mirror, origin, quilt, QUILT_DEFAULTS, seeded, type Grid } from '../src/quilt';
import { textile } from '../src/source';

const original = textile();
const sources = [original, mirror(original)];
const make = (cols: number, rows: number, seed: number, placed?: Parameters<typeof quilt>[4]): Grid =>
  quilt(sources, cols, rows, { ...QUILT_DEFAULTS, random: seeded(seed) }, placed);

/** Share of cells in each of a few broad colour families (hue buckets, plus light and dark). */
function families(g: Grid): number[] {
  const bins = new Array<number>(8).fill(0);
  const n = g.cols * g.rows;
  for (let c = 0; c < n; c++) {
    const [r, gr, b] = [g.rgb[c * 3], g.rgb[c * 3 + 1], g.rgb[c * 3 + 2]];
    const max = Math.max(r, gr, b);
    const min = Math.min(r, gr, b);
    if (max < 60) bins[6]++;
    else if (max - min < 40) bins[7]++;
    else {
      const h =
        max === r
          ? ((gr - b) / (max - min) + 6) % 6
          : max === gr
            ? (b - r) / (max - min) + 2
            : (r - gr) / (max - min) + 4;
      bins[Math.floor(h)]++;
    }
  }
  return bins.map((v) => v / n);
}

describe('quilt', () => {
  it('fills every cell with colours from the textile', () => {
    const g = make(120, 70, 7);
    const known = new Set<number>();
    for (let c = 0; c < original.cols * original.rows; c++)
      known.add((original.rgb[c * 3] << 16) | (original.rgb[c * 3 + 1] << 8) | original.rgb[c * 3 + 2]);
    for (let c = 0; c < g.cols * g.rows; c++)
      expect(known.has((g.rgb[c * 3] << 16) | (g.rgb[c * 3 + 1] << 8) | g.rgb[c * 3 + 2])).toBe(true);
  });

  it('leaves a placed original exactly as it is', () => {
    const g = make(130, 80, 3, { source: 0, grid: original, col: 20, row: 6 });
    for (let y = 0; y < original.rows; y++)
      for (let x = 0; x < original.cols; x++)
        for (let k = 0; k < 3; k++)
          expect(g.rgb[((y + 6) * g.cols + x + 20) * 3 + k]).toBe(
            original.rgb[(y * original.cols + x) * 3 + k],
          );
  });

  it('quilts the same textile from the same seed, and a different one from another', () => {
    expect(make(60, 40, 11).rgb).toEqual(make(60, 40, 11).rgb);
    expect(make(60, 40, 11).rgb).not.toEqual(make(60, 40, 12).rgb);
  });

  it('is quick enough for a 4K screen in 16px cells', () => {
    const t = performance.now();
    make(241, 136, 5);
    const ms = performance.now() - t;
    console.log(`4K quilt: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });

  it('keeps the colour balance of the textile', () => {
    const want = families(original);
    for (const seed of [1, 2, 3]) {
      const got = families(make(120, 68, seed));
      console.log(
        'families (source → quilt):',
        want.map((v, k) => `${(v * 100).toFixed(0)}→${(got[k] * 100).toFixed(0)}`).join(' '),
      );
      for (let k = 0; k < want.length; k++) expect(Math.abs(got[k] - want[k])).toBeLessThan(0.06);
    }
  });
});

describe('quilt on a big screen', () => {
  it('never runs out of patches: an 8K screen in 16px cells is all textile', () => {
    const g = make(481, 271, 9);
    // Every cell filled from the textile (an exhausted search would leave cells black or copy patch 0).
    let black = 0;
    for (let c = 0; c < g.cols * g.rows; c++)
      if (g.rgb[c * 3] + g.rgb[c * 3 + 1] + g.rgb[c * 3 + 2] === 0) black++;
    expect(black / (g.cols * g.rows)).toBeLessThan(0.002);
  });
});

describe('quilt origins', () => {
  it('records where every cell came from: the source cell with exactly its colour', () => {
    const g = quilt(
      sources,
      90,
      50,
      { ...QUILT_DEFAULTS, random: seeded(4) },
      { source: 0, grid: original, col: 5, row: -10 },
    );
    for (let c = 0; c < g.cols * g.rows; c++) {
      const [si, x, y] = origin(g.from[c]);
      const s = sources[si];
      for (let k = 0; k < 3; k++) expect(g.rgb[c * 3 + k]).toBe(s.rgb[(y * s.cols + x) * 3 + k]);
    }
  });
});

describe('quilt round a placed original', () => {
  it('lays patches over the border band too, for a finer drawing to cut its join through', () => {
    const g = quilt(
      [original],
      121,
      69,
      { ...QUILT_DEFAULTS, random: seeded(1) },
      { source: 0, grid: original, col: 16, row: 1 },
    );
    // Every cell of the band (3 cells in from each edge that has quilt beyond it) is under some patch.
    for (let y = 1; y < 68; y++)
      for (let x = 16; x < 16 + 89; x++) {
        const inBand = x < 19 || x >= 16 + 89 - 3 || y < 4 || y >= 68 - 3;
        if (!inBand) continue;
        expect(g.patches.some((p) => x >= p.col && x < p.col + p.w && y >= p.row && y < p.row + p.h)).toBe(
          true,
        );
      }
  });
});
