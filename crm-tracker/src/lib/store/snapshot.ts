// Embedded data snapshot (single-file HTML build only).
// The snapshot holds the canonical records of the MIS files that were current when the page was built,
// gzip-compressed and base64-encoded. On the first open it is copied into IndexedDB, after which the page
// behaves like the normal app: new files can be imported or replaced and single datasets removed.
// There is no button to load the snapshot again or to wipe everything; the snapshot is only a starting point.
import { SNAPSHOT } from '@snapshot';
import type { AppData, DatasetPayload } from '../types';
import { markClean } from '../sync/state';
import { addHistory, assembleAppData, kvGet, kvSet, listMeta, removeDataset, saveDataset } from './db';

export interface SnapshotBundle {
  info: { label: string; builtAt: string; datasets: number };
  /** gzip(JSON(DatasetPayload[])) as base64. Source rows are left out: only meta, records and issues. */
  b64: string;
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function decodeSnapshot(): Promise<DatasetPayload[]> {
  if (!SNAPSHOT) return [];
  const bin = atob(SNAPSHOT.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const payloads = JSON.parse(await gunzip(bytes)) as DatasetPayload[];
  return payloads.map((p) => ({ ...p, raw: p.raw ?? [] }));
}

/** Copies the snapshot into storage. Datasets with the same id are replaced. */
export async function loadSnapshotIntoStore(): Promise<number> {
  const payloads = await decodeSnapshot();
  for (const p of payloads) await saveDataset(p);
  await markClean(payloads.map((p) => p.meta));
  await kvSet('snapshotSeededAt', new Date().toISOString());
  await kvSet('snapshotVersion', SNAPSHOT?.info.label);
  if (payloads.length) {
    await addHistory({
      at: new Date().toISOString(),
      action: 'import',
      ok: true,
      summary: `Loaded the data embedded in this page (${SNAPSHOT?.info.label}): ${payloads.length} datasets.`,
    });
  }
  return payloads.length;
}

/** Datasets that a newer embedded snapshot replaces once in a browser that was seeded by an older one. */
const REFRESHED_BY_NEWER_SNAPSHOT = ['ds_orders', 'ds_complaints', 'issue_tracker'];
/** Datasets a newer snapshot adds only where the browser has none yet (an imported one is never overwritten). */
const ADDED_IF_MISSING = ['ds_usage'];

/**
 * First open: an empty store receives the snapshot. A browser that already holds data is never refilled, with one
 * exception: when the page carries a newer snapshot (its label differs from the one recorded in the store) the
 * DataSense orders, DataSense complaints and issue tracker datasets are replaced once; everything else is kept.
 */
export async function seedIfFirstOpen(): Promise<void> {
  if (!SNAPSHOT) return;
  const version = SNAPSHOT.info.label;
  if ((await kvGet<string | null>('snapshotVersion', null)) === version) return;
  if (!(await kvGet<string | null>('snapshotSeededAt', null))) {
    if ((await listMeta()).length > 0) {
      await kvSet('snapshotSeededAt', 'existing-data');
      await kvSet('snapshotVersion', version);
      return;
    }
    await loadSnapshotIntoStore();
    await kvSet('snapshotVersion', version);
    return;
  }
  for (const m of await listMeta()) if (REFRESHED_BY_NEWER_SNAPSHOT.includes(m.source)) await removeDataset(m.id);
  const have = new Set((await listMeta()).map((m) => m.source));
  const refreshed: DatasetPayload[] = [];
  for (const p of await decodeSnapshot()) {
    if (REFRESHED_BY_NEWER_SNAPSHOT.includes(p.meta.source) || (ADDED_IF_MISSING.includes(p.meta.source) && !have.has(p.meta.source))) {
      await saveDataset(p);
      refreshed.push(p);
    }
  }
  await markClean(refreshed.map((p) => p.meta));
  await kvSet('snapshotVersion', version);
}

/** When browser storage cannot be used (some browsers block it for local files) the page still shows the snapshot. */
export async function snapshotAppData(version: number): Promise<AppData | null> {
  if (!SNAPSHOT) return null;
  const payloads = await decodeSnapshot();
  return assembleAppData(version, payloads.map((p) => ({ meta: p.meta, records: p.records, issues: p.issues })));
}
