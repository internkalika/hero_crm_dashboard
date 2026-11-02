// Tests for the refinement: comparison table, honest period-over-period changes, key insights, dealer profile,
// links and URL filters. Real-data expectations are anchors taken from the supplied MIS files.
import { describe, expect, it } from 'vitest';
import { HAS_DATA, buildAppData } from './helpers';
import { ALL_PERIOD, Period } from '../src/lib/metrics/period';
import { buildComparison } from '../src/lib/metrics/comparison';
import { CMP_GROUP_LABEL, COMPARISON_COLUMNS, comparisonCell, comparisonRows, comparisonTotals } from '../src/lib/metrics/comparisonTable';
import { comparisonTableSheet } from '../src/lib/export/comparison';
import { buildDealerOrders, dsOrderSummaries } from '../src/lib/metrics/orders';
import { changeOf, comparableWindows, lastTwoCompleteMonths, monthCompleteFn, periodMonths } from '../src/lib/metrics/windows';
import { activeDealers, loyaltyOverview, orderTrend, ordersByMonth } from '../src/lib/metrics/overview';
import { keyInsights } from '../src/lib/metrics/keyInsights';
import { buildDealerProfile, dealerExists } from '../src/lib/metrics/dealerProfile';
import { issueKpis } from '../src/lib/metrics/issues';
import { dealerLink, isValidatedDealerKey, pageLink } from '../src/lib/nav/links';
import { parseFilters } from '../src/components/filters';
import { defaultSettings } from '../src/lib/types';

const AS_OF = '2026-10-26';
const month = (m: string, last: string): Period => ({ id: m, label: m, from: `${m}-01`, to: `${m}-${last}` });
const SEP = month('2026-09', '30');
const OCT = month('2026-10', '31');
const AUG = month('2026-08', '31');

describe('comparison table definition', () => {
  it('has the 15 columns in the exact required order', () => {
    expect(COMPARISON_COLUMNS.map((c) => c.header)).toEqual([
      'Outlet ID',
      'DB Code',
      'DB Name',
      'Sales App Complaint Count',
      'Sales App Order Count',
      'Sales App Total Qty',
      'Sales App Total Value',
      'Avrg Order Value',
      'Dealer App Complaint Count',
      'Dealer App Order Count',
      'Dealer App Total Qty',
      'Dealer App Total Value',
      'Avrg Order Value',
      'Capillary Smile Quiz Points',
      'Capillary Current Total Points',
    ]);
  });

  it('groups them: 3 identity, 5 Sales App (DataSense), 5 Dealer App, 2 Capillary', () => {
    const g = (k: string) => COMPARISON_COLUMNS.filter((c) => c.group === k).length;
    expect([g('identity'), g('sales'), g('app'), g('capillary')]).toEqual([3, 5, 5, 2]);
    expect(CMP_GROUP_LABEL.sales).toMatch(/DataSense/);
    expect(CMP_GROUP_LABEL.app).toMatch(/Dealer App/);
  });

  it('totals: counts add up, AOV is total value ÷ total orders (not an average of averages)', () => {
    const base = { key: 'x', outletId: null, dbCode: '', dbName: '', match: 'matched' as const, quizPoints: null, note: null };
    const a = { ...base, salesComplaints: 1, salesOrders: 2, salesQty: 10, salesValue: 100, salesAov: 50, appComplaints: 0, appOrders: 1, appQty: 5, appValue: 30, appAov: 30, currentPoints: 100 };
    const b = { ...base, salesComplaints: 2, salesOrders: 8, salesQty: 40, salesValue: 900, salesAov: 112.5, appComplaints: null, appOrders: 3, appQty: 15, appValue: 270, appAov: 90, currentPoints: null };
    const t = comparisonTotals([a, b]);
    expect(t.salesOrders).toBe(10);
    expect(t.salesValue).toBe(1000);
    expect(t.salesAov).toBe(100); // 1000 / 10, not (50 + 112.5) / 2
    expect(t.appAov).toBe(75); // 300 / 4
    expect(t.salesComplaints).toBe(3);
    expect(t.appComplaints).toBe(0); // null (not available) is skipped, not turned into a number
    expect(t.currentPoints).toBe(100);
    expect(t.quizPoints).toBeNull();
  });

  it('a blank is not a zero: no rows means no totals', () => {
    const t = comparisonTotals([]);
    expect(t.salesOrders).toBeNull();
    expect(t.salesAov).toBeNull();
  });
});

