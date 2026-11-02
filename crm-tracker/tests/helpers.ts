import fs from 'node:fs';
import path from 'node:path';
import type { DatasetPayload, SourceType } from '../src/lib/types';
import { analyzeInput, normalizeFile } from '../src/lib/ingest/pipeline';
import type { FileInput } from '../src/lib/ingest/readers';

export const DATA_DIR = process.env.CRM_MIS_DIR ?? path.resolve(__dirname, '../data/CRM MIS');
export const HAS_DATA = fs.existsSync(DATA_DIR);
export const NOW = new Date('2026-10-26T12:00:00');

export function loadInput(name: string): FileInput {
  const buf = fs.readFileSync(path.join(DATA_DIR, name));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { name, size: buf.byteLength, buffer: ab };
}

export function ingest(name: string, forced?: SourceType): { payload: DatasetPayload; source: SourceType | null } {
  const input = loadInput(name);
  const { analysis, read } = analyzeInput(input, name);
  if (!read) throw new Error(analysis.error);
  const source = forced ?? analysis.identification.source;
  if (!source) throw new Error(`Not identified: ${name}`);
  return { payload: normalizeFile(read, source, { now: NOW }), source };
}

export function listFiles(): string[] {
  // without the confidential exports the data-dependent suites are skipped (describe.skipIf(!HAS_DATA)); they still get collected
  if (!HAS_DATA) return [];
  return fs.readdirSync(DATA_DIR).filter((f) => !f.startsWith('.'));
}

/** Inline CSV -> FileInput for unit tests */
export function csvInput(name: string, text: string): FileInput {
  const buf = Buffer.from(text, 'utf-8');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { name, size: buf.byteLength, buffer: ab };
}

import type { AppData } from '../src/lib/types';
import { emptyAppData } from '../src/lib/types';
import type { DatasetPayload as DP } from '../src/lib/types';

let cache: { data: AppData; payloads: DP[] } | null = null;

/** Ingest every supplied file and assemble the same AppData the app builds from IndexedDB. */
export function buildAppData(): { data: AppData; payloads: DP[] } {
  if (cache) return cache;
  const data = emptyAppData();
  const payloads: DP[] = [];
  for (const f of listFiles()) {
    try {
      const { payload, source } = ingest(f);
      payloads.push(payload);
      data.datasets.push(payload.meta);
      const recs = payload.records as never[];
      switch (source) {
        case 'dealer_orders': data.dealerLines.push(...recs); break;
        case 'ds_orders': data.dsOrders.push(...recs); break;
        case 'dealer_complaints': data.dealerComplaints.push(...recs); break;
        case 'ds_complaints': data.dsComplaints.push(...recs); break;
        case 'bizom_usage': data.usage.push(...recs); break;
        case 'issue_tracker': data.issues.push(...recs); break;
        case 'ds_employee_activity': data.dsEmployees.push(...recs); break;
        case 'dealer_sfa_activity': data.dealerSfa.push(...recs); break;
        case 'loyalty_snapshot': data.loyalty.push(...recs); break;
        case 'focus_liquidation': data.focus.push(...recs); break;
      }
      for (const i of payload.issues) data.dq.push({ ...i, datasetId: payload.meta.id, source: payload.meta.source, fileName: payload.meta.fileName });
    } catch (e) {
      // unidentified files are simply skipped in the helper
      void e;
    }
  }
  cache = { data, payloads };
  return cache;
}
