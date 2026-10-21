// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { CAMERA_DISTANCE, type Simulation } from '../sim/simulation';
import { STAMP_VARIANTS, stampsFor } from './pixel-stamps';

/** Cells across the screen's shorter side. */
const ROWS = 330;
/** Squares this many device pixels smaller than ROWS alone would make them. */
const CELL_TRIM = 1;
/** Rain is sized and paced in cells as on a grid this many cells across, so it keeps its look at any size. */
const RAIN_GRID = 220;
/** 0xAABBGGRR (little-endian), as the image data wants it. */
const rgba = (r: number, g: number, b: number): number => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
/** The ramp, dark to light: black ground, sky blue, green. Light falls between two of them, dithered. */
const RAMP = [rgba(8, 8, 10), rgba(92, 168, 240), rgba(62, 158, 74)] as const;
const BLACK = RAMP[0];
/** 4×4 Bayer thresholds (0–1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
/** Each particle covers this much more than its dot, so a surface reads solid. */
const SPLAT = 2.2;
/** The key light (from the left, a little above and in front) and a rim light round that edge. */
const KEY: readonly [number, number, number] = norm([-0.55, -0.45, 0.7]);
const RIM_GAIN = 0.6;
/** Light → place on the ramp (0 black, 1 blue, 2 green). */
const RAMP_GAIN = 1.5;
/** Glitches: chance per frame at full loudness, how long one lasts (s), and the most bands it tears. */
const GLITCH_RATE = 0.05;
const GLITCH_SECONDS = [0.12, 0.32] as const;
const GLITCH_BANDS = 4;
/** Rain (dropout streaks in the black): how many at full loudness, and at the quietest. */
const RAIN = 90;
const RAIN_QUIET = 0.2;
/** Rain's motion blur: the trail behind a falling streak is how far it falls in this long (s), so only fast ones smear. */
const RAIN_BLUR = 0.14;

