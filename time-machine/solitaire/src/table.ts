// Time Machine — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import type { Box } from './booth';
import { cover } from './fit';
import { deal, PILES, step, type Card } from './solitaire';

/**
 * The screen, on the GPU (WebGL2). First the booth: the camera, covering it. Then the table: green felt,
 * and on it, the card in play, drawn where it is every frame and never cleared, so it leaves a trail of
 * itself. Every card's the photo taken in the booth, its corners rounded, edged in grey, turning a little.
 */
export interface Table {
  resize(width: number, height: number): void;
  /** The booth: the camera, covering the screen. `newFrame` when the video has a frame not yet drawn. */
  live(video: HTMLVideoElement, mirror: boolean, newFrame: boolean): void;
  /** The photo every card's to be. */
  setPhoto(photo: HTMLCanvasElement): void;
  /** Bare felt, and the first card, dealt (where it starts from). */
  clear(time: number): Card;
  /** The table, the photo over it at `box` (screen px), turned `angle` (not left on the table). */
  fly(box: Box, angle: number): void;
  /** The cards move on (to `time`, seconds), and are drawn, leaving their trails. */
  play(time: number): void;
}

/** The felt: Solitaire's own green. */
const FELT: [number, number, number] = [0, 0.5, 0];

const QUAD_VERTEX = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

// A card: its box on the screen (px from the top left), turned about its middle; and where in it a point
// is (0–1 from its top left).
const CARD_VERTEX = `#version 300 es
in vec2 a;
uniform vec4 uBox;
uniform float uAngle;
uniform vec2 uScreen;
out vec2 vAt;
void main() {
  vAt = vec2(a.x * 0.5 + 0.5, 0.5 - a.y * 0.5);
  vec2 off = (vAt - 0.5) * uBox.zw;
  float c = cos(uAngle), s = sin(uAngle);
  vec2 p = uBox.xy + 0.5 * uBox.zw + vec2(c * off.x - s * off.y, s * off.x + c * off.y);
  gl_Position = vec4(p.x / uScreen.x * 2.0 - 1.0, 1.0 - p.y / uScreen.y * 2.0, 0.0, 1.0);
}
`;
// Its face: the photo, the corners rounded, edged in grey.
const CARD = `#version 300 es
precision highp float;
uniform sampler2D uPhoto;
uniform vec4 uBox;
in vec2 vAt;
out vec4 o;
void main() {
  vec2 size = uBox.zw;
  vec2 q = vAt * size;
  float r = 0.07 * size.x;
  vec2 corner = max(vec2(r) - q, q - (size - r));
  bool inCorner = corner.x > 0.0 && corner.y > 0.0;
  if (inCorner && length(corner) > r) discard;
  float edge = inCorner ? r - length(corner) : min(min(q.x, q.y), min(size.x - q.x, size.y - q.y));
  o = edge < 1.5 ? vec4(0.2, 0.2, 0.2, 1.0) : vec4(texture(uPhoto, vAt).rgb, 1.0);
}
`;
// The camera, covering the screen, mirrored or not.
const LIVE = `#version 300 es
precision highp float;
uniform sampler2D uVideo;
uniform vec4 uCrop;
uniform bool uMirror;
uniform vec2 uScreen;
out vec4 o;
void main() {
  vec2 s = vec2(gl_FragCoord.x / uScreen.x, 1.0 - gl_FragCoord.y / uScreen.y);
  if (uMirror) s.x = 1.0 - s.x;
  o = vec4(texture(uVideo, uCrop.xy + s * uCrop.zw).rgb, 1.0);
}
`;
// The table, onto the screen.
const SHOW = `#version 300 es
precision highp float;
uniform sampler2D uTable;
uniform vec2 uScreen;
out vec4 o;
void main() { o = vec4(texture(uTable, gl_FragCoord.xy / uScreen).rgb, 1.0); }
`;

