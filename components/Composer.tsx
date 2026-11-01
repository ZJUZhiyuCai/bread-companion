'use client';

import { useEffect, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react';
import { ArrowUp, Check, LoaderCircle, Mic, Paperclip, Trash2, X } from 'lucide-react';
import { useAutoGrow, useDomId, useMediaQuery } from './hooks';
import { formatClock } from './labels';
import type { BreadVM } from './vm';

interface ComposerProps {
  vm: BreadVM;
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Opens the one-box material dialog; `fromDraft` means a long paste is being moved over. */
  onAddMaterial: (prefill?: string, fromDraft?: boolean) => void;
  sourceCount: number;
  onOpenSources: () => void;
}

const LONG_PASTE = 240;

export function Composer(props: ComposerProps) {
  const { vm, draft, setDraft, onSend, textareaRef, onAddMaterial, sourceCount, onOpenSources } = props;
  const { state, capabilities: caps, transcriptDraft, recordedSeconds, busy } = vm;
  const id = useDomId('composer');
  const coarse = useMediaQuery('(pointer: coarse)');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [micHint, setMicHint] = useState('');
  const [pasteHint, setPasteHint] = useState(false);
  const a = state.activity;
  const canAct = state.lifecycle === 'active';
  const voicePhase = a === 'requesting_mic' || a === 'recording' || a === 'recorded' || a === 'transcribing' ? a : null;

  useAutoGrow(textareaRef, draft, coarse ? 160 : 240);

  const maxInput = caps?.limits.maxInputChars ?? null;
  const maxSec = caps?.limits.maxRecordingSeconds ?? 60;
  const over = maxInput !== null && draft.length > maxInput;
  const transcriptOver = maxInput !== null && transcriptDraft.length > maxInput;
  const nearLimit = maxInput !== null && draft.length > maxInput * 0.8;

  useEffect(() => {
    if (transcriptDraft) setTranscriptOpen(true);
  }, [transcriptDraft]);

  useEffect(() => {
    if (!micHint) return;
    const t = window.setTimeout(() => setMicHint(''), 6000);
    return () => window.clearTimeout(t);
  }, [micHint]);

  useEffect(() => {
    if (!draft) setPasteHint(false);
  }, [draft]);

  const micBlock = !caps
    ? '还在检查语音能力'
    : !caps.asr.available
      ? `现在不能用语音${caps.asr.reason ? `（${caps.asr.reason}）` : ''}，打字照样可以`
      : busy && a !== 'speaking' && a !== 'preparing_speech' // recording cancels pending or playing speech first
        ? '等面包这次说完，或先点“停止”'
        : transcriptOpen
          ? '先处理上一段转写'
          : '';

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || coarse) return;
    e.preventDefault();
    onSend();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.getData('text').length >= LONG_PASTE) setPasteHint(true);
  };

  const startMic = () => {
    if (micBlock) {
      setMicHint(micBlock);
      return;
    }
    void vm.startRecording();
  };

  // What 面包 is doing now lives with the figure (companion corner / perch), not on the composer.
  if (voicePhase) {
    const pct = Math.min(100, (recordedSeconds / maxSec) * 100);
    return (
      <div className="composer-wrap">
        <div className={`composer composer--rec is-${voicePhase}`} role="group" aria-labelledby={`${id}-rec`}>
          <div className="rec__head">
            {voicePhase === 'recording' && <span className="rec__dot" aria-hidden="true" />}
            {(voicePhase === 'requesting_mic' || voicePhase === 'transcribing') && (
              <LoaderCircle aria-hidden="true" className="spin rec__spin" />
            )}
            {voicePhase === 'recorded' && <span className="rec__dot rec__dot--still" aria-hidden="true" />}
            <p id={`${id}-rec`} className="rec__label">
              {voicePhase === 'requesting_mic' && '在等你允许麦克风'}
              {voicePhase === 'recording' && '在录这一段'}
              {voicePhase === 'recorded' && `到 ${maxSec} 秒了，录音已经停下`}
              {voicePhase === 'transcribing' && '在把录音转成字…'}
            </p>
            {(voicePhase === 'recording' || voicePhase === 'recorded') && (
              <span className="rec__time">
                <time>{formatClock(recordedSeconds)}</time>
                <span className="muted"> / {formatClock(maxSec)}</span>
              </span>
            )}
          </div>

          {(voicePhase === 'recording' || voicePhase === 'recorded') && (
            <div
              className="rec__bar"
              role="progressbar"
              aria-label="已录时长"
              aria-valuemin={0}
              aria-valuemax={maxSec}
              aria-valuenow={Math.floor(recordedSeconds)}
              aria-valuetext={`${Math.floor(recordedSeconds)} 秒，最长 ${maxSec} 秒`}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          )}

          {/* The buttons below carry the choice; this says only what they can't. */}
          {voicePhase !== 'transcribing' && (
            <p className="rec__note">
              {voicePhase === 'recording' && '说完点“说完了”。转成字后先给你改。'}
              {voicePhase === 'recorded' && '录到的部分还在。'}
              {voicePhase === 'requesting_mic' && '在浏览器弹窗里选择。'}
            </p>
          )}

          <div className="rec__actions">
            {voicePhase === 'recording' && (
              <>
                <button type="button" className="btn btn--primary" onClick={() => void vm.finishRecording()}>
                  <Check aria-hidden="true" /> 说完了
                </button>
                <button type="button" className="btn btn--ghost" onClick={vm.cancelRecording}>
                  <Trash2 aria-hidden="true" /> 不要这段
                </button>
              </>
            )}
            {voicePhase === 'recorded' && (
              <>
                <button type="button" className="btn btn--primary" onClick={() => void vm.transcribeRecorded()}>
                  <Check aria-hidden="true" /> 转成字
                </button>
                <button type="button" className="btn btn--ghost" onClick={vm.cancelRecording}>
                  <Trash2 aria-hidden="true" /> 不要了
                </button>
              </>
            )}
            {voicePhase === 'requesting_mic' && (
              <button type="button" className="btn btn--ghost" onClick={vm.cancelRecording}>
                <X aria-hidden="true" /> 算了
              </button>
            )}
            {voicePhase === 'transcribing' && (
              <button type="button" className="btn btn--ghost" onClick={vm.stop}>
                <X aria-hidden="true" /> 停止转写
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (transcriptOpen) {
    return (
      <div className="composer-wrap">
        <div className="composer composer--transcript">
          <label htmlFor={`${id}-tr`} className="composer__label">
            转好的文字 <span className="muted">可能有错字，改好再发</span>
          </label>
          <textarea
            id={`${id}-tr`}
            className="composer__input composer__input--boxed"
            rows={3}
            value={transcriptDraft}
            onChange={(e) => vm.setTranscriptDraft(e.target.value)}
            aria-describedby={`${id}-trc`}
            aria-invalid={transcriptOver || undefined}
          />
          <div className="composer__row">
            <p id={`${id}-trc`} className={`composer__help ${transcriptOver ? 'is-over' : ''}`}>
              {transcriptOver ? `超过 ${maxInput} 字了，删掉一些再发` : ''}
            </p>
            <div className="row gap-s">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  vm.setTranscriptDraft('');
                  setTranscriptOpen(false);
                }}
              >
                <Trash2 aria-hidden="true" /> 不要了
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!transcriptDraft.trim() || transcriptOver || busy || !canAct}
                onClick={async () => {
                  setTranscriptOpen(false);
                  await vm.sendTranscript();
                }}
              >
                <ArrowUp aria-hidden="true" /> 发出去
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="composer-wrap">
      {pasteHint && draft.length >= LONG_PASTE && (
        <div className="paste-hint" role="group" aria-label="长段落">
          <p>这段像是材料。放进材料里，引用会照原文。</p>
          <div className="row gap-s">
            <button
              type="button"
              className="pill pill--warm"
              onClick={() => {
                setPasteHint(false);
                onAddMaterial(draft, true);
              }}
            >
              <Paperclip aria-hidden="true" /> 放进材料
            </button>
            <button type="button" className="pill" onClick={() => setPasteHint(false)}>
              就当一句话
            </button>
          </div>
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <label htmlFor={`${id}-in`} className="sr-only">
          写给面包
        </label>
        <textarea
          id={`${id}-in`}
          ref={textareaRef}
          className="composer__input"
          rows={1}
          value={draft}
          placeholder={state.mode === 'practice' && state.selectedQuestion ? '写下你这一次的回答，想到哪写到哪' : '想说什么都可以'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          aria-describedby={`${id}-help`}
          aria-invalid={over || undefined}
          disabled={!canAct}
        />
        <div className="composer__tools">
          <div className="composer__left">
            <button type="button" className="icon-btn" onClick={() => onAddMaterial()} aria-label="放一段材料" title="放一段材料">
              <Paperclip aria-hidden="true" />
            </button>
            {sourceCount > 0 && (
              <button type="button" className="mat-chip" onClick={onOpenSources}>
                材料 {sourceCount} 段<span className="sr-only">，打开看看</span>
              </button>
            )}
          </div>
          <div className="composer__right">
            <button
              type="button"
              className={`icon-btn icon-btn--mic ${micBlock ? 'is-blocked' : ''}`}
              onClick={startMic}
              aria-disabled={!!micBlock || undefined}
              aria-label={micBlock ? `录一段话（${micBlock}）` : '录一段话：转成字后先给你改，再决定发不发'}
              title={micBlock || '录一段，转成字后先改再发'}
            >
              <Mic aria-hidden="true" />
            </button>
            <button type="submit" className="send-btn" disabled={!draft.trim() || over || busy || !canAct} aria-label="发出">
              <ArrowUp aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
      <div className="composer__row composer__row--below">
        <span className="sr-only" aria-live="polite">
          {micHint}
        </span>
        <p id={`${id}-help`} className="composer__help">
          {/* The shortcut row already names Esc = 停止; no separate "it's busy" sentence. */}
          {micHint ? (
            <span className="warn-text">{micHint}</span>
          ) : coarse ? (
            '回车换行，点箭头发出'
          ) : (
            <>
              <kbd>Enter</kbd> 发出 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行 · <kbd>Esc</kbd> 停止
            </>
          )}
        </p>
        {(nearLimit || over) && (
          <p className={`composer__count ${over ? 'is-over' : ''}`}>
            {draft.length} / {maxInput}
            {over && ' 字，分几次说，或者放进材料'}
          </p>
        )}
      </div>
    </div>
  );
}
