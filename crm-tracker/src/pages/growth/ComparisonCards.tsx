import { KeyboardEvent } from 'react';
import clsx from 'clsx';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { InfoTip } from '../../components/ui';
import type { Change } from '../../lib/metrics/windows';
import type { GrowthModel, KpiPair, Tone } from '../../lib/metrics/growth';
import { CH, fSignedPct, fSignedUnit, fUnit, toneClass, toneWord } from './shared';

const INFO: Record<string, { formula: string; exclusions?: string }> = {
  value: { formula: 'Σ order value of eligible orders in the window, per channel', exclusions: 'Rejected orders and orders with no value. A DataSense order that is the same order as a Dealer App order is counted once, as Dealer App.' },
  orders: { formula: 'Distinct eligible orders: one per Order ID (Dealer App SKU lines are rolled up) and one per DataSense order', exclusions: 'Rejected orders and zero-value orders.' },
  qty: { formula: 'Σ cycles quantity of eligible orders', exclusions: 'Spares quantity on DataSense orders.' },
  aov: { formula: 'Order value ÷ eligible orders' },
  asp: { formula: 'Cycles value ÷ cycles quantity of eligible orders', exclusions: 'Spares value, which has no cycle quantity.' },
  dealers: { formula: 'Distinct validated dealer (ERP) codes with at least one eligible order in the window' },
  rejection: { formula: 'Rejected orders ÷ orders placed (eligible + rejected) in the window', exclusions: 'A rejected order is lost business in either channel, so lower is better.' },
  complaint: { formula: 'Distinct complaints raised in the window ÷ eligible orders in the window', exclusions: 'Test accounts (unless included in settings). Shown only where the complaint export covers the whole window.' },
};

const NOBASE: Record<string, string> = {
  complaint: 'No complaint data for the comparison period',
};

const REASON: Record<string, string> = {
  complaint: 'The complaint export does not cover this whole period.',
};

function Arrow({ c, tone }: { c: Change; tone: Tone }) {
  const dir = c.abs > 0 ? 'up' : c.abs < 0 ? 'down' : 'flat';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  return <Icon size={12} aria-hidden className={clsx(tone === 'neutral' && 'text-ink-3')} />;
}

/** The movement of one channel against the comparison period: colour from the polarity-aware tone, plus an arrow and words. */
function Move({ c, tone, unit, indicative, cpLabel, noBaseline }: { c: Change | null; tone: Tone; unit: KpiPair['unit']; indicative: boolean; cpLabel: string; noBaseline?: string }) {
  if (!c) return <span className="text-[11px] leading-snug text-ink-3">{noBaseline ?? 'No comparison'}</span>;
  const pct = c.pct === null ? (c.abs === 0 ? 'no change' : 'new') : unit === 'pct' ? fSignedUnit(c.abs, 'pct') : fSignedPct(c.pct, 0);
  const label = `${toneWord[tone]}${indicative ? ', indicative' : ''}`;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className={clsx('inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold', toneClass[tone])} title={`${label} · against ${cpLabel}`}>
        <Arrow c={c} tone={tone} />
        {pct}
      </span>
      <span className="text-[11px] leading-snug text-ink-3">
        was {fUnit(c.from, unit)}
        {unit !== 'pct' && c.abs !== 0 && <> · {fSignedUnit(c.abs, unit)}</>}
      </span>
      {indicative && <span className="text-[11px] font-medium leading-snug text-warn-text">indicative</span>}
    </span>
  );
}

/** One KPI with both channels side by side: value, movement against the comparison period, and the gap between them. */
export function PairCard({ k, cpLabel, hasComparison, onOpen, showDealer, showDs }: { k: KpiPair; cpLabel: string; hasComparison: boolean; onOpen: (id: string) => void; showDealer: boolean; showDs: boolean }) {
  const info = INFO[k.id];
  const key = (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(k.id));
  const reason = REASON[k.id];
  const side = (which: 'dealer' | 'ds') => {
    const shown = which === 'dealer' ? showDealer : showDs;
    const v = which === 'dealer' ? k.dealer : k.ds;
    const c = which === 'dealer' ? k.dealerChange : k.dsChange;
    const tone = which === 'dealer' ? k.dealerTone : k.dsTone;
    const ind = which === 'dealer' ? k.dealerIndicative : k.dsIndicative;
    const meta = CH[which];
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden />
          {meta.label}
        </div>
        <div className="tnum mt-0.5 text-xl font-bold leading-tight text-ink sm:text-[1.4rem]">{shown ? fUnit(v, k.unit) : '—'}</div>
        <div className="mt-1">{!shown ? <span className="text-[11px] text-ink-3">Not shown</span> : v === null && reason ? <span className="text-[11px] text-ink-3">{reason}</span> : hasComparison ? <Move c={c} tone={tone} unit={k.unit} indicative={ind} cpLabel={cpLabel} noBaseline={NOBASE[k.id]} /> : <span className="text-[11px] text-ink-3">No comparison period</span>}</div>
      </div>
    );
  };
  return (
    <div role="button" tabIndex={0} onClick={() => onOpen(k.id)} onKeyDown={key} aria-label={`${k.label}: Dealer App ${fUnit(k.dealer, k.unit)}, DataSense ${fUnit(k.ds, k.unit)}. Open the orders behind this.`} className="card group relative cursor-pointer p-4 text-left transition-all hover:-translate-y-0.5 hover:border-hero-200 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-2">
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold uppercase leading-tight tracking-wide text-ink-3">{k.label}</span>
        {info && <InfoTip title={k.label} lines={[{ label: 'Formula', text: info.formula }, ...(info.exclusions ? [{ label: 'Excludes', text: info.exclusions }] : []), ...(k.note ? [{ label: 'Note', text: k.note }] : []), { label: 'Click', text: 'Lists the orders behind these numbers.' }]} />}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {side('dealer')}
        {side('ds')}
      </div>
      {showDealer && showDs && k.gapAbs !== null && (
        <div className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] text-ink-2">
          Gap, Dealer App − DataSense: <strong className="tnum font-semibold text-ink">{fSignedUnit(k.gapAbs, k.unit)}</strong>
          {k.gapPct !== null && k.unit !== 'pct' && <span className="tnum"> ({fSignedPct(k.gapPct, 0)})</span>}
        </div>
      )}
      <span className="pointer-events-none absolute bottom-2.5 right-3 text-hero-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
        <ArrowRight size={14} />
      </span>
    </div>
  );
}

export function PairGrid({ m, onOpen }: { m: GrowthModel; onOpen: (id: string) => void }) {
  const cp = m.comparison?.label ?? '';
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
      {m.kpis.map((k) => (
        <PairCard key={k.id} k={k} cpLabel={cp} hasComparison={!!m.comparison} onOpen={onOpen} showDealer={m.channels.dealer} showDs={m.channels.ds} />
      ))}
    </div>
  );
}
