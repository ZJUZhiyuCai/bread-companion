'use client';

import { useEffect, useRef, useState } from 'react';
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

/** Results come only from the hook's notice/error — the UI never announces a success on its own. */
export function Notices({ notice, error, clearNotice, canRetry, retryLastTurn, connectionError, connectionChecking, refreshCapabilities }: NoticesProps) {
  const [hiddenError, setHiddenError] = useState('');
  const clearRef = useRef(clearNotice);
  clearRef.current = clearNotice;

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => clearRef.current(), 8000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => { if (!error) setHiddenError(''); }, [error]);

  const showError = !!error && error !== hiddenError;

  return (
    <div className={`toasts ${connectionError ? 'has-connection' : ''}`}>
      <div role="status" aria-live="polite" className="toasts__slot">
        {connectionError && (
          <div className="toast toast--connection" aria-busy={connectionChecking || undefined}>
            <span className="toast__signal" aria-hidden="true" />
            <p className="toast__text">{connectionChecking ? '正在重新连接…' : connectionError}</p>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={connectionChecking}
              aria-busy={connectionChecking || undefined}
              onClick={() => void refreshCapabilities?.()}
            >
              {connectionChecking && <LoaderCircle aria-hidden="true" className="spin" />}
              {connectionChecking ? '连接中' : '重新连接'}
            </button>
          </div>
        )}
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
  );
}
