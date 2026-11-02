// The channel and month charts of the comparison page. Every chart is drawn from GrowthModel.months / GrowthModel.cur,
// carries a title, a unit, axis labels, a legend when it has two or more series, a hover tooltip and a table view, and a
// click does something: a month sets the reporting period, a slice of the donut filters the channel.
import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { ChartCard, DonutChart, GroupedColumnsChart, StackSeries, TrendChart } from '../../components/charts';
import { fDate, fInrCompact } from '../../lib/export/format';
import type { GrowthModel, MonthPoint } from '../../lib/metrics/growth';
import { CH } from './shared';

type Pick = (p: MonthPoint, ch: 'dealer' | 'ds') => number | null;

export function ChannelCharts({ m, onMonth, onChannel }: { m: GrowthModel; onMonth: (month: string) => void; onChannel: (ch: 'dealer' | 'ds') => void }) {
  const [more, setMore] = useState(false);
  const showD = m.channels.dealer;
  const showS = m.channels.ds;
  const cutoff = m.span.cutoff;
  const launch = m.dealerLaunch;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // months that belong to the reporting or comparison window stay full strength; the others are faded
  const inFocus = useMemo(() => {
    const keys = new Set<string>();
    for (const p of m.months) if ((p.win.from <= m.reporting.to && p.win.to >= m.reporting.from) || (m.comparison && p.win.from <= m.comparison.to && p.win.to >= m.comparison.from)) keys.add(p.month);
    return keys.size === m.months.length || keys.size === 0 ? null : [...keys];
  }, [m]);

  const sub = `By month up to ${+cutoff.slice(8, 10)} ${MON[+cutoff.slice(5, 7) - 1]} · * month cut short${inFocus ? ' · faded = outside the two periods compared' : ''} · click a month to report on it`;
  const note = launch ? `Dealer App starts on ${fDate(launch)}: earlier months are blank, not zero.` : undefined;

  const series: StackSeries[] = [...(showD ? [{ key: 'dealer', label: CH.dealer.label, color: CH.dealer.color }] : []), ...(showS ? [{ key: 'ds', label: CH.ds.label, color: CH.ds.color }] : [])];
  const rows = (pick: Pick) => m.months.map((p) => ({ key: p.month, label: p.label, ...(showD ? { dealer: pick(p, 'dealer') } : {}), ...(showS ? { ds: pick(p, 'ds') } : {}) }));
  const tableOf = (title: string, pick: Pick, format: 'inr' | 'int' | 'pct' | 'dec') => ({
    columns: [{ header: 'Month' }, ...(showD ? [{ header: `Dealer App ${title}`, format }] : []), ...(showS ? [{ header: `DataSense ${title}`, format }] : [])],
    rows: m.months.map((p) => [p.label, ...(showD ? [pick(p, 'dealer')] : []), ...(showS ? [pick(p, 'ds')] : [])]),
  });
  const stat = (p: MonthPoint, ch: 'dealer' | 'ds') => (ch === 'dealer' ? p.dealer : p.ds);
  const value: Pick = (p, ch) => stat(p, ch)?.value ?? null;
  const orders: Pick = (p, ch) => stat(p, ch)?.orders ?? null;
  const qty: Pick = (p, ch) => stat(p, ch)?.qty ?? null;
  const aov: Pick = (p, ch) => stat(p, ch)?.aov ?? null;
  const asp: Pick = (p, ch) => stat(p, ch)?.asp ?? null;
  const dealers: Pick = (p, ch) => stat(p, ch)?.activeDealers ?? null;
  const complaint: Pick = (p, ch) => {
    const r = stat(p, ch)?.complaintRate;
    return r === null || r === undefined ? null : r * 100;
  };
  const rejection: Pick = (p, ch) => stat(p, ch)?.rejectionRate ?? null;

  const donut = (cur: boolean) => {
    const s = cur ? m.cur : m.prev;
    if (!s) return [];
    return [
      ...(showD ? [{ key: 'dealer', label: CH.dealer.label, value: s.dealer?.value ?? 0, color: CH.dealer.color }] : []),
      ...(showS ? [{ key: 'ds', label: CH.ds.label, value: s.ds?.value ?? 0, color: CH.ds.color }] : []),
    ];
  };
  const dealerCount = m.months.map((p) => ({ key: p.month, label: p.label, ...(showD ? { dealer: dealers(p, 'dealer') } : {}), ...(showS ? { ds: dealers(p, 'ds') } : {}), either: p.activeEither }));
  const adoption = m.months.map((p) => ({ key: p.month, label: p.label, adoption: p.adoption }));
  const hasComplaint = m.months.some((p) => (showD && complaint(p, 'dealer') !== null) || (showS && complaint(p, 'ds') !== null));
  const hasRejection = m.months.some((p) => (showD && rejection(p, 'dealer') !== null) || (showS && rejection(p, 'ds') !== null));
  const shareTotal = (s: typeof m.cur | null) => (s ? (showD ? s.dealer?.value ?? 0 : 0) + (showS ? s.ds?.value ?? 0 : 0) : 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Order value by channel" subtitle={sub} info={{ formula: 'Σ eligible order value per month and channel (₹)' }} note={note} table={tableOf('value', value, 'inr')}>
        <GroupedColumnsChart data={rows(value)} series={series} format="inr" activeKey={inFocus} onSelect={(k) => onMonth(k)} />
      </ChartCard>
      <ChartCard title="Order count by channel" subtitle={sub} info={{ formula: 'Distinct eligible orders per month and channel (number of orders)' }} note={note} table={tableOf('orders', orders, 'int')}>
        <GroupedColumnsChart data={rows(orders)} series={series} format="int" activeKey={inFocus} onSelect={(k) => onMonth(k)} />
      </ChartCard>
      <ChartCard title="Average order value (AOV) by channel" subtitle={`${sub} · ₹ per order`} info={{ formula: 'Order value ÷ eligible orders (₹ per order)' }} note={note} table={tableOf('AOV', aov, 'inr')}>
        <TrendChart data={rows(aov)} series={series} format="inr" onSelect={(k) => onMonth(k)} height={240} />
      </ChartCard>
      <ChartCard
        title="Active dealers"
        subtitle={`${sub} · dealers with an eligible order`}
        info={{ formula: 'Distinct validated dealer codes with an eligible order in the month, per channel and in either channel', exclusions: 'Dealers are counted for the dealers in view.' }}
        note={note}
        table={{ columns: [{ header: 'Month' }, ...(showD ? [{ header: 'Dealer App', format: 'int' as const }] : []), ...(showS ? [{ header: 'DataSense', format: 'int' as const }] : []), { header: 'Either channel', format: 'int' as const }], rows: dealerCount.map((r) => [r.label, ...(showD ? [(r as Record<string, unknown>).dealer as number | null] : []), ...(showS ? [(r as Record<string, unknown>).ds as number | null] : []), r.either]) }}
      >
        <TrendChart data={dealerCount} series={[...series, { key: 'either', label: 'Either channel', color: CH.combined.color }]} format="int" onSelect={(k) => onMonth(k)} height={240} />
      </ChartCard>
      <ChartCard
        title="Dealer App adoption"
        subtitle={`${sub} · share of active dealers using the Dealer App`}
        info={{ formula: 'Dealers with an eligible Dealer App order ÷ dealers with an eligible order in either channel, in the month', exclusions: 'Blank before the Dealer App’s first order.' }}
        note={note}
        table={{ columns: [{ header: 'Month' }, { header: 'Adoption', format: 'pct' }], rows: adoption.map((r) => [r.label, r.adoption]) }}
      >
        <TrendChart data={adoption} series={[{ key: 'adoption', label: 'Adoption (share of active dealers)', color: CH.dealer.color }]} format="pct" onSelect={(k) => onMonth(k)} height={240} />
      </ChartCard>
      <ChartCard
        title="Order value share"
        subtitle="Dealer App and DataSense share of the combined order value (₹). Click a channel to filter the page."
        info={{ formula: 'Channel order value ÷ combined order value, per window' }}
        table={{ columns: [{ header: 'Window' }, { header: 'Dealer App', format: 'inr' }, { header: 'DataSense', format: 'inr' }], rows: [[m.reporting.label, m.cur.dealer?.value ?? null, m.cur.ds?.value ?? null], ...(m.prev && m.comparison ? [[m.comparison.label, m.prev.dealer?.value ?? null, m.prev.ds?.value ?? null]] : [])] }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {m.prev && m.comparison && (
            <div>
              <div className="mb-1 text-center text-xs font-semibold text-ink-2">{m.comparison.label}</div>
              <DonutChart stack height={150} format="inr" data={donut(false)} centerValue={fInrCompact(shareTotal(m.prev))} centerLabel="combined" onSelect={(k) => onChannel(k as 'dealer' | 'ds')} />
            </div>
          )}
          <div>
            <div className="mb-1 text-center text-xs font-semibold text-ink-2">{m.reporting.label}</div>
            <DonutChart stack height={150} format="inr" data={donut(true)} centerValue={fInrCompact(shareTotal(m.cur))} centerLabel="combined" onSelect={(k) => onChannel(k as 'dealer' | 'ds')} />
          </div>
        </div>
      </ChartCard>
      <div className="lg:col-span-2">
        <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-hero-700 hover:border-hero-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600">
          {more ? 'Fewer charts' : 'More charts: quantity, selling price, complaints, rejections'} <ChevronDown size={12} className={clsx('transition-transform', more && 'rotate-180')} aria-hidden />
        </button>
      </div>

      {more && (
        <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
        <ChartCard title="Quantity by channel" subtitle={sub} info={{ formula: 'Σ cycles quantity of eligible orders per month and channel (cycles)' }} note={note} table={tableOf('cycles', qty, 'int')}>
          <GroupedColumnsChart data={rows(qty)} series={series} format="int" activeKey={inFocus} onSelect={(k) => onMonth(k)} />
        </ChartCard>
        <ChartCard title="Average selling price (ASP) by channel" subtitle={`${sub} · ₹ per cycle`} info={{ formula: 'Cycles value ÷ cycles quantity (₹ per cycle)', exclusions: 'Spares' }} note={note} table={tableOf('ASP', asp, 'inr')}>
          <TrendChart data={rows(asp)} series={series} format="inr" onSelect={(k) => onMonth(k)} height={240} />
        </ChartCard>
        <ChartCard
          title="Complaints per 100 orders"
          subtitle={`${sub} · distinct complaints ÷ orders × 100`}
          info={{ formula: 'Distinct complaints raised in the month ÷ eligible orders in the month × 100', exclusions: 'A month is blank when the complaint export does not cover all of it (the Dealer App complaint export starts on 1 Oct, DataSense on 1 Sep).' }}
          note="Blank = the complaint export does not cover that month. It is not zero."
          table={tableOf('complaints per 100 orders', complaint, 'dec')}
        >
          {hasComplaint ? <TrendChart data={rows(complaint)} series={series} format="dec" onSelect={(k) => onMonth(k)} height={240} /> : <p className="py-10 text-center text-sm text-ink-3">No month is fully covered by the complaint exports.</p>}
        </ChartCard>
        <ChartCard title="Rejection rate" subtitle={`${sub} · rejected ÷ orders placed`} info={{ formula: 'Rejected orders ÷ (eligible + rejected orders) in the month', exclusions: 'A rejected order is lost business, so lower is better.' }} note={note} table={tableOf('rejection rate', rejection, 'pct')}>
          {hasRejection ? <TrendChart data={rows(rejection)} series={series} format="pct" onSelect={(k) => onMonth(k)} height={240} /> : <p className="py-10 text-center text-sm text-ink-3">No orders to measure.</p>}
        </ChartCard>
        </div>
      )}
    </div>
  );
}

