import { ReactNode, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import { InfoTip, Tone } from './ui';

export interface KpiInfo {
  formula: string;
  exclusions?: string;
  source?: string;
}

/** A comparison that is only passed when comparable data exists; never a guess. */
export interface KpiTrend {
  text: string;
  dir: 'up' | 'down' | 'flat';
  /** whether movement in this direction is good news (for colouring); omit for neutral */
  good?: boolean;
}

export interface KpiProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  info?: KpiInfo;
  tone?: Tone;
  icon?: LucideIcon;
  trend?: KpiTrend;
  onClick?: () => void;
  active?: boolean;
  /** when set, the value is shown as unavailable with this reason */
  unavailable?: string;
  hint?: string;
  /** smaller value text for dense rows */
  compact?: boolean;
  /** when a number belongs to more than one page, the card opens a small menu of destinations instead of navigating */
  menu?: Array<{ label: string; onClick: () => void }>;
}

const chip: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-ink-2',
  good: 'bg-good-soft text-good-text',
  warn: 'bg-warn-soft text-warn-text',
  bad: 'bg-hero-50 text-hero-700',
  info: 'bg-info-soft text-info',
};

function Trend({ t }: { t: KpiTrend }) {
  const Icon = t.dir === 'up' ? ArrowUpRight : t.dir === 'down' ? ArrowDownRight : Minus;
  const cls = t.good === undefined || t.dir === 'flat' ? 'bg-slate-100 text-ink-2' : (t.dir === 'up') === t.good ? 'bg-good-soft text-good-text' : 'bg-bad-soft text-bad-text';
  return (
    <span className={clsx('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold', cls)}>
      <Icon size={12} aria-hidden />
      {t.text}
    </span>
  );
}

export function KpiCard({ label, value, sub, info, tone = 'neutral', icon: Icon, trend, onClick: onClickProp, active, unavailable, hint, compact, menu }: KpiProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setMenuOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);
  const onClick = menu ? () => setMenuOpen((o) => !o) : onClickProp;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold uppercase leading-tight tracking-wide text-ink-3">{label}</span>
            {info && (
              <InfoTip
                title={label}
                lines={[{ label: 'Formula', text: info.formula }, ...(info.exclusions ? [{ label: 'Excludes', text: info.exclusions }] : []), ...(info.source ? [{ label: 'Source', text: info.source }] : []), ...(onClick ? [{ label: 'Click', text: hint ?? 'Opens the page behind this number.' }] : [])]}
              />
            )}
          </div>
        </div>
        {Icon && (
          <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', chip[tone === 'neutral' ? 'bad' : tone])} aria-hidden>
            <Icon size={18} />
          </span>
        )}
      </div>
      {unavailable ? (
        <div className="mt-2">
          <div className="text-2xl font-bold text-ink-3">—</div>
          <div className="mt-0.5 text-xs text-ink-3">{unavailable}</div>
        </div>
      ) : (
        <div className="mt-2">
          <div className={clsx('tnum font-bold leading-tight tracking-tight text-ink', 'whitespace-nowrap', compact ? 'text-xl sm:text-2xl' : 'text-[1.3rem] sm:text-[1.7rem]')}>{value}</div>
          {(trend || sub) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
              {trend && <Trend t={trend} />}
              {sub && <span>{sub}</span>}
            </div>
          )}
        </div>
      )}
      {onClick && (
        <span className="pointer-events-none absolute bottom-2.5 right-3 text-hero-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
          <ArrowRight size={14} />
        </span>
      )}
    </>
  );
  const cls = clsx('card group relative p-4 text-left', onClick && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-hero-200 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-2', active && 'border-hero-600 ring-2 ring-hero-600');
  if (onClick) {
    const card = (
      <div role="button" tabIndex={0} aria-pressed={menu ? undefined : active} aria-haspopup={menu ? 'menu' : undefined} aria-expanded={menu ? menuOpen : undefined} aria-label={`${label}: ${unavailable ? 'unavailable' : typeof value === 'string' || typeof value === 'number' ? value : ''}`} onClick={onClick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())} className={cls}>
        {body}
      </div>
    );
    if (!menu) return card;
    return (
      <div ref={wrap} className="relative h-full [&>[role=button]]:h-full">
        {card}
        {menuOpen && (
          <div role="menu" aria-label={`${label}: open`} className="absolute inset-x-0 top-full z-20 mt-1 rounded-md border border-slate-200 bg-surface p-1 text-sm shadow-pop">
            {menu.map((m) => (
              <button
                key={m.label}
                role="menuitem"
                className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-hero-50 focus:bg-hero-50 focus:outline-none"
                onClick={() => {
                  setMenuOpen(false);
                  m.onClick();
                }}
              >
                {m.label}
                <ArrowRight size={14} className="text-hero-600" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return <div className={cls}>{body}</div>;
}

export function KpiGrid({ children, cols = 5 }: { children: ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const c = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-2 xl:grid-cols-4', 5: 'lg:grid-cols-3 xl:grid-cols-5', 6: 'lg:grid-cols-3 xl:grid-cols-6' }[cols];
  return <div className={clsx('grid grid-cols-2 gap-2 sm:gap-3', c)}>{children}</div>;
}
