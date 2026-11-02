// Applying the published version to this browser, and publishing local changes from it.
import type { DatasetPayload } from '../types';
import { loadPayload, removeDataset, saveDataset } from '../store/db';
import { decodeDataset, encodeDataset, sha256Hex } from '../publish/codec.js';
import { diffDatasets } from '../publish/diff.js';
import { sanitizePayload } from '../publish/sanitize.js';
import type { DatasetChange, PublishedDataset, SnapshotStatus } from '../publish/types.js';
import { adminPublish, fetchDatasetBytes, fetchStatus, stagePart, type PublishOutcome } from './api';
import { ensureBaseline, loadSync, localChanges, markClean, metaSig, saveSync } from './state';
import { decodeSnapshot } from '../store/snapshot';

export interface SyncResult {
  state: 'none' | 'offline' | 'current' | 'updated';
  /** the publishing service answered and is set up (nothing may be published yet) */
  configured: boolean;
  versionId: string | null;
  publishedAt: string | null;
  /** dataset ids written to this browser */
  changed: string[];
  /** dataset ids left alone because this browser holds an unpublished change to them */
  keptLocal: string[];
}

async function downloadVerified(d: PublishedDataset): Promise<DatasetPayload> {
  const bytes = await fetchDatasetBytes(d.sha256);
  if ((await sha256Hex(bytes)) !== d.sha256) throw new Error(`Downloaded data for ${d.id} does not match its checksum; it was not applied.`);
  const p = await decodeDataset(bytes);
  if (p.meta.id !== d.id) throw new Error(`Downloaded data for ${d.id} is for ${p.meta.id}; it was not applied.`);
  return p;
}

/** Runs one task at a time across tabs (Web Locks), falling back to just running it. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (typeof navigator !== 'undefined' ? navigator.locks : undefined) as LockManager | undefined;
  return locks ? (locks.request('crm-published-sync', fn) as Promise<T>) : fn();
}

/**
 * Brings this browser up to the published version. Embedded data stays in place until the first successful sync and
 * for every dataset the published version does not carry, so a missing or failing backend changes nothing.
 */
export function syncPublished(opts: { force?: boolean; status?: SnapshotStatus | null } = {}): Promise<SyncResult> {
  return exclusive(async () => {
    const st = opts.status === undefined ? await fetchStatus() : opts.status;
    const state = await ensureBaseline();
    if (!st) return { state: 'offline', configured: false, versionId: state.versionId, publishedAt: state.publishedAt, changed: [], keptLocal: state.keptLocal };
    if (!st.configured || !st.version) return { state: 'none', configured: st.configured, versionId: state.versionId, publishedAt: state.publishedAt, changed: [], keptLocal: [] };
    const v = st.version;
    const checkedAt = new Date().toISOString();
    if (!opts.force && v.versionId === state.versionId && state.keptLocal.length === 0) {
      await saveSync({ ...state, checkedAt });
      return { state: 'current', configured: true, versionId: v.versionId, publishedAt: st.publishedAt, changed: [], keptLocal: [] };
    }
    const dirty = new Map((await localChanges()).map((c) => [c.id, c]));
    const changed: string[] = [];
    const keptLocal: string[] = [];
    const next = { ...state, shas: { ...state.shas }, sigs: { ...state.sigs } };
    for (const d of v.datasets) {
      if (dirty.has(d.id)) {
        keptLocal.push(d.id);
        continue;
      }
      if (!opts.force && state.shas[d.id] === d.sha256) continue;
      const p = await downloadVerified(d);
      await saveDataset(p);
      next.shas[d.id] = d.sha256;
      next.sigs[d.id] = metaSig(p.meta);
      changed.push(d.id);
    }
    // datasets that were published before and are not any more
    for (const id of Object.keys(state.shas)) {
      if (v.datasets.some((d) => d.id === id) || dirty.has(id)) continue;
      await removeDataset(id);
      delete next.shas[id];
      delete next.sigs[id];
      changed.push(id);
    }
    await saveSync({ ...next, versionId: v.versionId, publishedAt: st.publishedAt, keptLocal, checkedAt });
    return { state: 'updated', configured: true, versionId: v.versionId, publishedAt: st.publishedAt, changed, keptLocal };
  });
}

/** Drops this browser's unpublished change to a dataset: back to the published copy, else the embedded one, else gone. */
export async function discardLocalChange(id: string): Promise<void> {
  await exclusive(async () => {
    const state = await loadSync();
    const st = await fetchStatus();
    const pub = st?.version?.datasets.find((d) => d.id === id);
    let payload: DatasetPayload | null = null;
    if (pub) payload = await downloadVerified(pub);
    else payload = (await decodeSnapshot()).find((p) => p.meta.id === id) ?? null;
    if (payload) {
      await saveDataset(payload);
      state.sigs[id] = metaSig(payload.meta);
      if (pub) state.shas[id] = pub.sha256;
    } else {
      await removeDataset(id);
      delete state.sigs[id];
    }
    state.keptLocal = state.keptLocal.filter((k) => k !== id);
    await saveSync(state);
  });
}

