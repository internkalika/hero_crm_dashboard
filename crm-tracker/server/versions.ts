// Versioned publishing on top of a Store.
//
// Layout (all under the configured prefix):
//   current.json                          the ONLY mutable object: { versionId, publishedAt }
//   versions/<versionId>/manifest.json    immutable: which dataset blobs make up that version, and what changed
//   datasets/<sha256>.json.gz             immutable, content-addressed, sanitized datasets (shared between versions)
//   staging/<uploadId>/<part>             chunks of a dataset being uploaded (deleted after publishing)
//
// A publish writes new immutable objects first and moves current.json last, with a compare-and-swap on its etag.
// So the active version is always a complete, valid one, two simultaneous publishes cannot both win, and a failure
// at any point leaves at most unreferenced blobs. Rollback is a new version that re-points to older dataset blobs.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { diffDatasets } from '../src/lib/publish/diff.js';
import { decodeDataset, encodeDataset, sha256Hex } from '../src/lib/publish/codec.js';
import { REMOVED, MOBILE_RE, EMAIL_RE, sanitizePayload } from '../src/lib/publish/sanitize.js';
import { MAX_DATASET_JSON_BYTES, validatePayload } from '../src/lib/publish/validate.js';
import type { CurrentPointer, DatasetChange, PublishedDataset, SnapshotStatus, VersionManifest, VersionSummary } from '../src/lib/publish/types.js';
import type { DatasetPayload } from '../src/lib/types.js';
import { paths, type Context } from './config.js';
import { HttpError } from './http.js';
import { PreconditionFailed } from './store.js';

export const MAX_PART_BYTES = 3_500_000;
export const MAX_PARTS = 16; // ~56 MB gzipped per dataset: far above the real ones (the largest is under 2 MB)
const VERSION_RE = /^v\d{8}T\d{6}Z-[0-9a-f]{6}$/;
const UPLOAD_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const dec = <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T;

export const newVersionId = (nowMs: number) => `v${new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${crypto.randomBytes(3).toString('hex')}`;

const conflict = (currentVersion: string | null) =>
  new HttpError(409, 'conflict', 'The published data changed while you were working. Reload and try again.', { currentVersion });

/* ------------------------------------ reads ------------------------------------ */

export async function readCurrent(ctx: Context): Promise<{ pointer: CurrentPointer; etag: string } | null> {
  const o = await ctx.store!.getBytes(paths(ctx.cfg).current);
  return o ? { pointer: dec<CurrentPointer>(o.bytes), etag: o.etag } : null;
}

export async function readManifest(ctx: Context, versionId: string): Promise<VersionManifest | null> {
  if (!VERSION_RE.test(versionId)) throw new HttpError(400, 'bad_version', 'Invalid version id.');
  const o = await ctx.store!.getBytes(paths(ctx.cfg).manifest(versionId));
  return o ? dec<VersionManifest>(o.bytes) : null;
}

export async function listVersions(ctx: Context, limit = 100): Promise<VersionSummary[]> {
  const cur = await readCurrent(ctx);
  const entries = (await ctx.store!.list(paths(ctx.cfg).versionsPrefix)).filter((e) => e.path.endsWith('/manifest.json'));
  const ids = entries.map((e) => e.path.split('/').slice(-2)[0]).filter((id) => VERSION_RE.test(id)).sort().reverse().slice(0, limit);
  const out: VersionSummary[] = [];
  for (const id of ids) {
    const m = await readManifest(ctx, id);
    if (!m) continue;
    out.push({ versionId: m.versionId, createdAt: m.createdAt, action: m.action, parent: m.parent, restoredFrom: m.restoredFrom, note: m.note, datasets: m.datasets.length, records: m.datasets.reduce((n, d) => n + d.records, 0), current: m.versionId === cur?.pointer.versionId });
  }
  return out;
}

