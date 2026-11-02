// A PRIVATE Vercel Blob store, reached with the server-side read-write token handed in by config.ts (the CRM_PREVIEW_… one on
// Preview). Every call passes that token explicitly: with an explicit token the SDK uses it, and the store id inside it, and
// never looks at the project's BLOB_READ_WRITE_TOKEN / BLOB_STORE_ID / OIDC settings.
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, list, put } from '@vercel/blob';
import { PreconditionFailed, type PutOptions, type Store, type StoredObject } from './store.js';

const meta = (b: { etag: string; size: number; uploadedAt: Date }): StoredObject => ({ etag: b.etag, size: b.size, uploadedAt: b.uploadedAt.toISOString() });

export class VercelBlobStore implements Store {
  readonly kind = 'vercel-blob' as const;
  constructor(private readonly token: string) {
    if (!token) throw new Error('A Blob read-write token is required: refusing to fall back to the environment.');
  }

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
      return { etag: r.etag, size: bytes.byteLength, uploadedAt: new Date().toISOString() };
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) throw new PreconditionFailed();
      // The SDK reports "this pathname is already taken" as a generic error whose class we cannot rely on, so do not read the
      // message: if a create-only write failed, look whether the object is there now. If it is, somebody else created it first.
      if (opts.ifNotExists && (await this.head(path).catch(() => null))) throw new PreconditionFailed('The object already exists.');
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