/** Draws on `canvas`, or null where WebGL2 isn't to be had. */
export function createTable(canvas: HTMLCanvasElement): Table | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl) return null;

  const compile = (type: number, text: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const program = (frag: string, vertex = QUAD_VERTEX): WebGLProgram => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
    return p;
  };
  let cardProgram: WebGLProgram;
  let liveProgram: WebGLProgram;
  let showProgram: WebGLProgram;
  try {
    cardProgram = program(CARD, CARD_VERTEX);
    liveProgram = program(LIVE);
    showProgram = program(SHOW);
  } catch (e) {
    console.error(e);
    return null;
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const videoTexture = texture();
  const photoTexture = texture();

  const uniforms = (p: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> =>
    Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const uc = uniforms(cardProgram, ['uPhoto', 'uBox', 'uAngle', 'uScreen']);
  const ul = uniforms(liveProgram, ['uVideo', 'uCrop', 'uMirror', 'uScreen']);
  const us = uniforms(showProgram, ['uTable', 'uScreen']);

  let width = 1;
  let height = 1;
  // The table (the screen's size, never cleared while it's played on), the card in play, the pile the next
  // comes off, and when it last moved.
  let table: { texture: WebGLTexture; fbo: WebGLFramebuffer } | null = null;
  let card: Card | null = null;
  let pile = 0;
  let lastMove = 0;
  let hasFrame = false;

  const bind = (t: WebGLTexture, loc: WebGLUniformLocation | null): void => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(loc, 0);
  };
  /** The photo, at `box`, turned `angle`, onto whatever's bound to draw on. */
  const drawCard = (box: Box, angle: number): void => {
    gl.useProgram(cardProgram);
    bind(photoTexture, uc.uPhoto);
    gl.uniform4f(uc.uBox, box.x, box.y, box.w, box.h);
    gl.uniform1f(uc.uAngle, angle);
    gl.uniform2f(uc.uScreen, width, height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  /** The table, onto the screen. */
  const showTable = (): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(showProgram);
    bind(table!.texture, us.uTable);
    gl.uniform2f(us.uScreen, width, height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  return {
    resize: (w, h) => {
      width = canvas.width = Math.max(1, Math.round(w));
      height = canvas.height = Math.max(1, Math.round(h));
    },

    live: (video, mirror, newFrame) => {
      if (newFrame && video.readyState >= video.HAVE_CURRENT_DATA) {
        gl.bindTexture(gl.TEXTURE_2D, videoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
        hasFrame = true;
      }
      if (!hasFrame) return;
      const c = cover(video.videoWidth, video.videoHeight, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(liveProgram);
      bind(videoTexture, ul.uVideo);
      gl.uniform4f(ul.uCrop, c.x, c.y, c.w, c.h);
      gl.uniform1i(ul.uMirror, mirror ? 1 : 0);
      gl.uniform2f(ul.uScreen, width, height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    setPhoto: (photo) => {
      gl.bindTexture(gl.TEXTURE_2D, photoTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, photo);
    },

    clear: (time) => {
      if (table) {
        gl.deleteTexture(table.texture);
        gl.deleteFramebuffer(table.fbo);
      }
      const t = texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(...FELT, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      table = { texture: t, fbo };
      card = deal(width, height, 0);
      pile = 1;
      lastMove = time;
      return { ...card };
    },

    fly: (box, angle) => {
      if (!table) return;
      showTable();
      drawCard(box, angle);
    },

    play: (time) => {
      if (!table) return;
      // The card moves on (or, gone off a side, the next is dealt), and is drawn where it is now.
      const dt = Math.min(0.05, Math.max(0, time - lastMove));
      lastMove = time;
      if (!card || !step(card, dt, width, height)) {
        card = deal(width, height, pile);
        pile = (pile + 1) % PILES;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, table.fbo);
      gl.viewport(0, 0, width, height);
      drawCard(card, card.angle);
      showTable();
    },
  };
}
