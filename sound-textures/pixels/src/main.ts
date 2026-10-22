// Sound Textures — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import '../../../shared/lab-nav.css';
import { loadManifest, renderLevel, type Level } from '../../../shared/lab-nav';
import textileUrl from './assets/textile.webp';
import { BeatClock, TapTempo } from './beat';
import { createEffects, EFFECTS, type Moment } from './effects';
import { PHOTO_CELL, refusal, workingSize } from './photo';
import type { Grid } from './quilt';
import { ease, TRANSITIONS, turned } from './transitions';
import type { FromWeaver, ToWeaver } from './weaver.worker';

/**
 * A photo (the textile, or one dropped in) is quilted on a grid of CELL-sized squares (CSS px): which
 * patches go where is worked out on its colours averaged into cells, then it's drawn from the photo
 * itself, the patches' joins cut through its pixels (see compose). That heavy part runs in a worker
 * (weaver.worker), so nothing stutters while it's made. The Resolution slider averages the picture into
 * bigger and bigger pixels, up to one per square.
 *
 * A new quilt of the same photo comes in through a transition: on Space, or, with the beat playing, on
 * every 1 (the first bar counts in: 1 2 3 4, new 2 3 4, new 2 3 4 …). The next one is always made
 * ahead. A new photo comes in at 16 px and sharpens, step by step, down to the photo itself.
 */
const CELL = 16;
/** After a change, how long to wait before making the next quilt ahead of time (ms). */
const PREPARE_AFTER = 120;
/** A new photo: the pixel sizes it steps down through once its pattern is in, and how long each holds (ms). */
const SHARPEN = [12, 8, 6, 4, 3, 2, 1];
const SHARPEN_STEP = 140;
/** A new photo's first, quick drawing: device pixels per cell (the full one is 16 × the pixel ratio). */
const QUICK_UNIT = 8;
/** On the beat, a transition takes this many beats: the whole bar, ending as the next begins. */
const TRANSITION_BEATS = 4;
/** Thumbnails: square, this many pixels a side. */
const THUMB = 160;
/** This experiment's place in the lab (its folder), so the lab's navigation can mark it. */
const HERE = 'sound-textures/pixels';

/** The screen. What's painted (the pattern and its transitions) goes on `canvas`, off screen, and is
 * shown here through the effects (see effects.ts). */
const display = byId<HTMLCanvasElement>('weave');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
const slider = byId<HTMLInputElement>('resolution');
const readout = byId<HTMLOutputElement>('resolution-out');
const playButton = byId<HTMLButtonElement>('play');
const bpmInput = byId<HTMLInputElement>('bpm');
const countOut = byId<HTMLElement>('count');
const menu = byId<HTMLButtonElement>('menu');
const drawer = byId<HTMLElement>('drawer');
const thumbs = byId<HTMLUListElement>('thumbs');
const fileInput = byId<HTMLInputElement>('file');
const notice = byId<HTMLParagraphElement>('notice');
const imagesView = byId<HTMLElement>('images-view');
const navView = byId<HTMLElement>('nav-view');
if (!ctx) throw new Error('Sound Textures: 2D canvas is not available');

/** A photo ready to quilt: its working copy (cols × rows cells of PHOTO_CELL), and its cell colours. */
interface Source {
  /** Its name in the worker. */
  id: number;
  cols: number;
  rows: number;
  photo: HTMLCanvasElement;
  grid: Grid;
  /** The sizes (pixels per cell) of its pixels the worker has been given. */
  sent: Set<number>;
  /** The textile: the first time round, it's shown whole, grown out to fill the screen. */
  placeFirst: boolean;
}

/**
 * An image of this session: kept only in this tab's memory (the file itself and a thumbnail), never
 * uploaded or stored, so it's gone when the tab is. Only the one in use is decoded.
 */
interface Entry {
  id: number;
  name: string;
  file: Blob;
  thumb: string;
  textile: boolean;
}

