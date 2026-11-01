'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react';

interface NoticesProps {
  notice: string;
  error: string;
  clearNotice: () => void;
  canRetry?: boolean;
  retryLastTurn?: () => Promise<void>;
  connectionError?: string;
  connectionChecking?: boolean;
  refreshCapabilities?: () => Promise<void>;
}

/** The red phone's coiled cord, come apart in the middle: "the line isn't through". Static. */
function CordBreak() {
  return (
    <svg className="connbar__cord" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 12.5c1.2 0 1.6-2.6 2.8-2.6s1.2 2.6 2.4 2.6 1.3-2.6 2.5-2.6" />
      <path d="M14.3 9.9c1.2 0 1.3 2.6 2.5 2.6s1.2-2.6 2.4-2.6 1.6 2.6 2.8 2.6" />
      <path className="connbar__spark" d="M12 5.6v1.6M12 16.8v1.6M9.9 6.6l.7 1.2M14.1 6.6l-.7 1.2" />
    </svg>
  );
}

/** Results come only from the hook's notice/error — the UI never announces a success on its own. */
export function Notices({ notice, error, clearNotice, canRetry, retryLastTurn, connectionError, connectionChecking, refreshCapabilities }: NoticesProps) {
  const [hiddenError, setHiddenError] = useState('');
  const clearRef = useRef(clearNotice);
  clearRef.current = clearNotice;
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => clearRef.current(), 8000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => { if (!error) setHiddenError(''); }, [error]);

  // The page makes room for the connection line instead of being covered by it: its real height
  // (it may wrap, or grow with the text size) is published as --conn-h, and the views step down by it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = barRef.current;
    if (!connectionError || !el) {
      root.style.removeProperty('--conn-h');
      return;
    }
    const measure = () => root.style.setProperty('--conn-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--conn-h');
    };
  }, [connectionError]);

  const showError = !!error && error !== hiddenError;

  return (
    <>
      <div role="status" aria-live="polite" className="connbar-slot">
        {connectionError && (
          <div ref={barRef} className="connbar" aria-busy={connectionChecking || undefined}>
            <div className="connbar__inner">
              <CordBreak />
              <p className="connbar__text">{connectionChecking ? '正在重新连接…' : connectionError}</p>
              <button
                type="button"
                className="btn btn--ghost btn--sm connbar__btn"
                disabled={connectionChecking}
                aria-busy={connectionChecking || undefined}
                onClick={() => void refreshCapabilities?.()}
              >
                {connectionChecking && <LoaderCircle aria-hidden="true" className="spin" />}
                {connectionChecking ? '连接中' : '重新连接'}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="toasts">
        <div role="status" aria-live="polite" className="toasts__slot">
          {notice && (
            <div className="toast">
              <CircleCheck aria-hidden="true" className="toast__icon" />
              <p className="toast__text">{notice}</p>
              <button type="button" className="icon-btn icon-btn--sm" onClick={clearNotice} aria-label="关闭提示">
                <X aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        <div role="alert" className="toasts__slot">
          {showError && (
            <div className="toast toast--error">
              <TriangleAlert aria-hidden="true" className="toast__icon" />
              <p className="toast__text">{error}</p>
              {canRetry && retryLastTurn && <button type="button" className="btn btn--secondary btn--sm" onClick={() => void retryLastTurn()}>再试一次</button>}
              <button type="button" className="icon-btn icon-btn--sm" onClick={() => setHiddenError(error)} aria-label="关闭错误提示">
                <X aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
