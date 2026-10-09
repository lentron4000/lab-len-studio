// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { gaussian, lerp } from '../lib/math';
import { angularStep } from './divisions';
import { Moon } from './moon';
import { PHYSICS_MODES, SOLID, type PhysicsMode } from './physics-modes';
import { Pointer } from './pointer';
import { GLOBE_AXIS, rotation, type Mat3 } from './rotation';

/** Where the shape sits on screen, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
  /** Shape radius at the solid end. */
  radius: number;
  cx: number;
  cy: number;
}

/** Physics constants are tuned at this shape radius and scaled with the real one. */
const REFERENCE_RADIUS = 230;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** The camera sits this many shape radii in front of the centre (perspective strength). */
export const CAMERA_DISTANCE = 4;

/**
 * Particle physics: a disc or globe of particles that can be opened from a packed solid into a
 * cloud, with four behaviours (gas, water, two magnetic poles), pointer gravity, beat shockwaves,
 * a spinning globe and an orbiting moon. Advances in fixed 60 Hz steps.
 *
 * Positions are screen pixels with z toward the viewer. Particle interactions use a uniform grid
 * hashed on x/y with true 3D distances, which keeps the pair search near O(n).
 */
export class Simulation {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Home position on the unit sphere; also used to lay colour out in regions. */
  readonly sphereX: Float32Array;
  readonly sphereY: Float32Array;
  readonly sphereZ: Float32Array;
  readonly pointer = new Pointer();
  readonly moon = new Moon();

  mode: PhysicsMode = PHYSICS_MODES.gas;
  /** State slider, 0 = solid, 1 = cloud. */
  stateTarget = 0.5;
  /** How far a pulse pushes the state toward cloud (Depth slider). */
  depth = 0.65;
  /** Bars per revolution of the globe; 0 = stopped. */
  spinBars = 4;
  bpm = 100;
  /** 0 = disc, 1 = globe; the shape morphs toward it. */
  shapeTarget = 0;

  /** Effective state: the slider pushed toward cloud by the current pulse. */
  state = 0.5;
  /** Current disc → globe blend. */
  globe = 0;
  /** Spin speed in radians per step. */
  spinSpeed = 0;

  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly discX: Float32Array;
  private readonly discY: Float32Array;
  private readonly scatterX: Float32Array;
  private readonly scatterY: Float32Array;
  private readonly scatterZ: Float32Array;
  private readonly next: Int32Array;
  private cellHead = new Int32Array(1);
  private pulse = 0;
  private pendingShock = 0;
  private spinAngle = 0;
  private view: Viewport = { width: 1, height: 1, radius: 100, cx: 0, cy: 0 };

