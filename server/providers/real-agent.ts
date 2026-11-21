import type { TurnCandidate, TurnRequest } from '@/domain/types';
import { candidateSchema, modelContentSchema } from '@/domain/schemas';
import { requestSegments } from '@/domain/context-builder';
import { validateCandidate } from '@/domain/evidence';
import { farewellReply, interviewNeedsDebrief, needsImmediateSupport, SUPPORT_TEXT } from '@/domain/policy';
import { responseStyleErrors } from '@/domain/response-style';
import { withAbort } from '@/lib/abort';
import { systemPrompt } from '@/prompts/agent';
import { config } from '@/server/config';
import { AppError } from '@/server/errors';
import { providerFetch } from '@/server/provider-fetch';
import type { AgentProvider } from './agent';
import { readAgentSse } from './agent-sse';
import { readProviderJson } from './response';
import { REJECTION_REVIEW_PROMPT, correctionFallback } from './rejection-review';

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const realMetadata = ({ requestId, sessionId, runId, epoch, contextRevision }: TurnRequest) =>
  ({ requestId, sessionId, runId, epoch, contextRevision, serviceMode: 'real' as const });

export function localAgentReply(input: TurnRequest): Pick<TurnCandidate, 'assistantText' | 'supportGuidance'> | null {
  if (needsImmediateSupport(input.userMessage)) return { assistantText: SUPPORT_TEXT, supportGuidance: true };
  const farewell = input.mode === 'listen' ? farewellReply(input.userMessage) : null;
  return farewell ? { assistantText: farewell } : null;
}

