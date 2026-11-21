import { withAbort } from '@/lib/abort';
import { AppError } from '@/server/errors';

const invalid = () => new AppError('PROVIDER_UNAVAILABLE', 502, true);
const MAX_WIRE_BYTES = 512 * 1024;
const MAX_TEXT_BYTES = 160000;

function readDelta(data: string, eventName: string, anthropic: boolean): { text?: string; done?: boolean } {
  if (!anthropic && data === '[DONE]') return { done: true };
  let event;
  try { event = JSON.parse(data); } catch { throw invalid(); }
  if (!event || typeof event !== 'object' || event.error || eventName === 'error' || event.type === 'error') throw invalid();
  if (anthropic) {
    if (event.type === 'message_stop') return { done: true };
    if (event.type === 'message_delta') {
      const reason = event.delta?.stop_reason;
      if (reason && reason !== 'end_turn' && reason !== 'stop_sequence') throw invalid();
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') return { text: event.content_block.text };
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      if (typeof event.delta.text !== 'string') throw invalid();
      return { text: event.delta.text };
    }
    return {};
  }
  if (!Array.isArray(event.choices)) throw invalid();
  const choice = event.choices[0];
  const reason = choice?.finish_reason, text = choice?.delta?.content;
  if ((reason != null && reason !== 'stop') || (text != null && typeof text !== 'string')) throw invalid();
  return { text: text ?? undefined, done: reason === 'stop' };
}

/** A provider must send its completion marker. EOF alone cannot approve speech. */
export async function* readAgentSse(response: Response, anthropic: boolean, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    void response.body?.cancel().catch(() => {});
    throw invalid();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
  let buffer = '', data = '', eventName = '', wireBytes = 0, textBytes = 0, events = 0;
  try {
    for (;;) {
      const chunk = await withAbort(reader.read(), signal);
      signal.throwIfAborted();
      if (chunk.done || (wireBytes += chunk.value.byteLength) > MAX_WIRE_BYTES) throw invalid();
      try { buffer += decoder.decode(chunk.value, { stream: true }); } catch { throw invalid(); }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
        if (line) continue;
        if (data) {
          if (++events > 4096) throw invalid();
          const { text, done } = readDelta(data, eventName, anthropic);
          if (text !== undefined) {
            if (typeof text !== 'string' || (textBytes += encoder.encode(text).byteLength) > MAX_TEXT_BYTES) throw invalid();
            if (text) yield text;
          }
          signal.throwIfAborted();
          if (done) return;
        }
        data = ''; eventName = '';
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
