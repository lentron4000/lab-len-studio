// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { biquadStep, createBiquad, type Biquad } from './biquad';

/** Registered name of the onset AudioWorkletProcessor. */
export const ONSET_PROCESSOR = 'sound-toy-onset';

/** Analysis frames per second. 10 ms frames resolve kick attacks without a costly FFT. */
export const ANALYSIS_RATE = 100;

/** One 10 ms analysis frame. Onset values are rectified log-energy rises (natural-log units). */
export interface OnsetFrame {
  /** Audio-clock time of the frame centre, in seconds. */
  t: number;
  /** Onset strength in the kick band (< 120 Hz). */
  lo: number;
  /** Onset strength in the mids (250 Hz – 2.5 kHz): snares, claps, stabs. */
  mid: number;
  /** Onset strength in the highs (> 5 kHz): hats, shakers. */
  hi: number;
  /** Full-band level in dBFS. */
  level: number;
  /** Kick-band energy relative to its recent peak (0–1). */
  loLevel: number;
  /** Raw kick-band energy (mean square). */
  loEnergy: number;
}

const BAND_COUNT = 3;
/** Per-frame decay of each band's running peak (~4.6 s half-life at 100 frames/s). */
const PEAK_DECAY = 0.9985;
/** Energies are floored 30 dB below the band's recent peak, so noise and silence don't read as onsets. */
const FLOOR_RATIO = 1e-3;

/**
 * Turns raw samples into band onset strengths at 100 frames/s.
 *
 * Runs inside the AudioWorklet (real time, allocation-free per sample) and in Node for tests,
 * so it has no browser dependencies.
 */
export class OnsetCore {
  readonly hop: number;
  readonly fps: number;
  private readonly sampleRate: number;
  private readonly lo1: Biquad;
  private readonly lo2: Biquad;
  private readonly midHp: Biquad;
  private readonly midLp: Biquad;
  private readonly hiHp: Biquad;
  /** Accumulated energy for lo, mid, hi and full band over the current hop. */
  private readonly acc = new Float64Array(4);
  private readonly peak = new Float64Array(4).fill(1e-9);
  private readonly prevLog = new Float64Array(BAND_COUNT).fill(-30);
  private n = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.hop = Math.round(sampleRate / ANALYSIS_RATE);
    this.fps = sampleRate / this.hop;
    // Kick band is 4th order (two cascaded sections) so bass notes above it leak less.
    this.lo1 = createBiquad('lowpass', 120, Math.SQRT1_2, sampleRate);
    this.lo2 = createBiquad('lowpass', 120, Math.SQRT1_2, sampleRate);
    this.midHp = createBiquad('highpass', 250, Math.SQRT1_2, sampleRate);
    this.midLp = createBiquad('lowpass', 2500, Math.SQRT1_2, sampleRate);
    this.hiHp = createBiquad('highpass', 5000, Math.SQRT1_2, sampleRate);
  }

  /**
   * @param samples mono input block
   * @param startFrame audio-clock sample index of `samples[0]`
   * @param out receives one frame per completed hop
   */
  process(samples: Float32Array, startFrame: number, out: OnsetFrame[]): void {
    const acc = this.acc;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const lo = biquadStep(this.lo2, biquadStep(this.lo1, s));
      const mid = biquadStep(this.midLp, biquadStep(this.midHp, s));
      const hi = biquadStep(this.hiHp, s);
      acc[0] += lo * lo;
      acc[1] += mid * mid;
      acc[2] += hi * hi;
      acc[3] += s * s;
      if (++this.n === this.hop) {
        this.n = 0;
        out.push(this.emit((startFrame + i + 1 - this.hop / 2) / this.sampleRate));
      }
    }
  }

  private emit(t: number): OnsetFrame {
    const { acc, peak, prevLog, hop } = this;
    const onset = [0, 0, 0];
    const energy = [0, 0, 0, 0];
    for (let b = 0; b < 4; b++) {
      const e = acc[b] / hop;
      acc[b] = 0;
      energy[b] = e;
      peak[b] = Math.max(e, peak[b] * PEAK_DECAY);
      if (b < BAND_COUNT) {
        const log = Math.log(e + peak[b] * FLOOR_RATIO + 1e-12);
        onset[b] = Math.max(0, log - prevLog[b]);
        prevLog[b] = log;
      }
    }
    return {
      t,
      lo: onset[0],
      mid: onset[1],
      hi: onset[2],
      level: 10 * Math.log10(energy[3] + 1e-12),
      loLevel: energy[0] / peak[0],
      loEnergy: energy[0],
    };
  }
}
