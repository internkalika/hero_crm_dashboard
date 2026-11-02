// Shared plumbing for the per-source normalisers.
import type { DatasetMeta, DatasetPayload, DQIssue, ReadFile, Row, SheetData, SourceType } from '../types';
import { MAPPING_VERSION, SOURCES, autoMap } from './sources';
import { monthNumber } from '../util/parse';

export interface NormalizeCtx {
  /** reference "today" for year inference (injectable for deterministic tests) */
  now: Date;
  /** canonical -> actual column. Falls back to auto-mapping when absent */
  mapping?: Record<string, string>;
  /** user override of the dataset scope (YYYY-MM for monthly, ISO date for snapshots) */
  scopeOverride?: string | null;
  sheetName?: string | null;
}

export interface Normalized<T> {
  payload: DatasetPayload<T>;
}

export class IssueLog {
  readonly items: DQIssue[] = [];
  private caps = new Map<string, number>();
  add(i: DQIssue, cap = 500) {
    const n = (this.caps.get(i.code) ?? 0) + 1;
    this.caps.set(i.code, n);
    if (n <= cap) this.items.push(i);
  }
  /** number of issues raised for a code (including those beyond the stored cap) */
  count(code: string) {
    return this.caps.get(code) ?? 0;
  }
}

export function pickSheet(file: ReadFile, ctx: NormalizeCtx, source: SourceType): SheetData {
  if (ctx.sheetName) {
    const s = file.sheets.find((x) => x.name === ctx.sheetName);
    if (s) return s;
  }
  const def = SOURCES[source];
  let best = file.sheets[0];
  let bestHits = -1;
  for (const sh of file.sheets) {
    const hits = Object.keys(autoMap(sh.columns, def.fields)).length;
    if (hits > bestHits) {
      best = sh;
      bestHits = hits;
    }
  }
  return best;
}

export function getMapping(sheet: SheetData, source: SourceType, ctx: NormalizeCtx): Record<string, string> {
  return { ...autoMap(sheet.columns, SOURCES[source].fields), ...(ctx.mapping ?? {}) };
}

export function reader(row: Row, mapping: Record<string, string>) {
  return (canon: string) => (mapping[canon] ? row[mapping[canon]] ?? null : null);
}

/* ------------------------------ filename inference ------------------------------ */

const MONTH_TOKEN =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';

export function monthFromFilename(name: string): number | null {
  const re = new RegExp(`(?<![a-z])${MONTH_TOKEN}(?![a-z])`, 'gi');
  const hits = [...name.matchAll(re)].map((m) => monthNumber(m[1])!).filter(Boolean);
  return hits.length === 1 ? hits[0] : null; // "aug to oct" is a range, not a single month
}

export function dayMonthFromFilename(name: string): { day: number; month: number } | null {
  const re = new RegExp(`(?<![0-9])(\\d{1,2})\\s*${MONTH_TOKEN}(?![a-z])`, 'i');
  const m = re.exec(name);
  if (!m) return null;
  const day = +m[1];
  const month = monthNumber(m[2]);
  if (!month || day < 1 || day > 31) return null;
  return { day, month };
}

/** Latest year in which the date is not in the future (+1 day tolerance). */
export function inferYear(month: number, day: number, now: Date): number {
  const limit = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  for (let y = now.getFullYear(); y > now.getFullYear() - 5; y--) {
    if (Date.UTC(y, month - 1, day) <= limit) return y;
  }
  return now.getFullYear();
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function baseMeta(
  source: SourceType,
  scope: string,
  file: ReadFile,
  sheet: SheetData,
  mapping: Record<string, string>,
): DatasetMeta {
  return {
    id: `${source}:${scope}`,
    source,
    scope,
    fileName: file.fileName,
    sheet: sheet.name,
    importedAt: new Date().toISOString(),
    periodStart: null,
    periodEnd: null,
    period: null,
    snapshotDate: null,
    asOfDate: null,
    rawCount: sheet.populatedRows,
    validCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
    flaggedCount: 0,
    mappingVersion: MAPPING_VERSION,
    columns: sheet.columns,
    mapping,
    inference: [],
    fileSize: file.size,
    mode: 'add',
    extra: {},
  };
}

export function missingColumnIssues(mapping: Record<string, string>, source: SourceType, issues: IssueLog): string[] {
  const miss = Object.entries(SOURCES[source].fields)
    .filter(([k, d]) => d.required && !mapping[k])
    .map(([, d]) => d.label);
  for (const m of miss) {
    issues.add({ code: 'MISSING_REQUIRED_COLUMN', severity: 'error', message: `Required column not found: ${m}`, field: m });
  }
  return miss;
}

export function minMax(values: Array<string | null | undefined>): [string | null, string | null] {
  let lo: string | null = null;
  let hi: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (lo === null || v < lo) lo = v;
    if (hi === null || v > hi) hi = v;
  }
  return [lo, hi];
}

/** Dominant YYYY-MM of ISO dates, with its share. */
export function dominantMonth(dates: Array<string | null>): { month: string; share: number } | null {
  const counts = new Map<string, number>();
  let n = 0;
  for (const d of dates) {
    if (!d) continue;
    const m = d.slice(0, 7);
    counts.set(m, (counts.get(m) ?? 0) + 1);
    n++;
  }
  if (!n) return null;
  let best = '';
  let bc = 0;
  counts.forEach((c, m) => {
    if (c > bc) {
      best = m;
      bc = c;
    }
  });
  return { month: best, share: bc / n };
}

/** Month scope for files without dates inside (usage, employee activity): filename month + inferred year. */
export function monthScopeFromFilename(fileName: string, now: Date, override?: string | null): { scope: string; inference: string } | null {
  if (override) return { scope: override, inference: `Period set manually to ${override}.` };
  const m = monthFromFilename(fileName);
  if (!m) return null;
  const y = inferYear(m, 1, now);
  const scope = `${y}-${pad2(m)}`;
  return { scope, inference: `Reporting period ${scope} inferred from the file name (the file has no date column); year chosen as the latest year that is not in the future.` };
}
