// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { AudioDevice, AudioEngine, AudioEngineListener, FileState } from '../audio/audio-engine';
import type { SourceMode, Transport } from '../audio/transport';
import { byId, isShortcut, paintRange, radios } from '../lib/dom';
import { DIVISIONS, divisionSeconds } from '../sim/divisions';
import { PHYSICS_MODES, type PhysicsModeId } from '../sim/physics-modes';
import type { Simulation } from '../sim/simulation';

/** What the panel needs from the app. */
export interface ControlHost {
  readonly sim: Simulation;
  readonly transport: Transport;
  readonly audio: AudioEngine;
  pulseOn: 'kick' | 'beat';
  fire(strength: number): void;
  flashBeat(): void;
  setNight(on: boolean): void;
  relayout(): void;
}

/** Panel elements the audio engine reports into (file name, play state, live input status, devices). */
export function createAudioListener(): AudioEngineListener {
  const fileInput = byId('file', HTMLInputElement);
  const playBtn = byId('play', HTMLButtonElement);
  const fileName = byId('fname');
  const deviceSelect = byId('device', HTMLSelectElement);
  const liveStatus = byId('live-status');
  return {
    fileState(state: FileState) {
      if (state.message) fileName.textContent = state.message;
      playBtn.disabled = !state.canPlay;
      playBtn.textContent = state.playing ? 'Pause' : 'Play';
    },
    liveStatus(message: string) {
      liveStatus.textContent = message;
    },
    devices(list: AudioDevice[], current: string) {
      deviceSelect.replaceChildren(...list.map((d) => new Option(d.label, d.id, false, d.id === current)));
      deviceSelect.disabled = list.length === 0;
    },
    requestFile() {
      fileInput.click();
    },
  };
}

/**
 * Binds the control panel to the app. Returns `refreshTempoLabels`, which re-renders the
 * spin and orbit lengths (they're shown in seconds, so they change with the tempo).
 */
export function bindControls(host: ControlHost): { refreshTempoLabels: () => void } {
  const { sim, transport, audio } = host;
  const panel = byId('panel');

  const onInput = (id: string, fn: (el: HTMLInputElement) => void): HTMLInputElement => {
    const el = byId(id, HTMLInputElement);
    const run = (): void => {
      fn(el);
      paintRange(el);
    };
    el.addEventListener('input', run);
    run();
    return el;
  };
  const onRadio = (name: string, fn: (value: string) => void): void => {
    for (const r of radios(name)) {
      r.addEventListener('change', () => {
        if (r.checked) fn(r.value);
      });
    }
  };

  // ---- Scene
  onInput('state', (el) => {
    sim.stateTarget = Number(el.value) / 1000;
  });
  sim.state = sim.stateTarget;

  const spinRow = byId('spin-row');
  onRadio('shape', (v) => {
    sim.shapeTarget = v === 'globe' ? 1 : 0;
    spinRow.hidden = v !== 'globe';
    host.relayout();
  });
  onRadio('night', (v) => {
    host.setNight(v === 'night');
  });

  const desc = byId('desc');
  onRadio('mode', (v) => {
    sim.mode = PHYSICS_MODES[v as PhysicsModeId];
    desc.textContent = sim.mode.description;
  });
  desc.textContent = sim.mode.description;

  const spin = byId('spin', HTMLInputElement);
  const spinOut = byId('spin-out');
  const orbit = byId('orbit', HTMLInputElement);
  const orbitOut = byId('orbit-out');
  const describeDivision = (input: HTMLInputElement, out: HTMLElement, noun: string): number => {
    const d = DIVISIONS[Number(input.value)];
    out.textContent = d.bars ? `${d.label} · ${divisionSeconds(d.bars, sim.bpm).toFixed(1)} s` : 'Stopped';
    input.setAttribute('aria-valuetext', d.bars ? `One ${noun} per ${d.label}` : 'Stopped');
    return d.bars;
  };
  const refreshTempoLabels = (): void => {
    sim.spinBars = describeDivision(spin, spinOut, 'revolution');
    sim.moon.bars = describeDivision(orbit, orbitOut, 'orbit');
  };
  onInput('spin', refreshTempoLabels);
  onInput('orbit', refreshTempoLabels);

  const orbitRow = byId('orbit-row');
  const forceRow = byId('force-row');
  onRadio('moon', (v) => {
    sim.moon.enabled = v === 'on';
    orbitRow.hidden = forceRow.hidden = !sim.moon.enabled;
    host.relayout();
  });
  const forceOut = byId('force-out');
  onInput('mforce', (el) => {
    sim.moon.force = Number(el.value) / 100;
    forceOut.textContent = `${sim.moon.force.toFixed(1)}×`;
  });

  // ---- Audio source
  const fileRow = byId('file-row');
  const liveRow = byId('live-row');
  const fileInput = byId('file', HTMLInputElement);
  const playBtn = byId('play', HTMLButtonElement);
  const deviceSelect = byId('device', HTMLSelectElement);

  onRadio('pulse', (v) => {
    const mode = v as SourceMode;
    fileRow.hidden = mode !== 'file';
    liveRow.hidden = mode !== 'live';
    void audio.setMode(mode);
    host.relayout();
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void audio.loadFile(file);
  });
  playBtn.addEventListener('click', () => void audio.togglePlay());
  deviceSelect.addEventListener('change', () => void audio.selectDevice(deviceSelect.value));

  // ---- Tempo and pulse
  byId('tap').addEventListener('click', () => {
    transport.tap();
    host.flashBeat();
  });
  byId('tempo-half').addEventListener('click', () => {
    transport.halve();
  });
  byId('tempo-double').addEventListener('click', () => {
    transport.double();
  });
  byId('tempo-auto').addEventListener('click', () => {
    transport.auto(audio.mode);
  });
  onRadio('pulseon', (v) => {
    host.pulseOn = v === 'beat' ? 'beat' : 'kick';
  });
  byId('kick').addEventListener('click', () => {
    host.fire(1);
  });
  onInput('depth', (el) => {
    sim.depth = Number(el.value) / 1000;
  });

  // ---- Panel visibility and shortcuts
  const hideBtn = byId('hide-ctl', HTMLButtonElement);
  const showBtn = byId('show-ctl', HTMLButtonElement);
  const setPanel = (open: boolean): void => {
    panel.hidden = !open;
    hideBtn.hidden = !open;
    showBtn.hidden = open;
    (open ? hideBtn : showBtn).focus({ preventScroll: true });
    host.relayout();
  };
  hideBtn.addEventListener('click', () => {
    setPanel(false);
  });
  showBtn.addEventListener('click', () => {
    setPanel(true);
  });
  window.addEventListener('keydown', (e) => {
    if (isShortcut(e, 'h')) setPanel(panel.hidden);
    else if (isShortcut(e, 'n')) host.setNight(!document.documentElement.hasAttribute('data-night'));
    else if (isShortcut(e, 't')) {
      transport.tap();
      host.flashBeat();
    }
  });

  refreshTempoLabels();

  return { refreshTempoLabels };
}
