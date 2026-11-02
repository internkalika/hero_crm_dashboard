// Order roll-ups and KPI formulas shared by the Dealer App and DataSense dashboards.
//
// GRAIN: Dealer App exports are SKU lines. Amount / Fulfilled_Amount were verified to be LINE level
// (they differ between lines of the same order), so an order's value is the SUM of its line amounts.
// DataSense exports are order headers (one row per order).
import type { DealerOrderLine, DsOrder, OrderStatusGroup, OrderSummary, Settings } from '../types';

const isCycle = (cat: string | null) => !cat || /cycle/i.test(cat);

/** The model of a Dealer App line: its Sku_Brand as recorded (see models.ts). */
export const NO_MODEL = 'Not specified';
export const modelOf = (l: Pick<DealerOrderLine, 'brand'>): string => (l.brand ?? '').trim() || NO_MODEL;

const STATUS_RANK: Record<OrderStatusGroup, number> = { rejected: 0, accepted: 1, partial: 2, fulfilled: 3, open: 4, sap_pending: 5, billed: 6, dispatch: 7, other: 8 };

export function buildDealerOrders(lines: DealerOrderLine[]): OrderSummary[] {
  const by = new Map<string, DealerOrderLine[]>();
  for (const l of lines) {
    const a = by.get(l.orderId);
    if (a) a.push(l);
    else by.set(l.orderId, [l]);
  }
  const out: OrderSummary[] = [];
  by.forEach((ls, orderId) => {
    const first = ls[0];
    // status: the most frequent order-level status across lines
    const counts = new Map<string, number>();
    ls.forEach((l) => counts.set(l.status, (counts.get(l.status) ?? 0) + 1));
    const status = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] as DealerOrderLine['status'];
    let value: number | null = null;
    let qty = 0;
    let cyclesValue = 0;
    let fq: number | null = 0;
    let fv: number | null = 0;
    let fqUnknown = false;
    for (const l of ls) {
      if (l.amount !== null) value = (value ?? 0) + l.amount;
      if (isCycle(l.category)) {
        qty += l.qty ?? 0;
        cyclesValue += l.amount ?? 0;
        // blank fulfilled quantity only means "0" where the line says Not Fulfilled
        if (l.fulfilledQty !== null) fq = (fq ?? 0) + l.fulfilledQty;
        else if (l.lineStatus === 'not_fulfilled' || status === 'rejected') fq = (fq ?? 0) + 0;
        else fqUnknown = true;
      }
      if (l.fulfilledAmount !== null) fv = (fv ?? 0) + l.fulfilledAmount;
    }
    const flags: string[] = [];
    if (fqUnknown) {
      fq = null;
      flags.push('fulfilled_qty_unknown');
    }
    if (value === null || value <= 0) flags.push('zero_value');
    if (!first.sapOrderId && status !== 'rejected') flags.push('missing_sap_id');
    if (!first.dealerKey) flags.push('no_dealer_code');
    const groups: Record<string, OrderStatusGroup> = { fulfilled: 'fulfilled', partial: 'partial', rejected: 'rejected', accepted: 'accepted', other: 'other' };
    out.push({
      key: orderId,
      system: 'dealer',
      datasetId: first.datasetId,
      orderId,
      sapOrderId: first.sapOrderId,
      dealerKey: first.dealerKey,
      dealerName: first.outletName,
      outletId: first.outletId,
      date: first.orderDate,
      month: first.month,
      statusGroup: groups[status],
      rawStatus: first.rawStatus,
      value,
      qty,
      cyclesValue,
      fulfilledQty: fq,
      fulfilledValue: fv,
      lines: ls.length,
      skus: new Set(ls.map((l) => l.skuCode ?? l.sku ?? l.key)).size,
      models: [...new Set(ls.map(modelOf))].sort(),
      invoiced: ls.some((l) => !!l.invoiceId),
      zone: first.zone,
      city: first.city,
      flags,
    });
  });
  return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.orderId.localeCompare(b.orderId));
}

export function dsOrderSummaries(orders: DsOrder[]): OrderSummary[] {
  return orders.map((o) => ({
    key: o.key,
    system: 'ds' as const,
    datasetId: o.datasetId,
    orderId: o.orderNo,
    sapOrderId: o.idFormat === 'sap' ? o.orderNo : o.invoiceNo,
    dealerKey: o.dealerKey,
    dealerName: o.dealerName,
    outletId: null,
    date: o.orderDate,
    month: o.month,
    statusGroup: o.statusGroup,
    rawStatus: o.rawStatus,
    value: o.value,
    qty: o.cyclesQty,
    cyclesValue: o.cyclesValue,
    fulfilledQty: null,
    fulfilledValue: null,
    lines: 1,
    skus: 0,
    invoiced: o.invoiceNo ? true : o.statusGroup === 'billed' ? false : null,
    zone: null,
    city: o.city,
    employee: o.employeeName,
    role: o.role,
    flags: o.flags,
  }));
}

/* --------------------------------- KPI formulas --------------------------------- */

export type OrderOptions = Pick<Settings, 'includeRejected'>;

export function isEligible(o: OrderSummary, opts: OrderOptions): boolean {
  if (!opts.includeRejected && o.statusGroup === 'rejected') return false;
  return o.value !== null && o.value > 0;
}

