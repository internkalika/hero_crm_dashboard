// Orchestration: read -> identify -> normalise -> plan. Pure functions (no DOM, no storage) so the
// same code runs in the Web Worker, in the main thread and in tests.
import type { DatasetMeta, DatasetPayload, ReadFile, Row, SourceType } from '../types';
import { FileInput, readAny } from './readers';
import { Identification, SOURCES, identify } from './sources';
import type { NormalizeCtx } from './common';
import { normalizeDealerOrders, normalizeDsOrders } from './orders';
import { normalizeDealerComplaints, normalizeDsComplaints } from './complaints';
import { normalizeBizomUsage, normalizeEmployeeActivity } from './usage';
import { normalizeDsUsage } from './dsusage';
import { normalizeFocus, normalizeIssueTracker, normalizeLoyalty } from './other';
import { hashString } from '../util/parse';

export interface SheetPreview {
  name: string;
  columns: string[];
  rowCount: number;
  headerRow: number;
  declaredDimension?: string;
  preamble: string[];
  blankRowsSkipped: number;
  sample: Row[];
}

export interface FileAnalysis {
  id: string;
  fileName: string;
  origin?: string;
  size: number;
  hash: string;
  kind: ReadFile['kind'] | 'error';
  error?: string;
  sheets: SheetPreview[];
  identification: Identification;
}