function prepareModelRequest(input: TurnRequest) {
  const cfg = config();
  const listening = input.mode === 'listen';
  const interviewQA = input.mode === 'interview' && !interviewNeedsDebrief(input.context.interview);
  const companion = listening && !!cfg.companionModel;
  const call = (listening || interviewQA) && input.channel === 'call' && !!cfg.callModel;
  const model = call ? cfg.callModel : companion ? cfg.companionModel : cfg.agentModel;
  const protocol = call ? cfg.callProtocol : companion ? cfg.companionProtocol : cfg.agentProtocol;
  // A dedicated companion endpoint must have its own key.
  const dedicated = (listening || call) && !!cfg.companionBaseUrl;
  const baseUrl = dedicated ? cfg.companionBaseUrl : cfg.agentBaseUrl;
  const apiKey = dedicated ? cfg.companionKey : cfg.agentKey;
  if (!apiKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
  const anthropic = protocol === 'anthropic';
  const target = {
    model, anthropic, url: `${baseUrl.replace(/\/$/, '')}/${anthropic ? 'messages' : 'chat/completions'}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}) },
  };

  const history: typeof input.context.recentMessages = [];
  let historyBytes = 0;
  for (const m of [...input.context.recentMessages].reverse()) {
    const size = bytes(m.text);
    if (historyBytes + size > 12000) break;
    history.unshift(m); historyBytes += size;
  }
  const segments = requestSegments(input);
  // Listening already has the recent utterances: don't send the same text a third time as evidence.
  const sourceSegments = listening ? segments.filter(s => !history.some(m => m.role === 'user' && m.text.includes(s.text)) && !input.userMessage.includes(s.text)) : segments;
  const recentMessages = history.at(-1)?.role === 'user' && history.at(-1)?.text === input.userMessage ? history.slice(0, -1) : history;
  const data = JSON.stringify({ mode: input.mode, channel: input.channel ?? 'text', userMessage: input.userMessage, recentMessages, sourceSegments, preferences: input.context.preferences,
    rejectedFindings: input.context.rejectedFindings, selectedQuestion: input.context.selectedQuestion, practiceCriteria: input.context.practiceCriteria, interview: input.context.interview });
  if (bytes(data) > 36000) throw new AppError('INVALID_INPUT', 413);
  return {
    target, data, system: systemPrompt(input.mode, input.mode === 'practice' && !input.context.selectedQuestion, input.channel, input.context.interview),
    maxTokens: listening ? (input.channel === 'call' ? 384 : 512) : interviewQA ? 1024 : 4096,
    effort: listening ? cfg.companionEffort : '',
  };
}

type ModelTarget = ReturnType<typeof prepareModelRequest>['target'];
interface ModelPrompt { system: string; data: string; maxTokens: number; effort?: string; temperature?: number; }
function modelBody({ model, anthropic }: ModelTarget, { system, data, maxTokens, effort, temperature = 0.4 }: ModelPrompt, stream = false) {
  const common = { model, max_tokens: maxTokens, temperature, ...(stream ? { stream: true } : {}) };
  return anthropic ? { ...common, system, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: data }] }
    : { ...common, response_format: { type: 'json_object' }, thinking: { type: effort ? 'enabled' : 'disabled' },
      ...(effort ? { reasoning_effort: effort } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: data }] };
}
async function requestModel(target: ModelTarget, body: ReturnType<typeof modelBody>, signal: AbortSignal, fetcher: typeof fetch) {
  signal.throwIfAborted();
  const pending = fetcher(target.url, { method: 'POST', headers: target.headers, body: JSON.stringify(body), signal, redirect: 'manual', cache: 'no-store' });
  let response: Response;
  try { response = await withAbort(pending, signal); }
  catch (error) {
    if (signal.aborted) void pending.then(res => res.body?.cancel()).catch(() => {});
    throw error;
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new AppError(response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', response.status === 429 ? 429 : 502, response.status >= 500 || response.status === 429);
  }
  return response;
}

function textReply(payload: unknown, anthropic: boolean): string | undefined {
  const p = payload as { content?: { type: string; text?: string }[]; choices?: { message?: { content?: string } }[] } | null;
  return anthropic ? (Array.isArray(p?.content) ? p.content.filter(b => b?.type === 'text').map(b => b.text ?? '').join('') : undefined)
    : p?.choices?.[0]?.message?.content;
}

/** Only bounded diagnostics may be used in a repair prompt. */
export class ModelOutputError extends AppError {
  constructor(readonly repair: string, evidenceMismatch = false) {
    super(evidenceMismatch ? 'EVIDENCE_MISMATCH' : 'INVALID_MODEL_OUTPUT', 502, true);
  }
}

export function parseModelCandidate(raw: string | undefined, input: TurnRequest, allowFence = false): TurnCandidate {
  let content: unknown;
  try {
    if (typeof raw !== 'string') throw new Error();
    content = JSON.parse(allowFence ? raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim() : raw);
  } catch { throw new ModelOutputError('上次输出不是合法 JSON。请按结构重新生成一次，不输出代码块。'); }
  // Listening has no evidence/card work. Keep every supplied field visible to validation.
  const normalized = input.mode === 'listen' && content && typeof content === 'object' && !Array.isArray(content)
    ? { findings: [], warnings: [], ...content } : content;
  const parsed = modelContentSchema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => ({ code: i.code, path: i.path.join('.') }));
    console.warn(JSON.stringify({ stage: 'agent_validation', code: 'SCHEMA', issues }));
    throw new ModelOutputError(`上次结构不合法：${JSON.stringify(issues)}。严格按照给定 JSON 字段，只提供内容字段、精确引用及合法类型。`);
  }
  const p = parsed.data;
  // Namespace all model ids to the current run, preventing collisions with earlier findings.
  const ids = new Map(p.findings.map(f => [f.id, `${input.runId}_${f.id}`]));
  const candidate = candidateSchema.safeParse({ ...realMetadata(input), assistantText: p.assistantText,
    findings: p.findings.map(f => ({ ...f, id: ids.get(f.id), validity: 'draft' })), warnings: p.warnings, supportGuidance: p.supportGuidance,
    ...(p.practiceSetup ? { practiceSetup: p.practiceSetup } : {}),
    ...(p.interviewUpdate ? { interviewUpdate: p.interviewUpdate } : {}),
    ...(p.card ? { cardDraft: { ...p.card, sections: p.card.sections.map(s => ({ ...s, findingIds: s.findingIds.map(id => ids.get(id) ?? id) })),
      id: `${input.runId}_card`, caseId: input.sessionId, revision: 1, parentRevision: null, validity: 'draft', createdAt: new Date().toISOString(), serviceMode: 'real' } } : {}) });
  if (!candidate.success) throw new ModelOutputError('上次候选结构不合法。请按给定结构生成，使用简短的标识符。');
  return candidate.data;
}
export function modelCandidateErrors(candidate: TurnCandidate, input: TurnRequest): string[] {
  return [...validateCandidate(candidate, input), ...responseStyleErrors(candidate.assistantText, input, candidate.supportGuidance, candidate.interviewUpdate?.stage)];
}
export function candidateOutputError(errors: string[]): ModelOutputError {
  console.warn(JSON.stringify({ stage: 'agent_validation', code: 'CANDIDATE', errors }));
  return new ModelOutputError(`上次候选被程序拒绝：${errors.join(',')}。重新核对模式、长度、引用和卡片关联，生成合法 JSON。若错误是 STYLE_NO_BLAMING_OPENER，去掉强调“又”或责怪用户的开场，温和地回应具体处境，不复述失败标签。不允许捏造原文。若错误是 REJECTED_INTERPRETATION_REPEATED，表示仍在推荐用户否认过的评价角度；彻底撤下这个角度，必要时只输出原话与未知，练习也要换题。`,
    errors.some(e => e.includes('EVIDENCE')));
}

export async function* streamRealProviderText(input: TurnRequest, signal: AbortSignal, fetcher: typeof fetch = providerFetch): AsyncGenerator<string> {
  const { target, ...prompt } = prepareModelRequest(input);
  const response = await requestModel(target, modelBody(target, prompt, true), signal, fetcher);
  yield* readAgentSse(response, target.anthropic, signal);
}

export class RealProvider implements AgentProvider {
  constructor(private fetcher: typeof fetch = providerFetch) {}
  async generate(input: TurnRequest, signal: AbortSignal, initialRepair?: ModelOutputError): Promise<TurnCandidate> {
    signal.throwIfAborted();
    const local = localAgentReply(input);
    if (local) return { ...realMetadata(input), ...local, findings: [], warnings: [] };
    const { target, ...prompt } = prepareModelRequest(input);
    // Worker fetch is receiver-sensitive; pass the stored function to a standalone call.
    const fetcher = this.fetcher;
    let repair = initialRepair?.repair ?? '';
    for (let attempt = initialRepair ? 1 : 0; attempt < 2; attempt++) {
      const system = prompt.system + (repair ? '\n' + repair : '');
      const response = await requestModel(target, modelBody(target, { ...prompt, system }), signal, fetcher);
      const raw = textReply(await readProviderJson(response, 160000, signal), target.anthropic);
      let candidate: TurnCandidate;
      try { candidate = parseModelCandidate(raw, input, true); }
      catch (error) {
        if (attempt || !(error instanceof ModelOutputError)) throw error;
        repair = error.repair; continue;
      }
      const errors = modelCandidateErrors(candidate, input);
      if (!errors.length && input.mode !== 'listen' && !candidate.supportGuidance && input.context.rejectedFindings?.length) {
        // Only contested analysis pays for this bounded audit.
        const data = JSON.stringify({ rejectedFindings: input.context.rejectedFindings, userMessage: input.userMessage, candidate });
        let consistent = false;
        if (bytes(data) <= 64000) {
          const auditPrompt = input.mode === 'interview' ? REJECTION_REVIEW_PROMPT + '\n同样审核 interviewUpdate 的问题、关注点和轮次笔记。' : REJECTION_REVIEW_PROMPT;
          const audit = await requestModel(target, modelBody(target, { system: auditPrompt, data, maxTokens: 128, temperature: 0 }), signal, fetcher);
          const text = textReply(await readProviderJson(audit, 16000, signal), target.anthropic);
          try {
            const verdict = JSON.parse(text ?? '');
            consistent = verdict.consistent === true && Object.keys(verdict).length === 1;
          } catch { /* Invalid audit cannot approve a candidate. */ }
        }
        if (!consistent) errors.push('REJECTED_INTERPRETATION_REPEATED');
      }
      if (!errors.length) return candidate;
      if (attempt && input.mode !== 'interview' && errors.every(e => e === 'REJECTED_INTERPRETATION_REPEATED' || e === 'REJECTED_FINDING_REPEATED')) return correctionFallback(input);
      const error = candidateOutputError(errors);
      if (attempt) throw error;
      repair = error.repair;
    }
    throw new AppError('INVALID_MODEL_OUTPUT', 502, true);
  }
}
