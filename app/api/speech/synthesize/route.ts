import { speechRequestSchema } from '@/domain/schemas';
import { config } from '@/server/config';
import { assertLocalRequest, errorResponse, NO_STORE, readJson } from '@/server/http';
import { acquireBudget, timeoutSignal } from '@/server/limits';
import { synthesize } from '@/server/providers/speech';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  let requestId = crypto.randomUUID() as string; let release: (() => void) | undefined;
  try {
    assertLocalRequest(req); release = acquireBudget('speech');
    const input = await readJson(req, speechRequestSchema); requestId = input.requestId;
    const audio = await synthesize(input.text, timeoutSignal(req.signal, config().speechTimeout));
    return new Response(new Blob([audio as BlobPart], { type: 'audio/mpeg' }), { headers: { ...NO_STORE, 'Content-Type': 'audio/mpeg', 'X-Request-Id': requestId } });
  } catch (e) { return errorResponse(e, requestId, 'synthesize'); } finally { release?.(); }
}
