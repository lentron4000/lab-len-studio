// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { OnsetFrame } from '../audio/onset-core';

/** What the music is doing, smoothed to the pace of musical change (all 0–1 unless noted). */
export interface MusicFeatures {
  /** Loudness right now (fast). Drives the shape's vibration. */
  loud: number;
  /** Loudness over the last second or two. */
  energy: number;
  /** Loudness over the last ten seconds or so: what "normal" is for this track. */
  baseline: number;
  /** Share of the sound in the highs: dark and heavy (0) to bright and open (1). */
  brightness: number;
  /** Kicks per second over the last few seconds (not 0–1). */
  kickRate: number;
  /** How hard recent kicks hit. */
  kickStrength: number;
  /** Energy trend over the last six seconds: falling (−1) to rising (1). */
  rise: number;
  /**
   * The highs, as they shimmer: high-band level against its own recent peak, with a flick on every
   * hat. This is what makes the particles vibrate.
   */
  shimmer: number;
  /** High-band hits (hats, shakers) per second. */
  hatRate: number;
}

const FRAME = 0.01; // seconds per analysis frame
/** Loudness range mapped to 0–1, in dBFS. */
const FLOOR_DB = -50; // room noise on a live input reads as (near) silence
const RANGE_DB = 42;
/** Time constants, in seconds. */
const LOUD_TAU = 0.08;
const ENERGY_TAU = 1.5;
const BASELINE_TAU = 12;
const BRIGHT_TAU = 2;
const KICK_WINDOW = 4;
/** Energy history for the trend: one sample every 0.5 s, six seconds' worth. */
const TREND_STEP = 0.5;
const TREND_LEN = 12;
/** High-band peak tracking (~5 s half-life), a hat's onset threshold (log rise), and its flick decay per frame. */
const HI_PEAK_DECAY = 0.9986;
const HAT_ONSET = 0.35;
const HAT_DECAY = Math.exp(-FRAME / 0.12);
/**
 * Snare: mid-band onset (log rise) needed, or SNARE_OVER × its recent mean if that's higher (so busy
 * music doesn't fire constantly); the kick band, from just before to just after, must stay under
 * SNARE_MAX_KICK_LEVEL of its recent peak (a kick fills it); at most one per SNARE_GAP s.
 */
const SNARE_ONSET = 2;
const SNARE_OVER = 4;
const SNARE_MAX_KICK_LEVEL = 0.5;
/** A snare's high-band energy must be at least this share of its mid-band energy. */
const SNARE_BRIGHT = 0.5;
const SNARE_GAP = 0.12;
/** Frames a snare waits for a kick before it counts (60 ms). */
const SNARE_CONFIRM = 6;
const MID_MEAN_RATE = 0.005;
/** With no analysis frames for this long (paused, stopped), the music is silent. */
const SILENT_AFTER = 0.25;

const ease = (value: number, target: number, dt: number, tau: number): number =>
  value + (target - value) * (1 - Math.exp(-dt / tau));

/**
 * Turns 10 ms analysis frames (and detected kicks) into a few slow features that describe the music:
 * how loud, how bright, how rhythmic, and whether it's building or falling away.
 */
export class MusicListener {
  readonly features: MusicFeatures = {
    loud: 0,
    energy: 0,
    baseline: 0,
    brightness: 0.5,
    kickRate: 0,
    kickStrength: 0,
    rise: 0,
    shimmer: 0,
    hatRate: 0,
  };
  private hiPeak = 1e-9;
  /** Snares heard since the last take: a sharp mid-band hit with no kick under it. */
  private snares: number[] = [];
  private midMean = 0;
  private lastSnare = -Infinity;
  /** A possible snare waits a few frames: if a kick lands with it, it was the kick's attack. */
  private pendingSnare = 0;
  private pendingSnareAt = 0;
  private pendingLo = 0;
  /** Kick-band level over the last two frames (a kick's low end can arrive a frame early). */
  private recentLo = [0, 0];
  private hatFlick = 0;
  private hats: number[] = [];
  private kicks: { t: number; strength: number }[] = [];
  private trend: number[] = [];
  private sinceTrend = 0;
  private lastFrameAt = -Infinity;

