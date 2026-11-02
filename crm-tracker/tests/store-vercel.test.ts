// The production store against a stand-in for @vercel/blob: what we send to the SDK, and how its errors are read.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob', () => {
  class BlobNotFoundError extends Error {}
  class BlobPreconditionFailedError extends Error {}
  return { put: vi.fn(), get: vi.fn(), head: vi.fn(), list: vi.fn(), del: vi.fn(), BlobNotFoundError, BlobPreconditionFailedError };
});
import * as sdk from '@vercel/blob';
import { VercelBlobStore } from '../server/store-vercel.js';
import { PreconditionFailed } from '../server/store.js';

const m = sdk as unknown as Record<'put' | 'get' | 'head' | 'list' | 'del', ReturnType<typeof vi.fn>> & { BlobNotFoundError: new () => Error; BlobPreconditionFailedError: new () => Error };
const getOidcToken = vi.fn(async () => 'oidc-token-of-this-request');
const store = new VercelBlobStore({ storeId: 'store_real', getOidcToken });
const bytes = new Uint8Array([1, 2, 3]);
const AUTH = { oidcToken: 'oidc-token-of-this-request', storeId: 'store_real' };

beforeEach(() => {
  for (const f of [m.put, m.get, m.head, m.list, m.del, getOidcToken]) f.mockClear();
  for (const f of [m.put, m.get, m.head, m.list, m.del]) f.mockReset();
});

