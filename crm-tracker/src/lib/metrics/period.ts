// Reporting-period model. Options are generated from the months that the imported data actually
// covers, so the UI never offers a period the sources cannot support.
import type { AppData } from '../types';
import { monthEnd, monthLabel } from '../util/parse';

export interface Period {
  id: string;
  label: string;
  /** inclusive ISO bounds; null = unbounded */
  from: string | null;
  to: string | null;
}

export const ALL_PERIOD: Period = { id: 'all', label: 'All available data', from: null, to: null };

export function isBounded(p: Period): boolean {
  return p.from !== null || p.to !== null;
}

export function dateInPeriod(date: string | null | undefined, p: Period): boolean {
  if (!isBounded(p)) return true;
  if (!date) return false;
  const d = date.slice(0, 10);
  if (p.from && d < p.from) return false;
  if (p.to && d > p.to) return false;
  return true;
}

/** Month-level sources (usage, employee activity) are included when the month overlaps the period. */
export function monthInPeriod(month: string | null | undefined, p: Period): boolean {
  if (!isBounded(p)) return true;
  if (!month) return false;
  const start = `${month}-01`;
  const end = monthEnd(month);
  if (p.from && end < p.from) return false;
  if (p.to && start > p.to) return false;
  return true;
}

export function isPartialMonthRange(months: string[], p: Period): boolean {
  if (!isBounded(p)) return false;
  return months.some((m) => monthInPeriod(m, p) && ((p.from && p.from > `${m}-01`) || (p.to && p.to < monthEnd(m))));
}

/** Every month for which some dated source has data. */
export function availableMonths(data: AppData): string[] {
  const s = new Set<string>();
  data.dealerLines.forEach((l) => l.month && s.add(l.month));
  data.dsOrders.forEach((o) => o.month && s.add(o.month));
  data.dealerComplaints.forEach((c) => c.month && s.add(c.month));
  data.dsComplaints.forEach((c) => c.month && s.add(c.month));
  data.usage.forEach((u) => s.add(u.month));
  data.dsEmployees.forEach((e) => s.add(e.month));
  data.dealerSfa.forEach((e) => s.add(e.month));
  data.loyalty.forEach((l) => s.add(l.snapshotDate.slice(0, 7)));
  s.delete('unknown');
  return [...s].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
}

export function monthSpanLabel(a: string, b: string): string {
  if (a === b) return monthLabel(a);
  const [ya, ma] = a.split('-');
  const [yb, mb] = b.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return ya === yb ? `${names[+ma - 1]}–${names[+mb - 1]} ${ya}` : `${monthLabel(a)} – ${monthLabel(b)}`;
}

export function periodOptions(months: string[]): Period[] {
  const out: Period[] = [];
  if (months.length === 0) return [ALL_PERIOD];
  out.push({ ...ALL_PERIOD, label: months.length > 1 ? `All available (${monthSpanLabel(months[0], months[months.length - 1])})` : `All available (${monthLabel(months[0])})` });
  const recent = months.slice(-12);
  for (const m of recent) out.push({ id: m, label: monthLabel(m), from: `${m}-01`, to: monthEnd(m) });
  for (let len = 2; len <= recent.length; len++) {
    for (let i = 0; i + len <= recent.length; i++) {
      const a = recent[i];
      const b = recent[i + len - 1];
      // only contiguous ranges
      if (Number(b.slice(0, 4)) * 12 + Number(b.slice(5)) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5))) !== len - 1) continue;
      if (len === recent.length && months.length === recent.length) continue; // identical to "All available"
      out.push({ id: `${a}..${b}`, label: monthSpanLabel(a, b), from: `${a}-01`, to: monthEnd(b) });
    }
  }
  return out;
}

export function customPeriod(from: string, to: string): Period {
  return { id: `custom:${from}..${to}`, label: `${from} to ${to}`, from: from || null, to: to || null };
}

export function periodLabelShort(p: Period): string {
  return p.id === 'all' ? 'all available data' : p.label;
}
