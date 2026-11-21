import { describe, expect, it } from 'vitest';
import { callSource } from '@/domain/call-pipeline';
import { buildTurn, CONTEXT_LIMITS } from '@/domain/context-builder';
import { locateEvidence, validateCandidate } from '@/domain/evidence';
import { explicitIntent, interviewControlIntent, isActionOnly } from '@/domain/policy';
import { currentCard, initialState, isCurrent, reducer } from '@/domain/reducer';
import { responseStyleErrors } from '@/domain/response-style';
import { candidateSchema, interviewStateSchema, interviewUpdateSchema, modelContentSchema, turnRequestSchema } from '@/domain/schemas';
import type { SessionState, Source, TurnCandidate, TurnRequest } from '@/domain/types';
import { systemPrompt } from '@/prompts/agent';
import { mockCandidate } from '@/server/providers/mock-agent';
import { turnLane } from '@/server/agent-turn';

const start = (maxRounds = 4) => reducer(initialState('session_interview', 'case_interview'), { type: 'START_INTERVIEW', maxRounds, role: ' 前端工程师 ', topic: ' 页面性能 ' });
const addUtterance = (state: SessionState, text: string) => reducer(state, { type: 'USER', text, source: callSource(text) });
const material: Source = { id: 'jd', origin: 'source_quote', revision: 1, label: '职位描述', text: '负责维护 React 页面，分析用户体验。', confirmed: true };

function takeTurn(state: SessionState, text: string) {
  const runId = 'run_' + (state.messages.length + 1);
  const running = reducer(addUtterance(state, text), { type: 'RUN', runId, activity: 'generating' });
  const input = { ...buildTurn(running, text, runId, 'request_' + runId), channel: 'call' as const };
  const candidate = candidateSchema.parse(mockCandidate(turnRequestSchema.parse(input)));
  expect(isCurrent(running, candidate)).toBe(true);
  expect(validateCandidate(candidate, input)).toEqual([]);
  expect(style(candidate, input)).toEqual([]);
  return { state: reducer(running, { type: 'CANDIDATE', candidate }), running, input, candidate };
}

const style = (candidate: TurnCandidate, input: TurnRequest) => responseStyleErrors(candidate.assistantText, input, candidate.supportGuidance, candidate.interviewUpdate?.stage);

