import type { CallTurnProfile } from '@/domain/types';

interface VoiceActivityConfig { gapSeconds: number; maxSeconds: number; }

export const CALL_TURN_PROFILES = {
  chat: { gapSeconds: 0.65, maxSeconds: 55 },
  interview: { gapSeconds: 1.8, maxSeconds: 120 },
} satisfies Record<CallTurnProfile, VoiceActivityConfig>;

/** Local energy gate. It detects speech-like sound/pauses, never emotions or identity. */
export class VoiceActivity {
  private pre: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private capturedSamples = 0;
  private voicedSamples = 0;
  private silentSamples = 0;
  private floor = 0.0005;
  private started = false;
  private announced = false;
  constructor(readonly sampleRate: number, private gapSeconds = CALL_TURN_PROFILES.chat.gapSeconds, private maxSeconds = CALL_TURN_PROFILES.chat.maxSeconds) {}
  setConfig({ gapSeconds, maxSeconds }: VoiceActivityConfig) {
    this.gapSeconds = gapSeconds;
    this.maxSeconds = maxSeconds;
  }
  reset() { this.pre = []; this.frames = []; this.capturedSamples = this.voicedSamples = this.silentSamples = 0; this.started = this.announced = false; }
  push(frame: Float32Array, allowVoice = true): { level: number; heardSpeech: boolean; speechStarted: boolean; utterance: Float32Array | null } {
    const limit = Math.floor(this.sampleRate * this.maxSeconds);
    const rms = Math.sqrt(frame.reduce((n, v) => n + v * v, 0) / Math.max(1, frame.length));
    // Normal listening admits a quiet phone microphone; barge-in retains its stricter spectral gate.
    const threshold = Math.max(0.002, Math.min(0.025, this.floor * 3));
    const loud = allowVoice && rms > threshold;
    if (!this.started && !loud && allowVoice) this.floor = this.floor * 0.97 + rms * 0.03;
    if (!this.started) {
      const samples = frame.slice(0, limit);
      this.pre.push(samples);
      const preLimit = Math.min(this.sampleRate * 0.28, limit);
      while (this.pre.reduce((n, f) => n + f.length, 0) > preLimit && this.pre.length > 1) this.pre.shift();
      if (loud) {
        this.started = true; this.frames = this.pre; this.pre = [];
        this.capturedSamples = this.frames.reduce((n, f) => n + f.length, 0);
        this.voicedSamples = samples.length;
      }
    } else if (this.capturedSamples < limit) {
      const samples = frame.slice(0, limit - this.capturedSamples);
      this.frames.push(samples); this.capturedSamples += samples.length;
      if (loud) { this.voicedSamples += samples.length; this.silentSamples = 0; } else this.silentSamples += samples.length;
    }
    const heardSpeech = this.started && this.voicedSamples >= this.sampleRate * 0.16;
    const speechStarted = heardSpeech && !this.announced;
    if (speechStarted) this.announced = true;
    const utterance = this.started && (this.silentSamples >= this.gapSeconds * this.sampleRate || this.capturedSamples >= limit) ? this.finish() : null;
    return { level: Math.min(1, rms * 8), heardSpeech, speechStarted, utterance };
  }
  finish(): Float32Array | null {
    let out: Float32Array | null = null;
    if (this.voicedSamples >= this.sampleRate * 0.16) {
      // Keep final consonants without uploading the whole end-of-turn silence.
      const trim = Math.floor(Math.max(0, this.silentSamples - this.sampleRate * 0.2));
      out = new Float32Array(Math.max(0, this.capturedSamples - trim)); let offset = 0;
      for (const frame of this.frames) { const n = Math.min(frame.length, out.length - offset); if (n <= 0) break; out.set(frame.subarray(0, n), offset); offset += n; }
    }
    this.reset(); return out;
  }
}

export function resampleMono(input: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (fromRate === toRate) return input;
  const output = new Float32Array(Math.floor(input.length * toRate / fromRate));
  const ratio = fromRate / toRate;
  for (let i = 0; i < output.length; i++) {
    const start = i * ratio, end = Math.min(input.length, (i + 1) * ratio);
    let sum = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) sum += (input[j] ?? 0) * (Math.min(end, j + 1) - Math.max(start, j));
    output[i] = sum / (end - start);
  }
  return output;
}
