// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import { BACKING, drawGlyph, measure, NEAR_ENOUGH } from '../../shared/emoji';
import { cover, gridOf, type Grid } from './fit';

/**
 * The video, drawn on the GPU (WebGL2) every frame it has, in up to three passes:
 *
 * 1. Cells: the screen in tiles, each the average of its middle third (as 01's pixels: a tile over two
 *    shapes stays one colour, not mud), steadied against the last frame so the camera's noise doesn't
 *    shimmer.
 * 2. Pick (emoji): each tile's emoji, matched as 01 matches them (shared/emoji), but held: a tile keeps
 *    its emoji while it's still a near match, so they change with the picture, not with the noise.
 * 3. Screen: the tiles drawn, as pixels, as emoji over their dimmed colour, or as the Matrix's code (each
 *    tile a glyph, lit by the picture, with rain falling through it), or as a cloud of particles; or, at 1,
 *    the video itself.
 * 4. Vapour: wherever the picture moves (the cells pass marks how much), coloured vapour is let into a
 *    layer of its own, where it rises, sways, spreads and fades: as the only way through to the video,
 *    black elsewhere (Ghost), or under the particles (Particles).
 */

/**
 * The looks: the tiles as pixels, as emoji, as the Matrix's falling code, or as a particle cloud; or
 * black, the video only showing where it moves.
 */
export type Look = 'pixel' | 'emoji' | 'matrix' | 'particles' | 'ghost';

/** How the video is shown. */
export interface View {
  /** Tile size, device px; 1 is the video as it is (as pixels). */
  tile: number;
  look: Look;
  /** Seconds, for what moves by itself (the Matrix's rain, the particles and their vapour). */
  time: number;
  /** Flipped left to right, as a mirror (the camera facing you). */
  mirror: boolean;
}

export interface Renderer {
  resize(width: number, height: number): void;
  /** Draws the video as `view` says; `newFrame` when the video has a frame not yet drawn. */
  draw(video: HTMLVideoElement, view: View, newFrame: boolean): void;
}

/** Of a tile's colour, the share of last frame's kept (steadies the camera's noise). */
const STEADY = 0.45;
/** Emoji atlas: each glyph's square (px; mipmapped down to the tile size), in rows this many across. */
const GLYPH = 64;
const ATLAS_COLUMNS = 16;
/** At most this many emoji (picks are stored in a byte). */
const MAX_GLYPHS = 255;
/** The Matrix's code: half-width katakana, digits and a few signs, drawn mirrored, as in the film. */
const CODE = [...'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾜ0123456789:=*+-<>¦'];
const CODE_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "MS Gothic", "Noto Sans JP", monospace';

const VERTEX = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

/** What every pass shares: where a screen point (device px, from the top left) is in the video. */
const COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uVideo;
uniform vec4 uCrop;
uniform vec2 uScreen;
uniform bool uMirror;
uniform float uTile;
uniform vec2 uOffset;
out vec4 o;
vec3 at(vec2 p) {
  vec2 s = clamp(p / uScreen, 0.0, 1.0);
  if (uMirror) s.x = 1.0 - s.x;
  return texture(uVideo, uCrop.xy + s * uCrop.zw).rgb;
}
`;

// (Tiles are stored a texel each, at their place across and down from the top left.)
const CELLS =
  COMMON +
  `
