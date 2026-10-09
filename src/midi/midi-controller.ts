// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { MidiClock } from '../audio/midi-clock';
import { byId } from '../lib/dom';
import { load, save, StorageKey } from '../lib/storage';
import { describeSource, profileFor, TOGGLES, type MidiMap, type SourceKey } from './profiles';

const STATUS_NOTE_ON = 0x90;
const STATUS_CC = 0xb0;
const SYSTEM = 0xf0;

/**
 * Web MIDI input: maps knobs and pads to panel controls, with a Map mode to reassign them
 * (click a control, then move a knob or hit a pad). MIDI clock is handed to the transport.
 */
export class MidiController {
  private map: MidiMap;
  private defaults: MidiMap;
  private learning = false;
  private learnTarget: string | null = null;
  private learnEl: HTMLElement | null = null;
  private connectedText = '';

  private readonly status = byId('midi-status');
  private readonly connectBtn = byId('midi-connect', HTMLButtonElement);
  private readonly mapBtn = byId('midi-map', HTMLButtonElement);
  private readonly resetBtn = byId('midi-reset', HTMLButtonElement);

  constructor(
    panel: HTMLElement,
    private readonly clock: MidiClock,
    /** A pad mapped to "Hit": fires a kick scaled by velocity. */
    private readonly onKick: (velocity: number) => void,
  ) {
    this.defaults = profileFor('').map;
    this.map = this.loadMap();
    this.connectBtn.addEventListener('click', () => void this.connect());
    this.mapBtn.addEventListener('click', () => {
      this.setLearning(!this.learning);
    });
    this.resetBtn.addEventListener('click', () => {
      this.map = { ...this.defaults };
      this.saveMap();
      this.renderBadges();
      this.status.textContent = 'Map reset to the controller defaults.';
    });
    panel.addEventListener(
      'pointerdown',
      (e) => {
        this.pickTarget(e);
      },
      true,
    );
    this.renderBadges();
  }

  private async connect(): Promise<void> {
    if (!('requestMIDIAccess' in navigator)) {
      this.status.textContent = 'This browser has no Web MIDI. Use Chrome or Edge.';
      return;
    }
    this.status.textContent = 'Asking for MIDI access…';
    try {
      const access = await navigator.requestMIDIAccess();
      access.onstatechange = () => {
        this.bindInputs(access);
      };
      this.bindInputs(access);
      this.connectBtn.textContent = 'Connected';
      this.connectBtn.disabled = true;
    } catch {
      this.status.textContent = 'MIDI is blocked here. Open the local copy in Chrome or Edge.';
    }
  }