  constructor(count: number) {
    this.count = count;
    const f = (): Float32Array => new Float32Array(count);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.discX = f();
    this.discY = f();
    this.sphereX = f();
    this.sphereY = f();
    this.sphereZ = f();
    this.scatterX = f();
    this.scatterY = f();
    this.scatterZ = f();
    this.next = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      // Phyllotaxis disc: even density with no rings.
      const r = Math.sqrt((i + 0.5) / count);
      const a = i * GOLDEN_ANGLE;
      this.discX[i] = r * Math.cos(a);
      this.discY[i] = r * Math.sin(a);
      // Fibonacci sphere.
      const sy = 1 - (2 * (i + 0.5)) / count;
      const sr = Math.sqrt(1 - sy * sy);
      this.sphereX[i] = Math.cos(a) * sr;
      this.sphereY[i] = sy;
      this.sphereZ[i] = Math.sin(a) * sr;
      // Gaussian scatter that loosens the shape toward the cloud end.
      this.scatterX[i] = gaussian();
      this.scatterY[i] = gaussian();
      this.scatterZ[i] = gaussian();
    }
  }

  get viewport(): Readonly<Viewport> {
    return this.view;
  }

  /** Shape radius after opening (the cloud is 30% wider than the solid). */
  effectiveRadius(): number {
    return this.view.radius * (1 + 0.3 * this.state);
  }

  /** Updates the shape's place on screen. `reset` snaps every particle home (on resize). */
  setViewport(view: Viewport, reset: boolean): void {
    this.view = view;
    if (!reset) return;
    const re = this.effectiveRadius();
    const sc = view.radius * 0.2 * this.state;
    for (let i = 0; i < this.count; i++) {
      this.x[i] = view.cx + this.discX[i] * re + this.scatterX[i] * sc;
      this.y[i] = view.cy + this.discY[i] * re + this.scatterY[i] * sc;
      this.z[i] = 0;
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
  }

  /** A kick or beat: pushes the state toward cloud and sends a shockwave out from the centre. */
  fire(strength: number): void {
    this.pulse = Math.max(this.pulse, strength);
    this.pendingShock = Math.max(this.pendingShock, strength);
  }

  /** Advances one 1/60 s step. Returns mean kinetic energy (px²/step²) for the readout. */
  step(): number {
    const { mode, moon, pointer, count: N, x, y, z, vx, vy, vz } = this;
    const { radius: R, cx, cy, width: W, height: H } = this.view;

    this.pulse *= 0.925;
    this.state = this.stateTarget + (1 - this.stateTarget) * this.pulse * this.depth;
    const e = this.state;
    const shock = this.pendingShock * this.depth * (R / 220) * 2.4;
    this.pendingShock = 0;

    const scale = R / REFERENCE_RADIUS;
    const k = lerp(SOLID.spring, mode.spring, e) * (1 - (1 - mode.homeWeight) * Math.sqrt(e));
    const containK = mode.contain * e;
    const re = this.effectiveRadius();
    const containR = re * mode.containRadius;
    const targetSpeed = mode.speed * e * scale;
    const damping = lerp(SOLID.damping, mode.damping, e);
    const thermal = lerp(SOLID.thermal, mode.thermal, e) * scale;
    const scatter = R * 0.2 * e;

    // Shape morph and spin.
    this.globe += (this.shapeTarget - this.globe) * 0.04;
    if (Math.abs(this.shapeTarget - this.globe) < 1e-3) this.globe = this.shapeTarget;
    const gw = this.globe;
    const targetSpin = gw > 0 ? angularStep(this.spinBars, this.bpm) : 0;
    this.spinSpeed += (targetSpin - this.spinSpeed) * 0.04;
    this.spinAngle += this.spinSpeed;
    const M = rotation(GLOBE_AXIS, this.spinAngle);
    const dM: Mat3 | null =
      gw > 0 && Math.abs(this.spinSpeed) > 1e-6 ? rotation(GLOBE_AXIS, this.spinSpeed * gw) : null;
    const camera = R * CAMERA_DISTANCE;

    // Moon. Gas and water: it displaces fluid (potential flow round a moving sphere) and pushes a bow wave.
    // Attract and repel: a short-range magnet acting on the cloud beneath it. Both are sized against the
    // current spring stiffness so the effect stays visible at any state.
    moon.step(cx, cy, R, this.bpm);
    const moonOn = moon.visible;
    const mr = moon.radius;
    const magnet = mode.alwaysOn
      ? Math.sign(mode.pointerGravity) * Math.max(k, 0.02) * R * lerp(0.4, 1, e) * moon.presence * moon.force
      : 0;
    const magnetReach2 = (R * 0.65) ** 2;
    const flowR = mr * 5;
    const flowR2 = flowR * flowR;
    const mr3 = mr * mr * mr;
    const pressK = (Math.max(k, 0.02) * R * lerp(0.9, 1.5, e) + 1.2 * scale) * moon.presence * moon.force;
    const pressReach2 = (mr * 2.2) ** 2;
    const moonSpeed = Math.hypot(moon.vx, moon.vy, moon.vz) || 1e-6;
    // In disc mode the moon acts as if it passes through the disc's plane.
    const zWeight = 0.15 + 0.85 * gw;

    // Pointer: gravity scales with movement in the fluid modes; poles are always on.
    pointer.step();
    const gravity = mode.pointerGravity * (mode.alwaysOn ? 1 : 0.25 + 0.75 * pointer.activity) * (R / 220);
    const soft = Math.max(18, R * 0.13);
    const soft2 = soft * soft;
    const wakeR2 = (R * 0.35) ** 2;

    if (e > 0.02) this.interact(re, e, scale, gw, W, H);

    let ke = 0;
    const zPin = 0.08 * (1 - gw);
    const vmax = 25 * scale;
    for (let i = 0; i < N; i++) {
      // The body spins rigidly; physics runs on top of the rotation.
      if (dM) {
        const ox = x[i] - cx;
        const oy = y[i] - cy;
        const oz = z[i];
        x[i] = cx + dM[0] * ox + dM[1] * oy + dM[2] * oz;
        y[i] = cy + dM[3] * ox + dM[4] * oy + dM[5] * oz;
        z[i] = dM[6] * ox + dM[7] * oy + dM[8] * oz;
        const a = vx[i];
        const b = vy[i];
        const c = vz[i];
        vx[i] = dM[0] * a + dM[1] * b + dM[2] * c;
        vy[i] = dM[3] * a + dM[4] * b + dM[5] * c;
        vz[i] = dM[6] * a + dM[7] * b + dM[8] * c;
      }

      // Home: the disc point blended toward the rotating sphere point, loosened by the scatter.
      const dhx = this.discX[i] * re;
      const dhy = this.discY[i] * re;
      const sx = this.sphereX[i];
      const sy = this.sphereY[i];
      const sz = this.sphereZ[i];
      const shx = (M[0] * sx + M[1] * sy + M[2] * sz) * re;
      const shy = (M[3] * sx + M[4] * sy + M[5] * sz) * re;
      const shz = (M[6] * sx + M[7] * sy + M[8] * sz) * re;
      const hx = cx + dhx + (shx - dhx) * gw + this.scatterX[i] * scatter;
      const hy = cy + dhy + (shy - dhy) * gw + this.scatterY[i] * scatter;
      const hz = shz * gw + this.scatterZ[i] * scatter * gw;
      let ax = (hx - x[i]) * k;
      let ay = (hy - y[i]) * k;
      let az = (hz - z[i]) * k - z[i] * zPin;
      ax += (Math.random() - 0.5) * thermal;
      ay += (Math.random() - 0.5) * thermal;
      az += (Math.random() - 0.5) * thermal * gw;

      const ox = x[i] - cx;
      const oy = y[i] - cy;
      const oz = z[i];
      if (shock) {
        const od = Math.hypot(ox, oy, oz) || 1;
        const f = (shock * (0.3 + 0.7 * Math.min(1, od / re))) / od;
        vx[i] += ox * f;
        vy[i] += oy * f;
        vz[i] += oz * f;
      }
      if (containK) {
        if (gw < 0.5) {
          const od = Math.hypot(ox, oy);
          if (od > containR) {
            const f = (containK * (od - containR)) / od;
            ax -= ox * f;
            ay -= oy * f;
          }
        } else {
          // Globe: hold free particles in a shell (a water film, a gas atmosphere).
          const od = Math.hypot(ox, oy, oz) || 1;
          const rin = re * mode.shellInner;
          const rout = re * mode.shellOuter;
          const over = od > rout ? od - rout : od < rin ? od - rin : 0;
          if (over) {
            const f = (mode.shellStrength * e * over) / od;
            ax -= ox * f;
            ay -= oy * f;
            az -= oz * f;
          }
        }
      }
      if (targetSpeed) {
        // Thermostat: nudge each particle's speed toward the target so gas keeps flying straight.
        const sp = Math.hypot(vx[i], vy[i], vz[i] * gw);
        if (sp > 1e-3) {
          const f = 0.04 * (targetSpeed / sp - 1);
          vx[i] += vx[i] * f;
          vy[i] += vy[i] * f;
          vz[i] += vz[i] * f;
        } else {
          const a = Math.random() * 2 * Math.PI;
          vx[i] = Math.cos(a) * targetSpeed;
          vy[i] = Math.sin(a) * targetSpeed;
        }
      }
      if (pointer.active) {
        // The pointer acts where the particle appears on screen (after perspective).
        const ps = camera / (camera - z[i]);
        const dx = pointer.x - (cx + ox * ps);
        const dy = pointer.y - (cy + oy * ps);
        const d2 = dx * dx + dy * dy;
        const inv = 1 / Math.pow(d2 + soft2, 1.5);
        ax += gravity * dx * inv;
        ay += gravity * dy * inv;
        if (d2 < wakeR2) {
          const w = mode.pointerWake * (1 - d2 / wakeR2);
          ax += pointer.vx * w;
          ay += pointer.vy * w;
        }
      }
      if (moonOn) {
        const mx = moon.x - x[i];
        const my = moon.y - y[i];
        const mz = (moon.z - z[i]) * zWeight;
        const m2 = mx * mx + my * my + mz * mz;
        const md = Math.sqrt(m2) || 1e-3;
        if (magnet) {
          // Gaussian reach: only the cloud under the moon's path responds.
          const f = (magnet * Math.exp(-m2 / magnetReach2)) / md;
          ax += mx * f;
          ay += my * f;
          az += mz * f;
        } else if (m2 < flowR2 && md > mr * 0.5) {
          // Displaced fluid: pushed ahead, sliding round the sides, closing in behind.
          const nx = -mx / md;
          const ny = -my / md;
          const nz = -mz / md;
          const un = moon.vx * nx + moon.vy * ny + moon.vz * nz;
          const k3 = (3.5 * moon.force * mr3) / (2 * md * md * md);
          const ufx = k3 * (3 * un * nx - moon.vx);
          const ufy = k3 * (3 * un * ny - moon.vy);
          const ufz = k3 * (3 * un * nz - moon.vz);
          const w = Math.min(0.6, 0.5 * moon.force) * (1 - md / flowR);
          ax += (ufx - vx[i]) * w;
          ay += (ufy - vy[i]) * w;
          az += (ufz - vz[i]) * w;
        }
        if (!magnet && m2 < flowR2 * 1.5) {
          // Pressure: fluid is shoved aside, hardest along the direction of travel (bow wave).
          const nx = -mx / md;
          const ny = -my / md;
          const nz = -mz / md;
          const ahead = Math.max(0, (nx * moon.vx + ny * moon.vy + nz * moon.vz) / moonSpeed);
          const f = pressK * Math.exp(-m2 / pressReach2) * (0.5 + ahead);
          ax += nx * f;
          ay += ny * f;
          az += nz * f;
        }
        if (md < mr) {
          // Solid surface: push out and reflect the approaching velocity.
          const nx = -mx / md;
          const ny = -my / md;
          const nz = -mz / md;
          const push = mr - md;
          x[i] += nx * push;
          y[i] += ny * push;
          z[i] += (nz * push) / zWeight;
          const vn = (vx[i] - moon.vx) * nx + (vy[i] - moon.vy) * ny + (vz[i] - moon.vz) * nz;
          if (vn < 0) {
            vx[i] -= 1.1 * vn * nx;
            vy[i] -= 1.1 * vn * ny;
            vz[i] -= 1.1 * vn * nz;
          }
        }
      }

      let nvx = (vx[i] + ax) * damping;
      let nvy = (vy[i] + ay) * damping;
      let nvz = (vz[i] + az) * damping;
      const sp2 = nvx * nvx + nvy * nvy + nvz * nvz;
      if (sp2 > vmax * vmax) {
        const f = vmax / Math.sqrt(sp2);
        nvx *= f;
        nvy *= f;
        nvz *= f;
      }
      vx[i] = nvx;
      vy[i] = nvy;
      vz[i] = nvz;
      x[i] += nvx;
      y[i] += nvy;
      z[i] += nvz;
      ke += sp2;
    }
    return ke / N;
  }

  /** Particle–particle repulsion, cohesion and viscosity over a uniform grid (half-neighbourhood scan). */
  private interact(re: number, e: number, scale: number, gw: number, W: number, H: number): void {
    const { mode, count: N, x, y, z, vx, vy, vz, next } = this;
    const spacing = re * Math.sqrt(Math.PI / N) * (1 + gw);
    const h = mode.range * spacing;
    const cols = Math.ceil(W / h) + 2;
    const rows = Math.ceil(H / h) + 2;
    const cells = cols * rows;
    if (this.cellHead.length < cells) this.cellHead = new Int32Array(cells);
    const head = this.cellHead;
    head.fill(-1, 0, cells);
    for (let i = 0; i < N; i++) {
      const c = Math.min(cols - 1, Math.max(0, (x[i] / h + 1) | 0));
      const r = Math.min(rows - 1, Math.max(0, (y[i] / h + 1) | 0));
      const id = r * cols + c;
      next[i] = head[id];
      head[id] = i;
    }
    const rep = mode.repulsion * e * scale;
    const coh = mode.cohesion * e * scale;
    const visc = mode.viscosity * e;
    const h2 = h * h;
    const offsets = [0, 1, cols - 1, cols, cols + 1];
    for (let id = 0; id < cells; id++) {
      for (let i = head[id]; i !== -1; i = next[i]) {
        for (let o = 0; o < 5; o++) {
          const nid = id + offsets[o];
          if (nid >= cells) continue;
          for (let j = o === 0 ? next[i] : head[nid]; j !== -1; j = next[j]) {
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const dz = z[j] - z[i];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= h2 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const q = 1 - d / h;
            const push = rep * q * q - coh * q * (1 - q);
            const nx = dx / d;
            const ny = dy / d;
            const nz = dz / d;
            vx[i] -= nx * push;
            vy[i] -= ny * push;
            vz[i] -= nz * push;
            vx[j] += nx * push;
            vy[j] += ny * push;
            vz[j] += nz * push;
            if (visc) {
              const fx = (vx[j] - vx[i]) * visc * q;
              const fy = (vy[j] - vy[i]) * visc * q;
              const fz = (vz[j] - vz[i]) * visc * q;
              vx[i] += fx;
              vy[i] += fy;
              vz[i] += fz;
              vx[j] -= fx;
              vy[j] -= fy;
              vz[j] -= fz;
            }
          }
        }
      }
    }
  }
}
