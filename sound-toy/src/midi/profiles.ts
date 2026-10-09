// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/** A MIDI source key: `cc:<number>` for knobs and faders, `note:<number>` for pads and keys. */
export type SourceKey = `cc:${number}` | `note:${number}`;

/**
 * Source → control. A control is the id of a slider, radio or button in the panel, or a toggle
 * id from TOGGLES. MIDI moves the same controls the mouse does, so every input path is identical.
 */
export type MidiMap = Partial<Record<SourceKey, string>>;

export interface ControllerProfile {
  name: string;
  /** Matched against the MIDI input port name. */
  match: RegExp;
  map: MidiMap;
}

/** Pads that flip between two radio options. `home` is where the mapping badge is shown. */
export const TOGGLES: Record<string, readonly [home: string, other: string]> = {
  'toggle-shape': ['shape-globe', 'shape-disc'],
  'toggle-moon': ['moon-on', 'moon-off'],
  'toggle-pulse': ['pulse-demo', 'pulse-off'],
  'toggle-night': ['night-on', 'night-off'],
};

/** Akai MPK mini: assumes knobs 1–5 on CC 70–74 and pads bank A on notes 36–43. Use Map if a unit differs. */
export const MPK_MINI: ControllerProfile = {
  name: 'Akai MPK mini',
  match: /mpk\s*mini/i,
  map: {
    'cc:70': 'state',
    'cc:71': 'spin',
    'cc:72': 'orbit',
    'cc:73': 'mforce',
    'cc:74': 'depth',
    'note:36': 'mode-gas',
    'note:37': 'mode-water',
    'note:38': 'mode-attract',
    'note:39': 'mode-repel',
    'note:40': 'kick',
    'note:41': 'toggle-shape',
    'note:42': 'toggle-moon',
    'note:43': 'toggle-pulse',
  },
};

/** Known controllers. Add one by matching its port name and listing its factory CC and note numbers. */
export const PROFILES: readonly ControllerProfile[] = [MPK_MINI];

/** Profile for a connected port, falling back to the MPK mini layout (a common default for small controllers). */
export function profileFor(portName: string): ControllerProfile {
  return PROFILES.find((p) => p.match.test(portName)) ?? MPK_MINI;
}

export function describeSource(key: string): string {
  return key.startsWith('cc:') ? `CC${key.slice(3)}` : `N${key.slice(5)}`;
}
