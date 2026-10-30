'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, HardDrive, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { Card, EndSnapshot } from '@/domain/types';
import { Dialog } from './Dialog';
import { EvidenceQuote } from './Evidence';
import { CARD_TYPE_LABEL, sectionLabel, type EvidenceView } from './labels';

interface SavePreviewProps {
  open: boolean;
  onClose: () => void;
  /** The version frozen when the preview opened — this is what the user reviews. */
  card: Card;
  /** The hook's current card. saveCard() saves this one, so it must still be the reviewed version. */
  liveCard: Card | null;
  evidence: EvidenceView[];
  practice: EndSnapshot['confirmedPractice'];
  notice: string;
  error: string;
  onSave: () => Promise<void>;
}

export function SavePreview({ open, onClose, card, liveCard, evidence, practice, notice, error, onSave }: SavePreviewProps) {
  const [phase, setPhase] = useState<'review' | 'saving' | 'done'>('review');
  const versionChanged =
    !liveCard || liveCard.id !== card.id || liveCard.revision !== card.revision || liveCard.validity !== card.validity;
  const savable = card.validity === 'confirmed' && (phase !== 'review' || !versionChanged);

  useEffect(() => {
    if (open) setPhase('review');
  }, [open]);

  const save = async () => {
    if (phase === 'saving' || !savable) return;
    setPhase('saving');
    try {
      await onSave();
    } finally {
      setPhase('done');
    }
  };

  const failed = phase === 'done' && !!error;
  const freshNotice = notice.startsWith('已保存版本 ') ? notice : '';
  const resultText = failed ? error : freshNotice;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={phase === 'done' ? (failed ? '没有保存成功' : '保存结果') : `保存第 ${card.revision} 版到本设备`}
      subtitle={phase === 'done' ? undefined : '先看清楚会存什么、不会存什么。'}
      footer={
        phase === 'done' ? (
          <div className="row gap-s wrap justify-end">
            {failed && (
              <button type="button" className="btn btn--quiet" onClick={() => setPhase('review')}>
                返回重试
              </button>
            )}
            <button type="button" className="btn btn--primary" onClick={onClose}>
              好
            </button>
          </div>
        ) : (
          <div className="row gap-s wrap justify-end">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={phase === 'saving'}>
              先不保存
            </button>
            <button type="button" className="btn btn--primary" onClick={save} disabled={phase === 'saving' || !savable}>
              {phase === 'saving' ? (
                <>
                  <LoaderCircle aria-hidden="true" className="spin" /> 正在保存…
                </>
              ) : (
                <>
                  <HardDrive aria-hidden="true" /> 保存第 {card.revision} 版
                </>
              )}
            </button>
          </div>
        )
      }
    >
      {phase === 'done' ? (
        <div className={`save-result ${failed ? 'is-failed' : ''}`} role={failed ? 'alert' : 'status'}>
          {failed ? <CircleX aria-hidden="true" /> : freshNotice ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          <div>
            <p>{resultText || '尚未收到保存成功回执，请检查提示后重试或导出。'}</p>
            {failed && <p className="small muted">卡片还在页面里，没有丢。你可以重试，或者先导出成文件。</p>}
          </div>
        </div>
      ) : (
        <div className="save-preview">
          {versionChanged ? (
            <p className="callout callout--locked" role="alert">
              <TriangleAlert aria-hidden="true" /> 你打开预览之后，卡片变了
              {liveCard ? `（现在是第 ${liveCard.revision} 版）` : ''}
              。为了不保存你没看过的版本，这里不能继续保存，请关闭后重新打开预览。
            </p>
          ) : (
            card.validity !== 'confirmed' && (
              <p className="callout callout--locked">
                <TriangleAlert aria-hidden="true" /> 这一版现在不是“已确认”状态，不能保存。
              </p>
            )
          )}
          <section className="save-preview__where">
            <h3>存到哪里</h3>
            <p>
              <strong>本设备的当前浏览器</strong>。不上传、不跨设备同步；换浏览器、清理浏览器数据或浏览器自动回收空间时可能消失。
              如果别人也用这台设备的这个浏览器，他们可能看到。
            </p>
          </section>

          <div className="save-preview__cols">
            <section className="save-preview__will">
              <h3>会保存</h3>
              <div className="mini-card">
                <p className="mini-card__kicker">
                  {CARD_TYPE_LABEL[card.type]} · 第 {card.revision} 版 · 仅这一版
                </p>
                <p className="mini-card__title">{card.title}</p>
                {card.sections.length > 0 ? (
                  <dl className="mini-card__list">
                    {card.sections.map((s, i) => (
                      <div key={`${s.key}-${i}`}>
                        <dt>{sectionLabel(s.key)}</dt>
                        <dd className="prewrap">{s.text || '（留空）'}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted small">没有条目，只有标题。</p>
                )}
              </div>

              <h4 className="save-preview__sub">引用的摘录（{evidence.length} 段）</h4>
              {evidence.length > 0 ? (
                <div className="save-preview__quotes">
                  {evidence.map((ev) => (
                    <EvidenceQuote key={ev.key} ev={ev} />
                  ))}
                </div>
              ) : (
                <p className="muted small">这张卡片没有引用任何材料摘录，所以不会存任何原文。</p>
              )}

              {practice.length > 0 && (
                <>
                  <h4 className="save-preview__sub">已确认的练习（{practice.length} 道）</h4>
                  <ul className="practice-list">
                    {practice.map((p) => (
                      <li key={p.id}>
                        <p className="practice-list__q">{p.question}</p>
                        <p className="prewrap small">{p.answerOutline}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="save-preview__wont">
              <h3>不会保存</h3>
              <ul className="cross-list">
                <li>完整的聊天记录</li>
                <li>原始录音</li>
                <li>没被这张卡片引用的材料</li>
                <li>没确认的分析和其他版本</li>
              </ul>
            </section>
          </div>
        </div>
      )}
    </Dialog>
  );
}