uniform sampler2D uPrev;
uniform float uKeep;
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec2 origin = vec2(cell) * uTile - uOffset;
  // Nine samples over the tile's middle third.
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 3; j++)
    for (int i = 0; i < 3; i++) sum += at(origin + uTile * (vec2(i, j) + 3.5) / 9.0);
  vec3 now = sum / 9.0;
  vec3 before = texelFetch(uPrev, cell, 0).rgb;
  // How much it moved (in alpha): how far it is from where it was settling, past the camera's noise.
  float moved = uKeep > 0.0 ? smoothstep(0.06, 0.24, length(now - before)) : 0.0;
  o = vec4(mix(now, before, uKeep), moved);
}
`;

// The match: shared/emoji's pick (the same distance, and one of the CHOICES nearest), kept the same.
const PICK = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uCells;
uniform sampler2D uPrevPick;
uniform sampler2D uGlyphs;
uniform int uCount;
uniform float uBacking;
uniform float uNear;
uniform bool uFresh;
out vec4 o;

float dist(vec3 c, int i) {
  vec4 g = texelFetch(uGlyphs, ivec2(i, 0), 0);
  // What's seen: the emoji where it covers (alpha: how much), the tile's colour dimmed where it doesn't.
  vec3 e = g.rgb * g.a + c * uBacking * (1.0 - g.a);
  vec3 d = e - c;
  float mean = (e.r + c.r) / 2.0;
  vec3 h = g.rgb - c;
  return (2.0 + mean) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - mean) * d.b * d.b + 0.6 * dot(h, h);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(uCells, cell, 0).rgb;
  // The three nearest, nearest first.
  vec3 d = vec3(1e9);
  ivec3 k = ivec3(0);
  for (int i = 0; i < 256; i++) {
    if (i >= uCount) break;
    float e = dist(c, i);
    if (e < d.x) {
      d = vec3(e, d.xy);
      k = ivec3(i, k.xy);
    } else if (e < d.y) {
      d = vec3(d.x, e, d.y);
      k = ivec3(k.x, i, k.y);
    } else if (e < d.z) {
      d.z = e;
      k.z = i;
    }
  }
  // The nearest, and any of the next two nearly as near.
  float limit = d.x * uNear + 0.004;
  int n = 1 + int(d.y <= limit && uCount > 1) + int(d.y <= limit && d.z <= limit && uCount > 2);
  // Its emoji still one of them: kept.
  vec4 prev = texelFetch(uPrevPick, cell, 0);
  if (!uFresh && prev.a > 0.5) {
    int p = int(prev.r * 255.0 + 0.5);
    if (p == k.x || (n > 1 && p == k.y) || (n > 2 && p == k.z)) {
      o = prev;
      return;
    }
  }
  // Otherwise one of them, chosen by its place (so neighbours of one colour vary).
  float salt = fract(sin(dot(vec2(cell), vec2(127.1, 311.7))) * 43758.5453);
  int want = min(n - 1, int(salt * float(n)));
  int pick = want == 0 ? k.x : want == 1 ? k.y : k.z;
  o = vec4(float(pick) / 255.0, 0.0, 0.0, 1.0);
}
`;

// Vapour: last frame's, risen a little and swaying, spread, faded; and new, in the picture's colour,
// wherever it moved. (At half the screen's resolution: it's soft anyway.)
const VAPOUR = `#version 300 es
precision highp float;
uniform sampler2D uVapour;
uniform sampler2D uCells;
uniform vec2 uSize;
uniform vec2 uScreen;
uniform float uTile;
uniform vec2 uOffset;
uniform vec2 uGrid;
uniform float uTime;
uniform float uFade;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 px = 1.0 / uSize;
  float sway = sin(uv.y * 11.0 + uTime * 1.3) * 0.7 + sin(uv.x * 7.0 - uTime * 0.8) * 0.5;
  vec2 from = uv - vec2(sway, 1.4) * px;
  // (Its colour premultiplied by how thick it is, in alpha.)
  vec4 old = texture(uVapour, from) * 0.5;
  old += (texture(uVapour, from + vec2(px.x, 0.0)) + texture(uVapour, from - vec2(px.x, 0.0)) +
          texture(uVapour, from + vec2(0.0, px.y)) + texture(uVapour, from - vec2(0.0, px.y))) * 0.125;
  // (Less a step too, so it fades all the way out in 8 bits.)
  old = max(old * uFade - 0.6 / 255.0, 0.0);
  vec2 p = vec2(uv.x * uScreen.x, (1.0 - uv.y) * uScreen.y);
  vec4 c = texture(uCells, (p + uOffset) / uTile / uGrid);
  vec3 lit = c.rgb * (0.6 + 0.6 * dot(c.rgb, vec3(0.299, 0.587, 0.114)));
  o = min(old + vec4(lit, 1.0) * c.a * 0.06, 1.0);
}
`;

