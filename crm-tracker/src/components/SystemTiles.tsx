// The Executive Overview's system tiles: one large tile per system with its headline number, and a few smaller tiles
// below it with the details. Every tile is a button that opens the page behind the number.
import { ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import { InfoTip } from './ui';
import type { KpiInfo, KpiTrend } from './KpiCard';

export interface TileCommon {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: KpiTrend;
  info?: KpiInfo;
  onClick?: () => void;
  hint?: string;
  /** shown instead of the value when the data behind it was not imported */
  unavailable?: string;
  tone?: 'neutral' | 'warn' | 'bad' | 'good';
}

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

const tileInfo = (label: string, info: KpiInfo | undefined, onClick: unknown, hint?: string) =>
  info ? (
    <InfoTip
      title={label}
      lines={[{ label: 'Formula', text: info.formula }, ...(info.exclusions ? [{ label: 'Excludes', text: info.exclusions }] : []), ...(info.source ? [{ label: 'Source', text: info.source }] : []), ...(onClick ? [{ label: 'Click', text: hint ?? 'Opens the page behind this number.' }] : [])]}
    />
  ) : null;

const press = (onClick?: () => void) => ({
  role: onClick ? ('button' as const) : undefined,
  tabIndex: onClick ? 0 : undefined,
  onClick,
  onKeyDown: onClick ? (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined,
});

/** The large tile: the system's name, one headline number, its change and a one-line summary. */
export function SystemTile({ accent, name, icon: Icon, ...t }: TileCommon & { accent: string; name: string; icon: LucideIcon }) {
  const ariaValue = typeof t.value === 'string' || typeof t.value === 'number' ? t.value : '';
  return (
    <div
      {...press(t.onClick)}
      aria-label={t.onClick ? `${name}: ${t.label} ${t.unavailable ? 'unavailable' : ariaValue}` : undefined}
      className={clsx('card group relative overflow-hidden p-4 text-left sm:p-5', t.onClick && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-2')}
      style={{ borderTop: `4px solid ${accent}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: accent }} aria-hidden>
            <Icon size={16} />
          </span>
          <span className="text-base font-semibold text-ink">{name}</span>
        </div>
        <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-3">
          {t.label}
          {tileInfo(t.label, t.info, t.onClick, t.hint)}
        </span>
      </div>
      {t.unavailable ? (
        <div className="mt-3">
          <div className="text-3xl font-bold text-ink-3">—</div>
          <div className="mt-1 text-xs text-ink-3">{t.unavailable}</div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="tnum whitespace-nowrap text-[2rem] font-bold leading-none tracking-tight text-ink sm:text-[2.25rem]">{t.value}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
            {t.trend && <Trend t={t.trend} />}
            {t.sub && <span>{t.sub}</span>}
          </div>
        </div>
      )}
      {t.onClick && (
        <span className="pointer-events-none absolute bottom-3 right-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" style={{ color: accent }} aria-hidden>
          <ArrowRight size={16} />
        </span>
      )}
    </div>
  );
}

/** The smaller detail tile under a system tile. */
export function MiniTile({ accent, ...t }: TileCommon & { accent: string }) {
  const ariaValue = typeof t.value === 'string' || typeof t.value === 'number' ? t.value : '';
  return (
    <div
      {...press(t.onClick)}
      aria-label={t.onClick ? `${t.label}: ${t.unavailable ? 'unavailable' : ariaValue}` : undefined}
      className={clsx('card group relative flex min-w-0 flex-col justify-between p-3 text-left', t.onClick && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-2')}
      style={{ borderLeft: `3px solid ${t.tone === 'warn' ? '#fab219' : t.tone === 'bad' ? '#d03b3b' : accent}` }}
    >
      <div className="flex items-center gap-1">
        <span className="truncate text-[11px] font-semibold uppercase leading-tight tracking-wide text-ink-3">{t.label}</span>
        {tileInfo(t.label, t.info, t.onClick, t.hint)}
      </div>
      {t.unavailable ? (
        <div className="mt-1.5">
          <div className="text-xl font-bold text-ink-3">—</div>
          <div className="text-[11px] leading-tight text-ink-3">{t.unavailable}</div>
        </div>
      ) : (
        <div className="mt-1.5">
          <div className="tnum whitespace-nowrap text-xl font-bold leading-tight tracking-tight text-ink">{t.value}</div>
          {(t.trend || t.sub) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight text-ink-2">
              {t.trend && <Trend t={t.trend} />}
              {t.sub && <span>{t.sub}</span>}
            </div>
          )}
        </div>
      )}
      {t.onClick && (
        <span className="pointer-events-none absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" style={{ color: accent }} aria-hidden>
          <ArrowRight size={12} />
        </span>
      )}
    </div>
  );
}

/** One system: the large tile with its small tiles below it. */
export function SystemColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-2">
      {children}
    </section>
  );
}

export function MiniGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

/** A slim wide tile for the two things that sit outside the three systems. */
export function WideTile({ accent, icon: Icon, title, ...t }: TileCommon & { accent: string; icon: LucideIcon; title: string }) {
  const ariaValue = typeof t.value === 'string' || typeof t.value === 'number' ? t.value : '';
  return (
    <div
      {...press(t.onClick)}
      aria-label={t.onClick ? `${title}: ${t.unavailable ? 'unavailable' : ariaValue}` : undefined}
      className={clsx('card group relative flex items-center gap-3 p-3 text-left sm:p-4', t.onClick && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-2')}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${accent}1f`, color: accent }} aria-hidden>
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</span>
          {tileInfo(title, t.info, t.onClick, t.hint)}
        </div>
        {t.unavailable ? (
          <div className="text-sm text-ink-3">{t.unavailable}</div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="tnum text-xl font-bold leading-tight text-ink">{t.value}</span>
            {t.trend && <Trend t={t.trend} />}
            {t.sub && <span className="text-xs text-ink-2">{t.sub}</span>}
          </div>
        )}
      </div>
      {t.onClick && <ArrowRight size={16} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" style={{ color: accent }} aria-hidden />}
    </div>
  );
}
