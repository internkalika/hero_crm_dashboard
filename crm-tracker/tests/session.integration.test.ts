// Data Import session logic against a real (fake-indexeddb) database:
// new period, replace, duplicate upload, merge, overlapping ranges, missing columns, failed files,
// persistence across a "reload", removal and reset.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { csvInput } from './helpers';
import { createInlineClient } from '../src/lib/ingest/client';
import { ImportItem, batchConflicts, commitItems, effectiveMapping, itemsFromAnalyses, missingForItem, normalizeItem, planItems } from '../src/lib/ingest/session';
import { listHistory, listMeta, loadAppData, loadPayload, removeDataset, resetAll, resetDbHandle } from '../src/lib/store/db';
import type { FileInput } from '../src/lib/ingest/readers';
import { buildDealerOrders, orderKpis } from '../src/lib/metrics/orders';
import { defaultSettings } from '../src/lib/types';

const NOW = new Date('2026-10-26T12:00:00');

const DEALER_HEADER = ['Zone', 'City', 'Mapped_Warehouse_Name', 'Mapped_Warehouse_ID', 'Outlet_ID', 'Outlet_Name', 'Beat', 'Outlet_ERP_ID', 'Outlet_Type', 'User_Name', 'SKU_ID', 'SKU', 'SKU_Code', 'Sku_Brand', 'Category', 'Order_ID', 'SAP_Order_ID', 'Order_Date', 'Order_Time', 'Order_Status', 'Order_Quantity', 'Unitprice', 'Amount', 'Invoice_Id', 'Distributor_Bill_No', 'Invoice_Date', 'Invoice_Time', 'Fulfilled_Amount', 'Fulfilled_Date', 'Fulfilled_Quantity', 'Sku_Wise_Fulfilled_Status'];

/** One order line per entry: [orderId, dealer, qty, price, status, dd-mm-yyyy] */
function dealerFile(name: string, lines: Array<[string, string, number, number, string, string]>, renames: Record<string, string> = {}): FileInput {
  const header = DEALER_HEADER;
  const rows = lines.map(([order, dealer, qty, price, status, date], i) => {
    const r: Record<string, string | number> = {
      Zone: 'East', City: 'Kolkata', Mapped_Warehouse_Name: 'WH', Mapped_Warehouse_ID: 1, Outlet_ID: dealer, Outlet_Name: `Dealer ${dealer}`, Beat: 'B', Outlet_ERP_ID: dealer, Outlet_Type: 'DD', User_Name: 'u',
      SKU_ID: i + 1, SKU: `SKU ${i + 1}`, SKU_Code: `C${i + 1}`, Sku_Brand: 'HERO', Category: 'Cycles', Order_ID: order, SAP_Order_ID: `0030${order}`, Order_Date: date, Order_Time: '10:00', Order_Status: status,
      Order_Quantity: qty, Unitprice: price, Amount: qty * price, Invoice_Id: '', Distributor_Bill_No: '', Invoice_Date: '', Invoice_Time: '', Fulfilled_Amount: qty * price, Fulfilled_Date: '', Fulfilled_Quantity: qty, Sku_Wise_Fulfilled_Status: 'Fulfilled',
    };
    return header.map((h) => r[h] ?? '');
  });
  return csvInput(name, Papa.unparse([header.map((h) => renames[h] ?? h), ...rows]));
}

const SEPT: Array<[string, string, number, number, string, string]> = [
  ['5001', '10061', 2, 5000, 'Fulfilled', '03-09-2026'],
  ['5002', '10062', 1, 7000, 'Fulfilled', '04-09-2026'],
];
const OCT: Array<[string, string, number, number, string, string]> = [
  ['6001', '10061', 3, 4000, 'Fulfilled', '03-10-2026'],
];

async function stage(files: FileInput[]): Promise<ImportItem[]> {
  const client = createInlineClient(() => NOW);
  const analyses = await client.analyze(files);
  let items = itemsFromAnalyses(analyses);
  items = await Promise.all(items.map((it) => (it.include ? normalizeItem(client, it) : Promise.resolve(it))));
  return planItems(await listMeta(), items);
}

beforeEach(async () => {
  resetDbHandle();
  await resetAll();
});

