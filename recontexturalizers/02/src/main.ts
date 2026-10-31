// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import '../../../shared/lab-nav.css';
import { loadManifest, locate, renderLevel, type Level } from '../../../shared/lab-nav';
import { createRenderer, type Look, type View } from './render';

/**
 * The camera, live, covering the screen: as it is, or in pixels down to 16 px (the Resolution slider),
 * or, the easter egg (E), in emoji. It's drawn on the GPU every frame the camera gives (see render).
 * Nothing leaves the page: the video is only drawn, never recorded or sent.
 */
const HERE = 'recontexturalizers/02';

const display = byId<HTMLCanvasElement>('view');
const video = byId<HTMLVideoElement>('video');
const slider = byId<HTMLInputElement>('resolution');
const readout = byId<HTMLOutputElement>('resolution-out');
const menu = byId<HTMLButtonElement>('menu');
const drawer = byId<HTMLElement>('drawer');
const camerasList = byId<HTMLUListElement>('cameras');
const camerasView = byId<HTMLElement>('cameras-view');
const navView = byId<HTMLElement>('nav-view');
const startButton = byId<HTMLButtonElement>('start-camera');
const startNote = byId<HTMLParagraphElement>('start-note');
const notice = byId<HTMLParagraphElement>('notice');

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Recontexturalizers: #${id} is missing`);
  return el;
}

const renderer = createRenderer(display);

// ---- How it's shown: the mode, the slider's size, mirrored or not.

/** The modes, one at a time, chosen in the row over the controls. (More to come.) */
type ModeId = Look;
/** Each mode's button: its name (for screen readers and its tooltip) and what's shown, an icon or an emoji. */
const MODES: readonly { id: ModeId; name: string; title: string; face: string }[] = [
  {
    id: 'pixel',
    name: 'Pixel',
    title: 'Pixel: down to 16 px',
    // A pixel: a square, two reds, divided corner to corner.
    face:
      '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">' +
      '<path d="M0 0H12L0 12Z" fill="#ff3b30"/>' +
      '<path d="M12 0V12H0Z" fill="#a3101c"/></svg>',
  },
  { id: 'emoji', name: 'Emoji', title: 'Emoji: each pixel the emoji nearest its colour (E)', face: '😊' },
  {
    id: 'matrix',
    name: 'Matrix',
    title: 'Matrix: you, in falling green code',
    face: '<span class="code" aria-hidden="true">ﾘ</span>',
  },
  {
    id: 'ghost',
    name: 'Ghost',
    title: 'Ghost: black, but where you move: there, you show through, in vapour',
    // A ghost.
    face:
      '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" fill="currentColor" fill-rule="evenodd">' +
      '<path d="M7 1C4.2 1 2.2 3.1 2.2 6v7l1.6-1.2L5.4 13 7 11.8 8.6 13l1.6-1.2 1.6 1.2V6C11.8 3.1 9.8 1 7 1Z' +
      'M5.3 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM8.7 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>',
  },
  // (Particles, a cloud of you over the vapour, is in the renderer too: list it here to bring it back.)
];
/** The smallest tiles each mode draws (CSS px): glyphs below this can't be read. At Original, they're this size. */
const MIN_TILE: Record<ModeId, number> = {
  pixel: 1,
  emoji: 10,
  matrix: 10,
  particles: 4,
  ghost: 4,
};
/** Modes whose tiles are always this size (CSS px): the slider's off in them. */
const FIXED_TILE: Partial<Record<ModeId, number>> = { ghost: 2 };
/** Modes that move by themselves, drawn every frame (not only when the camera has a new one). */
const ANIMATED: ReadonlySet<ModeId> = new Set(['matrix', 'particles', 'ghost']);
let mode: ModeId = 'pixel';
/** Mirrored, as a camera facing you should be (M flips it: a hidden key). */
let mirror = true;

