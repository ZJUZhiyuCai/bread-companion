'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, LoaderCircle, MessageCircle, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { Card, SavedCase } from '@/domain/types';
import { Dialog } from './Dialog';
import { EvidenceQuote } from './Evidence';
import { useDomId } from './hooks';
import { CARD_TYPE_LABEL, VALIDITY_META, formatDateTime, sectionLabel, viewEvidence } from './labels';

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

function latestCard(c: SavedCase): Card | null {
  if (c.cards.length === 0) return null;
  return [...c.cards].sort((a, b) => b.revision - a.revision)[0];
}

export function SavedArchive(props: SavedArchiveProps) {
  const { open, onClose, savedCases, sessionLive, refreshSaved, deleteSaved, importSaved, onResume, onTalkElse, notice, error } =
    props;
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
      title={current ? '本设备档案 · 一张卡片' : '本设备档案'}
      subtitle="存在这台设备的当前浏览器里，和今晚的临时对话分开。不是云备份，不能跨设备。"
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
              <LoaderCircle aria-hidden="true" className="spin" /> 正在读取…
            </p>
          ) : sorted.length === 0 ? (
            <div className="drawer-empty">
              <div className="drawer-empty__art" aria-hidden="true" />
              <p>抽屉是空的。</p>
              <p className="muted small">只有你确认、并在保存预览里点了“保存”的卡片才会放进来。不保存也完全没关系。</p>
            </div>
          ) : (
            <ul className="archive__list" aria-label="已保存的卡片">
              {sorted.map((c) => {
                const card = latestCard(c);
                return (
                  <li key={c.caseId}>
                    <button type="button" className="archive__item" onClick={() => setSelected(c.caseId)}>
                      <span className={`archive__type archive__type--${card?.type ?? 'note'}`}>
                        {card ? CARD_TYPE_LABEL[card.type] : '档案'}
                      </span>
                      <span className="archive__main">
                        <span className="archive__title">{card?.title ?? '（没有卡片）'}{card && card.validity !== 'confirmed' ? ` · ${VALIDITY_META[card.validity].label}` : ''}</span>
                        <span className="archive__meta">
                          {formatDateTime(c.savedAt)} 保存 · {c.cards.length} 个版本 · {c.selectedEvidence.length} 段摘录
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
            <h3 id={`${id}-imp`}>从 JSON 备份导入</h3>
            <p className="small muted">只接受面包导出的 JSON 备份。文件会先被校验，不会执行其中任何内容。</p>
            <label className="btn btn--ghost file-btn">
              {working === 'importing' ? <LoaderCircle aria-hidden="true" className="spin" /> : <Upload aria-hidden="true" />}
              {working === 'importing' ? '正在导入…' : '选择 JSON 文件'}
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
  const { saved, sessionLive, confirmDelete, deleting, onBack, onResume, onTalkElse, onLater, onAskDelete, onCancelDelete, onDelete } =
    props;
  const card = latestCard(saved);
  const older = [...saved.cards].sort((a, b) => b.revision - a.revision).slice(1);
  const ctx = { sources: null, snapshot: saved.selectedEvidence };
  const byId = new Map(saved.findings.map((f) => [f.id, f]));

  return (
    <div className="archive-detail">
      <button type="button" className="link-btn" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> 返回列表
      </button>

      {card ? (
        <article className={`paper-card paper-card--${card.type} is-${card.validity} is-readonly`}>
          <span className="paper-card__hole" aria-hidden="true" />
          <header className="paper-card__head">
            <p className="paper-card__kicker">
              {CARD_TYPE_LABEL[card.type]} · 第 {card.revision} 版 · {formatDateTime(saved.savedAt)} 保存
            </p>
            <h3 className="paper-card__title">{card.title}</h3>
            {card.validity !== 'confirmed' && <p className="callout callout--locked">{VALIDITY_META[card.validity].desc}。这里只保留历史记录，不能当作当前已确认结论。</p>}
          </header>
          <dl className="paper-card__sections">
            {card.sections.map((s, i) => (
              <div className="section" key={`${s.key}-${i}`}>
                <dt className="section__label">{sectionLabel(s.key)}</dt>
                <dd className="section__text">
                  {s.text ? <span className="prewrap">{s.text}</span> : <span className="muted">（留空）</span>}
                  {s.findingIds.length > 0 && (
                    <div className="section__quotes">
                      {s.findingIds
                        .map((fid) => byId.get(fid))
                        .flatMap((f) => f?.evidenceRefs ?? [])
                        .map((r) => {
                          const ev = viewEvidence(r, ctx);
                          return <EvidenceQuote key={ev.key} ev={ev} />;
                        })}
                    </div>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ) : (
        <p className="muted">这份档案里没有卡片。</p>
      )}

      {saved.confirmedPractice.length > 0 && (
        <section>
          <h3 className="pane-section__title">练习提纲</h3>
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

      {older.length > 0 && (
        <p className="small muted">还保存了更早的 {older.length} 个版本：{older.map((c) => `第 ${c.revision} 版`).join('、')}。</p>
      )}

      <section className="next-choice" aria-label="接下来">
        <h3 className="pane-section__title">今天想怎么用它？</h3>
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
          “继续看这道题”会开始一个新的对话，只带入这张卡片仍有效的来源摘录，先作为待核对材料
          {sessionLive ? '；现在这次对话里没保存的内容不会带过去，会被清掉' : ''}。
        </p>
      </section>

      <section className="danger-zone" aria-label="删除">
        {confirmDelete ? (
          <div className="inline-confirm" role="group" aria-label="确认删除">
            <p>删除后，这份档案的所有版本、摘录和练习都会从本设备移除，不能撤销。已经导出的文件不受影响。</p>
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
          <button type="button" className="btn btn--ghost btn--sm danger-text" onClick={onAskDelete}>
            <Trash2 aria-hidden="true" /> 从本设备删除这份档案
          </button>
        )}
      </section>
    </div>
  );
}
