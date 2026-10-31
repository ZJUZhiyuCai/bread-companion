import type { TurnCandidate, TurnRequest } from '@/domain/types';
import { candidateSchema, modelContentSchema } from '@/domain/schemas';
import { requestSegments } from '@/domain/context-builder';
import { validateCandidate } from '@/domain/evidence';
import { needsImmediateSupport, SUPPORT_TEXT } from '@/domain/policy';
import { systemPrompt } from '@/prompts/agent';
import { config } from '@/server/config';
import { AppError } from '@/server/errors';
import type { AgentProvider } from './agent';
import { readProviderJson } from './response';
import { responseStyleErrors } from '@/domain/response-style';

export class RealProvider implements AgentProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  async generate(input: TurnRequest, signal: AbortSignal): Promise<TurnCandidate> {
    const cfg = config();
    const companion = input.mode === 'listen' && !!cfg.companionModel;
    const call = input.mode === 'listen' && input.channel === 'call' && !!cfg.callModel;
    const model = call ? cfg.callModel : companion ? cfg.companionModel : cfg.agentModel;
    const protocol = call ? cfg.callProtocol : companion ? cfg.companionProtocol : cfg.agentProtocol;
    if (!cfg.agentKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
    const meta = { requestId: input.requestId, sessionId: input.sessionId, runId: input.runId, epoch: input.epoch, contextRevision: input.contextRevision, serviceMode: 'real' as const };
    if (needsImmediateSupport(input.userMessage)) return { ...meta, assistantText: SUPPORT_TEXT, findings: [], warnings: [], supportGuidance: true };
    const history: typeof input.context.recentMessages = [];
    let historyBytes = 0;
    for (const m of [...input.context.recentMessages].reverse()) {
      const size = Buffer.byteLength(m.text, 'utf8');
      if (historyBytes + size > 12000) break;
      history.unshift(m); historyBytes += size;
    }
    const segments = requestSegments(input);
    // Listening already has the recent utterances: don't send the same text a third time as evidence.
    const sourceSegments = input.mode === 'listen' ? segments.filter(s => !history.some(m => m.role === 'user' && m.text.includes(s.text)) && !input.userMessage.includes(s.text)) : segments;
    const recentMessages = history.at(-1)?.role === 'user' && history.at(-1)?.text === input.userMessage ? history.slice(0, -1) : history;
    const data = JSON.stringify({ mode: input.mode, channel: input.channel ?? 'text', userMessage: input.userMessage, recentMessages, sourceSegments, preferences: input.context.preferences, selectedQuestion: input.context.selectedQuestion, practiceCriteria: input.context.practiceCriteria });
    // Conservative UTF-8 byte ceiling for variable-tokenizer providers; never called an exact token count.
    // Actual generated tokens are independently limited by max_tokens; no unbounded history or audio is sent.
    if (Buffer.byteLength(data, 'utf8') > 36000) throw new AppError('INVALID_INPUT', 413);
    let repair = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const system = systemPrompt(input.mode, input.mode === 'practice' && !input.context.selectedQuestion, input.channel) + repair;
      const anthropic = protocol === 'anthropic';
      const maxTokens = input.mode === 'listen' ? 768 : 4096;
      const body = anthropic ? { model, max_tokens: maxTokens, system, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: data }] }
        : { model, max_tokens: maxTokens, temperature: 0.4, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages: [{ role: 'system', content: system }, { role: 'user', content: data }] };
      const response = await this.fetcher(`${cfg.agentBaseUrl.replace(/\/$/, '')}/${anthropic ? 'messages' : 'chat/completions'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.agentKey}`, ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}) }, body: JSON.stringify(body), signal, redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new AppError(response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', response.status === 429 ? 429 : 502, response.status >= 500 || response.status === 429);
      const payload = await readProviderJson(response, 160000, signal) as { content?: { type: string; text?: string }[]; choices?: { message?: { content?: string } }[] };
      let content: unknown;
      try {
        const text = anthropic ? payload.content?.filter(b => b.type === 'text').map(b => b.text ?? '').join('') : payload.choices?.[0]?.message?.content;
        if (typeof text !== 'string') throw new Error();
        content = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
      } catch { repair = '\n上次输出不是合法 JSON。请按结构重新生成一次，不输出代码块。'; if (!attempt) continue; throw new AppError('INVALID_MODEL_OUTPUT', 502, true); }
      const parsed = modelContentSchema.safeParse(content);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(i => ({ code: i.code, path: i.path.join('.') }));
        console.warn(JSON.stringify({ stage: 'agent_validation', code: 'SCHEMA', issues }));
        repair = `\n上次结构不合法：${JSON.stringify(issues)}。严格按照给定 JSON 字段，只提供内容字段、精确引用及合法类型。`;
        if (!attempt) continue; throw new AppError('INVALID_MODEL_OUTPUT', 502, true);
      }
      const p = parsed.data;
      // Namespace all model ids to the current run, preventing collisions with earlier findings.
      const ids = new Map(p.findings.map(f => [f.id, `${input.runId}_${f.id}`]));
      const candidate = candidateSchema.parse({ ...meta, assistantText: p.assistantText, findings: p.findings.map(f => ({ ...f, id: ids.get(f.id), validity: 'draft' })), warnings: p.warnings, supportGuidance: p.supportGuidance, ...(p.practiceSetup ? { practiceSetup: p.practiceSetup } : {}),
        ...(p.card ? { cardDraft: { ...p.card, sections: p.card.sections.map(s => ({ ...s, findingIds: s.findingIds.map(id => ids.get(id) ?? id) })), id: `${input.runId}_card`, caseId: input.sessionId, revision: 1, parentRevision: null, validity: 'draft', createdAt: new Date().toISOString(), serviceMode: 'real' } } : {}) });
      const errors = [...validateCandidate(candidate, input), ...responseStyleErrors(candidate.assistantText, input, candidate.supportGuidance)];
      if (!errors.length) return candidate;
      console.warn(JSON.stringify({ stage: 'agent_validation', code: 'CANDIDATE', errors }));
      repair = `\n上次候选被程序拒绝：${errors.join(',')}。重新核对模式、长度、引用和卡片关联，生成合法 JSON。不允许捏造原文。`;
      if (attempt) throw new AppError(errors.some(e => e.includes('EVIDENCE')) ? 'EVIDENCE_MISMATCH' : 'INVALID_MODEL_OUTPUT', 502, true);
    }
    throw new AppError('INVALID_MODEL_OUTPUT', 502, true);
  }
}
