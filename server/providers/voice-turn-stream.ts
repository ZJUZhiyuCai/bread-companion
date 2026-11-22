import type { TurnCandidate, TurnRequest } from '@/domain/types';
import { withAbort } from '@/lib/abort';
import { admit } from '@/server/admission';
import { AppError, asAppError } from '@/server/errors';
import { timeoutSignal } from '@/server/limits';
import { providerFetch } from '@/server/provider-fetch';
import { withCircuit } from '@/server/resilience';
import { ModelOutputError, RealProvider, candidateOutputError, modelCandidateErrors, parseModelCandidate, streamRealProviderText } from './real-agent';
import { bufferSpeechStart } from './speech-buffer';
import { synthesizeStream } from './speech-stream';
import { JsonFieldTextExtractor, SentenceBuffer, isSafeVoicePrefix, stripId3v2Header } from './voice-stream';

type Release = () => Promise<void>;
interface StreamOptions {
  req: Request;
  input: TurnRequest;
  signal: AbortSignal;
  format: 'mp3' | 'pcm';
  bufferMp3: boolean;
  agentTimeout: number;
  speechTimeout: number;
  started: number;
  asrMs?: number;
  releaseAgent: Release;
  send: (event: { type: string } & Record<string, unknown>) => void;
}

async function* untilAborted(source: AsyncGenerator<Uint8Array>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await withAbort(source.next(), signal);
      if (next.done) return;
      yield next.value;
    }
  } finally { void source.return(undefined).catch(() => {}); }
}

/** Sentence TTS runs alongside one model request, in order under a single TTS lease.
 * A checked reply without early speech can use the caller's normal synthesis path. */
