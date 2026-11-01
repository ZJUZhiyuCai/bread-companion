import { turnRequestSchema } from '@/domain/schemas';
import { withAbort } from '@/lib/abort';
import { generateTurn } from '@/server/agent-turn';
import { admit } from '@/server/admission';
import { config } from '@/server/config';
import { AppError, asAppError } from '@/server/errors';
import { assertAppRequest, errorResponse, NO_STORE, readJson } from '@/server/http';
import { timeoutSignal } from '@/server/limits';
import { synthesize } from '@/server/providers/speech';
import { withCircuit } from '@/server/resilience';

export const runtime = 'nodejs';

/** One connection carries the checked reply and its audio. Never speaks an unchecked token. */
export async function POST(req: Request) {
  const started = performance.now();
  let requestId = crypto.randomUUID() as string;
  let release: (() => Promise<void>) | undefined;
  const canceled = new AbortController();
  try {
    assertAppRequest(req);
    const input = await readJson(req, turnRequestSchema); requestId = input.requestId;
    if (input.mode !== 'listen' || input.channel !== 'call') throw new AppError('INVALID_INPUT');
    const c = config();
    if (!c.tts || !c.miniKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
    const signal = timeoutSignal(AbortSignal.any([req.signal, canceled.signal]), Math.min(c.agentTimeout, c.companionTimeout) + c.speechTimeout);
    release = await admit(req, 'call', requestId, signal);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => { signal.throwIfAborted(); controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
        void (async () => {
          let stage = 'agent';
          try {
            const { candidate, providerMs } = await generateTurn(input, timeoutSignal(signal, Math.min(c.agentTimeout, c.companionTimeout)));
            send({ type: 'candidate', candidate, timing: { agentMs: providerMs, elapsedMs: performance.now() - started } });
            // Separate accounting/circuit lanes are preserved; no extra parallel paid generation.
            await release?.(); release = undefined;
            signal.throwIfAborted(); stage = 'synthesize';
            const speechSignal = timeoutSignal(signal, c.speechTimeout);
            release = await admit(req, 'tts', requestId, speechSignal);
            const speechStart = performance.now();
            const audio = await withCircuit('tts', () => withAbort(synthesize(candidate.assistantText, speechSignal), speechSignal));
            if (!audio.length || audio.length > 4 * 1024 * 1024) throw new AppError('PROVIDER_UNAVAILABLE', 502, true);
            send({ type: 'audio', requestId, mime: 'audio/mpeg', audio: Buffer.from(audio).toString('base64') });
            send({ type: 'done', requestId, timing: { agentMs: providerMs, ttsMs: performance.now() - speechStart, totalMs: performance.now() - started } });
          } catch (error) {
            if (!signal.aborted) {
              const err = asAppError(error);
              if (err.status >= 500) console.warn(JSON.stringify({ event: 'request_failed', requestId, stage, code: err.code, status: err.status }));
              send({ type: 'error', error: { code: err.code, userMessage: err.message, retryable: err.retryable, requestId, stage } });
            }
          } finally {
            await release?.(); release = undefined;
            // cancel() already closes a canceled reader; no enqueue/close after it.
            if (!canceled.signal.aborted) controller.close();
          }
        })().catch(() => { canceled.abort(); });
      },
      cancel() { canceled.abort(); },
    });
    return new Response(body, { headers: { ...NO_STORE, 'Cache-Control': 'no-store, no-transform', 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Request-Id': requestId, 'X-Accel-Buffering': 'no' } });
  } catch (error) { await release?.(); return errorResponse(error, requestId, 'voice'); }
}