describe('import session', () => {
  it('imports two months as two datasets and the dashboards can be rebuilt from storage', async () => {
    const items = await stage([dealerFile('DealerAppOrders-SEPT.csv', SEPT), dealerFile('DealerAppOrders-oct.csv', OCT)]);
    expect(items.map((i) => i.source)).toEqual(['dealer_orders', 'dealer_orders']);
    expect(items.map((i) => i.plan?.recommended)).toEqual(['add', 'add']);
    const res = await commitItems(items);
    expect(res.failed).toEqual([]);
    expect(res.summaries.map((s) => s.added)).toEqual([2, 1]);

    const data = await loadAppData(1);
    expect(data.datasets.map((d) => d.id).sort()).toEqual(['dealer_orders:2026-09', 'dealer_orders:2026-10']);
    expect(data.dealerLines).toHaveLength(3);
    const k = orderKpis(buildDealerOrders(data.dealerLines), defaultSettings, 'dealer');
    expect(k.eligible).toBe(3);
    expect(k.eligibleValue).toBe(2 * 5000 + 7000 + 3 * 4000);
    expect((await listHistory())[0].summary).toMatch(/2 files imported/);
  });

  it('persists across a reload: a new database handle sees the same data', async () => {
    await commitItems(await stage([dealerFile('DealerAppOrders-SEPT.csv', SEPT)]));
    resetDbHandle(); // simulates closing the tab and reopening the app
    const data = await loadAppData(2);
    expect(data.dealerLines).toHaveLength(2);
    expect(data.datasets[0].fileName).toBe('DealerAppOrders-SEPT.csv');
    const raw = await loadPayload('dealer_orders:2026-09', true);
    expect(raw?.raw).toHaveLength(2); // untouched source rows are kept for audit
  });

  it('detects a duplicate upload and recommends skipping it', async () => {
    await commitItems(await stage([dealerFile('DealerAppOrders-SEPT.csv', SEPT)]));
    const again = await stage([dealerFile('DealerAppOrders-SEPT.csv', SEPT)]);
    expect(again[0].plan?.duplicateUpload).toBe(true);
    expect(again[0].mode).toBe('skip');
    const res = await commitItems(again);
    expect(res.summaries[0].mode).toBe('skip');
    expect(res.summaries[0].added).toBe(0);
    expect((await loadAppData(3)).dealerLines).toHaveLength(2);
  });

  it('replaces an existing month when a corrected file arrives', async () => {
    await commitItems(await stage([dealerFile('DealerAppOrders-SEPT.csv', SEPT)]));
    const corrected: typeof SEPT = [...SEPT, ['5003', '10063', 1, 2500, 'Rejected', '09-09-2026']];
    const items = await stage([dealerFile('DealerAppOrders-SEPT.csv', corrected)]);
    expect(items[0].plan?.duplicateUpload).toBe(false);
    expect(items[0].plan?.recommended).toBe('replace');
    expect(items[0].plan?.options).toContain('skip');
    const res = await commitItems(items);
    expect(res.summaries[0]).toMatchObject({ mode: 'replace', added: 3, removed: 2 });
    const data = await loadAppData(4);
    expect(data.dealerLines).toHaveLength(3);
    expect(data.datasets).toHaveLength(1); // replaced, not duplicated
  });

  it('keeps stored data when the user chooses skip', async () => {
    await commitItems(await stage([dealerFile('DealerAppOrders-SEPT.csv', SEPT)]));
    const items = (await stage([dealerFile('DealerAppOrders-SEPT.csv', [...SEPT, ['5003', '10063', 1, 2500, 'Rejected', '09-09-2026']])])).map((i) => ({ ...i, mode: 'skip' as const }));
    await commitItems(items);
    expect((await loadAppData(5)).dealerLines).toHaveLength(2);
  });

  it('warns when two files in one batch target the same period', async () => {
    const items = await stage([dealerFile('DealerAppOrders-SEPT.csv', SEPT), dealerFile('DealerAppOrders-SEPT (copy).csv', [...SEPT, ['5009', '10064', 1, 100, 'Fulfilled', '05-09-2026']])]);
    const conflicts = batchConflicts(items);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id).toBe('dealer_orders:2026-09');
    expect(conflicts[0].files).toHaveLength(2);
  });

  it('surfaces a missing required column and still lets the user map it by hand', async () => {
    const client = createInlineClient(() => NOW);
    const analyses = await client.analyze([dealerFile('DealerAppOrders-SEPT.csv', SEPT, { Order_ID: 'Ord_Ref' })]);
    let [item] = itemsFromAnalyses(analyses);
    if (!item.source) item = { ...item, source: 'dealer_orders', include: true };
    expect(missingForItem(item)).toContain('orderId');
    // supplying the mapping for the missing field repairs the import
    const full = { ...item, mapping: { ...effectiveMapping({ ...item, mapping: undefined }), orderId: 'Ord_Ref' } };
    expect(missingForItem(full)).toEqual([]);
    const normalised = await normalizeItem(client, full);
    expect(normalised.error).toBeUndefined();
    expect(normalised.payload?.records).toHaveLength(2);
    expect(normalised.payload?.issues.some((i) => i.code === 'MISSING_REQUIRED_COLUMN')).toBe(false);

    // without the mapping the rows are set aside and counted - never silently dropped
    const unmapped = await normalizeItem(client, { ...item, mapping: undefined });
    expect(unmapped.payload?.records).toHaveLength(0);
    expect(unmapped.payload?.meta.invalidCount).toBe(2);
    expect(unmapped.payload?.issues.some((i) => i.code === 'MISSING_REQUIRED_COLUMN')).toBe(true);
  });

  it('does not import an unidentified file and does not disturb the others', async () => {
    const junk = csvInput('random-notes.csv', 'a,b\n1,2\n');
    const items = await stage([junk, dealerFile('DealerAppOrders-SEPT.csv', SEPT)]);
    expect(items[0].include).toBe(false);
    expect(items[1].include).toBe(true);
    const res = await commitItems(items);
    expect(res.summaries).toHaveLength(1);
    expect(res.failed).toEqual([]);
    expect((await listMeta()).map((m) => m.id)).toEqual(['dealer_orders:2026-09']);
  });

  it('reports a file that cannot be normalised without importing it', async () => {
    const client = createInlineClient(() => NOW);
    const [a] = await client.analyze([dealerFile('DealerAppOrders-SEPT.csv', SEPT)]);
    const [item] = itemsFromAnalyses([a]);
    client.release([a.id]);
    const out = await normalizeItem(client, item);
    expect(out.error).toMatch(/no longer loaded|Upload it again/i);
    expect(out.payload).toBeUndefined();
  });

  it('removes one dataset, then resets everything', async () => {
    await commitItems(await stage([dealerFile('DealerAppOrders-SEPT.csv', SEPT), dealerFile('DealerAppOrders-oct.csv', OCT)]));
    await removeDataset('dealer_orders:2026-09');
    expect((await loadAppData(6)).dealerLines).toHaveLength(1);
    await resetAll();
    expect((await listMeta())).toEqual([]);
    expect((await listHistory())).toEqual([]);
  });
});