/** The slider's size (CSS px; 1 is Original). Whole numbers, but in between while it slides itself. */
let size = Number(slider.value);
const pixelSize = (): number => size;
/** The size of the tiles (pixels, or emoji) at a slider size, in the mode it's in. */
const tileOf = (s: number): number => FIXED_TILE[mode] ?? Math.max(MIN_TILE[mode], s);

function setSize(s: number): void {
  size = s;
  slider.value = String(s);
  const px = Math.round(tileOf(s));
  // (The mode's in its row: here, just the size, which in some modes is never below MIN_TILE.)
  readout.textContent = px <= 1 ? 'Original' : `${px} px`;
}

function view(): View {
  const dpr = window.devicePixelRatio || 1;
  const s = tileOf(pixelSize());
  // (Tiles a whole number of device pixels, so the grid stays even.)
  return {
    tile: s <= 1 ? 1 : Math.max(2, Math.round(s * dpr)),
    look: mode,
    time: performance.now() / 1000,
    mirror,
  };
}

/**
 * On starting: the camera as it is, then the slider slides itself all the way over to SLIDE_TO, the
 * pixels growing as it goes, so you see yourself go. (Touching the slider stops it there.)
 */
const SLIDE_TO = 16;
const SLIDE_HOLD = 1000;
const SLIDE_MS = 2400;
let sliding = 0;
let slideHold = 0;
function stopSliding(): void {
  window.clearTimeout(slideHold);
  cancelAnimationFrame(sliding);
  slideHold = sliding = 0;
  // (Back to whole sizes: the slider's steps.)
  slider.step = '1';
}
function slideToPixels(): void {
  stopSliding();
  setSize(1);
  dirty = true;
  slideHold = window.setTimeout(() => {
    // (Free of its steps meanwhile, so the handle glides.)
    slider.step = 'any';
    const start = performance.now();
    const glide = (now: number): void => {
      const t = Math.min(1, (now - start) / SLIDE_MS);
      const eased = (1 - Math.cos(Math.PI * t)) / 2;
      setSize(t < 1 ? 1 + (SLIDE_TO - 1) * eased : SLIDE_TO);
      dirty = true;
      if (t < 1) sliding = requestAnimationFrame(glide);
      else stopSliding();
    };
    sliding = requestAnimationFrame(glide);
  }, SLIDE_HOLD);
}

/** The slider's size before a mode's smallest size raised it (see setMode); forgotten once it's moved. */
let sizeBeforeMin: number | null = null;

slider.addEventListener('input', () => {
  stopSliding();
  sizeBeforeMin = null;
  setSize(Math.round(Number(slider.value)));
  dirty = true;
});

const modesBar = byId<HTMLElement>('modes');
function setMode(id: ModeId): void {
  mode = id;
  modesBar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === id));
  });
  // (In a mode of a fixed size, the slider's off.)
  slider.disabled = FIXED_TILE[id] !== undefined;
  // The slider starts at the mode's smallest size (below it, tiles are no smaller): all of it does
  // something. The size it had, if that raised it, comes back in a mode that goes that small.
  const min = MIN_TILE[id];
  slider.min = String(min);
  if (size < min) {
    sizeBeforeMin ??= size;
    size = min;
  } else if (sizeBeforeMin !== null && sizeBeforeMin >= min) {
    size = sizeBeforeMin;
    sizeBeforeMin = null;
  }
  setSize(pixelSize());
  dirty = true;
}
for (const m of MODES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = m.face;
  b.title = m.title;
  b.setAttribute('aria-label', m.name);
  b.dataset.mode = m.id;
  b.addEventListener('click', () => {
    setMode(m.id);
    b.blur();
  });
  modesBar.append(b);
}

// ---- Drawing: every frame the camera gives (or, where the browser can't say when that is, every frame).

/** Something besides the video changed (the slider, the screen): draw again. */
let dirty = true;
let newFrame = false;
const knowsFrames = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
function onVideoFrame(): void {
  newFrame = true;
  video.requestVideoFrameCallback(onVideoFrame);
}
if (knowsFrames) video.requestVideoFrameCallback(onVideoFrame);

