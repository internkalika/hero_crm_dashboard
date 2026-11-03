// The management brief on the Overall Summary: the takeaways and risks as signal cards (a short label, one figure, the
// period it is for, a click to the records behind it) and the recommended actions as numbered, clickable chips.
// The sentence behind a card is in its "?" popover; the sentence behind an action is its tooltip.
import { ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { SignalCard, SignalGrid, signalLabel } from '../../components/SignalCard';
import type { GrowthInsight } from '../../lib/metrics/growth';
import type { BriefAction } from '../../lib/metrics/executive';

export function Signals({ items, onGo }: { items: GrowthInsight[]; onGo: (to: string) => void }) {
  return (
    <SignalGrid>
      {items.map((i) => (
        <SignalCard key={i.id} label={signalLabel(i.id, i.title)} metric={i.metric} period={i.period} tone={i.tone} detail={`${i.title}. ${i.detail}`} onClick={() => onGo(i.to)} />
      ))}
    </SignalGrid>
  );
}

const PRIORITY: Record<BriefAction['priority'], string> = { 1: 'Do first', 2: 'Next', 3: 'Then' };

/** Recommended actions, in the order to do them. */
export function ActionChips({ items, onGo }: { items: BriefAction[]; onGo: (to: string) => void }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Recommended actions">
      {items.map((a, n) => (
        <li key={a.id} className="min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => onGo(a.to)}
            title={`${PRIORITY[a.priority]}: ${a.why}`}
            aria-label={`${PRIORITY[a.priority]}: ${a.title}. ${a.why}`}
            className={clsx('group inline-flex max-w-full items-center gap-2 rounded-full border bg-surface py-1 pl-1.5 pr-3 text-left text-xs font-medium text-ink shadow-card transition-all hover:-translate-y-0.5 hover:border-hero-600 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', a.priority === 1 ? 'border-hero-200' : 'border-slate-300')}
          >
            <span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', a.priority === 1 ? 'bg-hero-600 text-white' : 'bg-slate-100 text-ink-2')} aria-hidden>
              {n + 1}
            </span>
            <span className="truncate">{a.title}</span>
            <ArrowRight size={12} className="shrink-0 text-hero-700 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </button>
        </li>
      ))}
    </ol>
  );
}
