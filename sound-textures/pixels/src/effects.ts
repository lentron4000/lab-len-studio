// Sound Textures — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.

/**
 * Effects: a last layer, on the GPU, between the picture (the pattern and its transitions, painted as
 * before) and the screen. Each can be switched on and off, and eases in and out as it is, so they can
 * be mixed and previewed freely. Without WebGL the picture is shown as it is, and there are none.
 */
export type EffectId = 'kaleido' | 'warp' | 'zoom' | 'cycle';

export const EFFECTS: readonly { id: EffectId; name: string; title: string }[] = [
  { id: 'kaleido', name: 'Kaleido', title: 'Mirrored into six turning segments round the centre' },
  { id: 'warp', name: 'Warp', title: 'A slow liquid ripple, stronger during transitions' },
  { id: 'zoom', name: 'Zoom', title: 'A never-ending zoom in, turning steadily' },
  { id: 'cycle', name: 'Cycle', title: 'Colours slowly turn round the colour wheel' },
];

/** What the effects need to know of the moment. */
export interface Moment {
  /** A transition is under way (Warp swells). */
  transitioning: boolean;
}

/** Seconds for an effect to ease fully in or out. */
const EASE_SECONDS = 0.5;
/** Zoom: seconds for the view to double (it never stops: see the shader), and how fast it turns
 * (radians a second, as Kaleido's segments do). */
const ZOOM_DOUBLING = 14;
const ZOOM_TURN = 0.04;

const VERTEX = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform sampler2D uBase;
uniform vec2 uRes;
uniform float uTime;
uniform float uTransition;
uniform float uZoomAt;
uniform float uZoomTurn;
uniform float uKaleido, uWarp, uZoom, uCycle;
const float PI = 3.14159265;

vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
vec3 hueRotate(vec3 c, float a) {
  // Round the colour wheel in YIQ, lightness kept.
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float ca = cos(a), sa = sin(a);
  float i2 = i * ca - q * sa, q2 = i * sa + q * ca;
  return clamp(vec3(y + 0.956 * i2 + 0.621 * q2, y - 0.272 * i2 - 0.647 * q2, y - 1.106 * i2 + 1.703 * q2), 0.0, 1.0);
}

