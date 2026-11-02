// Dealer App vs DataSense comparison and dealer matching.
//
// Every dealer that appears in a system is known to both (the Dealer App dealers are also DataSense dealers). What
// differs is WHICH SYSTEM THEY PLACE ORDERS THROUGH, so the groups are decided by orders (any status) placed in the
// compared months, the months in which both systems have data (Sep and Oct 2026 in the supplied files):
//   matched      = orders placed through both the Dealer App and DataSense
//   dealer_only  = orders placed only through the Dealer App (no DataSense order in the compared months)
//   ds_only      = orders placed only through DataSense
// The figures are compared on those same months only, so a dealer that ordered through DataSense in August and moved
// to the Dealer App in September shows DataSense zero for the compared months rather than a mix of different months.
//
// MATCHING RULES (in priority order):
//  1. Validated common identifier: Dealer App Outlet_ERP_ID == the [code] in DataSense dealer names
//     (== Capillary customer_external_ID). Exact match -> "matched", High confidence.
//  2. Manual crosswalk decisions made on the Match Review panel (persisted).
//  3. Normalised name equality is ONLY a review candidate; it is never merged automatically.
import type { AppData, ComplaintRec, OrderSummary, Settings } from '../types';
import { buildDealerOrders, dsOrderSummaries, orderKpis } from './orders';
import { Period, dateInPeriod, monthInPeriod } from './period';
import { latestPointsByDealer } from './loyalty';
import { isTestRecord } from './complaints';
import { normName, titleCase } from '../util/parse';

export type CrosswalkDecision = { dsKey: string; decision: 'accepted' | 'rejected' };
export type Crosswalk = Record<string, CrosswalkDecision[]>; // key: Dealer App dealer key

export interface CompareSide {
  orders: number;
  grossOrders: number;
  value: number;
  qty: number;
  aov: number | null;
  asp: number | null;
  fulfilmentRate: number | null;
  billedRate: number | null;
  rejected: number;
  complaints: number;
}

export interface Diff {
  abs: number | null;
  pct: number | null;
}

export interface CompareRow {
  key: string;
  name: string;
  match: 'matched' | 'dealer_only' | 'ds_only';
  /** a Dealer App dealer (placed a Dealer App order in the selected period), whichever system it orders through */
  onDealerApp: boolean;
  confidence: string;
  /** Dealer App Outlet_ID (Bizom outlet) */
  outletId: string | null;
  /** DataSense dealer code (same ERP code as the key unless a manual crosswalk was used) */
  dsCode: string | null;
  erpCode: string;
  dealer: CompareSide;
  ds: CompareSide;
  loyaltyPoints: number | null;
  diffs: { orders: Diff; value: Diff; qty: Diff; aov: Diff; asp: Diff; complaints: Diff };
  flags: string[];
  crosswalked: boolean;
}

export interface MatchCandidate {
  dealerKey: string;
  dealerName: string;
  dsKey: string;
  dsName: string;
  dsOrders: number;
  reason: string;
  ambiguous: boolean;
  decision: 'accepted' | 'rejected' | null;
}

export interface CompareResult {
  rows: CompareRow[];
  months: string[];
  note: string | null;
  counts: { common: number; dealerOnly: number; dsOnly: number };
  /** totals over the COMMON (matched) dealers */
  common: { dealer: CompareSide; ds: CompareSide };
  /** totals for the whole population of each system in the effective period */
  all: { dealer: CompareSide; ds: CompareSide };
  candidates: MatchCandidate[];
  nameCollisions: Array<{ name: string; keys: string[] }>;
  baseline: 'dealer' | 'ds';
  /** whether each complaint export was imported (a missing export means "unavailable", not zero complaints) */
  complaintData: { dealer: boolean; ds: boolean };
  /** whether Hero Smiles snapshots were imported */
  loyaltyData: boolean;
}

const emptySide = (): CompareSide => ({ orders: 0, grossOrders: 0, value: 0, qty: 0, aov: null, asp: null, fulfilmentRate: null, billedRate: null, rejected: 0, complaints: 0 });

