// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { fitSlope } from '../lib/math';
import type { OnsetFrame } from './onset-core';

export type TrackerState = 'locked' | 'silent' | 'listening' | 'tracking' | 'holding';

/** Where the winning tempo estimate came from. */
export type CombSource = 'onset' | 'kick';

// ---- Tuning (frames are 10 ms) ----
const HISTORY_FRAMES = 1200; // 12 s ring buffer
const ESTIMATE_EVERY = 50; // re-estimate tempo every 0.5 s
const ESTIMATE_WINDOW = 1000; // autocorrelate the last 10 s
const MIN_FRAMES = 400; // need 4 s before the first estimate
const BPM_MIN = 60;
const BPM_MAX = 190;
const BPM_STEP = 0.25;
/** Tempo prior: log-normal around 120 BPM, σ = 0.75 octave. Breaks ties between 70/140 and 87/174. */
const PRIOR_CENTRE = 120;
const PRIOR_OCTAVES = 0.75;
/** Minimum periodicity for each comb (mean normalised autocorrelation at the beat and its multiples). */
const ONSET_THRESHOLD = 0.12;
/** A sparse kick train correlates by chance more easily, so it needs a higher bar. */
const KICK_THRESHOLD = 0.24;
const SILENCE_DB = -55;
/** A kick is the kick band's 20 ms energy jumping this many times over its previous 150 ms (~7 dB). */
const KICK_RATIO = 5;
const KICK_MIN_LEVEL = 0.15;
const KICK_MIN_GAP = 0.18;
/** Kick detection lands ~8 ms after the attack; the beat clock is corrected by this much. */
const KICK_LATENCY = 0.008;
/** Phase-lock window: onsets further than this fraction of a beat from the grid are ignored. */
const PLL_WINDOW = 0.1;
const PLL_PHASE_GAIN = 0.25;
const PLL_PERIOD_GAIN = 0.02;
const PERIOD_CLAMP = 0.015;

/**
 * Tempo, beat phase and kick detection for electronic and ambient music.
 *
 * - **Tempo**: autocorrelation of an onset function, scored as a comb over the beat and its first
 *   three multiples, weighted by a tempo prior. Run on both the full onset function and on the train
 *   of detected kicks; the more periodic one wins, so a quiet kick under a loud pad still sets tempo.
 * - **Beat clock**: a phase-locked loop driven by kicks (or onset peaks when there are none), refined
 *   by a least-squares fit of matched beats for sub-millisecond period accuracy, and checked every
 *   0.5 s by a phase comb so it can't stay stuck on the off-beat.
 * - **Holding**: when the beat drops out (breakdowns, silence) the clock keeps running at the last tempo.
 *
 * All times are seconds on whatever clock the caller uses for `push` (the audio clock in the app).
 */
export class TempoTracker {
  readonly fps: number;

  // Ring buffers, one entry per frame.
  private readonly tempoOnsets = new Float32Array(HISTORY_FRAMES); // kick-weighted, all bands
  private readonly phaseOnsets = new Float32Array(HISTORY_FRAMES); // kick-centric
  private readonly levels = new Float32Array(HISTORY_FRAMES);
  private readonly kickEnergy = new Float32Array(HISTORY_FRAMES);
  private readonly kickTrain = new Float32Array(HISTORY_FRAMES);
  private readonly times = new Float64Array(HISTORY_FRAMES);
  private n = 0;

  // Tempo estimate.
  private bpmEstimate = 0;
  private fineBpm = 0;
  private pendingBpm = 0;
  private pendingCount = 0;
  private _confidence = 0;
  private _strength = 0;
  private _combSource: CombSource = 'onset';
  private _octave = 1;
  private _locked = false;

  // Beat clock.
  private period = 0;
  private phaseRef = 0;
  private hasPhase = false;
  private refBeat = 0;
  private matched: [beat: number, time: number][] = [];
  private pendingPhase = 0;
  private phaseVotes = 0;

  private lastKick = -Infinity;
  private lastMatch = -Infinity;
  private lastPeak = -Infinity;
  private silent = true;

  constructor(fps: number) {
    this.fps = fps;
  }