// Particles: one a tile, a soft dot of its colour, bigger and brighter where it's light, wandering a
// little; where the picture moves, scattered and lifted, as if blown off.
const PARTICLE_VERTEX = `#version 300 es
precision highp float;
uniform sampler2D uCells;
uniform vec2 uGrid;
uniform float uTile;
uniform vec2 uOffset;
uniform vec2 uScreen;
uniform float uTime;
out vec3 vColour;
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  int across = int(uGrid.x);
  ivec2 cell = ivec2(gl_VertexID % across, gl_VertexID / across);
  vec4 c = texelFetch(uCells, cell, 0);
  float light = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float moved = c.a;
  vec2 at = vec2(cell);
  float h = hash(at);
  vec2 jitter = vec2(h, hash(at + 17.0)) - 0.5;
  vec2 wander = 0.35 * vec2(sin(uTime * (0.5 + h) + h * 6.283), cos(uTime * (0.4 + hash(at.yx)) + hash(at + 3.0) * 6.283));
  vec2 blown = moved * vec2(hash(at + 5.0) - 0.5, -0.4 - hash(at + 9.0)) * 2.4;
  vec2 p = (at + 0.5 + 0.8 * jitter + wander + blown) * uTile - uOffset;
  gl_Position = vec4(p.x / uScreen.x * 2.0 - 1.0, 1.0 - p.y / uScreen.y * 2.0, 0.0, 1.0);
  gl_PointSize = uTile * mix(0.25, 0.8, light) * (1.0 + 0.5 * moved);
  vColour = c.rgb * (0.15 + 0.75 * smoothstep(0.04, 0.8, light)) + vec3(0.12) * moved;
}
`;
const PARTICLE = `#version 300 es
precision highp float;
in vec3 vColour;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  o = vec4(vColour * a * a, 1.0);
}
`;

