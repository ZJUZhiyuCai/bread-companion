import { speechRequestSchema } from '@/domain/schemas';
import { config } from '@/server/config';
import { assertLocalRequest, errorResponse, readJson, timingHeaders } from '@/server/http';
import { acquireBudget, claimRequest, timeoutSignal } from '@/server/limits';
import { synthesize } from '@/server/providers/speech';
import { withAbort } from '@/lib/abort';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const started = performance.now();
  let requestId = crypto.randomUUID() as string; let release: (() => void) | undefined;
  try {
    assertLocalRequest(req); release = acquireBudget('speech');
    const input = await readJson(req, speechRequestSchema); requestId = input.requestId;
    claimRequest('synthesize', requestId);
    const signal = timeoutSignal(req.signal, config().speechTimeout);
    const providerStart = performance.now();
    const audio = await withAbort(synthesize(input.text, signal), signal);
    signal.throwIfAborted();
    return new Response(new Blob([audio as BlobPart], { type: 'audio/mpeg' }), { headers: { ...timingHeaders(started, requestId, performance.now() - providerStart), 'Content-Type': 'audio/mpeg' } });
  } catch (e) { return errorResponse(e, requestId, 'synthesize'); } finally { release?.(); }
}
