// Unit tests for the KPI formulas, using small synthetic exports whose answers can be checked by hand.
import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { csvInput } from './helpers';
import { analyzeInput, normalizeFile } from '../src/lib/ingest/pipeline';
import type { DatasetPayload, DealerOrderLine, OrderSummary, SourceType } from '../src/lib/types';
import { defaultSettings } from '../src/lib/types';
import { buildDealerOrders, dsOrderSummaries, groupOrders, isEligible, orderKpis, uniqueSkuCount } from '../src/lib/metrics/orders';
import { dateInPeriod, customPeriod, ALL_PERIOD, monthInPeriod } from '../src/lib/metrics/period';
import { diffOf } from '../src/lib/metrics/comparison';
import { ageDays, complaintKpis, isBacklog } from '../src/lib/metrics/complaints';
import { isOverdue, issueKpis } from '../src/lib/metrics/issues';
import { changesBetween, snapshotTotals } from '../src/lib/metrics/loyalty';
import type { ComplaintRec, IssueRec } from '../src/lib/types';

const NOW = new Date('2026-10-26T12:00:00');

/* ----------------------------- synthetic Dealer App file ----------------------------- */

const DEALER_HEADER = ['Zone', 'City', 'Mapped_Warehouse_Name', 'Mapped_Warehouse_ID', 'Outlet_ID', 'Outlet_Name', 'Beat', 'Outlet_ERP_ID', 'Outlet_Type', 'User_Name', 'SKU_ID', 'SKU', 'SKU_Code', 'Sku_Brand', 'Category', 'Order_ID', 'SAP_Order_ID', 'Order_Date', 'Order_Time', 'Order_Status', 'Order_Quantity', 'Unitprice', 'Amount', 'Invoice_Id', 'Distributor_Bill_No', 'Invoice_Date', 'Invoice_Time', 'Fulfilled_Amount', 'Fulfilled_Date', 'Fulfilled_Quantity', 'Sku_Wise_Fulfilled_Status'];

interface L {
  order: string;
  dealer?: string;
  outlet?: string;
  name?: string;
  sku: string;
  cat?: string;
  qty: number;
  price: number;
  amount?: number;
  status: string;
  date?: string;
  sap?: string;
  fq?: number | '';
  fa?: number | '';
  line?: string;
}

function dealerCsv(lines: L[]): string {
  const rows = lines.map((l) => {
    const r: Record<string, string | number> = {
      Zone: 'East', City: 'Kolkata', Mapped_Warehouse_Name: 'WH', Mapped_Warehouse_ID: 1, Outlet_ID: l.outlet ?? '1', Outlet_Name: l.name ?? 'Dealer One', Beat: 'B1', Outlet_ERP_ID: l.dealer ?? '10061', Outlet_Type: 'Direct Dealer', User_Name: 'u1',
      SKU_ID: l.sku, SKU: `SKU ${l.sku}`, SKU_Code: `C${l.sku}`, Sku_Brand: 'HERO', Category: l.cat ?? 'Cycles', Order_ID: l.order, SAP_Order_ID: l.sap ?? (l.status === 'Rejected' ? '' : `00305${l.order}`),
      Order_Date: l.date ?? '09-09-2026', Order_Time: '10:00', Order_Status: l.status, Order_Quantity: l.qty, Unitprice: l.price, Amount: l.amount ?? l.qty * l.price,
      Invoice_Id: '', Distributor_Bill_No: '', Invoice_Date: '', Invoice_Time: '', Fulfilled_Amount: l.fa ?? '', Fulfilled_Date: '', Fulfilled_Quantity: l.fq ?? '', Sku_Wise_Fulfilled_Status: l.line ?? '',
    };
    return DEALER_HEADER.map((h) => r[h] ?? '');
  });
  return Papa.unparse([DEALER_HEADER, ...rows]);
}

function ingestText(name: string, text: string, forced?: SourceType): DatasetPayload {
  const { analysis, read } = analyzeInput(csvInput(name, text), name);
  if (!read) throw new Error(analysis.error);
  const source = forced ?? analysis.identification.source;
  if (!source) throw new Error('not identified');
  return normalizeFile(read, source, { now: NOW });
}

