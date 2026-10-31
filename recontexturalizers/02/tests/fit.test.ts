import { describe, expect, it } from 'vitest';
import { cover, gridOf } from '../src/fit';

describe('cover', () => {
  it('cuts the sides off a wide video on a narrower screen', () => {
    const c = cover(1920, 1080, 1000, 1000);
    expect(c.h).toBe(1);
    expect(c.w).toBeCloseTo(1080 / 1920);
    expect(c.x).toBeCloseTo((1 - 1080 / 1920) / 2);
  });

  it('cuts the top and bottom off a video taller than the screen', () => {
    const c = cover(720, 1280, 1600, 900);
    expect(c.w).toBe(1);
    expect(c.h).toBeCloseTo(720 / 1280 / (1600 / 900));
    expect(c.y + c.h / 2).toBeCloseTo(0.5);
  });

  it('shows all of a video the screen’s shape', () => {
    expect(cover(1280, 720, 640, 360)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('shows it all before the video has a size', () => {
    expect(cover(0, 0, 640, 360)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('gridOf', () => {
  it('covers the screen, overhanging both edges equally', () => {
    const g = gridOf(100, 50, 16);
    expect(g.across).toBe(7);
    expect(g.down).toBe(4);
    expect(g.offsetX).toBe(6);
    expect(g.offsetY).toBe(7);
  });

  it('fits exactly where it divides evenly', () => {
    expect(gridOf(64, 32, 16)).toEqual({ across: 4, down: 2, offsetX: 0, offsetY: 0 });
  });

  it('is one pixel a tile at 1', () => {
    expect(gridOf(30, 20, 1)).toEqual({ across: 30, down: 20, offsetX: 0, offsetY: 0 });
  });
});