describe('interview domain and mock progression', () => {
  it('bounds setup, invalidates in-flight tokens on controls, and avoids creating state outside a live interview', () => {
    expect(initialState().interview).toBeNull();
    const original = start();
    const started = reducer(original, { type: 'START_INTERVIEW', style: 'realistic', role: ' ' + '岗'.repeat(100), topic: ' ' + '题'.repeat(130), maxRounds: 99 });
    expect(started.interview).toMatchObject({ style: 'realistic', stage: 'opening', round: 0, maxRounds: 6, role: '岗'.repeat(80), topic: '题'.repeat(120) });
    expect(started).toMatchObject({ started: true, mode: 'interview', activity: 'idle', epoch: 2, contextRevision: 2, activeRunId: null });
    expect(start(-1).interview?.maxRounds).toBe(1);
    expect(start(2.8).interview?.maxRounds).toBe(2);
    const first = takeTurn(started, '开始模拟面试');
    const changed = reducer(first.running, { type: 'SET_INTERVIEW_STYLE', style: 'gentle' });
    expect(changed).toMatchObject({ activity: 'idle', epoch: first.running.epoch + 1, contextRevision: first.running.contextRevision + 1, activeRunId: null, interview: { style: 'gentle' } });
    expect(reducer(changed, { type: 'CANDIDATE', candidate: first.candidate })).toBe(changed);
    const debrief = reducer(first.state, { type: 'REQUEST_INTERVIEW_DEBRIEF' });
    expect(debrief.interview).toMatchObject({ stage: 'debrief', round: 1, currentQuestion: first.candidate.interviewUpdate!.question });
    expect(debrief.epoch).toBe(first.state.epoch + 1);
    expect(debrief.contextRevision).toBe(first.state.contextRevision + 1);
    const exited = reducer(debrief, { type: 'EXIT_INTERVIEW' });
    expect(exited).toMatchObject({ mode: 'listen', interview: null, activity: 'idle', epoch: debrief.epoch + 1, contextRevision: debrief.contextRevision + 1 });
    expect(reducer(exited, { type: 'REQUEST_INTERVIEW_DEBRIEF' })).toBe(exited);
    expect(reducer(exited, { type: 'SET_INTERVIEW_STYLE', style: 'realistic' })).toBe(exited);
    expect(reducer(exited, { type: 'MODE', mode: 'interview' }).interview).toEqual({ ...original.interview, role: '', topic: '' });
    expect(reducer(original, { type: 'MODE', mode: 'review' }).interview).toBeNull();
    expect(reducer(original, { type: 'PREPARE_PRACTICE' }).interview).toBeNull();
  });

  it('asks an opening question from the material, drills down in both styles, and exports a draft snapshot with verified answer evidence', () => {
    const state = reducer(initialState(), { type: 'START_INTERVIEW', maxRounds: 3 });
    const proposed = takeTurn(reducer(state, { type: 'ADD_SOURCE', source: material }), '来一段模拟面试');
    const first = proposed.state;
    expect(first.interview).toMatchObject({ stage: 'question', round: 1, notes: [] });
    expect(first.interview!.currentQuestion).toContain('页面性能');
    expect(first.interview!.focusPoints).toHaveLength(2);
    expect(first.contextRevision).toBe(proposed.running.contextRevision + 1);
    const gentle = takeTurn(first, '我先定位接口耗时，再看页面的缓存设置。');
    expect(gentle.candidate.assistantText).toContain('你提到了接口');
    expect(gentle.state.interview).toMatchObject({ stage: 'follow_up', round: 2, notes: [{ round: 1, question: first.interview!.currentQuestion }] });
    const realistic = takeTurn(reducer(gentle.state, { type: 'SET_INTERVIEW_STYLE', style: 'realistic' }), '我做了对照组，用日志观察加载时间。');
    expect(realistic.candidate.assistantText).toMatch(/关键假设.*发现/);
    expect(realistic.state.interview!.round).toBe(3);
    const final = takeTurn(realistic.state, '我接了监控，发现失败率从百分之五降到了百分之一。');
    expect(final.state.interview).toMatchObject({ stage: 'debrief', round: 3, currentQuestion: realistic.state.interview!.currentQuestion });
    expect(final.state.interview!.notes.map(note => note.round)).toEqual([1, 2, 3]);
    expect(final.candidate.findings.map(f => f.kind)).toEqual(['reported_fact', 'unknown', 'practice_suggestion']);
    expect(final.candidate.cardDraft).toMatchObject({ type: 'review', title: '这场模拟的小复盘', validity: 'draft' });
    const refs = final.candidate.findings.flatMap(f => f.evidenceRefs);
    expect(refs).toHaveLength(2);
    expect(refs.every(ref => ref.sourceId !== material.id && locateEvidence(final.state.sources, ref, true))).toBe(true);
    const ended = reducer(final.state, { type: 'END' });
    expect(ended).toMatchObject({ interview: null, sources: [], messages: [] });
    expect(ended.endSnapshot?.evidence[0]).toMatchObject({ quote: '我接了监控，发现失败率从百分之五降到了百分之一。', confirmed: true });
    expect(currentCard(ended)?.validity).toBe('draft');
    expect(currentCard(reducer(ended, { type: 'CONFIRM_END_CARD' }))?.validity).toBe('confirmed');
  });

  it('does not use the opening command, pasted JD or past chat as an answer in an early debrief', () => {
    const past = addUtterance(initialState(), '我上次准备了一个监控的例子。');
    const first = takeTurn(reducer(reducer(past, { type: 'START_INTERVIEW' }), { type: 'ADD_SOURCE', source: material }), '模拟面试');
    const { candidate } = takeTurn(reducer(first.state, { type: 'REQUEST_INTERVIEW_DEBRIEF' }), '帮我复盘这场模拟');
    expect(candidate.interviewUpdate).toEqual({ stage: 'debrief' });
    expect(candidate.findings.map(f => f.kind)).toEqual(['unknown', 'practice_suggestion']);
    expect(candidate.findings.flatMap(f => f.evidenceRefs)).toEqual([]);

    const answered = takeTurn(first.state, '我用埋点记录了首屏的数据。');
    const reviewed = takeTurn(reducer(answered.state, { type: 'REQUEST_INTERVIEW_DEBRIEF' }), '结束模拟');
    expect(reviewed.candidate.findings[0].evidenceRefs[0].quote).toBe('我用埋点记录了首屏的数据。');
    expect(reviewed.state.interview!.notes).toEqual(answered.state.interview!.notes);
  });

  it('keeps evidence from an earlier simulation out of a new debrief even when the opening question is repeated', () => {
    const first = takeTurn(start(), '模拟面试').state;
    const answered = takeTurn(first, '我通过回滚解决了一次线上故障。').state;
    const restarted = reducer(answered, { type: 'START_INTERVIEW', role: '前端工程师', topic: '页面性能' });
    const newQuestion = takeTurn(restarted, '模拟面试').state;
    expect(newQuestion.interview!.currentQuestion).toBe(first.interview!.currentQuestion);
    const debrief = takeTurn(reducer(newQuestion, { type: 'REQUEST_INTERVIEW_DEBRIEF' }), '结束面试');
    expect(debrief.input.context.sourceSegments).toEqual([]);
    expect(debrief.candidate.findings.every(f => f.evidenceRefs.length === 0)).toBe(true);
  });

  it('preserves the support escape hatch and clears all interview context', () => {
    const first = takeTurn(start(), '模拟面试');
    const urgent = takeTurn(first.state, '我现在准备伤害自己');
    expect(urgent.candidate).toMatchObject({ supportGuidance: true, findings: [] });
    expect(urgent.candidate.interviewUpdate).toBeUndefined();
    expect(urgent.state).toMatchObject({ mode: 'listen', interview: null, supportState: 'support_guidance' });
  });
});

