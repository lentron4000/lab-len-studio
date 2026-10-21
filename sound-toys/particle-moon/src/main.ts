// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import './styles.css';
import { AudioEngine } from './audio/audio-engine';
import { Transport } from './audio/transport';
import { Director } from './auto/director';
import { MusicListener } from './auto/listener';
import { labMode } from './lab-mode';
import { byId, isShortcut } from './lib/dom';
import { nowSeconds } from './lib/math';
import { MidiController } from './midi/midi-controller';
import { type Look, Renderer } from './render/renderer';
import { Bloom } from './sim/bloom';
import { DROP_SECONDS, Simulation, type Viewport } from './sim/simulation';
import { bindControls, createAudioListener, type ControlHost } from './ui/controls';
import { computeViewport, placePanelTab } from './ui/layout';
import { attachOrbit } from './ui/orbit';
import { ShowMode } from './ui/show';
import { bindSummoning } from './ui/summon';

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;
const DEFAULT_BPM = 100;
/** Depth × this in quiet music, up to × DEPTH_LOUD by LOUD_AT loudness (0–1, the listener's energy). */
const DEPTH_QUIET = 0.5;
const DEPTH_LOUD = 1.5;
const LOUD_AT = 0.8;
/** The opening waits at most this long for the web fonts (offline they never come). */
const FONT_WAIT_MS = 3000;
/** Energy (0–1, see MusicFeatures) below which there's no music for AI mode to play to. */
const MUSIC_FLOOR = 0.04;
/** A kick this long (s) past a predicted beat's wind-up still counts as landing on it (detection jitter). */
const DROP_GRACE = 0.08;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const LOOK_RADIO: Record<Look, string> = {
  day: 'night-off',
  dark: 'night-dark',
  night: 'night-on',
  ritual: 'night-ritual',
  wire: 'night-wire',
  refract: 'night-refract',
};

/** The system's light or dark setting. */
const systemDark = matchMedia('(prefers-color-scheme: dark)');

/** The look to open on where the mode doesn't set one: Day or Night, as the system is set. */
function systemLook(): Look {
  return systemDark.matches ? 'dark' : 'day';
}

/** Particle count scales with screen area: dense enough to read as solid, light enough for phones. */
function particleCount(): number {
  return Math.min(2800, Math.max(1200, Math.round((window.innerWidth * window.innerHeight) / 420)));
}

/**
 * Composition root. Owns the frame loop: real-time effects, transport events → pulses,
 * fixed-step physics (up to three steps per frame to catch up), then one draw.
 */
class App implements ControlHost {
  readonly sim = new Simulation(particleCount());
  readonly transport = new Transport();
  readonly audio = new AudioEngine(this.transport, createAudioListener());
  readonly renderer: Renderer;
  /** From `?m=`: which look is locked in and whether formations are on. */
  readonly mode = labMode(location.search, import.meta.env.VITE_LAB_MODE);
  pulseOn: 'kick' | 'beat' = 'kick';
  /** When the last wind-up started (s), and kicks waiting out a wind-up of their own before they hit. */
  private dropAt = -Infinity;
  private held: { at: number; strength: number }[] = [];

  private readonly show = new ShowMode();
  private readonly canvas = byId('c', HTMLCanvasElement);
  private readonly header = document.querySelector<HTMLElement>('.top')!;
  private readonly panel = byId('panel');
  private readonly beatDot = byId('beat');
  private readonly readouts = {
    rho: byId('rho'),
    energy: byId('ek'),
    bpm: byId('bpm'),
    tempo: byId('tempo-out'),
    tempoSource: byId('tempo-src'),
    auto: byId('tempo-auto'),
    level: byId('lvl'),
  };
  private readonly refreshTempoLabels: () => void;
  private beatFlash = 0;
  private lastFrame = performance.now();
  private accumulator = 0;
  private energy = 0;
  private frameCount = 0;
  /** The opening: waiting on the loader, then the bloom. Physics starts once both are done. */
  private waiting = true;
  private bloom: Bloom | null = null;
  private bloomStart = 0;
  private uiShown = false;

