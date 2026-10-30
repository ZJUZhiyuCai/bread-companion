import type { RunToken, SessionState } from '@/domain/types';
import { isCurrent, uid } from '@/domain/reducer';
export class RunController {
  private aborter: AbortController | null = null;
  begin(state: SessionState): { token: RunToken; signal: AbortSignal } {
    this.cancel(); this.aborter = new AbortController();
    return { token: { sessionId: state.sessionId, runId: uid('run'), epoch: state.epoch, contextRevision: state.contextRevision }, signal: this.aborter.signal };
  }
  cancel() { this.aborter?.abort(); this.aborter = null; }
  accepts(state: SessionState, token: RunToken) { return isCurrent(state, token); }
}
