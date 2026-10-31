import { speechRequestSchema } from '@/domain/schemas';
import { config } from '@/server/config';
import { assertAppRequest, errorResponse, readJson, timingHeaders } from '@/server/http';
import { timeoutSignal } from '@/server/limits';
import { admit } from '@/server/admission';
import { withCircuit } from '@/server/resilience';
import { synthesize } from '@/server/providers/speech';
import { withAbort } from '@/lib/abort';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const started = performance.now();
  let requestId = crypto.randomUUID() as string; let release: (() => Promise<void>) | undefined;
  try {
    assertAppRequest(req);
    const input = await readJson(req, speechRequestSchema); requestId = input.requestId;
    const signal = timeoutSignal(req.signal, config().speechTimeout);
    release = await admit(req, 'tts', requestId, signal);
    const providerStart = performance.now();
    const audio = await withCircuit('tts', () => withAbort(synthesize(input.text, signal), signal));
    signal.throwIfAborted();
    return new Response(new Blob([audio as BlobPart], { type: 'audio/mpeg' }), { headers: { ...timingHeaders(started, requestId, performance.now() - providerStart), 'Content-Type': 'audio/mpeg' } });
  } catch (e) { return errorResponse(e, requestId, 'synthesize'); } finally { await release?.(); }
}