/** The screen, and where the quilt's grid sits on it (CSS px; it's centred and overhangs evenly). */
interface Layout {
  width: number;
  height: number;
  dpr: number;
  cols: number;
  rows: number;
  left: number;
  top: number;
  gridWidth: number;
  gridHeight: number;
}

/** A quilt drawn from its photo, halved again and again (for averaging). */
interface Woven {
  source: Source;
  /** Its seed, or null for the textile grown out whole. */
  seed: number | null;
  layout: Layout;
  pyramid: HTMLCanvasElement[];
}

const entries: Entry[] = [];
let entryInUse: Entry | null = null;
let source: Source | null = null;
/** The quilt on screen. */
let current: Woven | null = null;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Sound Textures: #${id} is missing`);
  return el as T;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

/** Halves a canvas, averaging each 2 × 2 block of pixels. */
function half(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width / 2, src.height / 2);
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** A photo's colour per cell: halved down to one pixel per cell (32 → 1 is five halvings). */
function cellsOf(photo: HTMLCanvasElement, cols: number, rows: number): Grid {
  let c = photo;
  while (c.width > cols) c = half(c);
  const data = c.getContext('2d')!.getImageData(0, 0, cols, rows).data;
  const rgb = new Uint8Array(cols * rows * 3);
  for (let i = 0; i < cols * rows; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return { cols, rows, rgb };
}

let nextSourceId = 1;

/** Decodes an image (turned the right way up), as a source to quilt and a thumbnail. */
async function decode(file: Blob, placeFirst: boolean): Promise<{ source: Source; thumb: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = workingSize(bitmap.width, bitmap.height);
  const photo = makeCanvas(size.width, size.height);
  const p = photo.getContext('2d')!;
  p.imageSmoothingQuality = 'high';
  const { x, y, w, h } = size.crop;
  p.drawImage(bitmap, x, y, w, h, 0, 0, size.width, size.height);
  // A square thumbnail from the middle.
  const side = Math.min(bitmap.width, bitmap.height);
  const t = makeCanvas(THUMB, THUMB);
  const tc = t.getContext('2d')!;
  tc.imageSmoothingQuality = 'high';
  tc.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, THUMB, THUMB);
  bitmap.close();
  const thumbBlob = await new Promise<Blob | null>((resolve) => t.toBlob(resolve, 'image/jpeg', 0.8));
  return {
    source: {
      id: nextSourceId++,
      cols: size.cols,
      rows: size.rows,
      photo,
      grid: cellsOf(photo, size.cols, size.rows),
      sent: new Set(),
      placeFirst,
    },
    thumb: thumbBlob ? URL.createObjectURL(thumbBlob) : t.toDataURL(),
  };
}

/** The screen as it is now: enough CELL-sized squares to cover it, centred. */
function measure(): Layout {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const cols = Math.ceil(width / CELL) + 1;
  const rows = Math.ceil(height / CELL) + 1;
  const gridWidth = cols * CELL;
  const gridHeight = rows * CELL;
  return {
    width,
    height,
    dpr: window.devicePixelRatio || 1,
    cols,
    rows,
    left: (width - gridWidth) / 2,
    top: (height - gridHeight) / 2,
    gridWidth,
    gridHeight,
  };
}

const sameScreen = (a: Layout, b: Layout): boolean =>
  a.width === b.width && a.height === b.height && a.dpr === b.dpr;
const newSeed = (): number => Math.floor(Math.random() * 2 ** 31);

// ---- Weaving, in the worker.

const weaver = new Worker(new URL('./weaver.worker.ts', import.meta.url), { type: 'module' });
const jobs = new Map<number, (r: FromWeaver) => void>();
/** Sends the worker a job and waits for its answer. */
function job<R extends FromWeaver>(m: ToWeaver & { job: number }, transfer: Transferable[] = []): Promise<R> {
  return new Promise((resolve) => {
    jobs.set(m.job, resolve as (r: FromWeaver) => void);
    toWeaver(m, transfer);
  });
}
let nextJob = 1;
weaver.addEventListener('message', (e: MessageEvent<FromWeaver>) => {
  const done = jobs.get(e.data.job);
  jobs.delete(e.data.job);
  done?.(e.data);
});
const toWeaver = (m: ToWeaver, transfer: Transferable[] = []): void => weaver.postMessage(m, transfer);