/* --------------------------------- publishing --------------------------------- */

export interface PublishPreview {
  id: string;
  kind: 'new' | 'changed' | 'removed';
  fileName: string;
  mode: string;
  records: number;
  /** what the server will do compared with the published copy (the server recomputes this when publishing) */
  diff: Pick<DatasetChange, 'status' | 'inserted' | 'updated' | 'removed' | 'unchanged'>;
  rejected: number;
  /** what the sanitizer would change (counts only) */
  sanitize: { tokenisedKeys: number; scrubbedValues: number; blocked: number };
  /** what `diff` is measured against: the published copy, else the copy embedded in this page, else nothing (a new dataset) */
  baseline: 'published' | 'embedded' | 'none';
}

/** Counts for the review step: local dataset vs the published copy (or nothing), plus a dry run of the sanitizer. */
export async function previewPublish(status: SnapshotStatus | null): Promise<PublishPreview[]> {
  const changes = await localChanges();
  const embedded = await decodeSnapshot().catch(() => [] as DatasetPayload[]);
  const out: PublishPreview[] = [];
  for (const c of changes) {
    const pub = status?.version?.datasets.find((d) => d.id === c.id) ?? null;
    if (c.kind === 'removed') {
      if (pub) out.push({ id: c.id, kind: 'removed', fileName: pub.fileName, mode: '—', records: 0, diff: { status: 'removed', inserted: 0, updated: 0, removed: pub.records, unchanged: 0 }, rejected: 0, sanitize: { tokenisedKeys: 0, scrubbedValues: 0, blocked: 0 }, baseline: 'published' });
      continue;
    }
    const local = (await loadPayload(c.id, false))!;
    const embeddedCopy = embedded.find((p) => p.meta.id === c.id) ?? null;
    const base = pub ? await downloadVerified(pub) : embeddedCopy;
    const { report } = await sanitizePayload(local, { pepper: 'preview-only' });
    out.push({
      id: c.id,
      kind: c.kind,
      fileName: local.meta.fileName,
      mode: local.meta.mode,
      records: local.records.length,
      diff: diffDatasets(base, local),
      rejected: local.meta.duplicateCount + local.meta.invalidCount,
      sanitize: { tokenisedKeys: report.tokenisedKeys, scrubbedValues: report.scrubbedValues, blocked: report.residual.length },
      baseline: pub ? 'published' : embeddedCopy ? 'embedded' : 'none',
    });
  }
  return out;
}

const PART = 3_000_000;

export interface PublishProgress {
  stage: string;
  done: number;
  total: number;
}

/**
 * Uploads the chosen datasets (gzipped, in parts) and asks the server to publish them as one new version. The server
 * validates and sanitizes again and only moves the live pointer if nobody published since `baseVersion`.
 */
export async function publishLocal(opts: { ids: string[]; remove: string[]; baseVersion: string | null; note: string; onProgress?: (p: PublishProgress) => void }): Promise<PublishOutcome> {
  const datasets: Array<{ id: string; upload: string; parts: number; sha256: string }> = [];
  const total = opts.ids.length;
  for (const [i, id] of opts.ids.entries()) {
    opts.onProgress?.({ stage: `Preparing ${id}`, done: i, total });
    const p = await loadPayload(id, false);
    if (!p) throw new Error(`${id} is no longer in this browser.`);
    const { bytes, sha256 } = await encodeDataset(p);
    const upload = crypto.randomUUID();
    const parts = Math.max(1, Math.ceil(bytes.byteLength / PART));
    for (let n = 0; n < parts; n++) {
      opts.onProgress?.({ stage: `Uploading ${id} (${n + 1}/${parts})`, done: i, total });
      await stagePart(upload, n, bytes.slice(n * PART, (n + 1) * PART));
    }
    datasets.push({ id, upload, parts, sha256 });
  }
  opts.onProgress?.({ stage: 'Publishing', done: total, total });
  const out = await adminPublish({ baseVersion: opts.baseVersion, note: opts.note, datasets, remove: opts.remove });
  // take the sanitized copy back, so this browser shows exactly what everybody else will see
  const st = await fetchStatus();
  if (st?.version) {
    // mark what was just published as clean first, otherwise the sync would keep the (unsanitized) local copy
    const state = await loadSync();
    for (const id of opts.remove) delete state.sigs[id];
    await saveSync(state);
    const metas = (await Promise.all(opts.ids.map((id) => loadPayload(id, false)))).flatMap((p) => (p ? [p.meta] : []));
    await markClean(metas);
    await syncPublished({ status: st, force: true });
  }
  return out;
}
