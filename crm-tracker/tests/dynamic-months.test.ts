import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import type { AppData, DatasetPayload, DealerOrderLine, DsOrder } from '../src/lib/types';
import { emptyAppData } from '../src/lib/types';
import { availableMonths, availableSpan, dateInPeriod, customPeriod, periodOptions } from '../src/lib/metrics/period';
import { buildCtx, buildView, cmpPair, monthSpan } from '../src/lib/metrics/landing';
import { isMultiMonth, monthsOf, splitByMonth } from '../src/lib/ingest/split';
import { ImportItem, expandMonths, planItems } from '../src/lib/ingest/session';
import { applyImport } from '../src/lib/ingest/pipeline';
import { formatUpdatedDay, resolveLastUpdated } from '../src/lib/sync/lastUpdated';

/* ---- synthetic Dealer App and DataSense records. Nothing here comes from a real dataset. ---- */
const DEALERS = ['D001', 'D002', 'D003'];
let seq = 0;
function appLine(dealer: string, date: string, over: Partial<DealerOrderLine> = {}): DealerOrderLine {
  seq += 1;
  return {
    key: `O${seq}|sku`, datasetId: 'x', rowNo: seq, period: date.slice(0, 7), zone: 'West', city: 'Pune', warehouse: null, outletId: `OUT-${dealer}`, outletName: `Dealer ${dealer}`, dealerKey: dealer,
    beat: null, sku: 'Model A 26T', skuCode: 'A26', brand: 'Model A', category: 'Cycle', orderId: `O${seq}`, sapOrderId: null, orderDate: date, month: date.slice(0, 7), status: 'fulfilled', rawStatus: 'Fulfilled',
    qty: 2, unitPrice: 5000, amount: 10000, invoiceId: null, invoiceDate: null, fulfilledAmount: null, fulfilledDate: null, fulfilledQty: null, lineStatus: 'fulfilled', ...over,
  };
}
function dsOrder(dealer: string, date: string, no: string): DsOrder {
  return { key: no, datasetId: 'ds', rowNo: 1, orderNo: no, idFormat: 'datasense', orderDate: date, month: date.slice(0, 7), invoiceNo: null, dealerName: `Dealer ${dealer}`, dealerKey: dealer, employeeName: null, employeeId: null, role: null, city: 'Pune', value: 8000, cyclesQty: 1, cyclesValue: 8000, sparesValue: 0, sparesQty: 0, rawStatus: 'Open', statusGroup: 'open', flags: [] };
}
/** one Dealer App line and one DataSense order per dealer on the given days of each month */
function build(months: string[], days = ['03', '15']): AppData {
  const d = emptyAppData();
  for (const m of months) for (const dealer of DEALERS) for (const day of days) {
    d.dealerLines.push(appLine(dealer, `${m}-${day}`));
    d.dsOrders.push(dsOrder(dealer, `${m}-${day}`, `${dealer}-${m}-${day}`));
  }
  return d;
}

describe('month detection', () => {
  it('lists every month found in the data, in order, with the year', () => {
    expect(availableMonths(build(['2026-09', '2026-10', '2026-11']))).toEqual(['2026-09', '2026-10', '2026-11']);
    // a later month needs no code: December and January (a new year) are found the same way
    expect(availableMonths(build(['2026-11', '2026-12', '2027-01']))).toEqual(['2026-11', '2026-12', '2027-01']);
  });
  it('keeps November 2026 and November 2027 apart', () => {
    const m = availableMonths(build(['2026-11', '2027-11']));
    expect(m).toEqual(['2026-11', '2027-11']);
    expect(monthSpan('2026-11', '2027-11')).toBe('Nov 2026 – Nov 2027');
  });
  it('the calendar span follows the data: exact dates, and no day outside them', () => {
    const d = build(['2026-10']);
    expect(availableSpan(d)).toEqual({ min: '2026-10-03', max: '2026-10-15' });
    const more = build(['2026-10', '2026-11', '2026-12']);
    expect(availableSpan(more)).toEqual({ min: '2026-10-03', max: '2026-12-15' });
    expect(availableSpan(emptyAppData())).toBeNull();
  });
  it('the period options gain a new month by themselves', () => {
    const labels = (d: AppData) => periodOptions(availableMonths(d)).map((p) => p.label);
    expect(labels(build(['2026-10']))).not.toContain('Nov 2026');
    expect(labels(build(['2026-10', '2026-11']))).toContain('Nov 2026');
  });
  it('a custom range keeps exactly the dates inside it', () => {
    const p = customPeriod('2026-10-05', '2026-11-10');
    expect(dateInPeriod('2026-10-05', p)).toBe(true);
    expect(dateInPeriod('2026-11-10', p)).toBe(true);
    expect(dateInPeriod('2026-10-04', p)).toBe(false);
    expect(dateInPeriod('2026-11-11', p)).toBe(false);
  });
});

