import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeInput, normalizeFile } from '../src/lib/ingest/pipeline';
import { isMultiMonth, splitByMonth } from '../src/lib/ingest/split';
import type { DatasetPayload, DealerOrderLine } from '../src/lib/types';

// the synthetic files the browser end-to-end test imports (tools/compat/make-orders-fixtures.cjs)
const DIR = path.resolve(__dirname, '../tools/compat/fixtures/orders');
const read = (name: string) => {
  const b = fs.readFileSync(path.join(DIR, name));
  return { name, size: b.byteLength, buffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
};
function ingest(name: string) {
  const { analysis, read: r } = analyzeInput(read(name), name);
  if (!r) throw new Error(analysis.error);
  return { source: analysis.identification.source, payload: normalizeFile(r, analysis.identification.source!, { now: new Date('2026-12-20T12:00:00') }) };
}

describe('synthetic order files', () => {
  it('a November Dealer App file is identified and its period is read from the order dates', () => {
    const { source, payload } = ingest('DealerAppOrders-NOV.csv');
    expect(source).toBe('dealer_orders');
    expect(payload.meta.scope).toBe('2026-11');
    expect(payload.meta.id).toBe('dealer_orders:2026-11');
    expect(payload.records).toHaveLength(9);
  });
  it('December needs no code change', () => {
    const { payload } = ingest('DealerAppOrders-DEC.csv');
    expect(payload.meta.scope).toBe('2026-12');
    expect(payload.records).toHaveLength(6);
  });
  it('a workbook with October and November is read as a multi-month file and splits into both months', () => {
    const { payload } = ingest('DealerAppOrders-OCT-NOV.csv');
    expect(isMultiMonth(payload)).toBe(true);
    const parts = splitByMonth(payload as DatasetPayload<DealerOrderLine>);
    expect(parts.map((p) => [p.meta.scope, p.records.length])).toEqual([['2026-10', 3], ['2026-11', 9]]);
  });
  it('the corrected November file has the same orders with a new amount (replace, not add)', () => {
    const a = ingest('DealerAppOrders-NOV.csv').payload.records as DealerOrderLine[];
    const b = ingest('DealerAppOrders-NOV-corrected.csv').payload.records as DealerOrderLine[];
    expect(b.map((l) => l.orderId).sort()).toEqual(a.map((l) => l.orderId).sort());
    expect(a.reduce((s, l) => s + (l.amount ?? 0), 0)).toBe(90000);
    expect(b.reduce((s, l) => s + (l.amount ?? 0), 0)).toBe(180000);
  });
  it('DataSense order files are identified', () => {
    expect(ingest('Order Punched Report - Datasense - nov.csv').source).toBe('ds_orders');
    expect(ingest('Order Punched Report - Datasense - dec.csv').payload.records).toHaveLength(6);
  });
});