  /** AI mode: listens to the music and plays the controls (Auto button, A). */
  private readonly listener = new MusicListener();
  private readonly director = new Director({
    setSlider: (id, value01) => {
      this.driving = true;
      const el = byId(id, HTMLInputElement);
      const min = Number(el.min);
      const max = Number(el.max);
      const step = Number(el.step) || 1;
      const value = String(Math.round((min + (max - min) * Math.min(1, Math.max(0, value01))) / step) * step);
      if (el.value !== value) {
        el.value = value;
        el.dispatchEvent(new Event('input'));
      }
      this.driving = false;
    },
    setOption: (group, id) => {
      if (group === 'pole') {
        // Toggles: switch on the one asked for, or switch off whichever is on.
        const boxes = document.querySelectorAll<HTMLInputElement>('input[name="pole"]');
        const want = Array.from(boxes).find((b) => b.value === id);
        const on = Array.from(boxes).find((b) => b.checked);
        const click = want ? (want.checked ? null : want) : on;
        if (!click) return;
        this.driving = true;
        click.click();
        this.driving = false;
        return;
      }
      const el = document.querySelector<HTMLInputElement>(`input[name="${group}"][value="${id}"]`);
      if (!el || el.checked) return;
      this.driving = true;
      el.checked = true;
      el.dispatchEvent(new Event('change'));
      this.driving = false;
    },
    fire: (strength) => {
      this.fire(strength);
    },
    pan: (x, y) => {
      this.panTarget.x = x;
      this.panTarget.y = y;
    },
    aim: (yaw, pitch, seconds) => {
      this.sim.camera.glideTo(yaw, pitch, seconds);
    },
  });
  /** AI mode's slow pan (fractions of the screen), eased; back to centre when it's off. */
  private readonly panTarget = { x: 0, y: 0 };
  private readonly panNow = { x: 0, y: 0 };
  /** The shape's laid-out place before any pan. */
  private baseView: Viewport | null = null;
  /** True while the director moves a control, so its own moves aren't taken as the performer's. */
  private driving = false;

  constructor() {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new Renderer(this.canvas, this.sim, reducedMotion);
    this.sim.pointer.attach(this.canvas);
    // Turning the view by hand (or resetting it) takes it from AI mode for a while.
    attachOrbit(this.canvas, this.sim, () => {
      this.director.touch('view');
    });
    byId('view-reset').addEventListener('click', () => {
      this.director.touch('view');
      this.sim.camera.reset();
    });
    byId('nn').textContent = this.sim.count.toLocaleString();

    const controls = bindControls(this);
    this.refreshTempoLabels = controls.refreshTempoLabels;
    // Locked modes hide the look switch; formations (and their controls) only where the mode has them.
    byId('look-row').hidden = this.mode.look !== null;
    // Only the mode's own looks are offered (the plain toy: Day and Night; the rest by ?m=).
    for (const [look, id] of Object.entries(LOOK_RADIO) as [Look, string][])
      byId(id).closest('label')!.hidden = !this.mode.looks.includes(look);
    byId('summon-row').hidden = byId('intensity-row').hidden = !this.mode.formations;
    const { onNote, onPressure } = this.mode.formations
      ? bindSummoning(this.sim)
      : { onNote: () => undefined, onPressure: () => undefined };
    new MidiController(
      this.panel,
      this.transport.clock,
      (velocity) => {
        this.fire(velocity, true);
      },
      onNote,
      onPressure,
    );
    this.setLook(this.mode.look ?? systemLook());
    // While on Day or Night, follow the system as it changes (sunset, a manual switch).
    systemDark.addEventListener('change', () => {
      if (!this.mode.look && (this.renderer.look === 'day' || this.renderer.look === 'dark'))
        this.setLook(systemLook());
    });
    // Opens with the controls hidden (bare, for projection); moving the pointer shows the Controls button, H toggles.
    controls.setPanel(false, false);

    window.addEventListener('resize', () => {
      this.resize();
      if (this.bloom) this.endBloom(); // its targets just moved; finish rather than fly to old ones
    });
    this.resize();
    // The panel and header change size on their own too: when the web font arrives (text rewraps),
    // or a status line grows. Follow them so the Hide tab stays on the panel's edge.
    new ResizeObserver(() => {
      this.relayout();
    }).observe(this.panel);
    new ResizeObserver(() => {
      this.relayout();
    }).observe(this.header);
    window.setInterval(() => {
      this.updateTempoReadout();
    }, 100);
    requestAnimationFrame((t) => {
      this.frame(t);
    });
    this.audio.onAnalysis = (frames) => {
      this.listener.push(frames, nowSeconds());
    };
    byId('auto').addEventListener('click', () => {
      this.toggleAuto();
    });
    window.addEventListener('keydown', (e) => {
      if (isShortcut(e, 'a')) this.toggleAuto();
      else if (isShortcut(e, 'r')) {
        this.director.touch('view');
        this.sim.camera.reset();
      }
    });
    // Anything the performer (or a MIDI controller) moves while AI mode plays is theirs for a while.
    const handBack = (e: Event): void => {
      const el = e.target;
      if (this.driving || !(el instanceof HTMLInputElement)) return;
      this.director.touch(el.type === 'radio' || el.type === 'checkbox' ? el.name : el.id);
    };
    this.panel.addEventListener('input', handBack, true);
    this.panel.addEventListener('change', handBack, true);
    void this.open(reducedMotion);
  }

