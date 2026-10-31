'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDomId } from './hooks';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** 'sheet' always slides up from the bottom (mobile tray); 'center' becomes a sheet only on small screens. */
  variant?: 'center' | 'sheet';
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
}

/** Native <dialog>: focus containment, Esc to close and inert background come for free. */
export function Dialog(props: DialogProps) {
  const { open, onClose, title, subtitle, size = 'md', variant = 'center', className = '', children, footer, closeLabel = '关闭' } =
    props;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useDomId('dlg-title');
  const descId = useDomId('dlg-desc');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size} dialog--${variant} ${className}`}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? descId : undefined}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__inner">
          <span className="dialog__grip" aria-hidden="true" />
          <header className="dialog__head">
            <div>
              <h2 id={titleId} className="dialog__title">
                {title}
              </h2>
              {subtitle && (
                <p id={descId} className="dialog__subtitle">
                  {subtitle}
                </p>
              )}
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>
              <X aria-hidden="true" />
            </button>
          </header>
          {/* focusable so keyboard users can scroll long content */}
          <div className="dialog__body" tabIndex={0}>
            {children}
          </div>
          {footer && <footer className="dialog__foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
