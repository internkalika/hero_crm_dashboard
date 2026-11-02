import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X, HelpCircle } from 'lucide-react';
import clsx from 'clsx';

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={clsx('card', pad && 'p-4', className)}>{children}</div>;
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const toneStyles: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-ink-2 ring-slate-200',
  good: 'bg-good-soft text-good-text ring-good/30',
  warn: 'bg-warn-soft text-warn-text ring-warn/40',
  bad: 'bg-bad-soft text-bad-text ring-bad/30',
  info: 'bg-info-soft text-info ring-info/30',
};

const toneIcon: Record<Tone, ReactNode> = {
  neutral: null,
  good: <CheckCircle2 size={12} aria-hidden />,
  warn: <AlertTriangle size={12} aria-hidden />,
  bad: <OctagonAlert size={12} aria-hidden />,
  info: <Info size={12} aria-hidden />,
};

/** Status colours always come with an icon and a label, never colour alone. */
export function Badge({ tone = 'neutral', children, icon = true, title }: { tone?: Tone; children: ReactNode; icon?: boolean; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', toneStyles[tone])}>
      {icon && toneIcon[tone]}
      {children}
    </span>
  );
}

export function Notice({ tone = 'info', title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const border = { neutral: 'border-slate-200', good: 'border-good/40', warn: 'border-warn/60', bad: 'border-bad/40', info: 'border-info/30' }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-lg border p-3 text-sm', border, toneStyles[tone].split(' ').slice(0, 1).join(' '))}>
      <div className="mt-0.5 shrink-0">{toneIcon[tone] ?? <Info size={14} />}</div>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold text-ink">{title}</div>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-ink-2">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-hero-600" />
      <span>{label}…</span>
    </div>
  );
}

/** Small "i" button that reveals a formula / exclusions popover on hover, focus or tap. */
export function InfoTip({ title, lines, className }: { title?: string; lines: Array<{ label?: string; text: ReactNode }>; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span ref={ref} className={clsx('relative inline-flex', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`How is this calculated${title ? `: ${title}` : ''}?`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="rounded-full text-ink-3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-1/2 top-full z-40 mt-1.5 w-72 -translate-x-1/2 rounded-md border border-slate-200 bg-surface p-3 text-left text-xs font-normal normal-case tracking-normal text-ink shadow-pop">
          {title && <span className="mb-1 block font-semibold">{title}</span>}
          {lines.map((l, i) => (
            <span key={i} className="mb-1 block last:mb-0">
              {l.label && <span className="font-semibold text-ink-2">{l.label}: </span>}
              <span className="text-ink-2">{l.text}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h1 className="min-w-0 text-xl font-semibold text-ink">{title}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">{children}</h2>
      {right}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-slate-300 bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('rounded px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', value === o.value ? 'bg-ink text-white' : 'text-ink-2 hover:bg-slate-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx('w-full rounded-lg bg-surface shadow-pop', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button aria-label="Close" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog for destructive actions. */
export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className={clsx('btn', danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{message}</div>
    </Modal>
  );
}