  /** Controls, then the circle grows from its centre. Waits for the fonts so the panel is measured at its final size. */
  private async open(reducedMotion: boolean): Promise<void> {
    this.renderer.limit = 0;
    await Promise.race([document.fonts.ready, wait(FONT_WAIT_MS)]);
    this.resize(); // final layout; every particle at home
    this.waiting = false;
    document.documentElement.classList.remove('loading');
    this.showUi();
    this.renderer.limit = Infinity;
    if (reducedMotion) return;
    const { cx, cy } = this.sim.viewport;
    this.bloom = new Bloom(this.sim, cx, cy);
    this.bloomStart = performance.now();
  }

  private endBloom(): void {
    this.bloom = null;
    this.renderer.limit = Infinity;
  }

  private showUi(): void {
    if (this.uiShown) return;
    this.uiShown = true;
    const root = document.documentElement;
    root.classList.add('intro');
    root.classList.remove('preload');
    window.setTimeout(() => {
      root.classList.remove('intro');
    }, 1200);
  }

  /**
   * A kick: the energy drops for a moment, then the hit lands. On a beat the clock saw coming, the drop
   * is already under way and it hits at once; out of the blue (no tempo yet, AI mode's drop) it winds up
   * first, DROP_SECONDS late. A `played` hit (a pad, the Hit button) lands at once, no wind-up: a
   * performer's hit must never lag.
   */
  fire(strength: number, played = false): void {
    const now = nowSeconds();
    if (played || now - this.dropAt < DROP_SECONDS + DROP_GRACE) {
      this.hit(strength);
      return;
    }
    this.windUp(now);
    this.held.push({ at: now + DROP_SECONDS, strength });
  }

  private windUp(now: number): void {
    this.dropAt = now;
    this.sim.drop();
  }

  private hit(strength: number): void {
    this.sim.fire(strength);
    if (this.renderer.look === 'refract') this.renderer.refract.kick(strength, this.renderer.loud);
    if (this.renderer.look === 'night') this.renderer.fireflies.wave(strength, nowSeconds());
  }

  flashBeat(): void {
    this.beatFlash = 1;
  }

  setLook(look: Look): void {
    // A locked mode ignores N, MIDI toggles and anything else asking for another look.
    if (this.mode.look && look !== this.mode.look) return;
    this.renderer.look = look;
    // Wire lays the globe's particles out as a geodesic frame (a morph, or at once while opening).
    this.sim.wireTarget = look === 'wire' ? 1 : 0;
    if (this.waiting) this.sim.snapWire();
    // Party (night) and ritual share the dusk page; ritual then recolours it. Night (dark) inverts day's.
    document.documentElement.toggleAttribute(
      'data-night',
      look === 'night' || look === 'ritual' || look === 'wire' || look === 'refract',
    );
    document.documentElement.toggleAttribute('data-dark', look === 'dark');
    document.documentElement.toggleAttribute('data-ritual', look === 'ritual');
    document.documentElement.toggleAttribute('data-wire', look === 'wire');
    document.documentElement.toggleAttribute('data-refract', look === 'refract');
    byId(LOOK_RADIO[look], HTMLInputElement).checked = true;
  }