const SCREEN =
  COMMON +
  `
uniform int uMode;
uniform sampler2D uCells;
uniform sampler2D uPick;
uniform sampler2D uAtlas;
uniform float uBacking;
uniform int uColumns;
uniform vec2 uGlyph;
uniform float uLod;
uniform float uTime;
uniform vec2 uGrid;
uniform sampler2D uCode;
uniform int uCodeCount;
uniform vec2 uCodeGlyph;
uniform sampler2D uVapourScreen;

float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }

/**
 * The Matrix: each tile a glyph, lit by the picture's light there; through it, rain: drops falling down
 * each column at their own speeds, a white head and a fading trail. The picture is drawn in lit code,
 * and the rain shows faintly where it's dark.
 */
vec3 matrix(vec2 g, ivec2 cell, vec3 c) {
  vec2 at = vec2(cell);
  // The picture's light, contrasty: mid-tones fall away, so the figure stands out of the dark.
  float light = smoothstep(0.2, 0.75, dot(c, vec3(0.299, 0.587, 0.114)));
  light *= light;
  float trail = 0.0;
  float head = 0.0;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float seed = hash(vec2(at.x, fk * 7.31));
    float speed = mix(5.0, 14.0, hash(vec2(at.x, fk + 1.7)));
    // (A cycle a bit longer than the screen, so drops leave gaps and don't line up.)
    float span = uGrid.y + mix(8.0, 40.0, seed);
    float behind = mod(uTime * speed + seed * span, span) - at.y;
    if (behind >= 0.0) {
      float len = mix(6.0, 22.0, hash(vec2(at.x, fk + 3.1)));
      trail = max(trail, exp(-3.0 * behind / len));
      head = max(head, 1.0 - smoothstep(0.0, 1.0, behind));
    }
  }
  // Lit code where the picture's bright (brighter still as rain passes); faint rain where it's dark.
  float v = light * (0.8 + 0.4 * trail) + 0.28 * trail * (1.0 - light) + 0.7 * head;
  // Each tile's glyph changes now and then (the heads' quickly).
  float rate = mix(0.2, 1.6, hash(at.yx + 0.5)) * (1.0 + 10.0 * head);
  float n = hash(at + floor(uTime * rate + hash(at)) * 0.37);
  int k = int(n * float(uCodeCount)) % uCodeCount;
  vec2 slot = vec2(float(k % uColumns), float(k / uColumns));
  vec2 uv = (slot + fract(g)) * uCodeGlyph;
  float ink = textureLod(uCode, uv, uLod).a;
  float glow = textureLod(uCode, uv, uLod + 2.0).a;
  vec3 green = vec3(0.12, 1.0, 0.38);
  vec3 lit = mix(green * v, vec3(0.82, 1.0, 0.86), clamp(0.8 * head + smoothstep(0.9, 1.3, v), 0.0, 1.0));
  return lit * ink + green * glow * 0.45 * v;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uScreen.y - gl_FragCoord.y);
  // (Particles: the vapour, under them; they're drawn over it after.)
  if (uMode == 4) {
    o = vec4(texture(uVapourScreen, gl_FragCoord.xy / uScreen).rgb, 1.0);
    return;
  }
  // Ghost: black, but where the vapour is; there, an apparition: the video showing through, pale and cold,
  // never quite solid, shimmering and flickering, in a pale cold mist.
  if (uMode == 6) {
    vec4 v = texture(uVapourScreen, gl_FragCoord.xy / uScreen);
    // (Never evenly there: slow wisps drift through it, thinning it here and there.)
    float wisps = 0.55 + 0.45 * sin(p.x * 0.011 + uTime * 0.6 + 2.0 * sin(p.y * 0.009 - uTime * 0.45));
    float through = smoothstep(0.02, 0.7, v.a) * 0.5 * wisps;
    vec2 shimmer = vec2(sin(p.y * 0.03 + uTime * 2.3) + 0.5 * sin(p.y * 0.071 - uTime * 3.1), 0.0) * 4.0 * v.a;
    vec3 seen = at(p + shimmer);
    float lum = dot(seen, vec3(0.299, 0.587, 0.114));
    vec3 cold = vec3(0.72, 0.9, 1.0);
    vec3 spirit = mix(vec3(lum), seen, 0.2) * cold + cold * 0.05;
    float flicker = 0.88 + 0.08 * sin(uTime * 13.0) * sin(uTime * 4.7 + 1.3) + 0.04 * sin(uTime * 31.0);
    float mist = dot(v.rgb, vec3(0.299, 0.587, 0.114));
    o = vec4((spirit * through + cold * mist * 0.3) * flicker, 1.0);
    return;
  }
  if (uMode == 0) {
    o = vec4(at(p), 1.0);
    return;
  }
  vec2 g = (p + uOffset) / uTile;
  ivec2 cell = ivec2(floor(g));
  vec3 c = texelFetch(uCells, cell, 0).rgb;
  if (uMode == 1) {
    o = vec4(c, 1.0);
    return;
  }
  if (uMode == 3) {
    o = vec4(matrix(g, cell, c), 1.0);
    return;
  }
  int k = int(texelFetch(uPick, cell, 0).r * 255.0 + 0.5);
  vec2 slot = vec2(float(k % uColumns), float(k / uColumns));
  // (A level of detail of its own: worked out from the tile's edges, it would jump at every one.)
  vec4 e = textureLod(uAtlas, (slot + fract(g)) * uGlyph, uLod);
  o = vec4(c * uBacking * (1.0 - e.a) + e.rgb, 1.0);
}
`;

interface Target {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
}

