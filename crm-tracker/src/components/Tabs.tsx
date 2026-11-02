import { ReactNode, useRef } from 'react';
import clsx from 'clsx';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** small count or note shown next to the label */
  badge?: ReactNode;
}

/** Underline tabs: keeps each screen focused instead of stacking every chart and table on one page. */
export function Tabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: Array<TabDef<T>>; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    onChange(tabs[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={clsx('mb-4 flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') (e.preventDefault(), move(i + 1));
              else if (e.key === 'ArrowLeft') (e.preventDefault(), move(i - 1));
            }}
            className={clsx('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', on ? 'border-hero-600 text-hero-700' : 'border-transparent text-ink-2 hover:border-slate-300 hover:text-ink')}
          >
            {t.label}
            {t.badge !== undefined && <span className={clsx('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', on ? 'bg-hero-50 text-hero-700' : 'bg-slate-100 text-ink-2')}>{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
