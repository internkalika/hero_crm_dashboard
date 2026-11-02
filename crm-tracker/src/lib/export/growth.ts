// Sheet builders for the Dealer App vs SFA Comparison downloads. Every sheet is built from the same GrowthModel the page
// shows, so a download always carries the filters, reporting period and comparison period that were on screen.
import type { SheetSpec } from './excel';
import { CLASS_META, GrowthModel, GrowthOrder, DealerGrowthRow } from '../metrics/growth';
import { inspectProfitability } from '../metrics/profitability';
import type { AppData } from '../types';

const join = (xs: string[]) => (xs.length ? xs.join(', ') : 'all');

/** The lines that go on the Notes sheet of every download. */
export function growthNotes(m: GrowthModel, extra: string[] = []): string[] {
  const i = m.input;
  const lines = [
    `Reporting period: ${m.reporting.label} (${m.reporting.days} days)`,
    `Comparison period: ${m.comparison ? `${m.comparison.label} (${m.comparison.days} days)` : 'none'}`,
    `Dealers: ${i.dealers.length || i.dbs.length || i.outlets.length ? `selected (${join([...i.dealers, ...i.dbs, ...i.outlets])})` : i.cohort === 'pilot' ? 'dealers with a Dealer App order' : 'all dealers'}`,
    `Zone: ${join(i.zones)} · City: ${join(i.cities)} · Channel: ${join(i.channels.map((c) => (c === 'dealer' ? 'Dealer App' : 'DataSense')))} · Model: ${join(i.models)} · Wheel size: ${join(i.sizes)}`,
    `Data cut-off: ${m.span.cutoff} (the last day both order exports reach)`,
    'Order value, count, quantity, AOV and ASP use eligible orders: one row per order, value above zero, rejected orders excluded.',
    'An order counts once: a DataSense order carrying the SAP number of a Dealer App order of the same dealer is counted as Dealer App.',
    'Values are sales (order) value. They are not profit or margin: the files contain no cost data.',
    ...m.notes,
    ...extra,
  ];
  return lines;
}

const pctOrNull = (v: number | null) => (v === null ? null : v);

export function dealerGrowthSheet(m: GrowthModel, rows: DealerGrowthRow[] = m.rows): SheetSpec {
  const cp = m.comparison?.label ?? 'comparison period';
  const rp = m.reporting.label;
  return {
    name: 'Dealer growth',
    note: `${rows.length} dealers · ${rp} vs ${cp}`,
    columns: [
      { header: 'Dealer name' },
      { header: 'Outlet ID' },
      { header: 'DB code (ERP)' },
      { header: 'Zone' },
      { header: 'City' },
      { header: `Combined value – ${cp}`, format: 'inr' },
      { header: `Combined value – ${rp}`, format: 'inr' },
      { header: 'Absolute change', format: 'inr' },
      { header: '% change', format: 'pct' },
      { header: `Dealer App value – ${rp}`, format: 'inr' },
      { header: `DataSense value – ${rp}`, format: 'inr' },
      { header: `Dealer App value – ${cp}`, format: 'inr' },
      { header: `DataSense value – ${cp}`, format: 'inr' },
      { header: 'Dealer App share', format: 'pct' },
      { header: 'DataSense (SFA) share', format: 'pct' },
      { header: 'Order count change', format: 'int' },
      { header: 'Quantity change', format: 'int' },
      { header: 'Models billed (MBD)', format: 'int' },
      { header: 'Classification' },
      { header: 'Confidence' },
      { header: 'Evidence' },
    ],
    rows: rows.map((r) => [
      r.name,
      r.outletId,
      r.dbCode,
      r.zone,
      r.city,
      r.prev ? r.prev.combinedValue : null,
      r.cur.combinedValue,
      r.changeValue,
      pctOrNull(r.changePct),
      r.cur.dealerValue,
      r.cur.dsValue,
      r.prev ? r.prev.dealerValue : null,
      r.prev ? r.prev.dsValue : null,
      pctOrNull(r.dealerShare),
      pctOrNull(r.dsShare),
      r.changeOrders,
      r.changeQty,
      r.mbd,
      CLASS_META[r.cls].label,
      r.confidence === 'indicative' ? 'Indicative' : 'Inconclusive',
      r.evidence,
    ]),
  };
}

