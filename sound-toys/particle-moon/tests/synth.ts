// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/**
 * Synthetic test tracks with known tempo and kick times: pitched-sine kicks, noise snares and hats,
 * an off-beat bass and a pad. Deterministic (seeded xorshift) so test results are reproducible.
 */

export const SAMPLE_RATE = 48000;

/** [position in beats within the bar, gain, decay seconds] */
export type Hit = readonly [beat: number, gain: number, decay: number];

export interface TrackSpec {
  bpm: number;
  seconds: number;
  /** Kick positions in beats within a 4-beat bar. */
  kicks: readonly number[];
  snares?: readonly number[];
  hats?: readonly Hit[];
  bass?: boolean;
  pad?: number;
  kickGain?: number;
  /** [start, end) seconds with no kick, snare or bass. */
  breakdown?: readonly [number, number];
}

export interface Track {
  samples: Float32Array;
  kickTimes: number[];
  beatSeconds: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s / 4294967295) * 2 - 1;
  };
}

export function renderTrack(spec: TrackSpec, seed = 2463534242): Track {
  const rand = rng(seed);
  const { bpm, seconds, kicks, snares = [], hats = [], bass = false, pad = 0.05, kickGain = 0.9 } = spec;
  const n = Math.round(seconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  const beat = 60 / bpm;
  const inBreak = (t: number): boolean =>
    spec.breakdown !== undefined && t >= spec.breakdown[0] && t < spec.breakdown[1];
  const add = (start: number, length: number, fn: (t: number) => number): void => {
    const a = Math.round(start * SAMPLE_RATE);
    const len = Math.round(length * SAMPLE_RATE);
    for (let i = 0; i < len && a + i < n; i++) if (a + i >= 0) out[a + i] += fn(i / SAMPLE_RATE);
  };

  const kickTimes: number[] = [];
  const bars = Math.ceil(seconds / (4 * beat));
  for (let bar = 0; bar < bars; bar++) {
    for (const p of kicks) {
      const t = (bar * 4 + p) * beat;
      if (t >= seconds || inBreak(t)) continue;
      kickTimes.push(t);
      let phase = 0;
      add(t, 0.45, (s) => {
        phase += (2 * Math.PI * (45 + 110 * Math.exp(-s / 0.03))) / SAMPLE_RATE;
        return kickGain * Math.sin(phase) * Math.exp(-s / 0.18);
      });
    }
    for (const p of snares) {
      const t = (bar * 4 + p) * beat;
      if (t >= seconds || inBreak(t)) continue;
      add(
        t,
        0.25,
        (s) =>
          0.35 * (rand() * Math.exp(-s / 0.08) + 0.5 * Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s / 0.05)),
      );
    }
    for (const [p, gain, decay] of hats) {
      const t = (bar * 4 + p) * beat;
      if (t >= seconds) continue;
      let prev = 0;
      add(t, decay * 5, (s) => {
        const noise = rand();
        const highpassed = noise - prev;
        prev = noise;
        return gain * highpassed * Math.exp(-s / decay);
      });
    }
  }
  if (bass) {
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const pos = (t / beat) % 1;
      if (!inBreak(t) && pos > 0.5)
        out[i] += 0.25 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-(pos - 0.5) * 3);
    }
  }
  if (pad) {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp = 0.995 * lp + 0.005 * rand();
      out[i] +=
        pad * 8 * lp +
        pad * 0.3 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * Math.sin((i / SAMPLE_RATE) * 0.7);
    }
  }
  return { samples: out, kickTimes, beatSeconds: beat };
}

const hats8: Hit[] = [0.5, 1.5, 2.5, 3.5].map((p) => [p, 0.25, 0.04] as const);
const hats16: Hit[] = Array.from({ length: 16 }, (_, k) => [k / 4, 0.08, 0.012] as const);

export const TRACKS = {
  house: {
    bpm: 124,
    seconds: 40,
    kicks: [0, 1, 2, 3],
    hats: [...hats8, ...hats16],
    bass: true,
    breakdown: [16, 24],
  },
  techno: { bpm: 132, seconds: 30, kicks: [0, 1, 2, 3], hats: hats16, bass: true },
  fractional: { bpm: 122.5, seconds: 30, kicks: [0, 1, 2, 3], hats: hats8 },
  downtempo: {
    bpm: 87,
    seconds: 30,
    kicks: [0, 2],
    snares: [1, 3],
    hats: [0, 1, 2, 3, 0.5, 1.5, 2.5, 3.5].map((p) => [p, 0.12, 0.03] as const),
  },
  dubstep: { bpm: 140, seconds: 30, kicks: [0], snares: [2], hats: hats8 },
  dnb: {
    bpm: 174,
    seconds: 30,
    kicks: [0, 2.5],
    snares: [1, 3],
    hats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((p) => [p, 0.15, 0.02] as const),
  },
  ambientSoftKick: { bpm: 75, seconds: 30, kicks: [0, 2], kickGain: 0.35, pad: 0.25 },
  ambientNoBeat: { bpm: 100, seconds: 25, kicks: [], pad: 0.3 },
} satisfies Record<string, TrackSpec>;