const SAMPLE: L[] = [
  // order 1001: two SKU lines, fulfilled -> one order worth 18,000
  { order: '1001', sku: '1', qty: 2, price: 5000, status: 'Fulfilled', fq: 2, fa: 10000, line: 'Fulfilled' },
  { order: '1001', sku: '2', qty: 1, price: 8000, status: 'Fulfilled', fq: 1, fa: 8000, line: 'Fulfilled' },
  // order 1002: rejected
  { order: '1002', sku: '1', qty: 1, price: 6000, status: 'Rejected', fq: 0, line: 'Not Fulfilled' },
  // order 1003: other dealer, partly fulfilled (2 of 4)
  { order: '1003', dealer: '10062', outlet: '2', name: 'Dealer Two', sku: '3', qty: 4, price: 1000, status: 'Partial Fulfilled', fq: 2, fa: 2000, line: 'Fulfilled' },
  // order 1004: zero value
  { order: '1004', sku: '4', qty: 1, price: 0, amount: 0, status: 'Accepted' },
  // exact duplicate of the first line of 1001
  { order: '1001', sku: '1', qty: 2, price: 5000, status: 'Fulfilled', fq: 2, fa: 10000, line: 'Fulfilled' },
];

describe('Dealer App: SKU lines roll up to orders', () => {
  const payload = ingestText('DealerAppOrders-SEPT.csv', dealerCsv(SAMPLE));
  const lines = payload.records as DealerOrderLine[];

  it('is recognised as Dealer App orders and keeps every distinct line', () => {
    expect(payload.meta.source).toBe('dealer_orders');
    expect(payload.meta.rawCount).toBe(6);
    expect(lines).toHaveLength(5);
    expect(payload.meta.duplicateCount).toBe(1);
    expect(payload.meta.validCount + payload.meta.duplicateCount + payload.meta.invalidCount).toBe(payload.meta.rawCount);
  });

  it('counts an order once and sums line Amounts for its value', () => {
    const orders = buildDealerOrders(lines);
    expect(orders.map((o) => o.orderId)).toEqual(['1001', '1002', '1003', '1004']);
    const o1001 = orders.find((o) => o.orderId === '1001')!;
    expect(o1001.lines).toBe(2);
    expect(o1001.skus).toBe(2);
    expect(o1001.value).toBe(18000);
    expect(o1001.qty).toBe(3);
  });

  it('computes eligible orders, AOV and ASP with rejected and zero-value orders excluded', () => {
    const orders = buildDealerOrders(lines);
    const k = orderKpis(orders, defaultSettings, 'dealer');
    expect(k.gross).toBe(4);
    expect(k.rejected).toBe(1);
    expect(k.zeroValue).toBe(1);
    expect(k.eligible).toBe(2); // 1001 and 1003
    expect(k.eligibleValue).toBe(22000);
    expect(k.aov).toBe(11000);
    expect(k.qty).toBe(7);
    expect(k.asp).toBeCloseTo(22000 / 7, 6);
    expect(k.rejectionRate).toBeCloseTo(1 / 4, 10);
    expect(k.activeDealers).toBe(2);
    expect(k.rejectedValue).toBe(6000);
  });

  it('includes rejected orders only when the setting says so', () => {
    const orders = buildDealerOrders(lines);
    const k = orderKpis(orders, { ...defaultSettings, includeRejected: true }, 'dealer');
    expect(k.eligible).toBe(3);
    expect(k.eligibleValue).toBe(28000);
    expect(k.aov).toBeCloseTo(28000 / 3, 6);
    expect(isEligible(orders.find((o) => o.orderId === '1004')!, { includeRejected: true })).toBe(false); // zero value never counts
  });

  it('fulfilment rate is quantity based: fulfilled qty / ordered qty on eligible orders', () => {
    const k = orderKpis(buildDealerOrders(lines), defaultSettings, 'dealer');
    expect(k.fulfilledQty).toBe(5); // 3 + 2
    expect(k.fulfilmentRate).toBeCloseTo(5 / 7, 10);
    expect(k.pendingQty).toBe(2);
  });

  it('counts unique SKUs from the line records of eligible orders only', () => {
    const orders = buildDealerOrders(lines);
    const ids = new Set(orders.filter((o) => isEligible(o, defaultSettings)).map((o) => o.orderId));
    expect(uniqueSkuCount(lines, ids)).toBe(3); // SKU 1, 2 (order 1001) and 3 (order 1003)
  });

  it('groups by dealer using the validated ERP code', () => {
    const rows = groupOrders(buildDealerOrders(lines), defaultSettings, (o) => o.dealerKey);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['10061'].orders).toBe(1);
    expect(by['10061'].value).toBe(18000);
    expect(by['10062'].value).toBe(4000);
  });

  it('keeps a blank fulfilled quantity unknown rather than zero', () => {
    const p = ingestText('DealerAppOrders-SEPT.csv', dealerCsv([{ order: '2001', sku: '1', qty: 2, price: 100, status: 'Accepted', fq: '' }]));
    const [o] = buildDealerOrders(p.records as DealerOrderLine[]);
    expect(o.fulfilledQty).toBeNull();
    expect(o.flags).toContain('fulfilled_qty_unknown');
    const k = orderKpis([o], defaultSettings, 'dealer');
    expect(k.fulfilmentRate).toBeNull();
    expect(k.unknownFulfilmentOrders).toBe(1);
  });

  it('reads day-first dates and derives the month from the data, not the file name', () => {
    const p = ingestText('DealerAppOrders-SEPT.csv', dealerCsv([{ order: '3001', sku: '1', qty: 1, price: 10, status: 'Fulfilled', date: '03-10-2026', fq: 1 }]));
    const [l] = p.records as DealerOrderLine[];
    expect(l.orderDate).toBe('2026-10-03');
    expect(l.month).toBe('2026-10');
    expect(p.meta.scope).toBe('2026-10');
    expect(p.issues.some((i) => i.code === 'PERIOD_MISMATCH')).toBe(true);
  });

  it('flags the same Order_ID + SKU with different values and keeps both lines', () => {
    const p = ingestText('DealerAppOrders-SEPT.csv', dealerCsv([
      { order: '4001', sku: '1', qty: 1, price: 100, status: 'Fulfilled', fq: 1 },
      { order: '4001', sku: '1', qty: 2, price: 100, status: 'Fulfilled', fq: 2 },
    ]));
    expect(p.records).toHaveLength(2);
    expect(p.issues.some((i) => i.code === 'DUPLICATE_KEY')).toBe(true);
    expect(new Set((p.records as DealerOrderLine[]).map((l) => l.key)).size).toBe(2);
  });

  it('never invents a rejection reason', () => {
    const rejected = buildDealerOrders(lines).find((o) => o.statusGroup === 'rejected')!;
    expect(Object.keys(rejected)).not.toContain('rejectionReason');
  });
});