export async function publicStatus(ctx: Context): Promise<SnapshotStatus> {
  const cur = await readCurrent(ctx);
  if (!cur) return { configured: true, version: null, publishedAt: null };
  const m = await readManifest(ctx, cur.pointer.versionId);
  if (!m) return { configured: true, version: null, publishedAt: null };
  return { configured: true, version: { versionId: m.versionId, createdAt: m.createdAt, action: m.action, note: m.note, datasets: m.datasets }, publishedAt: cur.pointer.publishedAt };
}

/** Streams a published dataset. Only datasets of the CURRENT version are served: a rolled-back dataset is not retrievable. */
export async function datasetStream(ctx: Context, sha: string) {
  if (!SHA_RE.test(sha)) throw new HttpError(400, 'bad_sha', 'Invalid dataset address.');
  const status = await publicStatus(ctx);
  if (!status.version?.datasets.some((d) => d.sha256 === sha)) throw new HttpError(404, 'not_found', 'No such published dataset.');
  const o = await ctx.store!.getStream(paths(ctx.cfg).dataset(sha));
  if (!o) throw new HttpError(404, 'not_found', 'No such published dataset.');
  return o;
}

/* ----------------------------------- staging ----------------------------------- */

export async function stagePart(ctx: Context, upload: string, part: number, bytes: Uint8Array) {
  if (!UPLOAD_RE.test(upload)) throw new HttpError(400, 'bad_upload', 'Invalid upload id.');
  if (!Number.isInteger(part) || part < 0 || part >= MAX_PARTS) throw new HttpError(400, 'bad_part', 'Invalid part number.');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PART_BYTES) throw new HttpError(413, 'too_large', `A part must be between 1 byte and ${MAX_PART_BYTES} bytes.`);
  await ctx.store!.put(paths(ctx.cfg).staging(upload, part), bytes, { contentType: 'application/octet-stream', overwrite: true });
}

async function assemble(ctx: Context, d: IncomingDataset): Promise<Uint8Array> {
  if (!UPLOAD_RE.test(d.upload) || !Number.isInteger(d.parts) || d.parts < 1 || d.parts > MAX_PARTS || !SHA_RE.test(d.sha256)) throw new HttpError(400, 'bad_dataset', `Invalid upload description for ${d.id}.`);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < d.parts; i++) {
    const o = await ctx.store!.getBytes(paths(ctx.cfg).staging(d.upload, i));
    if (!o) throw new HttpError(400, 'missing_part', `Part ${i + 1} of ${d.id} was not received.`);
    chunks.push(o.bytes);
  }
  const all = Buffer.concat(chunks);
  if ((await sha256Hex(all)) !== d.sha256) throw new HttpError(400, 'checksum', `The upload of ${d.id} is corrupted (checksum mismatch).`);
  return all;
}

async function clearStaging(ctx: Context, uploads: Array<{ upload: string; parts: number }>) {
  const p = paths(ctx.cfg);
  const dels = uploads.flatMap((u) => Array.from({ length: u.parts }, (_, i) => p.staging(u.upload, i)));
  await ctx.store!.del(dels).catch(() => undefined);
  // abandoned uploads (older than a day)
  const old = (await ctx.store!.list(p.stagingPrefix).catch(() => [])).filter((e) => ctx.now() - Date.parse(e.uploadedAt) > 24 * 3600_000).map((e) => e.path);
  await ctx.store!.del(old).catch(() => undefined);
}

/* ---------------------------------- publishing ---------------------------------- */

export interface IncomingDataset {
  id: string;
  upload: string;
  parts: number;
  /** sha-256 of the gzipped bytes the client uploaded (integrity of the transfer, not trusted for content) */
  sha256: string;
}
export interface PublishRequest {
  baseVersion: string | null;
  note?: string;
  datasets: IncomingDataset[];
  remove?: string[];
}
export interface PublishResult {
  unchanged: boolean;
  versionId: string | null;
  createdAt: string | null;
  changes: DatasetChange[];
}

const scrubNote = (s: unknown) => (typeof s === 'string' ? s.replace(EMAIL_RE, REMOVED).replace(MOBILE_RE, REMOVED).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) : '');

