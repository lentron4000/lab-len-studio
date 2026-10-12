// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { nowSeconds } from '../lib/math';
import { load, save, StorageKey } from '../lib/storage';
import { ONSET_PROCESSOR, OnsetCore, type OnsetFrame } from './onset-core';
import workletSource from './onset-worklet.ts?worklet';
import type { SourceMode, Transport } from './transport';

export const DEMO_BPM = 100;

/** Live input is analysed only, never monitored, so it can't feed back. Assumed capture latency: */
const INPUT_LATENCY = 0.012;

export interface AudioDevice {
  id: string;
  label: string;
}

export interface FileState {
  message: string;
  canPlay: boolean;
  playing: boolean;
}

/** How the engine reports back to the UI. */
export interface AudioEngineListener {
  fileState(state: FileState): void;
  liveStatus(message: string): void;
  devices(list: AudioDevice[], current: string): void;
  /** Entering file mode with nothing loaded: open the file picker. */
  requestFile(): void;
}

/**
 * Owns the AudioContext and the three sources: a synthesised demo kick, a looping audio file
 * and live input. File and live audio run through the onset worklet into the Transport.
 */
export class AudioEngine {
  mode: SourceMode = 'off';
  /** Input peak level in dBFS, with a 1.5 dB-per-frame fall. */
  levelDb = -100;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analysis: AudioNode | null = null;
  private clickBuffer: AudioBuffer | null = null;

  private demoTimer = 0;
  private nextKick = 0;

  private fileBuffer: AudioBuffer | null = null;
  private fileSource: AudioBufferSourceNode | null = null;
  private fileStartedAt = 0;
  private fileOffset = 0;
  private playing = false;