/** Gives the worker a source's cell colours (once) and its pixels at `unit` pixels per cell (once each). */
function share(src: Source, unit: number): void {
  if (!src.sent.size) toWeaver({ type: 'source', id: src.id, grid: src.grid });
  if (src.sent.has(unit)) return;
  let c = src.photo;
  if (unit !== PHOTO_CELL) {
    c = makeCanvas(src.cols * unit, src.rows * unit);
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src.photo, 0, 0, c.width, c.height);
  }
  const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  toWeaver({ type: 'pixels', id: src.id, unit, width: px.width, height: px.height, data: px.data.buffer }, [
    px.data.buffer,
  ]);
  src.sent.add(unit);
}

/**
 * Quilts a photo for this screen (in the worker) and draws it from the photo, `unit` device pixels a
 * cell (by default the screen's own: 32 on a Retina screen).
 */
async function weave(src: Source, seed: number | null, layout: Layout, unit?: number): Promise<Woven> {
  const { cols, rows, dpr } = layout;
  const u = unit ?? Math.min(PHOTO_CELL, Math.max(8, Math.round(CELL * dpr)));
  share(src, u);
  const placed =
    src.placeFirst && seed === null
      ? { col: Math.floor((cols - src.cols) / 2), row: Math.floor((rows - src.rows) / 2) }
      : undefined;
  const r = await job<{ job: number; width: number; height: number; data: ArrayBuffer }>({
    type: 'weave',
    job: nextJob++,
    id: src.id,
    seed,
    cols,
    rows,
    unit: u,
    placed,
  });
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height));
  const full = makeCanvas(r.width, r.height);
  full.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pyramid = [full];
  while (pyramid[pyramid.length - 1].width > cols * 2) pyramid.push(half(pyramid[pyramid.length - 1]));
  return { source: src, seed, layout, pyramid };
}

/** The slider's pixel size (CSS px; 1 is the photo as it is). */
const pixelSize = (): number => Number(slider.value);

function setSize(size: number): void {
  slider.value = String(size);
  readout.textContent = size === 1 ? 'Original' : `${size} px`;
}

/** Sizes the canvas to the screen (which clears it). */
function fitCanvas(layout: Layout): void {
  canvas.width = Math.round(layout.width * layout.dpr);
  canvas.height = Math.round(layout.height * layout.dpr);
  fx.resize(canvas.width, canvas.height, layout.dpr);
}

/** Shows the quilt on screen at the slider's resolution (ending any transition). */
function show(): void {
  stopTransition();
  setSize(pixelSize());
  if (current) paint(ctx!, current, pixelSize());
  fx.invalidate();
}

/**
 * Paints a quilt at a resolution: 1 is the photo as it is; otherwise pixels of that many CSS px. Each
 * pixel takes the colour from its own middle (the average of its middle third), not the average of
 * all of it: a pixel over two shapes stays one colour instead of turning to mud, as a pixelated photo
 * looks.
 */
