import type { TurnCandidate, TurnRequest } from '@/domain/types';
import { candidateSchema } from '@/domain/schemas';
import { validateCandidate } from '@/domain/evidence';
import { withAbort } from '@/lib/abort';
import { PcmSpeech, Mp3Speech, type SpeechChunks, type CallSpeech } from './speech-stream';
import { callServiceError } from './call-error';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // Audio can fail while the controller is still handling the candidate or a cancellation.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
/** Only an absent route permits using the older, unbilled transport. */
export class VoiceTransportUnavailable extends Error {}

/** Raw 32 kHz PCM needs more bandwidth than MP3; decide before any billed request. */
export function canStreamPcm(connection?: { saveData?: boolean; effectiveType?: string; downlink?: number }): boolean {
  return !connection?.saveData && !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '')
    && !(typeof connection?.downlink === 'number' && connection.downlink > 0 && connection.downlink < 1);
}
/** Compressed audio is also suitable for ordinary 3G/high-RTT links. */
export function canStreamMp3(connection?: { saveData?: boolean; effectiveType?: string; downlink?: number }): boolean {
  return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '')
    && !(typeof connection?.downlink === 'number' && connection.downlink > 0 && connection.downlink < .3);
}
/** The reply may render while the same request is still preparing speech. */
export function requestVoiceTurn(fetcher: typeof fetch, input: TurnRequest, parent: AbortSignal, timeoutMs = 60000) {
  const candidate = deferred<TurnCandidate>(), audio = deferred<CallSpeech>();
  const connection = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } }).connection;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (canStreamMp3(connection)) headers['X-Bread-Audio'] = 'mp3-chunks-v1';
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('这次连接等得有点久，可以再试一次。', 'TimeoutError')), timeoutMs);
  const signal = AbortSignal.any([parent, deadline.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let pcm: SpeechChunks | undefined;
  const invalid = () => new Error('声音连接中断了，已经收到的文字还在。');
  void (async () => {
    try {
      signal.throwIfAborted();
      const res = await withAbort(fetcher('/api/agent/voice', { method: 'POST', headers, body: JSON.stringify(input), signal }), signal);
      if (res.status === 404 || res.status === 405) { void res.body?.cancel().catch(() => {}); throw new VoiceTransportUnavailable(); }
      if (!res.body) throw invalid();
      reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let buffer = '', bytes = 0, gotCandidate = false, clip: Blob | undefined, complete = false, sequence = 0;
      const handle = (line: string) => {
        let event;
        try { event = JSON.parse(line); } catch { throw invalid(); }
        if (!event || typeof event !== 'object') throw invalid();
        if (event.type === 'error' && event.error?.requestId === input.requestId) throw callServiceError(event.error);
        if (event.type === 'candidate' && !gotCandidate && !clip && !pcm) {
          const parsedResult = candidateSchema.safeParse(event.candidate);
          if (!parsedResult.success) throw invalid();
          const parsed = parsedResult.data;
          if (validateCandidate(parsed, input).length) throw invalid();
          gotCandidate = true; candidate.resolve(parsed);
        } else if (event.type === 'audio' && gotCandidate && !clip && !pcm && event.requestId === input.requestId && event.mime === 'audio/mpeg') {
          if (typeof event.audio !== 'string' || !event.audio.length || event.audio.length > 5592408 || event.audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.audio)) throw invalid();
          const raw = atob(event.audio), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
          if (bytes.byteLength > 4 * 1024 * 1024) throw invalid();
          clip = new Blob([bytes], { type: 'audio/mpeg' });
        } else if (event.type === 'audio_start' && gotCandidate && !clip && !pcm && event.requestId === input.requestId && ['pcm-s16le', 'mp3'].includes(event.format) && event.sampleRate === 32000 && event.channels === 1) {
          pcm = event.format === 'mp3' ? new Mp3Speech() : new PcmSpeech();
        } else if (event.type === 'audio_chunk' && pcm && !clip && event.requestId === input.requestId && event.sequence === sequence) {
          if (sequence >= 512 || typeof event.audio !== 'string' || !event.audio.length || event.audio.length > 699052 || event.audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.audio)) throw invalid();
          const raw = atob(event.audio);
          pcm.push(Uint8Array.from(raw, c => c.charCodeAt(0)));
          if (!sequence++) audio.resolve(pcm);
        } else if (event.type === 'done' && gotCandidate && (clip || (pcm && sequence > 0)) && event.requestId === input.requestId) {
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
          if (complete) { signal.throwIfAborted(); if (pcm) pcm.end(); else audio.resolve(clip!); return; }
        }
      }
      if (!res.ok) {
        let error;
        try { error = JSON.parse(buffer + decoder.decode())?.error; } catch { throw invalid(); }
        throw callServiceError(error, res.status);
      }
      // EOF without an explicit done event is a broken response, never success.
      throw invalid();
    } catch (error) { pcm?.fail(error); candidate.reject(error); audio.reject(error); }
    finally {
      clearTimeout(timer);
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  })();
  return { candidate: candidate.promise, audio: audio.promise };
}