export function monthlySheet(m: GrowthModel): SheetSpec {
  return {
    name: 'Monthly performance',
    note: `${m.months.length} months up to the data cut-off ${m.span.cutoff}. A month marked * is cut short by the cut-off.`,
    columns: [
      { header: 'Month' },
      { header: 'Days covered', format: 'int' },
      { header: 'Dealer App – order value', format: 'inr' },
      { header: 'Dealer App – orders', format: 'int' },
      { header: 'Dealer App – quantity', format: 'int' },
      { header: 'Dealer App – AOV', format: 'inr' },
      { header: 'Dealer App – ASP', format: 'inr' },
      { header: 'Dealer App – active dealers', format: 'int' },
      { header: 'Dealer App – rejection rate', format: 'pct' },
      { header: 'Dealer App – complaints', format: 'int' },
      { header: 'DataSense – order value', format: 'inr' },
      { header: 'DataSense – orders', format: 'int' },
      { header: 'DataSense – quantity', format: 'int' },
      { header: 'DataSense – AOV', format: 'inr' },
      { header: 'DataSense – ASP', format: 'inr' },
      { header: 'DataSense – active dealers', format: 'int' },
      { header: 'DataSense – rejection rate', format: 'pct' },
      { header: 'DataSense – complaints', format: 'int' },
      { header: 'Combined order value', format: 'inr' },
      { header: 'Dealers active in either channel', format: 'int' },
      { header: 'Dealer App adoption (share of active dealers)', format: 'pct' },
    ],
    rows: m.months.map((p) => [
      p.label,
      p.win.days,
      p.dealer?.value ?? null,
      p.dealer?.orders ?? null,
      p.dealer?.qty ?? null,
      p.dealer?.aov ?? null,
      p.dealer?.asp ?? null,
      p.dealer?.activeDealers ?? null,
      p.dealer?.rejectionRate ?? null,
      p.dealer?.complaints ?? null,
      p.ds?.value ?? null,
      p.ds?.orders ?? null,
      p.ds?.qty ?? null,
      p.ds?.aov ?? null,
      p.ds?.asp ?? null,
      p.ds?.activeDealers ?? null,
      p.ds?.rejectionRate ?? null,
      p.ds?.complaints ?? null,
      p.combinedValue,
      p.activeEither,
      p.adoption,
    ]),
  };
}

export function kpiSheet(m: GrowthModel): SheetSpec {
  const fmt = (u: string) => (u === 'inr' ? ('inr' as const) : u === 'pct' ? ('pct' as const) : u === 'per100' ? ('dec' as const) : ('int' as const));
  return {
    name: 'Comparison KPIs',
    note: `${m.reporting.label} vs ${m.comparison?.label ?? 'no comparison'}`,
    columns: [
      { header: 'KPI' },
      { header: 'Dealer App – reporting' },
      { header: 'DataSense – reporting' },
      { header: 'Gap (Dealer App − DataSense)' },
      { header: 'Gap %' },
      { header: 'Dealer App – comparison' },
      { header: 'DataSense – comparison' },
      { header: 'Dealer App change' },
      { header: 'Dealer App change %' },
      { header: 'DataSense change' },
      { header: 'DataSense change %' },
      { header: 'Note' },
    ],
    // numbers keep their unit in the KPI name so one column can hold rupees, counts and rates
    rows: m.kpis.map((k) => {
      const unit = fmt(k.unit);
      const label = `${k.label}${unit === 'inr' ? ' (₹)' : k.unit === 'pct' ? ' (share)' : k.unit === 'per100' ? ' (per 100 orders)' : ''}`;
      return [label, k.dealer, k.ds, k.gapAbs, k.gapPct, k.dealerPrev, k.dsPrev, k.dealerChange?.abs ?? null, k.dealerChange?.pct ?? null, k.dsChange?.abs ?? null, k.dsChange?.pct ?? null, [k.dealerIndicative ? 'Dealer App: indicative (short or partial baseline)' : '', k.dsIndicative ? 'DataSense: small base' : '', k.note ?? ''].filter(Boolean).join('; ')];
    }),
  };
}

export function growthOrdersSheet(m: GrowthModel, rows: GrowthOrder[] = m.orders): SheetSpec {
  return {
    name: 'Orders',
    note: `${rows.length} orders in the reporting and comparison periods`,
    columns: [
      { header: 'Channel' },
      { header: 'Window' },
      { header: 'Order ID' },
      { header: 'SAP order no.' },
      { header: 'Dealer' },
      { header: 'DB code (ERP)' },
      { header: 'Order date', format: 'date' },
      { header: 'Status' },
      { header: 'Cycles', format: 'int' },
      { header: 'Order value', format: 'inr' },
      { header: 'Counted in figures' },
    ],
    rows: rows.map((o) => [o.system === 'dealer' ? 'Dealer App' : 'DataSense', o.window === 'reporting' ? 'Reporting' : 'Comparison', o.orderId, o.sapOrderId, o.dealerName, o.dealerKey && !o.dealerKey.startsWith('name:') ? o.dealerKey : null, o.date, o.status, o.qty, o.value, o.duplicate ? 'No – same order as a Dealer App order' : o.eligible ? 'Yes' : 'No – rejected or zero value']),
  };
}

export function profitabilitySheet(data: Pick<AppData, 'datasets'>): SheetSpec {
  const p = inspectProfitability(data);
  return {
    name: 'Profitability data needed',
    note: p.statement,
    columns: [{ header: 'Data needed' }, { header: 'Why it matters' }, { header: 'Suggested field' }],
    rows: p.requirements.map((r) => [r.item, r.why, r.suggested]),
  };
}