function paint(c: CanvasRenderingContext2D, woven: Woven, size: number): void {
  const { pyramid, layout } = woven;
  const { dpr, left, top, gridWidth, gridHeight } = layout;
  c.setTransform(1, 0, 0, 1, 0, 0);
  const dx = Math.round(left * dpr);
  const dy = Math.round(top * dpr);
  if (size === 1) {
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(pyramid[0], dx, dy, Math.round(gridWidth * dpr), Math.round(gridHeight * dpr));
    return;
  }
  const across = Math.ceil(gridWidth / size);
  const down = Math.ceil(gridHeight / size);
  // Averaged down to 3 × 3 per pixel (from the nearest halving at least twice that, so it stays an
  // average), then each pixel takes the middle one of its nine.
  let from = pyramid[0];
  for (const level of pyramid) if (level.width >= across * 6) from = level;
  const thirds = makeCanvas(across * 3, down * 3);
  const t = thirds.getContext('2d')!;
  t.imageSmoothingEnabled = true;
  t.imageSmoothingQuality = 'high';
  t.drawImage(from, 0, 0, thirds.width, thirds.height);
  const small = makeCanvas(across, down);
  const s = small.getContext('2d')!;
  s.imageSmoothingEnabled = false;
  s.drawImage(thirds, 0, 0, across, down);
  c.imageSmoothingEnabled = false;
  c.drawImage(small, dx, dy, across * size * dpr, down * size * dpr);
}

slider.addEventListener('input', () => {
  stopSharpening();
  show();
  // The quilt made ahead is still good; its picture and timings are redone for the new size.
  schedulePrepare();
});

// ---- The next quilt, made ahead of time.

/** A quilt drawn at a resolution, with its tiles' arrival times, ready to bring in. */
interface Prepared {
  woven: Woven;
  size: number;
  picture: HTMLCanvasElement;
  /** Tiles: the pixels at that resolution, across and down from the grid's top left. */
  across: number;
  down: number;
  arrival: Float32Array;
}

let prepared: Prepared | null = null;
/** The next quilt being woven (in the worker), for the source and screen it's for. */
let weaving: { source: Source; layout: Layout; woven: Promise<Woven> } | null = null;
let prepareTimer = 0;

/** Makes the next quilt (or brings the one made up to the screen and slider), soon. */
function schedulePrepare(): void {
  window.clearTimeout(prepareTimer);
  prepareTimer = window.setTimeout(() => void prepare(), PREPARE_AFTER);
}

/**
 * Makes the next quilt of the photo in use, for this screen and resolution: woven in the worker, then
 * pictured here and timed in the worker. (Any time, mid-transition too: on the beat a transition fills
 * the whole bar, and the next must be ready for the next one.)
 */
async function prepare(): Promise<void> {
  const src = source;
  if (!src) return;
  const layout = measure();
  const size = pixelSize();
  if (
    prepared &&
    prepared.woven.source === src &&
    sameScreen(prepared.woven.layout, layout) &&
    prepared.size === size
  )
    return;
  let woven = prepared?.woven;
  if (!woven || woven.source !== src || !sameScreen(woven.layout, layout)) {
    if (!weaving || weaving.source !== src || !sameScreen(weaving.layout, layout))
      weaving = { source: src, layout, woven: weave(src, newSeed(), layout) };
    woven = await weaving.woven;
    weaving = null;
  }
  // (Anything changed meanwhile: a newer call has it in hand.)
  if (source !== src || pixelSize() !== size || !sameScreen(measure(), layout)) return;
  const p = await ready(woven, size);
  if (source !== src || pixelSize() !== size || !sameScreen(measure(), layout)) return;
  prepared = p;
}

/** A quilt's picture at a resolution, and when each of its tiles turns over in the transition. */
async function ready(woven: Woven, size: number): Promise<Prepared> {
  const { layout } = woven;
  const picture = makeCanvas(canvas.width, canvas.height);
  paint(picture.getContext('2d')!, woven, size);
  const across = Math.ceil(layout.gridWidth / size);
  const down = Math.ceil(layout.gridHeight / size);
  // Each tile's new colour, from the picture as it'll be: colour families arrive in turn.
  const small = makeCanvas(across, down);
  const s = small.getContext('2d')!;
  s.imageSmoothingQuality = 'high';
  const { dpr, left, top } = layout;
  s.drawImage(
    picture,
    Math.round(left * dpr),
    Math.round(top * dpr),
    across * size * dpr,
    down * size * dpr,
    0,
    0,
    across,
    down,
  );
  const colours = s.getImageData(0, 0, across, down).data;
  // Timed in the worker. At fine resolutions, arrivals are evened out a little between neighbours:
  // soft fronts, not speckle.
  const r = await job<{ job: number; arrival: ArrayBuffer }>(
    {
      type: 'arrivals',
      job: nextJob++,
      colours: colours.buffer,
      across,
      down,
      radius: size === 1 ? 2 : size <= 3 ? 1 : 0,
      fade: TRANSITIONS[0].fade,
    },
    [colours.buffer],
  );
  return { woven, size, picture, across, down, arrival: new Float32Array(r.arrival) };
}

