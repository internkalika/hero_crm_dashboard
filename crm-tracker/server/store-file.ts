// Directory-backed store (tests, local development). Conditional writes are serialised through a mutex and written
// atomically, so it behaves like the compare-and-swap of the real store.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PreconditionFailed, type PutOptions, type Store, type StoredObject } from './store.js';

export class FileStore implements Store {
  readonly kind = 'file' as const;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string) {}

  private file(p: string) {
    const f = path.resolve(this.dir, ...p.split('/'));
    if (!f.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('Invalid path');
    return f;
  }
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async stat(f: string): Promise<StoredObject | null> {
    try {
      const [st, bytes] = await Promise.all([fs.stat(f), fs.readFile(f)]);
      return { etag: crypto.createHash('sha1').update(bytes).digest('hex'), size: st.size, uploadedAt: st.mtime.toISOString() };
    } catch {
      return null;
    }
  }

  head(p: string) {
    return this.stat(this.file(p));
  }
  async getBytes(p: string) {
    try {
      const bytes = new Uint8Array(await fs.readFile(this.file(p)));
      const st = await fs.stat(this.file(p));
      return { bytes, etag: crypto.createHash('sha1').update(bytes).digest('hex'), size: bytes.byteLength, uploadedAt: st.mtime.toISOString() };
    } catch {
      return null;
    }
  }
  async getStream(p: string) {
    const o = await this.getBytes(p);
    if (!o) return null;
    const { bytes, ...meta } = o;
    return { ...meta, stream: new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array> };
  }
  put(p: string, bytes: Uint8Array, opts: PutOptions) {
    return this.lock(async () => {
      const f = this.file(p);
      const cur = await this.stat(f);
      if (opts.ifNotExists && cur) throw new PreconditionFailed('The object already exists.');
      if (opts.ifMatch !== undefined && cur?.etag !== opts.ifMatch) throw new PreconditionFailed();
      if (cur && !opts.overwrite && opts.ifMatch === undefined) throw new PreconditionFailed('The object already exists.');
      await fs.mkdir(path.dirname(f), { recursive: true });
      const tmp = `${f}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, f);
      return (await this.stat(f))!;
    });
  }
  async list(prefix: string) {
    const out: Array<{ path: string } & StoredObject> = [];
    const walk = async (d: string, rel: string) => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(d, e.name), r);
        else if (!e.name.endsWith('.tmp') && r.startsWith(prefix)) {
          const s = await this.stat(path.join(d, e.name));
          if (s) out.push({ path: r, ...s });
        }
      }
    };
    await walk(path.resolve(this.dir), '');
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  async del(paths: string[]) {
    for (const p of paths) await fs.rm(this.file(p), { force: true });
  }
}
