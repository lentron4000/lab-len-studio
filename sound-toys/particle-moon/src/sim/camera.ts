// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Mat3 } from './rotation';

/** Seconds (easing time) for the camera's drift after a release to die away. */
const DRIFT_SECONDS = 0.45;
/** Fastest the camera turns on its own after a fling (radians a second). */
const DRIFT_MAX = 6;
/** Seconds for Reset to bring the camera back to straight on. */
const RESET_SECONDS = 0.9;

type Quat = [w: number, x: number, y: number, z: number];

/**
 * Where the camera looks from. Click and drag orbits it round the shape like a trackball: pull right and
 * the front turns to the right, pull up and the top comes toward you, any direction in between. Let go
 * and it drifts on a moment at the speed of the pull, then stops where it is. Reset eases it back to
 * straight on, and `glideTo` eases it to any angle (Auto's moves). A view only: the shape, its spin and
 * its physics are untouched.
 *
 * `matrix` (row-major) turns a point relative to the shape's centre into what the camera sees.
 */
export class Camera {
  matrix: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private q: Quat = [1, 0, 0, 0];
  /** Drift after a release: axis × speed (radians a second), in the camera's frame. */
  private wx = 0;
  private wy = 0;
  private held = false;
  /** A glide under way (Reset's or `glideTo`'s): from, to, progress (0–1) and its length (s). */
  private resetFrom: Quat | null = null;
  private resetTo: Quat = [1, 0, 0, 0];
  private resetT = 0;
  private resetSeconds = RESET_SECONDS;

  /** True while the camera looks straight on (nothing to turn). */
  get straight(): boolean {
    return this.q[0] > 1 - 1e-9 && !this.resetFrom;
  }

  /** A drag moved (dx, dy) screen pixels in `dt` s; `radius` px is the shape's size (a radius ≈ a radian). */
  drag(dx: number, dy: number, dt: number, radius: number): void {
    this.held = true;
    this.resetFrom = null;
    // Turn about the screen axis at right angles to the pull (right → about down; down → about left).
    const ax = -dy / radius;
    const ay = dx / radius;
    this.turn(ax, ay);
    if (dt > 0) {
      // The release speed: smoothed over the last few moves, so a flick reads as a flick.
      this.wx += (ax / dt - this.wx) * 0.5;
      this.wy += (ay / dt - this.wy) * 0.5;
    }
  }

  /** The drag let go: the camera drifts on at the pull's speed and settles. */
  release(): void {
    this.held = false;
    const w = Math.hypot(this.wx, this.wy);
    if (w > DRIFT_MAX) {
      this.wx *= DRIFT_MAX / w;
      this.wy *= DRIFT_MAX / w;
    }
  }

  /** Back to straight on, smoothly. */
  reset(): void {
    this.glide([1, 0, 0, 0], RESET_SECONDS);
  }

  /**
   * Eases over `seconds` to the view turned `yaw` radians about the screen's vertical (positive turns the
   * front to the right) and then `pitch` about its horizontal (positive tips the front up, as a pull up does).
   */
  glideTo(yaw: number, pitch: number, seconds: number): void {
    const y: Quat = [Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0];
    const p: Quat = [Math.cos(pitch / 2), Math.sin(pitch / 2), 0, 0];
    this.glide(normalize(multiply(p, y)), seconds);
  }

  private glide(to: Quat, seconds: number): void {
    this.held = false;
    this.wx = this.wy = 0;
    const d = Math.abs(this.q[0] * to[0] + this.q[1] * to[1] + this.q[2] * to[2] + this.q[3] * to[3]);
    if (d > 1 - 1e-9) {
      this.q = to;
      this.resetFrom = null;
      return;
    }
    this.resetFrom = [...this.q];
    this.resetTo = to;
    this.resetT = 0;
    this.resetSeconds = Math.max(0.05, seconds);
  }

  /** Advances the drift or the reset by `dt` seconds and refreshes `matrix`. */
  tick(dt: number): void {
    if (this.resetFrom) {
      this.resetT = Math.min(1, this.resetT + dt / this.resetSeconds);
      const t = this.resetT;
      this.q = slerp(this.resetFrom, this.resetTo, t * t * (3 - 2 * t));
      if (this.resetT >= 1) {
        this.resetFrom = null;
        this.q = [...this.resetTo];
      }
    } else if (!this.held && (this.wx || this.wy)) {
      this.turn(this.wx * dt, this.wy * dt);
      const keep = Math.exp(-dt / DRIFT_SECONDS);
      this.wx *= keep;
      this.wy *= keep;
      if (Math.hypot(this.wx, this.wy) < 0.01) this.wx = this.wy = 0;
    } else if (this.held) {
      // Holding still: no drift waiting when it's let go.
      this.wx *= Math.exp(-dt / 0.08);
      this.wy *= Math.exp(-dt / 0.08);
    }
    this.matrix = toMatrix(this.q);
  }

  /** Turns the view by the small rotation (ax, ay, 0) (axis × angle, screen frame), applied after the current one. */
  private turn(ax: number, ay: number): void {
    const angle = Math.hypot(ax, ay);
    if (angle < 1e-9) return;
    const s = Math.sin(angle / 2) / angle;
    const r: Quat = [Math.cos(angle / 2), ax * s, ay * s, 0];
    this.q = normalize(multiply(r, this.q));
  }
}

function multiply(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function normalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const c: Quat = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : [...b];
  d = Math.abs(d);
  if (d > 0.9995)
    return normalize([
      a[0] + (c[0] - a[0]) * t,
      a[1] + (c[1] - a[1]) * t,
      a[2] + (c[2] - a[2]) * t,
      a[3] + (c[3] - a[3]) * t,
    ]);
  const th = Math.acos(d);
  const sa = Math.sin((1 - t) * th) / Math.sin(th);
  const sb = Math.sin(t * th) / Math.sin(th);
  return [a[0] * sa + c[0] * sb, a[1] * sa + c[1] * sb, a[2] * sa + c[2] * sb, a[3] * sa + c[3] * sb];
}

function toMatrix([w, x, y, z]: Quat): Mat3 {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}
