// The browser side against the real server handlers: two "browsers" (two IndexedDB states), one administrator.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../server/store-file.js';
import { readConfig, setContext } from '../server/config.js';
import { resetAuthMemory } from '../server/auth.js';
import * as login from '../server/handlers/login.js';
import * as logout from '../server/handlers/logout.js';
import * as session from '../server/handlers/session.js';
import * as stage from '../server/handlers/stage.js';
import * as publishH from '../server/handlers/publish.js';
import * as rollbackH from '../server/handlers/rollback.js';
import * as versionsH from '../server/handlers/versions.js';
import * as snapshotH from '../server/handlers/snapshot.js';
import * as datasetH from '../server/handlers/dataset.js';
import { getDb, listMeta, loadPayload, removeDataset, resetDbHandle, saveDataset } from '../src/lib/store/db';
import { adminLogin, adminRollback, adminVersions, fetchStatus, resetBackendProbe, syncEnabled } from '../src/lib/sync/api';
import { discardLocalChange, previewPublish, publishLocal, syncPublished } from '../src/lib/sync/published';
import { ensureBaseline, localChanges, markClean } from '../src/lib/sync/state';
import type { DatasetMeta, DatasetPayload } from '../src/lib/types';

const ORIGIN = 'https://crm.example.test';
const ADMIN_SECRET = 'correct horse battery staple';
let dir: string;
let jar = '';
const routes: Record<string, (r: Request) => Promise<Response>> = {
  '/api/snapshot': snapshotH.GET, '/api/dataset': datasetH.GET, '/api/admin/session': session.GET, '/api/admin/versions': versionsH.GET,
  '/api/admin/stage': stagePost(), '/api/admin/publish': publishH.POST, '/api/admin/rollback': rollbackH.POST, '/api/admin/login': login.POST, '/api/admin/logout': logout.POST,
};
function stagePost() {
  return stage.POST;
}

/** fetch() that talks to the handlers directly, carrying the cookie jar of the "browser" */
function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url ?? String(input), ORIGIN);
    const headers = new Headers(init.headers);
    headers.set('x-forwarded-for', '203.0.113.5');
    if (init.method && init.method !== 'GET') headers.set('origin', ORIGIN);
    if (jar && init.credentials !== 'omit') headers.set('cookie', jar);
    const handler = routes[url.pathname];
    if (!handler) return new Response('not found', { status: 404 });
    const res = await handler(new Request(url, { method: init.method ?? 'GET', headers, body: init.body as BodyInit | undefined }));
    const sc = res.headers.get('set-cookie');
    if (sc) jar = /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
    return res;
  }) as typeof fetch;
}

async function freshBrowser() {
  const db = await getDb();
  db.close();
  resetDbHandle();
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase('hero-crm-tracker');
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
  resetDbHandle();
  jar = '';
}

