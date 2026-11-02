// Everything the dealer profile shows, for ONE dealer, computed from the imported data with the same formulas as
// the dashboards (orderKpis, complaintKpis ...). A dealer is identified by its validated ERP dealer code
// (Dealer App Outlet_ERP_ID == DataSense [code] == Hero Smiles customer_external_ID); names are only labels and are
// never used to find a dealer's records. A manual crosswalk decision (accepted on the comparison page) adds the
// DataSense code the reviewer confirmed.
import type { AppData, ComplaintRec, OrderSummary, Settings } from '../types';
import { buildDealerOrders, dsOrderSummaries, isEligible, orderKpis, uniqueSkuCount, OrderKpis } from './orders';
import { Period, dateInPeriod, monthInPeriod } from './period';
import { complaintKpis, ComplaintKpis, filterComplaints, splitTestComplaints } from './complaints';
import { dealerSeries, latestValidSnapshot, snapshotsOf } from './loyalty';
import { dealerMonths, dsMonths, diffOf, Diff, Crosswalk } from './comparison';
import { asOfOf } from './issues';
import { titleCase } from '../util/parse';

export interface DealerIdentity {
  key: string;
  /** best label: Dealer App outlet name, else DataSense dealer name, else Hero Smiles firm name */
  name: string;
  /** Dealer App Outlet_ID */
  outletId: string | null;
  /** ERP / DB code (the validated key) */
  dbCode: string;
  /** DataSense codes that map to this dealer (the key itself, plus any accepted crosswalk code) */
  dsCodes: string[];
  warehouse: string | null;
  zone: string | null;
  city: string | null;
  inDealerApp: boolean;
  inDataSense: boolean;
  inLoyalty: boolean;
}

export interface SideSummary {
  kpis: OrderKpis;
  orders: OrderSummary[];
  firstOrder: string | null;
  lastOrder: string | null;
  activeMonths: number;
  complaints: ComplaintKpis;
  complaintRecs: ComplaintRec[];
}

export interface MonthPoint {
  month: string;
  dealerValue: number | null;
  dealerOrders: number | null;
  dsValue: number | null;
  dsOrders: number | null;
}

export interface MetricLine {
  id: string;
  label: string;
  dealer: number | null;
  ds: number | null;
  fmt: 'int' | 'inr' | 'pct';
  diff: Diff;
}

export interface LoyaltyView {
  snapshotDate: string | null;
  current: number | null;
  lifetime: number | null;
  issued: number | null;
  expired: number | null;
  opening: number | null;
  /** the Capillary export has no quiz-points field */
  quizPoints: null;
  series: Array<{ date: string; current: number | null; lifetime: number | null; issued: number | null }>;
  firmName: string | null;
}

export interface EmployeeContribution {
  employee: string;
  role: string | null;
  orders: number;
  value: number;
  lastOrder: string | null;
}

export interface DealerProfileData {
  identity: DealerIdentity;
  dealerApp: SideSummary;
  ds: SideSummary;
  months: MonthPoint[];
  loyalty: LoyaltyView;
  skusOrdered: number | null;
  employees: EmployeeContribution[];
  /** months in which both systems have data in the selected period; the like-for-like window */
  commonMonths: string[];
  comparison: MetricLine[];
  /** true when the dealer is on the Dealer App and placed no DataSense order in the like-for-like months */
  ordersOnlyViaDealerApp: boolean;
  asOf: string;
}

/** True when the dealer code appears anywhere in the imported data. */
export function dealerExists(data: AppData, key: string): boolean {
  return data.dealerLines.some((l) => l.dealerKey === key) || data.dsOrders.some((o) => o.dealerKey === key) || data.loyalty.some((l) => l.entityKey === key && l.idKind === 'verified') || data.dsComplaints.some((c) => c.dealerKey === key) || data.dealerComplaints.some((c) => c.dealerKey === key);
}

function side(orders: OrderSummary[], complaints: ComplaintRec[], settings: Settings, sys: 'dealer' | 'ds', asOf: string, excluded: number): SideSummary {
  const dates = orders.map((o) => o.date).filter((d): d is string => !!d).sort();
  return {
    kpis: orderKpis(orders, settings, sys),
    orders,
    firstOrder: dates[0] ?? null,
    lastOrder: dates[dates.length - 1] ?? null,
    activeMonths: new Set(orders.filter((o) => isEligible(o, settings)).map((o) => o.month).filter(Boolean)).size,
    complaints: complaintKpis(complaints, asOf, excluded),
    complaintRecs: complaints,
  };
}