async function writeDatasetBlob(ctx: Context, sha: string, bytes: Uint8Array) {
  try {
    await ctx.store!.put(paths(ctx.cfg).dataset(sha), bytes, { contentType: 'application/gzip', ifNotExists: true });
  } catch (e) {
    if (!(e instanceof PreconditionFailed)) throw e; // same content already stored: that is the point of content addressing
  }
}

async function loadPublished(ctx: Context, sha: string): Promise<DatasetPayload | null> {
  const o = await ctx.store!.getBytes(paths(ctx.cfg).dataset(sha));
  return o ? decodeDataset(o.bytes) : null;
}

const entryOf = (p: DatasetPayload, sha256: string, bytes: number): PublishedDataset => ({
  id: p.meta.id, source: p.meta.source, scope: p.meta.scope, fileName: p.meta.fileName, period: p.meta.period, periodStart: p.meta.periodStart, periodEnd: p.meta.periodEnd,
  records: p.records.length, sha256, bytes, importedAt: p.meta.importedAt,
});

async function movePointer(ctx: Context, cur: { etag: string } | null, manifest: VersionManifest) {
  const p = paths(ctx.cfg);
  await ctx.store!.put(p.manifest(manifest.versionId), enc(manifest), { contentType: 'application/json', ifNotExists: true });
  const pointer: CurrentPointer = { schema: 1, versionId: manifest.versionId, publishedAt: manifest.createdAt };
  try {
    await ctx.store!.put(p.current, enc(pointer), cur ? { contentType: 'application/json', ifMatch: cur.etag, overwrite: true } : { contentType: 'application/json', ifNotExists: true });
  } catch (e) {
    if (e instanceof PreconditionFailed) throw conflict((await readCurrent(ctx))?.pointer.versionId ?? null);
    throw e;
  }
}

export async function publish(ctx: Context, req: PublishRequest): Promise<PublishResult> {
  if (!req || !Array.isArray(req.datasets) || req.datasets.length > 40 || (req.remove && (!Array.isArray(req.remove) || req.remove.length > 40))) throw new HttpError(400, 'bad_request', 'Invalid publish request.');
  const cur = await readCurrent(ctx);
  if ((cur?.pointer.versionId ?? null) !== (req.baseVersion ?? null)) throw conflict(cur?.pointer.versionId ?? null);
  const prev = cur ? await readManifest(ctx, cur.pointer.versionId) : null;
  if (cur && !prev) throw new HttpError(500, 'broken_store', 'The current version has no manifest.');
  const prevById = new Map((prev?.datasets ?? []).map((d) => [d.id, d]));
  const next = new Map(prevById);
  const changes: DatasetChange[] = [];

  for (const d of req.datasets) {
    const gz = await assemble(ctx, d);
    let payload: DatasetPayload;
    try {
      payload = JSON.parse(new TextDecoder().decode(zlib.gunzipSync(gz, { maxOutputLength: MAX_DATASET_JSON_BYTES }))) as DatasetPayload;
    } catch {
      throw new HttpError(400, 'bad_dataset', `${d.id} could not be read (not a gzipped dataset, or too large).`);
    }
    payload.raw = [];
    const v = validatePayload(payload);
    if (!v.ok) throw new HttpError(422, 'invalid_dataset', `${d.id} failed validation.`, { errors: v.errors.slice(0, 10) });
    if (payload.meta.id !== d.id) throw new HttpError(422, 'invalid_dataset', `The upload for ${d.id} contains ${payload.meta.id}.`);
    const { payload: clean, report } = await sanitizePayload(payload, { pepper: ctx.cfg.pepper! });
    if (report.residual.length) throw new HttpError(422, 'personal_data', `${d.id} still contains personal data after sanitizing and was not published.`, { fields: report.residual.slice(0, 10) });
    const { bytes, sha256 } = await encodeDataset(clean);
    const before = prevById.get(d.id);
    let diff: ReturnType<typeof diffDatasets>;
    if (before && before.sha256 === sha256) diff = { status: 'unchanged', inserted: 0, updated: 0, removed: 0, unchanged: clean.records.length };
    else diff = diffDatasets(before ? await loadPublished(ctx, before.sha256) : null, clean);
    changes.push({ id: d.id, ...diff, rejected: clean.meta.duplicateCount + clean.meta.invalidCount, mode: clean.meta.mode, sanitized: { tokenisedKeys: report.tokenisedKeys, scrubbedValues: report.scrubbedValues } });
    if (diff.status !== 'unchanged') {
      await writeDatasetBlob(ctx, sha256, bytes);
      next.set(d.id, entryOf(clean, sha256, bytes.byteLength));
    }
  }
  for (const id of req.remove ?? []) {
    const before = prevById.get(id);
    if (before && next.delete(id)) changes.push({ id, status: 'removed', inserted: 0, updated: 0, removed: before.records, unchanged: 0, rejected: 0, mode: 'replace', sanitized: { tokenisedKeys: 0, scrubbedValues: 0 } });
  }

  await clearStaging(ctx, req.datasets);
  if (changes.every((c) => c.status === 'unchanged')) return { unchanged: true, versionId: cur?.pointer.versionId ?? null, createdAt: null, changes };

  const createdAt = new Date(ctx.now()).toISOString();
  const manifest: VersionManifest = {
    schema: 1,
    versionId: newVersionId(ctx.now()),
    createdAt,
    action: prev ? 'publish' : 'initial',
    parent: cur?.pointer.versionId ?? null,
    note: scrubNote(req.note),
    datasets: [...next.values()].sort((a, b) => a.id.localeCompare(b.id)),
    changes: changes.filter((c) => c.status !== 'unchanged'),
  };
  await movePointer(ctx, cur, manifest);
  return { unchanged: false, versionId: manifest.versionId, createdAt, changes: manifest.changes };
}

