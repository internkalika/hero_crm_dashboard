import { ReactNode, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { KpiGrid } from './KpiCard';

/** A second row of KPI cards that stays folded until asked for, so a page opens with five numbers, not fifteen. */
export function MoreMeasures({ children, label = 'More measures', cols = 5 }: { children: ReactNode; label?: string; cols?: 3 | 4 | 5 | 6 }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-ink-2 hover:bg-slate-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600">
        <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} aria-hidden />
        {open ? 'Fewer measures' : label}
      </button>
      {open && (
        <div className="mt-2">
          <KpiGrid cols={cols}>{children}</KpiGrid>
        </div>
      )}
    </div>
  );
}
