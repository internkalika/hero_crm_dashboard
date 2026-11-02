// Dealer-level view: which dealers grew, which only moved business between channels, which declined.
import { useMemo } from 'react';
import clsx from 'clsx';
import { ChartCard, BarsChart, GroupedBarsChart, HeatTable, ScatterPlot, StackedBarsChart } from '../../components/charts';
import { DataTable } from '../../components/DataTable';
import { DealerLink } from '../../components/DealerLink';
import { Badge, InfoTip } from '../../components/ui';
import type { Col } from '../../lib/export/excel';
import { CLASS_META, CLASS_ORDER, DealerGrowthRow, GrowthClass, GrowthModel } from '../../lib/metrics/growth';
import { CH, fSignedInr, fSignedPct } from './shared';

const PCT_CAP = 3; // +300%: dots beyond it are drawn at the edge; the tooltip keeps the real figure

export function ClassTiles({ m, active, onPick }: { m: GrowthModel; active: string; onPick: (c: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Dealers by classification">
      {CLASS_ORDER.map((c) => {
        const meta = CLASS_META[c];
        const n = m.classCounts[c];
        const on = active === c;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? '' : c)}
            className={clsx('card p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', on && 'ring-2 ring-hero-600')}
            style={{ borderLeft: `4px solid ${meta.color}` }}
          >
            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              {meta.short}
              <InfoTip title={meta.label} lines={[{ text: meta.help }]} />
            </div>
            <div className="tnum mt-1 text-2xl font-bold text-ink">{n}</div>
            <div className="text-[11px] text-ink-3">dealer{n === 1 ? '' : 's'}</div>
          </button>
        );
      })}
    </div>
  );
}

const classBadge = (c: GrowthClass) => {
  const meta = CLASS_META[c];
  return <Badge tone={meta.tone === 'neutral' ? 'neutral' : meta.tone} icon={meta.tone !== 'neutral'} title={meta.help}>{meta.short}</Badge>;
};

export function dealerCols(m: GrowthModel): Col<DealerGrowthRow>[] {
  const cp = m.comparison?.label ?? 'comparison';
  const rp = m.reporting.label;
  return [
    { id: 'name', header: 'Dealer', value: (r) => r.name, render: (r) => <DealerLink dealerKey={r.dbCode} tab="comparison">{r.name}</DealerLink>, width: 200 },
    { id: 'outlet', header: 'Outlet ID', value: (r) => r.outletId },
    { id: 'db', header: 'DB code', value: (r) => r.dbCode },
    { id: 'prev', header: `Combined value – ${cp}`, value: (r) => (r.prev ? r.prev.combinedValue : null), format: 'inr', help: 'Dealer App + DataSense eligible order value in the comparison period, each order counted once.' },
    { id: 'cur', header: `Combined value – ${rp}`, value: (r) => r.cur.combinedValue, format: 'inr' },
    { id: 'abs', header: 'Change (₹)', value: (r) => r.changeValue, format: 'inr' },
    { id: 'pct', header: 'Change %', value: (r) => r.changePct, format: 'pct', help: 'Blank when the comparison period has no value to divide by.' },
    { id: 'da', header: 'Dealer App share', value: (r) => r.dealerShare, format: 'pct', help: `Share of the dealer’s combined order value in ${rp} that was placed through the Dealer App.` },
    { id: 'sfa', header: 'SFA (DataSense) share', value: (r) => r.dsShare, format: 'pct' },
    { id: 'oc', header: 'Order count change', value: (r) => r.changeOrders, format: 'int' },
    { id: 'qc', header: 'Quantity change', value: (r) => r.changeQty, format: 'int' },
    { id: 'mbd', header: 'MBD', value: (r) => r.mbd, format: 'int', help: 'Models billed to this dealer through the Dealer App in the reporting period.' },
    { id: 'cls', header: 'Classification', value: (r) => CLASS_META[r.cls].label, render: (r) => classBadge(r.cls) },
    { id: 'conf', header: 'Confidence', value: (r) => (r.confidence === 'indicative' ? 'Indicative' : 'Inconclusive') },
    { id: 'ev', header: 'Evidence', value: (r) => r.evidence, width: 420, hidden: true, render: (r) => <span className="block max-w-[34rem] whitespace-normal text-xs leading-snug text-ink-2">{r.evidence}</span> },
  ];
}

