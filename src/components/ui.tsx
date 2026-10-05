'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { errorMessage } from '@/lib/format';
import { useSettings } from './settings-provider';

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        {back}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

// Index for the staggered .reveal entry animation.
export const stagger = (index: number) => ({ '--i': index }) as CSSProperties;

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="section-heading"><h2>{title}</h2>{action}</div>;
}

export function StatusPill({ tone = 'neutral', children }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral'; children: ReactNode }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><i className={`bi ${icon}`} /></span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorAlert({ error, onRetry, retryLabel }: { error: unknown; onRetry?: () => void; retryLabel?: string }) {
  const { t } = useSettings();
  return (
    <div className="app-alert mb-4" role="alert">
      <i className="bi bi-exclamation-circle-fill mt-1" />
      <span className="flex-grow-1">{errorMessage(error, t)}</span>
      {onRetry && <button type="button" className="btn btn-sm btn-outline-danger" onClick={onRetry}>{retryLabel ?? t('retry')}</button>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="d-flex align-items-center justify-content-center gap-2 py-5 text-body-secondary" role="status"><span className="spinner-border spinner-border-sm" /><span>{label}</span></div>;
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="app-panel" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <div className="skeleton" style={{ width: 46, height: 46 }} />
          <div className="flex-grow-1">
            <div className="skeleton mb-2" style={{ width: `${55 + (index % 3) * 10}%`, height: 12 }} />
            <div className="skeleton" style={{ width: '38%', height: 9 }} />
          </div>
        </div>
      ))}
    </div>
  );
}


export function Modal({ title, show, onClose, children, size, variant = 'sheet' }: { title: string; show: boolean; onClose: () => void; children: ReactNode; size?: 'lg' | 'xl'; variant?: 'modal' | 'sheet' }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (show && !node.open) {
      node.showModal();
      requestAnimationFrame(() => node.querySelector<HTMLElement>('[autofocus]')?.focus());
    }
    if (!show && node.open) node.close();
  }, [show]);

  useEffect(() => {
    const node = dialog.current;
    return () => { if (node?.open) node.close(); };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`app-dialog ${size ? `app-dialog-${size}` : ''} ${variant === 'sheet' ? 'app-dialog-sheet' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (!inside) onClose();
      }}
    >
      <div className="app-dialog-header">
        <h2 className="app-dialog-title" id={titleId}>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
      </div>
      {children}
    </dialog>
  );
}

export function ConfirmButton({ message, title = 'Are you sure?', confirmLabel = 'Delete', cancelLabel = 'Cancel', onConfirm, className = 'btn btn-danger', children }: { message: string; title?: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void | Promise<void>; className?: string; children: ReactNode }) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  async function confirmAction() {
    setBusy(true); setError(undefined);
    try { await onConfirm(); setOpen(false); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
    <Modal title={title} show={open} onClose={() => !busy && setOpen(false)} variant="modal">
      <div className="modal-body"><p className="mb-0 text-body-secondary">{message}</p>{Boolean(error) && <div className="app-alert mt-3 mb-0" role="alert">{errorMessage(error, t)}</div>}</div>
      <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => setOpen(false)}>{cancelLabel}</button><button type="button" className="btn btn-danger" disabled={busy} onClick={confirmAction}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{confirmLabel}</button></div>
    </Modal>
  </>;
}

type ToastTone = 'success' | 'error';
type Toast = { id: number; tone: ToastTone; message: string };
type ToastContextValue = { toast: (message: string, tone?: ToastTone) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3600);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return <ToastContext.Provider value={value}>{children}<div className="toast-viewport" aria-live="polite" aria-atomic="false">{toasts.map((item) => <div className={`app-toast ${item.tone}`} key={item.id} role="status"><i className={`bi ${item.tone === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill'}`} /><span className="flex-grow-1">{item.message}</span><button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setToasts((current) => current.filter((value) => value.id !== item.id))}><i className="bi bi-x" /></button></div>)}</div></ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