describe('DataSense orders: header grain, status groups and the totals footer', () => {
  const header = 'Order NO,Order Date,Invoice NO,Dealer Name,Employee Name,Role,city,value of Order,Cycles volume,Cycles value,spares value,spares volume,Status';
  const csv = [
    header,
    '0030568901,05-Oct-2026,INV1,Dealer A [10061],Emp One [E1],Sales Officer,Pune,30000,3,30000,0,0,Billing',
    '20261006123456,06-Oct-2026,,Dealer A [10061],Emp One [E1],Sales Officer,Pune,9000,1,9000,0,0,Rejected by Dealer',
    '20261007123457,07-Oct-2026,,Dealer B [20077],Emp Two [E2],Sales Officer,Pune,0,2,0,0,0,Open',
    '20261008123458,08-Oct-2026,,Dealer C,Emp Two [E2],Sales Officer,Pune,5000,1,5000,0,0,Truckload',
    'Total,,,,,,,44000,7,44000,0,0,',
  ].join('\n');
  const payload = ingestText('Order Punched Report- Datasense - test.csv', csv, 'ds_orders');
  const orders = dsOrderSummaries(payload.records as never[]);

  it('sets the footer Total row aside: not a record, not invalid', () => {
    expect(payload.records).toHaveLength(4);
    expect(payload.meta.totalRowCount).toBe(1);
    expect(payload.meta.invalidCount).toBe(0);
    expect(payload.issues.some((i) => i.code === 'TOTAL_ROW_EXCLUDED')).toBe(true);
  });

  it('reconciles parsed values to the report total', () => {
    expect(payload.issues.filter((i) => i.code === 'TOTAL_MISMATCH')).toHaveLength(0);
    expect(payload.issues.filter((i) => i.code === 'TOTAL_RECONCILED').length).toBeGreaterThan(0);
  });

  it('reads dealer codes from the [code] suffix and flags a dealer without one', () => {
    const byNo = Object.fromEntries(orders.map((o) => [o.orderId, o]));
    expect(byNo['0030568901'].dealerKey).toBe('10061');
    expect(byNo['20261008123458'].dealerKey).toBeNull();
    expect(byNo['20261008123458'].flags).toContain('no_dealer_code');
  });

  it('groups statuses and keeps SAP and DataSense-format ids apart', () => {
    const byNo = Object.fromEntries(orders.map((o) => [o.orderId, o]));
    expect(byNo['0030568901'].statusGroup).toBe('billed');
    expect(byNo['20261006123456'].statusGroup).toBe('rejected');
    expect(byNo['20261008123458'].statusGroup).toBe('dispatch');
    expect((payload.records as Array<{ orderNo: string; idFormat: string }>).find((r) => r.orderNo === '0030568901')?.idFormat).toBe('sap');
    expect((payload.records as Array<{ orderNo: string; idFormat: string }>).find((r) => r.orderNo === '20261006123456')?.idFormat).toBe('datasense');
  });

  it('computes eligible orders, AOV and the billed rate without mixing in fulfilment', () => {
    const k = orderKpis(orders, defaultSettings, 'ds');
    expect(k.gross).toBe(4);
    expect(k.rejected).toBe(1);
    expect(k.zeroValue).toBe(1);
    expect(k.eligible).toBe(2);
    expect(k.eligibleValue).toBe(35000);
    expect(k.aov).toBe(17500);
    expect(k.billed).toBe(2); // billed + dispatch
    expect(k.billedRate).toBe(1);
    expect(k.fulfilmentRate).toBeNull(); // not defined for DataSense: the two rates are never mixed
  });
});

