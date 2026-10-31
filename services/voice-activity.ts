/** Local energy gate. It detects speech-like sound/pauses, never emotions or identity. */
export class VoiceActivity {
  private pre: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private duration = 0;
  private voiced = 0;
  private silence = 0;
  private floor = 0.002;
  private started = false;
  private announced = false;
  constructor(readonly sampleRate: number, private gapSeconds = 0.85, private maxSeconds = 55) {}
  reset() { this.pre = []; this.frames = []; this.duration = this.voiced = this.silence = 0; this.started = this.announced = false; }
  push(frame: Float32Array, allowVoice = true): { level: number; heardSpeech: boolean; speechStarted: boolean; utterance: Float32Array | null } {
    const dt = frame.length / this.sampleRate;
    const rms = Math.sqrt(frame.reduce((n, v) => n + v * v, 0) / Math.max(1, frame.length));
    const threshold = Math.max(0.009, Math.min(0.04, this.floor * 3));
    const loud = allowVoice && rms > threshold;
    if (!this.started && !loud && allowVoice) this.floor = this.floor * 0.97 + rms * 0.03;
    if (!this.started) {
      this.pre.push(frame.slice());
      while (this.pre.reduce((n, f) => n + f.length, 0) > this.sampleRate * 0.28 && this.pre.length > 1) this.pre.shift();
      if (loud) { this.started = true; this.frames = this.pre; this.pre = []; this.duration = this.frames.reduce((n, f) => n + f.length, 0) / this.sampleRate; this.voiced = dt; }
    } else {
      this.frames.push(frame.slice()); this.duration += dt;
      if (loud) { this.voiced += dt; this.silence = 0; } else this.silence += dt;
    }
    const heardSpeech = this.started && this.voiced >= 0.16;
    const speechStarted = heardSpeech && !this.announced;
    if (speechStarted) this.announced = true;
    const utterance = this.started && (this.silence >= this.gapSeconds || this.duration >= this.maxSeconds) ? this.finish() : null;
    return { level: Math.min(1, rms * 8), heardSpeech, speechStarted, utterance };
  }
  finish(): Float32Array | null {
    let out: Float32Array | null = null;
    if (this.voiced >= 0.16) {
      const length = this.frames.reduce((n, f) => n + f.length, 0);
      // Keep final consonants without uploading the whole end-of-turn silence.
      const trim = Math.floor(Math.max(0, this.silence - 0.2) * this.sampleRate);
      out = new Float32Array(Math.max(0, length - trim)); let offset = 0;
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