describe.skipIf(!HAS_DATA)('comparison table on the supplied files', () => {
  const { data } = buildAppData();
  const res = buildComparison(data, ALL_PERIOD, defaultSettings);
  const rows = comparisonRows(res);
  const common = rows.filter((r) => r.match === 'matched');

  it('8 of the 11 Dealer App dealers placed orders through both systems, 3 only through the Dealer App (matched on the ERP code only)', () => {
    expect(res.months).toEqual(['2026-09', '2026-10']);
    expect(common).toHaveLength(8);
    expect(res.counts.dealerOnly).toBe(3);
    expect(rows.filter((r) => r.match === 'dealer_only').map((r) => r.key).sort()).toEqual(['12186', '3117', '3167']);
    expect(common.every((r) => isValidatedDealerKey(r.key))).toBe(true);
  });

  it('totals of the dealers ordering in both systems: 53 DataSense orders, 23 Dealer App orders', () => {
    const t = comparisonTotals(common);
    expect(t.salesOrders).toBe(53);
    expect(t.appOrders).toBe(23);
    expect(t.salesAov).toBeCloseTo((t.salesValue as number) / 53, 6);
    expect(t.appAov).toBeCloseTo((t.appValue as number) / 23, 6);
  });

  it('turning the three Dealer App only dashes into zeros does not change any total', () => {
    const app = rows.filter((r) => r.match !== 'ds_only');
    const t = comparisonTotals(app);
    expect(t.salesOrders).toBe(53); // the three add 0 DataSense orders
    expect(t.appOrders).toBe(app.reduce((a, r) => a + (r.appOrders ?? 0), 0));
    expect(t.salesAov).toBeCloseTo((t.salesValue as number) / 53, 6);
  });

  it('Smile Quiz Points is unavailable for every row; current points come from the latest snapshot', () => {
    expect(rows.every((r) => r.quizPoints === null)).toBe(true);
    const t = comparisonTotals(common);
    expect(t.currentPoints).toBe(48570);
  });

  it('a dealer whose Dealer App orders were all rejected shows 0 orders and a blank AOV, not a made-up value', () => {
    const none = common.filter((r) => r.appOrders === 0);
    for (const r of none) expect(r.appAov).toBeNull();
  });

  it('the Excel/CSV sheet has the same columns and a Total row', () => {
    const s = comparisonTableSheet('Comparison table', common, 'test');
    expect(s.columns.map((c) => c.header)).toEqual(COMPARISON_COLUMNS.map((c) => c.header));
    expect(s.rows).toHaveLength(common.length + 1);
    const last = s.rows[s.rows.length - 1];
    expect(last[COMPARISON_COLUMNS.findIndex((c) => c.id === 'dbName')]).toBe('Total');
    expect(comparisonCell(common[0], 'dbCode')).toBe(common[0].dbCode);
    expect(s.note).toMatch(/quiz/i);
  });
});

describe('period windows', () => {
  it('whole calendar months only', () => {
    expect(periodMonths(ALL_PERIOD)).toBeNull();
    expect(periodMonths(SEP)).toEqual(['2026-09']);
    expect(periodMonths({ id: 'q', label: 'q', from: '2026-08-01', to: '2026-10-31' })).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(periodMonths({ id: 'p', label: 'p', from: '2026-09-05', to: '2026-09-30' })).toBeNull();
    expect(periodMonths({ id: 'p', label: 'p', from: '2026-09-01', to: '2026-09-20' })).toBeNull();
  });

  it('the previous window is the same number of months just before', () => {
    const w = comparableWindows({ id: 'x', label: 'x', from: '2026-09-01', to: '2026-10-31' }, () => true, () => true);
    expect(w?.cur).toEqual(['2026-09', '2026-10']);
    expect(w?.prev).toEqual(['2026-07', '2026-08']);
  });

  it('no comparison when any month of either window is missing or unfinished', () => {
    expect(comparableWindows(SEP, (m) => m !== '2026-08', () => true)).toBeNull();
    expect(comparableWindows(SEP, () => true, (m) => m !== '2026-09')).toBeNull();
    expect(comparableWindows(SEP, () => true, () => true)).not.toBeNull();
  });

  it('change: percentage is undefined when the earlier value is zero', () => {
    expect(changeOf(100, 130)).toEqual({ from: 100, to: 130, abs: 30, pct: 0.3 });
    expect(changeOf(0, 5)?.pct).toBeNull();
    expect(changeOf(null, 5)).toBeNull();
    expect(changeOf(5, undefined)).toBeNull();
    expect(changeOf(100, 80)?.pct).toBeCloseTo(-0.2, 10);
  });

  it('latest two consecutive complete months', () => {
    const has = () => true;
    expect(lastTwoCompleteMonths(['2026-08', '2026-09', '2026-10'], has, (m) => m !== '2026-10')).toEqual(['2026-08', '2026-09']);
    expect(lastTwoCompleteMonths(['2026-08', '2026-10'], has, () => true)).toBeNull(); // not consecutive
  });
});

