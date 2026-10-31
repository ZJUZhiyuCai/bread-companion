import { withAbort } from '@/lib/abort';

/** A stalled body or cancel hook cannot keep a request/concurrency slot alive. */
export async function readStream(body: ReadableStream<Uint8Array>, limit: number, signal: AbortSignal, tooLarge: () => Error): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
