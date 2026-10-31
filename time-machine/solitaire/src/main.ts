// Time Machine — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import '../../../shared/lab-nav.css';
import { loadManifest, locate, renderLevel, type Level } from '../../../shared/lab-nav';
import { ovalOf, toScreen, toVideo, fits, type Box, type Shown } from './booth';
import { createFaceFinder, type FaceFinder } from './face';
import { cover } from './fit';
import { createTable } from './table';

/**
 * Solitaire, won, with your photo. First a photo booth: your face in the oval, held for a count of three,
 * and it's taken. The photo shrinks to a card on the first pile, and the cards bounce down off the piles,
 * every one the photo, each leaving a trail of itself (see table). Space (or a tap) is a new photo.
 * Nothing leaves the page: the video and the photo are only drawn, never kept, recorded or sent.
 */
const HERE = 'time-machine/solitaire';

const display = byId<HTMLCanvasElement>('view');
const video = byId<HTMLVideoElement>('video');
const menu = byId<HTMLButtonElement>('menu');
const drawer = byId<HTMLElement>('drawer');
const camerasList = byId<HTMLUListElement>('cameras');
const camerasView = byId<HTMLElement>('cameras-view');
const navView = byId<HTMLElement>('nav-view');
const startButton = byId<HTMLButtonElement>('start-camera');
const startNote = byId<HTMLParagraphElement>('start-note');
const notice = byId<HTMLParagraphElement>('notice');
const oval = byId<HTMLElement>('oval');
const count = byId<HTMLElement>('count');

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Time Machine: #${id} is missing`);
  return el;
}

const table = createTable(display);
/** Mirrored, as a camera facing you should be (M flips it: a hidden key). */
let mirror = true;

// ---- The booth, then the table.

/** Seconds held still in the oval for the photo; seconds the photo takes to shrink to its card. */
const COUNT = 3;
const FLY = 0.8;
/** Looking for a face this often (ms); a face gone for longer than this (ms) stops the count. */
const LOOK_EVERY = 100;
const GRACE = 400;
/** The photo's height (px): enough for a card. */
const PHOTO_HEIGHT = 900;

type Stage =
  | { at: 'booth'; counting: number | null }
  | { at: 'flying'; since: number; from: Box; to: Box }
  | { at: 'playing' };
let stage: Stage = { at: 'booth', counting: null };
let finder: FaceFinder | null = null;
let finderTried = false;
let lastLook = 0;
let lastFit = 0;

const seconds = (): number => performance.now() / 1000;
const dpr = (): number => window.devicePixelRatio || 1;

/** How the video's shown now (CSS px). */
function shown(): Shown {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return {
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    crop: cover(video.videoWidth, video.videoHeight, width, height),
    width,
    height,
    mirror,
  };
}

/** Back to the booth: the oval, waiting for a face. */
function toBooth(): void {
  stage = { at: 'booth', counting: null };
  document.body.classList.add('booth');
  document.body.classList.remove('fits', 'counting');
  count.textContent = '';
  placeOval();
}

