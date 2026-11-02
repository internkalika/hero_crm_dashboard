// Turning browser File / DataTransfer objects (files, folders, zips) into ingest inputs.
import type { FileInput } from '../../lib/ingest/readers';

const ACCEPT = /\.(csv|xlsx|xls|zip|txt|html?)$/i;

export const isSupported = (name: string) => ACCEPT.test(name) && !/^(~\$|\.)/.test(name.split('/').pop() ?? name) && !/__MACOSX|\.DS_Store/.test(name);

export async function filesToInputs(files: Array<File & { webkitRelativePath?: string }>): Promise<{ inputs: FileInput[]; skipped: string[] }> {
  const inputs: FileInput[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const path = f.webkitRelativePath || f.name;
    if (!isSupported(path)) {
      skipped.push(path);
      continue;
    }
    inputs.push({ name: f.name, size: f.size, buffer: await f.arrayBuffer(), origin: f.webkitRelativePath || undefined });
  }
  return { inputs, skipped };
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (e: FsEntry[]) => void, err?: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, out: File[], prefix = ''): Promise<void> {
  if (entry.isFile && entry.file) {
    const f = await new Promise<File>((res, rej) => entry.file!(res, rej));
    Object.defineProperty(f, 'webkitRelativePath', { value: prefix + f.name });
    out.push(f);
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<FsEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, out, `${prefix}${entry.name}/`);
    }
  }
}

/** Handles dropped files AND dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const items = Array.from(dt.items ?? []);
  const entries = items.map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null);
  if (entries.some(Boolean)) {
    for (const e of entries) if (e) await walk(e, out);
    return out;
  }
  return Array.from(dt.files);
}

export const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
