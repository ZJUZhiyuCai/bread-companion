import type { TurnCandidate, TurnRequest } from '@/domain/types';
import { withAbort } from '@/lib/abort';
import { admit } from '@/server/admission';
import { AppError } from '@/server/errors';
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
  const agentSignal = timeoutSignal(live, agentTimeout), agentStart = performance.now();
  const { requestId } = input;
  let lease: Promise<Release> | undefined, tail: Promise<void> | undefined, speechSignal: AbortSignal;
  let speechRelease: Promise<void> | undefined;
  let firstSentenceMs: number | undefined, firstAudioMs: number | undefined;
  let speechStart = 0, speechEnd = 0, sequence = 0, audioBytes = 0;

  function releaseSpeech() {
    return speechRelease ??= lease?.then(release => release(), () => {}) ?? Promise.resolve();
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
    if (!tail) {
      firstSentenceMs = performance.now() - agentStart;
      speechSignal = timeoutSignal(live, speechTimeout);
      lease = admit(req, 'tts', requestId, speechSignal);
      tail = lease.then(() => { speechStart = performance.now(); return speak(sentence); });
    } else {
      tail = tail.then(() => speak(sentence));
    }
    // A speech failure can precede the candidate. Free speech capacity, then let
    // the model finish checking the text so it can still be delivered.
    void tail.catch(releaseSpeech).catch(() => {});
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
            for (const sentence of sentences.push(text)) enqueue(sentence);
          }
          if (extractor.complete && !fieldComplete) {
            fieldComplete = true;
            for (const sentence of sentences.finish()) enqueue(sentence);
            // The JSON tail can continue after the last sentence. Speech
            // capacity becomes available as soon as that sentence drains.
            if (tail) void tail.then(releaseSpeech, () => {}).catch(() => {});
          }
        }
        const result = parseModelCandidate(extractor.raw, input);
        const errors = modelCandidateErrors(result, input);
        if (!result.assistantText.trim()) errors.push('STYLE_EMPTY');
        if (extractor.complete && result.assistantText !== prefix) errors.push('STYLE_STREAM_TEXT_MISMATCH');
        if (errors.length) throw candidateOutputError(errors);
        if (!isSafeVoicePrefix(result.assistantText, input, result.supportGuidance, result.interviewUpdate?.stage)) throw prefixError();
        return result;
      } catch (error) {
        // One repair is available before any TTS admission. Once audio work has
        // started, a replacement answer could contradict already played speech.
        agentSignal.throwIfAborted();
        if (tail || !(error instanceof ModelOutputError)) throw error;
        const repaired = await new RealProvider().generate(input, agentSignal, error);
        if (!repaired.assistantText.trim() || !isSafeVoicePrefix(repaired.assistantText, input, repaired.supportGuidance, repaired.interviewUpdate?.stage)) throw prefixError();
        return repaired;
      }
    });
    live.throwIfAborted();
    const providerMs = performance.now() - agentStart;
    if (!tail) return { candidate, providerMs };
    send({ type: 'candidate', candidate, timing: { agentMs: providerMs, elapsedMs: performance.now() - started } });
    await releaseAgent();
    await tail;
    await releaseSpeech();
    send({ type: 'done', requestId, timing: { asrMs, firstSentenceMs, firstAudioMs, agentMs: providerMs, ttsMs: speechEnd - speechStart, totalMs: performance.now() - started } });
    return null;
  } finally {
    stop.abort();
    try { await Promise.all([releaseAgent(), tail?.catch(() => {})]); }
    finally { await releaseSpeech(); }
  }
}