// ---- The transition (Colour groups): the new quilt floods in one colour family at a time.

/** A transition under way: the old and new pictures, and each tile's arrival. */
interface Running {
  seconds: number;
  fade: number;
  start: number;
  old: HTMLCanvasElement;
  next: HTMLCanvasElement;
  layout: Layout;
  size: number;
  across: number;
  down: number;
  arrival: Float32Array;
  mask: HTMLCanvasElement;
  maskData: ImageData;
  layer: HTMLCanvasElement;
  frame: number;
  /** What to do once it's done. */
  then: () => void;
}

let running: Running | null = null;

function stopTransition(): void {
  if (!running) return;
  cancelAnimationFrame(running.frame);
  running = null;
}

/** How long a transition takes: its own length, or on the beat, TRANSITION_BEATS of them. */
const transitionSeconds = (): number =>
  clock.running ? TRANSITION_BEATS * clock.beatSeconds : TRANSITIONS[0].seconds;

/** The next quilt of the same photo (Space, or the 1 of a bar). False if it isn't ready yet. */
function newQuilt(): boolean {
  if (!source || !current) return false;
  // The window changed since it was drawn: start over at this size, no transition.
  if (!sameScreen(current.layout, measure())) {
    void resize();
    return false;
  }
  const p = prepared;
  if (!p || p.woven.source !== source) {
    schedulePrepare();
    return false;
  }
  stopSharpening();
  prepared = null;
  bringIn(p, () => undefined);
  // The one after: woven in the worker straight away, so it's ready for the next bar.
  schedulePrepare();
  return true;
}

/** Brings a prepared quilt in over what's on screen (carrying on from mid-transition, if one was cut short). */
function bringIn(p: Prepared, then: () => void): void {
  stopTransition();
  const old = makeCanvas(canvas.width, canvas.height);
  old.getContext('2d')!.drawImage(canvas, 0, 0);
  current = p.woven;
  // The textile's quilts can be kept by their seed (a dropped photo isn't kept, so neither are its).
  if (entryInUse?.textile && current.seed !== null) history.replaceState(null, '', `#${current.seed}`);
  else history.replaceState(null, '', location.pathname + location.search);
  const mask = makeCanvas(p.across, p.down);
  running = {
    seconds: transitionSeconds(),
    fade: TRANSITIONS[0].fade,
    start: performance.now(),
    old,
    next: p.picture,
    layout: p.woven.layout,
    size: p.size,
    across: p.across,
    down: p.down,
    arrival: p.arrival,
    mask,
    maskData: mask.getContext('2d')!.createImageData(p.across, p.down),
    layer: makeCanvas(canvas.width, canvas.height),
    frame: 0,
    then,
  };
  running.frame = requestAnimationFrame(step);
}