describe.skipIf(!HAS_DATA)('honest trends on the supplied files', () => {
  const { data } = buildAppData();
  const ds = dsOrderSummaries(data.dsOrders);
  const dealer = buildDealerOrders(data.dealerLines);

  it('the current month is never compared: October is still in progress on 26 Oct', () => {
    expect(monthCompleteFn(data, ['ds_orders'], AS_OF)('2026-10')).toBe(false);
    expect(monthCompleteFn(data, ['ds_orders'], AS_OF)('2026-09')).toBe(true);
    expect(orderTrend(ds, 'ds', OCT, defaultSettings, data, AS_OF)).toBeNull();
  });

  it('no trend for all data or for a period that cuts a month', () => {
    expect(orderTrend(ds, 'ds', ALL_PERIOD, defaultSettings, data, AS_OF)).toBeNull();
    expect(orderTrend(ds, 'ds', { id: 'p', label: 'p', from: '2026-09-05', to: '2026-09-30' }, defaultSettings, data, AS_OF)).toBeNull();
  });

  it('DataSense September vs August is +30%', () => {
    const t = orderTrend(ds, 'ds', SEP, defaultSettings, data, AS_OF);
    expect(t).not.toBeNull();
    expect(t?.vs).toMatch(/Aug/);
    expect(t?.value?.pct).toBeGreaterThan(0.29);
    expect(t?.value?.pct).toBeLessThan(0.31);
  });

  it('Dealer App has no August file, so there is no September trend to show', () => {
    expect(orderTrend(dealer, 'dealer', SEP, defaultSettings, data, AS_OF)).toBeNull();
    expect(orderTrend(dealer, 'dealer', AUG, defaultSettings, data, AS_OF)).toBeNull();
  });

  it('orders by month: Dealer App Sep–Oct, DataSense Aug–Oct', () => {
    expect(ordersByMonth(dealer, 'dealer', defaultSettings).map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(ordersByMonth(ds, 'ds', defaultSettings).map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('active dealers are counted by validated code; a dealer in both systems counts once', () => {
    const a = activeDealers(dealer, ds, defaultSettings);
    expect(a.dealerApp).toBe(10);
    expect(a.total).toBe(a.dealerApp + a.ds - a.both);
    expect(a.both).toBe(a.dealerApp - a.dealerOnly);
  });
});

describe.skipIf(!HAS_DATA)('Hero Smiles overview', () => {
  const { data } = buildAppData();
  const loy = loyaltyOverview(data);

  it('uses the latest two valid snapshots and never adds balances across snapshots', () => {
    expect(loy).not.toBeNull();
    expect(loy?.latest.date).toBe('2026-10-26');
    expect(loy?.previous?.date).toBe('2026-10-19');
    expect(loy?.latestTotals.current).toBe(52025);
    expect(loy?.previousTotals?.current).toBe(37285);
    expect(loy?.points?.abs).toBe(14740);
    expect(loy?.points?.pct).toBeCloseTo(14740 / 37285, 6);
    // one total per snapshot, oldest first
    expect(loy?.series.map((s) => s.date)).toEqual([...(loy?.series.map((s) => s.date) ?? [])].sort());
  });

  it('movers only list validated dealer codes', () => {
    for (const m of loy?.moverBars ?? []) expect(isValidatedDealerKey(m.key)).toBe(true);
  });
});

describe.skipIf(!HAS_DATA)('key insights', () => {
  const { data } = buildAppData();
  const ins = keyInsights(data, ALL_PERIOD, defaultSettings, {}, AS_OF);

  it('are built from the data, with unique ids and a link on every row', () => {
    expect(ins.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ins.map((i) => i.id)).size).toBe(ins.length);
    for (const i of ins) {
      expect(i.rows.length).toBeGreaterThan(0);
      for (const r of i.rows) {
        expect(r.to.startsWith('/')).toBe(true);
        expect(`${i.title} ${r.tag} ${r.text} ${r.sub}`).not.toMatch(/NaN|undefined|null|Infinity/);
      }
    }
  });

  it('dealer rows open a dealer profile only for validated codes', () => {
    for (const i of ins) {
      for (const r of i.rows) {
        const m = /[?&]dealer=([^&]+)/.exec(r.to);
        if (m) expect(isValidatedDealerKey(decodeURIComponent(m[1]))).toBe(true);
      }
    }
  });

  it('the headline order leaders match the order data', () => {
    const top = ins.find((i) => i.icon === 'trophy');
    expect(top?.rows.some((r) => /Jitesh Traders/.test(r.text))).toBe(true);
  });

  it('a one-month period still produces insights and keeps filters in the links', () => {
    const one = keyInsights(data, SEP, defaultSettings, {}, AS_OF);
    expect(one.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!HAS_DATA)('issue tracker figures shown on the Overview', () => {
  const { data } = buildAppData();
  const k = issueKpis(data.issues, AS_OF);
  it('57 tracked, 32 resolved, 25 open, 13 overdue', () => {
    expect(k.total).toBe(57);
    expect(k.resolved).toBe(32);
    expect(k.open).toBe(25);
    expect(k.overdue).toBe(13);
  });
});

describe.skipIf(!HAS_DATA)('dealer profile', () => {
  const { data } = buildAppData();

  it('Jitesh Traders (ERP 14554) has orders in both systems and in Hero Smiles', () => {
    expect(dealerExists(data, '14554')).toBe(true);
    const p = buildDealerProfile(data, '14554', ALL_PERIOD, defaultSettings);
    expect(p.identity.name).toMatch(/Jitesh/i);
    expect(p.identity.dbCode).toBe('14554');
    expect(p.identity.inDealerApp).toBe(true);
    expect(p.identity.inDataSense).toBe(true);
    expect(p.identity.inLoyalty).toBe(true);
    expect(p.dealerApp.kpis.eligible).toBe(12);
    expect(p.ds.kpis.eligible).toBe(36);
    expect(p.loyalty).toBeDefined();
    expect(p.comparison.length).toBeGreaterThan(0);
  });

  it('a profile is not available for an unknown code or a name-only key', () => {
    expect(dealerExists(data, 'no-such-dealer')).toBe(false);
    expect(dealerExists(data, 'name:jitesh traders')).toBe(false);
  });

  it('Nanaksar, Just Bicycle and Upper Assam ordered only through the Dealer App: DataSense shows 0 in the profile too, with the same figures as the table', () => {
    const res = buildComparison(data, ALL_PERIOD, defaultSettings);
    const table = comparisonRows(res);
    for (const key of ['3117', '3167', '12186']) {
      const p = buildDealerProfile(data, key, ALL_PERIOD, defaultSettings);
      const row = table.find((r) => r.key === key);
      const line = (id: string) => p.comparison.find((l) => l.id === id);
      expect(p.ordersOnlyViaDealerApp).toBe(true);
      expect(['orders', 'value', 'qty', 'aov', 'asp', 'rej', 'compl'].map((id) => line(id)?.ds)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(line('orders')?.dealer).toBe(row?.appOrders);
      expect(line('value')?.dealer).toBeCloseTo(row?.appValue as number, 2);
      // an average of zero orders is shown as 0 but is never compared with the other system
      expect(line('aov')?.diff).toEqual({ abs: null, pct: null });
    }
    // a dealer that ordered through both systems is not flagged
    expect(buildDealerProfile(data, '14554', ALL_PERIOD, defaultSettings).ordersOnlyViaDealerApp).toBe(false);
    // and a dealer that is not on the Dealer App keeps dashes on the Dealer App side
    const ds = res.rows.find((r) => r.match === 'ds_only');
    const q = buildDealerProfile(data, ds?.key as string, ALL_PERIOD, defaultSettings);
    expect(q.comparison.find((l) => l.id === 'orders')?.dealer).toBeNull();
  });

  it('the profile side-by-side equals the comparison table row; all-period totals can be larger', () => {
    const res = buildComparison(data, ALL_PERIOD, defaultSettings);
    const row = comparisonRows(res).find((r) => r.key === '14554');
    const p = buildDealerProfile(data, '14554', ALL_PERIOD, defaultSettings);
    const line = (id: string) => p.comparison.find((l) => l.id === id);
    // like-for-like: only the months in which both systems have data (Sep–Oct)
    expect(p.commonMonths).toEqual(['2026-09', '2026-10']);
    expect(line('orders')?.dealer).toBe(row?.appOrders);
    expect(line('orders')?.ds).toBe(row?.salesOrders);
    expect(line('value')?.dealer).toBeCloseTo(row?.appValue as number, 2);
    expect(line('value')?.ds).toBeCloseTo(row?.salesValue as number, 2);
    // the DataSense file also covers August, so the dealer's all-period count is higher than the compared one
    expect(p.ds.kpis.eligible).toBeGreaterThan(row?.salesOrders as number);
  });
});

describe('links and URL filters', () => {
  it('pageLink writes filters and labels in the address format the pages read', () => {
    const url = pageLink('/issues', { kpi: ['open', 'Open'], platform: 'Dealer App' }, { tab: 'register' });
    expect(url).toBe('/issues?f.kpi=open&l.kpi=Open&f.platform=Dealer+App&tab=register');
    const q = new URL(url, 'http://x').searchParams;
    const { filters, labels } = parseFilters(q);
    expect(filters).toEqual({ kpi: ['open'], platform: ['Dealer App'] });
    expect(labels).toEqual({ kpi: ['Open'], platform: ['Dealer App'] });
  });

  it('several values of one dimension travel as repeated parameters, each with its label, and read back in order', () => {
    const url = pageLink('/dealer/orders', { dealer: { values: ['10061', '19100', '3167'], labels: ['Alpha · 10061', 'Beta · 19100', 'Gamma · 3167'] } });
    expect(url).toBe('/dealer/orders?f.dealer=10061&f.dealer=19100&f.dealer=3167&l.dealer=Alpha+%C2%B7+10061&l.dealer=Beta+%C2%B7+19100&l.dealer=Gamma+%C2%B7+3167');
    const { filters, labels } = parseFilters(new URL(url, 'http://x').searchParams);
    expect(filters.dealer).toEqual(['10061', '19100', '3167']);
    expect(labels.dealer).toEqual(['Alpha · 10061', 'Beta · 19100', 'Gamma · 3167']);
    // labels that equal their values are left out of the address, and an empty selection writes nothing
    expect(pageLink('/x', { month: { values: ['2026-09', '2026-10'] } })).toBe('/x?f.month=2026-09&f.month=2026-10');
    expect(pageLink('/x', { month: { values: [] } })).toBe('/x');
  });

  it('no filters means a plain path', () => {
    expect(pageLink('/hero-smiles')).toBe('/hero-smiles');
  });

  it('dealerLink adds the profile parameters', () => {
    expect(dealerLink('/dealer/orders', '14554', 'orders')).toBe('/dealer/orders?dealer=14554&dtab=orders');
    expect(dealerLink('/dealer/orders', '14554')).toBe('/dealer/orders?dealer=14554');
  });

  it('parseFilters drops labels that have no filter and defaults a missing label to the value', () => {
    const { filters, labels } = parseFilters(new URLSearchParams('f.status=open&l.status=Open&l.orphan=x&f.zone=West'));
    expect(filters).toEqual({ status: ['open'], zone: ['West'] });
    expect(labels).toEqual({ status: ['Open'], zone: ['West'] });
  });

  it('only ERP codes count as validated dealer keys', () => {
    expect(isValidatedDealerKey('14554')).toBe(true);
    expect(isValidatedDealerKey('name:jitesh traders')).toBe(false);
    expect(isValidatedDealerKey('')).toBe(false);
    expect(isValidatedDealerKey('0')).toBe(false);
    expect(isValidatedDealerKey(null)).toBe(false);
    expect(isValidatedDealerKey(undefined)).toBe(false);
  });
});
