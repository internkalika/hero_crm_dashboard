// A PRIVATE Vercel Blob store, reached with Vercel's supported authentication for a connected store: the short-lived OIDC token
// that Vercel hands to every function invocation, plus the store id (BLOB_STORE_ID). No token is stored or configured anywhere.
// Both are passed to the SDK explicitly on every call: with an explicit OIDC token and store id the SDK uses exactly those and never
// looks at BLOB_READ_WRITE_TOKEN or any other store, so a leftover credential can not be picked up by accident.
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, list, put } from '@vercel/blob';
import { getVercelOidcToken } from '@vercel/oidc';
import { PreconditionFailed, type PutOptions, type Store, type StoredObject } from './store.js';

const meta = (b: { etag: string; size: number; uploadedAt: Date }): StoredObject => ({ etag: b.etag, size: b.size, uploadedAt: b.uploadedAt.toISOString() });

export interface BlobStoreOptions {
  storeId: string;
  /** the OIDC token of the current invocation (Vercel supplies it per request); replaceable in tests */
  getOidcToken?: () => Promise<string>;
}

export class VercelBlobStore implements Store {
  readonly kind = 'vercel-blob' as const;
  private readonly storeId: string;
  private readonly getOidcToken: () => Promise<string>;

  constructor(opts: BlobStoreOptions) {
    if (!opts?.storeId) throw new Error('A Blob store id is required: refusing to fall back to the environment.');
    this.storeId = opts.storeId;
    this.getOidcToken = opts.getOidcToken ?? getVercelOidcToken;
  }

  /** Fresh credentials for one SDK call: the OIDC token of this invocation and the connected store. Never a read-write token. */
  private async auth(): Promise<{ oidcToken: string; storeId: string }> {
    let oidcToken: string;
    try {
      oidcToken = (await this.getOidcToken())?.trim();
    } catch {
      throw new Error('Blob authentication is unavailable: no Vercel OIDC token for this request (is OIDC enabled for the project?).');
    }
    if (!oidcToken) throw new Error('Blob authentication is unavailable: empty Vercel OIDC token.');
    return { oidcToken, storeId: this.storeId };
  }

  async head(path: string) {
    try {
      return meta(await head(path, await this.auth()));
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    }
  }
  async getStream(path: string) {
    // useCache:false: the pointer and the manifests must be the latest content, not an edge-cached copy
    const r = await get(path, { access: 'private', ...(await this.auth()), useCache: false });
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
        ...(await this.auth()),
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
      const r = await list({ prefix, cursor, limit: 1000, ...(await this.auth()) });
      for (const b of r.blobs) out.push({ path: b.pathname, ...meta(b) });
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  }
  async del(paths: string[]) {
    if (paths.length) await del(paths, await this.auth());
  }
}
