// Bizom SFA MIS usage analytics.
//
// The source records, per user and report, the number of times a report was ACCESSED ("Access_Count").
// That is a recorded access count, not a download count and not proof of business value, so every label
// and insight uses "recorded report accesses" and avoids causal claims.
import type { Insight, UsageRec } from '../types';
import { Period, monthInPeriod } from './period';
import { monthLabel } from '../util/parse';

export function filterUsage(recs: UsageRec[], period: Period): UsageRec[] {
  return recs.filter((u) => monthInPeriod(u.month, period));
}

export const isTestAccount = (u: UsageRec) => u.flags.includes('test_or_service_account');

/** Test / service accounts are excluded from KPIs by default (setting `includeTestAccounts`) but never deleted. */
export function splitTest(recs: UsageRec[], includeTest: boolean): { kept: UsageRec[]; excluded: UsageRec[] } {
  if (includeTest) return { kept: recs, excluded: [] };
  return { kept: recs.filter((u) => !isTestAccount(u)), excluded: recs.filter(isTestAccount) };
}

export interface UsageKpis {
  accesses: number;
  users: number;
  reports: number;
  rows: number;
  avgAccessesPerUser: number | null;
  avgReportsPerUser: number | null;
  months: number;
  fieldStaffShare: number | null;
  top5Share: number | null;
  singleUserReports: number;
  lowUsageReports: number;
  testAccounts: number;
}

export interface ReportRow {
  reportId: string;
  reportName: string;
  accesses: number;
  users: number;
  share: number;
  cumShare: number;
  months: number;
  type: string;
}

export interface UserRow {
  userId: string;
  name: string;
  designation: string;
  accountKind: UsageRec['accountKind'];
  zone: string | null;
  subzone: string | null;
  accesses: number;
  reports: number;
  months: number;
  share: number;
}

export function reportRanking(recs: UsageRec[]): ReportRow[] {
  const by = new Map<string, { id: string; name: string; type: string; accesses: number; users: Set<string>; months: Set<string> }>();
  for (const r of recs) {
    const k = r.reportName || r.reportId;
    const e = by.get(k) ?? { id: r.reportId, name: r.reportName, type: r.type, accesses: 0, users: new Set(), months: new Set() };
    e.accesses += r.accessCount;
    if (r.accessCount > 0) e.users.add(r.userId);
    e.months.add(r.month);
    by.set(k, e);
  }
  const total = [...by.values()].reduce((a, e) => a + e.accesses, 0) || 1;
  let cum = 0;
  return [...by.values()]
    .sort((a, b) => b.accesses - a.accesses || a.name.localeCompare(b.name))
    .map((e) => {
      cum += e.accesses;
      return { reportId: e.id, reportName: e.name, accesses: e.accesses, users: e.users.size, share: e.accesses / total, cumShare: cum / total, months: e.months.size, type: e.type };
    });
}

export function userRanking(recs: UsageRec[]): UserRow[] {
  const by = new Map<string, { r: UsageRec; accesses: number; reports: Set<string>; months: Set<string> }>();
  for (const r of recs) {
    const e = by.get(r.userId) ?? { r, accesses: 0, reports: new Set(), months: new Set() };
    e.accesses += r.accessCount;
    if (r.accessCount > 0) e.reports.add(r.reportName || r.reportId);
    e.months.add(r.month);
    by.set(r.userId, e);
  }
  const total = [...by.values()].reduce((a, e) => a + e.accesses, 0) || 1;
  return [...by.values()]
    .sort((a, b) => b.accesses - a.accesses || a.r.name.localeCompare(b.r.name))
    .map((e) => ({ userId: e.r.userId, name: e.r.name, designation: e.r.designation, accountKind: e.r.accountKind, zone: e.r.zone, subzone: e.r.subzone, accesses: e.accesses, reports: e.reports.size, months: e.months.size, share: e.accesses / total }));
}

