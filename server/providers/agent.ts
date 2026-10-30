import type { TurnCandidate, TurnRequest } from '@/domain/types';
export interface AgentProvider { generate(input: TurnRequest, signal: AbortSignal): Promise<TurnCandidate>; }
