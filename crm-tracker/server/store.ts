// The object store behind publishing. The app only needs a handful of operations; the production implementation is a
// PRIVATE Vercel Blob store, tests and local development use a directory. Nothing outside the server ever sees a
// store URL: viewers are served through the public API, which streams from here.

export class PreconditionFailed extends Error {
  constructor(message = 'The object was changed by someone else.') {
    super(message);
    this.name = 'PreconditionFailed';
  }
}

export interface StoredObject {
  etag: string;
  size: number;
  uploadedAt: string;
}

export interface PutOptions {
  contentType: string;
  /** replace only if the stored object still has this etag (compare-and-swap) */
  ifMatch?: string;
  /** create only: fail with PreconditionFailed when the object exists */
  ifNotExists?: boolean;
  /** objects of a store are immutable unless one of the two options above says how they may be replaced */
  overwrite?: boolean;
}

export interface Store {
  readonly kind: 'vercel-blob' | 'file' | 'memory';
  head(path: string): Promise<StoredObject | null>;
  getBytes(path: string): Promise<(StoredObject & { bytes: Uint8Array }) | null>;
  getStream(path: string): Promise<(StoredObject & { stream: ReadableStream<Uint8Array> }) | null>;
  put(path: string, bytes: Uint8Array, opts: PutOptions): Promise<StoredObject>;
  list(prefix: string): Promise<Array<{ path: string } & StoredObject>>;
  del(paths: string[]): Promise<void>;
}
