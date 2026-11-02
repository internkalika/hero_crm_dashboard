import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { analyzeInput, applyImport, normalizeFile, planImport } from '../src/lib/ingest/pipeline';
import { autoMap, missingRequired, SOURCES } from '../src/lib/ingest/sources';
import type { DsUsageRec, DsUsageReported } from '../src/lib/types';
import { csvInput } from './helpers';

const NOW = new Date('2026-10-29T12:00:00');
const H = ['Date', 'Zone', 'ASM', 'Employee', 'Punched By', 'Dealer', 'Platform', 'Source', 'Status', 'Reject Reason', 'Items', 'Total'];
const ORDERS: unknown[][] = [
  ['2026-10-01', 'NORTH', 'Asha', 'Ravi', 'RSE', 'Delhi Cycles', 'Mobile', 'SFA', 'Billing', '', 3, 1500.5],
  ['2026-10-01', 'NORTH', 'Asha', 'Ravi', 'RSE', 'Delhi Cycles', 'Mobile', 'SFA', 'Billing', '', 3, 1500.5], // same order shape twice is two orders
  ['2026-10-02', 'SOUTH', 'Bala', 'Sita', 'ASM', 'Chennai Bikes', 'Web', 'SFA', 'Rejected by ASM', 'price too high', 2, 900],
  ['2026-10-03', '', 'Bala', '', '', 'Madurai Traders', 'Old App', 'SAP', 'Archived', '', null, null],
  ['2026-10-04', 'EAST', 'Cyrus', 'Dev', 'RSM', 'Kolkata Wheels', 'Mobile', 'SFA', 'Archived', '', 5, 4000],
];
const SUMMARY: unknown[][] = [
  ['Metric', 'Value'],
  ['Period', '01-10-2026 to 04-10-2026'],
  ['Zone', 'All Zones'],
  ['Generated on', '04-10-2026 10:00'],
  ['Total orders', 5],
  ['SFA app orders', 4],
  ['Manual SAP orders', 1],
  ['SFA adoption %', 0.8],
  ['Archived orders', 2],
  ['Rejected orders (ASM / SAP / Not created)', 1],
];
const ASM: unknown[][] = [
  ['Zone', 'ASM / Employee', 'Level', 'SFA Orders', 'SAP Orders', 'Archived', 'Rejected', 'Valid Order Value', 'SFA Adoption'],
  ['NORTH', 'Asha - Team Total', 'ASM', 2, null, 0, 0, 3001, 1],
  ['NORTH', '    Ravi', 'RSE', 2, null, 0, 0, 3001, 1],
];

function workbook(orders = ORDERS, opts: { summary?: boolean; asm?: boolean; sheetNames?: [string, string, string] } = {}) {
  const [o, s, a] = opts.sheetNames ?? ['Orders', 'Summary', 'ASM-Employee-wise'];
  const wb = XLSX.utils.book_new();
  if (opts.summary !== false) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(SUMMARY), s);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...orders]), o);
  if (opts.asm !== false) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ASM), a);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { name: 'App_Usage_Report_test.xlsx', size: out.byteLength, buffer: out };
}

function ingest(input: ReturnType<typeof workbook>, sheetName?: string) {
  const { analysis, read } = analyzeInput(input, 'x');
  if (!read) throw new Error(analysis.error);
  const source = analysis.identification.source!;
  return { analysis, payload: normalizeFile(read, source, { now: NOW, sheetName }), source };
}

describe('ds_usage importer: identification', () => {
  it('recognises the workbook and picks the Orders sheet even though Summary comes first', () => {
    const { analysis } = analyzeInput(workbook(), 'x');
    expect(analysis.identification.source).toBe('ds_usage');
    expect(analysis.identification.sheetName).toBe('Orders');
    expect(analysis.identification.ambiguous).toBe(false);
    expect(analysis.sheets.map((s) => s.name)).toEqual(['Summary', 'Orders', 'ASM-Employee-wise']);
  });
  it('recognises a CSV of the Orders sheet', () => {
    const csv = [H.join(','), ...ORDERS.map((r) => r.map((c) => (c === null ? '' : String(c))).join(','))].join('\n');
    const { analysis } = analyzeInput(csvInput('App_Usage_Report_oct.csv', csv), 'x');
    expect(analysis.identification.source).toBe('ds_usage');
    expect(analysis.kind).toBe('csv');
  });
  it('does not mistake DataSense orders for a usage report', () => {
    const csv = 'Order NO,Order Date,Invoice NO,Dealer Name,Employee Name,Role,city,value of Order,Status\nA1,01-Oct-2026,,D1 [10],E1 [1],RSE,Pune,100,Billed';
    const { analysis } = analyzeInput(csvInput('Order Punched Report.csv', csv), 'x');
    expect(analysis.identification.source).toBe('ds_orders');
  });
  it('lists the required columns that are missing', () => {
    const miss = missingRequired(autoMap(['Date', 'Employee', 'Dealer', 'Status'], SOURCES.ds_usage.fields), SOURCES.ds_usage.fields);
    expect(miss).toEqual(['platform']);
    expect(Object.entries(SOURCES.ds_usage.fields).filter(([, d]) => d.required).map(([k]) => k)).toEqual(['date', 'dealer', 'platform', 'status']);
  });
});

