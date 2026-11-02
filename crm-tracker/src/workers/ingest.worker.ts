/// <reference lib="webworker" />
// Heavy parsing (XLSX/XLS/HTML tables, 1M-row dimensions, ZIP expansion) runs here so the UI stays responsive.
import type { ReadFile, SourceType } from '../lib/types';
import { FileInput, expandInputs } from '../lib/ingest/readers';
import { FileAnalysis, analyzeInput, normalizeFile } from '../lib/ingest/pipeline';

export type WorkerRequest =
  | { type: 'analyze'; requestId: number; files: FileInput[] }
  | { type: 'normalize'; requestId: number; id: string; source: SourceType; mapping?: Record<string, string>; scopeOverride?: string | null; sheetName?: string | null; now: number }
  | { type: 'release'; ids: string[] };

export type WorkerResponse =
  | { type: 'progress'; requestId: number; done: number; total: number; fileName: string }
  | { type: 'analyzed'; requestId: number; analyses: FileAnalysis[] }
  | { type: 'normalized'; requestId: number; payload: ReturnType<typeof normalizeFile> }
  | { type: 'error'; requestId: number; message: string };

const reads = new Map<string, ReadFile>();

const post = (m: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'analyze') {
      const expanded = await expandInputs(msg.files);
      const analyses: FileAnalysis[] = [];
      let i = 0;
      for (const f of expanded) {
        const id = `${Date.now().toString(36)}-${i}-${f.name}`;
        post({ type: 'progress', requestId: msg.requestId, done: i, total: expanded.length, fileName: f.name });
        const { analysis, read } = analyzeInput(f, id);
        if (read) reads.set(id, read);
        analyses.push(analysis);
        i++;
      }
      post({ type: 'progress', requestId: msg.requestId, done: expanded.length, total: expanded.length, fileName: '' });
      post({ type: 'analyzed', requestId: msg.requestId, analyses });
    } else if (msg.type === 'normalize') {
      const read = reads.get(msg.id);
      if (!read) throw new Error('The file is no longer loaded. Upload it again.');
      const payload = normalizeFile(read, msg.source, { now: new Date(msg.now), mapping: msg.mapping, scopeOverride: msg.scopeOverride, sheetName: msg.sheetName });
      post({ type: 'normalized', requestId: msg.requestId, payload });
    } else if (msg.type === 'release') {
      msg.ids.forEach((id) => reads.delete(id));
    }
  } catch (e) {
    post({ type: 'error', requestId: (msg as { requestId?: number }).requestId ?? -1, message: e instanceof Error ? e.message : String(e) });
  }
};
