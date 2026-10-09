// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/**
 * AudioWorklet entry: runs OnsetCore on the audio thread and posts frames to the page in batches.
 * Bundled to a string by build/inline-worklet.ts and loaded through a Blob URL.
 */
import { ONSET_PROCESSOR, OnsetCore, type OnsetFrame } from './onset-core';

// AudioWorkletGlobalScope members (not part of the DOM lib).
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** Frames per message: 4 × 10 ms keeps message overhead low without adding noticeable latency. */
const BATCH = 4;

class OnsetProcessor extends AudioWorkletProcessor {
  private readonly core = new OnsetCore(sampleRate);
  private pending: OnsetFrame[] = [];
  private mono = new Float32Array(128);

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (channels.length > 0) {
      const n = channels[0].length;
      if (this.mono.length !== n) this.mono = new Float32Array(n);
      const mono = this.mono;
      mono.fill(0);
      for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
      this.core.process(mono, currentFrame, this.pending);
      if (this.pending.length >= BATCH) {
        this.port.postMessage(this.pending);
        this.pending = [];
      }
    }
    return true;
  }
}

registerProcessor(ONSET_PROCESSOR, OnsetProcessor);
