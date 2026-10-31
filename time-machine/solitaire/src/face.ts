// Time Machine — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import wasmBinaryPath from '../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url';
import wasmLoaderPath from '../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url';
import type { Box } from './booth';

/**
 * Finding a face in the video: MediaPipe's face detector (BlazeFace, short range), run here, in the page,
 * on the GPU where it can be. Its runtime and model are served with the page; nothing's sent anywhere.
 */
export interface FaceFinder {
  /** The most likely face in the video's current frame (its box, video px), if there is one. */
  find(video: HTMLVideoElement, time: number): Box | null;
}

const MODEL = `${import.meta.env.BASE_URL}models/blaze_face_short_range.tflite`;

/** A face finder, or null where one can't be made (no WebAssembly, or the model didn't load). */
export async function createFaceFinder(): Promise<FaceFinder | null> {
  try {
    const { FaceDetector } = await import('@mediapipe/tasks-vision');
    const make = (delegate: 'GPU' | 'CPU') =>
      FaceDetector.createFromOptions(
        { wasmLoaderPath, wasmBinaryPath },
        {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.6,
        },
      );
    const detector = await make('GPU').catch(() => make('CPU'));
    let last = -1;
    return {
      find: (video, time) => {
        // (Its times must only go forward.)
        const t = Math.max(last + 1, Math.round(time));
        last = t;
        const best = detector
          .detectForVideo(video, t)
          .detections.filter((d) => d.boundingBox)
          .sort((a, b) => (b.categories[0]?.score ?? 0) - (a.categories[0]?.score ?? 0))[0];
        const b = best?.boundingBox;
        return b ? { x: b.originX, y: b.originY, w: b.width, h: b.height } : null;
      },
    };
  } catch (e) {
    console.warn('Time Machine: no face finder', e);
    return null;
  }
}