function sideOf(orders: OrderSummary[], complaints: number, opts: Pick<Settings, 'includeRejected'>, sys: 'dealer' | 'ds'): CompareSide {
  if (orders.length === 0) return { ...emptySide(), complaints };
  const k = orderKpis(orders, opts, sys);
  return { orders: k.eligible, grossOrders: k.gross, value: k.eligibleValue, qty: k.qty, aov: k.aov, asp: k.asp, fulfilmentRate: k.fulfilmentRate, billedRate: k.billedRate, rejected: k.rejected, complaints };
}

export function diffOf(candidate: number | null, baseline: number | null): Diff {
  if (candidate === null || baseline === null) return { abs: null, pct: null };
  const abs = candidate - baseline;
  return { abs, pct: baseline !== 0 ? abs / baseline : null };
}

export function dealerMonths(data: AppData): string[] {
  return [...new Set(data.dealerLines.map((l) => l.month).filter(Boolean) as string[])].sort();
}
export function dsMonths(data: AppData): string[] {
  return [...new Set(data.dsOrders.map((o) => o.month).filter(Boolean) as string[])].sort();
}

/** Distinct complaint/ticket identifiers per dealer: an id is counted once even if its row were repeated. */
function countBy(complaints: ComplaintRec[], months: Set<string>, period: Period, keyOf: (k: string) => string, includeTest: boolean): Map<string, number> {
  const ids = new Map<string, Set<string>>();
  for (const c of complaints) {
    if (!c.dealerKey || !c.month || !months.has(c.month) || !dateInPeriod(c.raisedDate, period)) continue;
    if (!includeTest && isTestRecord(c)) continue;
    const k = keyOf(c.dealerKey);
    const set = ids.get(k) ?? new Set<string>();
    set.add(c.id);
    ids.set(k, set);
  }
  return new Map([...ids.entries()].map(([k, v]) => [k, v.size]));
}

