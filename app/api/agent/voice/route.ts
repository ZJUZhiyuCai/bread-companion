import { turnRequestSchema } from '@/domain/schemas';
import type { TurnRequest } from '@/domain/types';
import { callSeedSchema, completeCallSeed, CALL_SEED_BYTES, type CallSeed } from '@/domain/call-pipeline';
import { interviewNeedsDebrief } from '@/domain/policy';
import { withAbort } from '@/lib/abort';
import { generateTurn, turnLane } from '@/server/agent-turn';
import { admit } from '@/server/admission';
import { config } from '@/server/config';
import { AppError, asAppError } from '@/server/errors';
import { assertAppRequest, errorResponse, NO_STORE, readJson } from '@/server/http';
import { timeoutSignal } from '@/server/limits';
import { synthesizeStream } from '@/server/providers/speech-stream';
import { CHAT_ASR_SECONDS, INTERVIEW_ASR_SECONDS, SPEECH_UPLOAD_METADATA_BYTES, readSpeechUpload, synthesize, transcribe } from '@/server/providers/speech';
import { bufferSpeechStart } from '@/server/providers/speech-buffer';
import { localAgentReply } from '@/server/providers/real-agent';
import { streamVoiceTurn } from '@/server/providers/voice-turn-stream';
import { withCircuit } from '@/server/resilience';
import { providerFetch } from '@/server/provider-fetch';
import { serverEnv } from '@/server/runtime';

export const runtime = 'nodejs';

