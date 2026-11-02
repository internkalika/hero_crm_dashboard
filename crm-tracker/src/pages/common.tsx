import { ReactNode } from 'react';
import { Badge, Tone } from '../components/ui';
import type { ComplaintStatusGroup, IssueStatusGroup, OrderStatusGroup } from '../lib/types';
import { COMPLAINT_STATUS_LABELS } from '../lib/metrics/complaints';
import { STATUS_LABELS } from '../lib/metrics/orders';
import type { Period } from '../lib/metrics/period';
import { isBounded } from '../lib/metrics/period';

const orderTone: Record<OrderStatusGroup, Tone> = { fulfilled: 'good', billed: 'good', dispatch: 'good', partial: 'warn', accepted: 'info', open: 'warn', sap_pending: 'warn', rejected: 'bad', other: 'neutral' };
export const OrderStatusBadge = ({ s }: { s: OrderStatusGroup }) => <Badge tone={orderTone[s]}>{STATUS_LABELS[s]}</Badge>;

const complaintTone: Record<ComplaintStatusGroup, Tone> = { closed: 'good', open: 'bad', pending: 'warn', in_process: 'info', escalated: 'bad', rejected: 'neutral', unmapped: 'warn' };
export const ComplaintStatusBadge = ({ s }: { s: ComplaintStatusGroup }) => <Badge tone={complaintTone[s]}>{COMPLAINT_STATUS_LABELS[s]}</Badge>;

const issueTone: Record<IssueStatusGroup, Tone> = { resolved: 'good', in_progress: 'info', waiting: 'warn', unmapped: 'warn' };
export const IssueStatusBadge = ({ s, label }: { s: IssueStatusGroup; label: string }) => <Badge tone={issueTone[s]}>{label}</Badge>;

export function periodNote(p: Period): string {
  return isBounded(p) ? `Period: ${p.label}` : 'Period: all available data';
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-ink-2">{children}</span>;
}

export const monthKeyLabel = (m: string) => {
  const [y, mo] = m.split('-');
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mo - 1] + ' ' + y;
};

export function topN<T>(rows: T[], n: number): T[] {
  return rows.slice(0, n);
}