export function buildComparison(data: AppData, period: Period, settings: Pick<Settings, 'includeRejected' | 'comparisonBaseline'> & Partial<Pick<Settings, 'includeTestAccounts'>>, crosswalk: Crosswalk = {}): CompareResult {
  const dm = dealerMonths(data);
  const sm = dsMonths(data);
  const months = dm.filter((m) => sm.includes(m) && monthInPeriod(m, period)).sort();
  const monthSet = new Set(months);
  let note: string | null = null;
  if (dm.length === 0 || sm.length === 0) note = `Both systems are needed for this comparison; ${dm.length === 0 ? 'Dealer App orders' : 'DataSense orders'} are not imported.`;
  else if (months.length === 0) note = 'The selected period has no months in which both systems have data.';
  else {
    const dropped = [...new Set([...dm, ...sm])].filter((m) => !monthSet.has(m) && monthInPeriod(m, period)).sort();
    if (dropped.length) note = `Compared on months where both systems have data (${months.join(', ')}). Months with data in only one system (${dropped.join(', ')}) are excluded.`;
  }

  // crosswalk aliases: DataSense key -> Dealer App key
  const alias = new Map<string, string>();
  for (const [appKey, decisions] of Object.entries(crosswalk)) for (const d of decisions) if (d.decision === 'accepted') alias.set(d.dsKey, appKey);
  const commonKey = (k: string) => alias.get(k) ?? k;

  const inRange = (o: OrderSummary) => !!o.month && monthSet.has(o.month) && dateInPeriod(o.date, period);
  const dealerOrders = buildDealerOrders(data.dealerLines).filter(inRange);
  const dsOrders = dsOrderSummaries(data.dsOrders).filter(inRange);

  const groupBy = (os: OrderSummary[], keyOf: (o: OrderSummary) => string | null) => {
    const m = new Map<string, OrderSummary[]>();
    for (const o of os) {
      const k = keyOf(o);
      if (!k) continue;
      const a = m.get(k);
      if (a) a.push(o);
      else m.set(k, [o]);
    }
    return m;
  };
  const dealerBy = groupBy(dealerOrders, (o) => o.dealerKey);
  const dsBy = groupBy(dsOrders, (o) => (o.dealerKey ? commonKey(o.dealerKey) : null));
  // the Dealer App dealers: a Dealer App order (any status, any month) in the selected period
  const inPeriod = (o: OrderSummary) => !!o.month && monthInPeriod(o.month, period) && dateInPeriod(o.date, period);
  const dealerPresent = new Set(buildDealerOrders(data.dealerLines).filter(inPeriod).map((o) => o.dealerKey).filter((k): k is string => !!k));
  const includeTest = settings.includeTestAccounts ?? false;
  const dealerCompl = countBy(data.dealerComplaints, monthSet, period, (k) => k, includeTest);
  const dsCompl = countBy(data.dsComplaints, monthSet, period, commonKey, includeTest);
  const points = latestPointsByDealer(data);

  const names = new Map<string, string>();
  const outlets = new Map<string, string>();
  for (const l of data.dealerLines) {
    if (l.dealerKey) {
      names.set(l.dealerKey, l.outletName);
      outlets.set(l.dealerKey, l.outletId);
    }
  }
  const dsNames = new Map<string, string>();
  for (const o of data.dsOrders) if (o.dealerKey) dsNames.set(o.dealerKey, o.dealerName);

  const keys = new Set<string>([...dealerPresent, ...dsBy.keys()]);
  const rows: CompareRow[] = [];
  const base = settings.comparisonBaseline;
  keys.forEach((k) => {
    const dOrders = dealerBy.get(k) ?? [];
    const sOrders = dsBy.get(k) ?? [];
    const dealer = sideOf(dOrders, dealerCompl.get(k) ?? 0, settings, 'dealer');
    const ds = sideOf(sOrders, dsCompl.get(k) ?? 0, settings, 'ds');
    // who placed orders (any status) in the compared months
    const viaApp = dOrders.length > 0;
    const viaDs = sOrders.length > 0;
    const match: CompareRow['match'] = viaApp && viaDs ? 'matched' : viaDs ? 'ds_only' : 'dealer_only';
    const crosswalked = [...alias.entries()].some(([dsKey, appKey]) => appKey === k && sOrders.some((o) => o.dealerKey === dsKey));
    const flags: string[] = [];
    if (match === 'dealer_only') flags.push(viaApp ? 'Orders only placed through the Dealer App' : 'No orders in the compared months');
    if (match === 'ds_only' && dealerPresent.has(k)) flags.push('Orders only placed through DataSense');
    const [cand, basel] = base === 'dealer' ? [ds, dealer] : [dealer, ds];
    rows.push({
      key: k,
      name: names.get(k) ?? titleCase((dsNames.get(k) ?? k).toLowerCase()),
      match,
      onDealerApp: dealerPresent.has(k),
      confidence: match !== 'matched' ? '—' : crosswalked ? 'Manual crosswalk (reviewed)' : 'High: exact ERP code in both systems',
      outletId: outlets.get(k) ?? null,
      dsCode: match === 'dealer_only' ? null : crosswalked ? [...alias.entries()].find(([, a]) => a === k)?.[0] ?? k : k,
      erpCode: k,
      dealer,
      ds,
      loyaltyPoints: points.get(k) ?? null,
      diffs: {
        orders: diffOf(cand.orders, basel.orders),
        value: diffOf(cand.value, basel.value),
        qty: diffOf(cand.qty, basel.qty),
        aov: diffOf(cand.aov, basel.aov),
        asp: diffOf(cand.asp, basel.asp),
        complaints: diffOf(cand.complaints, basel.complaints),
      },
      flags,
      crosswalked,
    });
  });
  rows.sort((a, b) => Math.max(b.dealer.value, b.ds.value) - Math.max(a.dealer.value, a.ds.value));

  const common = rows.filter((r) => r.match === 'matched');
  const sumSide = (rs: CompareSide[], sys: 'dealer' | 'ds'): CompareSide => {
    const t = emptySide();
    rs.forEach((s) => {
      t.orders += s.orders;
      t.grossOrders += s.grossOrders;
      t.value += s.value;
      t.qty += s.qty;
      t.rejected += s.rejected;
      t.complaints += s.complaints;
    });
    t.aov = t.orders ? t.value / t.orders : null;
    void sys;
    return t;
  };
  const commonDealer = sumSide(common.map((r) => r.dealer), 'dealer');
  const commonDs = sumSide(common.map((r) => r.ds), 'ds');
  // true ASP/fulfilment need order-level data: recompute on common dealers
  const commonKeys = new Set(common.map((r) => r.key));
  const cd = orderKpis(dealerOrders.filter((o) => o.dealerKey && commonKeys.has(o.dealerKey)), settings, 'dealer');
  const cs = orderKpis(dsOrders.filter((o) => o.dealerKey && commonKeys.has(commonKey(o.dealerKey))), settings, 'ds');
  commonDealer.asp = cd.asp;
  commonDealer.fulfilmentRate = cd.fulfilmentRate;
  commonDs.asp = cs.asp;
  commonDs.billedRate = cs.billedRate;
  const ad = orderKpis(dealerOrders, settings, 'dealer');
  const as = orderKpis(dsOrders, settings, 'ds');
  const allDealer: CompareSide = { orders: ad.eligible, grossOrders: ad.gross, value: ad.eligibleValue, qty: ad.qty, aov: ad.aov, asp: ad.asp, fulfilmentRate: ad.fulfilmentRate, billedRate: null, rejected: ad.rejected, complaints: [...dealerCompl.values()].reduce((a, b) => a + b, 0) };
  const allDs: CompareSide = { orders: as.eligible, grossOrders: as.gross, value: as.eligibleValue, qty: as.qty, aov: as.aov, asp: as.asp, fulfilmentRate: null, billedRate: as.billedRate, rejected: as.rejected, complaints: [...dsCompl.values()].reduce((a, b) => a + b, 0) };

  // ---- name candidates for dealers that exist only in one system (never auto-merged)
  const dsByName = new Map<string, Array<{ key: string; name: string }>>();
  dsNames.forEach((name, key) => {
    const n = normName(name);
    const a = dsByName.get(n) ?? [];
    a.push({ key, name });
    dsByName.set(n, a);
  });
  const candidates: MatchCandidate[] = [];
  const dsOrderCounts = new Map<string, number>();
  data.dsOrders.forEach((o) => o.dealerKey && dsOrderCounts.set(o.dealerKey, (dsOrderCounts.get(o.dealerKey) ?? 0) + 1));
  names.forEach((name, appKey) => {
    if (dsNames.has(appKey)) return; // already matched on the ERP code
    const hits = (dsByName.get(normName(name)) ?? []).filter((h) => h.key !== appKey);
    for (const h of hits) {
      const dec = (crosswalk[appKey] ?? []).find((d) => d.dsKey === h.key)?.decision ?? null;
      candidates.push({ dealerKey: appKey, dealerName: name, dsKey: h.key, dsName: h.name, dsOrders: dsOrderCounts.get(h.key) ?? 0, reason: 'Normalised dealer names are identical but the ERP codes differ.', ambiguous: hits.length > 1, decision: dec });
    }
  });

  // ---- DataSense names used by several different codes (why names are not a safe key)
  const collisions: Array<{ name: string; keys: string[] }> = [];
  dsByName.forEach((v, n) => v.length > 1 && collisions.push({ name: n, keys: v.map((x) => x.key) }));

  return {
    rows,
    months,
    note,
    counts: { common: common.length, dealerOnly: rows.filter((r) => r.match === 'dealer_only').length, dsOnly: rows.filter((r) => r.match === 'ds_only').length },
    common: { dealer: commonDealer, ds: commonDs },
    all: { dealer: allDealer, ds: allDs },
    candidates,
    nameCollisions: collisions,
    baseline: base,
    complaintData: { dealer: data.dealerComplaints.length > 0, ds: data.dsComplaints.length > 0 },
    loyaltyData: points.size > 0,
  };
}
