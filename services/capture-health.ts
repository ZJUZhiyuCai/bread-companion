/** Detect a stalled input graph separately from a person choosing not to speak. No audio is retained. */
export class CaptureHealth {
  private lastFrame = 0;
  private lastSignal = 0;
  private mutedSince: number | null = null;
  reset(now: number) { this.lastFrame = this.lastSignal = now; this.mutedSince = null; }
  frame(samples: Float32Array, now: number) {
    this.lastFrame = now;
    // Exact/nearly digital zero is different from quiet room noise. This is not a speech gate.
    if (samples.some(value => Math.abs(value) > 0.00001)) this.lastSignal = now;
  }
  check(now: number, muted: boolean): 'ok' | 'silent' | 'stalled' | 'muted' {
    if (!muted) this.mutedSince = null;
    else if (this.mutedSince === null) this.mutedSince = now;
    if (this.mutedSince !== null && now - this.mutedSince >= 2000) return 'muted';
    if (now - this.lastFrame >= 5000) return 'stalled';
    return now - this.lastSignal >= 8000 ? 'silent' : 'ok';
  }
}
