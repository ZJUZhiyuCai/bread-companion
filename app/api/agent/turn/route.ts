import { randomUUID } from 'node:crypto';
import { turnRequestSchema, candidateSchema } from '@/domain/schemas';
import { validateCandidate } from '@/domain/evidence';
import { config } from '@/server/config';
import { assertLocalRequest, errorResponse, NO_STORE, readJson } from '@/server/http';
import { acquireBudget, timeoutSignal } from '@/server/limits';
import { MockProvider } from '@/server/providers/mock-agent';
import { RealProvider } from '@/server/providers/real-agent';
import { AppError } from '@/server/errors';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  let requestId = randomUUID() as string; let release: (() => void) | undefined;
  try {
    assertLocalRequest(req); release = acquireBudget('agent');
    const input = await readJson(req, turnRequestSchema); requestId = input.requestId;
    const c = config();
    const signal = timeoutSignal(req.signal, c.agentTimeout);
    const provider = c.agentProvider === 'real' ? new RealProvider() : new MockProvider(c.mockDelay);
    const candidate = candidateSchema.parse(await provider.generate(input, signal));
    signal.throwIfAborted();
    const errors = validateCandidate(candidate, input);
    if (errors.length) throw new AppError(errors.includes('EVIDENCE_MISMATCH') ? 'EVIDENCE_MISMATCH' : 'INVALID_MODEL_OUTPUT', 502);
    return Response.json(candidate, { headers: NO_STORE });
  } catch (error) { return errorResponse(error, requestId, 'agent'); } finally { release?.(); }
}
