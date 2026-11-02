// Import session: the framework-free logic behind the 8-step Data Import workflow
// (Upload -> Identify -> Preview -> Validate -> Map -> Reconcile -> Refresh -> Confirm).
// The React wizard is a thin view over these functions, which keeps them unit-testable.
import type { DatasetMeta, DatasetPayload, SourceType } from '../types';
import type { IngestClient, NormalizeOptions } from './client';
import { FileAnalysis, ImportPlan, ImportSummary, Mode, applyImport, planImport } from './pipeline';
import { SOURCES, autoMap, missingRequired } from './sources';
import { addHistory, loadPayload, saveDataset } from '../store/db';

export interface ImportItem {
  analysis: FileAnalysis;
  /** source the user confirmed / the detected one */
  source: SourceType | null;
  sheetName: string | null;
  scopeOverride: string | null;
  /** user-edited canonical field -> source column map (undefined = automatic) */
  mapping?: Record<string, string>;
  include: boolean;
  /** set after normalisation */
  payload?: DatasetPayload;
  error?: string;
  plan?: ImportPlan;
  mode?: Mode;
}

export function itemsFromAnalyses(analyses: FileAnalysis[]): ImportItem[] {
  return analyses.map((a) => {
    const id = a.identification;
    const usable = !a.error && !!id.source && !id.ambiguous;
    return { analysis: a, source: id.source, sheetName: id.sheetName, scopeOverride: null, include: usable };
  });
}

export function sheetColumns(item: ImportItem): string[] {
  const sheet = item.analysis.sheets.find((s) => s.name === item.sheetName) ?? item.analysis.sheets[0];
  return sheet?.columns ?? [];
}

/** Canonical field -> source column for the current source/sheet (auto-mapped unless overridden). */
export function effectiveMapping(item: ImportItem): Record<string, string> {
  if (!item.source) return {};
  return item.mapping ?? autoMap(sheetColumns(item), SOURCES[item.source].fields);
}

export function missingForItem(item: ImportItem): string[] {
  if (!item.source) return [];
  return missingRequired(effectiveMapping(item), SOURCES[item.source].fields);
}

export async function normalizeItem(client: IngestClient, item: ImportItem): Promise<ImportItem> {
  if (!item.source) return { ...item, error: 'Choose what kind of file this is.', payload: undefined };
  try {
    const opts: NormalizeOptions = { mapping: item.mapping, scopeOverride: item.scopeOverride, sheetName: item.sheetName };
    const payload = await client.normalize(item.analysis.id, item.source, opts);
    payload.meta.extra = { ...(payload.meta.extra ?? {}), fileHash: item.analysis.hash };
    return { ...item, payload, error: undefined };
  } catch (e) {
    return { ...item, payload: undefined, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Two files in the same batch that would write the same dataset id. */
export function batchConflicts(items: ImportItem[]): Array<{ id: string; files: string[] }> {
  const by = new Map<string, string[]>();
  for (const it of items) {
    if (!it.include || !it.payload) continue;
    const a = by.get(it.payload.meta.id) ?? [];
    a.push(it.analysis.fileName);
    by.set(it.payload.meta.id, a);
  }
  return [...by.entries()].filter(([, f]) => f.length > 1).map(([id, files]) => ({ id, files }));
}

export function planItems(existing: DatasetMeta[], items: ImportItem[]): ImportItem[] {
  return items.map((it) => {
    if (!it.include || !it.payload) return it;
    const plan = planImport(existing, it.payload.meta, it.analysis.hash);
    return { ...it, plan, mode: it.mode && plan.options.includes(it.mode) ? it.mode : plan.recommended };
  });
}

export interface CommitResult {
  summaries: ImportSummary[];
  failed: Array<{ fileName: string; message: string }>;
}

/** Persists each file independently so one failure never leaves the others half-written. */
export async function commitItems(items: ImportItem[]): Promise<CommitResult> {
  const summaries: ImportSummary[] = [];
  const failed: CommitResult['failed'] = [];
  for (const it of items) {
    if (!it.include || !it.payload || !it.mode) continue;
    try {
      const prev = it.mode === 'merge' || it.mode === 'replace' ? await loadPayload(it.payload.meta.id) : null;
      const { payload, summary } = applyImport(prev, it.payload, it.mode);
      if (payload) {
        payload.meta.importedAt = new Date().toISOString();
        await saveDataset(payload);
      }
      summaries.push(summary);
    } catch (e) {
      failed.push({ fileName: it.analysis.fileName, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const imported = summaries.filter((s) => s.mode !== 'skip');
  await addHistory({
    at: new Date().toISOString(),
    action: 'import',
    ok: failed.length === 0,
    summary: `${imported.length} file${imported.length === 1 ? '' : 's'} imported${failed.length ? `, ${failed.length} failed` : ''}${summaries.length - imported.length ? `, ${summaries.length - imported.length} skipped` : ''}.`,
    items: summaries,
  });
  return { summaries, failed };
}
