// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import './styles.css';
import { AudioEngine } from './audio/audio-engine';
import { Transport } from './audio/transport';
import { byId } from './lib/dom';
import { nowSeconds } from './lib/math';
import { load, save, StorageKey } from './lib/storage';
import { MidiController } from './midi/midi-controller';
import { Renderer } from './render/renderer';
import { Simulation } from './sim/simulation';
import { bindControls, createAudioListener, type ControlHost } from './ui/controls';
import { computeViewport, placePanelTab } from './ui/layout';

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;
const DEFAULT_BPM = 100;

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
  pulseOn: 'kick' | 'beat' = 'kick';

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

  constructor() {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new Renderer(this.canvas, this.sim, reducedMotion);
    this.sim.pointer.attach(this.canvas);
    byId('nn').textContent = this.sim.count.toLocaleString();

    ({ refreshTempoLabels: this.refreshTempoLabels } = bindControls(this));
    new MidiController(this.panel, this.transport.clock, (velocity) => {
      this.fire(velocity);
    });
    if (load(StorageKey.Night) === '1') this.setNight(true);

    window.addEventListener('resize', () => {
      this.resize();
    });
    this.resize();
    window.setInterval(() => {
      this.updateTempoReadout();
    }, 100);
    requestAnimationFrame((t) => {
      this.frame(t);
    });
  }

  fire(strength: number): void {
    this.sim.fire(strength);
    if (this.renderer.night) this.renderer.fireflies.wave(strength, nowSeconds());
  }

  flashBeat(): void {
    this.beatFlash = 1;
  }

  setNight(on: boolean): void {
    this.renderer.night = on;
    document.documentElement.toggleAttribute('data-night', on);
    byId(on ? 'night-on' : 'night-off', HTMLInputElement).checked = true;
    save(StorageKey.Night, on ? '1' : '');
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