export async function rollback(ctx: Context, req: { toVersion: string; baseVersion: string; note?: string }): Promise<PublishResult> {
  const cur = await readCurrent(ctx);
  if (!cur || cur.pointer.versionId !== req.baseVersion) throw conflict(cur?.pointer.versionId ?? null);
  if (req.toVersion === cur.pointer.versionId) throw new HttpError(400, 'same_version', 'That version is already the published one.');
  const [now, target] = await Promise.all([readManifest(ctx, cur.pointer.versionId), readManifest(ctx, req.toVersion)]);
  if (!now) throw new HttpError(500, 'broken_store', 'The current version has no manifest.');
  if (!target) throw new HttpError(404, 'not_found', 'No such version.');
  for (const d of target.datasets) if (!(await ctx.store!.head(paths(ctx.cfg).dataset(d.sha256)))) throw new HttpError(410, 'gone', `The data of ${d.id} in that version is no longer stored.`);
  const nowById = new Map(now.datasets.map((d) => [d.id, d]));
  const changes: DatasetChange[] = [];
  for (const d of target.datasets) {
    const was = nowById.get(d.id);
    if (was?.sha256 === d.sha256) continue;
    const diff = diffDatasets(was ? await loadPublished(ctx, was.sha256) : null, (await loadPublished(ctx, d.sha256))!);
    changes.push({ id: d.id, ...diff, rejected: 0, mode: 'replace', sanitized: { tokenisedKeys: 0, scrubbedValues: 0 } });
  }
  for (const was of now.datasets) if (!target.datasets.some((d) => d.id === was.id)) changes.push({ id: was.id, status: 'removed', inserted: 0, updated: 0, removed: was.records, unchanged: 0, rejected: 0, mode: 'replace', sanitized: { tokenisedKeys: 0, scrubbedValues: 0 } });
  const createdAt = new Date(ctx.now()).toISOString();
  const manifest: VersionManifest = { schema: 1, versionId: newVersionId(ctx.now()), createdAt, action: 'rollback', parent: cur.pointer.versionId, restoredFrom: req.toVersion, note: scrubNote(req.note) || `Restored ${req.toVersion}`, datasets: target.datasets, changes };
  await movePointer(ctx, cur, manifest);
  return { unchanged: false, versionId: manifest.versionId, createdAt, changes };
}
