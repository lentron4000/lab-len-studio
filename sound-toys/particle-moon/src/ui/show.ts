// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { byId, isShortcut } from '../lib/dom';

/** How long the cursor and the Controls button stay visible after the pointer last moved. */
const REVEAL_MS = 2500;

/**
 * Projection support. Fullscreen (F), blackout (B), a screen wake lock while performing, and
 * "bare" mode: with the controls hidden, the header, cursor and Controls button disappear too,
 * and come back for a moment when the pointer moves.
 */
export class ShowMode {
  private readonly fullscreenBtn = byId('fullscreen', HTMLButtonElement);
  private readonly blackoutBtn = byId('blackout', HTMLButtonElement);
  private readonly body = document.body;
  private bare = false;
  private revealTimer = 0;
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
    window.addEventListener('pointermove', () => {
      this.reveal();
    });
    window.addEventListener('keydown', (e) => {
      if (isShortcut(e, 'f')) this.toggleFullscreen();
      else if (isShortcut(e, 'b')) this.blackoutBtn.click();
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