const meta = (source: string, scope: string, over: Partial<DatasetMeta> = {}): DatasetMeta => ({
  id: `${source}:${scope}`, source: source as DatasetMeta['source'], scope, fileName: `${source}-${scope}.csv`, importedAt: '2026-10-29T00:00:00.000Z', periodStart: null, periodEnd: null, period: null,
  rawCount: 0, validCount: 0, duplicateCount: 0, invalidCount: 0, flaggedCount: 0, mappingVersion: 'm1', columns: [], mapping: {}, inference: [], fileSize: 1, mode: 'add', extra: {}, ...over,
});
const usage = (rows: Array<[string, string]>, importedAt = '2026-10-29T00:00:00.000Z', mode: DatasetMeta['mode'] = 'add'): DatasetPayload => ({
  meta: meta('ds_usage', 'all', { importedAt, validCount: rows.length, mode }),
  records: rows.map(([k, status]) => ({ key: k, datasetId: 'ds_usage:all', date: '2026-10-01', dealer: 'D', platform: 'Web', status })),
  issues: [], raw: [{ keep: 'only in the browser' }],
});
const loyalty = (): DatasetPayload => ({
  meta: meta('loyalty_snapshot', '2026-10-26', { validCount: 1 }),
  records: [{ key: '2026-10-26|unverified:917002533087:Cycle house', datasetId: 'loyalty_snapshot:2026-10-26', customerId: 'NOT-CAPTURED', firmName: 'Cycle house', current: 1, entityKey: 'unverified:917002533087:Cycle house', mobileMasked: '91••••••3087' }],
  issues: [], raw: [],
});
const bizom = (): DatasetPayload => ({
  meta: meta('bizom_usage', '2026-10', { validCount: 1 }),
  records: [{ key: '2026-10|1|98', datasetId: 'bizom_usage:2026-10', userId: '1', reportId: '98', accessCount: 2 }],
  issues: [], raw: [],
});

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sync-'));
  setContext({ cfg: { ...readConfig({ CRM_ADMIN_SECRET: ADMIN_SECRET, CRM_SESSION_SECRET: 's'.repeat(40), CRM_PUBLISH_PEPPER: 'p'.repeat(40) }) }, store: new FileStore(dir), now: () => Date.now() });
  resetAuthMemory();
  resetBackendProbe();
  installFetch();
  await freshBrowser();
});
afterEach(() => {
  setContext(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a viewer', () => {
  it('keeps the embedded data when there is no backend, nothing is published, or the network fails', async () => {
    await saveDataset(bizom());
    await markClean([bizom().meta]);
    setContext(null);
    expect((await syncPublished()).state).toBe('none'); // no store configured: the public API answers configured:false
    const keep = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    expect((await syncPublished()).state).toBe('offline');
    globalThis.fetch = keep;
    expect((await listMeta()).map((m) => m.id)).toEqual(['bizom_usage:2026-10']);
  });
  it('receives what the administrator publishes, sanitized, and leaves datasets that were not published alone', async () => {
    // browser A: the administrator
    await saveDataset(bizom());
    await markClean([bizom().meta]); // seeded from the embedded snapshot: clean
    await saveDataset(usage([['a', 'Open'], ['b', 'Open']])); // then the administrator imports two files
    await saveDataset(loyalty());
    await adminLogin(ADMIN_SECRET);
    const st0 = await fetchStatus();
    expect((await localChanges()).map((c) => [c.id, c.kind])).toEqual([['ds_usage:all', 'new'], ['loyalty_snapshot:2026-10-26', 'new']]);
    const out = await publishLocal({ ids: ['ds_usage:all', 'loyalty_snapshot:2026-10-26'], remove: [], baseVersion: st0!.version?.versionId ?? null, note: 'first' });
    expect(out.changes.map((c) => [c.id, c.status, c.inserted])).toEqual([['ds_usage:all', 'new', 2], ['loyalty_snapshot:2026-10-26', 'new', 1]]);
    // the administrator's own copy is now the sanitized published one, with nothing left to publish
    expect(await localChanges()).toEqual([]);
    expect(JSON.stringify((await loadPayload('loyalty_snapshot:2026-10-26'))!.records)).not.toContain('917002533087');

    // browser B: a viewer seeded with the embedded bizom dataset only
    await freshBrowser();
    await saveDataset(bizom());
    await markClean([bizom().meta]);
    const r = await syncPublished();
    expect(r).toMatchObject({ state: 'updated', changed: ['ds_usage:all', 'loyalty_snapshot:2026-10-26'] });
    expect((await listMeta()).map((m) => m.id).sort()).toEqual(['bizom_usage:2026-10', 'ds_usage:all', 'loyalty_snapshot:2026-10-26']);
    const u = (await loadPayload('ds_usage:all'))!;
    expect(u.records).toHaveLength(2);
    expect(u.raw).toEqual([]); // raw rows never travel
    expect((await syncPublished()).state).toBe('current'); // nothing new: no download
  });
  it('picks up a newer version on the next check, and a rollback', async () => {
    await adminLogin(ADMIN_SECRET);
    await saveDataset(usage([['a', 'Open']]));
    const v1 = await publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: null, note: 'one' });
    await saveDataset(usage([['a', 'Open'], ['b', 'Open']], '2026-11-02T00:00:00.000Z', 'merge'));
    const v2 = await publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: v1.versionId, note: 'two' });
    expect(v2.changes[0]).toMatchObject({ status: 'changed', inserted: 1 });

    await freshBrowser();
    await syncPublished();
    expect((await loadPayload('ds_usage:all'))!.records).toHaveLength(2);
    // administrator (another browser) restores version one
    jar = '';
    await adminLogin(ADMIN_SECRET);
    await adminRollback(v1.versionId!, v2.versionId!);
    jar = '';
    const r = await syncPublished();
    expect(r.state).toBe('updated');
    expect((await loadPayload('ds_usage:all'))!.records).toHaveLength(1);
  });
  it('never overwrites an unpublished local import, and says so', async () => {
    await adminLogin(ADMIN_SECRET);
    await saveDataset(usage([['a', 'Open']]));
    const v1 = await publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: null, note: 'one' });
    // another administrator publishes a newer one while this browser holds a local, unpublished import
    await saveDataset(usage([['a', 'Open'], ['mine', 'Open']], '2026-11-03T00:00:00.000Z', 'merge')); // local change
    const local = (await loadPayload('ds_usage:all'))!;
    await freshBrowser();
    await saveDataset(usage([['a', 'Open'], ['b', 'Open']], '2026-11-02T00:00:00.000Z'));
    await adminLogin(ADMIN_SECRET);
    await publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: v1.versionId, note: 'two' });
    // back in the first browser
    await freshBrowser();
    await saveDataset(usage([['a', 'Open']]));
    await markClean([usage([['a', 'Open']]).meta]);
    await saveDataset(local); // the unpublished import
    const r = await syncPublished();
    expect(r.keptLocal).toEqual(['ds_usage:all']);
    expect((await loadPayload('ds_usage:all'))!.records.map((x) => (x as { key: string }).key)).toEqual(['a', 'mine']);
    expect((await localChanges()).map((c) => [c.id, c.kind])).toEqual([['ds_usage:all', 'changed']]);
    // discarding the local change goes back to the published copy
    await discardLocalChange('ds_usage:all');
    expect((await loadPayload('ds_usage:all'))!.records.map((x) => (x as { key: string }).key)).toEqual(['a', 'b']);
    expect(await localChanges()).toEqual([]);
  });
  it('treats a local removal as a pending change, not something the next sync undoes', async () => {
    await adminLogin(ADMIN_SECRET);
    await saveDataset(usage([['a', 'Open']]));
    await saveDataset(bizom());
    await publishLocal({ ids: ['ds_usage:all', 'bizom_usage:2026-10'], remove: [], baseVersion: null, note: 'one' });
    await removeDataset('bizom_usage:2026-10');
    expect((await localChanges()).map((c) => [c.id, c.kind])).toEqual([['bizom_usage:2026-10', 'removed']]);
    expect((await syncPublished({ force: true })).keptLocal).toContain('bizom_usage:2026-10');
    expect((await listMeta()).map((m) => m.id)).toEqual(['ds_usage:all']);
    const prev = await previewPublish(await fetchStatus());
    expect(prev).toEqual([expect.objectContaining({ id: 'bizom_usage:2026-10', kind: 'removed', diff: expect.objectContaining({ removed: 1 }) })]);
    const base = (await fetchStatus())!.version!.versionId;
    await publishLocal({ ids: [], remove: ['bizom_usage:2026-10'], baseVersion: base, note: 'drop' });
    expect((await fetchStatus())!.version!.datasets.map((d) => d.id)).toEqual(['ds_usage:all']);
    expect(await localChanges()).toEqual([]);
  });
  it('a browser from before this feature gets a clean baseline, so it receives published updates', async () => {
    await saveDataset(bizom()); // stored by an older build: no sync state at all
    await saveDataset(usage([['a', 'Open']]));
    expect(await localChanges()).toEqual([]);
    expect(Object.keys((await ensureBaseline()).sigs).sort()).toEqual(['bizom_usage:2026-10', 'ds_usage:all']);
  });
});