function norm(v: readonly [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

interface Band {
  y0: number;
  y1: number;
  shift: number;
  /** Drop every other row inside the band (the interlaced look). */
  interlace: boolean;
}

/** A streak of rain: where it is (cells), and how near (0 far … 1 near), which sets its length, light and fall. */
interface Drop {
  x: number;
  y: number;
  near: number;
}

/**
 * Refract: VHS-era posterized light. The particles land on a coarse grid, and each cell takes the light
 * of the nearest particle in it: its surface lit by a key light from the left, with a rim round that
 * edge. Each particle also carries its own tone, from a pattern laid over the globe's surface, so the
 * markings turn with the globe through the fixed light (you see it spin). Light is a ramp from black
 * through blue to green, cut into those three colours with an ordered dither, so the in-betweens are
 * 25/50/75% patterns; in some patches the dither runs as scan lines instead. The moon is lit the same way.
 *
 * Loud music tears it: now and then (more often and harder the louder it is, and on kicks) horizontal
 * bands slip sideways with every other row dropped, for a fraction of a second. And rain falls in the
 * black: streaks at different depths, far ones short, dim and slow, near ones long, bright and fast,
 * more of them the louder it gets, each flickering on its own.
 */
export class RefractPainter {
  private readonly lo = document.createElement('canvas');
  private readonly loCtx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private pixels = new Uint32Array(0);
  /** Per cell: place on the ramp (−1 = empty), the depth of whatever set it, and scan-line dither. */
  private light = new Float32Array(0);
  private depth = new Float32Array(0);
  private lines = new Uint8Array(0);
  private cols = 1;
  private rows = 1;
  /** Cell size in device pixels, and device pixels per CSS pixel. */
  private cell = 1;
  /** Rain's sizes in cells, for this grid (see RAIN_GRID). */
  private rainScale = 1;
  private dpr = 1;
  private bands: Band[] = [];
  private glitchLeft = 0;
  private time = 0;
  private readonly rain: Drop[] = [];
  /** Per particle, fixed: its tone from the surface pattern, and whether its patch dithers in scan lines. */
  private tone = new Float32Array(0);
  private scan = new Uint8Array(0);

  constructor() {
    const ctx = this.lo.getContext('2d');
    if (!ctx) throw new Error('Sound Toy: 2D canvas is not available');
    this.loCtx = ctx;
  }

  resize(deviceWidth: number, deviceHeight: number, dpr: number): void {
    this.dpr = dpr;
    this.cell = Math.max(1, Math.round(Math.min(deviceWidth, deviceHeight) / ROWS) - CELL_TRIM);
    this.cols = Math.ceil(deviceWidth / this.cell);
    this.rows = Math.ceil(deviceHeight / this.cell);
    this.rainScale = Math.min(this.cols, this.rows) / RAIN_GRID;
    this.lo.width = this.cols;
    this.lo.height = this.rows;
    this.image = this.loCtx.createImageData(this.cols, this.rows);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.light = new Float32Array(this.cols * this.rows);
    this.depth = new Float32Array(this.cols * this.rows);
    this.lines = new Uint8Array(this.cols * this.rows);
    this.bands = [];
    this.rain.length = 0;
    for (let k = 0; k < RAIN; k++) this.rain.push(this.drop(true));
  }

  /**
   * Paints a frame onto `ctx`. `x`, `y`, `z` are this frame's particle positions as the camera sees
   * them (the first `count`); `dt` the frame's seconds; `loud` 0–1; `moonAt` the moon's centre, likewise.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    sim: Simulation,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    count: number,
    dt: number,
    loud: number,
    moonAt: readonly [number, number, number],
  ): void {
    if (!this.image) return;
    if (this.tone.length !== sim.count) this.layTones(sim);
    this.time += dt;
    const { cols, rows, light, depth, lines } = this;
    light.fill(-1);
    depth.fill(-Infinity);
    const k = this.dpr / this.cell; // CSS px → cells
    const { radius: R, cx, cy } = sim.viewport;
    const re = sim.effectiveRadius();
    const camera = R * CAMERA_DISTANCE;
    const dot = sim.dotRadius();
    const { excite } = sim;
    const keySide = Math.sign(KEY[0]);

    for (let i = 0; i < count; i++) {
      const ps = camera / (camera - z[i]);
      const gx = (cx + (x[i] - cx) * ps) * k;
      const gy = (cy + (y[i] - cy) * ps) * k;
      // The surface's way out at this particle: the globe's own curve; a flat disc read as a dome.
      let nx = (x[i] - cx) / re;
      let ny = (y[i] - cy) / re;
      let nz = z[i] / re;
      const flat = 1 - nx * nx - ny * ny;
      if (Math.abs(nz) < 0.05 && flat > 0) nz = Math.sqrt(flat);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const lambert = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
      const rim = (1 - Math.abs(nz)) ** 2 * Math.max(0, nx * keySide);
      // The particle's own tone (its markings) under the light; the far side falls away into the dark.
      const lit = this.tone[i] * (0.18 + 0.95 * lambert) + RIM_GAIN * rim + 0.45 * excite[i];
      const t = Math.min(2, lit * RAMP_GAIN);
      this.splat(
        gx,
        gy,
        Math.max(0.6, dot * ps * k * SPLAT),
        z[i],
        t,
        this.scan[i],
        (i * 7) % STAMP_VARIANTS,
      );
    }
    if (sim.moon.visible) this.paintMoon(sim, camera, k, moonAt);

    // Glitch: semi-random, more often and harder with loudness.
    if (this.glitchLeft > 0) this.glitchLeft -= dt;
    else {
      this.bands = [];
      if (Math.random() < GLITCH_RATE * loud * loud) this.startGlitch(loud);
    }

    const px = this.pixels;
    for (let gy = 0, o = 0; gy < rows; gy++) {
      let shift = 0;
      let dropped = false;
      for (const band of this.bands)
        if (gy >= band.y0 && gy < band.y1) {
          shift = band.shift;
          dropped = band.interlace && (gy & 1) === 1;
        }
      const row = gy * cols;
      const bayerRow = (gy & 3) * 4;
      for (let gx = 0; gx < cols; gx++, o++) {
        const sx = gx - shift;
        const c = sx >= 0 && sx < cols ? row + sx : -1;
        const t = c >= 0 ? light[c] : -1;
        if (dropped || t < 0) {
          px[o] = BLACK;
          continue;
        }
        // Between two colours of the ramp, dithered: Bayer, or in scan-line patches, by row.
        const lo = Math.min(1, Math.floor(t));
        const f = t - lo;
        const threshold = lines[c] ? ((gy & 3) + 0.5) / 4 : BAYER[bayerRow + (gx & 3)];
        px[o] = RAMP[f > threshold ? lo + 1 : lo];
      }
    }
    this.fall(dt, loud);

    this.loCtx.putImageData(this.image, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.lo, 0, 0, cols * this.cell, rows * this.cell);
    ctx.restore();
  }

  /** A kick: tears the picture as hard as the hit (0–1+) if nothing is tearing it already. */
  kick(strength: number, loud: number): void {
    if (this.glitchLeft <= 0 && Math.random() < 0.35 + 0.5 * loud)
      this.startGlitch(Math.min(1, strength * (0.5 + loud)));
  }

  /**
   * Each particle's tone, from a pattern laid over the globe's surface (its sphere point, which turns
   * with it): broad light and dark patches with veins of brighter tone through them, a few patches
   * dithering as scan lines.
   */
  private layTones(sim: Simulation): void {
    const n = sim.count;
    this.tone = new Float32Array(n);
    this.scan = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const sx = sim.sphereX[i];
      const sy = sim.sphereY[i];
      const sz = sim.sphereZ[i];
      const broad = Math.sin(2.1 * sx + 0.7) * Math.sin(1.7 * sy + 2.2) + Math.sin(1.9 * sz + 0.3) * 0.6;
      const vein = Math.sin(5.3 * sx + 3.1 * sy - 2.4 * sz + 1.1);
      this.tone[i] = Math.max(0.35, 0.82 + 0.3 * broad + (vein > 0.82 ? 0.45 : 0));
      this.scan[i] = Math.sin(3.7 * sx - 2.9 * sz + 0.5) * Math.sin(2.3 * sy + 1.4) > 0.55 ? 1 : 0;
    }
  }

  /** Rain: each streak falls by its depth and is drawn only over the black, flickering on its own. */
  private fall(dt: number, loud: number): void {
    const { cols, rows } = this;
    const px = this.pixels;
    const live = Math.round(this.rain.length * (RAIN_QUIET + (1 - RAIN_QUIET) * loud));
    for (let k = 0; k < this.rain.length; k++) {
      const d = this.rain[k];
      // Near streaks fall fast, far ones drift: parallax.
      const speed = (6 + 70 * d.near * d.near) * this.rainScale;
      d.y += speed * dt;
      if (d.y > rows) Object.assign(d, this.drop(false));
      if (k >= live || Math.random() < 0.18) continue;
      const gx = Math.floor(d.x);
      if (gx < 0 || gx >= cols) continue;
      const len = Math.round((2 + 16 * d.near * d.near) * this.rainScale);
      const shade = 70 + 185 * d.near * (0.7 + 0.3 * Math.random());
      // The streak's head is its lower end; above it the streak itself, then the blur trailing off.
      const head = Math.floor(d.y) + len;
      const blur = Math.round(speed * RAIN_BLUR);
      for (let j = 0; j < len + blur; j++) {
        const gy = head - j;
        if (gy < 0) break;
        if (gy >= rows) continue;
        const o = gy * cols + gx;
        if (px[o] !== BLACK) continue;
        const fade = j < len ? 1 : (1 - (j - len) / blur) ** 1.5;
        const v = Math.round(shade * fade);
        if (v < 14) continue;
        px[o] = rgba(v, v, Math.min(255, v + 6));
      }
    }
  }

  private drop(anywhere: boolean): Drop {
    return {
      x: Math.random() * this.cols,
      y: anywhere ? Math.random() * this.rows : -20 * Math.random(),
      near: Math.random() ** 1.6,
    };
  }

  private startGlitch(amount: number): void {
    this.glitchLeft = GLITCH_SECONDS[0] + (GLITCH_SECONDS[1] - GLITCH_SECONDS[0]) * Math.random();
    const n = 1 + Math.floor(Math.random() * GLITCH_BANDS * Math.max(0.3, amount));
    this.bands = [];
    for (let b = 0; b < n; b++) {
      const h = 4 + Math.floor(Math.random() * this.rows * 0.18);
      const y0 = Math.floor(Math.random() * (this.rows - h));
      const reach = this.cols * (0.02 + 0.12 * amount);
      this.bands.push({
        y0,
        y1: y0 + h,
        shift: Math.round((Math.random() * 2 - 1) * reach),
        interlace: Math.random() < 0.7,
      });
    }
  }

  /**
   * Sets an irregular blob of whole cells round (gx, gy), about as wide as a dot of radius `r`, to light
   * `t`, where nothing nearer has set them. Each particle keeps its own blob (`variant`), nibbled and
   * bumped, so the surface breaks up like the footage rather than into rounds or squares.
   */
  private splat(
    gx: number,
    gy: number,
    r: number,
    z: number,
    t: number,
    scan: number,
    variant: number,
  ): void {
    const { cols, rows, light, depth, lines } = this;
    const n = Math.min(16, Math.max(1, Math.round(r * Math.sqrt(Math.PI))));
    const stamp = stampsFor(n)[variant];
    const left = Math.round(gx - n / 2) - 1;
    const top = Math.round(gy - n / 2) - 1;
    for (let k = 0; k < stamp.length; k += 3) {
      const y = top + stamp[k + 1];
      if (y < 0 || y >= rows) continue;
      const x0 = Math.max(0, left + stamp[k]);
      const x1 = Math.min(cols - 1, left + stamp[k] + stamp[k + 2] - 1);
      for (let x = x0; x <= x1; x++) {
        const o = y * cols + x;
        if (z > depth[o]) {
          depth[o] = z;
          light[o] = t;
          lines[o] = scan;
        }
      }
    }
  }

  /** The moon: a sphere lit by the same light, in depth with the particles. */
  private paintMoon(sim: Simulation, camera: number, k: number, at: readonly [number, number, number]): void {
    const { moon } = sim;
    const { cx, cy } = sim.viewport;
    const ps = camera / (camera - at[2]);
    const mx = (cx + (at[0] - cx) * ps) * k;
    const my = (cy + (at[1] - cy) * ps) * k;
    const mr = moon.radius * ps * k;
    const { cols, rows, light, depth, lines } = this;
    for (let y = Math.max(0, Math.floor(my - mr)); y <= Math.min(rows - 1, Math.ceil(my + mr)); y++)
      for (let x = Math.max(0, Math.floor(mx - mr)); x <= Math.min(cols - 1, Math.ceil(mx + mr)); x++) {
        const nx = (x + 0.5 - mx) / mr;
        const ny = (y + 0.5 - my) / mr;
        const q = 1 - nx * nx - ny * ny;
        if (q <= 0) continue;
        const nz = Math.sqrt(q);
        const o = y * cols + x;
        const z = at[2] + nz * moon.radius;
        if (z <= depth[o]) continue;
        const lambert = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
        const rim = (1 - nz) ** 2 * Math.max(0, nx * Math.sign(KEY[0]));
        depth[o] = z;
        light[o] = Math.min(2, (0.75 * (0.18 + 0.95 * lambert) + RIM_GAIN * rim) * RAMP_GAIN);
        lines[o] = 1;
      }
  }
}
