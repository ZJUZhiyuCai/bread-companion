'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Braces, ChevronRight, FileDown, LoaderCircle, MessageCircle, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { SavedCase } from '@/domain/types';
import { Dialog } from './Dialog';
import { EvidenceQuote } from './Evidence';
import { downloadSavedCase } from './exporters';
import { useDomId } from './hooks';
import { CARD_TYPE_LABEL, VALIDITY_META, formatDateTime, latestCard, sectionLabel, viewEvidence } from './labels';

interface SavedArchiveProps {
  open: boolean;
  onClose: () => void;
  savedCases: SavedCase[];
  sessionLive: boolean;
  refreshSaved: () => Promise<void>;
  deleteSaved: (caseId: string) => Promise<void>;
  importSaved: (file: File) => Promise<void>;
  onResume: (saved: SavedCase) => void;
  onTalkElse: () => void;
  /** Shown inline: toasts outside a modal dialog are covered by it. */
  notice: string;
  error: string;
}

export function SavedArchive(props: SavedArchiveProps) {
  const { open, onClose, savedCases, sessionLive, refreshSaved, deleteSaved, importSaved, onResume, onTalkElse, notice, error } = props;
  const id = useDomId('archive');
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState<'none' | 'loading' | 'deleting' | 'importing'>('none');
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef(refreshSaved);
  refreshRef.current = refreshSaved;

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setConfirmDelete(false);
      return;
    }
    setWorking('loading');
    refreshRef.current().finally(() => setWorking('none'));
  }, [open]);

  const current = savedCases.find((c) => c.caseId === selected) ?? null;
  const sorted = [...savedCases].sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  const doDelete = async () => {
    if (!current) return;
    setWorking('deleting');
    try {
      await deleteSaved(current.caseId);
      setSelected(null);
      setConfirmDelete(false);
    } finally {
      setWorking('none');
    }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    setWorking('importing');
    try {
      await importSaved(file);
    } finally {
      setWorking('none');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      className="archive"
      title={current ? '以前留下的 · 一张' : '以前留下的'}
      subtitle="只在这台设备的这个浏览器里，和今晚的对话分开。不是云备份，不能跨设备。"
    >
      <div className="archive__msgs">
        <p role="status" className="archive__msg">
          {notice}
        </p>
        <p role="alert" className="archive__msg archive__msg--error">
          {error}
        </p>
      </div>

      {current ? (
        <ArchiveDetail
          saved={current}
          sessionLive={sessionLive}
          confirmDelete={confirmDelete}
          deleting={working === 'deleting'}
          onBack={() => {
            setSelected(null);
            setConfirmDelete(false);
          }}
          onResume={() => {
            onResume(current);
            onClose();
          }}
          onTalkElse={() => {
            onTalkElse();
            onClose();
          }}
          onLater={onClose}
          onAskDelete={() => setConfirmDelete(true)}
          onCancelDelete={() => setConfirmDelete(false)}
          onDelete={doDelete}
        />
      ) : (
        <>
          {working === 'loading' && sorted.length === 0 ? (
            <p className="muted">
              <LoaderCircle aria-hidden="true" className="spin" /> 正在打开抽屉…
            </p>
          ) : sorted.length === 0 ? (
            <div className="drawer-empty">
              <span className="drawer-empty__art" aria-hidden="true" />
              <p>抽屉是空的。</p>
              <p className="muted small">只有你点过“就留下这些”的卡片才会放进来。什么都不留，也完全没关系。</p>
            </div>
          ) : (
            <ul className="archive__list" aria-label="留下的卡片">
              {sorted.map((c) => {
                const card = latestCard(c);
                return (
                  <li key={c.caseId}>
                    <button type="button" className={`archive__item archive__item--${card?.type ?? 'note'}`} onClick={() => setSelected(c.caseId)}>
                      <span className="archive__tag" aria-hidden="true" />
                      <span className="archive__main">
                        <span className="archive__type">{card ? CARD_TYPE_LABEL[card.type] : '档案'}</span>
                        <span className="archive__title">
                          {card?.title ?? '（没有卡片）'}
                          {card && card.validity !== 'confirmed' ? ` · ${VALIDITY_META[card.validity].label}` : ''}
                        </span>
                        <span className="archive__meta">
                          {formatDateTime(c.savedAt)} 留下
                          {c.selectedEvidence.length > 0 && ` · ${c.selectedEvidence.length} 段原话`}
                          {c.confirmedPractice.length > 0 && ` · ${c.confirmedPractice.length} 道练习`}
                        </span>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <section className="archive__import" aria-labelledby={`${id}-imp`}>
            <h3 id={`${id}-imp`} className="archive__h">
              从备份文件放回来
            </h3>
            <p className="small muted">只接受面包导出的 JSON 备份。文件会先被检查，里面的任何内容都不会被执行。</p>
            <label className="btn btn--ghost file-btn">
              {working === 'importing' ? <LoaderCircle aria-hidden="true" className="spin" /> : <Upload aria-hidden="true" />}
              {working === 'importing' ? '正在放回…' : '选择 JSON 文件'}
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                disabled={working === 'importing'}
                onChange={(e) => void doImport(e.target.files?.[0])}
              />
            </label>
          </section>
        </>
      )}
    </Dialog>
  );
}

interface ArchiveDetailProps {
  saved: SavedCase;
  sessionLive: boolean;
  confirmDelete: boolean;
  deleting: boolean;
  onBack: () => void;
  onResume: () => void;
  onTalkElse: () => void;
  onLater: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}

function ArchiveDetail(props: ArchiveDetailProps) {
  const { saved, sessionLive, confirmDelete, deleting, onBack, onResume, onTalkElse, onLater, onAskDelete, onCancelDelete, onDelete } = props;
  const card = latestCard(saved);
  const older = [...saved.cards].sort((a, b) => b.revision - a.revision).slice(1);
  const ctx = { sources: null, snapshot: saved.selectedEvidence };
  const byId = new Map(saved.findings.map((f) => [f.id, f]));

  return (
    <div className="archive-detail">
      <button type="button" className="text-btn" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> 回到抽屉
      </button>

      {card ? (
        <article className={`paper paper--${card.type} is-${card.validity} is-readonly`} aria-labelledby="arch-title">
          {card.type === 'note' ? <span className="paper__hole" aria-hidden="true" /> : <span className="paper__perf" aria-hidden="true" />}
          <header className="paper__head">
            <p className="paper__kicker">
              {CARD_TYPE_LABEL[card.type]} · {formatDateTime(saved.savedAt)} 留下
              {card.serviceMode === 'mock' && ' · 演示生成'}
            </p>
            <h3 id="arch-title" className="paper__title">
              {card.title}{card.titleUserEdited && <span className="tag">你改写的标题</span>}
            </h3>
            {card.validity !== 'confirmed' && (
              <p className="callout callout--faded">{VALIDITY_META[card.validity].desc}。这里只是历史记录，不当作现在有效的结论。</p>
            )}
          </header>
          <dl className="paper__sections">
            {card.sections.map((s, i) => {
              const refs = s.findingIds.map((fid) => byId.get(fid)).flatMap((f) => f?.evidenceRefs ?? []);
              return (
                <div className="paper__section" key={`${s.key}-${i}`}>
                  <dt className="paper__label">{sectionLabel(s.key)}</dt>
                  <dd className="paper__text">
                    {s.userEdited && <span className="tag" style={{ whiteSpace: 'normal' }}>你改写的内容 · 原版依据不自动支持补写</span>}
                    {s.text ? <span className="prewrap">{s.text}</span> : <span className="muted">（留空）</span>}
                    {refs.length > 0 && (
                      <details className="basis">
                        <summary>{s.userEdited ? '原版依据' : '原话'} {refs.length} 处</summary>
                        <div className="basis__body">
                          {refs.map((r) => {
                            const ev = viewEvidence(r, ctx);
                            return <EvidenceQuote key={ev.key} ev={ev} />;
                          })}
                        </div>
                      </details>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </article>
      ) : (
        <p className="muted">这份档案里没有卡片。</p>
      )}

      {saved.confirmedPractice.length > 0 && (
        <section>
          <h3 className="archive__h">练过的题</h3>
          <ul className="practice-list">
            {saved.confirmedPractice.map((p) => (
              <li key={p.id}>
                <p className="practice-list__q">{p.question}</p>
                <p className="prewrap small">{p.answerOutline}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {older.length > 0 && <p className="small muted">还留着更早的 {older.length} 个版本：{older.map((c) => `第 ${c.revision} 版`).join('、')}。</p>}

      <section className="next-choice" aria-labelledby="arch-next">
        <h3 id="arch-next" className="archive__h">
          今天想怎么用它？
        </h3>
        <div className="next-choice__row">
          <button type="button" className="btn btn--primary" onClick={onResume}>
            <RotateCcw aria-hidden="true" /> 继续看这道题
          </button>
          <button type="button" className="btn btn--ghost" onClick={onTalkElse}>
            <MessageCircle aria-hidden="true" /> 今天聊别的
          </button>
          <button type="button" className="btn btn--ghost" onClick={onLater}>
            暂时不看
          </button>
        </div>
        <p className="small muted">
          “继续看这道题”会开始一次新的对话，只带入此前保存的有效原话摘录；旧卡片仍留在抽屉里
          {sessionLive ? '；现在这次对话里没留下的内容不会带过去，会被清掉' : ''}。
        </p>
      </section>

      <section className="archive__tools" aria-label="导出与删除">
        <div className="row gap-s wrap">
          <span className="small muted">导出这一份：</span>
          <button type="button" className="text-btn" onClick={() => downloadSavedCase(saved, 'md')}>
            <FileDown aria-hidden="true" /> Markdown
          </button>
          <button type="button" className="text-btn" onClick={() => downloadSavedCase(saved, 'json')}>
            <Braces aria-hidden="true" /> JSON 备份
          </button>
        </div>
        {confirmDelete ? (
          <div className="inline-confirm inline-confirm--danger" role="group" aria-label="确认删除">
            <p>删掉后，这一份的所有版本、原话和练习都会从这台设备上移除，不能撤销。已经导出的文件不受影响。</p>
            <div className="row gap-s">
              <button type="button" className="btn btn--danger" onClick={onDelete} disabled={deleting}>
                {deleting ? <LoaderCircle aria-hidden="true" className="spin" /> : <Trash2 aria-hidden="true" />}
                {deleting ? '正在删除…' : '确定删除'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={onCancelDelete} disabled={deleting}>
                不删了
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="text-btn text-btn--danger" onClick={onAskDelete}>
            <Trash2 aria-hidden="true" /> 从这台设备删除这一份
          </button>
        )}
      </section>
    </div>
  );
}