describe('Dealer App vs DataSense SFA with any number of months', () => {
  it('no longer stops at two months: November appears in the months and in the trend', () => {
    const ctx = buildCtx(build(['2026-09', '2026-10', '2026-11']))!;
    expect(ctx.months).toEqual(['2026-09', '2026-10', '2026-11']);
    const v = buildView(ctx, { range: null, dealers: [], channel: 'both', models: [] });
    expect(v.months).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(v.trend.map((t) => t.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(v.trend[2].app?.valid).toBe(6);
    expect(v.trend[2].ds?.valid).toBe(6);
    expect(v.cmp).toEqual(['2026-10', '2026-11']); // the previous month against the latest
  });
  it('December and the next January are picked up without a code change, across the year end', () => {
    const ctx = buildCtx(build(['2026-11', '2026-12', '2027-01']))!;
    const v = buildView(ctx, { range: null, dealers: [], channel: 'both', models: [] });
    expect(v.months).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(v.trend.map((t) => t.month)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(v.periodLabel).toBe('Nov 2026 – Jan 2027');
  });
  it('historical months are unchanged by newer ones: October alone gives the same figures with or without November', () => {
    const oct = { start: '2026-10-01', end: '2026-10-31' };
    const range = { from: oct.start, to: oct.end };
    const a = buildView(buildCtx(build(['2026-09', '2026-10']))!, { range, dealers: [], channel: 'both', models: [] });
    const b = buildView(buildCtx(build(['2026-09', '2026-10', '2026-11']))!, { range, dealers: [], channel: 'both', models: [] });
    expect(b.app).toEqual(a.app);
    expect(b.ds).toEqual(a.ds);
    expect(a.app.valid).toBe(6);
    expect(a.months).toEqual(['2026-10']);
  });
  it('October + November together are the sum of the two months, and a movement compares them', () => {
    const ctx = buildCtx(build(['2026-09', '2026-10', '2026-11']))!;
    const both = buildView(ctx, { range: { from: '2026-10-01', to: '2026-11-30' }, dealers: [], channel: 'both', models: [] });
    const oct = buildView(ctx, { range: { from: '2026-10-01', to: '2026-10-31' }, dealers: [], channel: 'both', models: [] });
    const nov = buildView(ctx, { range: { from: '2026-11-01', to: '2026-11-30' }, dealers: [], channel: 'both', models: [] });
    expect(both.app.valid).toBe(oct.app.valid + nov.app.valid);
    expect(both.app.value).toBe(oct.app.value + nov.app.value);
    expect(both.ds.valid).toBe(oct.ds.valid + nov.ds.valid);
    expect(both.both).toBe(true);
    expect(both.cmp).toEqual(['2026-10', '2026-11']);
    expect(oct.both).toBe(false);
  });
  it('a custom calendar range inside a month narrows every figure to those days', () => {
    const ctx = buildCtx(build(['2026-10', '2026-11']))!;
    const first = buildView(ctx, { range: { from: '2026-11-01', to: '2026-11-10' }, dealers: [], channel: 'both', models: [] });
    expect(first.app.valid).toBe(3); // only the 3rd of each dealer
    const all = buildView(ctx, { range: null, dealers: [], channel: 'both', models: [] });
    expect(all.app.valid).toBe(12);
  });
  it('a range with no data is empty, not zero-filled months', () => {
    const ctx = buildCtx(build(['2026-10', '2026-11']))!;
    const v = buildView(ctx, { range: { from: '2027-03-01', to: '2027-03-31' }, dealers: [], channel: 'both', models: [] });
    expect(v.months).toEqual([]);
    expect(v.periodLabel).toMatch(/no months/);
  });
  it('the trend shows the year when the months cross a year', () => {
    const ctx = buildCtx(build(['2026-12', '2027-01']))!;
    const v = buildView(ctx, { range: null, dealers: [], channel: 'both', models: [] });
    expect(v.trend.map((t) => t.label)).toEqual(['Dec 26', 'Jan 27']);
    const single = buildView(buildCtx(build(['2026-10', '2026-11']))!, { range: null, dealers: [], channel: 'both', models: [] });
    expect(single.trend.map((t) => t.label)).toEqual(['Oct', 'Nov']);
  });
  it('cmpPair with one month compares the month with itself (nothing to move)', () => {
    expect(cmpPair(['2026-10'])).toEqual(['2026-10', '2026-10']);
    expect(cmpPair(['2026-08', '2026-09', '2026-10'])).toEqual(['2026-09', '2026-10']);
  });
});

/* ---- importing: a workbook with several months ---- */
const payloadOf = (lines: DealerOrderLine[], scope: string): DatasetPayload<DealerOrderLine> => {
  const dates = lines.map((l) => l.orderDate as string).sort();
  return {
    meta: { id: `dealer_orders:${scope}`, source: 'dealer_orders', scope, fileName: 'orders.xlsx', importedAt: '2026-11-02T00:00:00.000Z', periodStart: dates[0], periodEnd: dates[dates.length - 1], period: scope, rawCount: lines.length, validCount: lines.length, duplicateCount: 0, invalidCount: 0, flaggedCount: 0, mappingVersion: 'm', columns: [], mapping: {}, inference: [], fileSize: 1, mode: 'add', extra: {} } as never,
    raw: [], records: lines, issues: [],
  };
};
const item = (p: DatasetPayload, hash = 'H1', name = 'orders.xlsx'): ImportItem => ({ analysis: { id: 'f1', fileName: name, hash } as never, source: 'dealer_orders', sheetName: null, scopeOverride: null, include: true, payload: p });

describe('importing a month, several months, and the same month again', () => {
  const oct = [appLine('D001', '2026-10-05'), appLine('D002', '2026-10-20')];
  const nov = [appLine('D001', '2026-11-04'), appLine('D003', '2026-11-18'), appLine('D003', '2026-11-19')];

  it('a workbook holding October and November is recognised as two months', () => {
    const p = payloadOf([...oct, ...nov], '2026-10_2026-11');
    expect(isMultiMonth(p)).toBe(true);
    expect(monthsOf(p as DatasetPayload<DealerOrderLine>)).toEqual(['2026-10', '2026-11']);
    const parts = splitByMonth(p as DatasetPayload<DealerOrderLine>);
    expect(parts.map((x) => x.meta.id)).toEqual(['dealer_orders:2026-10', 'dealer_orders:2026-11']);
    expect(parts.map((x) => x.records.length)).toEqual([2, 3]);
    expect(parts[1].meta.periodStart).toBe('2026-11-04');
    expect(parts[1].meta.periodEnd).toBe('2026-11-19');
    expect(parts[1].records.every((l) => l.datasetId === 'dealer_orders:2026-11' && l.period === '2026-11')).toBe(true);
    expect(parts.reduce((s, x) => s + x.records.length, 0)).toBe(5); // nothing lost, nothing duplicated
  });
  it('a one-month file is left alone', () => {
    expect(isMultiMonth(payloadOf(nov, '2026-11'))).toBe(false);
    expect(expandMonths([item(payloadOf(nov, '2026-11'))])).toHaveLength(1);
  });
  it('a multi-month workbook becomes one planned row per month; an existing month defaults to replace, a new one to add', () => {
    const existing = [payloadOf(oct, '2026-10').meta];
    const rows = planItems(existing, expandMonths([item(payloadOf([...oct, ...nov], '2026-10_2026-11'))]));
    expect(rows.map((r) => [r.payload!.meta.id, r.plan!.recommended])).toEqual([
      ['dealer_orders:2026-10', 'replace'],
      ['dealer_orders:2026-11', 'add'],
    ]);
    expect(rows[0].plan!.options).toEqual(['replace', 'skip']);
  });
  it('uploading the identical workbook again is recognised month by month as a duplicate and skipped', () => {
    const first = expandMonths([item(payloadOf([...oct, ...nov], '2026-10_2026-11'))]);
    const stored = first.map((r) => r.payload!.meta); // what the first import saved
    const again = planItems(stored, expandMonths([item(payloadOf([...oct, ...nov], '2026-10_2026-11'))]));
    expect(again.map((r) => [r.plan!.recommended, r.plan!.duplicateUpload])).toEqual([['skip', true], ['skip', true]]);
  });
  it('replacing November with a corrected file changes November only and never counts a line twice', () => {
    const before = payloadOf(nov, '2026-11');
    const corrected = payloadOf([appLine('D001', '2026-11-04', { amount: 12345 }), appLine('D003', '2026-11-18')], '2026-11');
    const { payload, summary } = applyImport(before, corrected, 'replace');
    expect(payload!.records).toHaveLength(2);
    expect(summary.added + summary.updated + summary.unchanged).toBeGreaterThan(0);
    expect(new Set((payload!.records as DealerOrderLine[]).map((l) => l.key)).size).toBe(2);
  });
  it('Skip keeps what is stored', () => {
    const { payload } = applyImport(payloadOf(nov, '2026-11'), payloadOf(nov, '2026-11'), 'skip');
    expect(payload).toBeNull();
  });
});

describe('Last Updated', () => {
  it('uses the published version time, in the business day (IST)', () => {
    const r = resolveLastUpdated('2026-11-02T21:00:00.000Z', '2026-10-29T10:00:00.000Z');
    expect(r.source).toBe('published');
    expect(formatUpdatedDay(r.at)).toBe('3 November 2026'); // 21:00 UTC is already 3 November in India
    expect(formatUpdatedDay('2026-11-02T05:00:00.000Z')).toBe('2 November 2026');
  });
  it('falls back to the data embedded in the page only before anything was published', () => {
    expect(resolveLastUpdated(null, '2026-10-29T10:00:00.000Z')).toEqual({ at: '2026-10-29T10:00:00.000Z', source: 'embedded' });
  });
  it('says nothing rather than guess', () => {
    expect(resolveLastUpdated(null, null)).toEqual({ at: null, source: null });
    expect(resolveLastUpdated('garbage', undefined)).toEqual({ at: null, source: null });
    expect(formatUpdatedDay(null)).toBeNull();
    expect(formatUpdatedDay('not a date')).toBeNull();
  });
  it('depends on the timestamps given, never on the clock', () => {
    const a = resolveLastUpdated('2026-11-02T05:00:00.000Z', null);
    const b = resolveLastUpdated('2026-11-02T05:00:00.000Z', null);
    expect(a).toEqual(b);
  });
});
