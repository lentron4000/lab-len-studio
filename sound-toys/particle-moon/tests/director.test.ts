import { describe, expect, it } from 'vitest';
import { Director, type DirectorControls, type Scene } from '../src/auto/director';
import type { MusicFeatures } from '../src/auto/listener';

function setup(): {
  director: Director;
  sliders: Map<string, number>;
  options: Map<string, string>;
  hits: number[];
} {
  const sliders = new Map<string, number>();
  const options = new Map<string, string>();
  const hits: number[] = [];
  const controls: DirectorControls = {
    setSlider: (id, v) => sliders.set(id, v),
    setOption: (group, id) => options.set(group, id),
    fire: (s) => hits.push(s),
  };
  const director = new Director(controls);
  director.start({ state: 0, depth: 0.5, spin: 0, mforce: 0.5 });
  return { director, sliders, options, hits };
}

/** Plays `seconds` of music with these features, 60 frames a second. Returns the scenes seen. */
function play(director: Director, f: MusicFeatures, seconds: number, from: number, bpm = 0): Scene[] {
  const seen: Scene[] = [];
  for (let s = 0; s < seconds * 60; s++) {
    director.update(f, 1 / 60, from + s / 60, bpm);
    if (seen.at(-1) !== director.scene) seen.push(director.scene);
  }
  return seen;
}

const ambient: MusicFeatures = {
  loud: 0.3,
  energy: 0.3,
  baseline: 0.3,
  brightness: 0.4,
  kickRate: 0,
  kickStrength: 0,
  rise: 0,
  shimmer: 0,
  hatRate: 0,
};
const groove: MusicFeatures = {
  ...ambient,
  energy: 0.6,
  baseline: 0.55,
  kickRate: 1.6,
  kickStrength: 0.9,
  hatRate: 4,
};
const breakdown: MusicFeatures = { ...ambient, energy: 0.35, baseline: 0.5, kickRate: 0, rise: -0.2 };
const build: MusicFeatures = { ...breakdown, energy: 0.5, rise: 0.5, brightness: 0.7 };
const drop: MusicFeatures = { ...groove, energy: 0.8, baseline: 0.5, kickStrength: 1.2 };

describe('AI mode', () => {
  it('follows a track: drift, groove, breakdown, build, drop', () => {
    const { director, hits } = setup();
    let t = 0;
    expect(play(director, ambient, 20, t)).toEqual(['drift']);
    t += 20;
    expect(play(director, groove, 20, t)).toContain('groove');
    t += 20;
    expect(play(director, breakdown, 12, t)).toContain('breakdown');
    t += 12;
    expect(play(director, build, 12, t)).toContain('build');
    t += 12;
    const end = play(director, drop, 6, t);
    expect(end[0]).toBe('drop');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('plays ambient music loose and liquid, and drops tight and deep', () => {
    const { director, sliders, options } = setup();
    play(director, ambient, 30, 0);
    expect(options.get('mode')).toBe('water');
    expect(sliders.get('state')).toBeGreaterThan(0.4);
    play(director, groove, 10, 30);
    play(director, breakdown, 8, 40);
    play(director, drop, 4, 48);
    expect(sliders.get('state')).toBeLessThan(0.05);
    expect(sliders.get('depth')).toBeGreaterThan(0.9);
  });

  it('leaves a control alone once the performer touches it', () => {
    const { director, sliders } = setup();
    play(director, ambient, 5, 0);
    director.touch('state');
    sliders.delete('state');
    play(director, groove, 20, 5);
    expect(sliders.has('state')).toBe(false);
    play(director, groove, 20, 25); // handed back after 30 s
    expect(sliders.has('state')).toBe(true);
  });

  it('spins to the tempo with the kick, and at a slower division of it without', () => {
    const { director, sliders } = setup();
    play(director, groove, 20, 0, 124);
    // 124 bpm: about five seconds a turn is 2 bars (Spin step 5 of 8).
    expect(sliders.get('spin')).toBeCloseTo(5 / 8, 1);
    play(director, breakdown, 15, 20, 124);
    expect(sliders.get('spin')).toBeLessThan(4 / 8);
  });
});