  /** Analysis frames from the file or live input. */
  push(frames: readonly OnsetFrame[], now: number): void {
    const f = this.features;
    for (const frame of frames) {
      const loud = Math.min(1, Math.max(0, (frame.level - FLOOR_DB) / RANGE_DB));
      this.follow(loud, FRAME);
      const total = frame.loEnergy + frame.midEnergy + frame.hiEnergy + 1e-12;
      // Highs carry little energy even in bright music, so weight them up before taking the share.
      const bright = Math.min(1, (frame.hiEnergy * 12) / (total + frame.hiEnergy * 11));
      if (loud > 0.05) f.brightness = ease(f.brightness, bright, FRAME, BRIGHT_TAU);
      // Snare (or clap): a mid-band jump well above the recent norm, with nothing much in the kick band.
      this.midMean += (frame.mid - this.midMean) * MID_MEAN_RATE;
      const snareAt = Math.max(SNARE_ONSET, this.midMean * SNARE_OVER);
      if (this.pendingSnare) {
        this.pendingLo = Math.max(this.pendingLo, frame.loLevel);
        if (++this.pendingSnareAt >= SNARE_CONFIRM) {
          // During a kick the kick band is at its peak; a snare barely touches it.
          if (this.pendingLo < SNARE_MAX_KICK_LEVEL) this.snares.push(this.pendingSnare);
          this.pendingSnare = 0;
        }
      } else if (
        frame.mid > snareAt &&
        // Snares and claps are noisy and bright; a bass note jumping in the mids isn't.
        frame.hiEnergy > SNARE_BRIGHT * frame.midEnergy &&
        loud > 0.05 &&
        now - this.lastSnare > SNARE_GAP
      ) {
        this.lastSnare = now;
        this.pendingSnare = Math.min(1.5, frame.mid / snareAt);
        this.pendingSnareAt = 0;
        this.pendingLo = Math.max(frame.loLevel, ...this.recentLo);
      }
      this.recentLo[1] = this.recentLo[0];
      this.recentLo[0] = frame.loLevel;
      // Highs: a steady shimmer from how much of the sound is up there, and a flick on each hat.
      this.hiPeak = Math.max(frame.hiEnergy, this.hiPeak * HI_PEAK_DECAY);
      const hiLevel = loud > 0.02 ? Math.sqrt(frame.hiEnergy / this.hiPeak) * bright : 0;
      this.hatFlick *= HAT_DECAY;
      if (frame.hi > HAT_ONSET && loud > 0.05) {
        this.hatFlick = Math.min(1, Math.max(this.hatFlick, frame.hi / (HAT_ONSET * 3)));
        this.hats.push(now);
      }
      f.shimmer = ease(f.shimmer, Math.max(0.55 * hiLevel, this.hatFlick), FRAME, 0.05);
    }
    this.lastFrameAt = now;
  }

  /** Snares since the last call (strengths, ~1 for a clear hit). */
  takeSnares(): number[] {
    const s = this.snares;
    this.snares = [];
    return s;
  }

  /** A detected kick (or beat), strength 0–1+. */
  kick(strength: number, now: number): void {
    this.kicks.push({ t: now, strength });
  }

  /** Once per animation frame: silence decay, kick rate and the energy trend. */
  tick(dt: number, now: number): void {
    const f = this.features;
    if (now - this.lastFrameAt > SILENT_AFTER) {
      this.follow(0, dt);
      f.shimmer = ease(f.shimmer, 0, dt, 0.1);
    }
    this.hats = this.hats.filter((t) => now - t < KICK_WINDOW);
    f.hatRate = this.hats.length / KICK_WINDOW;
    this.kicks = this.kicks.filter((k) => now - k.t < KICK_WINDOW);
    f.kickRate = this.kicks.length / KICK_WINDOW;
    const strength = this.kicks.reduce((s, k) => s + Math.min(1.5, k.strength), 0) / (this.kicks.length || 1);
    f.kickStrength = ease(f.kickStrength, this.kicks.length ? strength : 0, dt, 1);
    this.sinceTrend += dt;
    if (this.sinceTrend >= TREND_STEP) {
      this.sinceTrend = 0;
      this.trend.push(f.energy);
      if (this.trend.length > TREND_LEN) this.trend.shift();
      const third = Math.floor(this.trend.length / 3);
      if (third > 0) {
        const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
        const early = mean(this.trend.slice(0, third));
        const late = mean(this.trend.slice(-third));
        f.rise = Math.max(-1, Math.min(1, (late - early) / (f.baseline + 0.1)));
      }
    }
  }

  private follow(loud: number, dt: number): void {
    const f = this.features;
    f.loud = ease(f.loud, loud, dt, LOUD_TAU);
    f.energy = ease(f.energy, loud, dt, ENERGY_TAU);
    f.baseline = ease(f.baseline, loud, dt, BASELINE_TAU);
  }
}
