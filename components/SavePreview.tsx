'use client';

import { useEffect, useState } from 'react';
import { Braces, ChevronDown, CircleCheck, CircleX, FileDown, HardDrive, LoaderCircle, Pencil, RefreshCw, TriangleAlert } from 'lucide-react';
import type { Card, EndSnapshot, SavedCase } from '@/domain/types';
import { Dialog } from './Dialog';
import { EvidenceQuote } from './Evidence';
import { CARD_TYPE_LABEL, isCardSaved, isLocked, sectionLabel, type EvidenceView } from './labels';

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
  savedCases: SavedCase[];
  clearNotice: () => void;
  onSave: () => Promise<void>;
  onExport: (format: 'md' | 'json') => void;
  /** Close the preview and go edit the card (live session only). */
  onEdit?: () => void;
  /** Re-freeze the preview on the latest version. */
  onRefresh?: () => void;
}

type Phase = 'review' | 'saving' | 'settled';

export function SavePreview(props: SavePreviewProps) {
  const { open, onClose, card, liveCard, evidence, practice, notice, error, savedCases, clearNotice, onSave, onExport, onEdit, onRefresh } =
    props;
  const [phase, setPhase] = useState<Phase>('review');
  const versionChanged = !liveCard || liveCard.id !== card.id || liveCard.revision !== card.revision || isLocked(liveCard.validity) || liveCard.title !== card.title || JSON.stringify(liveCard.sections) !== JSON.stringify(card.sections);
  const savable = !isLocked(card.validity) && !versionChanged;

  useEffect(() => {
    if (open) setPhase('review');
  }, [open]);

  const save = async () => {
    if (phase === 'saving' || !savable) return;
    clearNotice();
    setPhase('saving');
    try {
      await onSave();
    } finally {
      setPhase('settled');
    }
  };

  // Success is only what actually landed in the local archive (or a fresh "已保存" receipt from the hook).
  const savedNow = isCardSaved(card, savedCases);
  const receipt = phase === 'settled' && /已保存|保存成功|已留下/.test(notice) ? notice : '';
  // clearNotice and saveCard clear earlier errors before this attempt; repeated failures are still failures.
  const failed = phase === 'settled' && !!error;
  const succeeded = phase === 'settled' && !failed && savedNow;

  const footer =
    phase === 'settled' ? (
      <div className="dialog__actions">
        {!succeeded && (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => onExport('json')}>
              <Braces aria-hidden="true" /> 先导出成文件
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setPhase('review')}>
              再试一次
            </button>
          </>
        )}
        <button type="button" className="btn btn--primary" onClick={onClose}>
          好
        </button>
      </div>
    ) : (
      <div className="dialog__actions">
        {onEdit && (
          <button type="button" className="btn btn--ghost" onClick={onEdit} disabled={phase === 'saving'}>
            <Pencil aria-hidden="true" /> 再改改
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={phase === 'saving'}>
          先不留
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={save}
          disabled={phase === 'saving' || !savable}
          aria-busy={phase === 'saving' || undefined}
        >
          {phase === 'saving' ? (
            <>
              <LoaderCircle aria-hidden="true" className="spin" /> 正在留下…
            </>
          ) : (
            <>
              <HardDrive aria-hidden="true" /> 就留下这些
            </>
          )}
        </button>
      </div>
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      className="save"
      title={phase === 'settled' ? (succeeded ? '留好了' : failed ? '这次没有留下来' : '还没收到回执') : '把这张留在这台设备上？'}
      subtitle={phase === 'settled' ? undefined : '先看一眼：会留下什么、留在哪里、什么不会带走。'}
      footer={footer}
    >
      {phase === 'settled' ? (
        <div className={`save-result ${succeeded ? 'is-ok' : 'is-failed'}`} role={succeeded ? 'status' : 'alert'}>
          {succeeded ? <CircleCheck aria-hidden="true" /> : failed ? <CircleX aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          <div>
            {succeeded ? (
              <>
                <p>{receipt || '这张卡片已经留在这台设备的这个浏览器里了。'}</p>
                <p className="small muted">以后在“以前留下的”里能找到它。要备份的话，也可以导出一份：</p>
                <div className="row gap-s wrap save-result__export">
                  <button type="button" className="text-btn" onClick={() => onExport('md')}>
                    <FileDown aria-hidden="true" /> Markdown
                  </button>
                  <button type="button" className="text-btn" onClick={() => onExport('json')}>
                    <Braces aria-hidden="true" /> JSON 备份
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>{failed ? error : '没有收到保存成功的回执，所以不能说它已经留下了。'}</p>
                <p className="small muted">卡片还在页面上，没有丢。可以再试一次，或者先导出成文件。</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="save-preview">
          {versionChanged ? (
            <div className="callout" role="alert">
              <p>
                <TriangleAlert aria-hidden="true" /> 你打开这里之后，卡片变了{liveCard ? `（现在是第 ${liveCard.revision} 版）` : ''}
                。为了不留下你没看过的内容，先看一眼最新的这版。
              </p>
              {onRefresh && liveCard && !isLocked(liveCard.validity) && (
                <button type="button" className="btn btn--quiet btn--sm" onClick={onRefresh}>
                  <RefreshCw aria-hidden="true" /> 看最新这版
                </button>
              )}
            </div>
          ) : (
            isLocked(card.validity) && (
              <p className="callout">
                <TriangleAlert aria-hidden="true" /> 这一版需要重新整理，不能留下。
              </p>
            )
          )}

          <section className="save-preview__will" aria-labelledby="sv-will">
            <h3 id="sv-will" className="save-preview__h">
              会留下
            </h3>
            <div className={`paper paper--${card.type} paper--mini`}>
              <p className="paper__kicker">
                {CARD_TYPE_LABEL[card.type]} · 只这一版{card.serviceMode === 'mock' ? ' · 演示生成' : ''}
              </p>
              <p className="paper__title">{card.title}{card.titleUserEdited && <span className="tag">你改写的标题</span>}</p>
              {card.sections.length > 0 ? (
                <dl className="slip-preview slip-preview--full">
                  {card.sections.map((s, i) => (
                    <div key={`${s.key}-${i}`}>
                      <dt>{sectionLabel(s.key)}</dt>
                      <dd className="prewrap">{s.userEdited && <span className="tag" style={{ display: 'table', marginBottom: 4 }}>你改写的内容</span>}{s.text || '（留空）'}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted small">只有标题。</p>
              )}
            </div>

            {card.sections.some(s => s.userEdited) && <p className="small muted">以下摘录是原版依据，不自动支持你的补写。</p>}
            {evidence.length > 0 ? (
              <details className="basis basis--block">
                <summary>
                  <ChevronDown aria-hidden="true" className="basis__chev" />
                  连同它引用的 {evidence.length} 段原话
                </summary>
                <div className="basis__body">
                  {evidence.map((ev) => (
                    <EvidenceQuote key={ev.key} ev={ev} />
                  ))}
                </div>
              </details>
            ) : (
              <p className="small muted">这张没有引用材料原话，所以不会存任何原文。</p>
            )}

            {practice.length > 0 && (
              <details className="basis basis--block">
                <summary>
                  <ChevronDown aria-hidden="true" className="basis__chev" />
                  还有 {practice.length} 道练过的题
                </summary>
                <ul className="basis__body practice-list">
                  {practice.map((p) => (
                    <li key={p.id}>
                      <p className="practice-list__q">{p.question}</p>
                      <p className="prewrap small">{p.answerOutline}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <div className="save-preview__side">
            <section aria-labelledby="sv-where">
              <h3 id="sv-where" className="save-preview__h">
                留在哪里
              </h3>
              <p>
                <strong>这台设备的这个浏览器</strong>。不上传，不同步到别的设备。换浏览器、清理浏览器数据，或者浏览器自己回收空间时，它可能会不见；别人用这台设备的这个浏览器，也可能看到。
              </p>
            </section>
            <section aria-labelledby="sv-wont">
              <h3 id="sv-wont" className="save-preview__h">
                不会带走
              </h3>
              <ul className="cross-list">
                <li>今晚完整的聊天</li>
                <li>录音</li>
                <li>没被这张卡片引用的材料</li>
                <li>其他版本和没留下的分析</li>
              </ul>
            </section>
          </div>
        </div>
      )}
    </Dialog>
  );
}