/** One frame of the running transition: the old picture, then the new one through a mask of tiles. */
function step(now: number): void {
  const r = running;
  if (!r) return;
  const t = ease(Math.min(1, (now - r.start) / 1000 / r.seconds));
  const c = ctx!;
  const { dpr, left, top } = r.layout;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.imageSmoothingEnabled = false;
  // Each tile as far turned over as it is.
  const px = r.maskData.data;
  for (let i = 0; i < r.arrival.length; i++) px[i * 4 + 3] = 255 * turned(t, r.arrival[i], r.fade);
  r.mask.getContext('2d')!.putImageData(r.maskData, 0, 0);
  const l = r.layer.getContext('2d')!;
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalCompositeOperation = 'copy';
  l.drawImage(r.next, 0, 0);
  l.globalCompositeOperation = 'destination-in';
  l.imageSmoothingEnabled = false;
  l.drawImage(
    r.mask,
    Math.round(left * dpr),
    Math.round(top * dpr),
    r.across * r.size * dpr,
    r.down * r.size * dpr,
  );
  c.drawImage(r.old, 0, 0);
  c.drawImage(r.layer, 0, 0);
  fx.invalidate();
  if (t >= 1) {
    running = null;
    c.drawImage(r.next, 0, 0);
    fx.invalidate();
    r.then();
    return;
  }
  r.frame = requestAnimationFrame(step);
}

// ---- The beat: a new quilt on every 1, after a bar counting in.

const clock = new BeatClock(Number(bpmInput.value) || 120);
const taps = new TapTempo();
let barsPlayed = 0;
/** The beat of the bar a new quilt lands on (1–4; chosen by clicking the count, or keys 1–4). */
let trigger = 1;
let beatFrame = 0;
const seconds = (): number => performance.now() / 1000;

/** Lights the count (1–4), or none. */
function showCount(beat: number): void {
  countOut.querySelectorAll('button').forEach((el, k) => el.classList.toggle('on', k + 1 === beat));
}

function beatLoop(): void {
  for (const beat of clock.tick(seconds())) {
    showCount(beat);
    if (beat === 1) barsPlayed++;
    // (Not in the first bar: it counts in.)
    if (beat === trigger && barsPlayed > 1) newQuilt();
  }
  beatFrame = requestAnimationFrame(beatLoop);
}

function setPlaying(on: boolean): void {
  if (on === clock.running) return;
  if (on) {
    barsPlayed = 0;
    clock.start(seconds());
    beatLoop();
  } else {
    clock.stop();
    cancelAnimationFrame(beatFrame);
    showCount(0);
  }
  playButton.setAttribute('aria-pressed', String(on));
  playButton.textContent = on ? '■' : '▶';
  playButton.title = on ? 'Stop the beat (P)' : 'Play: a new pattern on every 1 (P)';
}

function setBpm(bpm: number): void {
  clock.setBpm(bpm, seconds());
  bpmInput.value = String(clock.bpm);
}

playButton.addEventListener('click', () => setPlaying(!clock.running));
byId('new').addEventListener('click', () => {
  newQuilt();
});

