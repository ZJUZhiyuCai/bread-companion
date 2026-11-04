/** Optional, local-only compression. A cold/unsupported/slow encoder never blocks a call. */
export class SpeechUpload {
  private worker: Worker | null = null;
  private ready = false;
  private disabled = false;
  private sequence = 0;
  private pending: { id: number; settle: (bytes?: ArrayBuffer) => void } | null = null;
  constructor(private createWorker = () => new Worker(new URL('./speech-upload.worker.ts', import.meta.url), { type: 'module' })) {}

  warm() {
    if (this.worker || this.disabled || typeof Worker === 'undefined') return;
    try {
      const worker = this.createWorker(); this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        if (data?.type === 'ready') this.ready = true;
        else if (data?.type === 'unsupported') this.stop(true);
        else if (data?.id === this.pending?.id) this.pending?.settle(data.bytes instanceof ArrayBuffer ? data.bytes : undefined);
      };
      worker.onerror = () => this.stop(true);
      worker.onmessageerror = () => this.stop(true);
    } catch { this.stop(true); }
  }

  async encode(file: File, signal: AbortSignal): Promise<File> {
    signal.throwIfAborted();
    // Already listening while the worker loads; don't wait for another network fetch to upload speech.
    this.warm();
    if (!this.worker || !this.ready || this.pending || file.size < 8192 || file.size > 44 + 65 * 32000) return file;
    const worker = this.worker, wav = await file.arrayBuffer(); signal.throwIfAborted();
    if (this.worker !== worker || this.pending) return file;
    const bytes = await new Promise<ArrayBuffer | undefined>(resolve => {
      const id = ++this.sequence;
      const settle = (value?: ArrayBuffer) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (this.pending?.id === id) this.pending = null;
        resolve(value);
      };
      const abort = () => this.stop();
      // Terminating the worker actually cancels encoding, even if the codec's flush hangs.
      const timer = setTimeout(() => this.stop(true), 250);
      this.pending = { id, settle };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      try { worker.postMessage({ id, wav }, [wav]); } catch { this.stop(true); }
    });
    signal.throwIfAborted();
    // Keep the original locally, and send only one format / one request. No network retry to switch codecs.
    return bytes && bytes.byteLength > 47 && bytes.byteLength < file.size * .8
      ? new File([bytes], 'speech.ogg', { type: 'audio/ogg' }) : file;
  }

  stop(disable = false) {
    this.worker?.terminate(); this.worker = null; this.ready = false;
    if (disable) this.disabled = true;
    this.pending?.settle();
  }
}