describe('range sources (DataSense orders): merge versus replace', () => {
  const header = 'Order NO,Order Date,Invoice NO,Dealer Name,Employee Name,Role,city,value of Order,Cycles volume,Cycles value,spares value,spares volume,Status';
  const file = (name: string, rows: string[]) => csvInput(name, [header, ...rows].join('\n'));
  const row = (no: string, date: string, value: number) => `${no},${date},,Dealer A [10061],Emp [E1],SO,Pune,${value},1,${value},0,0,Billing`;

  it('merges a file that starts after the stored range by order number', async () => {
    await commitItems(await stage([file('Order Punched Report- Datasense - a.csv', [row('0030000001', '01-Oct-2026', 100), row('0030000002', '02-Oct-2026', 200)])]));
    const items = await stage([file('Order Punched Report- Datasense - b.csv', [row('0030000003', '10-Oct-2026', 300), row('0030000004', '11-Oct-2026', 400)])]);
    expect(items[0].plan?.recommended).toBe('merge');
    const res = await commitItems(items);
    expect(res.summaries[0]).toMatchObject({ mode: 'merge', added: 2 });
    const data = await loadAppData(8);
    expect(data.dsOrders.map((o) => o.orderNo).sort()).toEqual(['0030000001', '0030000002', '0030000003', '0030000004']);
    expect(data.datasets).toHaveLength(1);
    expect(data.datasets[0].periodStart).toBe('2026-10-01');
    expect(data.datasets[0].periodEnd).toBe('2026-10-11');
  });

  it('replaces when the new file covers the stored range', async () => {
    await commitItems(await stage([file('Order Punched Report- Datasense - a.csv', [row('0030000001', '05-Oct-2026', 100)])]));
    const items = await stage([file('Order Punched Report- Datasense - b.csv', [row('0030000001', '01-Oct-2026', 100), row('0030000005', '09-Oct-2026', 500)])]);
    expect(items[0].plan?.recommended).toBe('replace');
    expect(items[0].plan?.needsConfirmation).toBe(false);
  });

  it('asks for confirmation when the ranges only partly overlap, and merge updates changed records', async () => {
    await commitItems(await stage([file('Order Punched Report- Datasense - a.csv', [row('0030000001', '01-Oct-2026', 100), row('0030000002', '10-Oct-2026', 200)])]));
    const items = await stage([file('Order Punched Report- Datasense - b.csv', [row('0030000002', '10-Oct-2026', 250), row('0030000003', '20-Oct-2026', 300)])]);
    expect(items[0].plan?.needsConfirmation).toBe(true);
    const merged = await commitItems(items.map((i) => ({ ...i, mode: 'merge' as const })));
    expect(merged.summaries[0]).toMatchObject({ mode: 'merge', added: 1, updated: 1, unchanged: 0 });
    const data = await loadAppData(9);
    expect(data.dsOrders).toHaveLength(3);
    expect(data.dsOrders.find((o) => o.orderNo === '0030000002')?.value).toBe(250);
  });
});
