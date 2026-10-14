import { describe, expect, it } from 'vitest';
import { labMode } from '../src/lab-mode';

describe('lab mode', () => {
  it('is the plain toy without a parameter: free to switch looks, no formations', () => {
    expect(labMode('')).toMatchObject({ look: null, formations: false });
  });

  it('locks the look named by ?m=', () => {
    expect(labMode('?m=night')).toMatchObject({ look: 'night', formations: false });
    expect(labMode('?m=ritual')).toMatchObject({ look: 'ritual', formations: true });
    expect(labMode('?m=RITUAL').name).toBe('ritual');
  });

  it('unlocks everything in len mode', () => {
    expect(labMode('?m=len')).toMatchObject({ look: null, formations: true });
  });

  it('falls back to the build default, then day, for unknown names', () => {
    expect(labMode('?m=nope')).toMatchObject({ name: 'day' });
    expect(labMode('?m=toString').name).toBe('day');
    expect(labMode('', 'ritual').name).toBe('ritual');
    expect(labMode('?m=night', 'ritual').name).toBe('night');
  });
});
