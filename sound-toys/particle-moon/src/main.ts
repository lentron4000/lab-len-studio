// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import './styles.css';
import { AudioEngine } from './audio/audio-engine';
import { Transport } from './audio/transport';
import { labMode } from './lab-mode';
import { byId } from './lib/dom';
import { nowSeconds } from './lib/math';
import { load, save, StorageKey } from './lib/storage';
import { MidiController } from './midi/midi-controller';
import { type Look, Renderer } from './render/renderer';
import { Bloom, BLOOM_SECONDS } from './sim/bloom';
import { Simulation } from './sim/simulation';
import { bindControls, createAudioListener, type ControlHost } from './ui/controls';
import { computeViewport, placePanelTab } from './ui/layout';
import { ShowMode } from './ui/show';
import { bindSummoning } from './ui/summon';

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;
const DEFAULT_BPM = 100;
/** The loader shows at least this long, so it reads as a beat rather than a flicker… */
const MIN_LOADER_MS = 800;
/** …and waits at most this long for the web fonts (offline they never come). */
const FONT_WAIT_MS = 3000;
/** Into the bloom, as a share of its length, when the logo and controls fade in. */
const UI_REVEAL_AT = 0.6;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const LOOK_RADIO: Record<Look, string> = { day: 'night-off', night: 'night-on', ritual: 'night-ritual' };

/** The look last chosen in len mode (the only mode that can switch); '1' is how night used to be saved. */
function savedLook(): Look {
  const v = load(StorageKey.Night);
  if (v === '1' || v === 'night') return 'night';
  return v === 'ritual' ? 'ritual' : 'day';
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

  constructor() {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new Renderer(this.canvas, this.sim, reducedMotion);
    this.sim.pointer.attach(this.canvas);
    byId('nn').textContent = this.sim.count.toLocaleString();

    const controls = bindControls(this);
    this.refreshTempoLabels = controls.refreshTempoLabels;
    // Locked modes hide the look switch; formations (and their controls) only where the mode has them.
    byId('look-row').hidden = this.mode.look !== null;
    byId('summon-row').hidden = byId('intensity-row').hidden = !this.mode.formations;
    const { onNote, onPressure } = this.mode.formations
      ? bindSummoning(this.sim)
      : { onNote: () => undefined, onPressure: () => undefined };
    new MidiController(
      this.panel,
      this.transport.clock,
      (velocity) => {
        this.fire(velocity);
      },
      onNote,
      onPressure,
    );
    this.setLook(this.mode.look ?? savedLook());
    // Opens with the controls collapsed but the header and Controls button showing. H (or Hide) still
    // clears everything for projection.
    controls.setPanel(false, false, false);

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
    void this.open(reducedMotion);
  }

  /** Loader → bloom → controls. Waits for the fonts so the panel is measured at its final size. */
  private async open(reducedMotion: boolean): Promise<void> {
    this.renderer.limit = 0;
    this.placeLoader();
    await Promise.all([Promise.race([document.fonts.ready, wait(FONT_WAIT_MS)]), wait(MIN_LOADER_MS)]);
    this.resize(); // final layout; every particle at home
    this.placeLoader();
    this.waiting = false;
    document.documentElement.classList.remove('loading');
    if (reducedMotion) {
      this.renderer.limit = Infinity;
      this.showUi();
      return;
    }
    const { cx, cy } = this.sim.viewport;
    this.bloom = new Bloom(this.sim, cx, cy);
    this.renderer.hidden = this.bloom.hidden;
    this.renderer.limit = Infinity;
    this.bloomStart = performance.now();
  }

  /** Moves the loader's particle to the shape's centre, where the bloom will start. */
  private placeLoader(): void {
    const { cx, cy } = this.sim.viewport;
    const style = document.documentElement.style;
    style.setProperty('--lx', `${cx}px`);
    style.setProperty('--ly', `${cy}px`);
  }

  private endBloom(): void {
    this.bloom = null;
    this.renderer.hidden = null;
    this.renderer.limit = Infinity;
    this.showUi();
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

  fire(strength: number): void {
    this.sim.fire(strength);
    if (this.renderer.look === 'night') this.renderer.fireflies.wave(strength, nowSeconds());
  }

  flashBeat(): void {
    this.beatFlash = 1;
  }

  setLook(look: Look): void {
    // A locked mode ignores N, MIDI toggles and anything else asking for another look.
    if (this.mode.look && look !== this.mode.look) return;
    this.renderer.look = look;
    // Night and ritual share the dark page; ritual then recolours it.
    document.documentElement.toggleAttribute('data-night', look !== 'day');
    document.documentElement.toggleAttribute('data-ritual', look === 'ritual');
    byId(LOOK_RADIO[look], HTMLInputElement).checked = true;
    if (!this.mode.look) save(StorageKey.Night, look);
  }

  setBare(on: boolean): void {
    this.show.setBare(on);
  }

  relayout(): void {
    placePanelTab(this.panel);
    this.sim.setViewport(
      computeViewport(window.innerWidth, window.innerHeight, this.header, this.panel),
      false,
    );
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    placePanelTab(this.panel);
    this.sim.setViewport(
      computeViewport(window.innerWidth, window.innerHeight, this.header, this.panel),
      true,
    );
  }

  private frame(now: number): void {
    const dtMs = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    this.accumulator += dtMs;

    this.renderer.tick(dtMs / 1000, nowSeconds());
    this.handleTransport();
    this.beatDot.style.opacity = (0.12 + 0.88 * this.beatFlash).toFixed(2);
    this.beatFlash *= 0.88;

    let steps = 0;
    let ke = 0;
    if (this.waiting || this.bloom) {
      // Nothing moves under its own physics until the shape has bloomed.
      this.accumulator = 0;
      if (this.bloom) this.advanceBloom(now);
    }
    while (this.accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      ke = this.sim.step();
      this.accumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell behind: drop time rather than spiral
    if (steps) this.energy = this.energy * 0.9 + ke * 0.1;

    const dot = this.renderer.draw();
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
    // Particles jump from the loader as they're born; don't draw trails across that.
    this.renderer.tracers.reset();
    this.renderer.resetStreaks();
    if (t > BLOOM_SECONDS * UI_REVEAL_AT) this.showUi();
    if (this.bloom.done(t)) this.endBloom();
  }

  /** Kicks and beats → pulses. The demo always pulses on its own kick, which is also its beat. */
  private handleTransport(): void {
    const { kicks, beats } = this.transport.poll(nowSeconds());
    if (this.pulseOn === 'kick') for (const k of kicks) this.fire(k);
    for (let b = 0; b < beats; b++) {
      this.beatFlash = 1;
      if (this.pulseOn === 'beat' || this.audio.mode === 'demo') this.fire(1);
    }
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
