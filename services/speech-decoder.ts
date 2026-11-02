import type { MPEGDecoder } from 'mpg123-decoder';
import { withAbort } from '@/lib/abort';
let modulePromise: Promise<typeof import('mpg123-decoder')> | undefined;
const load = () => modulePromise ??= import('mpg123-decoder').catch(error => { modulePromise = undefined; throw error; });
/** Fetch only our own lazy bundle while microphone permission/the greeting is in progress. */
export function warmSpeechDecoder() { void load().catch(() => {}); }
/** Unsupported/blocked WASM falls back to native complete-MP3 decoding, using the same response. */
export async function createSpeechDecoder(signal: AbortSignal): Promise<MPEGDecoder | null> {
  let decoder: MPEGDecoder | undefined;
  try {
    const module = await withAbort(load(), signal); signal.throwIfAborted();
    decoder = new module.MPEGDecoder();
    await withAbort(decoder.ready, signal); signal.throwIfAborted();
    return decoder;
  } catch (error) {
    if (decoder) { const allocated = decoder; void allocated.ready.then(() => allocated.free()).catch(() => {}); }
    signal.throwIfAborted(); return null;
  }
}
