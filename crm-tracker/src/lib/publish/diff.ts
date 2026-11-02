// What publishing a dataset changes, by record key: inserted / updated / removed / unchanged.
import type { DatasetPayload } from '../types.js';
import type { DatasetChange } from './types.js';
import { hashString } from '../util/parse.js';

const sig = (r: unknown): string => {
  const { datasetId, ...rest } = r as Record<string, unknown>;
  void datasetId;
  return hashString(JSON.stringify(rest));
};

export function diffDatasets(base: DatasetPayload | null, next: DatasetPayload): Pick<DatasetChange, 'status' | 'inserted' | 'updated' | 'removed' | 'unchanged'> {
  if (!base) return { status: 'new', inserted: next.records.length, updated: 0, removed: 0, unchanged: 0 };
  const prev = new Map<string, string>();
  for (const r of base.records as Array<{ key: string }>) prev.set(r.key, sig(r));
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const seen = new Set<string>();
  for (const r of next.records as Array<{ key: string }>) {
    seen.add(r.key);
    const s = prev.get(r.key);
    if (s === undefined) inserted++;
    else if (s === sig(r)) unchanged++;
    else updated++;
  }
  let removed = 0;
  for (const k of prev.keys()) if (!seen.has(k)) removed++;
  return { status: inserted || updated || removed ? 'changed' : 'unchanged', inserted, updated, removed, unchanged };
}
