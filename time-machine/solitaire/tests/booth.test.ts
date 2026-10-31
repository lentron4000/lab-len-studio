import { describe, expect, it } from 'vitest';
import { fits, ovalOf, toScreen, toVideo, type Shown } from '../src/booth';
import { cover } from '../src/fit';
import { CARD_SHAPE } from '../src/solitaire';

const shown = (mirror: boolean): Shown => ({
  videoWidth: 1920,
  videoHeight: 1080,
  crop: cover(1920, 1080, 1440, 900),
  width: 1440,
  height: 900,
  mirror,
});

describe('ovalOf', () => {
  it('is a card’s shape, centred', () => {
    const o = ovalOf(1440, 900);
    expect(o.w / o.h).toBeCloseTo(CARD_SHAPE);
    expect(o.x + o.w / 2).toBeCloseTo(720);
    expect(o.y + o.h / 2).toBeCloseTo(450);
  });

  it('fits a narrow screen', () => {
    const o = ovalOf(390, 844);
    expect(o.x).toBeGreaterThanOrEqual(0);
    expect(o.x + o.w).toBeLessThanOrEqual(390);
  });
});

describe('toScreen and toVideo', () => {
  for (const mirror of [false, true]) {
    it(`go back and forth${mirror ? ', mirrored' : ''}`, () => {
      const box = { x: 300, y: 120, w: 200, h: 260 };
      const back = toScreen(toVideo(box, shown(mirror)), shown(mirror));
      expect(back.x).toBeCloseTo(box.x);
      expect(back.y).toBeCloseTo(box.y);
      expect(back.w).toBeCloseTo(box.w);
      expect(back.h).toBeCloseTo(box.h);
    });
  }

  it('mirrors: what’s on the camera’s left is on the screen’s right', () => {
    const left = { x: 100, y: 500, w: 50, h: 50 };
    expect(toScreen(left, shown(false)).x).toBeLessThan(720);
    expect(toScreen(left, shown(true)).x).toBeGreaterThan(720);
  });
});

describe('fits', () => {
  const oval = ovalOf(1440, 900);
  const face = (scale: number, dx = 0): { x: number; y: number; w: number; h: number } => {
    const w = oval.w * scale;
    return { x: oval.x + (oval.w - w) / 2 + dx, y: oval.y + (oval.h - w) / 2, w, h: w };
  };

  it('takes a face filling the oval', () => {
    expect(fits(face(0.7), oval)).toBe(true);
  });

  it('turns down one too small, too big, or off to a side', () => {
    expect(fits(face(0.3), oval)).toBe(false);
    expect(fits(face(1.2), oval)).toBe(false);
    expect(fits(face(0.7, oval.w * 0.4), oval)).toBe(false);
  });
});