describe('hosts without a backend', () => {
  it('asks a static host once, then stops asking', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('<html>spa</html>', { status: 200, headers: { 'content-type': 'text/html' } }); }) as typeof fetch;
    expect(await fetchStatus()).toBeNull();
    expect(syncEnabled()).toBe(false);
    expect(await fetchStatus()).toBeNull();
    expect(await syncPublished()).toMatchObject({ state: 'offline' });
    expect(calls).toBe(1); // the host answered /api with its own page: no backend, no more requests
    resetBackendProbe();
    globalThis.fetch = (async () => { calls++; return new Response('nope', { status: 404 }); }) as typeof fetch;
    expect(await fetchStatus()).toBeNull();
    expect(syncEnabled()).toBe(false);
  });
});

describe('the administrator', () => {
  it('previews what a publish does before doing it, including what the sanitizer would change', async () => {
    await adminLogin(ADMIN_SECRET);
    await saveDataset(usage([['a', 'Open'], ['b', 'Open']]));
    await saveDataset(loyalty());
    const v1 = await publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: null, note: 'one' });
    await saveDataset(usage([['a', 'Open'], ['b', 'Billing'], ['c', 'Open']], '2026-11-02T00:00:00.000Z', 'merge'));
    const prev = await previewPublish(await fetchStatus());
    const u = prev.find((p) => p.id === 'ds_usage:all')!;
    expect(u).toMatchObject({ kind: 'changed', mode: 'merge', records: 3, diff: { status: 'changed', inserted: 1, updated: 1, unchanged: 1, removed: 0 } });
    const l = prev.find((p) => p.id === 'loyalty_snapshot:2026-10-26')!;
    expect(l).toMatchObject({ kind: 'new', baseline: 'none', sanitize: { tokenisedKeys: 2, blocked: 0 } });
    expect(v1.versionId).toBeTruthy();
  });
  it('is told when someone else published first, and nothing is lost', async () => {
    await adminLogin(ADMIN_SECRET);
    await saveDataset(usage([['a', 'Open']]));
    const v1 = await publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: null, note: 'one' });
    await saveDataset(usage([['a', 'Open'], ['b', 'Open']], '2026-11-02T00:00:00.000Z', 'merge'));
    await publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: v1.versionId, note: 'two' });
    await saveDataset(usage([['x', 'Open']], '2026-11-03T00:00:00.000Z', 'replace'));
    await expect(publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: v1.versionId, note: 'stale' })).rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect((await adminVersions()).versions).toHaveLength(2);
    expect((await localChanges()).map((c) => c.id)).toEqual(['ds_usage:all']); // still pending, still in this browser
  });
  it('cannot publish without signing in', async () => {
    await saveDataset(usage([['a', 'Open']]));
    await expect(publishLocal({ ids: ['ds_usage:all'], remove: [], baseVersion: null, note: '' })).rejects.toMatchObject({ status: 401 });
    expect((await fetchStatus())!.version).toBeNull();
  });
});