/** Chooses the beat a new quilt lands on. */
function setTrigger(beat: number): void {
  trigger = beat;
  countOut.querySelectorAll<HTMLButtonElement>('button').forEach((el) => {
    el.setAttribute('aria-pressed', String(Number(el.dataset.beat) === beat));
  });
}
countOut.addEventListener('click', (e) => {
  const beat = Number((e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.beat);
  if (beat) setTrigger(beat);
});
bpmInput.addEventListener('change', () => setBpm(Number(bpmInput.value) || clock.bpm));

// ---- Effects (see effects.ts): one at a time, chosen with the chips over the controls.

/** What the effects need to know of the moment. */
function moment(): Moment {
  return { transitioning: running !== null };
}

const fx = createEffects(display, canvas, moment);
const effectsBar = byId<HTMLElement>('effects');
if (!fx.supported) effectsBar.hidden = true;
for (const e of EFFECTS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = e.name;
  b.title = e.title;
  b.setAttribute('aria-pressed', 'false');
  b.dataset.effect = e.id;
  b.addEventListener('click', () => {
    // One at a time (for now): this one on and the rest off, or, if it was on, none.
    const on = !fx.isOn(e.id);
    for (const other of EFFECTS) fx.set(other.id, on && other.id === e.id);
    effectsBar.querySelectorAll<HTMLButtonElement>('button').forEach((x) => {
      x.setAttribute('aria-pressed', String(on && x.dataset.effect === e.id));
    });
  });
  effectsBar.append(b);
}

// ---- A new photo: its pattern comes in at 16 px, then sharpens step by step to the photo itself.

let sharpening = 0;
/** Bumped with each photo chosen, so a slow decode or weave doesn't land over a later choice. */
let choosing = 0;

function stopSharpening(): void {
  window.clearTimeout(sharpening);
  sharpening = 0;
}

/** Switches to an image of this session. */
async function use(entry: Entry): Promise<void> {
  const ticket = ++choosing;
  let decoded: Source;
  try {
    decoded = (await decode(entry.file, entry.textile)).source;
  } catch {
    say('That photo couldn’t be read. Try a JPEG, PNG or WebP.');
    return;
  }
  if (ticket !== choosing) return;
  entryInUse = entry;
  renderThumbs();
  void arrive(decoded, ticket);
}

/** Brings in a photo: the quilt laid out and drawn quickly at 16 px, then drawn in full and sharpened. */
async function arrive(src: Source, ticket: number): Promise<void> {
  stopSharpening();
  // The last photo's pixels can go from the worker.
  if (source && source !== src) toWeaver({ type: 'forget', id: source.id });
  source = src;
  prepared = null;
  const layout = measure();
  const seed = newSeed();
  const quick = await weave(src, seed, layout, QUICK_UNIT);
  if (ticket !== choosing) return;
  if (!current || !sameScreen(current.layout, layout)) fitCanvas(layout);
  setSize(16);
  // The full drawing of the same quilt, woven meanwhile.
  const full = weave(src, seed, layout);
  const first = await ready(quick, 16);
  if (ticket !== choosing) return;
  bringIn(first, () => {
    void full.then((woven) => {
      if (ticket !== choosing || source !== src) return;
      // The pattern's in: now drawn in full, and stepped down to the photo itself.
      current = woven;
      let k = 0;
      const next = (): void => {
        if (k >= SHARPEN.length) {
          sharpening = 0;
          schedulePrepare();
          return;
        }
        setSize(SHARPEN[k++]);
        paint(ctx!, woven, pixelSize());
        fx.invalidate();
        sharpening = window.setTimeout(next, SHARPEN_STEP);
      };
      sharpening = window.setTimeout(next, SHARPEN_STEP);
    });
  });
}

// ---- This session's images: the drawer, and dropping or choosing a photo.

let nextId = 1;

async function add(file: File): Promise<void> {
  // (Dropped or chosen: out of the way, to watch it come in.)
  setDrawer(false);
  const why = refusal(file);
  if (why) return say(why);
  let thumb: string;
  let decoded: Source;
  try {
    ({ source: decoded, thumb } = await decode(file, false));
  } catch {
    return say('That photo couldn’t be read. Try a JPEG, PNG or WebP.');
  }
  const entry: Entry = { id: nextId++, name: file.name, file, thumb, textile: false };
  entries.push(entry);
  const ticket = ++choosing;
  entryInUse = entry;
  renderThumbs();
  void arrive(decoded, ticket);
}

function renderThumbs(): void {
  thumbs.replaceChildren(
    ...entries.map((entry) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb';
      b.title = entry.textile ? 'The textile' : entry.name;
      b.setAttribute('aria-current', String(entry === entryInUse));
      const img = document.createElement('img');
      img.src = entry.thumb;
      img.alt = entry.textile ? 'The textile' : entry.name;
      b.append(img);
      b.addEventListener('click', () => {
        setDrawer(false);
        if (entry !== entryInUse) void use(entry);
      });
      li.append(b);
      // A photo added this session can be removed (the textile stays, to come back to).
      if (!entry.textile) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'remove';
        x.textContent = '×';
        x.title = 'Remove';
        x.setAttribute('aria-label', `Remove ${entry.name}`);
        x.addEventListener('click', () => {
          remove(entry);
        });
        li.append(x);
      }
      return li;
    }),
    (() => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb add';
      b.textContent = '+';
      b.title = 'Add a photo';
      b.setAttribute('aria-label', 'Add a photo');
      b.addEventListener('click', () => fileInput.click());
      li.append(b);
      return li;
    })(),
  );
}