  get bpm(): number {
    return this.bpmEstimate;
  }
  /** 0–1: how far the winning comb clears its threshold. */
  get confidence(): number {
    return this._confidence;
  }
  /** Winning comb strength relative to its threshold (1 = just periodic enough). */
  get strength(): number {
    return this._strength;
  }
  get combSource(): CombSource {
    return this._combSource;
  }
  /** Tempo multiplier applied with ½ / ×2. */
  get octave(): number {
    return this._octave;
  }
  get locked(): boolean {
    return this._locked;
  }

  /**
   * Adds one analysis frame. `t` is the frame time on the caller's clock.
   * @returns kick strength 0–1 if this frame is a kick, otherwise 0
   */
  push(frame: OnsetFrame, t: number): number {
    const i = this.n % HISTORY_FRAMES;
    this.tempoOnsets[i] = frame.lo + 0.5 * frame.mid + 0.25 * frame.hi;
    this.phaseOnsets[i] = frame.lo + 0.3 * frame.mid + 0.1 * frame.hi;
    this.levels[i] = frame.level;
    this.kickEnergy[i] = frame.loEnergy;
    this.times[i] = t;
    this.kickTrain[i] = 0;
    this.n++;

    this.silent = this.countAbove(this.levels, Math.min(100, this.n), SILENCE_DB) < 5;

    const kick = this.detectKick(frame, t);
    if (kick) {
      this.tempoOnsets[i] += 2 * kick;
      this.phaseOnsets[i] += 2 * kick;
      this.kickTrain[i] = kick;
      this.onOnset(t - KICK_LATENCY, 1);
    }
    this.pickOnsetPeak(t);
    if (this.n % ESTIMATE_EVERY === 0) this.estimate();
    return kick;
  }

  /** Beat times in (t0, t1], on the caller's clock. */
  beats(t0: number, t1: number): number[] {
    if (!this.period || !this.hasPhase) return [];
    const out: number[] = [];
    const k = Math.floor((t0 - this.phaseRef) / this.period) + 1;
    for (let tb = this.phaseRef + k * this.period; tb <= t1; tb += this.period) out.push(tb);
    return out;
  }

  /** Tempo for display: the fitted value when tracking, snapped to a whole number when within 0.12. */
  displayBpm(): number {
    const b = this.fineBpm && !this._locked ? this.fineBpm : this.bpmEstimate;
    if (!b) return 0;
    const r = Math.round(b);
    return Math.abs(b - r) < 0.12 ? r : Math.round(b * 10) / 10;
  }

  state(now: number): TrackerState {
    if (this._locked) return 'locked';
    if (this.silent) return 'silent';
    if (!this.bpmEstimate || this.lastMatch === -Infinity) return 'listening';
    return now - this.lastMatch < 4 * this.period ? 'tracking' : 'holding';
  }

  /** Fixes the tempo (tap tempo, demo). `beatTime` is the time of any beat, to set the phase. */
  setManual(bpm: number, beatTime?: number): void {
    this.bpmEstimate = bpm;
    this.period = 60 / bpm;
    this._locked = true;
    if (beatTime !== undefined) {
      this.phaseRef = beatTime;
      this.hasPhase = true;
    }
  }

  /** Back to detection: forget the manual or octave-shifted tempo so the next estimate sets it fresh. */
  unlock(): void {
    this._locked = false;
    this._octave = 1;
    this.pendingBpm = 0;
    this.bpmEstimate = 0;
    this.fineBpm = 0;
    this.matched = [];
    this.hasPhase = false;
  }

  /** ½ (factor 0.5) or ×2 (factor 2). Sticks for later estimates until `unlock`. */
  scale(factor: number): void {
    if (!this._locked) this._octave *= factor;
    if (this.bpmEstimate) {
      this.bpmEstimate *= factor;
      this.period /= factor;
    }
    this.matched = [];
    this.fineBpm = 0;
    // New grid: choose its phase fresh from the last 4 s rather than inheriting the old one.
    if (this.n >= MIN_FRAMES) {
      this.hasPhase = false;
      this.checkPhase();
    }
  }

  // ---------------------------------------------------------------- detection

  private detectKick(frame: OnsetFrame, t: number): number {
    if (this.silent || this.n <= 20) return 0;
    const recent = this.at(this.kickEnergy, 0) + this.at(this.kickEnergy, 1);
    let base = 0;
    for (let k = 2; k < 17; k++) base += this.at(this.kickEnergy, k);
    base = (base / 15) * 2;
    if (
      recent <= KICK_RATIO * base + 1e-12 ||
      frame.loLevel <= KICK_MIN_LEVEL ||
      t - this.lastKick <= KICK_MIN_GAP
    ) {
      return 0;
    }
    this.lastKick = t;
    return Math.min(1, 0.35 + 0.65 * Math.sqrt(Math.min(1, frame.loLevel * 1.5)));
  }

