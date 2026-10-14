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

  it('plays ambient music well into Loose, and drops tight and deep', () => {
    const { director, sliders, options } = setup();
    play(director, ambient, 30, 0);
    expect(['water', 'gas', 'attract']).toContain(options.get('mode'));
    expect(sliders.get('state')).toBeGreaterThan(0.55);
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

  it('moves to a new look every four bars with a beat', () => {
    const { director, options } = setup();
    play(director, groove, 10, 0, 124);
    const looks: string[] = [];
    let t = 10;
    for (let bar = 0; bar < 12; bar++) {
      for (let b = 0; b < 4; b++) {
        director.beat();
        play(director, groove, 60 / 124, t, 124);
        t += 60 / 124;
      }
      looks.push(`${options.get('mode')}/${options.get('shape')}`);
    }
    // 12 bars: a change every 4 bars (3 changes), each to a different mode and shape.
    const changes = looks.filter((l, i) => i > 0 && l !== looks[i - 1]).length;
    expect(changes).toBe(3);
  });

  it('swings State open on each beat in a groove, and not in ambient music', () => {
    const { director, sliders } = setup();
    play(director, groove, 10, 0, 124);
    const before = sliders.get('state') ?? 0;
    director.beat();
    play(director, groove, 0.05, 10, 124);
    expect((sliders.get('state') ?? 0) - before).toBeGreaterThan(0.08);
    const ambientRun = setup();
    play(ambientRun.director, ambient, 10, 0);
    const still = ambientRun.sliders.get('state') ?? 0;
    ambientRun.director.beat();
    play(ambientRun.director, ambient, 0.05, 10);
    expect(Math.abs((ambientRun.sliders.get('state') ?? 0) - still)).toBeLessThan(0.02);
  });

  it('keeps deep Depth for a strong kick', () => {
    const weak = setup();
    play(weak.director, breakdown, 8, 0);
    play(weak.director, { ...drop, kickStrength: 0.6 }, 4, 8);
    expect(weak.sliders.get('depth')).toBeLessThan(0.75);
    const strong = setup();
    play(strong.director, breakdown, 8, 0);
    play(strong.director, drop, 4, 8);
    expect(strong.sliders.get('depth')).toBeGreaterThan(0.9);
  });

  it('switches the moon only on the look changes, and not always the same way', () => {
    const { director, options } = setup();
    play(director, groove, 10, 0, 124);
    const moons: string[] = [];
    let t = 10;
    for (let bar = 0; bar < 64; bar++) {
      for (let b = 0; b < 4; b++) {
        const before = options.get('moon');
        director.beat();
        play(director, groove, 60 / 124, t, 124);
        t += 60 / 124;
        const changedHere = options.get('moon') !== before;
        // Only on a bar that starts a new look (every 4 bars).
        if (changedHere) expect((bar * 4 + b + 1) % 16).toBe(0);
      }
      if (bar % 4 === 3) moons.push(options.get('moon') ?? '');
    }
    expect(moons).toContain('on');
    expect(moons).toContain('off');
  });
});