/** Draws on `canvas`, or null where WebGL2 isn't to be had. */
export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl) return null;

  const compile = (type: number, text: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const program = (frag: string, vertex = VERTEX): WebGLProgram => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
    return p;
  };
  let cellsProgram: WebGLProgram;
  let pickProgram: WebGLProgram;
  let screenProgram: WebGLProgram;
  let vapourProgram: WebGLProgram;
  let particleProgram: WebGLProgram;
  try {
    cellsProgram = program(CELLS);
    pickProgram = program(PICK);
    screenProgram = program(SCREEN);
    vapourProgram = program(VAPOUR);
    particleProgram = program(PARTICLE, PARTICLE_VERTEX);
  } catch (e) {
    console.error(e);
    return null;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = (filter: number): WebGLTexture => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const videoTexture = texture(gl.LINEAR);

  /** A tile-per-texel target, cleared (alpha 0: nothing in it yet). */
  const target = (w: number, h: number): Target => {
    const t = texture(gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture: t, fbo };
  };
  const free = (t: Target): void => {
    gl.deleteTexture(t.texture);
    gl.deleteFramebuffer(t.fbo);
  };

  // The emoji, made the first time they're wanted: their atlas (premultiplied, mipmapped) and their
  // colours and coverage, a texel each.
  let emoji: { atlas: WebGLTexture; glyphs: WebGLTexture; count: number; rows: number } | null = null;
  const loadEmoji = (): NonNullable<typeof emoji> => {
    if (emoji) return emoji;
    const m = measure();
    const count = Math.min(MAX_GLYPHS, m.glyphs.length);
    const rows = Math.ceil(count / ATLAS_COLUMNS);
    const sheet = document.createElement('canvas');
    sheet.width = ATLAS_COLUMNS * GLYPH;
    sheet.height = rows * GLYPH;
    const c = sheet.getContext('2d')!;
    for (let i = 0; i < count; i++)
      drawGlyph(c, m.glyphs[i], (i % ATLAS_COLUMNS) * GLYPH, Math.floor(i / ATLAS_COLUMNS) * GLYPH, GLYPH);
    const atlas = texture(gl.LINEAR_MIPMAP_LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(m.rgb[i * 3 + k] * 255);
      data[i * 4 + 3] = Math.round(m.cover[i] * 255);
    }
    const glyphs = texture(gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    emoji = { atlas, glyphs, count, rows };
    return emoji;
  };

  // The Matrix's code, made the first time it's wanted: white glyphs, mirrored, in an atlas (premultiplied,
  // mipmapped), any this device can't draw left out.
  let code: { atlas: WebGLTexture; count: number; rows: number } | null = null;
  const loadCode = (): NonNullable<typeof code> => {
    if (code) return code;
    const probe = document.createElement('canvas');
    probe.width = probe.height = GLYPH;
    const pc = probe.getContext('2d', { willReadFrequently: true })!;
    const draw = (c: CanvasRenderingContext2D, glyph: string, x: number, y: number): void => {
      c.save();
      c.translate(x + GLYPH / 2, y + GLYPH / 2);
      c.scale(-1, 1);
      c.font = `700 ${Math.round(GLYPH * 0.88)}px ${CODE_FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#ffffff';
      c.fillText(glyph, 0, GLYPH * 0.04);
      c.restore();
    };
    const glyphs = CODE.filter((ch) => {
      pc.clearRect(0, 0, GLYPH, GLYPH);
      draw(pc, ch, 0, 0);
      const d = pc.getImageData(0, 0, GLYPH, GLYPH).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) ink += d[i];
      return ink > 255 * 20;
    });
    const count = glyphs.length;
    const rows = Math.ceil(count / ATLAS_COLUMNS);
    const sheet = document.createElement('canvas');
    sheet.width = ATLAS_COLUMNS * GLYPH;
    sheet.height = rows * GLYPH;
    const c = sheet.getContext('2d')!;
    glyphs.forEach((ch, i) =>
      draw(c, ch, (i % ATLAS_COLUMNS) * GLYPH, Math.floor(i / ATLAS_COLUMNS) * GLYPH),
    );
    const atlas = texture(gl.LINEAR_MIPMAP_LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    code = { atlas, count, rows };
    return code;
  };

  const uniforms = (p: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> =>
    Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const common = ['uVideo', 'uCrop', 'uScreen', 'uMirror', 'uTile', 'uOffset'];
  const uc = uniforms(cellsProgram, [...common, 'uPrev', 'uKeep']);
  const up = uniforms(pickProgram, [
    'uCells',
    'uPrevPick',
    'uGlyphs',
    'uCount',
    'uBacking',
    'uNear',
    'uFresh',
  ]);
  const us = uniforms(screenProgram, [
    ...common,
    'uMode',
    'uCells',
    'uPick',
    'uAtlas',
    'uBacking',
    'uColumns',
    'uGlyph',
    'uLod',
    'uTime',
    'uGrid',
    'uCode',
    'uCodeCount',
    'uCodeGlyph',
    'uVapourScreen',
  ]);
  const flow = ['uCells', 'uScreen', 'uTile', 'uOffset', 'uGrid', 'uTime'];
  const uv = uniforms(vapourProgram, [...flow, 'uVapour', 'uSize', 'uFade']);
  const ux = uniforms(particleProgram, flow);

  let width = 1;
  let height = 1;
  // Each pass's two targets: the one last drawn, and the one to draw next (from it).
  let cells: [Target, Target] | null = null;
  let picks: [Target, Target] | null = null;
  let grid: Grid | null = null;
  let tileOfGrid = 0;
  let cellsValid = false;
  let picksValid = false;
  let hasFrame = false;
  // The vapour's two layers (half the screen's size), and whether they hold this go's (or an old one's).
  let vapour: [Target, Target] | null = null;
  let vapourSize = [0, 0];
  let lastLook: Look | null = null;

  const bind = (unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null): void => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(loc, unit);
  };
  const setCommon = (
    u: Record<string, WebGLUniformLocation | null>,
    video: HTMLVideoElement,
    view: View,
    g: Grid,
  ): void => {
    const c = cover(video.videoWidth, video.videoHeight, width, height);
    bind(0, videoTexture, u.uVideo);
    gl.uniform4f(u.uCrop, c.x, c.y, c.w, c.h);
    gl.uniform2f(u.uScreen, width, height);
    gl.uniform1i(u.uMirror, view.mirror ? 1 : 0);
    gl.uniform1f(u.uTile, view.tile);
    gl.uniform2f(u.uOffset, g.offsetX, g.offsetY);
  };

  /** What the vapour and the particles share: the tiles, where they are, and the time. */
  const setFlow = (u: Record<string, WebGLUniformLocation | null>, view: View, g: Grid): void => {
    bind(0, cells![0].texture, u.uCells);
    gl.uniform2f(u.uScreen, width, height);
    gl.uniform1f(u.uTile, view.tile);
    gl.uniform2f(u.uOffset, g.offsetX, g.offsetY);
    gl.uniform2f(u.uGrid, g.across, g.down);
    gl.uniform1f(u.uTime, view.time);
  };

  return {
    resize: (w, h) => {
      width = canvas.width = Math.max(1, Math.round(w));
      height = canvas.height = Math.max(1, Math.round(h));
    },

    draw: (video, view, newFrame) => {
      if (newFrame && video.readyState >= video.HAVE_CURRENT_DATA) {
        gl.bindTexture(gl.TEXTURE_2D, videoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
        hasFrame = true;
      }
      if (!hasFrame) return;
      const asEmoji = view.look === 'emoji';
      const original = view.tile <= 1 && view.look === 'pixel';
      const tile = Math.max(1, view.tile);
      const g = gridOf(width, height, tile);
      // A new grid: new targets, nothing in them to carry on from.
      if (!grid || g.across !== grid.across || g.down !== grid.down || tile !== tileOfGrid) {
        cells?.forEach(free);
        picks?.forEach(free);
        cells = [target(g.across, g.down), target(g.across, g.down)];
        picks = [target(g.across, g.down), target(g.across, g.down)];
        cellsValid = picksValid = false;
      }
      grid = g;
      tileOfGrid = tile;

      if (original) {
        cellsValid = picksValid = false;
      } else {
        let cellsChanged = false;
        if (newFrame || !cellsValid) {
          const [last, next] = cells!;
          gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
          gl.viewport(0, 0, g.across, g.down);
          gl.useProgram(cellsProgram);
          setCommon(uc, video, view, g);
          bind(1, last.texture, uc.uPrev);
          gl.uniform1f(uc.uKeep, cellsValid ? STEADY : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          cells = [next, last];
          cellsValid = cellsChanged = true;
        }
        if (!asEmoji) picksValid = false;
        else if (cellsChanged || !picksValid) {
          const e = loadEmoji();
          const [last, next] = picks!;
          gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
          gl.viewport(0, 0, g.across, g.down);
          gl.useProgram(pickProgram);
          bind(0, cells![0].texture, up.uCells);
          bind(1, last.texture, up.uPrevPick);
          bind(2, e.glyphs, up.uGlyphs);
          gl.uniform1i(up.uCount, e.count);
          gl.uniform1f(up.uBacking, BACKING);
          gl.uniform1f(up.uNear, NEAR_ENOUGH);
          gl.uniform1i(up.uFresh, picksValid ? 0 : 1);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          picks = [next, last];
          picksValid = true;
        }
      }

      const asParticles = view.look === 'particles';
      const withVapour = asParticles || view.look === 'ghost';
      if (withVapour) {
        const w = Math.ceil(width / 2);
        const h = Math.ceil(height / 2);
        // Coming to this look (or a new screen): fresh vapour.
        if (!vapour || vapourSize[0] !== w || vapourSize[1] !== h || lastLook !== view.look) {
          vapour?.forEach(free);
          vapour = [target(w, h), target(w, h)];
          for (const t of vapour) {
            gl.bindTexture(gl.TEXTURE_2D, t.texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          }
          vapourSize = [w, h];
        }
        const [last, next] = vapour;
        gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(vapourProgram);
        setFlow(uv, view, g);
        bind(1, last.texture, uv.uVapour);
        gl.uniform2f(uv.uSize, w, h);
        // (How much stays each frame: a ghost lingers.)
        gl.uniform1f(uv.uFade, view.look === 'ghost' ? 0.978 : 0.955);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        vapour = [next, last];
      }
      lastLook = view.look;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(screenProgram);
      setCommon(us, video, view, g);
      bind(1, cells![0].texture, us.uCells);
      bind(2, picks![0].texture, us.uPick);
      const lod = Math.max(0, Math.log2(GLYPH / tile));
      gl.uniform1i(us.uColumns, ATLAS_COLUMNS);
      gl.uniform1f(us.uLod, lod);
      if (view.look === 'matrix') {
        const m = loadCode();
        bind(4, m.atlas, us.uCode);
        gl.uniform1i(us.uCodeCount, m.count);
        gl.uniform2f(us.uCodeGlyph, 1 / ATLAS_COLUMNS, 1 / m.rows);
        gl.uniform1f(us.uTime, view.time);
        gl.uniform2f(us.uGrid, g.across, g.down);
      }
      if (asEmoji) {
        const e = loadEmoji();
        bind(3, e.atlas, us.uAtlas);
        gl.uniform2f(us.uGlyph, 1 / ATLAS_COLUMNS, 1 / e.rows);
      }
      gl.uniform1f(us.uBacking, BACKING);
      if (withVapour) bind(5, vapour![0].texture, us.uVapourScreen);
      gl.uniform1f(us.uTime, view.time);
      const modes: Record<Look, number> = {
        pixel: 1,
        emoji: 2,
        matrix: 3,
        particles: 4,
        ghost: 6,
      };
      gl.uniform1i(us.uMode, original ? 0 : modes[view.look]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // The particles, over their vapour, adding light.
      if (asParticles) {
        gl.useProgram(particleProgram);
        setFlow(ux, view, g);
        gl.disableVertexAttribArray(0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, g.across * g.down);
        gl.disable(gl.BLEND);
        gl.enableVertexAttribArray(0);
      }
    },
  };
}