  /** Onset peaks drive the beat clock only when no kicks have been heard for 2 s (ambient, breaks). */
  private pickOnsetPeak(t: number): void {
    if (this.n <= 6 || this.silent) return;
    const c = 2; // look two frames ahead
    const v = this.at(this.phaseOnsets, c);
    for (let k = 0; k <= 5; k++) if (k !== c && this.at(this.phaseOnsets, k) > v) return;
    const [mean, sd] = this.stats(this.phaseOnsets, 100);
    const tp = this.at(this.times, c);
    if (v > Math.max(0.3, mean + sd) && tp - this.lastPeak > 0.05 && t - this.lastKick > 2) {
      this.lastPeak = tp;
      this.onOnset(tp, Math.min(1, v / (mean + 3 * sd + 1e-6)));
    }
  }

  /** Phase-locked loop update from one onset at time `tp` with weight `w`. */
  private onOnset(tp: number, w: number): void {
    if (!this.period) return;
    if (!this.hasPhase) {
      this.phaseRef = tp;
      this.hasPhase = true;
      this.matched = [];
      return;
    }
    const k = Math.round((tp - this.phaseRef) / this.period);
    const err = tp - (this.phaseRef + k * this.period);
    if (Math.abs(err) >= PLL_WINDOW * this.period) return;
    this.phaseRef += k * this.period + PLL_PHASE_GAIN * w * err;
    this.refBeat += k;
    if (!this._locked && this.bpmEstimate) {
      const p0 = 60 / this.bpmEstimate;
      this.period = clampPeriod(this.period + PLL_PERIOD_GAIN * w * err, p0);
      this.fitPeriod(tp);
    }
    this.lastMatch = tp;
  }

  /** Least-squares line through matched beats: its slope is the period, far finer than the 10 ms frame grid. */
  private fitPeriod(tp: number): void {
    const m = this.matched;
    m.push([this.refBeat, tp]);
    while (m.length > 32 || (m.length > 0 && tp - m[0][1] > 16)) m.shift();
    if (m.length < 8 || m[m.length - 1][0] - m[0][0] < 8) return;
    const fitted = fitSlope(
      m.map((p) => p[1]),
      m.map((p) => p[0]),
    );
    const p0 = 60 / this.bpmEstimate;
    if (!(fitted > p0 * (1 - PERIOD_CLAMP) && fitted < p0 * (1 + PERIOD_CLAMP))) return;
    this.fineBpm = 60 / fitted;
    this.period += 0.3 * (fitted - this.period);
  }

  // ---------------------------------------------------------------- tempo

  private estimate(): void {
    const w = Math.min(this.n, ESTIMATE_WINDOW);
    if (w < MIN_FRAMES || this.silent) {
      this._confidence *= 0.8;
      return;
    }
    const onset = this.comb(this.tempoOnsets, w, false);
    const kick = this.comb(this.kickTrain, w, true);
    // A short window gives a noisier autocorrelation, so the bar rises as the window shrinks (×1.58 at 4 s).
    const shortWindow = Math.sqrt(ESTIMATE_WINDOW / w);
    const qOnset = onset.strength / (ONSET_THRESHOLD * shortWindow);
    const qKick = kick.strength / (KICK_THRESHOLD * shortWindow);
    const useKick = qKick > qOnset;
    this._strength = Math.max(qOnset, qKick);
    this._combSource = useKick ? 'kick' : 'onset';
    this.decide((useKick ? kick.bpm : onset.bpm) * this._octave);
  }

