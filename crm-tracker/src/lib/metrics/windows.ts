// Period-over-period comparisons that are only produced when they are honest.
//
// A trend arrow is shown only when
//   * the selected period is made of whole calendar months,
//   * the window of the same length immediately before it exists in the data for that source, and
//   * every month in both windows is "complete" for that source: the export reaches (within two days of) the month end
//     and the month has already ended at the as-of date.
// A month that is still in progress, or a source that starts mid-month in the previous window, never yields a change:
// a part-month compared with a full month would look like a collapse that did not happen.
import type { AppData, SourceType } from '../types';
import { monthEnd, monthLabel } from '../util/parse';
import { Period, monthSpanLabel } from './period';

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const shiftMonth = (m: string, by: number): string => {
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
};

const monthsOfRange = (a: string, b: string): string[] => {
  const out: string[] = [];
  for (let m = a; m <= b; m = shiftMonth(m, 1)) out.push(m);
  return out;
};

/** The whole calendar months a period consists of, or null when it is "all data", open ended or cuts a month. */
export function periodMonths(p: Period): string[] | null {
  if (!p.from || !p.to) return null;
  const a = p.from.slice(0, 7);
  const b = p.to.slice(0, 7);
  if (p.from !== `${a}-01` || p.to !== monthEnd(b) || b < a) return null;
  return monthsOfRange(a, b);
}

/** Is the month finished, as far as the files of these sources can tell? */
export function monthCompleteFn(data: AppData, sources: SourceType[], asOf: string): (month: string) => boolean {
  const ends = data.datasets.filter((d) => sources.includes(d.source) && d.periodEnd).map((d) => d.periodEnd as string);
  const lastData = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null;
  return (m) => {
    const end = monthEnd(m);
    if (end > asOf) return false;
    return !!lastData && lastData >= addDays(end, -2);
  };
}

export interface ComparableWindows {
  cur: string[];
  prev: string[];
  /** "Aug 2026" or "Jul–Aug 2026": what the change is measured against */
  prevLabel: string;
  curLabel: string;
}

/** The selected period and the equally long window just before it, when both can be compared. */
export function comparableWindows(period: Period, hasData: (m: string) => boolean, isComplete: (m: string) => boolean): ComparableWindows | null {
  const cur = periodMonths(period);
  if (!cur) return null;
  const prev = monthsOfRange(shiftMonth(cur[0], -cur.length), shiftMonth(cur[0], -1));
  const ok = [...cur, ...prev].every((m) => hasData(m) && isComplete(m));
  if (!ok) return null;
  const label = (ms: string[]) => monthSpanLabel(ms[0], ms[ms.length - 1]);
  return { cur, prev, curLabel: label(cur), prevLabel: label(prev) };
}

export interface Change {
  from: number;
  to: number;
  abs: number;
  /** null when the earlier value is zero (a percentage would be meaningless) */
  pct: number | null;
}

export function changeOf(from: number | null | undefined, to: number | null | undefined): Change | null {
  if (from === null || from === undefined || to === null || to === undefined) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to, abs: to - from, pct: from === 0 ? null : (to - from) / Math.abs(from) };
}

/** Complete consecutive months (oldest first) among the months in view that have data: the basis for "latest change". */
export function lastTwoCompleteMonths(months: string[], hasData: (m: string) => boolean, isComplete: (m: string) => boolean): [string, string] | null {
  const ok = months.filter((m) => hasData(m) && isComplete(m)).sort();
  for (let i = ok.length - 1; i >= 1; i--) if (shiftMonth(ok[i - 1], 1) === ok[i]) return [ok[i - 1], ok[i]];
  return null;
}

export { monthLabel };
