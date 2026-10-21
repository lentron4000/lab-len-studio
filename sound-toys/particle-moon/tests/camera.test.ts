import { describe, expect, it } from 'vitest';
import { Camera } from '../src/sim/camera';

/** Where the camera puts the shape's front point (0, 0, 1). */
const front = (c: Camera): number[] => [c.matrix[2], c.matrix[5], c.matrix[8]];

describe('camera', () => {
  it('starts straight on', () => {
    const c = new Camera();
    c.tick(1 / 60);
    expect(c.straight).toBe(true);
    expect(front(c)).toEqual([0, 0, 1]);
  });

  it('turns the front the way it is pulled: right, then down', () => {
    const right = new Camera();
    right.drag(100, 0, 1 / 60, 300);
    right.tick(0);
    expect(front(right)[0]).toBeGreaterThan(0.3);
    const down = new Camera();
    down.drag(0, 100, 1 / 60, 300);
    down.tick(0);
    expect(front(down)[1]).toBeGreaterThan(0.3);
  });

  it('drifts on after a flick, then stops where it is', () => {
    const c = new Camera();
    for (let k = 0; k < 5; k++) c.drag(20, 0, 1 / 60, 300);
    c.release();
    c.tick(0);
    const atRelease = front(c)[0];
    for (let k = 0; k < 60; k++) c.tick(1 / 60);
    const later = front(c)[0];
    expect(later).toBeGreaterThan(atRelease);
    for (let k = 0; k < 600; k++) c.tick(1 / 60);
    const settled = front(c);
    c.tick(1 / 60);
    expect(front(c)).toEqual(settled);
    expect(c.straight).toBe(false);
  });

  it('resets smoothly back to straight on', () => {
    const c = new Camera();
    c.drag(250, -120, 1 / 60, 300);
    c.release();
    c.reset();
    c.tick(0.3);
    expect(c.straight).toBe(false);
    for (let k = 0; k < 120; k++) c.tick(1 / 60);
    expect(c.straight).toBe(true);
    expect(front(c)[2]).toBeCloseTo(1, 6);
  });

  it('glides to a set angle and stays there', () => {
    const c = new Camera();
    c.glideTo(0.5, 0, 2);
    c.tick(1);
    expect(front(c)[0]).toBeGreaterThan(0.05);
    expect(front(c)[0]).toBeLessThan(Math.sin(0.5) - 0.05);
    for (let k = 0; k < 120; k++) c.tick(1 / 60);
    expect(front(c)[0]).toBeCloseTo(Math.sin(0.5), 6);
    expect(front(c)[1]).toBeCloseTo(0, 6);
    c.glideTo(0, 0.4, 1);
    for (let k = 0; k < 90; k++) c.tick(1 / 60);
    // Positive pitch tips the front up the screen, as a pull up does.
    expect(front(c)[1]).toBeCloseTo(-Math.sin(0.4), 6);
  });
});