  /** Autocorrelation comb over BPM_MIN..BPM_MAX. Returns the prior-weighted best and its raw strength. */
  private comb(source: Float32Array, w: number, spread: boolean): { bpm: number; strength: number } {
    const fps = this.fps;
    let x = new Float32Array(w);
    for (let k = 0; k < w; k++) x[w - 1 - k] = this.at(source, k);
    if (spread) {
      // Spread each kick over ±2 frames so ±10 ms jitter still correlates.
      const kernel = [0.25, 0.6, 1, 0.6, 0.25];
      const y = new Float32Array(w);
      for (let k = 0; k < w; k++) {
        if (!x[k]) continue;
        for (let j = -2; j <= 2; j++) if (k + j >= 0 && k + j < w) y[k + j] += x[k] * kernel[j + 2];
      }
      x = y;
    }
    let mean = 0;
    for (let k = 0; k < w; k++) mean += x[k];
    mean /= w;
    for (let k = 0; k < w; k++) x[k] -= mean;

    const lagMax = Math.min(w - 1, Math.ceil(4 * fps) + 2);
    const r = new Float32Array(lagMax + 1);
    for (let lag = 0; lag <= lagMax; lag++) {
      let s = 0;
      for (let k = 0; k + lag < w; k++) s += x[k] * x[k + lag];
      r[lag] = s / (w - lag);
    }
    const r0 = r[0] || 1e-9;
    const rAt = (lag: number): number => {
      const a = Math.floor(lag);
      const f = lag - a;
      return a + 1 > lagMax ? 0 : (r[a] * (1 - f) + r[a + 1] * f) / r0;
    };

    const count = Math.round((BPM_MAX - BPM_MIN) / BPM_STEP) + 1;
    const raw = new Float32Array(count);
    let best = 0;
    let bi = 0;
    for (let j = 0; j < count; j++) {
      const bpm = BPM_MIN + j * BPM_STEP;
      const lag = (fps * 60) / bpm;
      let s = 0;
      let terms = 0;
      for (let k = 1; k <= 4; k++) {
        const l = k * lag;
        if (l <= lagMax && l < w * 0.6) {
          s += rAt(l);
          terms++;
        }
      }
      raw[j] = Math.max(0, s / Math.max(1, terms));
      const octaves = Math.log2(bpm / PRIOR_CENTRE) / PRIOR_OCTAVES;
      const weighted = raw[j] * Math.exp(-0.5 * octaves * octaves);
      if (weighted > best) {
        best = weighted;
        bi = j;
      }
    }
    // Parabolic refinement on the unweighted scores: the prior's slope would bias it.
    let offset = 0;
    if (bi > 0 && bi < count - 1) {
      const a = raw[bi - 1];
      const b = raw[bi];
      const c = raw[bi + 1];
      const den = a - 2 * b + c;
      if (den < 0) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    }
    return { bpm: BPM_MIN + (bi + offset) * BPM_STEP, strength: raw[bi] };
  }

  /**
   * Hysteresis: the first lock and any real tempo change need two agreeing estimates (chance peaks in
   * noise rarely repeat), small changes ease in, and octave flips are ignored.
   */
  private decide(bpm: number): void {
    if (this._strength < 1) {
      this._confidence *= 0.85;
      this.checkPhase();
      return;
    }
    this._confidence = Math.min(1, (this._strength - 1) / 1.5);
    if (this._locked) {
      this.checkPhase();
      return;
    }
    if (!this.bpmEstimate) {
      this.vote(bpm);
    } else {
      const rel = bpm / this.bpmEstimate;
      if (Math.abs(rel - 1) < 0.03) {
        this.bpmEstimate += 0.3 * ((this.fineBpm || bpm) - this.bpmEstimate);
        if (!this.fineBpm) this.period += 0.2 * (60 / this.bpmEstimate - this.period);
        this.pendingBpm = 0;
      } else if (Math.abs(rel - 2) < 0.06 || Math.abs(rel - 0.5) < 0.03) {
        this.pendingBpm = 0;
      } else {
        this.vote(bpm);
      }
    }
    this.checkPhase();
  }

  /** Adopts `bpm` once two consecutive estimates agree within 3%. */
  private vote(bpm: number): void {
    if (this.pendingBpm && Math.abs(bpm / this.pendingBpm - 1) < 0.03) {
      if (++this.pendingCount >= 2) this.setBpm(bpm);
    } else {
      this.pendingBpm = bpm;
      this.pendingCount = 1;
    }
  }

  private setBpm(bpm: number): void {
    this.bpmEstimate = bpm;
    this.period = 60 / bpm;
    this.pendingBpm = 0;
    this.pendingPhase = 0;
    this.phaseVotes = 0;
    this.matched = [];
    this.fineBpm = 0;
    this.hasPhase = false;
  }