function placeOval(): void {
  const o = ovalOf(window.innerWidth, window.innerHeight);
  Object.assign(oval.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` });
}

/** The count to the photo: from now. */
function startCount(): void {
  if (stage.at !== 'booth' || stage.counting !== null) return;
  stage.counting = seconds();
  document.body.classList.add('counting');
}

/** The photo: what's in the oval's box, as it's shown (mirrored or not); then off to the first card. */
function takePhoto(): void {
  if (!table) return;
  const s = shown();
  const box = ovalOf(s.width, s.height);
  const src = toVideo(box, s);
  const photo = document.createElement('canvas');
  photo.height = Math.min(PHOTO_HEIGHT, Math.round(src.h));
  photo.width = Math.round((photo.height * box.w) / box.h);
  const c = photo.getContext('2d')!;
  if (mirror) {
    c.translate(photo.width, 0);
    c.scale(-1, 1);
  }
  c.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, photo.width, photo.height);
  table.setPhoto(photo);
  // A flash, and the booth's gone; the photo flies from the oval to the first pile.
  document.body.classList.remove('booth', 'fits', 'counting');
  document.body.classList.add('flash');
  window.setTimeout(() => document.body.classList.remove('flash'), 60);
  const first = table.clear(seconds());
  const k = dpr();
  stage = {
    at: 'flying',
    since: seconds(),
    from: { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k },
    to: first,
  };
}

/** In the booth: is there a face in the oval? (Looked for every LOOK_EVERY ms.) */
function lookForFace(now: number): void {
  if (!finder || now - lastLook < LOOK_EVERY || video.readyState < video.HAVE_CURRENT_DATA) return;
  lastLook = now;
  const face = finder.find(video, now);
  const s = shown();
  const fit = face !== null && fits(toScreen(face, s), ovalOf(s.width, s.height));
  if (fit) lastFit = now;
  document.body.classList.toggle('fits', fit);
  if (stage.at !== 'booth') return;
  if (fit) startCount();
  else if (stage.counting !== null && now - lastFit > GRACE) {
    // Gone from the oval: the count starts over.
    stage.counting = null;
    document.body.classList.remove('counting');
    count.textContent = '';
  }
}

let newFrame = false;
const knowsFrames = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
function onVideoFrame(): void {
  newFrame = true;
  video.requestVideoFrameCallback(onVideoFrame);
}
if (knowsFrames) video.requestVideoFrameCallback(onVideoFrame);

function frame(): void {
  requestAnimationFrame(frame);
  if (!stream || !table) return;
  const now = performance.now();
  const fresh = knowsFrames ? newFrame : true;
  newFrame = false;
  if (stage.at === 'booth') {
    table.live(video, mirror, fresh);
    lookForFace(now);
    if (stage.counting !== null) {
      const held = now / 1000 - stage.counting;
      if (held >= COUNT) takePhoto();
      else count.textContent = String(COUNT - Math.floor(held));
    }
  } else if (stage.at === 'flying') {
    const t = Math.min(1, (now / 1000 - stage.since) / FLY);
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const { from, to } = stage;
    const lerp = (a: number, b: number): number => a + (b - a) * e;
    table.fly(
      { x: lerp(from.x, to.x), y: lerp(from.y, to.y), w: lerp(from.w, to.w), h: lerp(from.h, to.h) },
      0,
    );
    if (t >= 1) stage = { at: 'playing' };
  } else {
    table.play(now / 1000);
  }
}
requestAnimationFrame(frame);

function resize(): void {
  table?.resize(window.innerWidth * dpr(), window.innerHeight * dpr());
  placeOval();
  // (A new screen: a new table, so a new photo.)
  if (stage.at !== 'booth') toBooth();
}
window.addEventListener('resize', resize);
resize();

// ---- The camera.

let stream: MediaStream | null = null;
/** The camera in use (its device id), to mark it in the drawer. */
let cameraId: string | null = null;

/** The camera last chosen, remembered for next time (in this browser only). */
const CHOSEN = 'time-machine-solitaire:camera';
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
  document.body.classList.remove('live');
  startNote.textContent = why;
  startButton.textContent = 'Try again';
}

/** Starts the camera (that one, or the one facing you), in place of any running. */
async function startCamera(id: string | null = chosen()): Promise<void> {
  if (!table) return;
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
    // From the start screen (not a switch of camera): the booth.
    if (!document.body.classList.contains('live')) toBooth();
    document.body.classList.add('live');
    // The face finder, the first time (till it's ready, or if it can't be had, a tap or Space takes the photo).
    if (!finderTried) {
      finderTried = true;
      void createFaceFinder().then((f) => {
        finder = f;
        document.body.classList.toggle('no-finder', !f);
      });
    }
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

// A tap (or Space): the drawer closed if it's open; otherwise, in the booth, the count started (whether
// there's a face or not); on the table, back to the booth for a new photo.
function act(): void {
  if (document.body.classList.contains('drawer-open')) return setDrawer(false);
  if (!stream) return;
  if (stage.at === 'booth') startCount();
  else if (stage.at === 'playing') toBooth();
}
display.addEventListener('pointerdown', act);
byId('booth').addEventListener('pointerdown', act);

let noticeTimer = 0;
function say(text: string): void {
  notice.textContent = text;
  notice.classList.add('shown');
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => notice.classList.remove('shown'), 4000);
}

// ---- The cursor fades after IDLE_MS without the pointer moving.
const IDLE_MS = 3000;
let idleTimer = 0;
function wake(): void {
  document.body.classList.remove('idle');
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), IDLE_MS);
}
for (const type of ['pointermove', 'pointerdown', 'keydown'] as const) window.addEventListener(type, wake);
wake();

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Escape') return setDrawer(false);
  if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    act();
  } else if (e.code === 'KeyF') {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  } else if (e.code === 'KeyM') {
    mirror = !mirror;
    say(mirror ? 'Mirrored' : 'Not mirrored');
  }
});

if (!table) {
  showStart('This browser can’t draw the table (it needs WebGL2).');
  startButton.hidden = true;
}
