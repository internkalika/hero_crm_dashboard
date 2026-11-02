// Sheet builders for the Dealer App vs DataSense comparison downloads.
import type { CompareResult, CompareRow } from '../metrics/comparison';
import type { SheetSpec } from './excel';
import { dataRangeLabel } from '../util/parse';
import { CAPILLARY_QUIZ_NOTE, COMPARISON_COLUMNS, ComparisonRow, comparisonCell, comparisonRows, comparisonTotals } from '../metrics/comparisonTable';

const sideCols = [
  { header: 'Eligible orders', format: 'int' as const },
  { header: 'Order value', format: 'inr' as const },
  { header: 'Cycles qty', format: 'int' as const },
  { header: 'AOV', format: 'inr' as const },
  { header: 'ASP', format: 'inr' as const },
  { header: 'Rejected orders', format: 'int' as const },
  { header: 'Complaints', format: 'int' as const },
];

const rowCells = (r: CompareRow) => [
  r.dealer.orders, r.dealer.value, r.dealer.qty, r.dealer.aov, r.dealer.asp, r.dealer.rejected, r.dealer.complaints,
  r.ds.orders, r.ds.value, r.ds.qty, r.ds.aov, r.ds.asp, r.ds.rejected, r.ds.complaints,
];

function rowsSheet(name: string, rows: CompareRow[], baseline: 'dealer' | 'ds', note: string): SheetSpec {
  const baseLabel = baseline === 'dealer' ? 'Dealer App' : 'DataSense';
  const otherLabel = baseline === 'dealer' ? 'DataSense' : 'Dealer App';
  return {
    name,
    note,
    columns: [
      { header: 'ERP dealer code' },
      { header: 'Dealer' },
      { header: 'Match status' },
      { header: 'Match confidence' },
      { header: 'Dealer App Outlet ID' },
      { header: 'DataSense code' },
      ...sideCols.map((c) => ({ ...c, header: `Dealer App – ${c.header}` })),
      ...sideCols.map((c) => ({ ...c, header: `DataSense – ${c.header}` })),
      { header: `Order value difference (${otherLabel} − ${baseLabel})`, format: 'inr' as const },
      { header: 'Order value difference %', format: 'pct' as const },
      { header: `Orders difference`, format: 'int' as const },
      { header: `AOV difference`, format: 'inr' as const },
      { header: 'Hero Smiles points (latest snapshot)', format: 'int' as const },
      { header: 'Notes' },
    ],
    rows: rows.map((r) => [
      r.erpCode,
      r.name,
      r.match === 'matched' ? 'Orders in both systems' : r.match === 'dealer_only' ? 'Orders only via Dealer App' : 'Orders only via DataSense',
      r.confidence,
      r.outletId,
      r.dsCode,
      ...rowCells(r),
      r.match === 'matched' ? r.diffs.value.abs : null,
      r.match === 'matched' ? r.diffs.value.pct : null,
      r.match === 'matched' ? r.diffs.orders.abs : null,
      r.match === 'matched' ? r.diffs.aov.abs : null,
      r.loyaltyPoints,
      r.flags.join('; '),
    ]),
  };
}

/** The comparison table exactly as shown on the page: 15 columns in the fixed order, followed by a Total row. */
export function comparisonTableSheet(name: string, rows: ComparisonRow[], note: string): SheetSpec {
  const withTotal = [...rows, comparisonTotals(rows)];
  return {
    name,
    note: `${note}. Sales App = DataSense SFA; Bizom App = Dealer App. ${CAPILLARY_QUIZ_NOTE} A dash/blank means the figure is unavailable, not zero.`,
    columns: COMPARISON_COLUMNS.map((c) => ({ header: c.header, format: c.format, width: c.id === 'dbName' ? 30 : undefined })),
    rows: withTotal.map((r) => COMPARISON_COLUMNS.map((c) => comparisonCell(r, c.id))),
  };
}

