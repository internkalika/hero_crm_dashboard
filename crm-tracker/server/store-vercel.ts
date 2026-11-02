// The production store: a PRIVATE Vercel Blob store, reached with the server-side BLOB_READ_WRITE_TOKEN only.
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, list, put } from '@vercel/blob';
import { PreconditionFailed, type PutOptions, type Store, type StoredObject } from './store.js';

const meta = (b: { etag: string; size: number; uploadedAt: Date }): StoredObject => ({ etag: b.etag, size: b.size, uploadedAt: b.uploadedAt.toISOString() });

export class VercelBlobStore implements Store {
  readonly kind = 'vercel-blob' as const;
  constructor(private readonly token?: string) {}

  async head(path: string) {
    try {
      return meta(await head(path, { token: this.token }));
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    }
  }
  async getStream(path: string) {
    // useCache:false: the pointer and the manifests must be the latest content, not an edge-cached copy
    const r = await get(path, { access: 'private', token: this.token, useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return { stream: r.stream, etag: r.blob.etag, size: r.blob.size, uploadedAt: r.blob.uploadedAt.toISOString() };
  }
  async getBytes(path: string) {
    const r = await this.getStream(path);
    if (!r) return null;
    const { stream, ...m } = r;
    return { ...m, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }
  async put(path: string, bytes: Uint8Array, opts: PutOptions) {
    try {
      const r = await put(path, Buffer.from(bytes), {
        access: 'private',
        token: this.token,
        contentType: opts.contentType,
        addRandomSuffix: false,
        allowOverwrite: opts.overwrite === true || opts.ifMatch !== undefined,
        ifMatch: opts.ifMatch,
        cacheControlMaxAge: 60,
      });
      const h = await this.head(r.pathname);
      return h ?? { etag: '', size: bytes.byteLength, uploadedAt: new Date().toISOString() };
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) throw new PreconditionFailed();
      // creating over an existing pathname without allowOverwrite is reported as a plain BlobError
      if (e instanceof Error && /already exists/i.test(e.message)) throw new PreconditionFailed('The object already exists.');
      throw e;
    }
  }
  async list(prefix: string) {
    const out: Array<{ path: string } & StoredObject> = [];
    let cursor: string | undefined;
    do {
      const r = await list({ prefix, cursor, limit: 1000, token: this.token });
      for (const b of r.blobs) out.push({ path: b.pathname, ...meta(b) });
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  }
  async del(paths: string[]) {
    if (paths.length) await del(paths, { token: this.token });
  }
}
