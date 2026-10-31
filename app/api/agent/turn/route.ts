import { randomUUID } from 'node:crypto';
import { turnRequestSchema, candidateSchema } from '@/domain/schemas';
import { validateCandidate } from '@/domain/evidence';
import { config } from '@/server/config';
import { assertAppRequest, errorResponse, readJson, timingHeaders } from '@/server/http';
import { timeoutSignal } from '@/server/limits';
import { admit } from '@/server/admission';
import { withCircuit } from '@/server/resilience';
import { MockProvider } from '@/server/providers/mock-agent';
import { RealProvider } from '@/server/providers/real-agent';
import { AppError } from '@/server/errors';
import { withAbort } from '@/lib/abort';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const started = performance.now();
  let requestId = randomUUID() as string; let release: (() => Promise<void>) | undefined;
  try {
    assertAppRequest(req);
    const input = await readJson(req, turnRequestSchema); requestId = input.requestId;
    const c = config();
    const signal = timeoutSignal(req.signal, input.mode === 'listen' ? Math.min(c.agentTimeout, c.companionTimeout) : c.agentTimeout);
    const lane = input.mode === 'listen' ? (input.channel === 'call' ? 'call' : 'companion') : 'analysis';
    release = await admit(req, lane, requestId, signal);
    const provider = c.agentProvider === 'real' ? new RealProvider() : new MockProvider(c.mockDelay);
    const providerStart = performance.now();
    const candidate = candidateSchema.parse(await withCircuit(lane, () => withAbort(provider.generate(input, signal), signal)));
    signal.throwIfAborted();
    const errors = validateCandidate(candidate, input);
    if (errors.length) throw new AppError(errors.includes('EVIDENCE_MISMATCH') ? 'EVIDENCE_MISMATCH' : 'INVALID_MODEL_OUTPUT', 502);
    return Response.json(candidate, { headers: timingHeaders(started, requestId, performance.now() - providerStart) });
  } catch (error) { return errorResponse(error, requestId, 'agent'); } finally { await release?.(); }
}
