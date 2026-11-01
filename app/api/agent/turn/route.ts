import { randomUUID } from 'node:crypto';
import { turnRequestSchema } from '@/domain/schemas';
import { config } from '@/server/config';
import { assertAppRequest, errorResponse, readJson, timingHeaders } from '@/server/http';
import { timeoutSignal } from '@/server/limits';
import { admit } from '@/server/admission';
import { generateTurn, turnLane } from '@/server/agent-turn';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const started = performance.now();
  let requestId = randomUUID() as string; let release: (() => Promise<void>) | undefined;
  try {
    assertAppRequest(req);
    const input = await readJson(req, turnRequestSchema); requestId = input.requestId;
    const c = config();
    const signal = timeoutSignal(req.signal, input.mode === 'listen' ? Math.min(c.agentTimeout, c.companionTimeout) : c.agentTimeout);
    const lane = turnLane(input);
    release = await admit(req, lane, requestId, signal);
    const { candidate, providerMs } = await generateTurn(input, signal);
    return Response.json(candidate, { headers: timingHeaders(started, requestId, providerMs) });
  } catch (error) { return errorResponse(error, requestId, 'agent'); } finally { await release?.(); }
}
