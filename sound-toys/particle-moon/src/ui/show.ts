// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { byId, isShortcut } from '../lib/dom';

/** How long the cursor stays visible after the pointer last moved. */
const REVEAL_MS = 2500;
/**
 * The buttons (the Show keys bottom left, Controls bottom right) stay up longer, together: after the
 * pointer last moved, or a Show shortcut was pressed.
 */
const BUTTONS_MS = 4500;
/** How long a key lights up when its shortcut is pressed. */
const KEY_FLASH_MS = 350;
/** Each Show key's shortcut. */
const KEY_BUTTONS: Record<string, string> = { f: 'fullscreen', b: 'blackout', a: 'auto', r: 'view-reset' };

/**
 * Projection support. Fullscreen (F), blackout (B), a screen wake lock while performing, and
 * "bare" mode: with the controls hidden, the cursor and Controls button disappear too, and come back
 * for a moment when the pointer moves (or a Show shortcut is pressed). The Show keys (bottom left)
 * come and go with the Controls button (with the controls open, they stay); the header stays.
 */
export class ShowMode {
  private readonly fullscreenBtn = byId('fullscreen', HTMLButtonElement);
  private readonly blackoutBtn = byId('blackout', HTMLButtonElement);
  private readonly body = document.body;
  private bare = false;
  private revealTimer = 0;
  private buttonsTimer = 0;
  private readonly flashTimers = new Map<string, number>();
  private wakeLock: WakeLockSentinel | null = null;
  private requestingLock = false;

  constructor() {
    this.fullscreenBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });
    this.blackoutBtn.addEventListener('click', () => {
      this.setBlackout(!this.body.classList.contains('blackout'));
    });
    document.addEventListener('fullscreenchange', () => {
      this.fullscreenBtn.setAttribute('aria-pressed', String(this.fullscreen));
      void this.updateWakeLock();
    });
    // The browser drops the wake lock whenever the page is hidden; take it back on return.
    document.addEventListener('visibilitychange', () => {
      void this.updateWakeLock();
    });
    // (A tap counts too: touch screens have no hover.)
    for (const type of ['pointermove', 'pointerdown'] as const)
      window.addEventListener(type, () => {
        this.reveal();
      });
    window.addEventListener('keydown', (e) => {
      if (isShortcut(e, 'f')) this.toggleFullscreen();
      else if (isShortcut(e, 'b')) this.blackoutBtn.click();
      // Any Show shortcut brings the buttons up, its own key lit for a moment, so the change can be seen.
      const key = Object.keys(KEY_BUTTONS).find((k) => isShortcut(e, k));
      if (key) this.flashKey(KEY_BUTTONS[key]);
    });
  }

  /** Called when the controls are hidden or shown. */
  setBare(on: boolean): void {
    this.bare = on;
    this.body.classList.toggle('bare', on);
    if (on) this.reveal();
    void this.updateWakeLock();
  }

  private get fullscreen(): boolean {
    return document.fullscreenElement !== null;
  }

  private toggleFullscreen(): void {
    if (this.fullscreen) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }

  private setBlackout(on: boolean): void {
    this.body.classList.toggle('blackout', on);
    this.blackoutBtn.setAttribute('aria-pressed', String(on));
  }

  private reveal(): void {
    this.body.classList.add('reveal');
    window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => {
      this.body.classList.remove('reveal');
    }, REVEAL_MS);
    this.revealButtons();
  }

  private revealButtons(): void {
    this.body.classList.add('buttons-up');
    window.clearTimeout(this.buttonsTimer);
    this.buttonsTimer = window.setTimeout(() => {
      this.body.classList.remove('buttons-up');
    }, BUTTONS_MS);
  }

  private flashKey(id: string): void {
    this.revealButtons();
    const btn = byId(id);
    btn.classList.add('flash');
    window.clearTimeout(this.flashTimers.get(id));
    this.flashTimers.set(
      id,
      window.setTimeout(() => {
        btn.classList.remove('flash');
      }, KEY_FLASH_MS),
    );
  }

  /** Holds the screen awake while performing (bare or fullscreen); lets it sleep otherwise. */
  private async updateWakeLock(): Promise<void> {
    const want = (this.bare || this.fullscreen) && document.visibilityState === 'visible';
    if (!want) {
      const lock = this.wakeLock;
      this.wakeLock = null;
      await lock?.release();
      return;
    }
    if (this.wakeLock || this.requestingLock || !('wakeLock' in navigator)) return;
    this.requestingLock = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!(this.bare || this.fullscreen)) {
        await lock.release(); // the show ended while the request was pending
        return;
      }
      lock.addEventListener('release', () => {
        if (this.wakeLock === lock) this.wakeLock = null;
      });
      this.wakeLock = lock;
    } catch {
      // Refused (battery saver, unsupported context): the show still runs, the screen may dim.
    } finally {
      this.requestingLock = false;
    }
  }
}