/* ----------------------------- period handling ----------------------------- */

describe('periods', () => {
  it('filters dates inclusively and treats missing dates as outside a bounded period', () => {
    const p = customPeriod('2026-09-01', '2026-09-30');
    expect(dateInPeriod('2026-09-01', p)).toBe(true);
    expect(dateInPeriod('2026-09-30', p)).toBe(true);
    expect(dateInPeriod('2026-10-01', p)).toBe(false);
    expect(dateInPeriod(null, p)).toBe(false);
    expect(dateInPeriod(null, ALL_PERIOD)).toBe(true);
    expect(monthInPeriod('2026-09', p)).toBe(true);
    expect(monthInPeriod('2026-08', p)).toBe(false);
  });
});

/* ----------------------------- comparison helpers ----------------------------- */

describe('diffOf', () => {
  it('computes absolute and percentage differences against the baseline', () => {
    expect(diffOf(150, 100)).toMatchObject({ abs: 50, pct: 0.5 });
  });
  it('returns no percentage when the baseline is zero or missing (blank is not zero)', () => {
    expect(diffOf(50, 0).pct).toBeNull();
    expect(diffOf(50, null).abs).toBeNull();
    expect(diffOf(null, 100).abs).toBeNull();
  });
});

/* ----------------------------- complaints ----------------------------- */

const complaint = (over: Partial<ComplaintRec>): ComplaintRec => ({
  key: over.id ?? 'x', datasetId: 'd', system: 'ds', id: 'x', rowNo: 1, raisedAt: '2026-10-01T10:00:00', raisedDate: '2026-10-01', month: '2026-10', closedAt: null,
  rawStatus: 'Open', statusGroup: 'open', department: 'Sales', departmentKind: 'function', category: 'Billing', subType: null, owner: null, assignmentLevel: null,
  dealerKey: null, dealerCode: null, dealerName: null, description: null, additionalInfo: null, createdBy: null, role: null, invoiceNumber: null, invoiceDate: null,
  tatMinutes: null, tatSource: null, flags: [], ...over,
});

describe('complaint KPIs', () => {
  const recs = [
    complaint({ id: 'a', raisedDate: '2026-10-20', statusGroup: 'open' }),
    complaint({ id: 'b', raisedDate: '2026-09-01', statusGroup: 'in_process' }),
    complaint({ id: 'c', raisedDate: '2026-09-15', statusGroup: 'closed', closedAt: '2026-09-17T10:00:00', tatMinutes: 2880, tatSource: 'tat' }),
    complaint({ id: 'd', raisedDate: '2026-10-02', statusGroup: 'rejected' }),
  ];
  it('backlog is everything that is neither closed nor rejected', () => {
    expect(recs.filter(isBacklog).map((r) => r.id)).toEqual(['a', 'b']);
    const k = complaintKpis(recs, '2026-10-26');
    expect(k.total).toBe(4);
    expect(k.backlog).toBe(2);
  });
  it('ages open complaints from the raised date to the as-of date', () => {
    expect(ageDays(recs[0], '2026-10-26')).toBe(6);
    expect(ageDays(recs[1], '2026-10-26')).toBe(55);
    expect(complaintKpis(recs, '2026-10-26').over30).toBe(1);
  });
  it('reports turnaround as unavailable when no closure information exists', () => {
    const k = complaintKpis([complaint({ id: 'z', statusGroup: 'closed' })], '2026-10-26');
    expect(k.tatAvailable).toBe(false);
  });
});