describe('ds_usage importer: normalisation and validation', () => {
  const { payload } = ingest(workbook());
  const recs = payload.records as DsUsageRec[];
  const rep = payload.meta.extra!.usageReport as DsUsageReported;

  it('keeps every order, including identical-looking ones, with the values the Usage page reads', () => {
    expect(recs).toHaveLength(5);
    expect(new Set(recs.map((r) => r.key)).size).toBe(5);
    expect(recs[0]).toMatchObject({ date: '2026-10-01', month: '2026-10', zone: 'NORTH', asm: 'Asha', employee: 'Ravi', punchedBy: 'RSE', dealer: 'Delhi Cycles', platform: 'Mobile', source: 'SFA', status: 'Billing', items: 3, total: 1500.5 });
    expect(recs[3]).toMatchObject({ zone: '', employee: '', punchedBy: 'Other / Unknown', platform: 'Old App', source: 'SAP', items: null, total: null });
  });
  it('sets the period and counts', () => {
    expect(payload.meta).toMatchObject({ id: 'ds_usage:all', source: 'ds_usage', sheet: 'Orders', periodStart: '2026-10-01', periodEnd: '2026-10-04', validCount: 5, invalidCount: 0, duplicateCount: 0 });
  });
  it('reads the Summary and ASM-Employee-wise sheets and reconciles against them', () => {
    expect(rep.reported).toEqual({ Period: '01-10-2026 to 04-10-2026', Zone: 'All Zones', 'Generated on': '04-10-2026 10:00' });
    expect(rep.summary).toMatchObject({ 'Total orders': 5, 'SFA app orders': 4, 'Manual SAP orders': 1, 'Archived orders': 2, 'Rejected orders (ASM / SAP / Not created)': 1 });
    expect(rep.employees).toHaveLength(2);
    expect(rep.employees![1]).toMatchObject({ name: 'Ravi', level: 'RSE', sfa: 2, adoption: 1 }) // the shared reader trims cells;
    const recon = payload.meta.extra!.reconciliation as Array<{ field: string; diff: number }>;
    expect(recon).toHaveLength(5);
    expect(recon.every((r) => r.diff === 0)).toBe(true);
  });
  it('flags a Summary sheet that disagrees with the orders', () => {
    const bad = ingest(workbook(ORDERS.slice(0, 4))).payload;
    const recon = bad.meta.extra!.reconciliation as Array<{ field: string; diff: number }>;
    expect(recon.find((r) => r.field === 'Total orders')!.diff).toBe(-1);
    expect(bad.issues.some((i) => i.code === 'TOTAL_MISMATCH')).toBe(true);
  });
  it('excludes rows without a valid date and reports the footer row separately', () => {
    const p = ingest(workbook([...ORDERS, ['not a date', 'X', '', 'E', 'ASM', 'D', 'Web', 'SFA', 'Open', '', 1, 10], ['Total', '', '', '', '', '', '', '', '', '', 15, 6800]]), 'Orders').payload;
    expect(p.meta).toMatchObject({ validCount: 5, invalidCount: 1, totalRowCount: 1 });
    expect(p.issues.filter((i) => i.excluded).map((i) => i.code).sort()).toEqual(['INVALID_DATE', 'TOTAL_ROW_EXCLUDED']);
  });
  it('derives the source from the platform and warns about an unknown platform', () => {
    const rows = [['2026-10-05', 'N', 'A', 'E', 'ASM', 'D', 'Web', '', 'Open', '', 1, 1], ['2026-10-05', 'N', 'A', 'E', 'ASM', 'D', 'Fax', '', 'Open', '', 1, 2]];
    const p = ingest(workbook(rows, { summary: false, asm: false })).payload;
    const r = p.records as DsUsageRec[];
    expect(r[0].source).toBe('SFA');
    expect(r[1]).toMatchObject({ platform: 'Fax', source: '' });
    expect(p.issues.map((i) => i.code)).toContain('UNKNOWN_PLATFORM');
  });
  it('works from a workbook without the sibling sheets, and from a CSV', () => {
    const p = ingest(workbook(ORDERS, { summary: false, asm: false })).payload;
    expect((p.meta.extra!.usageReport as DsUsageReported)).toEqual({ reported: null, summary: null, employees: null, notes: [] });
    expect(p.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['NO_SUMMARY_SHEET', 'NO_ASM_SHEET']));
    expect(p.records).toHaveLength(5);
  });
  it('lets the user choose another worksheet', () => {
    const wb = workbook(ORDERS, { sheetNames: ['Sheet2', 'Summary', 'ASM-Employee-wise'] });
    const p = ingest(wb, 'Sheet2').payload;
    expect(p.meta.sheet).toBe('Sheet2');
    expect(p.records).toHaveLength(5);
  });
  it('uses the order number as identity when the file has one', () => {
    const H2 = [...H, 'Order No'];
    const mk = (rows: unknown[][]) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H2, ...rows]), 'Orders');
      const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      return { name: 'App_Usage_Report_x.xlsx', size: out.byteLength, buffer: out };
    };
    const row = (no: string, dealer: string, total = 10) => ['2026-10-05', 'N', 'A', 'E', 'ASM', dealer, 'Web', 'SFA', 'Open', '', 1, total, no];
    const p = ingest(mk([row('5001', 'D1'), row('5001', 'D2'), row('5002', 'D1'), row('5002', 'D1'), row('5003', 'D1', 10), row('5003', 'D1', 99)])).payload;
    const keys = (p.records as DsUsageRec[]).map((r) => r.key);
    expect(keys.slice(0, 3)).toEqual(['5001|D1', '5001|D2', '5002|D1']); // same order no, other dealer: its own order
    expect(p.meta.duplicateCount).toBe(1); // identical repeat is excluded
    expect((p.meta.extra!.usageReport as DsUsageReported).notes).toEqual(['1 order number appears on two rows each with different dealers; every row is kept as its own order.']);
    expect(keys.filter((k) => k.startsWith('5003'))).toHaveLength(2); // same key, different content: both kept
  });
});