  setBare(on: boolean): void {
    this.show.setBare(on);
  }

  relayout(): void {
    placePanelTab(this.panel);
    this.baseView = computeViewport(window.innerWidth, window.innerHeight, this.header, this.panel);
    this.sim.setViewport(this.panned(this.baseView), false);
  }

  /** The laid-out viewport moved by the current pan. */
  private panned(view: Viewport): Viewport {
    return { ...view, cx: view.cx + this.panNow.x * view.width, cy: view.cy + this.panNow.y * view.height };
  }

  private applyPan(dt: number): void {
    if (!this.director.enabled) this.panTarget.x = this.panTarget.y = 0;
    const k = 1 - Math.exp(-dt / 0.5);
    const dx = (this.panTarget.x - this.panNow.x) * k;
    const dy = (this.panTarget.y - this.panNow.y) * k;
    if (!this.baseView || (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6)) return;
    this.panNow.x += dx;
    this.panNow.y += dy;
    this.sim.setViewport(this.panned(this.baseView), false);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    placePanelTab(this.panel);
    this.baseView = computeViewport(window.innerWidth, window.innerHeight, this.header, this.panel);
    this.sim.setViewport(this.panned(this.baseView), true);
  }

  private frame(now: number): void {
    const dtMs = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    this.accumulator += dtMs;

    this.renderer.tick(dtMs / 1000, nowSeconds());
    this.sim.camera.tick(dtMs / 1000);
    this.handleTransport();
    this.listen(dtMs / 1000);
    this.applyPan(dtMs / 1000);
    this.beatDot.style.opacity = (0.12 + 0.88 * this.beatFlash).toFixed(2);
    this.beatFlash *= 0.88;

    let steps = 0;
    let ke = 0;
    if (this.waiting || this.bloom) {
      // Nothing moves under its own physics until the shape has bloomed.
      this.accumulator = 0;
      if (this.bloom) this.advanceBloom(now);
      // The bloom places particles itself: nothing to draw between.
      this.sim.settle();
    }
    while (this.accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      ke = this.sim.step();
      this.accumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell behind: drop time rather than spiral
    if (steps) this.energy = this.energy * 0.9 + ke * 0.1;

    // Drawn between the last two steps, by how far into the next one this frame falls.
    const dot = this.renderer.draw(Math.min(1, this.accumulator / STEP_MS), dtMs / STEP_MS);
    if ((this.frameCount++ & 7) === 0) {
      const re = this.sim.effectiveRadius();
      this.readouts.rho.textContent = Math.min(1, (this.sim.count * dot * dot) / (re * re)).toFixed(2);
      this.readouts.energy.textContent = this.energy.toFixed(2);
    }
    requestAnimationFrame((t) => {
      this.frame(t);
    });
  }

  private advanceBloom(now: number): void {
    if (!this.bloom) return;
    const t = (now - this.bloomStart) / 1000;
    this.bloom.update(t);
    // Growing isn't motion of their own: no trails or streaks from it.
    this.renderer.tracers.reset();
    this.renderer.resetStreaks();
    if (this.bloom.done(t)) this.endBloom();
  }

  /** Kicks and beats → pulses. The demo always pulses on its own kick, which is also its beat. */
  private handleTransport(): void {
    const now = nowSeconds();
    // The wind-up leads each beat the clock sees coming; kicks that wound up on their own land after theirs.
    if (this.transport.upcoming(now, DROP_SECONDS)) this.windUp(now);
    const due = this.held.filter((h) => h.at <= now);
    this.held = this.held.filter((h) => h.at > now);
    for (const h of due) this.hit(h.strength);
    const { kicks, beats } = this.transport.poll(now);
    for (const k of kicks) this.listener.kick(k, now);
    if (this.pulseOn === 'kick') for (const k of kicks) this.fire(k);
    for (let b = 0; b < beats; b++) {
      this.beatFlash = 1;
      this.director.beat();
      if (this.audio.mode === 'demo') this.listener.kick(1, now);
      if (this.pulseOn === 'beat' || this.audio.mode === 'demo') this.fire(1);
    }
  }

  /** Sound level (vibration) and AI mode, once per frame. */
  private listen(dt: number): void {
    const now = nowSeconds();
    this.listener.tick(dt, now);
    for (const snare of this.listener.takeSnares()) this.sim.nudgeSpin(snare);
    const f = this.listener.features;
    // Vibration: mostly the highs (shimmer, and a flick on every hat), a little general loudness under
    // them. Silence is still. The demo kick isn't analysed; treat it as a steady, moderate sound.
    const target =
      this.audio.mode === 'demo'
        ? 0.7
        : this.audio.mode === 'off'
          ? 0
          : Math.min(1, 0.75 * f.shimmer + 0.25 * f.loud);
    this.sim.sound +=
      (target - this.sim.sound) * (1 - Math.exp(-dt / (target > this.sim.sound ? 0.03 : 0.25)));
    // Refract tears with loudness (the demo's synthetic kick isn't analysed: a steady middling level).
    this.renderer.loud = this.audio.mode === 'demo' ? 0.45 : this.audio.mode === 'off' ? 0 : f.loud;
    // Depth follows the music's loudness: from DEPTH_QUIET of Depth in quiet passages to DEPTH_LOUD
    // in loud ones (your Depth sits at a middling level). The demo's steady kick keeps Depth as set.
    const amp = this.audio.mode === 'file' || this.audio.mode === 'live' ? f.energy : null;
    const gain = amp === null ? 1 : DEPTH_QUIET + (DEPTH_LOUD - DEPTH_QUIET) * Math.min(1, amp / LOUD_AT);
    this.sim.depthGain += (gain - this.sim.depthGain) * (1 - Math.exp(-dt / 0.3));
    // AI mode waits for music (the demo's kick counts, though it isn't analysed).
    const playing = this.audio.mode === 'demo' || f.energy > MUSIC_FLOOR;
    this.director.update(f, dt, now, this.transport.readout(this.audio.mode).bpm, playing);
  }

  private toggleAuto(): void {
    if (this.director.enabled) {
      this.director.enabled = false;
      // The view AI mode turned goes back to straight on (one the performer turned stays put).
      if (this.director.holds('view')) this.sim.camera.reset();
    } else {
      const read = (id: string): number => {
        const el = byId(id, HTMLInputElement);
        return (Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min));
      };
      this.director.start({
        state: read('state'),
        depth: read('depth'),
        spin: read('spin'),
        orbit: read('orbit'),
        mforce: read('mforce'),
      });
    }
    byId('auto', HTMLButtonElement).setAttribute('aria-pressed', String(this.director.enabled));
  }

  private updateTempoReadout(): void {
    const r = this.transport.readout(this.audio.mode);
    const { readouts } = this;
    readouts.tempo.textContent = r.bpm ? (Number.isInteger(r.bpm) ? String(r.bpm) : r.bpm.toFixed(1)) : '–';
    readouts.bpm.textContent = r.bpm ? String(Math.round(r.bpm)) : '–';
    readouts.tempoSource.textContent = r.label;
    readouts.auto.hidden = !r.overridden;
    // Spin and orbit follow the tempo; with no source they fall back to the default.
    const bpm = r.bpm || (this.audio.mode === 'off' ? DEFAULT_BPM : this.sim.bpm);
    if (Math.abs(bpm - this.sim.bpm) >= 0.05) {
      this.sim.bpm = bpm;
      this.refreshTempoLabels();
    }
    if (this.audio.mode === 'live') {
      const pct = Math.max(0, Math.min(100, ((this.audio.levelDb + 60) / 60) * 100));
      readouts.level.style.width = `${pct.toFixed(0)}%`;
    }
  }
}

new App();