export function usageKpis(recs: UsageRec[], lowThreshold: number, excluded: UsageRec[] = []): UsageKpis {
  const real = recs;
  const accesses = real.reduce((a, r) => a + r.accessCount, 0);
  const users = new Set(real.filter((r) => r.accessCount > 0).map((r) => r.userId));
  const reports = ranked(real);
  const field = real.filter((r) => r.accountKind === 'Field staff').reduce((a, r) => a + r.accessCount, 0);
  return {
    accesses,
    users: users.size,
    reports: reports.length,
    rows: real.length,
    avgAccessesPerUser: users.size ? accesses / users.size : null,
    avgReportsPerUser: users.size ? real.filter((r) => r.accessCount > 0).length / users.size : null,
    months: new Set(real.map((r) => r.month)).size,
    fieldStaffShare: accesses ? field / accesses : null,
    top5Share: reports.length ? reports.slice(0, 5).reduce((a, r) => a + r.share, 0) : null,
    singleUserReports: reports.filter((r) => r.users === 1).length,
    lowUsageReports: reports.filter((r) => r.accesses <= lowThreshold).length,
    testAccounts: new Set(excluded.map((r) => r.userId)).size,
  };
}
const ranked = (recs: UsageRec[]) => reportRanking(recs);

export interface GroupUsage {
  key: string;
  label: string;
  accesses: number;
  users: number;
  reports: number;
  share: number;
  accessesPerUser: number | null;
}

export function usageBy(recs: UsageRec[], keyOf: (u: UsageRec) => string | null): GroupUsage[] {
  const by = new Map<string, { accesses: number; users: Set<string>; reports: Set<string> }>();
  for (const r of recs) {
    const k = keyOf(r);
    if (!k) continue;
    const e = by.get(k) ?? { accesses: 0, users: new Set(), reports: new Set() };
    e.accesses += r.accessCount;
    if (r.accessCount > 0) {
      e.users.add(r.userId);
      e.reports.add(r.reportName || r.reportId);
    }
    by.set(k, e);
  }
  const total = [...by.values()].reduce((a, e) => a + e.accesses, 0) || 1;
  return [...by.entries()]
    .map(([key, e]) => ({ key, label: key, accesses: e.accesses, users: e.users.size, reports: e.reports.size, share: e.accesses / total, accessesPerUser: e.users.size ? e.accesses / e.users.size : null }))
    .sort((a, b) => b.accesses - a.accesses);
}

export interface MonthUsage {
  month: string;
  label: string;
  accesses: number;
  users: number;
  reports: number;
  momAccesses: number | null;
  momUsers: number | null;
}

export function usageByMonth(recs: UsageRec[]): MonthUsage[] {
  const by = new Map<string, { accesses: number; users: Set<string>; reports: Set<string> }>();
  for (const r of recs) {
    const e = by.get(r.month) ?? { accesses: 0, users: new Set(), reports: new Set() };
    e.accesses += r.accessCount;
    if (r.accessCount > 0) {
      e.users.add(r.userId);
      e.reports.add(r.reportName || r.reportId);
    }
    by.set(r.month, e);
  }
  const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return rows.map(([month, e], i) => {
    const prev = i > 0 ? rows[i - 1][1] : null;
    return {
      month,
      label: monthLabel(month),
      accesses: e.accesses,
      users: e.users.size,
      reports: e.reports.size,
      momAccesses: prev && prev.accesses ? (e.accesses - prev.accesses) / prev.accesses : null,
      momUsers: prev && prev.users.size ? (e.users.size - prev.users.size) / prev.users.size : null,
    };
  });
}

/** Report × month matrix for the heatmap/table. */
export function reportByMonth(recs: UsageRec[], topN = 15) {
  const months = [...new Set(recs.map((r) => r.month))].sort();
  const top = reportRanking(recs).slice(0, topN);
  const idx = new Map<string, Map<string, number>>();
  for (const r of recs) {
    const k = r.reportName || r.reportId;
    const m = idx.get(k) ?? new Map<string, number>();
    m.set(r.month, (m.get(r.month) ?? 0) + r.accessCount);
    idx.set(k, m);
  }
  return { months, rows: top.map((t) => ({ reportName: t.reportName, total: t.accesses, byMonth: months.map((m) => idx.get(t.reportName)?.get(m) ?? 0) })) };
}

export interface CohortChange {
  from: string;
  to: string;
  retained: number;
  newUsers: number;
  lostUsers: number;
  increased: number;
  decreased: number;
}

