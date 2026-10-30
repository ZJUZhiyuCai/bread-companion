import type { BreadViewModel } from '@/domain/view-model';
import type { Activity, Card, EndSnapshot, Mode, Origin, RunToken, SavedCase, Source } from '@/domain/types';
import { candidateSchema, sourceSchema, turnRequestSchema } from '@/domain/schemas';
import { buildTurn } from '@/domain/context-builder';
import { cardCanConfirm, refKey, validateCandidate } from '@/domain/evidence';
import { explicitIntent } from '@/domain/policy';
import { currentCard, initialState, isCurrent, makeEndSnapshot, reducer, uid, type Event } from '@/domain/reducer';
import { deleteSavedCase, fromSnapshot, invalidateSaved, listSaved, MAX_IMPORT_BYTES, parseImport, saveArchive, validateArchive } from './card-store';
import { downloadArchive } from './export';
import { MediaController, normalizeRecording } from './media-controller';
import { RunController } from './run-controller';

const WELCOME = '今晚，先不用把一切想清楚。你可以慢慢说，也可以只是坐一会儿。这里是面包，一个 AI 交流助手。我们可以聊这次面试，也可以只说说现在的感受。想停的时候，随时停。';
export class BreadController {
  private state = initialState();
  private capabilities: BreadViewModel['capabilities'] = null;
  private savedCases: SavedCase[] = [];
  private notice = ''; private error = ''; private transcriptDraft = ''; private recordedSeconds = 0;
  private recording: { token: RunToken; signal: AbortSignal; blob: Blob | null; submitted: boolean } | null = null;
  private run = new RunController(); private disposed = false;
  private artifactVersion = 0;
  private listeners = new Set<() => void>();
  private view: BreadViewModel;
  constructor(private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init), private media = new MediaController()) { this.view = this.buildView(); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.view;
  private publish() { this.view = this.buildView(); for (const f of this.listeners) f(); }
  private dispatch(event: Event) { this.state = reducer(this.state, event); this.publish(); }
  private buildView(): BreadViewModel {
    return { state: this.state, capabilities: this.capabilities, currentCard: currentCard(this.state), savedCases: this.savedCases, notice: this.notice, error: this.error, transcriptDraft: this.transcriptDraft, recordedSeconds: this.recordedSeconds,
      busy: !['idle', 'paused', 'error', 'recorded'].includes(this.state.activity), start: this.start, send: this.send, setMode: this.setMode, stop: this.stop, end: this.end, reset: this.reset, addSource: this.addSource, correctSource: this.correctSource, confirmSource: this.confirmSource, rejectFinding: this.rejectFinding, editCard: this.editCard, confirmCard: this.confirmCard, saveCard: this.saveCard, exportCard: this.exportCard, refreshSaved: this.refreshSaved, deleteSaved: this.deleteSaved, importSaved: this.importSaved, resumeSaved: this.resumeSaved, setPractice: this.setPractice, startRecording: this.startRecording, finishRecording: this.finishRecording, transcribeRecorded: this.transcribeRecorded, cancelRecording: this.cancelRecording, setTranscriptDraft: this.setTranscriptDraft, sendTranscript: this.sendTranscript, speak: this.speak, clearNotice: this.clearNotice };
  }
  async initialize() {
    this.disposed = false;
    try { const res = await this.fetcher('/api/capabilities', { cache: 'no-store' }); if (!res.ok) throw new Error(); const caps = await res.json(); if (!this.disposed) { this.capabilities = caps; this.publish(); } }
    catch { if (!this.disposed) { this.error = '暂时无法读取服务状态，请刷新重试。'; this.publish(); } }
    await this.refreshSaved();
  }
  dispose() { this.disposed = true; this.state = reducer(this.state, { type: 'STOP' }); this.cancelResources(); }
  private cancelResources() { this.run.cancel(); this.media.cancel(); this.recording = null; this.recordedSeconds = 0; }
  private fail(error: unknown, fallback = '操作没有完成，请重试。') { this.error = error instanceof Error ? error.message : fallback; this.publish(); }
  clearNotice = () => { this.notice = ''; this.error = ''; this.publish(); };
  start = (mode: Mode = 'listen', welcome = false) => {
    if (this.state.lifecycle !== 'active') return;
    this.dispatch({ type: 'START', mode, welcome: welcome ? WELCOME : mode === 'listen' ? '想从哪里说起都可以。' : '我们就从一段真实回答开始。可以先添加岗位类别和当时的原话，核对后再复盘。' });
  };
  stop = () => { this.dispatch({ type: 'STOP' }); this.cancelResources(); this.publish(); };
  end = () => { this.dispatch({ type: 'END' }); this.cancelResources(); this.transcriptDraft = ''; this.notice = ''; this.error = ''; this.publish(); };
  reset = () => { this.artifactVersion++; this.stop(); this.transcriptDraft = ''; this.error = ''; this.notice = ''; this.dispatch({ type: 'REPLACE', state: initialState() }); };
  setMode = (mode: Mode) => {
    if (this.state.lifecycle !== 'active') return;
    this.dispatch({ type: 'MODE', mode }); this.cancelResources(); this.error = '';
    if (mode === 'organize' && this.state.sources.length) void this.requestTurn('请把我提供的内容留成一个以后可以看的记号，不添加能力评价。');
    else this.publish();
  };
  send = async (text: string) => {
    text = text.trim(); if (!text || this.state.lifecycle !== 'active') return;
    const intent = explicitIntent(text);
    if (intent === 'stop') { this.stop(); return; } if (intent === 'end') { this.end(); return; }
    if (text.length > 4000) { this.fail(new Error('每次最多发送 4,000 个字符，可以分几段说。')); return; }
    if (intent) { this.dispatch({ type: 'MODE', mode: intent }); this.cancelResources(); }
    else if (this.view.busy || this.state.activity === 'recorded') { this.fail(new Error('请先停止当前操作，或处理已录好的片段。')); return; }
    if (this.state.mode === 'practice' && (!this.state.selectedQuestion || !this.state.practiceCriteria.length)) { this.fail(new Error('先选择一道题和一到两个练习维度，再发送回答。')); return; }
    if (!this.state.started) this.start();
    this.error = '';
    const source: Source = { id: uid('source'), revision: 1, origin: 'user_recollection', label: intent ? '本次请求' : this.state.mode === 'practice' ? '本次练习回答' : '我说的话', text, confirmed: true };
    this.dispatch({ type: 'USER', text, source });
    await this.requestTurn(text);
  };
  private async requestTurn(text: string) {
    if (this.state.lifecycle !== 'active') return;
    const { token, signal } = this.run.begin(this.state);
    this.dispatch({ type: 'RUN', runId: token.runId, activity: 'generating' });
    const request = buildTurn(this.state, text, token.runId, uid('request'));
    try {
      const validated = turnRequestSchema.safeParse(request); if (!validated.success) throw new Error('请检查材料长度，并为练习选择问题和维度。');
      const res = await this.fetcher('/api/agent/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
      const json = await res.json(); if (!isCurrent(this.state, token) || signal.aborted) return;
      if (!res.ok) throw new Error(json.error?.userMessage || '回复没有完成，可以稍后重试。');
      this.dispatch({ type: 'ACTIVITY', token, activity: 'validating' });
      const candidate = candidateSchema.parse(json);
      if (validateCandidate(candidate, request).length) throw new Error('这次回复没有通过引用与版本检查，已丢弃。');
      if (!isCurrent(this.state, token) || signal.aborted) return;
      this.dispatch({ type: 'CANDIDATE', candidate });
    } catch (e) { if (isCurrent(this.state, token) && !signal.aborted) { this.dispatch({ type: 'FINISH', token, activity: 'error' }); this.fail(e); } }
  }
  addSource = (text: string, origin: Origin, label: string) => {
    if (this.state.lifecycle !== 'active') return;
    const s = sourceSchema.safeParse({ id: uid('source'), revision: 1, origin, label: label.trim() || '补充材料', text: text.trim(), confirmed: false });
    if (!s.success) { this.fail(new Error('材料需为 1—20,000 字符，标题最多 100 字符。')); return; }
    if (this.state.sources.length >= 24) { this.fail(new Error('当前案例材料已较多，请先结束并开始新案例。')); return; }
    this.dispatch({ type: 'ADD_SOURCE', source: s.data }); this.cancelResources(); this.publish();
  };
  correctSource = (id: string, text: string) => {
    if (this.state.lifecycle !== 'active' || !text.trim() || text.length > 20000) return;
    if (this.state.messages.some(m => m.sourceId === id) && text.length > 4000) { this.fail(new Error('聊天原话最多 4,000 字符，较长材料可另行添加。')); return; }
    this.artifactVersion++;
    const caseId = this.state.caseId;
    this.dispatch({ type: 'CORRECT_SOURCE', id, text: text.trim() }); this.cancelResources();
    this.notice = '来源已更新，相关旧分析已失效。核对并确认来源后，可以重新整理。'; this.publish();
    void invalidateSaved(caseId, id).then(this.refreshSaved).catch(e => this.fail(e));
  };
  confirmSource = (id: string) => { this.dispatch({ type: 'CONFIRM_SOURCE', id }); this.cancelResources(); this.publish(); };
  rejectFinding = (id: string) => {
    this.artifactVersion++;
    const caseId = this.state.caseId; this.dispatch({ type: 'REJECT', id }); this.cancelResources();
    this.notice = '已标记为有争议，相关卡片需重新整理和确认。'; this.publish();
    void invalidateSaved(caseId, undefined, id).then(this.refreshSaved).catch(e => this.fail(e));
  };
  editCard = (title: string, sections: Card['sections']) => {
    if (!title.trim() || title.length > 100 || sections.some(s => s.text.length > 3000)) { this.fail(new Error('卡片标题最多 100 字，每一栏最多 3,000 字。')); return; }
    this.dispatch({ type: 'EDIT_CARD', title: title.trim(), sections });
  };
  confirmCard = () => {
    const card = currentCard(this.state); if (!card || !cardCanConfirm(card, this.state.findings, this.state.sources)) { this.fail(new Error('请先确认引用材料；失效或有争议的卡片需要重新整理。')); return; }
    this.dispatch({ type: 'CONFIRM_CARD' }); this.notice = '表述已确认，尚未保存到本设备。'; this.publish();
  };
  private selectedSnapshot(): EndSnapshot {
    const snapshot = this.state.lifecycle === 'ended' ? this.state.endSnapshot : makeEndSnapshot(this.state);
    if (!snapshot) throw new Error('请先确认当前有效的卡片，再保存或导出。');
    return structuredClone(snapshot);
  }
  saveCard = async () => {
    this.error = ''; this.notice = ''; this.publish();
    try {
      const snapshot = this.selectedSnapshot(); const selected = fromSnapshot(snapshot);
      const artifactVersion = this.artifactVersion;
      const sourceVersions = snapshot.evidence.map(e => [e.sourceId, e.sourceRevision] as const);
      const canSave = () => {
        if (this.state.caseId !== selected.caseId || this.artifactVersion !== artifactVersion) return false;
        // Ending cancels Agent/media runs, not an already selected valid local save transaction.
        if (this.state.lifecycle === 'ended') return true;
        return sourceVersions.every(([id, revision]) => this.state.sources.some(s => s.id === id && s.revision === revision && s.confirmed)) && snapshot.findings.every(f => !this.state.findings.some(v => v.id === f.id && ['stale', 'disputed'].includes(v.validity)));
      };
      await saveArchive(selected, canSave);
      this.notice = `已保存版本 ${snapshot.card.revision} 到本设备的当前浏览器。`; this.error = ''; await this.refreshSaved(); this.publish();
    } catch (e) { this.fail(e, '保存未完成。卡片仍在，可以重试或导出。'); }
  };
  exportCard = (format: 'md' | 'json') => { try { downloadArchive(fromSnapshot(this.selectedSnapshot()), format); this.notice = '已生成下载文件，请在浏览器下载列表查看。'; this.publish(); } catch (e) { this.fail(e); } };
  refreshSaved = async () => { try { const cases = await listSaved(); if (!this.disposed) { this.savedCases = cases; this.publish(); } } catch (e) { if (!this.disposed) this.fail(e); } };
  deleteSaved = async (caseId: string) => {
    // Invalidate in-memory snapshots synchronously so pending export/save cannot resurrect a deleted case.
    if (this.state.caseId === caseId) { this.artifactVersion++; this.dispatch({ type: 'DELETE_CASE', caseId }); this.cancelResources(); this.transcriptDraft = ''; }
    try { await deleteSavedCase(caseId); this.notice = '已从本设备的当前浏览器删除该案例。'; await this.refreshSaved(); } catch (e) { this.fail(e); }
  };
  importSaved = async (file: File) => {
    try { if (file.size > MAX_IMPORT_BYTES) throw new Error('JSON 文件超过 1 MiB 上限'); const data = parseImport(await file.text()); await saveArchive(data); this.notice = '已导入本地卡片。不会自动上传或恢复未保存的聊天。'; await this.refreshSaved(); } catch { this.fail(new Error('导入失败：文件格式、版本、引用或大小不符合要求。已有存档未被覆盖。')); }
  };
  resumeSaved = (input: SavedCase) => {
    try {
      const saved = validateArchive(input);
      this.artifactVersion++;
      this.stop(); const state = initialState(); state.started = true; state.mode = 'listen';
      const evidence = saved.selectedEvidence.filter(e => saved.findings.some(f => f.validity === 'confirmed' && f.evidenceRefs.some(r => refKey(r) === refKey(e))));
      state.sources = evidence.map(e => ({ id: uid('source'), revision: 1, origin: e.origin, label: '从已保存卡片带入的摘录', text: e.quote, confirmed: false }));
      state.messages = [{ id: uid('message'), role: 'assistant', text: '这是一次新的临时会话，只带入你保存的来源摘录，先作为待核对材料。可以继续看一道题，也可以聊别的，或暂时不看。' }];
      this.notice = '已打开新的临时会话；旧存档仍保留。'; this.error = ''; this.transcriptDraft = ''; this.dispatch({ type: 'REPLACE', state });
    } catch (e) { this.fail(e); }
  };
  setPractice = (question: string, criteria: string[]) => {
    if (!question.trim() || question.length > 1000 || !criteria.length || criteria.length > 2 || criteria.some(c => !c.trim() || c.length > 100)) { this.fail(new Error('请选定一道题和一到两个练习维度。')); return; }
    this.dispatch({ type: 'PRACTICE', question: question.trim(), criteria }); this.cancelResources(); this.publish();
  };
  startRecording = async () => {
    if (this.state.lifecycle !== 'active') return;
    if (!this.capabilities?.asr.available || !globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { this.fail(new Error('当前环境无法录音或转写，请使用文字输入。')); return; }
    this.stop(); this.error = ''; this.transcriptDraft = '';
    const { token, signal } = this.run.begin(this.state); this.recording = { token, signal, blob: null, submitted: false };
    this.dispatch({ type: 'RUN', runId: token.runId, activity: 'requesting_mic' });
    try {
      const started = await this.media.start(() => isCurrent(this.state, token) && !signal.aborted,
        seconds => { if (isCurrent(this.state, token)) { this.recordedSeconds = seconds; this.publish(); } },
        blob => { if (isCurrent(this.state, token) && this.recording) { this.recording.blob = blob; this.dispatch({ type: 'ACTIVITY', token, activity: 'recorded' }); this.notice = '已录到一分钟上限。你可以选择转写这段录音，或放弃。'; this.publish(); } },
        () => { if (isCurrent(this.state, token)) { this.stop(); this.fail(new Error('录音中断或超过大小限制，请重试或打字。')); } });
      if (started && isCurrent(this.state, token)) this.dispatch({ type: 'ACTIVITY', token, activity: 'recording' });
    } catch { if (isCurrent(this.state, token)) { this.stop(); this.fail(new Error('未能启用麦克风。可以检查权限，或继续打字。')); } }
  };
  finishRecording = async () => {
    const recording = this.recording;
    if (!recording || recording.submitted || !isCurrent(this.state, recording.token)) return;
    recording.submitted = true; this.dispatch({ type: 'ACTIVITY', token: recording.token, activity: 'transcribing' });
    const blob = await this.media.finish();
    if (blob && isCurrent(this.state, recording.token) && !recording.signal.aborted) await this.transcribe(blob, recording.token, recording.signal);
    else if (isCurrent(this.state, recording.token)) { this.stop(); this.fail(new Error('没有录到可用声音，可以重试或打字。')); }
  };
  transcribeRecorded = async () => {
    const r = this.recording; if (!r?.blob || r.submitted || !isCurrent(this.state, r.token)) return;
    r.submitted = true; this.dispatch({ type: 'ACTIVITY', token: r.token, activity: 'transcribing' });
    await this.transcribe(r.blob, r.token, r.signal);
  };
  private async transcribe(blob: Blob, token: RunToken, signal: AbortSignal) {
    try {
      const file = await normalizeRecording(blob, signal); if (!isCurrent(this.state, token) || signal.aborted) return;
      const form = new FormData(); const requestId = uid('request'); form.append('file', file); form.append('requestId', requestId);
      const res = await this.fetcher('/api/speech/transcribe', { method: 'POST', body: form, signal }); const json = await res.json();
      if (!isCurrent(this.state, token) || signal.aborted) return;
      if (!res.ok || json.requestId !== requestId || typeof json.text !== 'string' || json.text.length > 4000) throw new Error(json.error?.userMessage || '转写未完成，可以改用文字。');
      this.transcriptDraft = json.text; this.notice = '这是待核对的转写，修改后再确认发送。'; this.dispatch({ type: 'FINISH', token });
    } catch (e) { if (isCurrent(this.state, token) && !signal.aborted) { this.dispatch({ type: 'FINISH', token, activity: 'error' }); this.fail(e); } }
    finally { if (this.recording?.token.runId === token.runId) { this.recording = null; this.media.cancelRecording(); this.recordedSeconds = 0; this.publish(); } }
  }
  cancelRecording = () => this.stop();
  setTranscriptDraft = (text: string) => { if (this.state.lifecycle === 'active') { this.transcriptDraft = text; this.publish(); } };
  sendTranscript = async () => { const text = this.transcriptDraft.trim(); if (!text || text.length > 4000) { this.fail(new Error('请核对转写，最多 4,000 字符。')); return; } this.transcriptDraft = ''; this.publish(); await this.send(text); };
  speak = async (text: string) => {
    if (this.state.lifecycle !== 'active' || !this.capabilities?.tts.available) return;
    if (!this.state.messages.some(m => m.role === 'assistant' && m.text === text)) { this.fail(new Error('只能播放当前会话中已展示的回复。')); return; }
    this.stop(); this.error = '';
    const { token, signal } = this.run.begin(this.state); this.dispatch({ type: 'RUN', runId: token.runId, activity: 'speaking' });
    try {
      const res = await this.fetcher('/api/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...token, requestId: uid('request'), text }), signal });
      if (!res.ok) { const json = await res.json(); throw new Error(json.error?.userMessage || '语音暂时不可用，文字仍在。'); }
      const blob = await res.blob(); if (!isCurrent(this.state, token) || signal.aborted) return;
      await this.media.play(blob, () => isCurrent(this.state, token) && !signal.aborted);
      if (isCurrent(this.state, token)) this.dispatch({ type: 'FINISH', token });
    } catch (e) { if (isCurrent(this.state, token) && !signal.aborted) { this.dispatch({ type: 'FINISH', token, activity: 'error' }); this.fail(e); } }
  };
}