  /**
   * Phase comb over the last 4 s: finds where the beat grid best lines up with onsets and kicks.
   * Moves the clock only after three consistent votes, so it can't flicker between candidates.
   */
  private checkPhase(): void {
    if (!this.period || this.n < MIN_FRAMES || this.silent) return;
    const fps = this.fps;
    const P = this.period;
    const tNow = this.at(this.times, 0);
    const span = 4;
    const useKicks = tNow - this.lastKick < 2;
    const limit = Math.min(this.n, HISTORY_FRAMES) - 3;
    const frames = Math.min(limit, Math.round(span * fps));

    // Evidence: onsets plus the kick train (spread ±2 frames), each normalised by its own mean.
    let sumOnset = 0;
    let sumKick = 0;
    for (let k = 0; k < frames; k++) {
      sumOnset += this.at(this.phaseOnsets, k);
      sumKick += this.at(this.kickTrain, k);
    }
    const gOnset = frames / (sumOnset + 1e-9);
    const gKick = useKicks && sumKick > 0 ? frames / (5 * sumKick) : 0;
    const kickAt = (a: number): number => (a >= 0 && a < limit ? this.at(this.kickTrain, a) : 0);
    const evidence = (a: number): number => {
      if (a < 0 || a >= limit) return 0;
      let v = this.at(this.phaseOnsets, a) * gOnset;
      if (gKick) {
        v +=
          (kickAt(a) + 0.6 * (kickAt(a + 1) + kickAt(a - 1)) + 0.25 * (kickAt(a + 2) + kickAt(a - 2))) *
          gKick;
      }
      return v;
    };
    const sample = (back: number): number => {
      const a = Math.floor(back);
      const f = back - a;
      return evidence(a) * (1 - f) + evidence(a + 1) * f;
    };
    const score = (phi: number): number => {
      let s = 0;
      for (let t = phi; t < span; t += P) s += sample(t * fps);
      return s;
    };

    let bestPhi = 0;
    let bestScore = -1;
    for (let phi = 0; phi < P; phi += 1 / fps) {
      const s = score(phi);
      if (s > bestScore) {
        bestScore = s;
        bestPhi = phi;
      }
    }
    if (!this.hasPhase) {
      this.phaseRef = tNow - bestPhi;
      this.hasPhase = true;
      this.matched = [];
      return;
    }
    const current = (((tNow - this.phaseRef) % P) + P) % P;
    if (circularDistance(current, bestPhi, P) > 0.12 * P && bestScore > 1.25 * score(current)) {
      const candidate = tNow - bestPhi; // absolute beat time, comparable across checks
      if (this.pendingPhase && circularDistance(candidate, this.pendingPhase, P) < 0.1 * P) {
        if (++this.phaseVotes >= 3) {
          this.phaseRef = candidate;
          this.matched = [];
          this.phaseVotes = 0;
          this.pendingPhase = 0;
        }
      } else {
        this.pendingPhase = candidate;
        this.phaseVotes = 1;
      }
    } else {
      this.pendingPhase = 0;
      this.phaseVotes = 0;
    }
  }

  // ---------------------------------------------------------------- ring buffer helpers

  /** Value `back` frames before the newest. */
  private at(buf: Float32Array | Float64Array, back: number): number {
    return buf[(this.n - 1 - back + HISTORY_FRAMES * 4) % HISTORY_FRAMES];
  }

  private stats(buf: Float32Array, len: number): [mean: number, sd: number] {
    const count = Math.min(len, this.n);
    let s = 0;
    let s2 = 0;
    for (let k = 0; k < count; k++) {
      const v = this.at(buf, k);
      s += v;
      s2 += v * v;
    }
    const mean = s / Math.max(1, count);
    return [mean, Math.sqrt(Math.max(0, s2 / Math.max(1, count) - mean * mean))];
  }

  private countAbove(buf: Float32Array, len: number, threshold: number): number {
    let c = 0;
    for (let k = 0; k < len; k++) if (this.at(buf, k) > threshold) c++;
    return c;
  }
}

function clampPeriod(p: number, p0: number): number {
  return Math.min(p0 * (1 + PERIOD_CLAMP), Math.max(p0 * (1 - PERIOD_CLAMP), p));
}

function circularDistance(a: number, b: number, period: number): number {
  const d = (((a - b) % period) + period) % period;
  return Math.min(d, period - d);
}