/** Who was active in `from` and not in `to` (and vice versa). Based on recorded accesses only. */
export function cohortChange(recs: UsageRec[], from: string, to: string): CohortChange {
  const tally = (m: string) => {
    const t = new Map<string, number>();
    recs.filter((r) => r.month === m).forEach((r) => t.set(r.userId, (t.get(r.userId) ?? 0) + r.accessCount));
    return new Map([...t].filter(([, v]) => v > 0));
  };
  const a = tally(from);
  const b = tally(to);
  let retained = 0;
  let inc = 0;
  let dec = 0;
  a.forEach((va, u) => {
    const vb = b.get(u);
    if (vb !== undefined) {
      retained++;
      if (vb > va) inc++;
      else if (vb < va) dec++;
    }
  });
  return { from, to, retained, newUsers: [...b.keys()].filter((u) => !a.has(u)).length, lostUsers: [...a.keys()].filter((u) => !b.has(u)).length, increased: inc, decreased: dec };
}

export function userNamesLost(recs: UsageRec[], from: string, to: string): UserRow[] {
  const inTo = new Set(recs.filter((r) => r.month === to && r.accessCount > 0).map((r) => r.userId));
  const lost = recs.filter((r) => r.month === from && r.accessCount > 0 && !inTo.has(r.userId));
  return userRanking(lost);
}

/** Cautiously worded behaviour observations. They describe recorded accesses; they do not explain why. */
export function usageInsights(recs: UsageRec[], lowThreshold: number): Insight[] {
  const out: Insight[] = [];
  const real = recs;
  if (!real.length) return out;
  const k = usageKpis(real, lowThreshold);
  const reports = reportRanking(real);
  const months = usageByMonth(real);
  if (reports.length >= 5 && k.top5Share !== null) {
    out.push({
      id: 'bizom-concentration',
      level: k.top5Share > 0.6 ? 'watch' : 'info',
      title: `Five reports account for ${(k.top5Share * 100).toFixed(0)}% of recorded accesses`,
      detail: `${reports.slice(0, 5).map((r) => r.reportName).join(', ')}. This shows where access is concentrated; it does not show which reports are most useful.`,
      to: '/bizom/usage',
    });
  }
  if (k.singleUserReports > 0) {
    out.push({ id: 'bizom-single-user', level: 'info', title: `${k.singleUserReports} of ${k.reports} reports were accessed by only one user`, detail: 'Reports with a single recorded user may be specialist reports or may be under-promoted. The data cannot tell which.', to: '/bizom/usage' });
  }
  if (k.lowUsageReports > 0) {
    out.push({ id: 'bizom-low', level: 'watch', title: `${k.lowUsageReports} reports have ${lowThreshold} or fewer recorded accesses in the period`, detail: `The threshold (${lowThreshold}) is a setting you can change. Low counts may reflect a recently added report, a niche audience or low awareness.`, to: '/bizom/usage' });
  }
  if (months.length >= 2) {
    const a = months[months.length - 2];
    const b = months[months.length - 1];
    if (a.accesses > 0) {
      const ch = (b.accesses - a.accesses) / a.accesses;
      out.push({
        id: 'bizom-mom',
        level: ch < -0.2 ? 'concern' : ch > 0.2 ? 'good' : 'info',
        title: `Recorded accesses ${ch >= 0 ? 'rose' : 'fell'} ${Math.abs(ch * 100).toFixed(0)}% from ${a.label} to ${b.label}`,
        detail: `${a.accesses.toLocaleString('en-IN')} → ${b.accesses.toLocaleString('en-IN')}. If ${b.label} is a part-month export, compare daily averages rather than totals.`,
        to: '/bizom/usage',
      });
      const c = cohortChange(real, a.month, b.month);
      if (c.lostUsers > 0) out.push({ id: 'bizom-lost', level: 'watch', title: `${c.lostUsers} users with recorded accesses in ${a.label} have none in ${b.label}`, detail: `${c.retained} users were active in both months and ${c.newUsers} were active only in ${b.label}.`, to: '/bizom/usage' });
    }
  }
  const kinds = usageBy(real, (u) => u.accountKind);
  const field = kinds.find((g) => g.key === 'Field staff');
  if (field && kinds.length > 1) out.push({ id: 'bizom-kinds', level: 'info', title: `Field staff recorded ${(field.share * 100).toFixed(0)}% of accesses`, detail: kinds.map((g) => `${g.key}: ${g.users} users, ${g.accesses.toLocaleString('en-IN')} accesses`).join(' · '), to: '/bizom/usage' });
  return out;
}