/** Removes a photo from the session (forgotten: its file and thumbnail go); if it's in use, the textile comes back. */
function remove(entry: Entry): void {
  const i = entries.indexOf(entry);
  if (i < 0 || entry.textile) return;
  entries.splice(i, 1);
  URL.revokeObjectURL(entry.thumb);
  if (entry === entryInUse) {
    const textile = entries.find((e) => e.textile);
    if (textile) void use(textile);
  } else {
    renderThumbs();
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void add(file);
});

function setDrawer(open: boolean): void {
  document.body.classList.toggle('drawer-open', open);
  menu.setAttribute('aria-expanded', String(open));
  drawer.inert = !open;
}
menu.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));

// A level up from the images: the lab, to get to its other experiments and drill down within them.
function showImages(): void {
  navView.hidden = true;
  imagesView.hidden = false;
}
async function showLevel(level: Level): Promise<void> {
  const m = await loadManifest();
  imagesView.hidden = true;
  navView.hidden = false;
  if (!m) {
    navView.replaceChildren();
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back';
    back.textContent = '‹ Images';
    back.addEventListener('click', showImages);
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'The lab’s list couldn’t be loaded.';
    navView.append(back, p);
    return;
  }
  renderLevel(navView, m, level, { here: HERE, home: showImages, go: (l) => void showLevel(l) });
  navView.querySelector<HTMLElement>('.back, .nav a, .nav button')?.focus({ preventScroll: true });
}
byId('to-lab').addEventListener('click', () => void showLevel({ at: 'lab' }));
display.addEventListener('pointerdown', () => setDrawer(false));

// Drag and drop, anywhere on the page.
let dragDepth = 0;
const carriesFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;
window.addEventListener('dragenter', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  setDrawer(false);
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => {
  if (carriesFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) void add(file);
});

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
    // (Not while the slider's being dragged, or the tempo typed.)
    if (slider.matches(':active') || document.activeElement === bpmInput) return wake();
    document.body.classList.add('idle');
  }, IDLE_MS);
}
for (const type of ['pointermove', 'pointerdown', 'keydown'] as const) window.addEventListener(type, wake);
wake();

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Escape') return setDrawer(false);
  // (Typing a tempo: the keys are the field's.)
  if (e.target === bpmInput) {
    if (e.code === 'Enter') bpmInput.blur();
    return;
  }
  if (e.code === 'KeyF') {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  } else if (e.code === 'KeyP') setPlaying(!clock.running);
  else if (/^Digit[1-4]$/.test(e.code)) setTrigger(Number(e.code.slice(5)));
  else if (e.code === 'KeyT') {
    const bpm = taps.tap(seconds());
    if (bpm) setBpm(bpm);
  } else if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    newQuilt();
  }
});

/** The screen changed: the same quilt redrawn at its new size (and the next made again). */
async function resize(): Promise<void> {
  const src = source;
  if (!src) return;
  stopSharpening();
  const layout = measure();
  const woven = await weave(src, current?.seed ?? null, layout);
  if (source !== src) return;
  fitCanvas(layout);
  current = woven;
  prepared = null;
  show();
  schedulePrepare();
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => void resize(), 150);
});

// The textile first: whole, grown out to fill the screen (or the quilt in the address, if there is one).
void (async () => {
  const file = await (await fetch(textileUrl)).blob();
  const { source: textile, thumb } = await decode(file, true);
  const entry: Entry = { id: 0, name: 'Textile', file, thumb, textile: true };
  entries.push(entry);
  entryInUse = entry;
  source = textile;
  renderThumbs();
  const fromHash = Number.parseInt(location.hash.slice(1), 10);
  const layout = measure();
  current = await weave(textile, Number.isFinite(fromHash) ? fromHash : null, layout);
  fitCanvas(layout);
  show();
  document.body.classList.add('ready');
  schedulePrepare();
})();
