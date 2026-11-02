import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../server/store-file.js';
import { PreconditionFailed, type PutOptions, type Store } from '../server/store.js';
import { setContext, readConfig, type Context } from '../server/config.js';
import { resetAuthMemory, COOKIE, createSessionToken } from '../server/auth.js';
import * as login from '../server/handlers/login.js';
import * as logout from '../server/handlers/logout.js';
import * as session from '../server/handlers/session.js';
import * as stage from '../server/handlers/stage.js';
import * as publishH from '../server/handlers/publish.js';
import * as rollbackH from '../server/handlers/rollback.js';
import * as versionsH from '../server/handlers/versions.js';
import * as snapshotH from '../server/handlers/snapshot.js';
import * as datasetH from '../server/handlers/dataset.js';
import * as healthH from '../server/handlers/health.js';
import { encodeDataset, decodeDataset } from '../src/lib/publish/codec.js';
import type { DatasetMeta, DatasetPayload } from '../src/lib/types.js';
import type { SnapshotStatus, VersionSummary } from '../src/lib/publish/types.js';

const ENV = { CRM_ADMIN_SECRET: 'correct horse battery staple', CRM_SESSION_SECRET: 's'.repeat(40), CRM_PUBLISH_PEPPER: 'p'.repeat(40), CRM_STORE_DIR: '' };
const ORIGIN = 'https://crm.example.test';
let dir: string;
let clock: number;
let store: Store;