export function comparisonSheets(res: CompareResult, kind: 'common' | 'unmatched' | 'full' | 'reconciliation'): SheetSpec[] {
  const periodNote = res.months.length ? `${dataRangeLabel(res.months)} (months compared: ${res.months.join(', ')})` : 'No common months';
  const common = res.rows.filter((r) => r.match === 'matched');
  const allRows = comparisonRows(res);
  const unmatched = res.rows.filter((r) => r.match !== 'matched');
  const summary: SheetSpec = {
    name: 'Summary',
    columns: [{ header: 'Measure', width: 52 }, { header: 'Dealer App', format: 'dec' }, { header: 'DataSense', format: 'dec' }, { header: 'Unit' }],
    note: 'Totals for the compared months',
    rows: [
      ['Scope: dealers ordering in both systems', null, null, ''],
      ['Eligible orders', res.common.dealer.orders, res.common.ds.orders, 'orders'],
      ['Order value', res.common.dealer.value, res.common.ds.value, '₹'],
      ['Cycles quantity', res.common.dealer.qty, res.common.ds.qty, 'units'],
      ['AOV', res.common.dealer.aov, res.common.ds.aov, '₹'],
      ['ASP (cycles)', res.common.dealer.asp, res.common.ds.asp, '₹'],
      ['Fulfilment rate (Dealer App, quantity based)', res.common.dealer.fulfilmentRate === null ? null : res.common.dealer.fulfilmentRate * 100, null, '%'],
      ['Billed rate (DataSense, status based; not comparable)', null, res.common.ds.billedRate === null ? null : res.common.ds.billedRate * 100, '%'],
      ['Scope: every dealer in each system', null, null, ''],
      ['Eligible orders', res.all.dealer.orders, res.all.ds.orders, 'orders'],
      ['Order value', res.all.dealer.value, res.all.ds.value, '₹'],
      ['Dealers ordering in both systems', res.counts.common, res.counts.common, 'dealers'],
      ['Dealers ordering in one system only', res.counts.dealerOnly, res.counts.dsOnly, 'dealers'],
    ],
  };
  const cands: SheetSpec = {
    name: 'Name-only candidates',
    note: 'Dealers whose names are identical but ERP codes differ. Not merged automatically; review required.',
    columns: [{ header: 'Dealer App code' }, { header: 'Dealer App name' }, { header: 'DataSense code' }, { header: 'DataSense name' }, { header: 'DataSense orders', format: 'int' }, { header: 'Decision' }, { header: 'Reason' }],
    rows: res.candidates.map((c) => [c.dealerKey, c.dealerName, c.dsKey, c.dsName, c.dsOrders, c.decision ?? 'Pending review', c.reason]),
  };
  const recon: SheetSpec = {
    name: 'Reconciliation',
    note: periodNote,
    columns: [{ header: 'Check' }, { header: 'Value', format: 'int' }, { header: 'Comment' }],
    rows: [
      ['Dealers ordering in both systems (matched on ERP code)', res.counts.common, 'High confidence'],
      ['Dealers ordering only through the Dealer App (compared months)', res.counts.dealerOnly, 'Also DataSense dealers, but no DataSense order'],
      ['Dealers ordering only through DataSense (compared months)', res.counts.dsOnly, ''],
      ['Name-only candidates awaiting review', res.candidates.filter((c) => !c.decision).length, 'Never merged automatically'],
      ['DataSense names used by more than one code', res.nameCollisions.length, 'Why names are not used as a join key'],
    ],
  };
  switch (kind) {
    case 'common':
      return [comparisonTableSheet('Comparison table', allRows.filter((r) => r.match === 'matched'), periodNote), summary, rowsSheet('Ordering in both (detail)', common, res.baseline, periodNote)];
    case 'unmatched':
      return [rowsSheet('Orders only via Dealer App', unmatched.filter((r) => r.match === 'dealer_only'), res.baseline, periodNote), rowsSheet('Orders only via DataSense', unmatched.filter((r) => r.match === 'ds_only'), res.baseline, periodNote), cands];
    case 'reconciliation':
      return [recon, cands];
    default:
      return [comparisonTableSheet('Comparison table', allRows.filter((r) => r.match === 'matched'), periodNote), comparisonTableSheet('All dealers', allRows, periodNote), summary, rowsSheet('Ordering in both (detail)', common, res.baseline, periodNote), rowsSheet('Orders only via Dealer App', unmatched.filter((r) => r.match === 'dealer_only'), res.baseline, periodNote), rowsSheet('Orders only via DataSense', unmatched.filter((r) => r.match === 'ds_only'), res.baseline, periodNote), cands, recon];
  }
}
