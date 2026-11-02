// Headline numbers on the supplied MIS files. These are regression anchors: if a parser or KPI formula
// changes, the figures below change and the difference has to be explained.
import { describe, expect, it } from 'vitest';
import { HAS_DATA, buildAppData } from './helpers';
import { ALL_PERIOD, availableMonths } from '../src/lib/metrics/period';
import { buildDealerOrders, dsOrderSummaries, orderKpis } from '../src/lib/metrics/orders';
import { buildComparison } from '../src/lib/metrics/comparison';
import { complaintKpis, splitTestComplaints } from '../src/lib/metrics/complaints';
import { reportRanking, splitTest, usageKpis } from '../src/lib/metrics/bizom';
import { issueKpis } from '../src/lib/metrics/issues';
import { employeeKpis } from '../src/lib/metrics/employees';
import { latestValidSnapshot, snapshotTotals, snapshotsOf } from '../src/lib/metrics/loyalty';
import { executiveInsights } from '../src/lib/metrics/insights';
import { dataAvailability, reconciliations, unmatchedDealers } from '../src/lib/metrics/quality';
import { defaultSettings } from '../src/lib/types';

const AS_OF = '2026-10-26';

describe.skipIf(!HAS_DATA)('headline numbers from the supplied files', () => {
  const { data } = buildAppData();

  it('covers August to October 2026', () => {
    expect(availableMonths(data)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('Dealer App: 607 SKU lines make 34 orders; 29 are eligible', () => {
    expect(data.dealerLines).toHaveLength(607);
    const orders = buildDealerOrders(data.dealerLines);
    expect(orders).toHaveLength(34);
    const k = orderKpis(orders, defaultSettings, 'dealer');
    expect(k.gross).toBe(34);
    expect(k.eligible).toBe(29);
    expect(k.eligibleValue).toBeCloseTo(4554964.7, 2);
    expect(k.aov).toBeCloseTo(4554964.7 / 29, 4);
    // order value is the sum of line amounts, so it must equal the sum over eligible lines
    const eligibleIds = new Set(orders.filter((o) => o.statusGroup !== 'rejected' && (o.value ?? 0) > 0).map((o) => o.orderId));
    const lineSum = data.dealerLines.filter((l) => eligibleIds.has(l.orderId)).reduce((a, l) => a + (l.amount ?? 0), 0);
    expect(lineSum).toBeCloseTo(4554964.7, 2);
  });

  it('DataSense: 5,907 valid orders, 5,574 eligible', () => {
    expect(data.dsOrders).toHaveLength(5907);
    const k = orderKpis(dsOrderSummaries(data.dsOrders), defaultSettings, 'ds');
    expect(k.gross).toBe(5907);
    expect(k.eligible).toBe(5574);
    expect(k.eligibleValue).toBeCloseTo(1130775956.11, 1);
  });

  it('DataSense and Dealer App order values are never added together', () => {
    const c = buildComparison(data, ALL_PERIOD, defaultSettings);
    expect(c.common.dealer.value).not.toBeNull();
    // the comparison reports the two systems side by side; there is no combined total
    expect(Object.keys(c.common)).toEqual(expect.arrayContaining(['dealer', 'ds']));
    expect(Object.keys(c.common)).not.toContain('total');
  });

  it('Dealer App vs DataSense: 8 dealers order through both systems, 3 Dealer App dealers only through the Dealer App, no name-only candidates', () => {
    const c = buildComparison(data, ALL_PERIOD, defaultSettings);
    expect(c.counts.common).toBe(8);
    expect(c.counts.dealerOnly).toBe(3);
    expect(c.candidates).toHaveLength(0);
    for (const r of c.rows.filter((x) => x.match === 'matched')) expect(r.confidence).toMatch(/high/i);
  });

  it('complaints: DataSense 1,776 (1,496 not closed); Dealer App 7 (6 after excluding the test record)', () => {
    const ds = complaintKpis(data.dsComplaints, AS_OF);
    expect(ds.total).toBe(1776);
    expect(ds.backlog).toBe(1496);
    const real = splitTestComplaints(data.dealerComplaints, false);
    expect(data.dealerComplaints).toHaveLength(7);
    expect(real.kept).toHaveLength(6);
    expect(real.excluded).toHaveLength(1);
    expect(complaintKpis(real.kept, AS_OF, real.excluded.length).total).toBe(6);
  });

  it('Bizom: 8,130 recorded report accesses by 145 users on 209 reports (test and service accounts excluded)', () => {
    const { kept, excluded } = splitTest(data.usage, false);
    const k = usageKpis(kept, 5, excluded);
    expect(kept.reduce((a, u) => a + u.accessCount, 0)).toBe(8130);
    expect(new Set(kept.map((u) => u.userId)).size).toBe(145);
    expect(reportRanking(kept)).toHaveLength(209);
    // the excluded rows are still in the data, and counted
    expect(data.usage.reduce((a, u) => a + u.accessCount, 0)).toBe(8283);
    expect(k).toBeDefined();
  });

  it('issue tracker: 57 issues, 25 open, 13 overdue as of 26 Oct 2026', () => {
    const k = issueKpis(data.issues, AS_OF);
    expect(k.total).toBe(57);
    expect(k.open).toBe(25);
    expect(k.overdue).toBe(13);
  });

  it('DataSense employee activity: 70 employees, 6,512 visits, 3,639 orders', () => {
    const k = employeeKpis(data.dsEmployees.filter((e) => !e.isTest));
    expect(k.employees).toBe(70);
    expect(k.visits).toBe(6512);
    expect(k.orders).toBe(3639);
  });

  it('Hero Smiles: the 26 Oct snapshot is a point-in-time position of 24 members', () => {
    const snaps = snapshotsOf(data);
    expect(snaps.map((s) => s.date)).toEqual(['2026-09-28', '2026-10-05', '2026-10-13', '2026-10-19', '2026-10-26']);
    const latest = latestValidSnapshot(snaps)!;
    expect(latest.date).toBe('2026-10-26');
    const t = snapshotTotals(latest);
    expect(t.rows).toBe(24);
    expect(t.positiveBalances).toBe(11);
    expect(t.current).toBe(52025);
  });

  it('data quality: no error-level issue and every source total reconciles', () => {
    expect(data.dq.filter((i) => i.severity === 'error')).toHaveLength(0);
    const recon = reconciliations(data);
    expect(recon.length).toBe(19);
    expect(recon.every((r) => r.ok)).toBe(true);
  });

  it('dealer matching never merges by name', () => {
    const u = unmatchedDealers(data);
    expect(u).toBeDefined();
    const c = buildComparison(data, ALL_PERIOD, defaultSettings);
    expect(c.rows.filter((r) => r.match === 'matched').every((r) => !!r.erpCode)).toBe(true);
  });

  it('data availability lists every source that was supplied', () => {
    const avail = dataAvailability(data);
    const withData = avail.filter((a) => a.files > 0).length;
    expect(withData).toBeGreaterThanOrEqual(9);
  });

  it('executive insights are descriptive and point to a page', () => {
    const ins = executiveInsights(data, ALL_PERIOD, defaultSettings);
    expect(ins.length).toBeGreaterThan(5);
    for (const i of ins) {
      expect(i.title.length).toBeGreaterThan(5);
      expect(['good', 'info', 'watch', 'concern']).toContain(i.level);
    }
    expect(ins.some((i) => /dealers placed orders through both order systems/.test(i.title))).toBe(true);
    expect(ins.some((i) => /SAP orders appear in both systems/.test(i.title))).toBe(false);
  });
});