function frame(): void {
  requestAnimationFrame(frame);
  if (!stream || !renderer) return;
  const fresh = knowsFrames ? newFrame : true;
  if (!fresh && !dirty && !ANIMATED.has(mode)) return;
  renderer.draw(video, view(), fresh);
  newFrame = false;
  dirty = false;
}
requestAnimationFrame(frame);

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  renderer?.resize(window.innerWidth * dpr, window.innerHeight * dpr);
  dirty = true;
}
window.addEventListener('resize', resize);
resize();

// ---- The camera.

let stream: MediaStream | null = null;
/** The camera in use (its device id), to mark it in the drawer. */
let cameraId: string | null = null;

/** The camera last chosen, remembered for next time (in this browser only). */
const CHOSEN = 'recontexturalizer-02:camera';
function chosen(): string | null {
  try {
    return localStorage.getItem(CHOSEN);
  } catch {
    return null;
  }
}
function choose(id: string): void {
  try {
    localStorage.setItem(CHOSEN, id);
  } catch {
    // (Not remembered, then.)
  }
}

function stopCamera(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

/** Why the camera couldn't be had, in words. */
function reason(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access was turned down. Allow it for this page in your browser’s settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found.';
  if (name === 'NotReadableError') return 'The camera couldn’t be started: another app may be using it.';
  return 'The camera couldn’t be started.';
}

/** Back to the start, saying why. */
function showStart(why: string): void {
  stopCamera();
  stopSliding();
  document.body.classList.remove('live');
  startNote.textContent = why;
  startButton.textContent = 'Try again';
}

/** Starts the camera (that one, or the one facing you), in place of any running. */
async function startCamera(id: string | null = chosen()): Promise<void> {
  if (!renderer) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showStart('The camera needs a secure (https) page, in a browser that allows it.');
    return;
  }
  startButton.disabled = true;
  // (Some devices can't open a second camera while one's on: the old one stops first.)
  stopCamera();
  try {
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(id ? { deviceId: { exact: id } } : { facingMode: 'user' }),
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    stream = next;
    video.srcObject = next;
    await video.play();
    const track = next.getVideoTracks()[0];
    const settings = track.getSettings();
    cameraId = settings.deviceId ?? null;
    // A camera facing away isn't a mirror.
    mirror = settings.facingMode !== 'environment';
    track.addEventListener('ended', () => {
      if (stream === next) showStart('The camera stopped.');
    });
    // From the start screen (not a switch of camera): as it is, then over to pixels.
    if (!document.body.classList.contains('live')) slideToPixels();
    document.body.classList.add('live');
    dirty = true;
    void listCameras();
    if (cameraId) choose(cameraId);
  } catch (e) {
    // The camera remembered from last time, gone: the one facing you, instead.
    const name = e instanceof DOMException ? e.name : '';
    if (id && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
      startButton.disabled = false;
      return startCamera(null);
    }
    showStart(reason(e));
  } finally {
    startButton.disabled = false;
  }
}
startButton.addEventListener('click', () => void startCamera());

/** The cameras there are (named, once the camera's been allowed; before, often not even listed). */
async function cameras(): Promise<MediaDeviceInfo[]> {
  const devices = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
  return devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
}

/**
 * The cameras, in the drawer: the one on marked; choosing another switches to it. (Before starting, where
 * the browser already names them, choosing one starts it.)
 */
async function listCameras(): Promise<void> {
  const list = stream ? await cameras() : (await cameras()).filter((d) => d.label);
  camerasList.replaceChildren(
    ...list.map((d, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      // (Its name and, if it's the one on, the dot, on one line.)
      const name = document.createElement('span');
      name.textContent = d.label || `Camera ${i + 1}`;
      b.append(name);
      const here = d.deviceId === cameraId;
      if (here) {
        li.className = 'active';
        b.setAttribute('aria-current', 'true');
        const dot = document.createElement('span');
        dot.className = 'here';
        dot.setAttribute('aria-hidden', 'true');
        name.append(dot);
      }
      b.addEventListener('click', () => {
        setDrawer(false);
        if (!here || !stream) void startCamera(d.deviceId);
      });
      li.append(b);
      return li;
    }),
  );
}
navigator.mediaDevices?.addEventListener('devicechange', () => void listCameras());
void listCameras();

