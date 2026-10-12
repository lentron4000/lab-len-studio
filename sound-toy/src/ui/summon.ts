// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { byId } from '../lib/dom';
import { touch } from '../midi/velocity';
import type { FormationId } from '../sim/formations';
import type { Simulation } from '../sim/simulation';

/**
 * Formation per note name, C to B. The core shapes sit on the white keys so they can be found by
 * feel; the sigils fill the black keys (and B).
 */
const BY_PITCH: readonly FormationId[] = [
  'circle', // C
  'sigil2', // C#
  'pentagram', // D
  'sigil3', // D#
  'inverted', // E
  'hexagram', // F
  'sigil4', // F#
  'ouroboros', // G
  'sigil5', // G#
  'eye', // A
  'sigil6', // A#
  'sigil1', // B
];
/** Middle C and up summons the great version: the shape inside a double ring. */
const GREAT_FROM = 60;

/** Computer keyboard: 1–0, − and = in the order of the shapes; Shift for the great version. */
const BY_CODE: Record<string, FormationId> = {
  Digit1: 'circle',
  Digit2: 'pentagram',
  Digit3: 'inverted',
  Digit4: 'hexagram',
  Digit5: 'ouroboros',
  Digit6: 'eye',
  Digit7: 'sigil1',
  Digit8: 'sigil2',
  Digit9: 'sigil3',
  Digit0: 'sigil4',
  Minus: 'sigil5',
  Equal: 'sigil6',
};
const KEYBOARD_VELOCITY = 0.7;
const IDLE_TEXT =
  'Hold a key: C to B on the MIDI keys, or 1–0, − and = here. Upper octave or Shift: in the circle.';

/** Formation for a MIDI note: the shape by note name, the great version from middle C up. */
export function formationForNote(note: number): { id: FormationId; great: boolean } {
  return { id: BY_PITCH[note % 12], great: note >= GREAT_FROM };
}

/**
 * Connects keys to formations: MIDI notes not mapped to a pad, and the number row. Holding a key
 * holds the shape; several keys layer shapes. Returns the MIDI note handler (velocity 0 = release)
 * and the aftertouch handler.
 */
export function bindSummoning(sim: Simulation): {
  onNote: (note: number, velocity: number) => void;
  onPressure: (value: number) => void;
} {
  const status = byId('summon-status');
  const refresh = (): void => {
    status.textContent = sim.summoning.active ? sim.summoning.names.join(' + ') : IDLE_TEXT;
  };

  const onNote = (note: number, velocity: number): void => {
    const source = `note:${note}`;
    if (velocity > 0) {
      const { id, great } = formationForNote(note);
      sim.summon(source, id, great, touch(velocity));
    } else {
      sim.dismiss(source);
    }
    refresh();
  };

  window.addEventListener('keydown', (e) => {
    const id = BY_CODE[e.code] as FormationId | undefined;
    if (!id || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    e.preventDefault();
    sim.summon(e.code, id, e.shiftKey, KEYBOARD_VELOCITY);
    refresh();
  });
  window.addEventListener('keyup', (e) => {
    if (!(e.code in BY_CODE)) return;
    sim.dismiss(e.code);
    refresh();
  });
  // Keys released while the window was in the background never send keyup: let go of everything.
  window.addEventListener('blur', () => {
    sim.summoning.releaseAll();
    refresh();
  });
  refresh();
  return {
    onNote,
    // Pressure on a held key (or a pad, on controllers that send it for the whole channel) burns the seal.
    onPressure: (value) => {
      sim.summoning.pressure = value / 127;
    },
  };
}

function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return target.type !== 'range' && target.type !== 'radio';
  return target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
