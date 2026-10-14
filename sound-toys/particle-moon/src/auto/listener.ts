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
const FLOOR_DB = -60;
const RANGE_DB = 50;
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
      // Highs: steady shimmer from their level, a flick on each hat.
      this.hiPeak = Math.max(frame.hiEnergy, this.hiPeak * HI_PEAK_DECAY);
      const hiLevel = loud > 0.02 ? Math.sqrt(frame.hiEnergy / this.hiPeak) : 0;
      this.hatFlick *= HAT_DECAY;
      if (frame.hi > HAT_ONSET && loud > 0.05) {
        this.hatFlick = Math.min(1, Math.max(this.hatFlick, frame.hi / (HAT_ONSET * 3)));
        this.hats.push(now);
      }
      f.shimmer = ease(f.shimmer, Math.max(0.55 * hiLevel, this.hatFlick), FRAME, 0.05);
    }
    this.lastFrameAt = now;
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