/** The picture at a point (centred, aspect-corrected), through Kaleido and Warp. */
vec3 look(vec2 c, float aspect) {
  // Kaleido: six mirrored segments round the centre, turning slowly.
  if (uKaleido > 0.001) {
    float r = length(c);
    float seg = PI / 3.0;
    float a = atan(c.y, c.x) + uTime * 0.04;
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    c = mix(c, r * vec2(cos(a), sin(a)), uKaleido);
  }
  // Warp: a slow liquid ripple, swelling while a transition runs.
  float w = uWarp * (0.008 + 0.022 * uTransition);
  c += w * vec2(
    sin(c.y * 9.0 + uTime * 1.1) + 0.4 * sin(c.y * 23.0 - uTime * 0.7),
    cos(c.x * 8.0 - uTime * 0.9) + 0.4 * cos(c.x * 19.0 + uTime * 1.3)
  );
  vec2 uv = c / vec2(aspect, 1.0) + 0.5;
  // Anything reaching past an edge reflects back in.
  uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  return texture2D(uBase, uv).rgb;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float aspect = uRes.x / uRes.y;
  vec2 c = (frag / uRes - 0.5) * vec2(aspect, 1.0);

  // Zoom: forever in, turning steadily. The view doubles every few seconds, and as it does, a copy at
  // half that size fades in under it, so when it starts over there's nothing to see: an endless zoom.
  vec3 col;
  if (uZoom > 0.001) {
    c = rot(c, uZoomTurn);
    float f = fract(uZoomAt);
    float near = mix(1.0, exp2(f), uZoom);
    float far = mix(1.0, exp2(f - 1.0), uZoom);
    col = mix(look(c / near, aspect), look(c / far, aspect), f * uZoom);
  } else {
    col = look(c, aspect);
  }

  // Cycle: round the colour wheel.
  if (uCycle > 0.001) col = hueRotate(col, uCycle * uTime * 0.4);

  gl_FragColor = vec4(col, 1.0);
}
`;

export interface Effects {
  /** Whether the effects can run here (WebGL). */
  supported: boolean;
  /** The picture changed: show it again. */
  invalidate(): void;
  /** Sizes the screen's canvas (device pixels). */
  resize(width: number, height: number, dpr: number): void;
  set(id: EffectId, on: boolean): void;
  isOn(id: EffectId): boolean;
}

/**
 * Shows `source` (the picture) on `display`, through whichever effects are on, every frame they need
 * one. `moment` says where the music is.
 */
export function createEffects(
  display: HTMLCanvasElement,
  source: HTMLCanvasElement,
  moment: () => Moment,
): Effects {
  const gl = display.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
  if (!gl) return fallback(display, source);

  const compile = (type: number, text: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const program = (frag: string): WebGLProgram => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
    return p;
  };
  let main: WebGLProgram;
  try {
    main = program(FRAGMENT);
  } catch {
    return fallback(display, source);
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = (): WebGLTexture => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const base = texture();

  const loc = (p: WebGLProgram, n: string): WebGLUniformLocation | null => gl.getUniformLocation(p, n);
  const u = Object.fromEntries(
    [
      'uBase',
      'uRes',
      'uTime',
      'uTransition',
      'uZoomAt',
      'uZoomTurn',
      'uKaleido',
      'uWarp',
      'uZoom',
      'uCycle',
    ].map((n) => [n, loc(main, n)]),
  );

  const target = new Map<EffectId, number>(EFFECTS.map((e) => [e.id, 0]));
  const level = new Map<EffectId, number>(EFFECTS.map((e) => [e.id, 0]));
  let dirty = true;
  let width = 1;
  let height = 1;
  let last = performance.now();
  let transition = 0;
  /** Zoom's progress, in doublings (it only runs while Zoom is on, so it picks up where it left off). */
  let zoomAt = 0;
  let zoomTurn = 0;

  const upload = (): void => {
    gl.bindTexture(gl.TEXTURE_2D, base);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  };

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let active = false;
    for (const e of EFFECTS) {
      const t = target.get(e.id)!;
      let v = level.get(e.id)!;
      if (v !== t) v = t > v ? Math.min(t, v + dt / EASE_SECONDS) : Math.max(t, v - dt / EASE_SECONDS);
      level.set(e.id, v);
      if (v > 0) active = true;
    }
    // Nothing on and nothing new: the screen already shows the picture.
    if (!active && !dirty) return;
    if (dirty) upload();
    dirty = false;
    const m = moment();
    transition += ((m.transitioning ? 1 : 0) - transition) * Math.min(1, dt * 4);
    zoomAt += (dt / ZOOM_DOUBLING) * level.get('zoom')!;
    zoomTurn += dt * ZOOM_TURN * level.get('zoom')!;

    gl.viewport(0, 0, width, height);
    gl.useProgram(main);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, base);
    gl.uniform1i(u.uBase, 0);
    gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uTime, now / 1000);
    gl.uniform1f(u.uTransition, transition);
    gl.uniform1f(u.uZoomAt, zoomAt);
    gl.uniform1f(u.uZoomTurn, zoomTurn);
    for (const e of EFFECTS) gl.uniform1f(u['u' + e.id[0].toUpperCase() + e.id.slice(1)], level.get(e.id)!);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  requestAnimationFrame(frame);

  return {
    supported: true,
    invalidate: () => {
      dirty = true;
    },
    resize: (w, h) => {
      width = display.width = w;
      height = display.height = h;
      dirty = true;
    },
    set: (id, on) => {
      target.set(id, on ? 1 : 0);
    },
    isOn: (id) => target.get(id) === 1,
  };
}

/** No WebGL: the picture as it is, and no effects. */
function fallback(display: HTMLCanvasElement, source: HTMLCanvasElement): Effects {
  const c = display.getContext('2d');
  return {
    supported: false,
    invalidate: () => {
      c?.drawImage(source, 0, 0);
    },
    resize: (w, h) => {
      display.width = w;
      display.height = h;
    },
    set: () => undefined,
    isOn: () => false,
  };
}
