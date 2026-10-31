import { AppError, asAppError } from './errors';

export type ServiceLane = 'call' | 'companion' | 'analysis' | 'asr' | 'tts';
interface Circuit { failures: number; openedUntil: number; probe: boolean; generation: number }
const circuits = new Map<ServiceLane, Circuit>();
/** Isolate outages by capability. No speculative duplicate paid model calls or hidden retries. */
export async function withCircuit<T>(lane: ServiceLane, task: () => Promise<T>, now = () => Date.now()): Promise<T> {
  const state = circuits.get(lane) ?? { failures: 0, openedUntil: 0, probe: false, generation: 0 };
  circuits.set(lane, state);
  if (state.openedUntil > now() || state.probe) throw new AppError('PROVIDER_UNAVAILABLE', 503, true, Math.max(1, Math.ceil((state.openedUntil - now()) / 1000)));
  const probe = state.openedUntil > 0;
  if (probe) state.probe = true;
  const generation = state.generation;
  try {
    const value = await task();
    if (generation === state.generation) { state.failures = 0; state.openedUntil = 0; }
    return value;
  } catch (error) {
    const failure = asAppError(error);
    if (generation === state.generation && ['PROVIDER_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED'].includes(failure.code)) {
      if (probe || ++state.failures >= 3) { state.openedUntil = now() + 15000; state.generation++; }
    } else if (generation === state.generation && probe) {
      // Cancellation/input failure says nothing about provider health; permit a later probe.
      state.openedUntil = now();
    }
    throw error;
  } finally { if (probe) state.probe = false; }
}
export function resetCircuitsForTest() { circuits.clear(); }
