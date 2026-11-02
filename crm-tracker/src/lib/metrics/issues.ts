// Bizom issue-tracker analytics.
//
// The tracker has no "created" or "closed" date, so ageing since creation and resolution time are
// UNAVAILABLE and never invented. What it does have: a status, a priority, a target date (sometimes
// free text) and update notes. Derived measures:
//  - Open            = status is not resolved.
//  - Overdue         = open AND target is a real date AND target < as-of date.
//  - Target unknown  = open AND target is free text ("Weekly", "Ph2") or blank - cannot be tested.
import type { Insight, IssueRec } from '../types';
import { todayIso } from '../util/parse';

export const asOfOf = (asOfDate: string | null) => asOfDate ?? todayIso();

export const isOpen = (i: IssueRec) => i.statusGroup !== 'resolved';

export function isOverdue(i: IssueRec, asOf: string): boolean {
  return isOpen(i) && !!i.targetDate && i.targetDate < asOf;
}

export interface IssueKpis {
  total: number;
  resolved: number;
  open: number;
  inProgress: number;
  waiting: number;
  unmapped: number;
  resolutionRate: number | null;
  overdue: number;
  dueNext14: number;
  targetUnknownOpen: number;
  p1Total: number;
  p1Open: number;
  p1Overdue: number;
  noPriority: number;
}

export function issueKpis(issues: IssueRec[], asOf: string): IssueKpis {
  const open = issues.filter(isOpen);
  const p1 = issues.filter((i) => i.priority === 'P1');
  const plus14 = new Date(`${asOf}T00:00:00Z`);
  plus14.setUTCDate(plus14.getUTCDate() + 14);
  const horizon = plus14.toISOString().slice(0, 10);
  return {
    total: issues.length,
    resolved: issues.length - open.length,
    open: open.length,
    inProgress: issues.filter((i) => i.statusGroup === 'in_progress').length,
    waiting: issues.filter((i) => i.statusGroup === 'waiting').length,
    unmapped: issues.filter((i) => i.statusGroup === 'unmapped').length,
    resolutionRate: issues.length ? (issues.length - open.length) / issues.length : null,
    overdue: open.filter((i) => isOverdue(i, asOf)).length,
    dueNext14: open.filter((i) => !!i.targetDate && i.targetDate >= asOf && i.targetDate <= horizon).length,
    targetUnknownOpen: open.filter((i) => !i.targetDate).length,
    p1Total: p1.length,
    p1Open: p1.filter(isOpen).length,
    p1Overdue: p1.filter((i) => isOverdue(i, asOf)).length,
    noPriority: issues.filter((i) => !i.priority).length,
  };
}

export interface IssueGroup {
  key: string;
  label: string;
  total: number;
  open: number;
  resolved: number;
  overdue: number;
}

export function issuesBy(issues: IssueRec[], keyOf: (i: IssueRec) => string | null, asOf: string): IssueGroup[] {
  const by = new Map<string, IssueRec[]>();
  for (const i of issues) {
    const k = keyOf(i) ?? 'Not specified';
    const a = by.get(k);
    if (a) a.push(i);
    else by.set(k, [i]);
  }
  return [...by.entries()]
    .map(([key, rs]) => ({ key, label: key, total: rs.length, open: rs.filter(isOpen).length, resolved: rs.filter((r) => !isOpen(r)).length, overdue: rs.filter((r) => isOverdue(r, asOf)).length }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export function issueInsights(issues: IssueRec[], asOf: string): Insight[] {
  const out: Insight[] = [];
  if (!issues.length) return out;
  const k = issueKpis(issues, asOf);
  if (k.overdue > 0) out.push({ id: 'issues-overdue', level: 'concern', title: `${k.overdue} open issues are past their target date`, detail: `Measured against ${asOf}. ${k.p1Overdue} of them are P1. ${k.targetUnknownOpen} more open issues have no usable target date and cannot be tested.`, to: '/issues' });
  if (k.p1Open > 0) out.push({ id: 'issues-p1', level: k.p1Overdue ? 'concern' : 'watch', title: `${k.p1Open} of ${k.p1Total} P1 issues remain open`, detail: 'Priority comes from the tracker’s priority column (P1–P3 only).', to: '/issues' });
  out.push({ id: 'issues-resolution', level: 'info', title: `${k.resolved} of ${k.total} tracked issues are resolved (${k.resolutionRate !== null ? (k.resolutionRate * 100).toFixed(0) : '–'}%)`, detail: 'Resolution time cannot be calculated because the tracker has no created or closed dates.', to: '/issues' });
  return out;
}
