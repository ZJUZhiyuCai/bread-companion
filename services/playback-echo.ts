/** A supplement to browser AEC, not a replacement for an acoustic echo canceller. */
export class PlaybackEchoGuard {
  private reference: { pcm: Float32Array; rate: number; start: number; stop: number } | null = null;
  attach(pcm: Float32Array, rate: number, start: number) { this.reference = { pcm, rate, start, stop: start + pcm.length / rate }; }
  stop(at: number) { if (this.reference) this.reference.stop = Math.min(this.reference.stop, at); }
  clear() { this.reference = null; }
  isEcho(frame: Float32Array, frameAt: number): boolean {
    const ref = this.reference;
    if (!ref || !Number.isFinite(frameAt)) return false;
    if (frameAt > ref.stop + .35) { this.clear(); return false; }
    const stride = Math.max(1, Math.floor(ref.rate / 6000));
    let power = 0, count = 0;
    for (let i = 0; i < frame.length; i += stride) { power += frame[i] ** 2; count++; }
    if (power / count < .000025) return false;
    const position = Math.round((frameAt - ref.start) * ref.rate);
    const last = Math.min(ref.pcm.length, Math.round((ref.stop - ref.start) * ref.rate));
    const score = (lag: number) => {
      const at = position - lag;
      if (at < 0 || at + frame.length > last) return 0;
      let dot = 0, referencePower = 0;
      for (let i = 0; i < frame.length; i += stride) { const r = ref.pcm[at + i]; dot += frame[i] * r; referencePower += r * r; }
      return referencePower > 1e-9 ? Math.min(1, Math.abs(dot) / Math.sqrt(power * referencePower)) : 0;
    };
    const coarse = Math.max(1, Math.round(ref.rate * .004));
    let best = 0, lag = 0;
    for (let d = 0; d <= ref.rate * .32; d += coarse) { const s = score(d); if (s > best) { best = s; lag = d; } }
    for (let d = Math.max(0, lag - coarse); d <= lag + coarse; d += Math.max(1, Math.round(ref.rate / 24000))) best = Math.max(best, score(d));
    // Mixed near-end speech leaves a residual: don't suppress a quiet person just because echo is louder.
    const residual = Math.sqrt(Math.max(0, 1 - best * best) * power / count);
    return best > .85 && residual < .009;
  }
}

/** Reject DC/clicks/white hiss as interruption triggers; pre-roll still retains consonant onsets. */
export function speechLikeFrame(frame: Float32Array, minRms = .009): boolean {
  if (frame.length < 2) return false;
  let crossings = 0, power = 0, peak = 0;
  for (let i = 0; i < frame.length; i++) {
    const value = frame[i]; power += value * value; peak = Math.max(peak, Math.abs(value));
    if (i && ((value >= 0) !== (frame[i - 1] >= 0))) crossings++;
  }
  const rms = Math.sqrt(power / frame.length), rate = crossings / frame.length;
  return rms > minRms && rate > .003 && rate < .32 && peak > rms * 1.25;
}