export interface OrderKpis {
  /** distinct valid orders of any status */
  gross: number;
  rejected: number;
  /** eligible orders: valid, value > 0 and (unless included) not rejected */
  eligible: number;
  zeroValue: number;
  grossValue: number;
  eligibleValue: number;
  rejectedValue: number;
  aov: number | null;
  qty: number;
  asp: number | null;
  fulfilledQty: number | null;
  fulfilmentRate: number | null;
  unknownFulfilmentOrders: number;
  billed: number;
  billedRate: number | null;
  rejectionRate: number | null;
  activeDealers: number;
  avgOrdersPerDealer: number | null;
  uniqueSkus: number | null;
  invoicedOrders: number | null;
  pendingQty: number | null;
  lines: number;
}

export function orderKpis(orders: OrderSummary[], opts: OrderOptions, system: 'dealer' | 'ds' | 'auto' = 'auto'): OrderKpis {
  const sys = system === 'auto' ? orders[0]?.system ?? 'dealer' : system;
  const eligible = orders.filter((o) => isEligible(o, opts));
  const rejected = orders.filter((o) => o.statusGroup === 'rejected');
  const eligibleValue = eligible.reduce((a, o) => a + (o.value ?? 0), 0);
  const qtyOrders = eligible.filter((o) => (o.qty ?? 0) > 0);
  const qty = eligible.reduce((a, o) => a + (o.qty ?? 0), 0);
  const aspQty = qtyOrders.reduce((a, o) => a + (o.qty ?? 0), 0);
  const aspVal = qtyOrders.reduce((a, o) => a + (o.cyclesValue ?? 0), 0);
  let fulfilledQty: number | null = null;
  let fulfilmentRate: number | null = null;
  let unknown = 0;
  if (sys === 'dealer') {
    const known = eligible.filter((o) => o.fulfilledQty !== null);
    unknown = eligible.length - known.length;
    fulfilledQty = known.reduce((a, o) => a + (o.fulfilledQty ?? 0), 0);
    const denom = known.reduce((a, o) => a + (o.qty ?? 0), 0);
    fulfilmentRate = denom > 0 ? fulfilledQty / denom : null;
  }
  const billed = eligible.filter((o) => o.statusGroup === 'billed' || o.statusGroup === 'dispatch' || o.statusGroup === 'fulfilled').length;
  const dealers = new Set(eligible.map((o) => o.dealerKey ?? `name:${o.dealerName}`));
  return {
    gross: orders.length,
    rejected: rejected.length,
    eligible: eligible.length,
    zeroValue: orders.filter((o) => o.value === null || o.value <= 0).length,
    grossValue: orders.reduce((a, o) => a + (o.value ?? 0), 0),
    eligibleValue,
    rejectedValue: rejected.reduce((a, o) => a + (o.value ?? 0), 0),
    aov: eligible.length ? eligibleValue / eligible.length : null,
    qty,
    asp: aspQty > 0 ? aspVal / aspQty : null,
    fulfilledQty,
    fulfilmentRate,
    unknownFulfilmentOrders: unknown,
    billed,
    billedRate: eligible.length ? billed / eligible.length : null,
    rejectionRate: orders.length ? rejected.length / orders.length : null,
    activeDealers: dealers.size,
    avgOrdersPerDealer: dealers.size ? eligible.length / dealers.size : null,
    uniqueSkus: null, // needs line records: see uniqueSkuCount()
    invoicedOrders: sys === 'dealer' ? eligible.filter((o) => o.invoiced).length : eligible.filter((o) => o.invoiced === true).length,
    pendingQty: sys === 'dealer' && fulfilledQty !== null ? Math.max(0, qty - fulfilledQty) : null,
    lines: orders.reduce((a, o) => a + o.lines, 0),
  };
}

/** unique SKUs need the line records */
export function uniqueSkuCount(lines: DealerOrderLine[], eligibleOrderIds: Set<string>): number {
  const s = new Set<string>();
  for (const l of lines) if (eligibleOrderIds.has(l.orderId)) s.add(l.skuCode ?? l.sku ?? l.key);
  return s.size;
}

/* --------------------------------- grouping --------------------------------- */

export interface GroupRow {
  key: string;
  label: string;
  orders: number;
  grossOrders: number;
  value: number;
  qty: number;
  aov: number | null;
  asp: number | null;
  fulfilledQty: number | null;
  fulfilmentRate: number | null;
  rejected: number;
  rejectionRate: number | null;
  dealers: number;
}

export function groupOrders(orders: OrderSummary[], opts: OrderOptions, keyOf: (o: OrderSummary) => string | null, labelOf?: (key: string, rows: OrderSummary[]) => string): GroupRow[] {
  const by = new Map<string, OrderSummary[]>();
  for (const o of orders) {
    const k = keyOf(o);
    if (k === null || k === undefined) continue;
    const a = by.get(k);
    if (a) a.push(o);
    else by.set(k, [o]);
  }
  const rows: GroupRow[] = [];
  by.forEach((os, key) => {
    const k = orderKpis(os, opts);
    rows.push({
      key,
      label: labelOf ? labelOf(key, os) : key,
      orders: k.eligible,
      grossOrders: k.gross,
      value: k.eligibleValue,
      qty: k.qty,
      aov: k.aov,
      asp: k.asp,
      fulfilledQty: k.fulfilledQty,
      fulfilmentRate: k.fulfilmentRate,
      rejected: k.rejected,
      rejectionRate: k.rejectionRate,
      dealers: k.activeDealers,
    });
  });
  return rows;
}

export const STATUS_LABELS: Record<OrderStatusGroup, string> = {
  fulfilled: 'Fulfilled',
  partial: 'Partially fulfilled',
  accepted: 'Accepted (awaiting fulfilment)',
  billed: 'Billing',
  dispatch: 'Truck load / delivery',
  open: 'Open / pending',
  sap_pending: 'SAP order not created',
  rejected: 'Rejected',
  other: 'Other',
};
export { STATUS_RANK };
