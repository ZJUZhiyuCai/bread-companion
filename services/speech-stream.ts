/** Bounded PCM stream. Completion is explicit; a cut-off connection is never success. */
export class PcmSpeech implements AsyncIterable<Uint8Array> {
  readonly kind = 'pcm-s16le' as const;
  readonly sampleRate = 32000;
  private queue: Uint8Array[] = [];
  private total = 0;
  private closed = false;
  private error: unknown;
  private wake: (() => void) | undefined;
  push(bytes: Uint8Array) {
    if (this.closed || this.error || !bytes.length || bytes.length % 2 || (this.total += bytes.length) > 4 * 1024 * 1024) throw new Error('声音数据没有完整接上。');
    this.queue.push(bytes); this.wake?.(); this.wake = undefined;
  }
  end() { this.closed = true; this.wake?.(); this.wake = undefined; }
  fail(error: unknown) { this.error = error; this.queue = []; this.wake?.(); this.wake = undefined; }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.error) throw this.error;
      const next = this.queue.shift();
      if (next) { yield next; continue; }
      if (this.closed) return;
      await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}
export type CallSpeech = Blob | PcmSpeech;
