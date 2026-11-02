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
const store = new VercelBlobStore('test-token');
const bytes = new Uint8Array([1, 2, 3]);

beforeEach(() => Object.values({ put: m.put, get: m.get, head: m.head, list: m.list, del: m.del }).forEach((f) => f.mockReset()));

describe('VercelBlobStore', () => {
  it('writes only to the private store, never with a random suffix, and passes the token explicitly', async () => {
    m.put.mockResolvedValue({ pathname: 'p', etag: 'e1' });
    await store.put('crm-tracker/datasets/x.json.gz', bytes, { contentType: 'application/gzip', ifNotExists: true });
    const [path, , opts] = m.put.mock.calls[0];
    expect(path).toBe('crm-tracker/datasets/x.json.gz');
    expect(opts).toMatchObject({ access: 'private', addRandomSuffix: false, allowOverwrite: false, token: 'test-token', contentType: 'application/gzip' });
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
    expect(m.get).toHaveBeenCalledWith('crm-tracker/current.json', { access: 'private', token: 'test-token', useCache: false });
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
    expect(m.list.mock.calls[0][0]).toMatchObject({ prefix: 'a/', token: 'test-token' });
    await store.del(['a/1', 'a/2']);
    expect(m.del).toHaveBeenCalledWith(['a/1', 'a/2'], { token: 'test-token' });
    await store.del([]);
    expect(m.del).toHaveBeenCalledTimes(1);
  });
});
