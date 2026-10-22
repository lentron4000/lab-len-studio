// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { loadManifest, locate, renderLevel, type Level, type Manifest } from '../../../../shared/lab-nav';
import { byId } from '../lib/dom';

/** This experiment's place in the lab (its folder). */
const HERE = 'sound-toys/particle-moon';

/** The variation this page is (as the lab lists them): its mode, by `?m=` (Party is `night` too). */
function currentVariation(search: string): string | undefined {
  const m = new URLSearchParams(search).get('m')?.toLowerCase() ?? '';
  if (m === '' || m === 'day') return '';
  if (m === 'night' || m === 'party') return '?m=party';
  if (m === 'len') return undefined; // (the master mode isn't listed)
  return `?m=${m}`;
}

/**
 * The lab's drawer: the burger beside the name opens it on this experiment's own ways in (its looks,
 * the one you're in marked), with "Return to Lab" leading up to the lab's other experiments. Hidden
 * where there's no lab (the single file, opened from disk).
 */
export function attachLabDrawer(canvas: HTMLElement): void {
  const menu = byId('menu', HTMLButtonElement);
  const drawer = byId('drawer');
  const view = byId('nav-view');
  let manifest: Manifest | null = null;
  let home: Level | null = null;

  const show = (level: Level): void => {
    if (!manifest) return;
    renderLevel(view, manifest, level, {
      here: HERE,
      current: currentVariation(location.search),
      home: () => {
        if (home) show(home);
      },
      go: show,
    });
  };
  const setOpen = (open: boolean): void => {
    document.body.classList.toggle('drawer-open', open);
    menu.setAttribute('aria-expanded', String(open));
    drawer.inert = !open;
    if (open && home) show(home);
  };

  void loadManifest().then((m) => {
    const at = m && locate(m, HERE);
    if (!m || !at) return;
    manifest = m;
    home = { at: 'project', ...at, top: true };
    menu.hidden = false;
  });
  menu.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('drawer-open'));
  });
  canvas.addEventListener('pointerdown', () => {
    setOpen(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}