describe('interview protocol and evidence', () => {
  it('keeps the interview shapes narrow and validates stage, modes, focus points and bounds', () => {
    const { input, candidate } = takeTurn(start(), '模拟面试');
    const { interview } = input.context;
    expect(interviewStateSchema.safeParse(interview).success).toBe(true);
    expect(interviewStateSchema.safeParse({ ...interview, maxRounds: 7 }).success).toBe(false);
    expect(interviewStateSchema.safeParse({ ...interview, round: 5 }).success).toBe(false);
    expect(interviewStateSchema.safeParse({ ...interview, notes: [{ round: 1, question: '问什么？', confirmed: true }] }).success).toBe(false);
    expect(interviewUpdateSchema.safeParse({ stage: 'opening' }).success).toBe(false);
    expect(interviewUpdateSchema.safeParse({ stage: 'question', focusPoints: ['一', '二', '三'] }).success).toBe(false);
    expect(turnRequestSchema.safeParse({ ...input, mode: 'listen' }).success).toBe(false);
    expect(candidateSchema.safeParse({ ...candidate, interviewUpdate: { ...candidate.interviewUpdate, save: true } }).success).toBe(false);
    const { assistantText, interviewUpdate } = candidate;
    expect(modelContentSchema.safeParse({ assistantText, interviewUpdate, findings: [] }).success).toBe(true);
    expect(modelContentSchema.safeParse({ assistantText, interviewUpdate: { ...interviewUpdate, roundNote: { gap: '练习', save: true } }, findings: [] }).success).toBe(false);
  });

  it('requires the next question and blocks premature cards, unsolicited updates and resuming after the round limit', () => {
    const { input, candidate, state } = takeTurn(start(1), '模拟面试');
    const { candidate: review, input: debriefInput } = takeTurn(state, '我补了一组缓存命中率的监控。');
    expect(validateCandidate({ ...candidate, interviewUpdate: undefined }, input)).toContain('INTERVIEW_UPDATE_REQUIRED');
    expect(validateCandidate({ ...candidate, interviewUpdate: { stage: 'question', question: '  ' } }, input)).toContain('INTERVIEW_QUESTION_REQUIRED');
    expect(validateCandidate({ ...candidate, cardDraft: review.cardDraft }, input)).toContain('INTERVIEW_QA_NO_CARD');
    expect(validateCandidate({ ...candidate, supportGuidance: true }, input)).toContain('INTERVIEW_UPDATE_NOT_REQUESTED');
    expect(validateCandidate(candidate, { ...input, mode: 'listen' })).toContain('INTERVIEW_UPDATE_NOT_REQUESTED');
    expect(validateCandidate({ ...review, interviewUpdate: candidate.interviewUpdate }, debriefInput)).toContain('INTERVIEW_DEBRIEF_REQUIRED');
  });

  it('checks real evidence, confirmation, unsupported sections, card type, and rejected findings in a debrief', () => {
    const { state } = takeTurn(start(1), '模拟面试');
    const { input, candidate } = takeTurn(state, '我做了缓存压测并用日志记录命中率。');
    const fabricated = structuredClone(candidate);
    fabricated.findings[0].evidenceRefs[0].quote = '捏造的数字';
    expect(validateCandidate(fabricated, input)).toContain('EVIDENCE_MISMATCH');
    const unconfirmed = structuredClone(input);
    unconfirmed.context.sourceSegments![0].confirmed = false;
    expect(validateCandidate(candidate, unconfirmed)).toContain('EVIDENCE_MISMATCH');
    const card = structuredClone(candidate);
    card.cardDraft!.type = 'note';
    card.cardDraft!.sections[0].findingIds = [];
    card.findings[0].validity = 'confirmed';
    expect(validateCandidate(card, input)).toEqual(expect.arrayContaining(['MODE_VIOLATION', 'UNSUPPORTED_SECTION', 'MODEL_CANNOT_CONFIRM']));
    input.context.rejectedFindings = [{ text: ' ' + candidate.findings[0].text + '！', sources: [], mode: 'interview' }];
    expect(validateCandidate(candidate, input)).toContain('REJECTED_FINDING_REPEATED');
    expect(validateCandidate(mockCandidate(input), input)).toEqual([]);
  });

  it('budgets full interview snapshots and reserves the actual latest answer ahead of pasted material', () => {
    const inProgress = takeTurn(start(), '开始模拟面试').state;
    let state = reducer(inProgress, { type: 'ADD_SOURCE', source: { ...material, text: '缓存'.repeat(10000) } });
    const large = '我做了缓存测试'.repeat(500);
    for (let i = 0; i < 13; i++) state = addUtterance(state, large);
    const text = '这轮回答是从对照组定位到的';
    state = addUtterance(state, text);
    const input = { ...buildTurn(state, text, 'large_run', 'large_request'), channel: 'call' as const };
    expect(input.context.interview).toEqual(state.interview);
    expect(input.context.sourceSegments?.[0]).toMatchObject({ sourceId: state.sources.at(-1)!.id, text });
    expect(input.context.sourceSegments?.some(s => s.sourceId === 'jd')).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThanOrEqual(CONTEXT_LIMITS.wireBytes);
    expect(turnRequestSchema.safeParse(input).success).toBe(true);
  });

  it('sets the correct style limits and provider lane for active rounds and both debrief paths', () => {
    const { input, state } = takeTurn(start(1), '模拟面试');
    const question = '字'.repeat(158) + '？？';
    expect(responseStyleErrors(question, input)).toEqual([]);
    expect(responseStyleErrors(question + '？', input)).toEqual(['STYLE_LENGTH_MAX_160', 'STYLE_TWO_QUESTIONS']);
    expect(responseStyleErrors('字'.repeat(260), { ...input, channel: 'text' })).toEqual([]);
    expect(responseStyleErrors('字'.repeat(261), { ...input, channel: 'text' })).toEqual(['STYLE_LENGTH_MAX_260']);
    expect(responseStyleErrors(question, { mode: 'listen', channel: 'call' })).toEqual(['STYLE_LENGTH_MAX_100', 'STYLE_ONE_QUESTION']);
    expect(responseStyleErrors('字'.repeat(181), { mode: 'listen' })).toEqual(['STYLE_LENGTH_MAX_180']);
    expect(responseStyleErrors('字'.repeat(240), { mode: 'review', channel: 'call' })).toEqual([]);
    expect(turnLane(input)).toBe('call');
    expect(turnLane({ ...input, channel: 'text' })).toBe('analysis');
    for (const interview of [state.interview!, { ...input.context.interview!, stage: 'debrief' as const }]) {
      const next = { ...input, context: { ...input.context, interview } };
      expect(turnLane(next)).toBe('analysis');
      expect(responseStyleErrors('字'.repeat(238) + '？？', next)).toEqual(['STYLE_ONE_QUESTION']);
      expect(responseStyleErrors('字'.repeat(241), next)).toEqual(['STYLE_LENGTH_MAX_240']);
    }
  });

  it('places assistantText first in each prompt and switches from interviewer to grounded feedback', () => {
    const interview = start().interview!;
    expect(systemPrompt('listen', false, 'call')).toContain('assistantText 必须是第一个字段');
    const gentle = systemPrompt('interview', false, 'call', interview);
    const realistic = systemPrompt('interview', false, 'call', { ...interview, style: 'realistic' });
    const debrief = systemPrompt('interview', false, 'call', { ...interview, stage: 'debrief', style: 'realistic' });
    for (const prompt of [gentle, realistic, debrief]) expect(prompt).toMatch(/"assistantText" 必须是第一个字段.*\{"assistantText":/);
    expect(gentle).toContain('温和陪练');
    expect(realistic).toContain('职责边界');
    expect(debrief).toMatch(/赛后回血复盘.*不打整体数字分数/);
    expect(debrief).toContain('"type":"review"');
    expect(debrief).toContain('已确认回答片段中的精确连续原文');
  });
});

describe('explicit interview commands', () => {
  it.each(['模拟面试', '开始模拟面试', '来一段模拟面试', '你来当面试官', '当面试官问我', '语音模拟面试', '我现在想模拟面试'])('starts for an unambiguous request %s', text => {
    expect(explicitIntent(text)).toBe('interview');
    expect(isActionOnly(text)).toBe(true);
  });
  it.each(['不想模拟面试', '别模拟了', '不模拟了', '回到聊聊', '我先不想模拟面试，还是聊聊吧'])('leaves interview mode for %s', text => {
    expect(explicitIntent(text)).toBe('listen');
    expect(interviewControlIntent(text)).toBeNull();
  });
  it.each(['他说模拟面试', '以前模拟面试过', '我不知道要不要模拟面试', '“语音模拟面试”', '别严格一点问', '他让我结束面试', '不要结束模拟', '“先到这里复盘一下”'])('takes no control action for %s', text => {
    expect(explicitIntent(text)).toBeNull();
    expect(interviewControlIntent(text)).toBeNull();
    expect(isActionOnly(text)).toBe(false);
  });
  it('routes debrief and style requests separately and retains an appended job detail as material', () => {
    for (const text of ['结束模拟', '结束面试', '先到这里复盘一下', '先到这里，复盘一下', '帮我复盘这场模拟']) {
      expect(interviewControlIntent(text)).toBe('debrief');
      expect(explicitIntent(text)).toBeNull();
      expect(isActionOnly(text)).toBe(true);
    }
    for (const text of ['温和一点', '轻松一点问']) expect(interviewControlIntent(text)).toBe('gentle');
    for (const text of ['严格一点', '深挖一下', '按真实面试来']) expect(interviewControlIntent(text)).toBe('realistic');
    expect(explicitIntent('开始模拟面试，岗位是前端开发。')).toBe('interview');
    expect(isActionOnly('开始模拟面试，岗位是前端开发。')).toBe(false);
  });
});
