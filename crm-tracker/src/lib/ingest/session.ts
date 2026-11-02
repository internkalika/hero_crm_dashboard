// Import session: the framework-free logic behind the 8-step Data Import workflow
// (Upload -> Identify -> Preview -> Validate -> Map -> Reconcile -> Refresh -> Confirm).
// The React wizard is a thin view over these functions, which keeps them unit-testable.
import type { DatasetMeta, DatasetPayload, SourceType } from '../types';
import type { IngestClient, NormalizeOptions } from './client';
import { FileAnalysis, ImportPlan, ImportSummary, Mode, applyImport, planImport } from './pipeline';
import { SOURCES, autoMap, missingRequired } from './sources';
import { isMultiMonth, splitByMonth } from './split';
import type { DealerOrderLine } from '../types';
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
  /** set on one month of a multi-month workbook: the id of the uploaded file and the month this row stands for */
  splitOf?: string;
  month?: string;
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
    let payload = await client.normalize(item.splitOf ?? item.analysis.id, item.source, opts);
    if (item.month) {
      // one month of a multi-month workbook: keep only that month (the file is analysed again when its mapping changes)
      const part = isMultiMonth(payload) ? splitByMonth(payload as DatasetPayload<DealerOrderLine>).find((x) => x.meta.scope === item.month) : null;
      if (!part) throw new Error(`The file no longer holds ${item.month}.`);
      payload = part;
    }
    payload.meta.extra = { ...(payload.meta.extra ?? {}), fileHash: item.analysis.hash };
    return { ...item, payload, error: undefined };
  } catch (e) {
    return { ...item, payload: undefined, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A multi-month workbook becomes one row per month, each planned on its own (Add / Replace / Skip). Rows of the same upload keep a
 * per-month file hash, so uploading the identical file again is recognised month by month as a duplicate and skipped.
 */
export function expandMonths(items: ImportItem[]): ImportItem[] {
  return items.flatMap((it) => {
    if (!it.include || !it.payload || it.month || !isMultiMonth(it.payload)) return [it];
    const parts = splitByMonth(it.payload as DatasetPayload<DealerOrderLine>);
    if (parts.length < 2) return [it];
    return parts.map((part) => ({
      ...it,
      analysis: { ...it.analysis, id: `${it.analysis.id}#${part.meta.scope}`, fileName: `${it.analysis.fileName} · ${part.meta.scope}`, hash: `${it.analysis.hash}#${part.meta.scope}` },
      splitOf: it.analysis.id,
      month: part.meta.scope,
      payload: { ...part, meta: { ...part.meta, extra: { ...(part.meta.extra ?? {}), fileHash: `${it.analysis.hash}#${part.meta.scope}` } } },
      plan: undefined,
      mode: undefined,
    }));
  });
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
