// What this browser knows about the published data, kept in the same IndexedDB as the datasets.
//
// A dataset is "clean" while its signature equals the one recorded when it arrived from the embedded snapshot or from
// the published version. Anything the administrator imports, merges or removes afterwards makes it "dirty": an
// unpublished local change. Syncing never overwrites a dirty dataset, so previewing an import cannot be undone by
// someone else's publish; the Data Management page lists these changes and publishes or discards them.
import type { DatasetMeta } from '../types';
import { kvGet, kvSet, listMeta } from '../store/db';

export interface SyncState {
  /** published version this browser has applied (null: none yet, the embedded snapshot is in use) */
  versionId: string | null;
  publishedAt: string | null;
  /** published dataset id -> sha-256 applied here */
  shas: Record<string, string>;
  /** dataset id -> signature when it was last clean */
  sigs: Record<string, string>;
  /** dataset ids a sync left alone because of a local change */
  keptLocal: string[];
  checkedAt: string | null;
}

const KEY = 'publishedSync';
export const emptySync = (): SyncState => ({ versionId: null, publishedAt: null, shas: {}, sigs: {}, keptLocal: [], checkedAt: null });
export const metaSig = (m: DatasetMeta) => `${m.importedAt}|${m.validCount}|${m.mode}|${m.fileName}`;

export async function loadSync(): Promise<SyncState> {
  return { ...emptySync(), ...(await kvGet<Partial<SyncState>>(KEY, {})) };
}
export const saveSync = (s: SyncState) => kvSet(KEY, s);

/** Marks datasets as clean at their current signature (just seeded or just synced). */
export async function markClean(metas: DatasetMeta[]): Promise<void> {
  const s = await ensureBaseline(); // baseline everything already stored first, or it would look like a local change
  for (const m of metas) s.sigs[m.id] = metaSig(m);
  await saveSync(s);
}

/**
 * First run of this feature in a browser: whatever is stored came from the embedded snapshot (or an earlier import in
 * a build without publishing); treat it as the clean baseline so viewers receive published updates.
 */
export async function ensureBaseline(): Promise<SyncState> {
  const raw = await kvGet<Partial<SyncState> | null>(KEY, null);
  if (raw) return { ...emptySync(), ...raw };
  const s = emptySync();
  for (const m of await listMeta()) s.sigs[m.id] = metaSig(m);
  await saveSync(s);
  return s;
}

export interface LocalChange {
  id: string;
  kind: 'new' | 'changed' | 'removed';
  meta: DatasetMeta | null;
}

export async function localChanges(): Promise<LocalChange[]> {
  const s = await ensureBaseline();
  const metas = await listMeta();
  const have = new Map(metas.map((m) => [m.id, m]));
  const out: LocalChange[] = [];
  for (const m of metas) {
    const sig = s.sigs[m.id];
    if (sig === undefined) out.push({ id: m.id, kind: 'new', meta: m });
    else if (sig !== metaSig(m)) out.push({ id: m.id, kind: 'changed', meta: m });
  }
  for (const id of Object.keys(s.sigs)) if (!have.has(id)) out.push({ id, kind: 'removed', meta: null });
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
