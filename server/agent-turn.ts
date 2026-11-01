import type { TurnRequest } from '@/domain/types';
import { candidateSchema } from '@/domain/schemas';
import { validateCandidate } from '@/domain/evidence';
import { withAbort } from '@/lib/abort';
import { config } from './config';
import { AppError } from './errors';
import { withCircuit } from './resilience';
import { RealProvider } from './providers/real-agent';
import { MockProvider } from './providers/mock-agent';

export const turnLane = (input: TurnRequest) => input.mode === 'listen'
  ? input.channel === 'call' ? 'call' as const : 'companion' as const : 'analysis' as const;

/** Both transports publish only the same complete, validated candidate. */
export async function generateTurn(input: TurnRequest, signal: AbortSignal) {
  const c = config(), start = performance.now();
  const provider = c.agentProvider === 'real' ? new RealProvider() : new MockProvider(c.mockDelay);
  const candidate = candidateSchema.parse(await withCircuit(turnLane(input), () => withAbort(provider.generate(input, signal), signal)));
  signal.throwIfAborted();
  const errors = validateCandidate(candidate, input);
  if (errors.length) throw new AppError(errors.includes('EVIDENCE_MISMATCH') ? 'EVIDENCE_MISMATCH' : 'INVALID_MODEL_OUTPUT', 502);
  return { candidate, providerMs: performance.now() - start };
}
