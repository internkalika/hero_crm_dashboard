// Reporting and comparison windows for the Dealer App vs SFA comparison.
//
// WHY A SEPARATE MODEL FROM THE HEADER PERIOD. The business question is "did the dealers do more business in this
// period than in the one before it?", and the two periods have to be the SAME LENGTH and cover the SAME DAYS of the
// month, otherwise a month still in progress looks like a collapse. So this page works in explicit date windows:
//
//   * the data cut-off is the last day BOTH order exports reach (the earlier of the Dealer App's and DataSense's last
//     order date). Orders after it are left out so that the two channels always cover the same days;
//   * a month that the cut-off cuts short is reported "month to date", and the default comparison is the same number
//     of days of the previous month (1–21 Oct against 1–21 Sep), never the whole previous month;
//   * a window is always inclusive of both end dates.
import type { AppData } from '../types';
import { monthEnd, monthLabel } from '../util/parse';

export interface Win {
  from: string;
  to: string;
  /** e.g. "1–21 Oct 2026" */
  label: string;
  /** number of calendar days, both ends included */
  days: number;
  /** true when the window is a calendar month that the data cut-off cut short */
  partialMonth: boolean;
}

export interface DataSpan {
  /** first and last order date of each order export, or null when it is not imported */
  dealer: [string, string] | null;
  ds: [string, string] | null;
  /** first day with orders in either export */
  start: string;
  /** last day both exports reach (or the one export that exists) */
  cutoff: string;
  /** every calendar month from the first order up to the cut-off */
  months: string[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`, both included (0 when `to` is before `from`). */
export function daysIn(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export const monthShort = (m: string): string => MONTHS[+m.slice(5, 7) - 1];

/** "1–21 Oct 2026", "1 Sep – 21 Oct 2026", "9 Sep 2026" */
export function rangeLabel(from: string, to: string): string {
  const d = (iso: string) => String(+iso.slice(8, 10));
  const mo = (iso: string) => MONTHS[+iso.slice(5, 7) - 1];
  if (from === to) return `${d(from)} ${mo(from)} ${from.slice(0, 4)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${d(from)}–${d(to)} ${mo(to)} ${to.slice(0, 4)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${d(from)} ${mo(from)} – ${d(to)} ${mo(to)} ${to.slice(0, 4)}`;
  return `${d(from)} ${mo(from)} ${from.slice(0, 4)} – ${d(to)} ${mo(to)} ${to.slice(0, 4)}`;
}

export function makeWin(from: string, to: string): Win {
  const single = from.slice(0, 7) === to.slice(0, 7) && from === `${from.slice(0, 7)}-01`;
  return { from, to, label: rangeLabel(from, to), days: daysIn(from, to), partialMonth: single && to < monthEnd(to.slice(0, 7)) };
}

/** First and last order date of each export and the cut-off both reach. */
export function dataSpan(data: AppData): DataSpan | null {
  const span = (dates: Array<string | null>): [string, string] | null => {
    const d = dates.filter((x): x is string => !!x).sort();
    return d.length ? [d[0], d[d.length - 1]] : null;
  };
  const dealer = span(data.dealerLines.map((l) => l.orderDate));
  const ds = span(data.dsOrders.map((o) => o.orderDate));
  if (!dealer && !ds) return null;
  const start = [dealer?.[0], ds?.[0]].filter((x): x is string => !!x).sort()[0];
  const cutoff = [dealer?.[1], ds?.[1]].filter((x): x is string => !!x).sort()[0];
  const months: string[] = [];
  for (let m = start.slice(0, 7); m <= cutoff.slice(0, 7); m = shiftMonth(m, 1)) months.push(m);
  return { dealer, ds, start, cutoff, months };
}

export interface WindowChoice {
  id: string;
  label: string;
}

/** Reporting periods the data can support: each month (month to date for the last one), the last 30 days, all data. */
export function reportingChoices(span: DataSpan): WindowChoice[] {
  const out: WindowChoice[] = [];
  for (const m of [...span.months].reverse()) {
    const w = resolveReporting(span, `m:${m}`);
    out.push({ id: `m:${m}`, label: `${monthLabel(m)}${w.partialMonth ? ` (to ${+w.to.slice(8, 10)} ${monthShort(m)})` : ''}` });
  }
  out.push({ id: 'last30', label: 'Last 30 days of data' });
  out.push({ id: 'all', label: 'All data' });
  return out;
}

export function resolveReporting(span: DataSpan, id: string): Win {
  if (id === 'all') return makeWin(span.start, span.cutoff);
  if (id === 'last30') return makeWin(addDays(span.cutoff, -29) < span.start ? span.start : addDays(span.cutoff, -29), span.cutoff);
  if (id.startsWith('c:')) {
    const [a, b] = id.slice(2).split('..');
    if (/^\d{4}-\d{2}-\d{2}$/.test(a ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(b ?? '') && a <= b) return makeWin(a, b > span.cutoff ? span.cutoff : b);
  }
  const m = id.startsWith('m:') && span.months.includes(id.slice(2)) ? id.slice(2) : span.months[span.months.length - 1];
  const to = monthEnd(m) > span.cutoff ? span.cutoff : monthEnd(m);
  return makeWin(`${m}-01`, to);
}

/** The comparison choices that make sense for a reporting window. */
export function comparisonChoices(span: DataSpan, reporting: Win): WindowChoice[] {
  const out: WindowChoice[] = [];
  const single = isSingleMonth(reporting);
  out.push({ id: 'prev', label: single ? `Previous month${reporting.partialMonth ? ', same days' : ''}` : 'Previous period, same length' });
  if (single) out.push({ id: 'len', label: 'Previous period, same length' });
  for (const m of [...span.months].reverse()) if (!(single && m === reporting.from.slice(0, 7)) && m < reporting.from.slice(0, 7)) out.push({ id: `m:${m}`, label: `${monthLabel(m)}${reporting.partialMonth ? ', same days' : ''}` });
  out.push({ id: 'none', label: 'No comparison' });
  return out;
}

const isSingleMonth = (w: Win): boolean => w.from.slice(0, 7) === w.to.slice(0, 7) && w.from === `${w.from.slice(0, 7)}-01`;

export interface Windows {
  reporting: Win;
  comparison: Win | null;
  /** how the comparison was formed, or why there is none */
  comparisonNote: string | null;
}

export function resolveWindows(span: DataSpan, rpId: string, cpId: string): Windows {
  const reporting = resolveReporting(span, rpId);
  const n = reporting.days;
  const single = isSingleMonth(reporting);
  const sameLength = (): Win => makeWin(addDays(reporting.from, -n), addDays(reporting.from, -1));
  const monthWin = (m: string): Win => {
    // the same number of days when the reporting month is cut short; otherwise the whole month (limited by the data cut-off)
    const full = monthEnd(m);
    const end = reporting.partialMonth && single ? addDays(`${m}-01`, n - 1) : full;
    const to = end > full ? full : end > span.cutoff ? span.cutoff : end;
    return makeWin(`${m}-01`, to);
  };
  let comparison: Win | null = null;
  let note: string | null = null;
  if (cpId === 'none') note = 'No comparison period selected.';
  else if (cpId.startsWith('c:')) {
    const [a, b] = cpId.slice(2).split('..');
    if (/^\d{4}-\d{2}-\d{2}$/.test(a ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(b ?? '') && a <= b) comparison = makeWin(a, b > span.cutoff ? span.cutoff : b);
    else note = 'The comparison dates are not valid.';
  } else if (cpId.startsWith('m:') && /^\d{4}-\d{2}$/.test(cpId.slice(2))) comparison = monthWin(cpId.slice(2));
  else if (cpId === 'len' || !single) comparison = sameLength();
  else comparison = monthWin(shiftMonth(reporting.from.slice(0, 7), -1));
  if (comparison && comparison.to >= reporting.from && comparison.from <= reporting.to) {
    note = 'The comparison period overlaps the reporting period, so no comparison is made.';
    comparison = null;
  }
  if (comparison && comparison.to < span.start) {
    note = `There is no order data before ${rangeLabel(span.start, span.start)}, so the earlier period cannot be compared.`;
    comparison = null;
  }
  if (comparison && !note) {
    const lenDiff = comparison.days !== reporting.days;
    note = lenDiff ? `${reporting.days} days are compared with ${comparison.days} days. Values are totals, not per-day averages.` : null;
  }
  return { reporting, comparison, comparisonNote: note };
}

export const inWin = (date: string | null | undefined, w: Win): boolean => !!date && date >= w.from && date <= w.to;

/** Days of a window that lie inside [first, last]. */
export function coveredDays(w: Win, first: string | null | undefined, last: string | null | undefined): number {
  if (!first || !last) return 0;
  const a = first > w.from ? first : w.from;
  const b = last < w.to ? last : w.to;
  return a > b ? 0 : daysIn(a, b);
}
