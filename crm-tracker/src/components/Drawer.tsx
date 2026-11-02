import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={title} className="flex h-full w-full max-w-xl flex-col bg-white shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-ink-2">{subtitle}</div>}
          </div>
          <button aria-label="Close details" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4">{children}</div>
        {footer && <footer className="border-t border-slate-200 p-3">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[9rem,1fr] gap-x-3 gap-y-1.5 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
