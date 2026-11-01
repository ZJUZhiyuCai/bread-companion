import type { TurnCandidate, TurnRequest } from '@/domain/types';
import { candidateSchema } from '@/domain/schemas';
import { validateCandidate } from '@/domain/evidence';
import { withAbort } from '@/lib/abort';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // Audio can fail while the controller is still handling the candidate or a cancellation.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
/** Only an absent route permits using the older, unbilled transport. */
export class VoiceTransportUnavailable extends Error {}

/** The reply may render while the same request is still preparing speech. */
export function requestVoiceTurn(fetcher: typeof fetch, input: TurnRequest, parent: AbortSignal, timeoutMs = 60000) {
  const candidate = deferred<TurnCandidate>(), audio = deferred<Blob>();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('这次连接等得有点久，可以再试一次。', 'TimeoutError')), timeoutMs);
  const signal = AbortSignal.any([parent, deadline.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const invalid = () => new Error('声音连接中断了，已经收到的文字还在。');
  void (async () => {
    try {
      signal.throwIfAborted();
      const res = await withAbort(fetcher('/api/agent/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal }), signal);
      if (res.status === 404 || res.status === 405) { void res.body?.cancel().catch(() => {}); throw new VoiceTransportUnavailable(); }
      if (!res.body) throw invalid();
      reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let buffer = '', bytes = 0, gotCandidate = false, clip: Blob | undefined, complete = false;
      const handle = (line: string) => {
        let event;
        try { event = JSON.parse(line); } catch { throw invalid(); }
        if (!event || typeof event !== 'object') throw invalid();
        if (event.type === 'error' && event.error?.requestId === input.requestId) throw new Error(typeof event.error.userMessage === 'string' ? event.error.userMessage.slice(0, 400) : '声音暂时没接上，文字回复还在。');
        if (event.type === 'candidate' && !gotCandidate && !clip) {
          const parsedResult = candidateSchema.safeParse(event.candidate);
          if (!parsedResult.success) throw invalid();
          const parsed = parsedResult.data;
          if (validateCandidate(parsed, input).length) throw invalid();
          gotCandidate = true; candidate.resolve(parsed);
        } else if (event.type === 'audio' && gotCandidate && !clip && event.requestId === input.requestId && event.mime === 'audio/mpeg') {
          if (typeof event.audio !== 'string' || !event.audio.length || event.audio.length > 5592408 || event.audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.audio)) throw invalid();
          const raw = atob(event.audio), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
          if (bytes.byteLength > 4 * 1024 * 1024) throw invalid();
          clip = new Blob([bytes], { type: 'audio/mpeg' });
        } else if (event.type === 'done' && gotCandidate && clip && event.requestId === input.requestId) {
          complete = true;
        } else throw invalid();
      };
      for (;;) {
        signal.throwIfAborted();
        const chunk = await withAbort(reader.read(), signal);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > (res.ok ? 8 * 1024 * 1024 : 16384)) throw invalid();
        try { buffer += decoder.decode(chunk.value, { stream: true }); } catch { throw invalid(); }
        if (!res.ok) continue;
        if (!res.headers.get('content-type')?.startsWith('application/x-ndjson')) throw invalid();
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (line.trim()) handle(line);
          if (complete) { signal.throwIfAborted(); audio.resolve(clip!); return; }
        }
      }
      if (!res.ok) {
        let error;
        try { error = JSON.parse(buffer + decoder.decode())?.error; } catch { throw invalid(); }
        throw new Error(typeof error?.userMessage === 'string' ? error.userMessage.slice(0, 400) : '回复没有接上，再试一次？');
      }
      // EOF without an explicit done event is a broken response, never success.
      throw invalid();
    } catch (error) { candidate.reject(error); audio.reject(error); }
    finally {
      clearTimeout(timer);
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  })();
  return { candidate: candidate.promise, audio: audio.promise };
}
