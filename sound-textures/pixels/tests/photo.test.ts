import { describe, expect, it } from 'vitest';
import { MAX_AREA, MAX_BYTES, MIN_SIDE, PHOTO_CELL, refusal, workingSize } from '../src/photo';

describe('working size', () => {
  it('keeps the textile exactly as it is (89 × 67 cells)', () => {
    expect(workingSize(2848, 2144)).toMatchObject({ cols: 89, rows: 67, width: 2848, height: 2144 });
  });

  it('scales a big phone photo down to about the textile’s area, in whole cells', () => {
    const s = workingSize(4032, 3024);
    expect(s.width * s.height).toBeLessThanOrEqual(MAX_AREA);
    expect(s.width % PHOTO_CELL).toBe(0);
    expect(s.cols).toBeGreaterThan(80);
    // The crop is centred and inside the photo.
    expect(s.crop.x).toBeGreaterThanOrEqual(0);
    expect(s.crop.x + s.crop.w).toBeLessThanOrEqual(4032 + 1e-6);
  });

  it('scales a small or thin photo up so there are enough cells to quilt with', () => {
    const s = workingSize(300, 1200);
    expect(Math.min(s.width, s.height)).toBeGreaterThanOrEqual(MIN_SIDE - PHOTO_CELL);
    expect(Math.min(s.cols, s.rows)).toBeGreaterThanOrEqual(19);
  });
});

describe('refusal', () => {
  it('takes images up to the limit, and nothing else', () => {
    expect(refusal({ type: 'image/jpeg', size: 3e6 })).toBeNull();
    expect(refusal({ type: 'image/png', size: MAX_BYTES + 1 })).toMatch(/over 20 MB/);
    expect(refusal({ type: 'application/pdf', size: 1000 })).toMatch(/isn’t an image/);
  });
});