/** A single connection carries the validated candidate and negotiated audio. */
export async function POST(req: Request) {
  const started = performance.now();
  let requestId = crypto.randomUUID() as string;
  let release: (() => Promise<void>) | undefined;
  async function releaseLane() {
    const done = release;
    release = undefined;
    await done?.();
  }
  const canceled = new AbortController();
  try {
    assertAppRequest(req);
    let input: TurnRequest | null = null, seed: CallSeed | undefined, file: File | undefined;
    if (req.headers.get('content-type')?.startsWith('multipart/form-data;')) {
      const metadataBytes = CALL_SEED_BYTES + SPEECH_UPLOAD_METADATA_BYTES;
      const { form, byteLength } = await readSpeechUpload(req, metadataBytes);
      const rawSeed = form.get('seed'), audio = form.get('file');
      if (form.getAll('seed').length !== 1 || form.getAll('file').length !== 1 || typeof rawSeed !== 'string'
        || new TextEncoder().encode(rawSeed).length > CALL_SEED_BYTES || !(audio instanceof File)) throw new AppError('INVALID_INPUT');
      if (byteLength - audio.size > metadataBytes) throw new AppError('INVALID_INPUT', 413);
      try { seed = callSeedSchema.parse(JSON.parse(rawSeed)); } catch { throw new AppError('INVALID_INPUT'); }
      requestId = seed.requestId; file = audio;
    } else {
      input = await readJson(req, turnRequestSchema); requestId = input.requestId;
      if (input.channel !== 'call' || (input.mode !== 'listen' && input.mode !== 'interview')) throw new AppError('INVALID_INPUT');
    }
    const c = config();
    if (!c.tts || !c.miniKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
    if (file && !c.asr) throw new AppError('PROVIDER_UNAVAILABLE', 503);
    const analysis = input ? turnLane(input) === 'analysis' : interviewNeedsDebrief(seed?.interview);
    const agentTimeout = analysis ? c.agentTimeout : Math.min(c.agentTimeout, c.companionTimeout);
    const signal = timeoutSignal(AbortSignal.any([req.signal, canceled.signal]), agentTimeout + c.speechTimeout * (file ? 2 : 1));
    release = await admit(req, input ? turnLane(input) : 'asr', requestId, signal);
    const env = serverEnv();
    const format = req.headers.get('X-Bread-Audio') === 'mp3-chunks-v1' ? 'mp3' : 'pcm';
    const streamed = (format === 'mp3' && env.BREAD_MP3_STREAM !== 'off') || (req.headers.get('X-Bread-Audio') === 'pcm-s16le-v1' && env.BREAD_PCM_STREAM !== 'off');
    const bufferMp3 = env.BREAD_SPEECH_START_BUFFER !== 'off';
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => { signal.throwIfAborted(); controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
        void (async () => {
          let stage = file ? 'transcribe' : 'agent';
          let asrMs: number | undefined;
          try {
            if (file && seed) {
              const asrStart = performance.now(), asrSignal = timeoutSignal(signal, c.speechTimeout);
              const maxSeconds = seed.mode === 'interview' ? INTERVIEW_ASR_SECONDS : CHAT_ASR_SECONDS;
              const text = await withCircuit('asr', () => withAbort(transcribe(file!, asrSignal, undefined, maxSeconds), asrSignal));
              asrMs = performance.now() - asrStart;
              signal.throwIfAborted();
              input = completeCallSeed(seed, text);
              send({ type: 'transcript', requestId, text, timing: { asrMs, elapsedMs: performance.now() - started } });
              await releaseLane();
              if (!input) { send({ type: 'transcript_done', requestId }); return; }
              stage = 'agent'; release = await admit(req, turnLane(input), requestId, signal);
            }
            if (!input) throw new AppError('INVALID_INPUT');
            let turn;
            if (streamed && c.agentProvider === 'real' && c.sentenceStream && req.headers.get('X-Bread-Voice-Stream') === 'sentence-v1'
              && turnLane(input) === 'call' && !input.context.rejectedFindings?.length && !localAgentReply(input)) {
              // Interview speech waits for the stage and card checks in streamVoiceTurn.
              turn = await streamVoiceTurn({ req, input, signal, format, bufferMp3, agentTimeout, speechTimeout: c.speechTimeout, started,
                asrMs, releaseAgent: releaseLane, send: event => { send(event); if (event.type === 'candidate') stage = 'synthesize'; } });
              if (!turn) return;
            } else turn = await generateTurn(input, timeoutSignal(signal, agentTimeout));
            const { candidate, providerMs } = turn;
            send({ type: 'candidate', candidate, timing: { agentMs: providerMs, elapsedMs: performance.now() - started } });
            // Separate accounting/circuit lanes are preserved; no extra parallel paid generation.
            await releaseLane();
            signal.throwIfAborted(); stage = 'synthesize';
            const speechSignal = timeoutSignal(signal, c.speechTimeout);
            release = await admit(req, 'tts', requestId, speechSignal);
            const speechStart = performance.now();
            let firstAudioMs: number | undefined;
            if (streamed) {
              await withCircuit('tts', async () => {
                let sequence = 0;
                const source = synthesizeStream(candidate.assistantText, speechSignal, providerFetch, format);
                const chunks = format === 'mp3' && bufferMp3 ? bufferSpeechStart(source) : source;
                for await (const audio of chunks) {
                  if (!sequence) { firstAudioMs = performance.now() - speechStart; send({ type: 'audio_start', requestId, format: format === 'pcm' ? 'pcm-s16le' : 'mp3', sampleRate: 32000, channels: 1 }); }
                  send({ type: 'audio_chunk', requestId, sequence: sequence++, audio: Buffer.from(audio).toString('base64') });
                }
              });
            } else {
              const audio = await withCircuit('tts', () => withAbort(synthesize(candidate.assistantText, speechSignal), speechSignal));
              if (!audio.length || audio.length > 4 * 1024 * 1024) throw new AppError('PROVIDER_UNAVAILABLE', 502, true);
              send({ type: 'audio', requestId, mime: 'audio/mpeg', audio: Buffer.from(audio).toString('base64') });
            }
            send({ type: 'done', requestId, timing: { asrMs, agentMs: providerMs, firstAudioMs, ttsMs: performance.now() - speechStart, totalMs: performance.now() - started } });
          } catch (error) {
            if (!signal.aborted) {
              const err = asAppError(error);
              if (err.status >= 500) console.warn(JSON.stringify({ event: 'request_failed', requestId, stage, code: err.code, status: err.status }));
              send({ type: 'error', error: { code: err.code, userMessage: err.message, retryable: err.retryable, requestId, stage } });
            }
          } finally {
            await releaseLane();
            // cancel() already closes a canceled reader; no enqueue/close after it.
            if (!canceled.signal.aborted) controller.close();
          }
        })().catch(() => { canceled.abort(); });
      },
      cancel() { canceled.abort(); },
    });
    return new Response(body, { headers: { ...NO_STORE, 'Cache-Control': 'no-store, no-transform', 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Request-Id': requestId, 'X-Accel-Buffering': 'no' } });
  } catch (error) { await releaseLane(); return errorResponse(error, requestId, 'voice'); }
}
