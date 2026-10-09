// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Viewport } from '../sim/simulation';

const MIN_HEADER = 48;
const HIDDEN_PANEL_RESERVE = 56;
const PANEL_MARGIN = 32 + 28; // panel offset plus its tab

/**
 * Fits the shape into the space between the header and the control panel.
 * Measures both, because the header stacks on phones and the panel changes height with its rows.
 */
export function computeViewport(
  width: number,
  height: number,
  header: HTMLElement,
  panel: HTMLElement,
): Viewport {
  const reserved = panel.hidden ? HIDDEN_PANEL_RESERVE : panel.offsetHeight + PANEL_MARGIN;
  const top = Math.max(MIN_HEADER, header.getBoundingClientRect().bottom + 12);
  const available = Math.max(160, height - reserved - top);
  const radius = Math.max(50, Math.min(width * 0.34, available * 0.36));
  return { width, height, radius, cx: width / 2, cy: top + (height - reserved - top) / 2 };
}

/** Publishes the panel's size to CSS so the Hide tab can sit on its top edge. */
export function placePanelTab(panel: HTMLElement): void {
  const root = document.documentElement.style;
  root.setProperty('--panel-h', `${panel.offsetHeight}px`);
  root.setProperty('--panel-w', `${panel.offsetWidth}px`);
}
