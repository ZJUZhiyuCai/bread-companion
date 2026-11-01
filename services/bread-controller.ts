import type { BreadViewModel } from '@/domain/view-model';
import type { Activity, Card, EndSnapshot, Mode, Origin, RunToken, SavedCase, Source } from '@/domain/types';
import { candidateSchema, capabilitiesSchema, sourceSchema, turnRequestSchema } from '@/domain/schemas';
import { buildTurn, materialSources } from '@/domain/context-builder';
import { cardCanConfirm, refKey, validateCandidate } from '@/domain/evidence';
import { explicitIntent, isActionOnly } from '@/domain/policy';
import { currentCard, initialState, isCurrent, makeEndSnapshot, reducer, uid, type Event } from '@/domain/reducer';
import { deleteSavedCase, fromSnapshot, invalidateSaved, listSaved, MAX_IMPORT_BYTES, parseImport, saveArchive, validateArchive } from './card-store';
import { downloadArchive } from './export';
import { MediaController, normalizeRecording } from './media-controller';
import { RunController } from './run-controller';
import { CallController, idleCall } from './call-controller';
import type { CallAudioPort } from './call-audio';
import { fetchComplete } from './http';
import { requestVoiceTurn } from './voice-turn';
import { withAbort } from '@/lib/abort';
import { CALL_GREETING } from '@/domain/call-greeting';
import { embeddedCallGreeting } from '@/domain/call-greeting-audio';

