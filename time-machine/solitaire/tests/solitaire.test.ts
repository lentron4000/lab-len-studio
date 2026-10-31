import { describe, expect, it } from 'vitest';
import { deal, PILES, step } from '../src/solitaire';

const W = 1600;
const H = 900;
/** Not random: always the middle. */
const half = (): number => 0.5;

describe('deal', () => {
  it('deals from the piles along the top right, each a playing card', () => {
    const cards = Array.from({ length: PILES }, (_, i) => deal(W, H, i, half));
    for (const c of cards) {
      expect(c.w / c.h).toBeCloseTo(2.5 / 3.5);
      expect(c.y).toBeLessThan(H * 0.1);
      expect(c.x + c.w).toBeLessThanOrEqual(W);
    }
    // Left to right, the last nearest the right edge.
    expect(cards[1].x).toBeGreaterThan(cards[0].x);
    expect(cards[PILES - 1].x + cards[PILES - 1].w).toBeGreaterThan(W * 0.9);
  });
});

describe('step', () => {
  it('falls, bounces off the bottom keeping some of its speed, and goes off a side', () => {
    const c = deal(W, H, 0, half);
    const bounces: number[] = [];
    let steps = 0;
    while (step(c, 1 / 60, W, H) && steps < 60 * 30) {
      steps++;
      if (c.y + c.h >= H - 0.001 && c.vy < 0) bounces.push(-c.vy);
      expect(c.y + c.h).toBeLessThanOrEqual(H + 0.001);
    }
    // It bounced, the second time lower than the first.
    expect(bounces.length).toBeGreaterThan(1);
    expect(bounces[1]).toBeLessThan(bounces[0]);
    expect(steps).toBeLessThan(60 * 30);
    expect(c.x + c.w <= 0 || c.x >= W).toBe(true);
  });

  it('starts straight, and turns a little once it bounces', () => {
    const c = deal(W, H, 0, half);
    expect(c.angle).toBe(0);
    let kicks = 0;
    const kick = (): number => (kicks++, 1);
    while (step(c, 1 / 60, W, H, kick) && c.spin === 0);
    expect(kicks).toBe(1);
    expect(Math.abs(c.spin)).toBeGreaterThan(0);
    expect(Math.abs(c.spin)).toBeLessThan(2);
  });
});
