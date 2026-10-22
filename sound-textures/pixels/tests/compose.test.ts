import { describe, expect, it } from 'vitest';
import { compose, cut, type Pixels } from '../src/compose';
import type { Patch } from '../src/quilt';

/** A source of `cols` × `rows` cells, `unit` px each, every pixel coloured by a function of where it is. */
function source(
  cols: number,
  rows: number,
  unit: number,
  colour: (x: number, y: number) => number[],
): Pixels {
  const width = cols * unit;
  const height = rows * unit;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([...colour(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
}

const pixel = (p: Pixels, x: number, y: number): number[] => {
  const o = (y * p.width + x) * 4;
  return [p.data[o], p.data[o + 1], p.data[o + 2]];
};

describe('cut', () => {
  it('follows the cheapest path through the strip', () => {
    // A cost of 0 down column 2, 9 everywhere else.
    const path = cut(20, 5, (_a, x) => (x === 2 ? 0 : 9));
    expect([...path].every((x) => x === 2)).toBe(true);
  });
});

describe('compose', () => {
  it('lays patches from the sources, and fills every pixel', () => {
    const unit = 4;
    const red = source(10, 10, unit, () => [255, 0, 0]);
    const blue = source(10, 10, unit, () => [0, 0, 255]);
    const patches: Patch[] = [
      { source: 0, sx: 0, sy: 0, col: 0, row: 0, w: 5, h: 5 },
      { source: 1, sx: 0, sy: 0, col: 3, row: 0, w: 5, h: 5 },
    ];
    const out = compose([red, blue], unit, 8, 5, patches, 2);
    expect(out.width).toBe(32);
    expect(pixel(out, 0, 0)).toEqual([255, 0, 0]);
    expect(pixel(out, 31, 19)).toEqual([0, 0, 255]);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
  });

  it('cuts a join along where the two patches match', () => {
    // The second patch starts at x = 12 (cell 3) and overlaps the first by 8 px. The two agree only along
    // a crooked line (x = 14 + y % 3); either side of it, each shows a colour the other doesn't have
    // (the first black to its right, the second white to its left). The join must run along that line,
    // so neither black nor white shows anywhere.
    const unit = 4;
    const line = (y: number): number => 14 + (y % 3);
    const a = source(10, 10, unit, (x, y) => (x <= line(y) ? [200, 50, 50] : [0, 0, 0]));
    const b = source(10, 10, unit, (x, y) => (x + 12 >= line(y) ? [200, 50, 50] : [255, 255, 255]));
    const patches: Patch[] = [
      { source: 0, sx: 0, sy: 0, col: 0, row: 0, w: 5, h: 5 },
      { source: 1, sx: 0, sy: 0, col: 3, row: 0, w: 5, h: 5 },
    ];
    const out = compose([a, b], unit, 8, 5, patches, 2);
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++) expect(pixel(out, x, y)).toEqual([200, 50, 50]);
  });

  it('lays a whole source with its middle untouched', () => {
    const unit = 4;
    const bg = source(10, 10, unit, () => [10, 10, 10]);
    const pic = source(6, 6, unit, (x, y) => [x * 5, y * 5, 100]);
    const patches: Patch[] = [{ source: 0, sx: 0, sy: 0, col: 0, row: 0, w: 10, h: 10 }];
    const out = compose([bg, pic], unit, 10, 10, patches, 2, { source: 1, col: 2, row: 2, cols: 6, rows: 6 });
    // Deeper than the 2-cell band from its edge, it's exactly the picture.
    const at = 2 * unit;
    for (let y = at + 2 * unit; y < at + 4 * unit; y++)
      for (let x = at + 2 * unit; x < at + 4 * unit; x++)
        expect(pixel(out, x, y)).toEqual([(x - at) * 5, (y - at) * 5, 100]);
  });
});