// (Never started on its own, even where it's been allowed before: every visit asks, with the button.)

// Off when the page is left, so the camera's light goes out.
window.addEventListener('pagehide', stopCamera);

// ---- The drawer: the cameras, and a level up, the lab.

function setDrawer(open: boolean): void {
  document.body.classList.toggle('drawer-open', open);
  menu.setAttribute('aria-expanded', String(open));
  drawer.inert = !open;
}
menu.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));

function showCameras(): void {
  navView.hidden = true;
  camerasView.hidden = false;
}
async function showLevel(level: Level): Promise<void> {
  const m = await loadManifest();
  camerasView.hidden = true;
  navView.hidden = false;
  if (!m) {
    navView.replaceChildren();
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back';
    back.textContent = '‹ Camera';
    back.addEventListener('click', showCameras);
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'The lab’s list couldn’t be loaded.';
    navView.append(back, p);
    return;
  }
  renderLevel(navView, m, level, { here: HERE, home: showCameras, go: (l) => void showLevel(l) });
  navView.querySelector<HTMLElement>('.back, .nav a, .nav button')?.focus({ preventScroll: true });
}
// Back one level: to this experiment's group (named once the lab's list is in; the lab, if it isn't).
const up = byId<HTMLButtonElement>('up');
const groupHere = async (): Promise<{ name: string; group: number } | null> => {
  const m = await loadManifest();
  const at = m && locate(m, HERE);
  return m && at ? { name: m.groups[at.group].name, group: at.group } : null;
};
void groupHere().then((g) => {
  if (g) up.textContent = `‹ Back to ${g.name}`;
});
up.addEventListener('click', () => {
  void groupHere().then((g) => showLevel(g ? { at: 'group', group: g.group } : { at: 'lab' }));
});
display.addEventListener('pointerdown', () => setDrawer(false));

let noticeTimer = 0;
function say(text: string): void {
  notice.textContent = text;
  notice.classList.add('shown');
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => notice.classList.remove('shown'), 4000);
}

// ---- The controls (and cursor) fade after IDLE_MS without the pointer moving; a key brings them back too.
const IDLE_MS = 3000;
let idleTimer = 0;
function wake(): void {
  document.body.classList.remove('idle');
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    // (Not while the slider's being dragged.)
    if (slider.matches(':active')) return wake();
    document.body.classList.add('idle');
  }, IDLE_MS);
}
for (const type of ['pointermove', 'pointerdown', 'keydown'] as const) window.addEventListener(type, wake);
wake();

/**
 * ↑ and ↓: the slider up (bigger pixels, to 16 px) and down (smaller ones, to Original), a step at a
 * time, held to keep going. (From the size shown: in a mode with a smallest size, from that.)
 */
function stepResolution(finer: boolean): void {
  if (slider.disabled) return;
  stopSliding();
  sizeBeforeMin = null;
  const from = Math.round(tileOf(pixelSize()));
  const next = Math.min(Number(slider.max), Math.max(Number(slider.min), from + (finer ? -1 : 1)));
  setSize(next);
  dirty = true;
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // (In place of the slider's own arrow keys, and held down, repeating.)
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    e.preventDefault();
    if (document.body.classList.contains('live')) stepResolution(e.code === 'ArrowDown');
    return;
  }
  if (e.repeat) return;
  if (e.code === 'Escape') return setDrawer(false);
  if (e.code === 'KeyF') {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  } else if (e.code === 'KeyE') setMode(mode === 'emoji' ? 'pixel' : 'emoji');
  else if (e.code === 'KeyM') {
    mirror = !mirror;
    dirty = true;
    say(mirror ? 'Mirrored' : 'Not mirrored');
  }
});

setMode(mode);
if (!renderer) {
  showStart('This browser can’t draw the picture (it needs WebGL2).');
  startButton.hidden = true;
}