  private stream: MediaStream | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly listener: AudioEngineListener,
  ) {
    // mediaDevices is undefined on insecure origins, whatever the DOM types say.
    if ('mediaDevices' in navigator) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        if (this.mode === 'live') void this.listDevices(this.currentDeviceId());
      });
    }
  }

  async setMode(mode: SourceMode): Promise<void> {
    this.mode = mode;
    this.stopDemo();
    this.pauseFile();
    this.stopLive();
    this.transport.reset();
    if (mode === 'demo') this.startDemo();
    if (mode === 'file') {
      if (this.fileBuffer) await this.playFile();
      else this.listener.requestFile();
    }
    if (mode === 'live') await this.startLive(load(StorageKey.AudioInput) ?? '');
  }

  async loadFile(file: File): Promise<void> {
    const ctx = this.context();
    this.pauseFile();
    this.listener.fileState({ message: `Decoding ${file.name}…`, canPlay: false, playing: false });
    try {
      this.fileBuffer = await ctx.decodeAudioData(await file.arrayBuffer());
      this.fileOffset = 0;
      this.transport.reset();
      this.listener.fileState({ message: file.name, canPlay: true, playing: false });
      if (this.mode === 'file') await this.playFile();
    } catch {
      this.fileBuffer = null;
      this.listener.fileState({
        message: 'Couldn’t decode that file. Try an MP3 or WAV.',
        canPlay: false,
        playing: false,
      });
    }
  }

  async togglePlay(): Promise<void> {
    if (this.playing) this.pauseFile();
    else await this.playFile();
  }

  async selectDevice(id: string): Promise<void> {
    save(StorageKey.AudioInput, id);
    await this.startLive(id);
  }

  // ---------------------------------------------------------------- context and analysis

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Onset analysis in an AudioWorklet; ScriptProcessor where worklets are unavailable (insecure origins). */
  private async analysisNode(): Promise<AudioNode> {
    const ctx = this.context();
    if (this.analysis) return this.analysis;
    const sampleRate = ctx.sampleRate;
    const sink = ctx.createGain(); // a silent path to the destination keeps the node pulled
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    let node: AudioNode;
    try {
      const url = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const worklet = new AudioWorkletNode(ctx, ONSET_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      worklet.port.onmessage = (e: MessageEvent<OnsetFrame[]>) => {
        this.onFrames(e.data);
      };
      node = worklet;
    } catch {
      node = this.scriptProcessorFallback(ctx, sampleRate);
    }
    node.connect(sink);
    this.analysis = node;
    this.transport.reset(sampleRate / Math.round(sampleRate / 100));
    return node;
  }

  private scriptProcessorFallback(ctx: AudioContext, sampleRate: number): AudioNode {
    const core = new OnsetCore(sampleRate);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- fallback for origins without AudioWorklet
    const processor = ctx.createScriptProcessor(1024, 2, 1);
    let mono = new Float32Array(1024);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const input = e.inputBuffer;
      if (mono.length !== input.length) mono = new Float32Array(input.length);
      mono.fill(0);
      for (let c = 0; c < input.numberOfChannels; c++) {
        const data = input.getChannelData(c);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / input.numberOfChannels;
      }
      const frames: OnsetFrame[] = [];
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      core.process(mono, Math.round(e.playbackTime * sampleRate), frames);
      this.onFrames(frames);
    };
    return processor;
  }

  /**
   * Frames are timed on the audio clock. File audio is heard after the output latency
   * (getOutputTimestamp maps that exactly); live audio was heard just before it was captured.
   */
  private onFrames(frames: OnsetFrame[]): void {
    const ctx = this.ctx;
    const last = frames.at(-1);
    if (!ctx || !last || (this.mode !== 'file' && this.mode !== 'live')) return;
    let heardAt: number;
    if (this.mode === 'live') {
      heardAt = nowSeconds() - (ctx.currentTime - last.t) - INPUT_LATENCY;
    } else {
      const ts = ctx.getOutputTimestamp();
      heardAt =
        ts.performanceTime !== undefined && ts.contextTime !== undefined && ts.performanceTime > 0
          ? ts.performanceTime / 1000 + (last.t - ts.contextTime)
          : nowSeconds() - (ctx.currentTime - last.t) + ctx.outputLatency + ctx.baseLatency;
    }
    this.transport.pushFrames(frames, heardAt);
    for (const f of frames) this.levelDb = Math.max(f.level, this.levelDb - 1.5);
  }

  // ---------------------------------------------------------------- demo kick

  private startDemo(): void {
    const ctx = this.context();
    this.nextKick = ctx.currentTime + 0.06;
    this.scheduleDemo();
    this.demoTimer = window.setInterval(() => {
      this.scheduleDemo();
    }, 25);
    const latency = ctx.outputLatency + ctx.baseLatency;
    this.transport.setFixedTempo(DEMO_BPM, nowSeconds() + 0.06 + latency);
  }

  private stopDemo(): void {
    window.clearInterval(this.demoTimer);
    this.demoTimer = 0;
  }

  /** Look-ahead scheduler: queues kicks up to 120 ms ahead on the audio clock. */
  private scheduleDemo(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextKick < ctx.currentTime + 0.12) {
      this.synthKick(this.nextKick);
      this.nextKick += 60 / DEMO_BPM;
    }
  }

  /** Sine kick with a pitch drop (165 → 46 Hz) plus a short noise click for the beater. */
  private synthKick(t: number): void {
    const ctx = this.ctx!;
    const master = this.master!;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.setValueAtTime(165, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.95, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + 0.5);

    if (!this.clickBuffer) {
      const len = Math.round(ctx.sampleRate * 0.012);
      this.clickBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.clickBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const click = ctx.createBufferSource();
    const clickGain = ctx.createGain();
    click.buffer = this.clickBuffer;
    clickGain.gain.value = 0.18;
    click.connect(clickGain).connect(master);
    click.start(t);
  }

  // ---------------------------------------------------------------- file

  private async playFile(): Promise<void> {
    if (!this.fileBuffer) return;
    const node = await this.analysisNode();
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.fileBuffer;
    src.loop = true;
    src.connect(this.master!);
    src.connect(node);
    src.start(0, this.fileOffset % this.fileBuffer.duration);
    this.fileSource = src;
    this.fileStartedAt = ctx.currentTime - this.fileOffset;
    this.playing = true;
    this.listener.fileState({ message: '', canPlay: true, playing: true });
  }

  private pauseFile(): void {
    if (this.fileSource) {
      this.fileSource.stop();
      this.fileSource.disconnect();
      this.fileSource = null;
    }
    if (this.playing && this.fileBuffer && this.ctx) {
      this.fileOffset = (this.ctx.currentTime - this.fileStartedAt) % this.fileBuffer.duration;
    }
    if (this.playing) this.listener.fileState({ message: '', canPlay: true, playing: false });
    this.playing = false;
  }

  // ---------------------------------------------------------------- live input

  private async startLive(deviceId: string): Promise<void> {
    this.stopLive();
    if (!('mediaDevices' in navigator)) {
      this.listener.liveStatus('This browser can’t capture audio. Use Chrome or Edge.');
      return;
    }
    const node = await this.analysisNode();
    this.listener.liveStatus('Asking for audio input…');
    let stream: MediaStream;
    try {
      stream = await openInput(deviceId).catch((err: unknown) => {
        // A remembered device that's gone: fall back to the default input.
        if (deviceId && err instanceof DOMException && err.name === 'OverconstrainedError')
          return openInput('');
        throw err;
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : 'Error';
      this.listener.liveStatus(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Audio input is blocked here. Open the local copy in Chrome or Edge and allow access.'
          : `Couldn’t open that input (${name}).`,
      );
      return;
    }
    if (this.mode !== 'live') {
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      return;
    }
    this.stream = stream;
    this.streamSource = this.ctx!.createMediaStreamSource(stream);
    this.streamSource.connect(node);
    const track = stream.getAudioTracks()[0];
    const current = track.getSettings().deviceId ?? '';
    if (current) save(StorageKey.AudioInput, current);
    this.listener.liveStatus(`Listening to ${track.label || 'input'}`);
    this.transport.reset();
    await this.listDevices(current);
  }

  private stopLive(): void {
    this.streamSource?.disconnect();
    this.streamSource = null;
    this.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.stream = null;
  }

  private currentDeviceId(): string {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? '';
  }

  private async listDevices(current: string): Promise<void> {
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      this.listener.devices(
        inputs.map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` })),
        current,
      );
    } catch {
      // Device listing is optional: the current input keeps working.
    }
  }
}

/** Raw input: browser voice processing (echo cancellation, noise suppression, AGC) would wreck music. */
function openInput(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
  });
}