const WELCOME = '今晚，先不用把一切想清楚。你可以慢慢说，也可以只是坐一会儿。这里是面包，一个 AI 交流助手。我们可以聊这次面试，也可以只说说现在的感受。想停的时候，随时停。';
export class BreadController {
  private state = initialState();
  private capabilities: BreadViewModel['capabilities'] = null;
  private savedCases: SavedCase[] = [];
  private notice = ''; private error = ''; private transcriptDraft = ''; private recordedSeconds = 0;
  private recording: { token: RunToken; signal: AbortSignal; blob: Blob | null; submitted: boolean } | null = null;
  private run = new RunController(); private disposed = false;
  private artifactVersion = 0;
  private failedTurn: { text: string; sessionId: string; epoch: number; contextRevision: number; mode: Mode } | null = null;
  private connectionError = '';
  private capabilityRequest: AbortController | null = null;
  private listeners = new Set<() => void>();
  private view: BreadViewModel;
  private call = idleCall();
  private callController: CallController;
  private voiceFetcher: typeof fetch;
  private preparedCallSpeech: { text: string; token: RunToken; signal: AbortSignal; audio: Promise<Blob> } | null = null;
  constructor(private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init), private media = new MediaController(), callAudio?: CallAudioPort) {
    this.voiceFetcher = fetcher;
    this.fetcher = (input, init) => fetchComplete(fetcher, input, init, String(input).includes('/capabilities') ? 8000 : 60000);
    this.callController = new CallController({
      update: call => { this.call = call; this.publish(); },
      cancelReply: () => this.stopWork(),
      transcribe: async (file, signal) => {
        const requestId = uid('request'); const form = new FormData(); form.append('file', file); form.append('requestId', requestId);
        const response = await this.fetcher('/api/speech/transcribe', { method: 'POST', body: form, signal });
        const json = await response.json(); signal.throwIfAborted();
        if (!response.ok) {
          const message = ['PROVIDER_UNAVAILABLE', 'TIMEOUT'].includes(json.error?.code)
            ? '语音转写暂时没接通。重新连接后，请再说一次，或改用文字。'
            : json.error?.userMessage;
          throw new Error(message || '这句没听清，可以再说一次，或改用文字。');
        }
        if (json.requestId !== requestId || typeof json.text !== 'string') throw new Error('语音结果没有对应上这次说话，请再说一次。');
        return json.text;
      },
      reply: async (text, signal) => {
        signal.throwIfAborted();
        const previous = this.state.messages.at(-1)?.id;
        await this.sendMessage(text, 'call'); signal.throwIfAborted();
        if (this.error) throw new Error(this.error);
        const last = this.state.messages.at(-1);
        return last?.role === 'assistant' && last.id !== previous ? last.text : null;
      },
      prepareGreeting: async signal => {
        if (this.capabilities?.tts.greeting !== CALL_GREETING.url) return null;
        signal.throwIfAborted();
        return embeddedCallGreeting();
      },
      synthesize: async (text, signal) => {
        signal.throwIfAborted();
        const prepared = this.preparedCallSpeech; this.preparedCallSpeech = null;
        if (prepared && prepared.text === text && prepared.token.sessionId === this.state.sessionId && prepared.token.epoch === this.state.epoch && prepared.token.contextRevision === this.state.contextRevision) {
          // A failed combined request must not silently bill a second synthesis.
          return withAbort(prepared.audio, AbortSignal.any([signal, prepared.signal]));
        }
        const token = { sessionId: this.state.sessionId, runId: uid('call'), epoch: this.state.epoch, contextRevision: this.state.contextRevision };
        const response = await this.fetcher('/api/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...token, requestId: uid('request'), text }), signal });
        if (!response.ok) { const json = await response.json(); throw new Error(json.error?.userMessage || '声音暂时没出来，文字回复还在。'); }
        return response.blob();
      },
    }, callAudio);
    this.view = this.buildView();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.view;
  private publish() { this.view = this.buildView(); for (const f of this.listeners) f(); }
  private dispatch(event: Event) { this.state = reducer(this.state, event); this.publish(); }
  private buildView(): BreadViewModel {
    return { state: this.state, capabilities: this.capabilities, connectionError: this.connectionError, connectionChecking: !!this.capabilityRequest, refreshCapabilities: this.refreshCapabilities, currentCard: currentCard(this.state), savedCases: this.savedCases, notice: this.notice, error: this.error, transcriptDraft: this.transcriptDraft, recordedSeconds: this.recordedSeconds, canRetry: this.canRetry(), retryLastTurn: this.retryLastTurn,
      call: this.call, startCall: this.startCall, hangupCall: this.hangupCall, toggleCallMute: this.callController.toggleMute, interruptCall: this.callController.interrupt, finishCallTurn: this.callController.finish, resumeCall: this.callController.resume,
      busy: !['idle', 'paused', 'error', 'recorded'].includes(this.state.activity), start: this.start, send: this.send, assist: this.assist, addMaterial: this.addMaterial, setMode: this.setMode, stop: this.stop, end: this.end, reset: this.reset, addSource: this.addSource, correctSource: this.correctSource, confirmSource: this.confirmSource, rejectFinding: this.rejectFinding, editCard: this.editCard, confirmCard: this.confirmCard, saveCard: this.saveCard, exportCard: this.exportCard, refreshSaved: this.refreshSaved, deleteSaved: this.deleteSaved, importSaved: this.importSaved, resumeSaved: this.resumeSaved, setPractice: this.setPractice, startRecording: this.startRecording, finishRecording: this.finishRecording, transcribeRecorded: this.transcribeRecorded, cancelRecording: this.cancelRecording, setTranscriptDraft: this.setTranscriptDraft, sendTranscript: this.sendTranscript, speak: this.speak, clearNotice: this.clearNotice, dismissNotice: this.dismissNotice };
  }
  async initialize() {
    this.disposed = false;
    await Promise.all([this.refreshSaved(), this.refreshCapabilities()]);
  }
  /** Recheck only service readiness: never reload a draft, resend text or open a microphone. */
  refreshCapabilities = async () => {
    if (this.disposed || this.capabilityRequest) return;
    const pending = new AbortController(); this.capabilityRequest = pending; this.publish();
    const current = () => !this.disposed && this.capabilityRequest === pending && !pending.signal.aborted;
    try {
      const res = await this.fetcher('/api/capabilities', { cache: 'no-store', signal: pending.signal });
      if (!res.ok) throw new Error('Service readiness unavailable');
      const caps = capabilitiesSchema.parse(await res.json());
      if (current()) { this.capabilities = caps; this.connectionError = ''; }
    } catch {
      if (current()) this.connectionError = '暂时没连上，你写的话还在。';
    } finally {
      if (this.capabilityRequest === pending) { this.capabilityRequest = null; if (!this.disposed) this.publish(); }
    }
  };
  dispose() { this.disposed = true; this.capabilityRequest?.abort(); this.capabilityRequest = null; this.callController.hangup(); this.state = reducer(this.state, { type: 'STOP' }); this.cancelResources(); }
  private cancelResources() { this.failedTurn = null; this.preparedCallSpeech = null; this.run.cancel(); this.media.cancel(); this.recording = null; this.recordedSeconds = 0; }
  private fail(error: unknown, fallback = '操作没有完成，请重试。', retainFailedTurn = false) { if (!retainFailedTurn) this.failedTurn = null; this.error = error instanceof Error ? error.message : fallback; this.publish(); }
  dismissNotice = () => { this.notice = ''; this.publish(); };
  clearNotice = () => { this.failedTurn = null; this.notice = ''; this.error = ''; this.publish(); };
  start = (mode: Mode = 'listen', welcome = false) => {
    if (this.state.lifecycle !== 'active') return;
    this.dispatch({ type: 'START', mode, welcome: welcome ? WELCOME : mode === 'listen' ? '想从哪里说起都可以。' : '可以直接说说面试里让你挂心的片段，或贴一段当时的回答。我来帮你理一理。' });
  };
  private stopWork = () => { this.dispatch({ type: 'STOP' }); this.cancelResources(); this.publish(); };
  stop = () => { if (this.call.active) this.callController.pause(); else this.stopWork(); };
  pauseForBackground = () => { if (this.call.active) this.callController.pause('页面已切到后台，麦克风与播放都暂停了。回来后可以继续。'); else if (['requesting_mic', 'recording', 'preparing_speech', 'speaking'].includes(this.state.activity)) this.stop(); };
  end = () => { this.callController.hangup(); this.dispatch({ type: 'END' }); this.cancelResources(); this.transcriptDraft = ''; this.notice = ''; this.error = ''; this.publish(); };
  reset = () => { this.callController.hangup(); this.artifactVersion++; this.stop(); this.transcriptDraft = ''; this.error = ''; this.notice = ''; this.dispatch({ type: 'REPLACE', state: initialState() }); };
  startCall = async () => {
    if (this.call.active || this.state.lifecycle !== 'active') return;
    if (!this.capabilities?.asr.available || !this.capabilities?.tts.available || !this.capabilities.agent.configured) { this.fail(new Error('语音连接暂时不可用，可以先打字聊。')); return; }
    this.stopWork(); this.error = ''; this.notice = '';
    const first = !this.state.started; if (first) this.dispatch({ type: 'START', mode: 'listen', welcome: CALL_GREETING.text });
    await this.callController.start(CALL_GREETING.text);
  };
  hangupCall = () => { this.callController.hangup(); };
  setMode = (mode: Mode) => {
    if (this.state.lifecycle !== 'active') return;
    this.hangupCall();
    this.dispatch({ type: 'MODE', mode }); this.cancelResources(); this.error = '';
    if (mode === 'organize' && this.state.sources.length) void this.requestTurn('请把我提供的内容留成一个以后可以看的记号，不添加能力评价。');
    else this.publish();
  };
  send = async (text: string) => { if (!text.trim()) return; this.hangupCall(); await this.sendMessage(text, 'text'); };
  private sendMessage = async (text: string, channel: 'text' | 'call', actionRequest = false) => {
    text = text.trim(); if (!text || this.state.lifecycle !== 'active') return;
    if (channel === 'call' && /^(?:好[的吧]?[，,\s]*)?(?:先)?(?:挂了|挂断(?:电话)?|挂电话|不聊了|再见|晚安)[。！!，,\s]*$/.test(text)) { this.hangupCall(); return; }
    const intent = explicitIntent(text);
    if (intent === 'stop') { this.stop(); return; } if (intent === 'end') { this.end(); return; }
    if (text.length > 4000) { this.fail(new Error('每次最多发送 4,000 个字符，可以分几段说。')); return; }
    if (!this.state.started) this.start(intent || this.state.mode);
    if (intent) { this.dispatch(intent === 'practice' ? { type: 'PREPARE_PRACTICE' } : { type: 'MODE', mode: intent }); this.cancelResources(); }
    else if (this.view.busy || this.state.activity === 'recorded') { this.fail(new Error('请先停止当前操作，或处理已录好的片段。')); return; }
    this.error = '';
    const source: Source = { id: uid('source'), revision: 1, origin: 'user_recollection', label: actionRequest || isActionOnly(text) ? '本次请求' : this.state.mode === 'practice' ? '本次练习回答' : '我说的话', text, confirmed: true };
    this.dispatch({ type: 'USER', text, source });
    await this.requestTurn(text, channel);
  };
  assist = async (mode: Exclude<Mode, 'listen'>, direction = '') => {
    const requests = { organize: '帮我把刚才说的留个记号。', review: '帮我复盘一下刚才的面试片段。', practice: '陪我练一题，请根据我们聊过的内容选一个问题。' };
    this.hangupCall();
    await this.sendMessage(requests[mode] + (direction.trim() ? `\n本次修改方向（用户说明）：${direction.trim().slice(0, 300)}` : ''), 'text', true);
  };
  private canRetry() {
    const failed = this.failedTurn;
    return !!failed && !!this.error && !this.call.active && this.state.lifecycle === 'active' && this.state.activity === 'error'
      && failed.sessionId === this.state.sessionId && failed.epoch === this.state.epoch && failed.contextRevision === this.state.contextRevision && failed.mode === this.state.mode;
  }
  retryLastTurn = async () => {
    if (!this.canRetry()) return;
    const text = this.failedTurn!.text;
    await this.requestTurn(text);
  };
  private async requestTurn(text: string, channel: 'text' | 'call' = 'text') {
    if (this.state.lifecycle !== 'active') return;
    this.failedTurn = null; this.error = '';
    const { token, signal } = this.run.begin(this.state);
    this.dispatch({ type: 'RUN', runId: token.runId, activity: 'generating' });
    const request = { ...buildTurn(this.state, text, token.runId, uid('request')), channel };
    let retryable = true;
    try {
      const validated = turnRequestSchema.safeParse(request); if (!validated.success) { retryable = false; throw new Error('这段内容有点长，可以分几段发送。'); }
      let json: unknown;
      let speech: Promise<Blob> | undefined;
      if (channel === 'call' && request.mode === 'listen' && this.capabilities?.tts.turnStream) {
        const stream = requestVoiceTurn(this.voiceFetcher, validated.data, signal);
        speech = stream.audio; json = await stream.candidate;
      } else {
        const res = await this.fetcher('/api/agent/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
        const body = await res.json(); json = body;
        if (!isCurrent(this.state, token) || signal.aborted) return;
        if (!res.ok) { retryable = body.error?.retryable !== false; throw new Error(body.error?.userMessage || '回复没有接上，再试一次？'); }
      }
      if (!isCurrent(this.state, token) || signal.aborted) return;
      this.dispatch({ type: 'ACTIVITY', token, activity: 'validating' });
      const candidate = candidateSchema.parse(json);
      if (validateCandidate(candidate, request).length) throw new Error('这次回复没有通过引用与版本检查，已丢弃。');
      if (!isCurrent(this.state, token) || signal.aborted) return;
      if (speech) this.preparedCallSpeech = { text: candidate.assistantText, token, signal, audio: speech };
      this.dispatch({ type: 'CANDIDATE', candidate });
    } catch (e) { if (isCurrent(this.state, token) && !signal.aborted) {
      if (channel === 'text' && retryable) this.failedTurn = { text, sessionId: token.sessionId, epoch: token.epoch, contextRevision: token.contextRevision, mode: request.mode };
      this.dispatch({ type: 'FINISH', token, activity: 'error' });
      this.fail(e instanceof TypeError ? new Error('刚才没连上，你的话还在。') : e, '回复没有完成，请重试。', true);
    } }
  }
  addMaterial = (text: string) => {
    if (this.state.lifecycle !== 'active') return false;
    const source = sourceSchema.safeParse({ id: uid('source'), revision: 1, origin: 'user_recollection', label: `粘贴的材料 ${this.state.sources.filter(s => s.label.startsWith('粘贴的材料')).length + 1}`, text: text.trim(), confirmed: true });
    if (!source.success) { this.fail(new Error('可以粘贴 1—20,000 字符的片段。')); return false; }
    if (materialSources(this.state).length >= 24) { this.fail(new Error('这次已有不少材料了，可以先留下卡片，再开始新的会话。')); return false; }
    this.hangupCall(); this.dispatch({ type: 'ADD_SOURCE', source: source.data }); this.cancelResources();
    this.notice = '材料收到了。你可以直接说想一起看看什么。'; this.error = ''; this.publish(); return true;
  };
  addSource = (text: string, origin: Origin, label: string) => {
    if (this.state.lifecycle !== 'active') return;
    const s = sourceSchema.safeParse({ id: uid('source'), revision: 1, origin, label: label.trim() || '补充材料', text: text.trim(), confirmed: false });
    if (!s.success) { this.fail(new Error('材料需为 1—20,000 字符，标题最多 100 字符。')); return; }
    if (materialSources(this.state).length >= 24) { this.fail(new Error('当前案例材料已较多，请先结束并开始新案例。')); return; }
    this.hangupCall(); this.dispatch({ type: 'ADD_SOURCE', source: s.data }); this.cancelResources(); this.publish();
  };
  correctSource = (id: string, text: string) => {
    if (this.state.lifecycle !== 'active' || !text.trim() || text.length > 20000) return;
    const previousRevision = this.state.sources.find(s => s.id === id)?.revision;
    if (previousRevision === undefined) return;
    if (this.state.messages.some(m => m.sourceId === id) && text.length > 4000) { this.fail(new Error('聊天原话最多 4,000 字符，较长材料可另行添加。')); return; }
    this.hangupCall(); this.artifactVersion++;
    const caseId = this.state.caseId;
    this.dispatch({ type: 'CORRECT_SOURCE', id, text: text.trim() }); this.cancelResources();
    this.notice = '原话改好了，旧的整理也已作废。需要时我可以根据新内容重新整理。'; this.publish();
    void invalidateSaved(caseId, id, undefined, previousRevision).then(this.refreshSaved).catch(e => this.fail(e));
  };
  confirmSource = (id: string) => { this.hangupCall(); this.dispatch({ type: 'CONFIRM_SOURCE', id }); this.cancelResources(); this.publish(); };
  rejectFinding = (id: string) => {
    this.hangupCall(); this.artifactVersion++;
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
  private acceptDisplayedCard() {
    const card = currentCard(this.state);
    // Saving or exporting the displayed version accepts its wording, not its external truth.
    if (this.state.lifecycle === 'active' && card?.validity === 'draft') {
      if (!cardCanConfirm(card, this.state.findings, this.state.sources)) throw new Error('这张卡片的来源已变化，请重新整理后再留下。');
      this.dispatch({ type: 'CONFIRM_CARD' });
    }
    if (this.state.lifecycle === 'ended' && card?.validity === 'draft') this.dispatch({ type: 'CONFIRM_END_CARD' });
  }
  saveCard = async () => {
    this.error = ''; this.notice = ''; this.publish();
    try {
      this.acceptDisplayedCard();
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
  exportCard = (format: 'md' | 'json') => { try { this.acceptDisplayedCard(); downloadArchive(fromSnapshot(this.selectedSnapshot()), format); this.notice = '已生成下载文件，请在浏览器下载列表查看。'; this.publish(); } catch (e) { this.fail(e); } };
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
      this.hangupCall();
      this.artifactVersion++;
      this.stop(); const state = initialState(); state.started = true; state.mode = 'listen';
      const evidence = saved.selectedEvidence.filter(e => saved.findings.some(f => f.validity === 'confirmed' && f.evidenceRefs.some(r => refKey(r) === refKey(e))));
      state.sources = evidence.map(e => ({ id: uid('source'), revision: 1, origin: e.origin, label: '从已保存卡片带入的摘录', text: e.quote, confirmed: true }));
      state.messages = [{ id: uid('message'), role: 'assistant', text: '之前留下的那几句原话，已经带过来了。想接着聊、练一道题，或者说点新的，都可以。' }];
      this.notice = '已打开新的临时会话；旧存档仍保留。'; this.error = ''; this.transcriptDraft = ''; this.dispatch({ type: 'REPLACE', state });
    } catch (e) { this.fail(e); }
  };
  setPractice = (question: string, criteria: string[]) => {
    if (!question.trim() || question.length > 1000 || criteria.length > 2 || criteria.some(c => !c.trim() || c.length > 100)) { this.fail(new Error('请选定一道题和一到两个练习维度。')); return; }
    this.hangupCall(); this.dispatch({ type: 'PRACTICE', question: question.trim(), criteria: criteria.length ? criteria : ['把自己的思路说具体'] }); this.cancelResources(); this.publish();
  };
  startRecording = async () => {
    if (this.state.lifecycle !== 'active') return;
    this.hangupCall();
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
    this.hangupCall(); this.stop(); this.error = '';
    const { token, signal } = this.run.begin(this.state); this.dispatch({ type: 'RUN', runId: token.runId, activity: 'preparing_speech' });
    try {
      const res = await this.fetcher('/api/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...token, requestId: uid('request'), text }), signal });
      if (!res.ok) { const json = await res.json(); throw new Error(json.error?.userMessage || '语音暂时不可用，文字仍在。'); }
      const blob = await res.blob(); if (!isCurrent(this.state, token) || signal.aborted) return;
      await this.media.play(blob, () => isCurrent(this.state, token) && !signal.aborted, () => {
        if (isCurrent(this.state, token) && !signal.aborted) this.dispatch({ type: 'ACTIVITY', token, activity: 'speaking' });
      });
      if (isCurrent(this.state, token)) this.dispatch({ type: 'FINISH', token });
    } catch (e) { if (isCurrent(this.state, token) && !signal.aborted) { this.dispatch({ type: 'FINISH', token, activity: 'error' }); this.fail(e); } }
  };
}