const ctxWith = (s: Store | null, env: Record<string, string> = ENV): Context => ({ cfg: { ...readConfig({ ...env, CRM_STORE_DIR: '' }), storeDir: null }, store: s, now: () => clock });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-store-'));
  clock = Date.parse('2026-11-02T10:00:00Z');
  store = new FileStore(dir);
  setContext(ctxWith(store));
  resetAuthMemory();
});
afterEach(() => {
  setContext(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Opts { cookie?: string; body?: unknown; raw?: Uint8Array; admin?: boolean; headers?: Record<string, string>; ip?: string }
const req = (method: string, url: string, o: Opts = {}) => {
  const headers: Record<string, string> = { 'x-forwarded-for': o.ip ?? '203.0.113.7', ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = `${COOKIE}=${o.cookie}`;
  if (o.admin !== false && method !== 'GET') headers['x-crm-admin'] = '1';
  if (method !== 'GET') headers.origin = headers.origin ?? ORIGIN;
  let body: BodyInit | undefined;
  if (o.raw) body = o.raw as BodyInit;
  else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers['content-type'] = 'application/json';
  }
  return new Request(`${ORIGIN}${url}`, { method, headers, body });
};
const cookieOf = (res: Response) => /crm_admin=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
async function signIn(ip?: string) {
  const res = await login.POST(req('POST', '/api/admin/login', { body: { secret: ENV.CRM_ADMIN_SECRET }, ip }));
  expect(res.status).toBe(200);
  return cookieOf(res);
}

const meta = (source: string, over: Partial<DatasetMeta> = {}): DatasetMeta => ({
  id: `${source}:all`, source: source as DatasetMeta['source'], scope: 'all', fileName: `${source}.xlsx`, importedAt: '2026-11-01T00:00:00.000Z', periodStart: '2026-10-01', periodEnd: '2026-10-31', period: '2026-10-01 to 2026-10-31',
  rawCount: 0, validCount: 0, duplicateCount: 1, invalidCount: 2, flaggedCount: 0, mappingVersion: 'm1', columns: [], mapping: {}, inference: [], fileSize: 1, mode: 'add', extra: {}, ...over,
});
const usage = (rows: Array<[string, string]>, over: Partial<DatasetMeta> = {}): DatasetPayload => ({
  meta: meta('ds_usage', { validCount: rows.length, ...over }),
  records: rows.map(([k, status]) => ({ key: k, datasetId: 'ds_usage:all', date: '2026-10-01', dealer: 'Dealer', platform: 'Web', status })),
  issues: [],
  raw: [],
});
const loyalty = (): DatasetPayload => ({
  meta: meta('loyalty_snapshot', { scope: '2026-10-26', id: 'loyalty_snapshot:2026-10-26' }),
  records: [{ key: '2026-10-26|unverified:917002533087:Cycle house', datasetId: 'loyalty_snapshot:2026-10-26', customerId: 'NOT-CAPTURED', firmName: 'Cycle house', current: 1, entityKey: 'unverified:917002533087:Cycle house', mobileMasked: '91••••••3087' }],
  issues: [],
  raw: [],
});

/** Uploads a dataset the way the browser does: gzip, split into parts, stage each. */
async function upload(cookie: string, p: DatasetPayload, partSize = 400) {
  const { bytes, sha256 } = await encodeDataset(p);
  const id = crypto.randomUUID();
  const parts = Math.ceil(bytes.byteLength / partSize);
  for (let i = 0; i < parts; i++) {
    const res = await stage.POST(req('POST', `/api/admin/stage?upload=${id}&part=${i}`, { cookie, raw: bytes.slice(i * partSize, (i + 1) * partSize) }));
    expect(res.status).toBe(200);
  }
  return { id: p.meta.id, upload: id, parts, sha256 };
}
const publish = async (cookie: string, body: unknown) => publishH.POST(req('POST', '/api/admin/publish', { cookie, body }));
const status = async () => (await (await snapshotH.GET(req('GET', '/api/snapshot'))).json()) as SnapshotStatus;

describe('health', () => {
  it('answers without configuration, says which build runs, and exposes nothing else', async () => {
    const saved = { sha: process.env.VERCEL_GIT_COMMIT_SHA, env: process.env.VERCEL_ENV, secret: process.env.CRM_ADMIN_SECRET, tok: process.env.CRM_PREVIEW_READ_WRITE_TOKEN };
    process.env.VERCEL_GIT_COMMIT_SHA = '4041939393e2fec48236032b6205600a1fa93ca630';
    process.env.VERCEL_ENV = 'preview';
    process.env.CRM_ADMIN_SECRET = 'must-never-appear-in-health-output';
    process.env.CRM_PREVIEW_READ_WRITE_TOKEN = 'vercel_blob_rw_x_must-never-appear';
    try {
      setContext(ctxWith(null, { CRM_ADMIN_SECRET: 'short' }));
      const res = await healthH.GET(req('GET', '/api/health'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, service: 'crm-tracker-api', commit: '4041939', environment: 'preview' });
      expect(JSON.stringify(body)).not.toMatch(/must-never-appear|blob|secret|token/i);
      expect(res.headers.get('cache-control')).toBe('no-store');
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.VERCEL_ENV;
      expect(await (await healthH.GET(req('GET', '/api/health'))).json()).toMatchObject({ ok: true, commit: null, environment: null });
    } finally {
      for (const [k, v] of [['VERCEL_GIT_COMMIT_SHA', saved.sha], ['VERCEL_ENV', saved.env], ['CRM_ADMIN_SECRET', saved.secret], ['CRM_PREVIEW_READ_WRITE_TOKEN', saved.tok]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('not configured', () => {
  it('says only that publishing is not set up, and the public API stays harmless', async () => {
    setContext(ctxWith(null, { CRM_ADMIN_SECRET: 'short' }));
    const res = await login.POST(req('POST', '/api/admin/login', { body: { secret: 'short' } }));
    expect(res.status).toBe(503);
    const b = await res.json();
    expect(b).toMatchObject({ error: 'not_configured' });
    expect(JSON.stringify(b)).not.toMatch(/CRM_|BLOB_|short"/); // an unauthenticated caller learns nothing about the settings
    expect(await (await snapshotH.GET(req('GET', '/api/snapshot'))).json()).toMatchObject({ configured: false, version: null });
    expect(await (await session.GET(req('GET', '/api/admin/session'))).json()).toMatchObject({ configured: false, admin: false });
  });
});

describe('administrator sign-in', () => {
  it('rejects a wrong secret and accepts the right one with a hardened cookie that never contains the secret', async () => {
    expect((await login.POST(req('POST', '/api/admin/login', { body: { secret: 'wrong' } }))).status).toBe(401);
    expect((await login.POST(req('POST', '/api/admin/login', { body: {} }))).status).toBe(401);
    const res = await login.POST(req('POST', '/api/admin/login', { body: { secret: ENV.CRM_ADMIN_SECRET } }));
    expect(res.status).toBe(200);
    const sc = res.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Strict/);
    expect(sc).toMatch(/Path=\/api/);
    expect(sc).toMatch(/Secure/);
    expect(sc).toMatch(/Max-Age=28800/);
    expect(sc).not.toContain(ENV.CRM_ADMIN_SECRET);
    expect(JSON.stringify(await res.json())).not.toContain(ENV.CRM_ADMIN_SECRET);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('recognises a signed-in browser, and refuses forged, tampered and expired cookies', async () => {
    const c = await signIn();
    expect(await (await session.GET(req('GET', '/api/admin/session', { cookie: c }))).json()).toMatchObject({ configured: true, admin: true });
    expect(await (await session.GET(req('GET', '/api/admin/session'))).json()).toMatchObject({ admin: false });
    const [body, sig] = c.split('.');
    const forged = `${Buffer.from(JSON.stringify({ sid: 'a'.repeat(32), iat: 1, exp: 9999999999 })).toString('base64url')}.${sig}`;
    for (const bad of [forged, `${body}.${sig.slice(0, -2)}AA`, 'garbage', `${body}.`]) {
      expect((await versionsH.GET(req('GET', '/api/admin/versions', { cookie: bad }))).status).toBe(401);
    }
    const other = createSessionToken('x'.repeat(40), clock, 8).token; // signed with another secret
    expect((await versionsH.GET(req('GET', '/api/admin/versions', { cookie: other }))).status).toBe(401);
    clock += 9 * 3600_000; // after the 8 hours
    expect((await versionsH.GET(req('GET', '/api/admin/versions', { cookie: c }))).status).toBe(401);
  });
  it('logout revokes the session on the server and clears the cookie', async () => {
    const c = await signIn();
    expect((await versionsH.GET(req('GET', '/api/admin/versions', { cookie: c }))).status).toBe(200);
    const out = await logout.POST(req('POST', '/api/admin/logout', { cookie: c }));
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await versionsH.GET(req('GET', '/api/admin/versions', { cookie: c }))).status).toBe(401); // the copied cookie is dead
    expect(await (await session.GET(req('GET', '/api/admin/session', { cookie: c }))).json()).toMatchObject({ admin: false });
  });
  it('requires the CSRF header and a same-origin request for every state-changing call', async () => {
    const c = await signIn();
    const noHeader = await publishH.POST(req('POST', '/api/admin/publish', { cookie: c, admin: false, body: { baseVersion: null, datasets: [] } }));
    expect(noHeader.status).toBe(403);
    const crossOrigin = await publishH.POST(req('POST', '/api/admin/publish', { cookie: c, headers: { origin: 'https://evil.example' }, body: { baseVersion: null, datasets: [] } }));
    expect(crossOrigin.status).toBe(403);
    const crossSite = await publishH.POST(req('POST', '/api/admin/publish', { cookie: c, headers: { 'sec-fetch-site': 'cross-site' }, body: { baseVersion: null, datasets: [] } }));
    expect(crossSite.status).toBe(403);
    expect((await login.POST(req('POST', '/api/admin/login', { admin: false, body: { secret: ENV.CRM_ADMIN_SECRET } }))).status).toBe(403);
  });
  it('locks out an address after 5 wrong secrets, even for the right secret, until the window passes', async () => {
    for (let i = 0; i < 5; i++) expect((await login.POST(req('POST', '/api/admin/login', { body: { secret: `nope${i}` }, ip: '198.51.100.9' }))).status).toBe(401);
    const locked = await login.POST(req('POST', '/api/admin/login', { body: { secret: ENV.CRM_ADMIN_SECRET }, ip: '198.51.100.9' }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await login.POST(req('POST', '/api/admin/login', { body: { secret: ENV.CRM_ADMIN_SECRET }, ip: '198.51.100.10' }))).status).toBe(200); // another address is unaffected
    resetAuthMemory(); // a different server instance still sees the failures through the store
    expect((await login.POST(req('POST', '/api/admin/login', { body: { secret: ENV.CRM_ADMIN_SECRET }, ip: '198.51.100.9' }))).status).toBe(429);
    clock += 16 * 60_000;
    resetAuthMemory();
    expect((await login.POST(req('POST', '/api/admin/login', { body: { secret: ENV.CRM_ADMIN_SECRET }, ip: '198.51.100.9' }))).status).toBe(200);
  }, 20000);
  it('counts a burst of parallel guesses one by one: only the first few are ever checked', async () => {
    const ip = '198.51.100.77';
    const burst = await Promise.all(Array.from({ length: 25 }, (_, i) => login.POST(req('POST', '/api/admin/login', { body: { secret: `guess-${i}` }, ip }))));
    const checked = burst.filter((r) => r.status === 401).length;
    expect(checked).toBeLessThanOrEqual(5);
    expect(burst.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    expect((await login.POST(req('POST', '/api/admin/login', { body: { secret: ENV.CRM_ADMIN_SECRET }, ip }))).status).toBe(429); // locked, even for the right secret
  }, 30000);
  it('refuses sign-in (fails closed) when the attempt counter cannot be stored', async () => {
    class Broken extends FileStore {
      put(p: string, b: Uint8Array, o: PutOptions) {
        return p.includes('/security/ratelimit/') ? Promise.reject(new Error('store down')) : super.put(p, b, o);
      }
    }
    setContext(ctxWith(new Broken(dir)));
    const res = await login.POST(req('POST', '/api/admin/login', { body: { secret: ENV.CRM_ADMIN_SECRET } }));
    expect(res.status).toBe(503);
  });
  it('keeps the admin endpoints closed without a session', async () => {
    const calls: Array<[() => Promise<Response>]> = [
      [() => stage.POST(req('POST', '/api/admin/stage?upload=x&part=0', { raw: new Uint8Array(4) }))],
      [() => publishH.POST(req('POST', '/api/admin/publish', { body: {} }))],
      [() => rollbackH.POST(req('POST', '/api/admin/rollback', { body: {} }))],
      [() => versionsH.GET(req('GET', '/api/admin/versions'))],
    ];
    for (const [call] of calls) expect((await call()).status).toBe(401);
  });
});

describe('publishing', () => {
  it('stores a multi-part upload sanitized, serves it publicly by content address, and exposes nothing private', async () => {
    const c = await signIn();
    const up = await upload(c, loyalty(), 100);
    expect(up.parts).toBeGreaterThan(1);
    const res = await publish(c, { baseVersion: null, note: 'First, call 9876543210', datasets: [up] });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ unchanged: false });
    expect(out.changes[0]).toMatchObject({ id: 'loyalty_snapshot:2026-10-26', status: 'new', inserted: 1, rejected: 3, sanitized: { tokenisedKeys: 2 } });

    const st = await status();
    expect(st.version!.versionId).toBe(out.versionId);
    expect(st.version!.note).toBe('First, call [removed]');
    expect(st.publishedAt).toBe('2026-11-02T10:00:00.000Z');
    expect(JSON.stringify(st)).not.toMatch(/blob\.vercel|https?:\/\/|917002533087|9876543210|secret|token/i);

    const sha = st.version!.datasets[0].sha256;
    const ds = await datasetH.GET(req('GET', `/api/dataset?sha=${sha}`));
    expect(ds.status).toBe(200);
    expect(ds.headers.get('cache-control')).toBe('no-cache'); // rolled-back data must stop being served at once: never cached for long
    expect(ds.headers.get('etag')).toBe(`"${st.version!.datasets[0].sha256}"`);
    expect((await datasetH.GET(req('GET', `/api/dataset?sha=${st.version!.datasets[0].sha256}`, { headers: { 'if-none-match': ds.headers.get('etag')! } }))).status).toBe(304);
    const payload = await decodeDataset(new Uint8Array(await ds.arrayBuffer()));
    expect(JSON.stringify(payload)).not.toContain('917002533087'); // the server sanitized it, whatever the client sent
    expect((payload.records[0] as { entityKey: string }).entityKey).toMatch(/^unverified:m[0-9a-f]{12}:Cycle house$/);
    // nothing of the private layout leaks through the public API
    expect((await datasetH.GET(req('GET', `/api/dataset?sha=${'0'.repeat(64)}`))).status).toBe(404);
    expect((await datasetH.GET(req('GET', '/api/dataset?sha=../../etc/passwd'))).status).toBe(400);
    // staging is cleaned up
    expect((await store.list('crm-tracker/staging/')).length).toBe(0);
  });
  it('answers conditional requests for the status with 304', async () => {
    const c = await signIn();
    await publish(c, { baseVersion: null, datasets: [await upload(c, usage([['a', 'Open']]))] });
    const first = await snapshotH.GET(req('GET', '/api/snapshot'));
    expect(first.headers.get('cache-control')).toBe('no-cache'); // a browser must always revalidate: a stale answer would delay a publish
    expect(first.headers.get('vercel-cdn-cache-control')).toMatch(/max-age=10/);
    const again = await snapshotH.GET(req('GET', '/api/snapshot', { headers: { 'if-none-match': first.headers.get('etag')! } }));
    expect(again.status).toBe(304);
  });
  it('records inserted / updated / removed per dataset, keeps history, and ignores an identical re-publish', async () => {
    const c = await signIn();
    const v1 = await (await publish(c, { baseVersion: null, note: 'one', datasets: [await upload(c, usage([['a', 'Open'], ['b', 'Open']]))] })).json();
    clock += 60_000;
    const v2 = await (await publish(c, { baseVersion: v1.versionId, note: 'two', datasets: [await upload(c, usage([['a', 'Open'], ['b', 'Billing'], ['c', 'Open']], { mode: 'merge' }))] })).json();
    expect(v2.changes[0]).toMatchObject({ status: 'changed', inserted: 1, updated: 1, unchanged: 1, removed: 0, mode: 'merge' });
    const same = await (await publish(c, { baseVersion: v2.versionId, datasets: [await upload(c, usage([['a', 'Open'], ['b', 'Billing'], ['c', 'Open']], { mode: 'merge' }))] })).json();
    expect(same).toMatchObject({ unchanged: true, versionId: v2.versionId });
    const hist = (await (await versionsH.GET(req('GET', '/api/admin/versions', { cookie: c }))).json()) as { current: string; versions: VersionSummary[] };
    expect(hist.current).toBe(v2.versionId);
    expect(hist.versions.map((v) => [v.note, v.action, v.current, v.records])).toEqual([['two', 'publish', true, 3], ['one', 'initial', false, 2]]);
    const man = (await (await versionsH.GET(req('GET', `/api/admin/versions?id=${v2.versionId}`, { cookie: c }))).json()).manifest;
    expect(man.parent).toBe(v1.versionId);
  });
  it('removes a dataset from the published set on request', async () => {
    const c = await signIn();
    const v1 = await (await publish(c, { baseVersion: null, datasets: [await upload(c, usage([['a', 'Open']])), await upload(c, loyalty())] })).json();
    const v2 = await (await publish(c, { baseVersion: v1.versionId, datasets: [], remove: ['loyalty_snapshot:2026-10-26'] })).json();
    expect(v2.changes).toEqual([expect.objectContaining({ id: 'loyalty_snapshot:2026-10-26', status: 'removed', removed: 1 })]);
    expect((await status()).version!.datasets.map((d) => d.id)).toEqual(['ds_usage:all']);
  });
  it('rolls back to an earlier version as a new version, and stops serving the data it replaced', async () => {
    const c = await signIn();
    const v1 = await (await publish(c, { baseVersion: null, note: 'good', datasets: [await upload(c, usage([['a', 'Open']]))] })).json();
    const shaV1 = (await status()).version!.datasets[0].sha256;
    clock += 60_000;
    const v2 = await (await publish(c, { baseVersion: v1.versionId, note: 'bad', datasets: [await upload(c, usage([['a', 'WRONG'], ['z', 'WRONG']]))] })).json();
    const shaV2 = (await status()).version!.datasets[0].sha256;
    expect(shaV2).not.toBe(shaV1);
    clock += 60_000;
    const rb = await rollbackH.POST(req('POST', '/api/admin/rollback', { cookie: c, body: { toVersion: v1.versionId, baseVersion: v2.versionId } }));
    expect(rb.status).toBe(200);
    const out = await rb.json();
    expect(out.versionId).not.toBe(v1.versionId); // history is linear and immutable
    const st = await status();
    expect(st.version).toMatchObject({ versionId: out.versionId, action: 'rollback' });
    expect(st.version!.datasets[0].sha256).toBe(shaV1);
    expect((await datasetH.GET(req('GET', `/api/dataset?sha=${shaV1}`))).status).toBe(200);
    expect((await datasetH.GET(req('GET', `/api/dataset?sha=${shaV2}`))).status).toBe(404); // the bad data is no longer retrievable
    const hist = (await (await versionsH.GET(req('GET', '/api/admin/versions', { cookie: c }))).json()) as { versions: VersionSummary[] };
    expect(hist.versions.map((v) => v.action)).toEqual(['rollback', 'publish', 'initial']);
    expect((await rollbackH.POST(req('POST', '/api/admin/rollback', { cookie: c, body: { toVersion: out.versionId, baseVersion: out.versionId } }))).status).toBe(400);
  });
  it('refuses broken uploads: bad checksum, missing part, oversize part, invalid dataset, unreadable bytes', async () => {
    const c = await signIn();
    const good = await upload(c, usage([['a', 'Open']]));
    expect((await publish(c, { baseVersion: null, datasets: [{ ...good, sha256: 'f'.repeat(64) }] })).status).toBe(400);
    expect((await publish(c, { baseVersion: null, datasets: [{ ...good, parts: good.parts + 1 }] })).status).toBe(400);
    const big = await stage.POST(req('POST', `/api/admin/stage?upload=${crypto.randomUUID()}&part=0`, { cookie: c, raw: new Uint8Array(3_600_000) }));
    expect(big.status).toBe(413);
    expect((await stage.POST(req('POST', '/api/admin/stage?upload=not-a-uuid&part=0', { cookie: c, raw: new Uint8Array(4) }))).status).toBe(400);
    const invalid = usage([['a', 'Open'], ['a', 'Open']]); // repeated key
    expect((await publish(c, { baseVersion: null, datasets: [await upload(c, invalid)] })).status).toBe(422);
    const junk = crypto.randomUUID();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await stage.POST(req('POST', `/api/admin/stage?upload=${junk}&part=0`, { cookie: c, raw: bytes }));
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    expect((await publish(c, { baseVersion: null, datasets: [{ id: 'ds_usage:all', upload: junk, parts: 1, sha256: sha }] })).status).toBe(400);
    expect((await status()).version).toBeNull(); // nothing was published by any of the above
  });
  it('rejects a dataset whose id is not what the upload contains', async () => {
    const c = await signIn();
    const up = await upload(c, usage([['a', 'Open']]));
    expect((await publish(c, { baseVersion: null, datasets: [{ ...up, id: 'ds_usage:other' }] })).status).toBe(422);
  });
});

describe('versions that were never live', () => {
  it('are neither listed nor restorable', async () => {
    const c = await signIn();
    const v1 = await (await publish(c, { baseVersion: null, note: 'live', datasets: [await upload(c, usage([['a', 'Open']]))] })).json();
    const v2 = await (await publish(c, { baseVersion: v1.versionId, note: 'live too', datasets: [await upload(c, usage([['a', 'Open'], ['b', 'Open']]))] })).json();
    // an orphan manifest, as an interrupted publish could leave: a copy of v2 under another id that no pointer ever named
    const real = await store.getBytes(`crm-tracker/versions/${v2.versionId}/manifest.json`);
    const orphan = 'v20261102T235959Z-abcdef';
    await store.put(`crm-tracker/versions/${orphan}/manifest.json`, new TextEncoder().encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(real!.bytes)), versionId: orphan, note: 'phantom' })), { contentType: 'application/json', ifNotExists: true });
    const hist = (await (await versionsH.GET(req('GET', '/api/admin/versions', { cookie: c }))).json()) as { versions: VersionSummary[] };
    expect(hist.versions.map((v) => v.note)).toEqual(['live too', 'live']);
    const rb = await rollbackH.POST(req('POST', '/api/admin/rollback', { cookie: c, body: { toVersion: orphan, baseVersion: v2.versionId } }));
    expect(rb.status).toBe(404);
    expect((await status()).version!.versionId).toBe(v2.versionId);
  });
});

describe('concurrency and failure', () => {
  it('lets exactly one of two simultaneous publishes win; the loser gets 409 and the data stays valid', async () => {
    const c = await signIn();
    const v1 = await (await publish(c, { baseVersion: null, datasets: [await upload(c, usage([['a', 'Open']]))] })).json();
    const a = await upload(c, usage([['a', 'Open'], ['from-a', 'Open']]));
    const b = await upload(c, usage([['a', 'Open'], ['from-b', 'Open']]));
    const results = await Promise.all([publish(c, { baseVersion: v1.versionId, note: 'A', datasets: [a] }), publish(c, { baseVersion: v1.versionId, note: 'B', datasets: [b] })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(await loser.json()).toMatchObject({ error: 'conflict' });
    const st = await status();
    expect((await store.list('crm-tracker/versions/')).length).toBe(2); // the loser left no manifest behind: no phantom version
    const winnerNote = (await results.find((r) => r.status === 200)!.json()).versionId;
    expect(st.version!.versionId).toBe(winnerNote);
    const payload = await decodeDataset(new Uint8Array(await (await datasetH.GET(req('GET', `/api/dataset?sha=${st.version!.datasets[0].sha256}`))).arrayBuffer()));
    expect(payload.records).toHaveLength(2); // a complete dataset of one of them, never a mix
  });
  it('refuses a publish made on top of a stale version', async () => {
    const c = await signIn();
    const v1 = await (await publish(c, { baseVersion: null, datasets: [await upload(c, usage([['a', 'Open']]))] })).json();
    await publish(c, { baseVersion: v1.versionId, datasets: [await upload(c, usage([['a', 'Open'], ['b', 'Open']]))] });
    const stale = await publish(c, { baseVersion: v1.versionId, datasets: [await upload(c, usage([['x', 'Open']]))] });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'conflict', currentVersion: expect.stringMatching(/^v/) });
    expect((await publish(c, { baseVersion: null, datasets: [await upload(c, usage([['x', 'Open']]))] })).status).toBe(409); // "first publish" when one exists
  });
  it('leaves the active version untouched when the pointer cannot be moved', async () => {
    const c = await signIn();
    const v1 = await (await publish(c, { baseVersion: null, note: 'stable', datasets: [await upload(c, usage([['a', 'Open']]))] })).json();
    class FailingPointer implements Store {
      readonly kind = 'file' as const;
      constructor(private inner: Store) {}
      head = (p: string) => this.inner.head(p);
      getBytes = (p: string) => this.inner.getBytes(p);
      getStream = (p: string) => this.inner.getStream(p);
      list = (p: string) => this.inner.list(p);
      del = (p: string[]) => this.inner.del(p);
      put(p: string, b: Uint8Array, o: PutOptions) {
        if (p.endsWith('/current.json')) return Promise.reject(new Error('network lost'));
        return this.inner.put(p, b, o);
      }
    }
    setContext(ctxWith(new FailingPointer(store)));
    const res = await publish(c, { baseVersion: v1.versionId, note: 'doomed', datasets: [await upload(c, usage([['a', 'Open'], ['b', 'Open']]))] });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/network lost/); // internals are not echoed
    setContext(ctxWith(store));
    expect((await store.list('crm-tracker/versions/')).length).toBe(1); // the interrupted publish did not leave a manifest
    const st = await status();
    expect(st.version).toMatchObject({ versionId: v1.versionId, note: 'stable' }); // still the complete earlier version
    const payload = await decodeDataset(new Uint8Array(await (await datasetH.GET(req('GET', `/api/dataset?sha=${st.version!.datasets[0].sha256}`))).arrayBuffer()));
    expect(payload.records).toHaveLength(1);
    // and publishing still works afterwards
    expect((await publish(c, { baseVersion: v1.versionId, datasets: [await upload(c, usage([['a', 'Open'], ['b', 'Open']]))] })).status).toBe(200);
  });
  it('FileStore compare-and-swap semantics', async () => {
    const s = new FileStore(dir);
    const first = await s.put('x/current', new Uint8Array([1]), { contentType: 'x', ifNotExists: true });
    await expect(s.put('x/current', new Uint8Array([2]), { contentType: 'x', ifNotExists: true })).rejects.toBeInstanceOf(PreconditionFailed);
    await expect(s.put('x/current', new Uint8Array([2]), { contentType: 'x', ifMatch: 'stale' })).rejects.toBeInstanceOf(PreconditionFailed);
    await s.put('x/current', new Uint8Array([3]), { contentType: 'x', ifMatch: first.etag });
    await expect(s.put('x/current', new Uint8Array([4]), { contentType: 'x' })).rejects.toBeInstanceOf(PreconditionFailed); // immutable unless said otherwise
    expect((await s.getBytes('x/current'))!.bytes[0]).toBe(3);
  });
});
