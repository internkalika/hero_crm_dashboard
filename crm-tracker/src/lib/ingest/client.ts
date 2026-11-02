// Main-thread client for the ingest worker, with an in-thread fallback (used in tests and when
// Workers are unavailable). The API is identical either way.
import type { DatasetPayload, ReadFile, SourceType } from '../types';
import { FileInput, expandInputs } from './readers';
import { FileAnalysis, analyzeInput, normalizeFile } from './pipeline';
import type { WorkerRequest, WorkerResponse } from '../../workers/ingest.worker';
import { spawnIngestWorker } from '@workerSpawn';

export interface NormalizeOptions {
  mapping?: Record<string, string>;
  scopeOverride?: string | null;
  sheetName?: string | null;
}

export interface IngestClient {
  analyze(files: FileInput[], onProgress?: (done: number, total: number, fileName: string) => void): Promise<FileAnalysis[]>;
  normalize(id: string, source: SourceType, opts?: NormalizeOptions): Promise<DatasetPayload>;
  release(ids: string[]): void;
  terminate(): void;
}

export function createInlineClient(now: () => Date = () => new Date()): IngestClient {
  const reads = new Map<string, ReadFile>();
  return {
    async analyze(files, onProgress) {
      const expanded = await expandInputs(files);
      const out: FileAnalysis[] = [];
      let i = 0;
      for (const f of expanded) {
        onProgress?.(i, expanded.length, f.name);
        const id = `${Date.now().toString(36)}-${i}-${f.name}`;
        const { analysis, read } = analyzeInput(f, id);
        if (read) reads.set(id, read);
        out.push(analysis);
        i++;
        await new Promise((r) => setTimeout(r, 0));
      }
      onProgress?.(expanded.length, expanded.length, '');
      return out;
    },
    async normalize(id, source, opts) {
      const read = reads.get(id);
      if (!read) throw new Error('The file is no longer loaded. Upload it again.');
      return normalizeFile(read, source, { now: now(), ...opts });
    },
    release(ids) {
      ids.forEach((i) => reads.delete(i));
    },
    terminate() {
      reads.clear();
    },
  };
}

export function createWorkerClient(): IngestClient {
  if (typeof Worker === 'undefined') return createInlineClient();
  let worker: Worker;
  try {
    worker = spawnIngestWorker();
  } catch {
    // some browsers refuse workers for locally opened files: parse on the main thread instead
    return createInlineClient();
  }
  let seq = 0;
  const pending = new Map<number, { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number, f: string) => void }>();
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const m = ev.data;
    const p = pending.get(m.requestId);
    if (!p) return;
    if (m.type === 'progress') p.onProgress?.(m.done, m.total, m.fileName);
    else {
      pending.delete(m.requestId);
      if (m.type === 'error') p.reject(new Error(m.message));
      else p.resolve(m);
    }
  };
  worker.onerror = (e) => {
    pending.forEach((p) => p.reject(new Error(e.message || 'Import worker crashed.')));
    pending.clear();
  };
  const call = (req: WorkerRequest & { requestId?: number }, transfer: Transferable[] = [], onProgress?: (d: number, t: number, f: string) => void) =>
    new Promise<WorkerResponse>((resolve, reject) => {
      const requestId = ++seq;
      pending.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({ ...req, requestId }, transfer);
    });
  return {
    async analyze(files, onProgress) {
      const copy = files.map((f) => ({ ...f, buffer: f.buffer.slice(0) }));
      const r = await call({ type: 'analyze', files: copy, requestId: 0 }, copy.map((f) => f.buffer), onProgress);
      if (r.type !== 'analyzed') throw new Error('Unexpected worker response');
      return r.analyses;
    },
    async normalize(id, source, opts) {
      const r = await call({ type: 'normalize', id, source, now: Date.now(), requestId: 0, ...opts });
      if (r.type !== 'normalized') throw new Error('Unexpected worker response');
      return r.payload;
    },
    release(ids) {
      worker.postMessage({ type: 'release', ids } satisfies WorkerRequest);
    },
    terminate() {
      worker.terminate();
    },
  };
}
