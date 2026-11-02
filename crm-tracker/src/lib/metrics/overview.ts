// Building blocks of the Executive Overview. Every function is a view over the same metric functions the detail pages use,
// so a number on the Overview can never differ from the number behind it.
import type { AppData, OrderSummary, Settings, UsageRec } from '../types';
import { OrderKpis, orderKpis } from './orders';
import { Period } from './period';
import { Change, changeOf, comparableWindows, monthCompleteFn } from './windows';
import { Snapshot, SnapshotTotals, changesBetween, isValidSnapshot, snapshotTotals, snapshotsOf, DealerChange } from './loyalty';
import { usageByMonth } from './bizom';
import { isValidatedDealerKey } from '../nav/links';
import { titleCase } from '../util/parse';

export const dealerKeyOfOrder = (o: OrderSummary) => o.dealerKey ?? `name:${o.dealerName}`;

export interface OrderTrend {
  value: Change | null;
  orders: Change | null;
  aov: Change | null;
  /** what the change is measured against, e.g. "Aug 2026" */
  vs: string;
}

/**
 * Change of the selected period against the equally long period before it. Null (no trend shown) unless the period is
 * whole months and every month of both windows is present and complete in this system's files.
 */
export function orderTrend(all: OrderSummary[], system: 'dealer' | 'ds', period: Period, settings: Pick<Settings, 'includeRejected'>, data: AppData, asOf: string): OrderTrend | null {
  const present = new Set(all.map((o) => o.month).filter(Boolean) as string[]);
  const w = comparableWindows(period, (m) => present.has(m), monthCompleteFn(data, [system === 'dealer' ? 'dealer_orders' : 'ds_orders'], asOf));
  if (!w) return null;
  const ofMonths = (ms: string[]) => orderKpis(all.filter((o) => !!o.month && ms.includes(o.month)), settings, system);
  const cur = ofMonths(w.cur);
  const prev = ofMonths(w.prev);
  return { value: changeOf(prev.eligibleValue, cur.eligibleValue), orders: changeOf(prev.eligible, cur.eligible), aov: changeOf(prev.aov, cur.aov), vs: w.prevLabel };
}

export interface UsageTrend {
  accesses: Change | null;
  users: Change | null;
  vs: string;
}

export function usageTrend(all: UsageRec[], period: Period, data: AppData, asOf: string): UsageTrend | null {
  const present = new Set(all.map((u) => u.month));
  const w = comparableWindows(period, (m) => present.has(m), monthCompleteFn(data, ['bizom_usage'], asOf));
  if (!w) return null;
  const ofMonths = (ms: string[]) => {
    const rows = usageByMonth(all.filter((u) => ms.includes(u.month)));
    const users = new Set(all.filter((u) => ms.includes(u.month) && u.accessCount > 0).map((u) => u.userId));
    return { accesses: rows.reduce((a, r) => a + r.accesses, 0), users: users.size };
  };
  const cur = ofMonths(w.cur);
  const prev = ofMonths(w.prev);
  return { accesses: changeOf(prev.accesses, cur.accesses), users: changeOf(prev.users, cur.users), vs: w.prevLabel };
}

export interface MonthOrders {
  month: string;
  value: number;
  orders: number;
  aov: number | null;
  qty: number;
  k: OrderKpis;
}

export function ordersByMonth(orders: OrderSummary[], system: 'dealer' | 'ds', settings: Pick<Settings, 'includeRejected'>): MonthOrders[] {
  const by = new Map<string, OrderSummary[]>();
  for (const o of orders) if (o.month) by.set(o.month, [...(by.get(o.month) ?? []), o]);
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, os]) => {
      const k = orderKpis(os, settings, system);
      return { month, value: k.eligibleValue, orders: k.eligible, aov: k.aov, qty: k.qty, k };
    });
}

/** Dealers with at least one eligible order, by validated ERP code. A name-only dealer cannot be matched across systems and is not counted twice. */
export function activeDealers(dealerOrders: OrderSummary[], dsOrders: OrderSummary[], settings: Pick<Settings, 'includeRejected'>) {
  const keys = (os: OrderSummary[]) => new Set(os.filter((o) => o.dealerKey && (o.value ?? 0) > 0 && (settings.includeRejected || o.statusGroup !== 'rejected')).map((o) => o.dealerKey as string));
  const a = keys(dealerOrders);
  const b = keys(dsOrders);
  const both = [...a].filter((k) => b.has(k)).length;
  return { total: new Set([...a, ...b]).size, dealerApp: a.size, ds: b.size, both, dealerOnly: a.size - both, dsOnly: b.size - both };
}

export interface LoyaltyOverview {
  latest: Snapshot;
  latestTotals: SnapshotTotals;
  previous: Snapshot | null;
  previousTotals: SnapshotTotals | null;
  /** change in total current points between the two latest valid snapshots (a difference of two point-in-time positions) */
  points: Change | null;
  members: Change | null;
  movers: DealerChange[];
  /** one total per valid snapshot, oldest first: a series of point-in-time positions, never added together */
  series: Array<{ date: string; current: number }>;
  /** dealers with the largest balances in the latest snapshot (verified dealer codes only) */
  top: Array<{ key: string; label: string; value: number }>;
  /** the biggest gains and falls since the previous snapshot, ready for a bar chart */
  moverBars: Array<{ key: string; label: string; value: number; color: string }>;
}

const nice = (s: string) => titleCase(s.toLowerCase());

export function loyaltyOverview(data: AppData): LoyaltyOverview | null {
  const valid = snapshotsOf(data).filter(isValidSnapshot);
  const latest = valid[valid.length - 1];
  if (!latest) return null;
  const previous = valid.length > 1 ? valid[valid.length - 2] : null;
  const latestTotals = snapshotTotals(latest);
  const previousTotals = previous ? snapshotTotals(previous) : null;
  const movers = previous ? changesBetween(previous, latest).filter((c) => c.deltaCurrent !== null && c.deltaCurrent !== 0) : [];
  const named = movers.filter((c) => isValidatedDealerKey(c.entityKey));
  return {
    latest,
    latestTotals,
    previous,
    previousTotals,
    points: previousTotals ? changeOf(previousTotals.current, latestTotals.current) : null,
    members: previousTotals ? changeOf(previousTotals.positiveBalances, latestTotals.positiveBalances) : null,
    movers,
    series: valid.map((s) => ({ date: s.date, current: snapshotTotals(s).current })),
    top: latest.rows
      .filter((r) => r.idKind === 'verified' && isValidatedDealerKey(r.entityKey) && (r.current ?? 0) > 0)
      .sort((a, b) => (b.current ?? 0) - (a.current ?? 0))
      .slice(0, 10)
      .map((r) => ({ key: r.entityKey, label: nice(r.firmName || r.entityKey), value: r.current ?? 0 })),
    moverBars: [
      ...[...named].sort((a, b) => (b.deltaCurrent ?? 0) - (a.deltaCurrent ?? 0)).filter((c) => (c.deltaCurrent ?? 0) > 0).slice(0, 5).map((c) => ({ key: c.entityKey, label: nice(c.firmName || c.entityKey), value: c.deltaCurrent ?? 0, color: '#1baf7a' })),
      ...[...named].sort((a, b) => (a.deltaCurrent ?? 0) - (b.deltaCurrent ?? 0)).filter((c) => (c.deltaCurrent ?? 0) < 0).slice(0, 5).map((c) => ({ key: c.entityKey, label: nice(c.firmName || c.entityKey), value: c.deltaCurrent ?? 0, color: '#C8202F' })),
    ],
  };
}