describe('authentication', () => {
  it('every SDK call carries the invocation\'s OIDC token and the connected store, and never a read-write token', async () => {
    m.put.mockResolvedValue({ pathname: 'p', etag: 'e' });
    m.get.mockResolvedValue(null);
    m.head.mockRejectedValue(new m.BlobNotFoundError());
    m.list.mockResolvedValue({ blobs: [], hasMore: false });
    await store.put('a', bytes, { contentType: 'text/plain', overwrite: true });
    await store.getBytes('a');
    await store.head('a');
    await store.list('a/');
    await store.del(['a']);
    const options = [m.put.mock.calls[0][2], m.get.mock.calls[0][1], m.head.mock.calls[0][1], m.list.mock.calls[0][0], m.del.mock.calls[0][1]];
    for (const o of options) {
      expect(o).toMatchObject(AUTH);
      expect(o.token).toBeUndefined();
    }
    expect(getOidcToken).toHaveBeenCalledTimes(5); // fetched per call: the token belongs to one invocation and expires
  });
  it('whatever read-write credentials sit in the environment, the SDK is told which credentials to use', async () => {
    const saved = { t: process.env.BLOB_READ_WRITE_TOKEN, s: process.env.BLOB_STORE_ID, o: process.env.VERCEL_OIDC_TOKEN };
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_otherstore_otherstoresecret';
    process.env.BLOB_STORE_ID = 'store_otherstore';
    process.env.VERCEL_OIDC_TOKEN = 'oidc-of-the-build';
    try {
      m.put.mockResolvedValue({ pathname: 'p', etag: 'e' });
      await store.put('a', bytes, { contentType: 'text/plain' });
      const o = m.put.mock.calls[0][2];
      expect(o).toMatchObject(AUTH);
      expect(JSON.stringify(o)).not.toMatch(/otherstore|oidc-of-the-build/);
    } finally {
      for (const [k, v] of [['BLOB_READ_WRITE_TOKEN', saved.t], ['BLOB_STORE_ID', saved.s], ['VERCEL_OIDC_TOKEN', saved.o]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
  it('without an OIDC token the store fails; it does not fall back to anything else, and the SDK is never called', async () => {
    const noOidc = new VercelBlobStore({ storeId: 'store_real', getOidcToken: async () => { throw new Error('missing header'); } });
    await expect(noOidc.getBytes('a')).rejects.toThrow(/OIDC token/);
    await expect(noOidc.put('a', bytes, { contentType: 'text/plain' })).rejects.toThrow(/OIDC token/);
    const empty = new VercelBlobStore({ storeId: 'store_real', getOidcToken: async () => '  ' });
    await expect(empty.head('a')).rejects.toThrow(/empty/);
    for (const f of [m.put, m.get, m.head, m.list, m.del]) expect(f).not.toHaveBeenCalled();
  });
  it('refuses to be built without a store id', () => {
    expect(() => new VercelBlobStore({ storeId: '' })).toThrow(/refusing to fall back/);
    expect(() => new VercelBlobStore(undefined as unknown as { storeId: string })).toThrow();
  });
});

describe('the default token provider', () => {
  const KEY = Symbol.for('@vercel/request-context');
  it('reads the OIDC token of the current invocation from Vercel\'s request context, and nothing else', async () => {
    const g = globalThis as unknown as Record<symbol, unknown>;
    const had = g[KEY];
    // shaped like the real thing (a JWT that has not expired): the provider rejects anything else
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'RS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
    g[KEY] = { get: () => ({ headers: { 'x-vercel-oidc-token': jwt } }) };
    try {
      const real = new VercelBlobStore({ storeId: 'store_real' }); // no injected provider: the real @vercel/oidc one
      m.head.mockResolvedValue({ etag: 'e', size: 1, uploadedAt: new Date() });
      await real.head('a');
      expect(m.head.mock.calls[0][1]).toEqual({ oidcToken: jwt, storeId: 'store_real' });
    } finally {
      if (had === undefined) delete g[KEY];
      else g[KEY] = had;
    }
  });
});

describe('VercelBlobStore', () => {
  it('writes only to the private store, never with a random suffix', async () => {
    m.put.mockResolvedValue({ pathname: 'p', etag: 'e1' });
    await store.put('crm-tracker/datasets/x.json.gz', bytes, { contentType: 'application/gzip', ifNotExists: true });
    const [path, , opts] = m.put.mock.calls[0];
    expect(path).toBe('crm-tracker/datasets/x.json.gz');
    expect(opts).toMatchObject({ access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/gzip' });
    expect(opts.ifMatch).toBeUndefined();
  });
  it('a compare-and-swap write sends the etag and implies overwriting; the etag it returns is the SDK\'s own', async () => {
    m.put.mockResolvedValue({ pathname: 'p', etag: 'new-etag' });
    const r = await store.put('crm-tracker/current.json', bytes, { contentType: 'application/json', ifMatch: 'old-etag' });
    expect(m.put.mock.calls[0][2]).toMatchObject({ access: 'private', ifMatch: 'old-etag', allowOverwrite: true });
    expect(r.etag).toBe('new-etag');
    expect(m.head).not.toHaveBeenCalled(); // no extra round trip that could see a newer version
  });
  it('overwriting must be asked for', async () => {
    m.put.mockResolvedValue({ pathname: 'p', etag: 'e' });
    await store.put('a', bytes, { contentType: 'text/plain', overwrite: true });
    await store.put('b', bytes, { contentType: 'text/plain' });
    expect(m.put.mock.calls[0][2].allowOverwrite).toBe(true);
    expect(m.put.mock.calls[1][2].allowOverwrite).toBe(false);
  });
  it('reads privately and bypasses the CDN cache, so the pointer is always current', async () => {
    m.get.mockResolvedValue({ statusCode: 200, stream: new Blob([bytes]).stream(), blob: { etag: 'e', size: 3, uploadedAt: new Date('2026-11-02T00:00:00Z') } });
    const o = await store.getBytes('crm-tracker/current.json');
    expect(m.get).toHaveBeenCalledWith('crm-tracker/current.json', { access: 'private', ...AUTH, useCache: false });
    expect([...o!.bytes]).toEqual([1, 2, 3]);
    expect(o).toMatchObject({ etag: 'e', size: 3 });
  });
  it('a missing object is null, not an error', async () => {
    m.get.mockResolvedValue(null);
    expect(await store.getBytes('nope')).toBeNull();
    m.head.mockRejectedValue(new m.BlobNotFoundError());
    expect(await store.head('nope')).toBeNull();
  });
  it('a lost compare-and-swap becomes PreconditionFailed', async () => {
    m.put.mockRejectedValue(new m.BlobPreconditionFailedError());
    await expect(store.put('crm-tracker/current.json', bytes, { contentType: 'application/json', ifMatch: 'stale' })).rejects.toBeInstanceOf(PreconditionFailed);
  });
  it('a create-only write that fails because the object now exists is a conflict, whatever the SDK calls the error', async () => {
    m.put.mockRejectedValue(new Error('Unknown error'));
    m.head.mockResolvedValue({ etag: 'e', size: 1, uploadedAt: new Date() });
    await expect(store.put('crm-tracker/current.json', bytes, { contentType: 'application/json', ifNotExists: true })).rejects.toBeInstanceOf(PreconditionFailed);
  });
  it('a create-only write that fails for another reason is an error, not a conflict', async () => {
    m.put.mockRejectedValue(new Error('network lost'));
    m.head.mockRejectedValue(new m.BlobNotFoundError());
    await expect(store.put('x', bytes, { contentType: 'text/plain', ifNotExists: true })).rejects.toThrow('network lost');
  });
  it('lists every page and deletes in one call', async () => {
    m.list.mockResolvedValueOnce({ blobs: [{ pathname: 'a/1', etag: 'e', size: 1, uploadedAt: new Date() }], hasMore: true, cursor: 'c1' }).mockResolvedValueOnce({ blobs: [{ pathname: 'a/2', etag: 'e', size: 1, uploadedAt: new Date() }], hasMore: false });
    expect((await store.list('a/')).map((b) => b.path)).toEqual(['a/1', 'a/2']);
    expect(m.list.mock.calls[0][0]).toMatchObject({ prefix: 'a/', ...AUTH });
    await store.del(['a/1', 'a/2']);
    expect(m.del).toHaveBeenCalledWith(['a/1', 'a/2'], AUTH);
    await store.del([]);
    expect(m.del).toHaveBeenCalledTimes(1);
  });
});
