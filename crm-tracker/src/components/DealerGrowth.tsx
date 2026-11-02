// The "Growth and channel" block of the dealer profile: did this dealer's combined Dealer App + DataSense business grow, or
// did it only move between channels? It uses the growth model of the first page, for one dealer, over the same two
// periods (rp / cp in the address), so the profile and the comparison page always agree.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { useData } from '../state/DataContext';
import { fInr, fInrCompact, fInt } from '../lib/export/format';
import { CLASS_META, adoptionStatusOf, buildGrowth } from '../lib/metrics/growth';
import { pageLink } from '../lib/nav/links';
import { fSignedInr, fSignedPct, toneClass } from '../pages/growth/shared';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="tnum text-lg font-bold leading-tight text-ink">{value}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function DealerGrowthBlock({ dealerKey, name }: { dealerKey: string; name: string }) {
  const { data, settings } = useData();
  const [params] = useSearchParams();
  const rp = params.get('rp') ?? '';
  const cp = params.get('cp') ?? 'prev';
  const model = useMemo(() => buildGrowth(data, settings, { rp, cp, dealers: [dealerKey], cohort: 'all' }), [data, settings, rp, cp, dealerKey]);
  if (!model) return null;
  const row = model.rows.find((r) => r.key === dealerKey);
  const periods = model.comparison ? `${model.reporting.label} vs ${model.comparison.label}` : model.reporting.label;
  const open = pageLink('/', { dealer: [dealerKey, name] }, { cohort: 'all', ...(rp ? { rp } : {}), ...(cp !== 'prev' ? { cp } : {}), show: 'dealers' });
  return (
    <section className="card p-4" aria-label="Growth and channel">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-hero-600 text-white" aria-hidden>
            <TrendingUp size={14} />
          </span>
          Growth and channel
          <span className="text-xs font-normal text-ink-3">{periods}</span>
        </h3>
        <Link to={open} className="inline-flex items-center gap-1 text-xs font-medium text-hero-700 hover:underline">
          Open on the comparison page <ArrowRight size={12} />
        </Link>
      </header>
      {!row ? (
        <p className="py-4 text-sm text-ink-3">No eligible orders from this dealer in either period, so there is no growth to show.</p>
      ) : (
        <GrowthBody row={row} />
      )}
      <p className="mt-3 text-[11px] text-ink-3">Combined = Dealer App + DataSense order value, each order counted once. The class is an estimate from order values, not proof of cause. Periods are set on the comparison page.</p>
    </section>
  );
}

function GrowthBody({ row }: { row: NonNullable<ReturnType<typeof buildGrowth>>['rows'][number] }) {
  const meta = CLASS_META[row.cls];
  const status = adoptionStatusOf(row);
  const share = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(0)}%`);
  const aov = row.cur.combinedOrders ? row.cur.combinedValue / row.cur.combinedOrders : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', toneClass[meta.tone])} title={meta.help}>
          {meta.label}
        </span>
        {row.confidence === 'inconclusive' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">inconclusive</span>}
        {row.confidence === 'indicative' && row.cls !== 'stable' && row.cls !== 'insufficient' && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn-text">indicative</span>}
        <span className="text-xs text-ink-2">{status.label}</span>
      </div>
      <p className="text-xs leading-relaxed text-ink-2">{row.evidence}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Combined value" value={fInrCompact(row.cur.combinedValue)} sub={row.prev ? `was ${fInrCompact(row.prev.combinedValue)} · ${row.changePct !== null ? fSignedPct(row.changePct, 0) : fSignedInr(row.changeValue)}` : 'no comparison period'} />
        <Stat label="Combined orders" value={fInt(row.cur.combinedOrders)} sub={row.prev ? `was ${fInt(row.prev.combinedOrders)}` : undefined} />
        <Stat label="Cycles" value={fInt(row.cur.combinedQty)} sub={row.prev ? `was ${fInt(row.prev.combinedQty)}` : undefined} />
        <Stat label="Avg order value" value={aov === null ? '—' : fInr(aov)} sub="both channels" />
        <Stat label="Dealer App share" value={share(row.dealerShare)} sub={row.dealerSharePrev !== null ? `was ${share(row.dealerSharePrev)}` : undefined} />
        <Stat label="DataSense share" value={share(row.dsShare)} sub={row.dealerSharePrev !== null ? `was ${share(1 - row.dealerSharePrev)}` : undefined} />
        <Stat label="Dealer App change" value={fSignedInr(row.changeDealerValue)} sub="order value" />
        <Stat label="DataSense change" value={fSignedInr(row.changeDsValue)} sub="order value" />
      </div>
      {row.mbd !== null && <p className="text-xs text-ink-2">Models billed through the Dealer App in the period: <strong className="text-ink">{row.mbd}</strong>.</p>}
    </div>
  );
}