export function DealerCharts({ m, rows, onDealer, activeDealers }: { m: GrowthModel; rows: DealerGrowthRow[]; onDealer: (key: string, name: string) => void; activeDealers: string[] }) {
  const rp = m.reporting.label;
  const cp = m.comparison?.label ?? '';
  const top = useMemo(() => rows.filter((r) => r.changeValue !== null).sort((a, b) => (b.changeValue ?? 0) - (a.changeValue ?? 0)).slice(0, 10), [rows]);
  const byOrders = useMemo(() => [...rows].filter((r) => r.cur.combinedOrders > 0).sort((a, b) => b.cur.combinedOrders - a.cur.combinedOrders).slice(0, 10), [rows]);
  const byValue = useMemo(() => [...rows].sort((a, b) => b.cur.combinedValue - a.cur.combinedValue).slice(0, 12), [rows]);
  const pts = useMemo(
    () =>
      rows
        .filter((r) => r.dealerShare !== null && r.changePct !== null)
        .map((r) => ({
          key: r.key,
          label: r.name,
          x: r.dealerShare as number,
          y: Math.max(-1, Math.min(PCT_CAP, r.changePct as number)),
          color: CLASS_META[r.cls].color,
          tip: [`Dealer App share of ${rp}: ${((r.dealerShare as number) * 100).toFixed(0)}%`, `Combined value change: ${fSignedPct(r.changePct, 0)} (${fSignedInr(r.changeValue)})`, CLASS_META[r.cls].label],
        })),
    [rows, rp],
  );
  const missing = rows.length - pts.length;
  const legend = CLASS_ORDER.filter((c) => c !== 'insufficient').map((c) => ({ label: CLASS_META[c].short, color: CLASS_META[c].color }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Adoption vs growth"
        subtitle={`Each dot is a dealer. Right = more of its ${rp} orders came through the Dealer App; up = combined business grew against ${cp || 'the comparison period'}. Click a dot to filter.`}
        info={{ formula: 'x = Dealer App value ÷ combined value in the reporting period. y = (combined value now − before) ÷ before.', exclusions: `Dealers with no value in the comparison period (no % change). Changes above +${PCT_CAP * 100}% are drawn at the edge.` }}
        note={missing > 0 ? `${missing} dealer${missing === 1 ? '' : 's'} not plotted: no comparison-period value or no reporting-period value to take a share of.` : 'Top-right = growing and using the app; top-left = growing through DataSense; bottom = declining.'}
        table={{ columns: [{ header: 'Dealer' }, { header: 'Dealer App share', format: 'pct' }, { header: 'Change %', format: 'pct' }, { header: 'Classification' }], rows: rows.map((r) => [r.name, r.dealerShare, r.changePct, CLASS_META[r.cls].label]) }}
      >
        <ScatterPlot data={pts} xTitle="Dealer App share of order value" yTitle="Change in combined order value" xDomain={[0, 1]} refX={0.5} refY={0} legend={legend} activeKey={activeDealers} onSelect={onDealer} />
      </ChartCard>
      <ChartCard
        title="Top 10 dealers by incremental value"
        subtitle={`Change in combined order value, ${rp} against ${cp || 'the comparison period'} (₹). Colour = classification. Click a bar to filter.`}
        info={{ formula: 'Combined (Dealer App + DataSense) order value in the reporting period − the same in the comparison period', exclusions: 'This is a change in sales value, not profit.' }}
        table={{ columns: [{ header: 'Dealer' }, { header: 'Change', format: 'inr' }, { header: 'Classification' }], rows: top.map((r) => [r.name, r.changeValue, CLASS_META[r.cls].label]) }}
      >
        <BarsChart data={top.map((r) => ({ key: r.key, label: r.name, value: r.changeValue ?? 0, color: CLASS_META[r.cls].color }))} format="inr" activeKey={activeDealers} onSelect={onDealer} seriesName="Change in order value" />
      </ChartCard>
      <ChartCard
        title="Top 10 dealers by order count"
        subtitle={`Eligible orders in ${rp}, by channel. Click a bar to filter.`}
        info={{ formula: 'Eligible orders in the reporting period per dealer, Dealer App and DataSense (each order once)' }}
        table={{ columns: [{ header: 'Dealer' }, { header: 'Dealer App', format: 'int' }, { header: 'DataSense', format: 'int' }], rows: byOrders.map((r) => [r.name, r.cur.dealerOrders, r.cur.dsOrders]) }}
      >
        <StackedBarsChart layout="horizontal" format="int" data={byOrders.map((r) => ({ key: r.key, label: r.name, dealer: r.cur.dealerOrders, ds: r.cur.dsOrders }))} series={[{ key: 'dealer', label: CH.dealer.label, color: CH.dealer.color }, { key: 'ds', label: CH.ds.label, color: CH.ds.color }]} activeKey={activeDealers} onSelect={(_s, k, l) => onDealer(k, l)} />
      </ChartCard>
      <ChartCard
        title="Dealer-wise growth"
        subtitle={`Combined order value of the 12 largest dealers, ${cp || 'before'} against ${rp} (₹). Click a dealer to filter.`}
        info={{ formula: 'Combined eligible order value per dealer in each window' }}
        table={{ columns: [{ header: 'Dealer' }, { header: cp || 'Before', format: 'inr' }, { header: rp, format: 'inr' }], rows: byValue.map((r) => [r.name, r.prev?.combinedValue ?? null, r.cur.combinedValue]) }}
      >
        <GroupedBarsChart data={byValue.map((r) => ({ key: r.key, label: r.name, before: r.prev ? r.prev.combinedValue : null, now: r.cur.combinedValue }))} format="inr" series={[...(m.comparison ? [{ key: 'before', label: cp, color: '#9b9a95' }] : []), { key: 'now', label: rp, color: '#52514E' }]} activeKey={activeDealers} onSelect={onDealer} />
      </ChartCard>
    </div>
  );
}

export function DealerHeat({ m, onDealer }: { m: GrowthModel; onDealer: (key: string, name: string) => void }) {
  const rows = m.heat.slice(0, 25);
  if (!rows.length) return null;
  const idx = new Map(rows.map((r) => [r.name, r.key]));
  return (
    <ChartCard
      title="Dealer performance by month"
      subtitle={`Combined order value (₹) of the ${rows.length} largest dealers in view, by month up to ${m.span.cutoff}. “·” = no eligible order that month. Click a row to filter.`}
      info={{ formula: 'Σ eligible order value per dealer and month, Dealer App + DataSense (each order once)', exclusions: 'A month marked * is cut short by the data cut-off.' }}
      note={m.heat.length > rows.length ? `Showing the ${rows.length} largest of ${m.heat.length} dealers. The dealer table above has every dealer.` : undefined}
    >
      <HeatTable rowHeader="Dealer" rowLabels={rows.map((r) => r.name)} colLabels={m.months.map((p) => p.label)} values={rows.map((r) => r.values.map((v) => v ?? 0))} format="inr" onCell={(row) => idx.get(row) && onDealer(idx.get(row) as string, row)} />
    </ChartCard>
  );
}

export function DealerTable({ m, rows, cls, onRow, notes }: { m: GrowthModel; rows: DealerGrowthRow[]; cls: string; onRow: (r: DealerGrowthRow) => void; notes: string[] }) {
  const cols = useMemo(() => dealerCols(m), [m]);
  const shown = useMemo(() => (cls ? rows.filter((r) => r.cls === cls) : rows), [rows, cls]);
  return (
    <div>
      <DataTable
        rows={shown}
        columns={cols}
        getRowId={(r) => r.key}
        exportName="Dealer_growth"
        exportNotes={notes}
        initialSort={{ id: 'cur', desc: true }}
        pageSize={10}
        onRowClick={onRow}
        stickyFirst
        searchPlaceholder="Search dealer, outlet ID or DB code…"
        emptyText={cls ? 'No dealer has this classification in the periods chosen.' : 'No dealer had an order in either period.'}
      />
    </div>
  );
}

