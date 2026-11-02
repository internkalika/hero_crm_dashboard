import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';

export interface DownloadItem {
  label: string;
  run: () => void | Promise<void>;
}

/** A quiet icon button with a short menu of downloads (Excel / CSV). Exports stay available without a loud button. */
export function DownloadMenu({ items, label = 'Download', disabled }: { items: DownloadItem[]; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className="btn btn-ghost btn-sm text-ink-2" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled || busy} onClick={() => setOpen((o) => !o)} data-testid="download-menu">
        <Download size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-slate-200 bg-white p-1 text-xs shadow-pop">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
              onClick={async () => {
                setBusy(true);
                try {
                  await it.run();
                } finally {
                  setBusy(false);
                  setOpen(false);
                }
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
