// Normalisers for the two order systems.
import type { DealerOrderLine, DealerOrderStatus, DsOrder, OrderStatusGroup, ReadFile, DatasetPayload } from '../types';
import {
  IssueLog,
  NormalizeCtx,
  baseMeta,
  dominantMonth,
  getMapping,
  minMax,
  missingColumnIssues,
  monthFromFilename,
  pickSheet,
  reader,
} from './common';
import {
  dealerKeyOf,
  detectDateOrder,
  extractBracketId,
  monthOf,
  num,
  parseDate,
  parseNumber,
  str,
} from '../util/parse';

/* =============================== Dealer App =============================== */

export function dealerStatus(raw: string): DealerOrderStatus {
  const s = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled') return 'rejected';
  if (s === 'fulfilled' || s === 'fullyfulfilled' || s === 'delivered') return 'fulfilled';
  if (s === 'partialfulfilled' || s === 'partiallyfulfilled' || s === 'partial') return 'partial';
  if (s === 'accepted' || s === 'pending' || s === 'open' || s === 'new' || s === 'placed') return 'accepted';
  return 'other';
}

export function normalizeDealerOrders(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<DealerOrderLine> {
  const sheet = pickSheet(file, ctx, 'dealer_orders');
  const mapping = getMapping(sheet, 'dealer_orders', ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, 'dealer_orders', issues);

  const dateOf = (col: string) => sheet.rows.map((r) => r[mapping[col]]);
  const orderDateOrder = mapping.orderDate ? detectDateOrder(dateOf('orderDate')) : 'dmy';
  const invDateOrder = mapping.invoiceDate ? detectDateOrder(dateOf('invoiceDate')) : 'dmy';
  const fulDateOrder = mapping.fulfilledDate ? detectDateOrder(dateOf('fulfilledDate')) : 'dmy';

  // First pass: parse every row.
  type Draft = DealerOrderLine & { _sig: string };
  const drafts: Draft[] = [];
  let invalid = 0;
  sheet.rows.forEach((row, i) => {
    const g = reader(row, mapping);
    const rowNo = sheet.rowNumbers[i];
    const orderId = str(g('orderId'));
    if (!orderId) {
      invalid++;
      issues.add({ code: 'MISSING_ORDER_ID', severity: 'error', message: 'Row has no Order_ID and was excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    const od = parseDate(g('orderDate'), orderDateOrder);
    if (!od) issues.add({ code: 'INVALID_DATE', severity: 'warning', message: 'Order date is missing or not a valid date.', ref: orderId, field: 'Order_Date', value: String(g('orderDate') ?? '') });
    const qtyN = parseNumber(g('qty'));
    const amtN = parseNumber(g('amount'));
    const unitN = parseNumber(g('unitPrice'));
    const fqN = parseNumber(g('fulfilledQty'));
    const faN = parseNumber(g('fulfilledAmount'));
    for (const [label, n, raw] of [
      ['Order_Quantity', qtyN, g('qty')],
      ['Amount', amtN, g('amount')],
      ['Unitprice', unitN, g('unitPrice')],
      ['Fulfilled_Quantity', fqN, g('fulfilledQty')],
      ['Fulfilled_Amount', faN, g('fulfilledAmount')],
    ] as const) {
      if (n !== null && Number.isNaN(n)) issues.add({ code: 'INVALID_NUMBER', severity: 'warning', message: `${label} is not a number.`, ref: orderId, field: label, value: String(raw) });
      if (typeof n === 'number' && n < 0) issues.add({ code: 'NEGATIVE_VALUE', severity: 'warning', message: `${label} is negative.`, ref: orderId, field: label, value: String(n) });
    }
    const rawStatus = str(g('status')) ?? '';
    const status = dealerStatus(rawStatus);
    if (status === 'other') issues.add({ code: 'UNMAPPED_STATUS', severity: 'warning', message: `Order status "${rawStatus}" is not mapped.`, ref: orderId, field: 'Order_Status', value: rawStatus });
    const sap = str(g('sapOrderId'));
    if (!sap && status !== 'rejected') issues.add({ code: 'MISSING_SAP_ORDER_ID', severity: 'warning', message: 'Non-rejected order has no SAP_Order_ID.', ref: orderId, field: 'SAP_Order_ID' });
    const invoice = str(g('invoiceId'));
    if (invoice && /[,\s]/.test(invoice)) issues.add({ code: 'SUSPICIOUS_ID', severity: 'warning', message: 'Invoice ID contains separators (likely corrupted by spreadsheet formatting).', ref: orderId, field: 'Invoice_Id', value: invoice });
    const ls = (str(g('lineStatus')) ?? '').toLowerCase();
    const lineStatus: DealerOrderLine['lineStatus'] = ls === 'fulfilled' ? 'fulfilled' : ls.includes('not') ? 'not_fulfilled' : 'unknown';
    const fqRaw = fqN === null || Number.isNaN(fqN) ? null : fqN;
    if (fqRaw !== null && qtyN !== null && !Number.isNaN(qtyN) && fqRaw > qtyN) issues.add({ code: 'FULFILLED_EXCEEDS_ORDERED', severity: 'warning', message: 'Fulfilled quantity exceeds ordered quantity.', ref: orderId, field: 'Fulfilled_Quantity' });
    if (amtN !== null && !Number.isNaN(amtN) && qtyN !== null && !Number.isNaN(qtyN) && unitN !== null && !Number.isNaN(unitN) && Math.abs(amtN - qtyN * unitN) > Math.max(1, 0.01 * amtN)) {
      issues.add({ code: 'AMOUNT_DIFFERS_FROM_QTY_X_PRICE', severity: 'info', message: 'Amount differs from Order_Quantity x Unitprice by more than 1% (discounts/tax adjustments are likely).', ref: orderId, field: 'Amount' });
    }
    const skuKey = str(g('skuId')) ?? str(g('skuCode')) ?? str(g('sku')) ?? `row${rowNo}`;
    const inv = parseDate(g('invoiceDate'), invDateOrder);
    const ful = parseDate(g('fulfilledDate'), fulDateOrder);
    const d: Draft = {
      key: `${orderId}|${skuKey}`,
      datasetId: '',
      rowNo,
      period: '',
      zone: str(g('zone')),
      city: str(g('city')),
      warehouse: str(g('warehouse')),
      outletId: str(g('outletId')) ?? '',
      outletName: str(g('outletName')) ?? '',
      dealerKey: dealerKeyOf(g('erpId')),
      beat: str(g('beat')),
      sku: str(g('sku')),
      skuCode: str(g('skuCode')),
      brand: str(g('brand')),
      category: str(g('category')),
      orderId,
      sapOrderId: sap,
      orderDate: od?.date ?? null,
      month: monthOf(od?.date),
      status,
      rawStatus,
      qty: qtyN === null || Number.isNaN(qtyN) ? null : qtyN,
      unitPrice: unitN === null || Number.isNaN(unitN) ? null : unitN,
      amount: amtN === null || Number.isNaN(amtN) ? null : amtN,
      invoiceId: invoice,
      invoiceDate: inv?.date ?? null,
      fulfilledAmount: faN === null || Number.isNaN(faN) ? null : faN,
      fulfilledDate: ful?.date ?? null,
      fulfilledQty: fqRaw,
      lineStatus,
      _sig: [orderId, skuKey, qtyN, amtN, fqN, faN, rawStatus].join('~'),
    };
    if (!d.dealerKey) issues.add({ code: 'MISSING_DEALER_KEY', severity: 'warning', message: 'Outlet_ERP_ID missing - dealer cannot be matched to other systems.', ref: orderId, field: 'Outlet_ERP_ID' });
    drafts.push(d);
  });

  // Duplicate handling: identical lines are excluded, key collisions with different values are kept and flagged.
  const seenSig = new Set<string>();
  const seenKey = new Map<string, number>();
  const lines: DealerOrderLine[] = [];
  let duplicates = 0;
  for (const d of drafts) {
    if (seenSig.has(d._sig)) {
      duplicates++;
      issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Identical order line appears more than once; extra copy excluded.', ref: d.orderId, excluded: true });
      continue;
    }
    seenSig.add(d._sig);
    const n = (seenKey.get(d.key) ?? 0) + 1;
    seenKey.set(d.key, n);
    const { _sig, ...rec } = d;
    void _sig;
    if (n > 1) {
      rec.key = `${rec.key}#${n}`;
      issues.add({ code: 'DUPLICATE_KEY', severity: 'warning', message: 'Same Order_ID + SKU appears with different values; both lines retained.', ref: rec.orderId });
    }
    lines.push(rec);
  }

  // Order-level consistency: one status/date/dealer per order.
  const byOrder = new Map<string, DealerOrderLine[]>();
  for (const l of lines) {
    const arr = byOrder.get(l.orderId);
    if (arr) arr.push(l);
    else byOrder.set(l.orderId, [l]);
  }
  byOrder.forEach((ls, id) => {
    const statuses = new Set(ls.map((l) => l.rawStatus));
    const dealers = new Set(ls.map((l) => l.dealerKey ?? l.outletId));
    if (statuses.size > 1) issues.add({ code: 'INCONSISTENT_ORDER_STATUS', severity: 'warning', message: `Order has several statuses across its lines: ${[...statuses].join(', ')}`, ref: id });
    if (dealers.size > 1) issues.add({ code: 'ORDER_MULTIPLE_DEALERS', severity: 'error', message: 'Order lines belong to more than one dealer.', ref: id });
  });

  // Scope / period.
  const dates = lines.map((l) => l.orderDate);
  const [lo, hi] = minMax(dates);
  const dom = dominantMonth(dates);
  const inference: string[] = [];
  const fnMonth = monthFromFilename(file.fileName);
  let scope = ctx.scopeOverride ?? dom?.month ?? '';
  if (ctx.scopeOverride) inference.push(`Period set manually to ${ctx.scopeOverride}.`);
  else if (dom && dom.share >= 0.95) inference.push(`Period ${dom.month} taken from the Order_Date values (${Math.round(dom.share * 100)}% of lines).`);
  else if (dom) {
    scope = `${lo!.slice(0, 7)}_${hi!.slice(0, 7)}`;
    inference.push(`File spans several months (${lo} to ${hi}); scope set to ${scope}.`);
  }
  if (fnMonth && dom && +dom.month.slice(5, 7) !== fnMonth) {
    issues.add({ code: 'PERIOD_MISMATCH', severity: 'warning', message: `File name suggests month ${fnMonth} but order dates fall mostly in ${dom.month}.` });
  }
  if (!scope) scope = 'unknown';
  if (orderDateOrder === 'dmy' && lines.length) inference.push('Order_Date read as day-first (DD-MM-YYYY) after checking every value in the column; ISO dates are read as-is.');

  const meta = baseMeta('dealer_orders', scope, file, sheet, mapping);
  lines.forEach((l) => {
    l.datasetId = meta.id;
    l.period = scope;
  });
  meta.periodStart = lo;
  meta.periodEnd = hi;
  meta.period = scope;
  meta.asOfDate = hi;
  meta.validCount = lines.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity !== 'info').map((i) => i.ref)).size;
  meta.inference = inference;
  meta.extra = { uniqueOrders: byOrder.size, outlets: new Set(lines.map((l) => l.dealerKey ?? l.outletId)).size };
  return { meta, raw: sheet.rows, records: lines, issues: issues.items };
}

/* =============================== DataSense orders =============================== */

export function dsStatusGroup(raw: string): OrderStatusGroup {
  const s = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (s.startsWith('rejected')) return 'rejected';
  if (s === 'billing' || s === 'billed' || s === 'invoiced') return 'billed';
  if (s === 'truckload' || s === 'delivery' || s === 'dispatched' || s === 'intransit') return 'dispatch';
  if (s === 'open' || s === 'pending') return 'open';
  if (s === 'sapordernotcreated') return 'sap_pending';
  return 'other';
}

export function parseReportRange(preamble: string[]): { start: string; end: string } | null {
  for (const p of preamble) {
    const m = /(\d{2}[-/]\d{2}[-/]\d{4})\s*to\s*(\d{2}[-/]\d{2}[-/]\d{4})/i.exec(p);
    if (m) {
      const a = parseDate(m[1], 'dmy');
      const b = parseDate(m[2], 'dmy');
      if (a && b) return { start: a.date, end: b.date };
    }
  }
  return null;
}

export function normalizeDsOrders(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<DsOrder> {
  const sheet = pickSheet(file, ctx, 'ds_orders');
  const mapping = getMapping(sheet, 'ds_orders', ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, 'ds_orders', issues);
  const order = mapping.orderDate ? detectDateOrder(sheet.rows.map((r) => r[mapping.orderDate])) : 'dmy';

  const recs: DsOrder[] = [];
  const totalRows: Record<string, number | null>[] = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Map<string, string>();
  sheet.rows.forEach((row, i) => {
    const g = reader(row, mapping);
    const rowNo = sheet.rowNumbers[i];
    const orderNo = str(g('orderNo'));
    // Totals/footer rows: first cell is the word "Total" (and no date)
    if (orderNo && /^total$/i.test(orderNo)) {
      totalRows.push({
        value: num(g('value')),
        cyclesQty: num(g('cyclesQty')),
        cyclesValue: num(g('cyclesValue')),
        sparesValue: num(g('sparesValue')),
        sparesQty: num(g('sparesQty')),
      });
      issues.add({ code: 'TOTAL_ROW_EXCLUDED', severity: 'info', message: 'Report footer "Total" row excluded from records and used for reconciliation.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    if (!orderNo) {
      invalid++;
      issues.add({ code: 'MISSING_ORDER_ID', severity: 'error', message: 'Row has no Order NO and was excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    const od = parseDate(g('orderDate'), order);
    if (!od) issues.add({ code: 'INVALID_DATE', severity: 'warning', message: 'Order date missing or invalid.', ref: orderNo, field: 'Order Date', value: String(g('orderDate') ?? '') });
    const nums = {
      value: parseNumber(g('value')),
      cyclesQty: parseNumber(g('cyclesQty')),
      cyclesValue: parseNumber(g('cyclesValue')),
      sparesValue: parseNumber(g('sparesValue')),
      sparesQty: parseNumber(g('sparesQty')),
    };
    (Object.entries(nums) as [string, number | null][]).forEach(([k, v]) => {
      if (v !== null && Number.isNaN(v)) issues.add({ code: 'INVALID_NUMBER', severity: 'warning', message: `${k} is not a number.`, ref: orderNo, field: k, value: String(g(k === 'value' ? 'value' : k)) });
      if (typeof v === 'number' && v < 0) issues.add({ code: 'NEGATIVE_VALUE', severity: 'warning', message: `${k} is negative.`, ref: orderNo, field: k, value: String(v) });
    });
    const clean = (v: number | null) => (v === null || Number.isNaN(v) ? null : v);
    const dealer = extractBracketId(g('dealer'));
    const emp = extractBracketId(g('employee'));
    const rawStatus = str(g('status')) ?? '';
    const statusGroup = dsStatusGroup(rawStatus);
    const flags: string[] = [];
    if (statusGroup === 'other') issues.add({ code: 'UNMAPPED_STATUS', severity: 'warning', message: `Status "${rawStatus}" is not mapped.`, ref: orderNo, field: 'Status', value: rawStatus });
    const value = clean(nums.value);
    if (value !== null && value <= 0) {
      flags.push('zero_value');
      issues.add({ code: 'ZERO_VALUE_ORDER', severity: 'warning', message: 'Order value is zero; kept in the order list but excluded from value KPIs.', ref: orderNo, field: 'value of Order', value: String(value) });
    }
    if (!dealer.id) {
      flags.push('no_dealer_code');
      issues.add({ code: 'MISSING_DEALER_KEY', severity: 'warning', message: 'Dealer name has no [code] - cannot be matched to other systems.', ref: orderNo, field: 'Dealer Name' });
    }
    const invoice = str(g('invoiceNo'));
    if (!invoice && statusGroup === 'billed') issues.add({ code: 'MISSING_INVOICE', severity: 'warning', message: 'Order is in Billing status but has no invoice number.', ref: orderNo });
    const cv = clean(nums.cyclesValue);
    const sv = clean(nums.sparesValue);
    if (value !== null && cv !== null && sv !== null && Math.abs(value - cv - sv) > 1) {
      flags.push('value_differs_from_components');
      issues.add({ code: 'VALUE_DIFFERS_FROM_CYCLES_PLUS_SPARES', severity: 'info', message: 'value of Order differs from Cycles value + spares value (other components, tax or freight may be included).', ref: orderNo, field: 'value of Order' });
    }
    const sigKey = [dealer.id ?? dealer.name, od?.date, value, statusGroup].join('~');
    if (value && value > 0 && seen.has(sigKey)) {
      flags.push('possible_duplicate');
      issues.add({ code: 'POSSIBLE_DUPLICATE_ORDER', severity: 'info', message: `Same dealer, date, value and status as order ${seen.get(sigKey)} - may be a resubmission.`, ref: orderNo });
    } else if (value && value > 0) seen.set(sigKey, orderNo);

    recs.push({
      key: orderNo,
      datasetId: '',
      rowNo,
      orderNo,
      idFormat: /^\d{14}$/.test(orderNo) ? 'datasense' : 'sap',
      orderDate: od?.date ?? null,
      month: monthOf(od?.date),
      invoiceNo: invoice,
      dealerName: dealer.name,
      dealerKey: dealerKeyOf(dealer.id),
      employeeName: emp.name || null,
      employeeId: emp.id,
      role: str(g('role')),
      city: str(g('city')),
      value,
      cyclesQty: clean(nums.cyclesQty),
      cyclesValue: cv,
      sparesValue: sv,
      sparesQty: clean(nums.sparesQty),
      rawStatus,
      statusGroup,
      flags,
    });
  });

  // Duplicate Order NO handling (exact duplicates dropped, key collisions kept & flagged)
  const final: DsOrder[] = [];
  const seenNo = new Map<string, DsOrder>();
  for (const r of recs) {
    const prev = seenNo.get(r.orderNo);
    if (!prev) {
      seenNo.set(r.orderNo, r);
      final.push(r);
      continue;
    }
    const same = prev.value === r.value && prev.rawStatus === r.rawStatus && prev.orderDate === r.orderDate && prev.dealerName === r.dealerName;
    if (same) {
      duplicates++;
      issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Identical Order NO appears more than once; extra copy excluded.', ref: r.orderNo, excluded: true });
    } else {
      r.key = `${r.orderNo}#${r.rowNo}`;
      issues.add({ code: 'DUPLICATE_KEY', severity: 'warning', message: 'Order NO appears twice with different content; both retained.', ref: r.orderNo });
      final.push(r);
    }
  }

  // Reconcile with the report's own Total row.
  const reconciliation: Array<{ field: string; reported: number; computed: number; diff: number }> = [];
  if (totalRows.length === 1) {
    const t = totalRows[0];
    const sumOf = (f: (r: DsOrder) => number | null) => final.reduce((a, r) => a + (f(r) ?? 0), 0);
    const pairs: Array<[string, number | null, number]> = [
      ['Order value', t.value, sumOf((r) => r.value)],
      ['Cycles volume', t.cyclesQty, sumOf((r) => r.cyclesQty)],
      ['Cycles value', t.cyclesValue, sumOf((r) => r.cyclesValue)],
      ['Spares value', t.sparesValue, sumOf((r) => r.sparesValue)],
      ['Spares volume', t.sparesQty, sumOf((r) => r.sparesQty)],
    ];
    for (const [field, reported, computed] of pairs) {
      if (reported === null) continue;
      const diff = computed - reported;
      reconciliation.push({ field, reported, computed, diff });
      issues.add({
        code: Math.abs(diff) > 1 ? 'TOTAL_MISMATCH' : 'TOTAL_RECONCILED',
        severity: Math.abs(diff) > 1 ? 'error' : 'info',
        message: `${field}: report total ${reported.toLocaleString('en-IN')} vs parsed ${computed.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${Math.abs(diff) > 1 ? ` (difference ${diff.toFixed(2)})` : ' - matches'}.`,
      });
    }
  }

  const range = parseReportRange(sheet.preamble) ?? parseReportRange(file.sheets.flatMap((s) => s.preamble));
  const [lo, hi] = minMax(final.map((r) => r.orderDate));
  const scope = ctx.scopeOverride ?? 'all';
  const meta = baseMeta('ds_orders', scope, file, sheet, mapping);
  final.forEach((r) => (r.datasetId = meta.id));
  meta.periodStart = range?.start ?? lo;
  meta.periodEnd = range?.end ?? hi;
  meta.period = lo && hi ? `${lo} to ${hi}` : null;
  meta.asOfDate = range?.end ?? hi;
  meta.validCount = final.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.totalRowCount = totalRows.length;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity === 'warning').map((i) => i.ref)).size;
  meta.rawCount = sheet.rows.length;
  meta.inference = [
    range ? `Report range ${range.start} to ${range.end} read from the report title.` : 'No report date range found in the title; range taken from the order dates.',
    'Order Date read with month names (DD-Mon-YYYY); numbers use Indian digit grouping and were parsed accordingly.',
    'Dealer and employee codes are taken from the [code] suffix of the name fields.',
  ];
  meta.extra = { reconciliation, title: sheet.preamble[0] ?? null, fileKind: file.kind };
  return { meta, raw: sheet.rows, records: final, issues: issues.items };
}
