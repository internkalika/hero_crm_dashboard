// IndexedDB persistence. Large workbooks are never kept in localStorage.
// Layout: one small metadata record, one records+issues record and one raw-rows record per dataset,
// so start-up only has to read what the dashboards need (raw rows load on demand).
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import type {
  AppData,
  ComplaintRec,
  DatasetMeta,
  DatasetPayload,
  DealerOrderLine,
  DQIssue,
  DsOrder,
  EmployeeActivityRec,
  FocusRec,
  IssueRec,
  LoyaltyRec,
  Row,
  UsageRec,
} from '../types';
import { emptyAppData } from '../types';
import type { ImportSummary } from '../ingest/pipeline';

export interface HistoryEntry {
  id?: number;
  at: string;
  action: 'import' | 'remove' | 'reset' | 'replace';
  summary: string;
  items?: ImportSummary[];
  ok: boolean;
}

interface CrmDB extends DBSchema {
  meta: { key: string; value: DatasetMeta };
  records: { key: string; value: { records: unknown[]; issues: DQIssue[] } };
  raw: { key: string; value: Row[] };
  kv: { key: string; value: unknown };
  history: { key: number; value: HistoryEntry };
}

const DB_NAME = 'hero-crm-tracker';
const DB_VERSION = 1;
let dbPromise: Promise<IDBPDatabase<CrmDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<CrmDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CrmDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('records');
        db.createObjectStore('raw');
        db.createObjectStore('kv');
        db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      },
    });
  }
  return dbPromise;
}

/** for tests */
export function resetDbHandle() {
  dbPromise = null;
}

export async function saveDataset(payload: DatasetPayload): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['meta', 'records', 'raw'], 'readwrite');
  await Promise.all([
    tx.objectStore('meta').put(payload.meta),
    tx.objectStore('records').put({ records: payload.records, issues: payload.issues }, payload.meta.id),
    tx.objectStore('raw').put(payload.raw, payload.meta.id),
    tx.done,
  ]);
}

export async function loadPayload(id: string, withRaw = true): Promise<DatasetPayload | null> {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) return null;
  const rec = await db.get('records', id);
  const raw = withRaw ? (await db.get('raw', id)) ?? [] : [];
  return { meta, records: rec?.records ?? [], issues: rec?.issues ?? [], raw };
}

export async function loadRaw(id: string): Promise<Row[]> {
  const db = await getDb();
  return (await db.get('raw', id)) ?? [];
}

export async function listMeta(): Promise<DatasetMeta[]> {
  const db = await getDb();
  return db.getAll('meta');
}

export async function removeDataset(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['meta', 'records', 'raw'], 'readwrite');
  await Promise.all([tx.objectStore('meta').delete(id), tx.objectStore('records').delete(id), tx.objectStore('raw').delete(id), tx.done]);
}

export async function resetAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['meta', 'records', 'raw', 'history'], 'readwrite');
  await Promise.all([tx.objectStore('meta').clear(), tx.objectStore('records').clear(), tx.objectStore('raw').clear(), tx.objectStore('history').clear(), tx.done]);
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const v = await db.get('kv', key);
  return (v as T | undefined) ?? fallback;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put('kv', value, key);
}

export async function addHistory(e: Omit<HistoryEntry, 'id'>): Promise<void> {
  const db = await getDb();
  await db.add('history', e as HistoryEntry);
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const db = await getDb();
  return (await db.getAll('history')).sort((a, b) => b.at.localeCompare(a.at));
}

/* ------------------------------- assembly ------------------------------- */

export async function loadAppData(version: number): Promise<AppData> {
  const db = await getDb();
  const metas = await db.getAll('meta');
  const items: Array<{ meta: DatasetMeta; records: unknown[]; issues: DQIssue[] }> = [];
  for (const m of metas) {
    const rec = await db.get('records', m.id);
    if (rec) items.push({ meta: m, records: rec.records, issues: rec.issues });
  }
  return assembleAppData(version, items);
}

/** Builds the in-memory AppData the dashboards read (from IndexedDB, or from the embedded snapshot). */
export function assembleAppData(version: number, items: Array<{ meta: DatasetMeta; records: unknown[]; issues: DQIssue[] }>): AppData {
  const sorted = [...items].sort((a, b) => (a.meta.source + a.meta.scope).localeCompare(b.meta.source + b.meta.scope));
  const data = emptyAppData();
  data.version = version;
  data.datasets = sorted.map((i) => i.meta);
  for (const { meta: m, records, issues } of sorted) {
    switch (m.source) {
      case 'dealer_orders':
        data.dealerLines.push(...(records as DealerOrderLine[]));
        break;
      case 'ds_orders':
        data.dsOrders.push(...(records as DsOrder[]));
        break;
      case 'dealer_complaints':
        data.dealerComplaints.push(...(records as ComplaintRec[]));
        break;
      case 'ds_complaints':
        data.dsComplaints.push(...(records as ComplaintRec[]));
        break;
      case 'bizom_usage':
        data.usage.push(...(records as UsageRec[]));
        break;
      case 'issue_tracker':
        data.issues.push(...(records as IssueRec[]));
        break;
      case 'ds_employee_activity':
        data.dsEmployees.push(...(records as EmployeeActivityRec[]));
        break;
      case 'dealer_sfa_activity':
        data.dealerSfa.push(...(records as EmployeeActivityRec[]));
        break;
      case 'loyalty_snapshot':
        data.loyalty.push(...(records as LoyaltyRec[]));
        break;
      case 'focus_liquidation':
        data.focus.push(...(records as FocusRec[]));
        break;
    }
    for (const i of issues) data.dq.push({ ...i, datasetId: m.id, source: m.source, fileName: m.fileName });
  }
  return data;
}