export async function streamVoiceTurn({ req, input, signal, format, bufferMp3, agentTimeout, speechTimeout, started, asrMs, releaseAgent, send }: StreamOptions):
  Promise<{ candidate: TurnCandidate; providerMs: number } | null> {
  const stop = new AbortController();
  const live = AbortSignal.any([signal, stop.signal]);
  const speechStop = new AbortController();
  const agentSignal = timeoutSignal(live, agentTimeout), agentStart = performance.now();
  const { requestId } = input;
  const normalMax = input.mode === 'interview' ? 160 : 100;
  const deferredSentences: string[] = [];
  let speechChars = 0;
  let lease: Promise<Release> | undefined, tail: Promise<void> | undefined, speechSignal: AbortSignal;
  let speechRelease: Promise<void> | undefined;
  let speechFailed = false, speechErrorSent = false;
  let firstSentenceMs: number | undefined, firstAudioMs: number | undefined;
  let speechStart = 0, speechEnd = 0, sequence = 0, audioBytes = 0;

  function releaseSpeech() {
    return speechRelease ??= lease?.then(release => release(), () => {}) ?? Promise.resolve();
  }

  function failSpeech(error: unknown) {
    if (live.aborted || speechErrorSent) return;
    speechFailed = true;
    speechStop.abort();
    void releaseSpeech().catch(() => {});
    const err = asAppError(error);
    const stage = 'synthesize';
    if (err.status >= 500) console.warn(JSON.stringify({ event: 'request_failed', requestId, stage, code: err.code, status: err.status }));
    speechErrorSent = true;
    send({ type: 'error', error: { code: err.code, userMessage: err.message, retryable: err.retryable, requestId, stage } });
  }

  async function speak(sentence: string) {
    speechSignal.throwIfAborted();
    await withCircuit('tts', async () => {
      const first = sequence === 0, firstSequence = sequence;
      send({ type: 'delta', requestId, text: sentence });
      const source = untilAborted(synthesizeStream(sentence.trim(), speechSignal, providerFetch, format), speechSignal);
      const chunks = format !== 'mp3' ? source : !first ? stripId3v2Header(source) : bufferMp3 ? bufferSpeechStart(source) : source;
      for await (const audio of chunks) {
        speechSignal.throwIfAborted();
        if (!audio.length) continue;
        audioBytes += audio.length;
        if (audioBytes > 4 * 1024 * 1024 || audio.length > 512 * 1024 || sequence >= 512) throw new AppError('PROVIDER_UNAVAILABLE', 502, true);
        if (!sequence) {
          firstAudioMs = performance.now() - speechStart;
          send({ type: 'audio_start', requestId, format: format === 'pcm' ? 'pcm-s16le' : 'mp3', sampleRate: 32000, channels: 1 });
        }
        send({ type: 'audio_chunk', requestId, sequence: sequence++, audio: Buffer.from(audio).toString('base64') });
      }
      if (sequence === firstSequence) throw new AppError('PROVIDER_UNAVAILABLE', 502, true);
      speechEnd = performance.now();
    });
  }

  function enqueue(sentence: string) {
    if (speechFailed) return;
    if (!tail) {
      firstSentenceMs = performance.now() - agentStart;
      speechSignal = timeoutSignal(AbortSignal.any([live, speechStop.signal]), speechTimeout);
      lease = admit(req, 'tts', requestId, speechSignal);
      tail = lease.then(() => { speechStart = performance.now(); return speak(sentence); });
    } else {
      tail = tail.then(() => { if (!speechFailed) return speak(sentence); });
    }
    tail = tail.catch(failSpeech);
  }

  function queueSentence(sentence: string) {
    speechChars += Array.from(sentence).length;
    // Interview stages and card fields arrive after assistantText. Wait for the
    // complete candidate before any interview speech can reach the client.
    if (input.mode === 'interview' || speechChars > normalMax) deferredSentences.push(sentence);
    else enqueue(sentence);
  }

  const prefixError = () => new ModelOutputError('上次回复的口播前缀未通过安全或格式检查。使用自然短句，去掉 Markdown、动作、指责和无依据的承诺。');
  try {
    const candidate = await withCircuit('call', async () => {
      const extractor = new JsonFieldTextExtractor(), sentences = new SentenceBuffer();
      let prefix = '', fieldComplete = false;
      try {
        for await (const chunk of streamRealProviderText(input, agentSignal)) {
          const text = extractor.push(chunk);
          if (text) {
            prefix += text;
            if (!isSafeVoicePrefix(prefix, input)) throw prefixError();
            for (const sentence of sentences.push(text)) queueSentence(sentence);
          }
          if (extractor.complete && !fieldComplete) {
            fieldComplete = true;
            for (const sentence of sentences.finish()) queueSentence(sentence);
            // The JSON tail can continue after the last sentence. Speech
            // capacity becomes available as soon as that sentence drains.
            if (tail && !deferredSentences.length) void tail.then(releaseSpeech, () => {}).catch(() => {});
          }
        }
        const result = parseModelCandidate(extractor.raw, input);
        const errors = modelCandidateErrors(result, input);
        if (!/[\p{L}\p{N}]/u.test(result.assistantText)) errors.push('STYLE_EMPTY');
        if (extractor.complete && result.assistantText !== prefix) errors.push('STYLE_STREAM_TEXT_MISMATCH');
        if (errors.length) throw candidateOutputError(errors);
        if (!isSafeVoicePrefix(result.assistantText, input, result.supportGuidance ?? false, result.interviewUpdate?.stage)) throw prefixError();
        return result;
      } catch (error) {
        // One repair is available before any TTS admission. Once audio work has
        // started, a replacement answer could contradict already played speech.
        agentSignal.throwIfAborted();
        if (tail || !(error instanceof ModelOutputError)) throw error;
        deferredSentences.length = 0;
        const repaired = await new RealProvider().generate(input, agentSignal, error);
        if (!/[\p{L}\p{N}]/u.test(repaired.assistantText) || !isSafeVoicePrefix(repaired.assistantText, input, repaired.supportGuidance ?? false, repaired.interviewUpdate?.stage)) throw prefixError();
        return repaired;
      }
    });
    live.throwIfAborted();
    const providerMs = performance.now() - agentStart;
    if (!tail && !deferredSentences.length) return { candidate, providerMs };
    send({ type: 'candidate', candidate, timing: { agentMs: providerMs, elapsedMs: performance.now() - started } });
    // Coalesce deferred sentences into one TTS call so interview turns and support tails
    // avoid multiplying MiniMax QPS and keep natural prosody across sentences.
    if (deferredSentences.length) enqueue(deferredSentences.join(''));
    await releaseAgent();
    await tail;
    await releaseSpeech();
    if (!speechFailed) send({ type: 'done', requestId, timing: { asrMs, firstSentenceMs, firstAudioMs, agentMs: providerMs, ttsMs: speechEnd - speechStart, totalMs: performance.now() - started } });
    return null;
  } finally {
    stop.abort();
    try { await Promise.all([releaseAgent(), tail?.catch(() => {})]); }
    finally { await releaseSpeech(); }
  }
}