/** distinct complaint identifiers (a ticket id is counted once even if its row were repeated) */
export function distinctComplaints(recs: ComplaintRec[]): ComplaintRec[] {
  const seen = new Set<string>();
  const out: ComplaintRec[] = [];
  for (const c of recs) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export function buildDealerProfile(data: AppData, key: string, period: Period, settings: Settings, crosswalk: Crosswalk = {}): DealerProfileData {
  const asOf = asOfOf(settings.asOfDate);
  const dsCodes = [key, ...(crosswalk[key] ?? []).filter((d) => d.decision === 'accepted').map((d) => d.dsKey)];
  const dsSet = new Set(dsCodes);

  const lines = data.dealerLines.filter((l) => l.dealerKey === key);
  const dealerOrdersAll = buildDealerOrders(lines);
  const dsOrdersRaw = data.dsOrders.filter((o) => o.dealerKey !== null && dsSet.has(o.dealerKey));
  const dsOrdersAll = dsOrderSummaries(dsOrdersRaw);
  const dealerOrders = dealerOrdersAll.filter((o) => dateInPeriod(o.date, period));
  const dsOrders = dsOrdersAll.filter((o) => dateInPeriod(o.date, period));

  const dCs = splitTestComplaints(filterComplaints(data.dealerComplaints.filter((c) => c.dealerKey === key), period), settings.includeTestAccounts);
  const sCs = splitTestComplaints(filterComplaints(data.dsComplaints.filter((c) => c.dealerKey !== null && dsSet.has(c.dealerKey)), period), settings.includeTestAccounts);
  const dRecs = distinctComplaints(dCs.kept);
  const sRecs = distinctComplaints(sCs.kept);

  const dealerApp = side(dealerOrders, dRecs, settings, 'dealer', asOf, dCs.excluded.length);
  const ds = side(dsOrders, sRecs, settings, 'ds', asOf, sCs.excluded.length);

  // ---- identity
  const first = lines[0];
  const dsFirst = dsOrdersRaw[0];
  const snaps = snapshotsOf(data);
  const loyaltyRows = snaps.flatMap((s) => s.rows.filter((r) => r.idKind === 'verified' && r.entityKey === key));
  const name = first?.outletName ? titleCase(first.outletName.toLowerCase()) : dsFirst?.dealerName ? titleCase(dsFirst.dealerName.toLowerCase()) : loyaltyRows[loyaltyRows.length - 1]?.firmName ? titleCase(loyaltyRows[loyaltyRows.length - 1].firmName.toLowerCase()) : sRecs[0]?.dealerName ? titleCase((sRecs[0].dealerName as string).toLowerCase()) : dRecs[0]?.dealerName ? titleCase((dRecs[0].dealerName as string).toLowerCase()) : key;
  const identity: DealerIdentity = {
    key,
    name,
    outletId: first?.outletId ?? null,
    dbCode: key,
    dsCodes,
    warehouse: first?.warehouse ?? null,
    zone: first?.zone ?? null,
    city: first?.city ?? dsFirst?.city ?? null,
    inDealerApp: lines.length > 0,
    inDataSense: dsOrdersRaw.length > 0,
    inLoyalty: loyaltyRows.length > 0,
  };

  // ---- monthly activity (selected period)
  const monthSet = new Set<string>();
  dealerOrders.forEach((o) => o.month && monthSet.add(o.month));
  dsOrders.forEach((o) => o.month && monthSet.add(o.month));
  const months: MonthPoint[] = [...monthSet].sort().map((m) => {
    const dm = dealerOrders.filter((o) => o.month === m);
    const sm = dsOrders.filter((o) => o.month === m);
    const dk = dm.length ? orderKpis(dm, settings, 'dealer') : null;
    const sk = sm.length ? orderKpis(sm, settings, 'ds') : null;
    return { month: m, dealerValue: dk ? dk.eligibleValue : null, dealerOrders: dk ? dk.eligible : null, dsValue: sk ? sk.eligibleValue : null, dsOrders: sk ? sk.eligible : null };
  });

  // ---- loyalty: latest valid snapshot (point-in-time), history per snapshot
  const latest = latestValidSnapshot(snaps);
  const lrow = latest?.rows.find((r) => r.idKind === 'verified' && r.entityKey === key) ?? null;
  const loyalty: LoyaltyView = {
    snapshotDate: latest?.date ?? null,
    current: lrow?.current ?? null,
    lifetime: lrow?.lifetime ?? null,
    issued: lrow?.issued ?? null,
    expired: lrow?.expired ?? null,
    opening: lrow?.opening ?? null,
    quizPoints: null,
    series: dealerSeries(snaps, key),
    firmName: lrow?.firmName ?? null,
  };

  // ---- activity
  const eligibleIds = new Set(dealerOrders.filter((o) => isEligible(o, settings)).map((o) => o.orderId));
  const skusOrdered = lines.length ? uniqueSkuCount(lines, eligibleIds) : null;
  const byEmp = new Map<string, EmployeeContribution>();
  for (const o of dsOrders.filter((x) => isEligible(x, settings))) {
    const e = o.employee ?? 'Not specified';
    const cur = byEmp.get(e) ?? { employee: e, role: o.role ?? null, orders: 0, value: 0, lastOrder: null };
    cur.orders += 1;
    cur.value += o.value ?? 0;
    if (o.date && (!cur.lastOrder || o.date > cur.lastOrder)) cur.lastOrder = o.date;
    byEmp.set(e, cur);
  }
  const employees = [...byEmp.values()].sort((a, b) => b.value - a.value);

  // ---- like-for-like comparison: months where BOTH systems have data (any dealer), inside the period
  const dm = dealerMonths(data);
  const sm = dsMonths(data);
  const commonMonths = dm.filter((m) => sm.includes(m) && monthInPeriod(m, period)).sort();
  const cset = new Set(commonMonths);
  const dC = dealerOrders.filter((o) => o.month && cset.has(o.month));
  const sC = dsOrders.filter((o) => o.month && cset.has(o.month));
  const dk = orderKpis(dC, settings, 'dealer');
  const sk = orderKpis(sC, settings, 'ds');
  const dCompl = dRecs.filter((c) => c.month && cset.has(c.month)).length;
  const sCompl = sRecs.filter((c) => c.month && cset.has(c.month)).length;
  const base = settings.comparisonBaseline;
  const has = (os: OrderSummary[]) => os.length > 0;
  // A Dealer App dealer that placed no order through a system in the like-for-like months recorded zero there: the
  // side shows 0 (and 0 for the averages) instead of a dash. A dealer that is not on the Dealer App has no Dealer App side.
  const zeroDs = identity.inDealerApp && has(dC) && !has(sC);
  const zeroApp = identity.inDealerApp && has(sC) && !has(dC);
  const pickSide = (os: OrderSummary[], zero: boolean, v: number | null): number | null => (has(os) ? v : zero ? 0 : null);
  const mk = (id: string, label: string, a: number | null, b: number | null, fmt: MetricLine['fmt'], noDiff = false): MetricLine => ({ id, label, dealer: a, ds: b, fmt, diff: noDiff ? { abs: null, pct: null } : base === 'dealer' ? diffOf(b, a) : diffOf(a, b) });
  const comparison: MetricLine[] = [
    mk('orders', 'Eligible orders', pickSide(dC, zeroApp, dk.eligible), pickSide(sC, zeroDs, sk.eligible), 'int'),
    mk('value', 'Order value', pickSide(dC, zeroApp, dk.eligibleValue), pickSide(sC, zeroDs, sk.eligibleValue), 'inr'),
    mk('qty', 'Cycles quantity', pickSide(dC, zeroApp, dk.qty), pickSide(sC, zeroDs, sk.qty), 'int'),
    // averages of zero orders are shown as 0 for the zero side but are not compared
    mk('aov', 'Average order value', pickSide(dC, zeroApp, dk.aov), pickSide(sC, zeroDs, sk.aov), 'inr', zeroDs || zeroApp),
    mk('asp', 'Average selling price (cycles)', pickSide(dC, zeroApp, dk.asp), pickSide(sC, zeroDs, sk.asp), 'inr', zeroDs || zeroApp),
    mk('rej', 'Rejected orders', pickSide(dC, zeroApp, dk.rejected), pickSide(sC, zeroDs, sk.rejected), 'int'),
    mk('compl', 'Complaints', identity.inDealerApp || dCompl ? dCompl : null, identity.inDataSense || sCompl || zeroDs ? sCompl : null, 'int'),
  ];

  return { identity, dealerApp, ds, months, loyalty, skusOrdered, employees, commonMonths, comparison, ordersOnlyViaDealerApp: zeroDs, asOf };
}
