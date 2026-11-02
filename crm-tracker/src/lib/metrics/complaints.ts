// Complaint analytics (Dealer App and DataSense complaint modules).
//
// Definitions
//  - Total complaints      = distinct complaint records with a valid raised date inside the period.
//  - Resolved / closed     = status maps to "closed" (see the status maps in ingest/complaints.ts).
//  - Open backlog          = every status that is not closed or rejected.
//  - Resolution rate       = closed / total.
//  - Ageing (open only)    = as-of date - raised date, in days. As-of is the configurable report date.
//  - Turnaround (TAT)      = reported TAT (DataSense) where present, otherwise closed - raised; only for
//                            closed complaints. The Dealer App export has no closure date, so TAT is
//                            reported as unavailable for it, never as zero.
import type { ComplaintRec, ComplaintStatusGroup } from '../types';
import { Period, dateInPeriod } from './period';
import { daysBetween } from '../util/parse';

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatusGroup, string> = {
  open: 'Open',
  pending: 'Pending',
  in_process: 'In process',
  escalated: 'Escalated',
  closed: 'Closed',
  rejected: 'Rejected',
  unmapped: 'Unmapped status',
};

export const isTestRecord = (c: ComplaintRec) => c.flags.includes('test_record');

export function filterComplaints(recs: ComplaintRec[], period: Period): ComplaintRec[] {
  return recs.filter((c) => dateInPeriod(c.raisedDate, period));
}

/** Test records are excluded from KPIs by default (calculation assumptions → include test / service accounts). */
export function splitTestComplaints(recs: ComplaintRec[], includeTest: boolean): { kept: ComplaintRec[]; excluded: ComplaintRec[] } {
  if (includeTest) return { kept: recs, excluded: [] };
  return { kept: recs.filter((c) => !isTestRecord(c)), excluded: recs.filter(isTestRecord) };
}

export const isBacklog = (c: ComplaintRec) => c.statusGroup !== 'closed' && c.statusGroup !== 'rejected';

export function ageDays(c: ComplaintRec, asOf: string): number | null {
  if (!c.raisedDate) return null;
  const d = daysBetween(c.raisedDate, asOf);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}

export interface AgeBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export const AGE_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: '0–7 days', min: 0, max: 7 },
  { label: '8–15 days', min: 8, max: 15 },
  { label: '16–30 days', min: 16, max: 30 },
  { label: '31–60 days', min: 31, max: 60 },
  { label: '60+ days', min: 61, max: Infinity },
];

export interface ComplaintKpis {
  total: number;
  backlog: number;
  closed: number;
  rejected: number;
  unmapped: number;
  escalated: number;
  resolutionRate: number | null;
  backlogRate: number | null;
  avgTatHours: number | null;
  medianTatHours: number | null;
  tatCount: number;
  tatAvailable: boolean;
  avgAgeDays: number | null;
  oldestAgeDays: number | null;
  over30: number;
  ageBuckets: AgeBucket[];
  dealersAffected: number;
  withoutDealer: number;
  testRecords: number;
  repeatDealers: number;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function complaintKpis(recs: ComplaintRec[], asOf: string, excludedTest = 0): ComplaintKpis {
  const real = recs;
  const closed = real.filter((c) => c.statusGroup === 'closed');
  const backlog = real.filter(isBacklog);
  const tats = closed.map((c) => c.tatMinutes).filter((x): x is number => x !== null && Number.isFinite(x) && x >= 0);
  const ages = backlog.map((c) => ageDays(c, asOf)).filter((x): x is number => x !== null);
  const byDealer = new Map<string, number>();
  real.forEach((c) => c.dealerKey && byDealer.set(c.dealerKey, (byDealer.get(c.dealerKey) ?? 0) + 1));
  return {
    total: real.length,
    backlog: backlog.length,
    closed: closed.length,
    rejected: real.filter((c) => c.statusGroup === 'rejected').length,
    unmapped: real.filter((c) => c.statusGroup === 'unmapped').length,
    escalated: real.filter((c) => c.statusGroup === 'escalated').length,
    resolutionRate: real.length ? closed.length / real.length : null,
    backlogRate: real.length ? backlog.length / real.length : null,
    avgTatHours: tats.length ? tats.reduce((a, b) => a + b, 0) / tats.length / 60 : null,
    medianTatHours: tats.length ? (median(tats) as number) / 60 : null,
    tatCount: tats.length,
    tatAvailable: real.some((c) => c.tatMinutes !== null),
    avgAgeDays: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null,
    oldestAgeDays: ages.length ? Math.max(...ages) : null,
    over30: ages.filter((a) => a > 30).length,
    ageBuckets: AGE_BUCKETS.map((b) => ({ ...b, count: ages.filter((a) => a >= b.min && a <= b.max).length })),
    dealersAffected: byDealer.size,
    withoutDealer: real.filter((c) => !c.dealerKey).length,
    testRecords: excludedTest,
    repeatDealers: [...byDealer.values()].filter((n) => n > 1).length,
  };
}

export interface CountRow {
  key: string;
  label: string;
  count: number;
  closed: number;
  backlog: number;
  share: number;
}

export function countBy(recs: ComplaintRec[], keyOf: (c: ComplaintRec) => string | null, labelOf?: (k: string, rs: ComplaintRec[]) => string): CountRow[] {
  const by = new Map<string, ComplaintRec[]>();
  for (const c of recs) {
    const k = keyOf(c);
    if (k === null || k === undefined || k === '') continue;
    const a = by.get(k);
    if (a) a.push(c);
    else by.set(k, [c]);
  }
  const total = recs.length || 1;
  return [...by.entries()]
    .map(([key, rs]) => ({
      key,
      label: labelOf ? labelOf(key, rs) : key,
      count: rs.length,
      closed: rs.filter((c) => c.statusGroup === 'closed').length,
      backlog: rs.filter(isBacklog).length,
      share: rs.length / total,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function complaintsByMonth(recs: ComplaintRec[]): Array<{ month: string; total: number; closed: number; backlog: number }> {
  const m = new Map<string, { total: number; closed: number; backlog: number }>();
  for (const c of recs) {
    if (!c.month) continue;
    const r = m.get(c.month) ?? { total: 0, closed: 0, backlog: 0 };
    r.total++;
    if (c.statusGroup === 'closed') r.closed++;
    if (isBacklog(c)) r.backlog++;
    m.set(c.month, r);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v }));
}

/** Top-N + "Other" so charts never exceed the categorical palette. */
export function topWithOther(rows: CountRow[], n: number): CountRow[] {
  if (rows.length <= n) return rows;
  const head = rows.slice(0, n);
  const rest = rows.slice(n);
  const count = rest.reduce((a, r) => a + r.count, 0);
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  head.push({ key: '__other', label: `Other (${rest.length})`, count, closed: rest.reduce((a, r) => a + r.closed, 0), backlog: rest.reduce((a, r) => a + r.backlog, 0), share: count / total });
  return head;
}

/** Normalises free-text categories so trivial spelling/case differences do not split a bar. */
export const catKey = (s: string | null) => (s ? s.trim().replace(/\s+/g, ' ') : null);
