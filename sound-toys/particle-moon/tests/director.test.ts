import { describe, expect, it } from 'vitest';
import { Director, type DirectorControls, type Scene } from '../src/auto/director';
import type { MusicFeatures } from '../src/auto/listener';

function setup(): {
  director: Director;
  sliders: Map<string, number>;
  options: Map<string, string>;
  hits: number[];
  pans: [number, number][];
} {
  const sliders = new Map<string, number>();
  const options = new Map<string, string>();
  const hits: number[] = [];
  const pans: [number, number][] = [];
  const controls: DirectorControls = {
    setSlider: (id, v) => sliders.set(id, v),
    setOption: (group, id) => options.set(group, id),
    fire: (s) => hits.push(s),
    pan: (x, y) => pans.push([x, y]),
  };
  const director = new Director(controls);
  director.start({ state: 0, depth: 0.5, spin: 0, orbit: 3 / 8, mforce: 0.5 });
  return { director, sliders, options, hits, pans };
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
    play(director, ambient, 10, 0);
    // State wanders (moves come and go), so judge it over the passage.
    let sum = 0;
    for (let k = 0; k < 20; k++) {
      play(director, ambient, 1, 10 + k);
      sum += sliders.get('state') ?? 0;
    }
    expect(['water', 'gas', 'attract']).toContain(options.get('mode'));
    expect(sum / 20).toBeGreaterThan(0.5);
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

  it('explores Spin and Orbit at each look: Disc at most half speed, Globe faster, poles only with the moon', () => {
    for (const f of [groove, ambient]) {
      const { director, sliders, options } = setup();
      play(director, f, 10, 0, 124);
      const spins = { disc: new Set<number>(), globe: new Set<number>() };
      const orbits = new Set<number>();
      const poles = new Set<string>();
      let t = 10;
      let settled = 0;
      let look = '';
      for (let bar = 0; bar < 600; bar++) {
        for (let b = 0; b < 4; b++) {
          director.beat();
          play(director, f, 60 / 124, t, 124);
          t += 60 / 124;
        }
        const now = `${options.get('mode')}/${options.get('shape')}/${options.get('moon')}`;
        settled = now === look ? settled + 1 : 0;
        look = now;
        expect(['gas', 'water']).toContain(options.get('mode'));
        if (options.get('moon') === 'off') expect(options.get('pole') ?? 'off').toBe('off');
        if (options.get('pole') && options.get('pole') !== 'off') poles.add(options.get('pole')!);
        if (settled < 10) continue; // let the sliders glide in
        const spin = sliders.get('spin') ?? 0;
        const shape = options.get('shape') === 'globe' ? 'globe' : 'disc';
        if (shape === 'disc') expect(spin).toBeLessThanOrEqual(4 / 8 + 0.01);
        spins[shape].add(Math.round(spin * 8));
        orbits.add(Math.round((sliders.get('orbit') ?? 0) * 8));
      }
      expect(spins.disc.size).toBeGreaterThanOrEqual(f === ambient ? 3 : 1);
      expect(Math.max(...spins.globe)).toBeGreaterThan(4);
      expect(orbits.size).toBeGreaterThanOrEqual(3);
      // With the moon on, a groove's looks put a pole over the physics now and then.
      if (f === groove) expect(poles.size).toBeGreaterThan(0);
    }
  });

  /** Plays `bars` of groove beat by beat; returns the bars (1-based) at which the look changed. */
  function lookChanges(
    director: Director,
    options: Map<string, string>,
    bars: number,
    f: MusicFeatures,
  ): number[] {
    const changes: number[] = [];
    let t = 10;
    let look = `${options.get('mode')}/${options.get('shape')}`;
    for (let bar = 1; bar <= bars; bar++) {
      for (let b = 0; b < 4; b++) {
        director.beat();
        play(director, f, 60 / 124, t, 124);
        t += 60 / 124;
      }
      const now = `${options.get('mode')}/${options.get('shape')}`;
      if (now !== look) changes.push(bar);
      look = now;
    }
    return changes;
  }

  it('changes the look every 12–32 bars, in 4-bar steps, sooner when the energy is high', () => {
    const mean = (f: MusicFeatures): number => {
      const { director, options } = setup();
      play(director, f, 10, 0, 124);
      const at = lookChanges(director, options, 400, f);
      const gaps = at.slice(1).map((b, i) => b - at[i]);
      for (const g of gaps) {
        expect(g).toBeGreaterThanOrEqual(12);
        expect(g).toBeLessThanOrEqual(32);
        expect(g % 4).toBe(0);
      }
      return gaps.reduce((a, b) => a + b, 0) / gaps.length;
    };
    const busy = mean({ ...groove, energy: 0.9, baseline: 0.6 });
    const calm = mean({ ...groove, energy: 0.3, baseline: 0.6 });
    expect(busy).toBeLessThan(calm);
  });

  it('pans slowly, staying near the middle', () => {
    const { director, pans } = setup();
    play(director, groove, 240, 0, 124);
    const xs = pans.map(([x]) => x);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(0.04);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.005);
    // Slow: never more than a sliver of the screen between frames.
    for (let i = 1; i < pans.length; i++) expect(Math.abs(pans[i][0] - pans[i - 1][0])).toBeLessThan(0.002);
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
    for (let beat = 0; beat < 4 * 400; beat++) {
      const before = [options.get('moon'), options.get('mode'), options.get('shape')];
      director.beat();
      play(director, groove, 60 / 124, t, 124);
      t += 60 / 124;
      const moonChanged = options.get('moon') !== before[0];
      const lookChanged = options.get('mode') !== before[1] || options.get('shape') !== before[2];
      if (moonChanged) expect(lookChanged).toBe(true);
      if (lookChanged) moons.push(options.get('moon') ?? '');
    }
    expect(moons).toContain('on');
    expect(moons).toContain('off');
  });

  it("keeps State and Depth moving phrase by phrase in a groove (it doesn't park)", () => {
    const { director, sliders } = setup();
    play(director, groove, 10, 0, 124);
    const states: number[] = [];
    const depths: number[] = [];
    let t = 10;
    for (let bar = 0; bar < 64; bar++) {
      for (let b = 0; b < 4; b++) {
        director.beat();
        play(director, groove, 60 / 124, t, 124);
        t += 60 / 124;
      }
      states.push(sliders.get('state') ?? 0);
      depths.push(sliders.get('depth') ?? 0);
    }
    const spread = (a: number[]): number => {
      const m = a.reduce((x, y) => x + y, 0) / a.length;
      return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
    };
    expect(spread(states)).toBeGreaterThan(0.08);
    expect(spread(depths)).toBeGreaterThan(0.03);
  });
});