  private bindInputs(access: MIDIAccess): void {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = (e) => {
        this.onMessage(e, input.name ?? '');
      };
      names.push(input.name ?? 'MIDI input');
    });
    // Defaults follow the first recognised controller; the user's own map (if any) still wins.
    if (names.length > 0) this.defaults = profileFor(names[0]).map;
    this.connectedText = names.length
      ? `Connected: ${names.join(', ')}. Map if you like, then press H to hide the controls.`
      : 'No MIDI inputs found. Plug in the controller.';
    if (!this.learning) this.status.textContent = this.connectedText;
    this.mapBtn.disabled = names.length === 0;
  }

  private onMessage(e: MIDIMessageEvent, portName: string): void {
    const data = e.data;
    if (!data || data.length === 0) return;
    const [status, d1 = 0, d2 = 0] = data;
    if (status >= SYSTEM && this.clock.handle(status, d1, d2, e.timeStamp, portName)) return;

    const command = status & 0xf0;
    let key: SourceKey;
    let isNote = false;
    if (command === STATUS_CC) key = `cc:${d1}`;
    else if (command === STATUS_NOTE_ON && d2 > 0) {
      key = `note:${d1}`;
      isNote = true;
    } else return;

    if (this.learning) {
      this.learn(key, d2);
      return;
    }
    const target = this.map[key];
    if (target) this.apply(target, d2, isNote);
  }

  /** Moves a control the way a user would, so every side effect runs through the normal handlers. */
  private apply(target: string, value: number, isNote: boolean): void {
    const pressed = isNote || value >= 64;
    if (target === 'kick') {
      if (isNote) this.onKick(0.35 + (0.65 * value) / 127);
      return;
    }
    let id = target;
    const toggle = TOGGLES[target] as (typeof TOGGLES)[string] | undefined;
    if (toggle) {
      if (!isNote) return;
      id = (document.getElementById(toggle[0]) as HTMLInputElement | null)?.checked ? toggle[1] : toggle[0];
    }
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const min = Number(el.min);
      const max = Number(el.max);
      const step = Number(el.step) || 1;
      el.value = String(Math.round((min + ((max - min) * value) / 127) / step) * step);
      el.dispatchEvent(new Event('input'));
    } else if (el instanceof HTMLInputElement && el.type === 'radio') {
      if (pressed) {
        el.checked = true;
        el.dispatchEvent(new Event('change'));
      }
    } else if (el instanceof HTMLButtonElement && pressed) {
      el.click();
    }
  }

  // ---------------------------------------------------------------- map mode

  private setLearning(on: boolean): void {
    this.learning = on;
    document.body.classList.toggle('learning', on);
    this.mapBtn.setAttribute('aria-pressed', String(on));
    this.mapBtn.textContent = on ? 'Done' : 'Map';
    this.resetBtn.hidden = !on;
    this.learnEl?.classList.remove('learn-target');
    this.learnTarget = null;
    this.learnEl = null;
    this.status.textContent = on
      ? 'Click a slider, option or button, then move a knob or hit a pad.'
      : this.connectedText;
  }

  private pickTarget(e: PointerEvent): void {
    if (!this.learning || !(e.target instanceof Element)) return;
    let el = e.target.closest<HTMLElement>('input[type=range], .hit, .modes label');
    if (!el || el === this.mapBtn) return;
    if (el.matches('.modes label')) {
      const input = el.querySelector('input');
      const face = el.querySelector<HTMLElement>('span');
      if (!input || !face) return;
      this.learnTarget = input.id;
      el = face;
    } else {
      this.learnTarget = el.id;
    }
    this.learnEl?.classList.remove('learn-target');
    this.learnEl = el;
    el.classList.add('learn-target');
    this.status.textContent = 'Now move a knob or hit a pad for this control.';
  }

  private learn(key: SourceKey, value: number): void {
    if (!this.learnTarget) {
      this.status.textContent = `${describeSource(key)} ${value} · pick a control first`;
      return;
    }
    // A source drives one control; a control may have several sources.
    this.map[key] = this.learnTarget;
    this.saveMap();
    this.renderBadges();
    this.status.textContent = `${describeSource(key)} → mapped. Pick another control or press Done.`;
    this.learnEl?.classList.remove('learn-target');
    this.learnTarget = null;
    this.learnEl = null;
  }

  // ---------------------------------------------------------------- badges and storage

  /** Shows each control's assigned sources next to it (e.g. "CC70", "N41⇄"). */
  private renderBadges(): void {
    document.querySelectorAll('[data-map]').forEach((el) => {
      el.removeAttribute('data-map');
    });
    const byTarget = new Map<string, string[]>();
    for (const [key, target] of Object.entries(this.map)) {
      if (!target) continue;
      const label = describeSource(key) + (target in TOGGLES ? '⇄' : '');
      byTarget.set(target, [...(byTarget.get(target) ?? []), label]);
    }
    for (const [target, labels] of byTarget) {
      const badge = this.badgeFor(target);
      if (!badge) continue;
      const prev = badge.getAttribute('data-map');
      badge.setAttribute('data-map', (prev ? `${prev} ` : '') + labels.join(' '));
    }
  }

  private badgeFor(target: string): Element | null {
    const toggle = TOGGLES[target] as (typeof TOGGLES)[string] | undefined;
    const el = document.getElementById(toggle ? toggle[0] : target);
    if (!el) return null;
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const labelId = el.getAttribute('aria-labelledby');
      return labelId ? document.getElementById(labelId) : null;
    }
    if (el instanceof HTMLInputElement && el.type === 'radio') return el.nextElementSibling;
    return el;
  }

  private loadMap(): MidiMap {
    const raw = load(StorageKey.MidiMap);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // Stored data is untrusted: keep only well-formed source → control entries.
          const map: MidiMap = {};
          for (const [key, target] of Object.entries(parsed)) {
            if (/^(cc|note):\d{1,3}$/.test(key) && typeof target === 'string') map[key as SourceKey] = target;
          }
          return map;
        }
      } catch {
        // Corrupt entry: fall back to the defaults.
      }
    }
    return { ...this.defaults };
  }

  private saveMap(): void {
    save(StorageKey.MidiMap, JSON.stringify(this.map));
  }
}
