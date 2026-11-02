// A signal card: one short label, one figure, the period it is for, and a click that opens the records behind it.
// The sentence that explains the figure is kept in the "?" popover, not on the card.
import { ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { InfoTip } from './ui';
import type { Tone } from '../lib/metrics/growth';

const RAIL: Record<Tone, string> = { good: 'border-l-good', warn: 'border-l-warn', bad: 'border-l-bad', neutral: 'border-l-slate-400' };
const WORD: Record<Tone, string> = { good: 'Positive', warn: 'Watch', bad: 'Concern', neutral: 'Context' };

/** Short names for the findings of the growth model and the executive brief (ids come from lib/metrics). */
const LABEL: Record<string, string> = {
  combined: 'Combined value',
  shift: 'Channel shift',
  'orders-aov': 'Orders vs order value',
  concentration: 'Growth concentration',
  'adoption-flat': 'Adoption vs growth',
  rejection: 'Rejection rate',
  benchmark: 'Vs other dealers',
  classes: 'Dealer classes',
  'dealers-growth': 'Dealer App dealers',
  network: 'All dealers',
  'dealer-classes': 'Dealer classes',
  adoption: 'Dealer App adoption',
  profit: 'Profitability',
  'r-profit': 'Profit unknown',
  'r-network': 'Network value',
  'r-declining': 'Declining dealers',
  'r-shift': 'Channel shift',
  'r-concentration': 'Growth concentration',
  'r-baseline': 'Short app history',
  'r-rejection': 'Rejections',
  'r-complaints-Dealer App': 'Open complaints · Dealer App',
  'r-complaints-DataSense': 'Open complaints · DataSense',
  'r-issues': 'Overdue issues',
  'r-bizom': 'Bizom report use',
  'r-coverage': 'Complaint coverage',
};
export const signalLabel = (id: string, fallback: string): string => LABEL[id] ?? fallback;

export function SignalCard({ label, metric, period, tone, detail, onClick }: { label: string; metric: string; period?: string; tone: Tone; detail?: string; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
      aria-label={`${WORD[tone]}: ${label}, ${metric}`}
      className={clsx('card group relative flex cursor-pointer flex-col justify-between gap-1 border-l-4 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-hero-200 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-2', RAIL[tone])}
    >
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase leading-tight tracking-wide text-ink-3">
        {label}
        {detail && <InfoTip title={label} lines={[{ text: detail }]} />}
      </div>
      <div className="tnum text-lg font-bold leading-tight text-ink">{metric}</div>
      {period && <div className="text-[11px] leading-tight text-ink-3">{period}</div>}
      <span className="pointer-events-none absolute bottom-2.5 right-3 text-hero-600 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
        <ArrowRight size={14} />
      </span>
    </div>
  );
}

export function SignalGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 3 | 4 }) {
  return <div className={clsx('grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3', cols === 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3')}>{children}</div>;
}