/* ----------------------------- issue tracker ----------------------------- */

const issue = (over: Partial<IssueRec>): IssueRec => ({
  key: 'i', datasetId: 'd', rowNo: 1, pointer: 'p', type: 'Bug', typeRaw: 'Bug', priority: 'P1', priorityRaw: 'P1', platform: 'Bizom', status: 'In progress', rawStatus: 'In progress',
  statusGroup: 'in_progress', targetRaw: null, targetDate: null, targetKind: 'none', updates: [], lastUpdateText: null, lastUpdateLabel: null, flags: [], ...over,
});

describe('issue tracker', () => {
  it('overdue needs an open issue with a real target date before the as-of date', () => {
    expect(isOverdue(issue({ targetDate: '2026-10-01', targetKind: 'date' }), '2026-10-26')).toBe(true);
    expect(isOverdue(issue({ targetDate: '2026-11-01', targetKind: 'date' }), '2026-10-26')).toBe(false);
    expect(isOverdue(issue({ targetDate: '2026-10-01', targetKind: 'date', statusGroup: 'resolved' }), '2026-10-26')).toBe(false);
    expect(isOverdue(issue({ targetRaw: 'ASAP', targetDate: null, targetKind: 'non-date' }), '2026-10-26')).toBe(false);
  });
  it('no last-update date or days-since-update figure is produced', () => {
    const k = issueKpis([issue({ key: '1', updates: [{ label: '1st', date: '2026-10-10', text: 'a' }] })], '2026-10-26');
    expect('stale' in k).toBe(false);
    expect('noUpdateDate' in k).toBe(false);
  });
  it('KPIs count open and overdue separately', () => {
    const k = issueKpis([
      issue({ key: '1', targetDate: '2026-10-01', targetKind: 'date' }),
      issue({ key: '2', statusGroup: 'resolved' }),
      issue({ key: '3', statusGroup: 'waiting' }),
    ], '2026-10-26');
    expect(k.total).toBe(3);
    expect(k.open).toBe(2);
    expect(k.overdue).toBe(1);
  });
});

/* ----------------------------- Hero Smiles ----------------------------- */

describe('Hero Smiles snapshots are point-in-time', () => {
  const rec = (id: string, date: string, current: number | null, lifetime: number | null = current, kind: 'verified' | 'unverified' = 'verified') => ({
    key: `${date}|${id}`, datasetId: `loyalty_snapshot:${date}`, rowNo: 1, snapshotDate: date, customerId: id, idKind: kind, entityKey: kind === 'verified' ? id : `unverified:${id}`,
    mobileMasked: 'XXXXXX1234', firmName: id, lifetime, opening: null, issued: null, expired: null, adjustment: null, current, flags: [] as string[],
  });
  const snap = (date: string, rows: ReturnType<typeof rec>[]) => ({ date, datasetId: `loyalty_snapshot:${date}`, fileName: `${date}.csv`, rows });

  it('totals one snapshot only; a zero or blank balance is not a positive balance', () => {
    const t = snapshotTotals(snap('2026-10-19', [rec('A', '2026-10-19', 100), rec('B', '2026-10-19', 0), rec('C', '2026-10-19', null)]));
    expect(t.rows).toBe(3);
    expect(t.positiveBalances).toBe(1);
    expect(t.current).toBe(100);
  });

  it('measures change per dealer between two snapshots, joined on the external id', () => {
    const a = snap('2026-10-19', [rec('A', '2026-10-19', 100, 400), rec('B', '2026-10-19', 50, 50)]);
    const b = snap('2026-10-26', [rec('A', '2026-10-26', 160, 460), rec('C', '2026-10-26', 20, 20), rec('U1', '2026-10-26', 5, 5, 'unverified')]);
    const ch = changesBetween(a, b);
    expect(ch).toHaveLength(1); // only A is in both; C is new, B vanished, U1 is unverified and never joined
    expect(ch[0].entityKey).toBe('A');
    expect(ch[0].deltaCurrent).toBe(60);
    expect(ch[0].deltaLifetime).toBe(60);
    expect(ch[0].flags).toEqual([]);
  });

  it('flags lifetime points that decrease between snapshots', () => {
    const a = snap('2026-10-19', [rec('A', '2026-10-19', 100, 400)]);
    const b = snap('2026-10-26', [rec('A', '2026-10-26', 100, 350)]);
    expect(changesBetween(a, b)[0].flags).toContain('lifetime_decreased');
  });
});