export function hashBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}-${b.length}`;
}

export function analyzeInput(input: FileInput, id: string): { analysis: FileAnalysis; read: ReadFile | null } {
  const hash = hashBytes(input.buffer);
  try {
    const read = readAny(input.name, input.buffer);
    const identification = identify(read.sheets, input.name);
    const analysis: FileAnalysis = {
      id,
      fileName: input.name,
      origin: input.origin,
      size: input.size,
      hash,
      kind: read.kind,
      sheets: read.sheets.map((s) => ({
        name: s.name,
        columns: s.columns,
        rowCount: s.populatedRows,
        headerRow: s.headerRow,
        declaredDimension: s.declaredDimension,
        preamble: s.preamble,
        blankRowsSkipped: s.blankRowsSkipped,
        sample: s.rows.slice(0, 8),
      })),
      identification,
    };
    return { analysis, read };
  } catch (e) {
    return {
      analysis: {
        id,
        fileName: input.name,
        origin: input.origin,
        size: input.size,
        hash,
        kind: 'error',
        error: e instanceof Error ? e.message : String(e),
        sheets: [],
        identification: { source: null, confidence: 0, sheetName: null, candidates: [], ambiguous: true },
      },
      read: null,
    };
  }
}

export function normalizeFile(read: ReadFile, source: SourceType, ctx: NormalizeCtx): DatasetPayload {
  let payload: DatasetPayload;
  switch (source) {
    case 'dealer_orders':
      payload = normalizeDealerOrders(read, ctx);
      break;
    case 'ds_orders':
      payload = normalizeDsOrders(read, ctx);
      break;
    case 'dealer_complaints':
      payload = normalizeDealerComplaints(read, ctx);
      break;
    case 'ds_complaints':
      payload = normalizeDsComplaints(read, ctx);
      break;
    case 'bizom_usage':
      payload = normalizeBizomUsage(read, ctx);
      break;
    case 'ds_employee_activity':
      payload = normalizeEmployeeActivity(read, ctx, 'ds_employee_activity');
      break;
    case 'ds_usage':
      payload = normalizeDsUsage(read, ctx);
      break;
    case 'dealer_sfa_activity':
      payload = normalizeEmployeeActivity(read, ctx, 'dealer_sfa_activity');
      break;
    case 'issue_tracker':
      payload = normalizeIssueTracker(read, ctx);
      break;
    case 'loyalty_snapshot':
      payload = normalizeLoyalty(read, ctx);
      break;
    case 'focus_liquidation':
      payload = normalizeFocus(read, ctx);
      break;
    default:
      throw new Error(`Unknown source ${String(source)}`);
  }
  return payload;
}

/* ------------------------------ import planning ------------------------------ */

export type Mode = 'add' | 'replace' | 'merge' | 'skip';

export interface ImportPlan {
  datasetId: string;
  existing: DatasetMeta | null;
  recommended: Mode;
  options: Mode[];
  needsConfirmation: boolean;
  reason: string;
  duplicateUpload: boolean;
}

/**
 * Decides how a normalised file relates to what is already stored.
 * monthly / snapshot sources are keyed by period; range / single sources are one dataset per source.
 */
export function planImport(existing: DatasetMeta[], incoming: DatasetMeta, fileHash: string): ImportPlan {
  const prev = existing.find((d) => d.id === incoming.id) ?? null;
  const grain = SOURCES[incoming.source].grain;
  if (!prev) {
    return { datasetId: incoming.id, existing: null, recommended: 'add', options: ['add', 'skip'], needsConfirmation: false, reason: grain === 'monthly' ? `New reporting period ${incoming.scope}.` : grain === 'snapshot' ? `New snapshot dated ${incoming.scope}.` : 'No dataset of this kind has been imported yet.', duplicateUpload: false };
  }
  const prevHash = (prev.extra as { fileHash?: string } | undefined)?.fileHash;
  if (prevHash && prevHash === fileHash) {
    return { datasetId: incoming.id, existing: prev, recommended: 'skip', options: ['skip', 'replace'], needsConfirmation: false, reason: 'Identical to the file already imported (duplicate upload). Nothing to do.', duplicateUpload: true };
  }
  if (grain === 'monthly' || grain === 'snapshot') {
    return { datasetId: incoming.id, existing: prev, recommended: 'replace', options: ['replace', 'skip'], needsConfirmation: false, reason: `A ${grain === 'monthly' ? 'month' : 'snapshot'} ${incoming.scope} already exists; the new file replaces it.`, duplicateUpload: false };
  }
  // range / single: decide between replace and merge
  const ps = prev.periodStart;
  const pe = prev.periodEnd;
  const ns = incoming.periodStart;
  const ne = incoming.periodEnd;
  if (ps && pe && ns && ne) {
    if (ns <= ps && ne >= pe) return { datasetId: incoming.id, existing: prev, recommended: 'replace', options: ['replace', 'merge', 'skip'], needsConfirmation: false, reason: `New file covers ${ns} to ${ne}, a superset of the stored ${ps} to ${pe}: full replacement.`, duplicateUpload: false };
    if (ns > pe) return { datasetId: incoming.id, existing: prev, recommended: 'merge', options: ['merge', 'replace', 'skip'], needsConfirmation: false, reason: `New file starts after the stored data ends (${pe}): treated as an increment and merged by record key.`, duplicateUpload: false };
    return { datasetId: incoming.id, existing: prev, recommended: 'replace', options: ['replace', 'merge', 'skip'], needsConfirmation: true, reason: `New file (${ns} to ${ne}) only partly overlaps the stored data (${ps} to ${pe}). Confirm whether to replace it or merge by record key.`, duplicateUpload: false };
  }
  return { datasetId: incoming.id, existing: prev, recommended: 'replace', options: ['replace', 'merge', 'skip'], needsConfirmation: true, reason: 'Cannot compare the periods of the two files safely. Confirm whether to replace or merge.', duplicateUpload: false };
}

export interface ImportSummary {
  datasetId: string;
  source: SourceType;
  fileName: string;
  mode: Mode;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  skipped: number;
  flagged: number;
}

const sig = (r: unknown): string => {
  const { datasetId, ...rest } = r as Record<string, unknown>;
  void datasetId;
  return hashString(JSON.stringify(rest));
};

/** Applies the chosen mode and returns the payload to store plus the refresh summary. */
export function applyImport(
  previous: DatasetPayload | null,
  incoming: DatasetPayload,
  mode: Mode,
): { payload: DatasetPayload | null; summary: ImportSummary } {
  const base: ImportSummary = {
    datasetId: incoming.meta.id,
    source: incoming.meta.source,
    fileName: incoming.meta.fileName,
    mode,
    added: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    skipped: incoming.meta.duplicateCount + incoming.meta.invalidCount,
    flagged: incoming.meta.flaggedCount,
  };
  if (mode === 'skip') return { payload: null, summary: { ...base, skipped: incoming.meta.validCount + base.skipped } };
  if (mode === 'add' || !previous) {
    incoming.meta.mode = 'add';
    return { payload: incoming, summary: { ...base, added: incoming.records.length } };
  }
  if (mode === 'replace') {
    incoming.meta.mode = 'replace';
    return { payload: incoming, summary: { ...base, added: incoming.records.length, removed: previous.records.length } };
  }
  // merge by key
  const map = new Map<string, unknown>();
  const prevSig = new Map<string, string>();
  for (const r of previous.records as Array<{ key: string }>) {
    map.set(r.key, r);
    prevSig.set(r.key, sig(r));
  }
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of incoming.records as Array<{ key: string }>) {
    const s = prevSig.get(r.key);
    if (s === undefined) added++;
    else if (s === sig(r)) unchanged++;
    else updated++;
    map.set(r.key, r);
  }
  const m = incoming.meta;
  const pm = previous.meta;
  const merged: DatasetPayload = {
    meta: {
      ...m,
      mode: 'merge',
      periodStart: [pm.periodStart, m.periodStart].filter(Boolean).sort()[0] ?? null,
      periodEnd: ([pm.periodEnd, m.periodEnd].filter(Boolean).sort().pop() as string | undefined) ?? null,
      validCount: map.size,
      rawCount: pm.rawCount + m.rawCount,
      duplicateCount: pm.duplicateCount + m.duplicateCount,
      invalidCount: pm.invalidCount + m.invalidCount,
      totalRowCount: (pm.totalRowCount ?? 0) + (m.totalRowCount ?? 0),
      inference: [...m.inference, `Merged into the existing dataset by record key: ${added} added, ${updated} updated, ${unchanged} unchanged.`],
    },
    raw: [...previous.raw, ...incoming.raw],
    records: [...map.values()],
    issues: [...previous.issues, ...incoming.issues],
  };
  merged.meta.period = merged.meta.periodStart && merged.meta.periodEnd ? `${merged.meta.periodStart} to ${merged.meta.periodEnd}` : m.period;
  if (m.source === 'ds_usage') {
    // the Summary and ASM-Employee-wise sheets describe one file; after a merge they would no longer match the orders
    merged.meta.extra = { ...(m.extra ?? {}), reconciliation: [], usageReport: { reported: null, summary: null, employees: null, notes: [] } };
    merged.meta.inference.push('The report\'s own Summary and ASM-Employee-wise sheets describe a single file and are not kept after a merge.');
  }
  return { payload: merged, summary: { ...base, mode: 'merge', added, updated, unchanged } };
}
