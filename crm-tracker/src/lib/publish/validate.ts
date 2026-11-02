// Structural validation of a dataset before it is stored or published. Pure: the browser runs it for the preview
// and the server runs it again on what it receives (it never trusts the client).
import type { DatasetPayload, SourceType } from '../types.js';
import { SOURCES } from '../ingest/sources.js';

export const MAX_RECORDS = 250_000;
export const MAX_DATASET_JSON_BYTES = 60 * 1024 * 1024;

/** Fields every record of a source must carry (checked on all records). */
export const REQUIRED_RECORD_FIELDS: Record<SourceType, string[]> = {
  dealer_orders: ['orderId', 'outletId'],
  dealer_complaints: ['id', 'rawStatus'],
  bizom_usage: ['userId', 'reportId', 'accessCount'],
  issue_tracker: ['pointer', 'status'],
  ds_orders: ['orderNo', 'dealerName'],
  ds_complaints: ['id', 'rawStatus'],
  ds_employee_activity: ['employee', 'role'],
  ds_usage: ['date', 'dealer', 'platform', 'status'],
  dealer_sfa_activity: ['employee', 'role'],
  loyalty_snapshot: ['customerId', 'firmName', 'current'],
  focus_liquidation: ['materialCode', 'plantCode'],
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  records: number;
}

export function validatePayload(p: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bad = (m: string) => errors.push(m);
  if (!p || typeof p !== 'object') return { ok: false, errors: ['The dataset is not an object.'], warnings, records: 0 };
  const d = p as Partial<DatasetPayload>;
  const meta = d.meta;
  if (!meta || typeof meta !== 'object') return { ok: false, errors: ['The dataset has no meta.'], warnings, records: 0 };
  if (!meta.source || !(meta.source in SOURCES)) bad(`Unknown source "${String(meta.source)}".`);
  if (typeof meta.id !== 'string' || meta.id !== `${meta.source}:${meta.scope}`) bad(`Dataset id "${String(meta.id)}" does not match its source and scope.`);
  if (!Array.isArray(d.records)) bad('The dataset has no records array.');
  if (!Array.isArray(d.issues)) bad('The dataset has no issues array.');
  if (errors.length) return { ok: false, errors, warnings, records: 0 };
  const records = d.records as Array<Record<string, unknown>>;
  if (records.length === 0) bad('The dataset has no records.');
  if (records.length > MAX_RECORDS) bad(`The dataset has ${records.length} records; the limit is ${MAX_RECORDS}.`);
  const required = REQUIRED_RECORD_FIELDS[meta!.source as SourceType] ?? [];
  const seen = new Set<string>();
  let dup = 0;
  let missing = 0;
  let wrongDataset = 0;
  let notObject = 0;
  for (const r of records) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      notObject++;
      continue;
    }
    if (typeof r.key !== 'string' || !r.key) {
      missing++;
      continue;
    }
    if (seen.has(r.key)) dup++;
    seen.add(r.key);
    if (r.datasetId !== meta!.id) wrongDataset++;
    if (required.some((f) => r[f] === undefined)) missing++;
  }
  if (notObject) bad(`${notObject} records are not objects.`);
  if (missing) bad(`${missing} records lack a key or a required field (${required.join(', ')}).`);
  if (wrongDataset) bad(`${wrongDataset} records belong to another dataset id.`);
  if (dup) bad(`${dup} records repeat a key: the keys must be unique for merging.`);
  if (typeof meta!.validCount === 'number' && meta!.validCount !== records.length) warnings.push(`meta.validCount (${meta!.validCount}) differs from the number of records (${records.length}).`);
  return { ok: errors.length === 0, errors, warnings, records: records.length };
}
