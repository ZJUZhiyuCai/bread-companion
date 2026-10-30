'use client';

import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { LoaderCircle, Mic, Paperclip, SendHorizontal, Square, Trash2, X } from 'lucide-react';
import type { BreadViewModel } from '@/domain/view-model';
import { useDomId, useMediaQuery } from './hooks';
import { formatClock } from './labels';

interface ComposerProps {
  vm: BreadViewModel;
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onAddSource: () => void;
}

export function Composer({ vm, draft, setDraft, onSend, placeholder, textareaRef, onAddSource }: ComposerProps) {
  const { state, capabilities: caps, transcriptDraft, recordedSeconds, busy } = vm;
  const id = useDomId('composer');
  const coarse = useMediaQuery('(pointer: coarse)');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [micHint, setMicHint] = useState('');
  const a = state.activity;
  const voicePhase = a === 'requesting_mic' || a === 'recording' || a === 'recorded' || a === 'transcribing' ? a : null;

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

  const micBlock = !caps
    ? '正在检查语音能力'
    : !caps.asr.available
      ? `语音识别不可用${caps.asr.reason ? `：${caps.asr.reason}` : ''}，可以继续用文字`
      : busy && a !== 'speaking' // during playback the hook stops audio before recording
        ? '等这次回应结束，或先点“停止”'
        : transcriptOpen
          ? '先处理上一段转写'
          : '';

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || coarse) return;
    e.preventDefault();
    onSend();
  };

  const startMic = () => {
    if (micBlock) {
      setMicHint(micBlock);
      return;
    }
    void vm.startRecording();
  };

  if (voicePhase) {
    const pct = Math.min(100, (recordedSeconds / maxSec) * 100);
    return (
      <div className={`composer composer--rec is-${voicePhase}`} role="group" aria-labelledby={`${id}-rec`}>
        <div className="rec">
          <div className="rec__status">
            {voicePhase === 'recording' && <span className="rec__dot" aria-hidden="true" />}
            {(voicePhase === 'requesting_mic' || voicePhase === 'transcribing') && (
              <LoaderCircle aria-hidden="true" className="spin" />
            )}
            {voicePhase === 'recorded' && <span className="rec__dot rec__dot--still" aria-hidden="true" />}
            <p id={`${id}-rec`} className="rec__label">
              {voicePhase === 'requesting_mic' && '正在请求麦克风权限，请在浏览器弹窗里选择'}
              {voicePhase === 'recording' && '录音中'}
              {voicePhase === 'recorded' && `已到 ${maxSec} 秒上限，录音已经停了`}
              {voicePhase === 'transcribing' && '正在转写…'}
            </p>
            {(voicePhase === 'recording' || voicePhase === 'recorded') && (
              <span className="rec__time" aria-live="off">
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
              aria-valuetext={`${Math.floor(recordedSeconds)} 秒，上限 ${maxSec} 秒`}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          )}

          <p className="rec__note small">
            {voicePhase === 'recording' && '只录你点击之后的这一段。点“结束并转写”就停，转写后可以先改再发。'}
            {voicePhase === 'recorded' && '已录的部分还在。要转写，还是放弃？'}
            {voicePhase === 'requesting_mic' && '没有授权就不会录音。可以随时取消。'}
            {voicePhase === 'transcribing' && '转写结果会先给你看，不会自动发送。'}
          </p>

          <div className="rec__actions">
            {voicePhase === 'recording' && (
              <>
                <button type="button" className="btn btn--primary" onClick={() => void vm.finishRecording()}>
                  <Square aria-hidden="true" /> 结束并转写
                </button>
                <button type="button" className="btn btn--ghost" onClick={vm.cancelRecording}>
                  <Trash2 aria-hidden="true" /> 放弃这段
                </button>
              </>
            )}
            {voicePhase === 'recorded' && (
              <>
                <button type="button" className="btn btn--primary" onClick={() => void vm.transcribeRecorded()}>
                  转写已录的部分
                </button>
                <button type="button" className="btn btn--ghost" onClick={vm.cancelRecording}>
                  <Trash2 aria-hidden="true" /> 放弃
                </button>
              </>
            )}
            {voicePhase === 'requesting_mic' && (
              <button type="button" className="btn btn--ghost" onClick={vm.cancelRecording}>
                <X aria-hidden="true" /> 取消
              </button>
            )}
            {voicePhase === 'transcribing' && (
              <button type="button" className="btn btn--ghost" onClick={vm.stop}>
                <Square aria-hidden="true" /> 停止转写
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (transcriptOpen) {
    return (
      <div className="composer composer--transcript">
        <label htmlFor={`${id}-tr`} className="composer__label">
          转写草稿 <span className="muted small">可能有错字，发送前改一改</span>
        </label>
        <textarea
          id={`${id}-tr`}
          className="input textarea composer__input"
          rows={3}
          value={transcriptDraft}
          onChange={(e) => vm.setTranscriptDraft(e.target.value)}
          aria-describedby={`${id}-trc`}
        />
        <div className="composer__row">
          <p id={`${id}-trc`} className={`counter ${transcriptOver ? 'is-over' : ''}`}>
            {transcriptOver ? `超过 ${maxInput} 字了，可以删掉一部分再发` : '这段文字确认后才会发送'}
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
              <Trash2 aria-hidden="true" /> 丢弃
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!transcriptDraft.trim() || transcriptOver || busy}
              onClick={async () => {
                await vm.sendTranscript();
                setTranscriptOpen(false);
              }}
            >
              <SendHorizontal aria-hidden="true" /> 发送这段
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
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
      <div className="composer__box">
        <textarea
          id={`${id}-in`}
          ref={textareaRef}
          className="composer__input"
          rows={2}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          aria-describedby={`${id}-help`}
          aria-invalid={over || undefined}
        />
        <div className="composer__tools">
          <button type="button" className="icon-btn" onClick={onAddSource} aria-label="放一段材料" title="放一段材料">
            <Paperclip aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`icon-btn icon-btn--mic ${micBlock ? 'is-blocked' : ''}`}
            onClick={startMic}
            aria-disabled={!!micBlock || undefined}
            aria-label={micBlock ? `录音（${micBlock}）` : '开始录音'}
            title={micBlock || '开始录音'}
          >
            <Mic aria-hidden="true" />
          </button>
          <button
            type="submit"
            className="btn btn--primary btn--send"
            disabled={!draft.trim() || over || busy}
            aria-label="发送"
          >
            <SendHorizontal aria-hidden="true" />
            <span className="btn--send__label">发送</span>
          </button>
        </div>
      </div>
      <div className="composer__row">
        <p id={`${id}-help`} className="composer__help small" aria-live="polite">
          {micHint ? (
            <span className="warn-text">{micHint}</span>
          ) : busy ? (
            '正在整理回应，可以点“停止”打断'
          ) : coarse ? (
            '换行用回车，点“发送”发出'
          ) : (
            <>
              <kbd>Enter</kbd> 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行 · <kbd>Esc</kbd> 停止
            </>
          )}
        </p>
        {(nearLimit || over) && (
          <p className={`counter ${over ? 'is-over' : ''}`}>
            {draft.length} / {maxInput}
            {over && ' 字，分几次发或截取一段'}
          </p>
        )}
      </div>
    </form>
  );
}