describe('ds_usage importer: replace / merge / skip', () => {
  const first = ingest(workbook());
  const changed = [
    ORDERS[0],
    ORDERS[1],
    ['2026-10-02', 'SOUTH', 'Bala', 'Sita', 'ASM', 'Chennai Bikes', 'Web', 'SFA', 'Billing', '', 2, 900], // status moved on: an update
    ORDERS[3],
    ORDERS[4],
    ['2026-10-09', 'WEST', 'Esha', 'Fay', 'RSE', 'Pune Pedals', 'Mobile', 'SFA', 'Open', '', 1, 700], // a new order
  ];
  const second = ingest(workbook(changed));

  it('recommends skip for the identical file, replace/merge for a newer one', () => {
    const stored = { ...first.payload.meta, extra: { ...first.payload.meta.extra, fileHash: first.analysis.hash } };
    expect(planImport([stored], first.payload.meta, first.analysis.hash)).toMatchObject({ recommended: 'skip', duplicateUpload: true });
    expect(planImport([stored], second.payload.meta, first.analysis.hash)).toMatchObject({ recommended: 'skip', duplicateUpload: true });
    const plan = planImport([stored], second.payload.meta, second.analysis.hash);
    expect(plan.options).toEqual(expect.arrayContaining(['replace', 'merge', 'skip']));
    expect(plan).toMatchObject({ recommended: 'replace', needsConfirmation: false }); // the new range covers the stored one
  });
  it('replace: the new file wins', () => {
    const { payload, summary } = applyImport(first.payload, second.payload, 'replace');
    expect(payload!.records).toHaveLength(6);
    expect(summary).toMatchObject({ mode: 'replace', added: 6, removed: 5 });
  });
  it('merge: inserts new orders, updates changed ones, keeps the rest', () => {
    const { payload, summary } = applyImport(first.payload, second.payload, 'merge');
    expect(summary).toMatchObject({ mode: 'merge', added: 1, updated: 1, unchanged: 4 });
    const recs = payload!.records as DsUsageRec[];
    expect(recs).toHaveLength(6);
    expect(recs.find((r) => r.dealer === 'Chennai Bikes')!.status).toBe('Billing');
    // the report's own summary describes one file only
    expect(payload!.meta.extra!.usageReport).toEqual({ reported: null, summary: null, employees: null, notes: [] });
    expect(payload!.meta.periodEnd).toBe('2026-10-09');
  });
  it('skip: nothing is written', () => {
    const { payload, summary } = applyImport(first.payload, second.payload, 'skip');
    expect(payload).toBeNull();
    expect(summary.mode).toBe('skip');
  });
});
