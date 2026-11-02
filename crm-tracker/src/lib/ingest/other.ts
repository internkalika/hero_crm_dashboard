// Normalisers for the issue tracker, Hero Smiles (Capillary) snapshots and Focus & Liquidation.
import type {
  DatasetPayload,
  FocusRec,
  IssueRec,
  IssueStatusGroup,
  IssueUpdate,
  LoyaltyRec,
  ReadFile,
  Row,
  SheetData,
} from '../types';
import {
  IssueLog,
  NormalizeCtx,
  baseMeta,
  dayMonthFromFilename,
  getMapping,
  inferYear,
  minMax,
  missingColumnIssues,
  pad2,
  pickSheet,
  reader,
} from './common';
import { SOURCES, autoMap } from './sources';
import { dealerKeyOf, isNumericCode, maskMobile, monthNumber, num, parseDate, parseNumber, str, normHeader } from '../util/parse';

/* ================================ Issue tracker ================================ */

export const ISSUE_STATUS_MAP: Record<string, { label: string; group: IssueStatusGroup }> = {
  completed: { label: 'Completed', group: 'resolved' },
  'in progress': { label: 'In Progress', group: 'in_progress' },
  'demo / uat': { label: 'Demo / UAT', group: 'in_progress' },
  'feasibility check': { label: 'Feasibility Check', group: 'in_progress' },
  'awaiting hero input': { label: 'Awaiting Hero Input', group: 'waiting' },
  'not started': { label: 'Not Started', group: 'waiting' },
  'on hold': { label: 'On hold', group: 'waiting' },
};

const TYPE_VALUES = new Set(['dev', 'report', 'issue', 'mdm', 'dashboard', 'training', 'form & report', 'form']);

function trackerSheet(file: ReadFile): SheetData {
  const withCols = file.sheets.find((s) => ['pointer', 'platform', 'status'].every((k) => s.columns.some((c) => normHeader(c) === k)));
  return withCols ?? file.sheets.find((s) => /tracker/i.test(s.name)) ?? file.sheets[0];
}

function parseTarget(
  raw: string | null,
  commonYear: number,
): { date: string | null; kind: IssueRec['targetKind']; note?: string } {
  if (!raw) return { date: null, kind: 'none' };
  const direct = parseDate(raw, 'dmy');
  if (direct && /^\d{4}-\d{2}-\d{2}/.test(raw)) return { date: direct.date, kind: 'date' };
  const m = /^(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]{3,9})\.?(?:\s*(\d{2,4}))?$/i.exec(raw.trim());
  if (m) {
    const mon = monthNumber(m[2]);
    if (mon) {
      let y = commonYear;
      let note = `Year not stated; ${commonYear} assumed from the other target dates.`;
      if (m[3]) {
        y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        if (Math.abs(y - commonYear) > 1) {
          note = `Year "${m[3]}" looks truncated; ${commonYear} assumed.`;
          y = commonYear;
        } else note = '';
      }
      const d = parseDate(`${m[1]}-${mon}-${y}`, 'dmy');
      if (d) return { date: d.date, kind: 'text-date', note };
    }
  }
  return { date: null, kind: 'non-date' };
}

interface DashboardCheck {
  headlineTotal: number | null;
  headlineCompleted: number | null;
  platformTableTotal: number | null;
  platformTableCompleted: number | null;
  trackerTotal: number;
  trackerCompleted: number;
}

function readDashboard(file: ReadFile, tracker: SheetData): Omit<DashboardCheck, 'trackerTotal' | 'trackerCompleted'> | null {
  const sh = file.sheets.find((s) => s !== tracker && /dashboard/i.test(s.name));
  if (!sh) return null;
  const mat: (string | number | boolean | null)[][] = [sh.columns, ...sh.rows.map((r) => sh.columns.map((c) => r[c]))];
  const find = (label: string, from = 0) => mat.findIndex((r, i) => i >= from && String(r[0] ?? '').trim().toLowerCase() === label);
  const colOf = (hdrRow: number, name: string) => mat[hdrRow].findIndex((c) => String(c ?? '').trim().toLowerCase() === name);
  const all = find('all pointers');
  let headlineTotal: number | null = null;
  let headlineCompleted: number | null = null;
  if (all > 0) {
    const hdr = all - 1;
    const t = colOf(hdr, 'total pointers');
    const c = colOf(hdr, 'completed');
    headlineTotal = t >= 0 ? num(mat[all][t]) : null;
    headlineCompleted = c >= 0 ? num(mat[all][c]) : null;
  }
  const plat = find('platform');
  const tot = find('total', plat >= 0 ? plat : 0);
  let platformTableTotal: number | null = null;
  let platformTableCompleted: number | null = null;
  if (plat >= 0 && tot > plat) {
    const t = colOf(plat, 'total');
    const c = colOf(plat, 'completed');
    platformTableTotal = t >= 0 ? num(mat[tot][t]) : null;
    platformTableCompleted = c >= 0 ? num(mat[tot][c]) : null;
  }
  return { headlineTotal, headlineCompleted, platformTableTotal, platformTableCompleted };
}

export function normalizeIssueTracker(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<IssueRec> {
  const sheet = ctx.sheetName ? file.sheets.find((s) => s.name === ctx.sheetName) ?? trackerSheet(file) : trackerSheet(file);
  const mapping = getMapping(sheet, 'issue_tracker', ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, 'issue_tracker', issues);

  const known = new Set(Object.values(mapping));
  const updateCols = sheet.columns.filter((c) => !known.has(c) && !/^Column [A-Z]+$/.test(c));
  const commonYear = (() => {
    const years = new Map<number, number>();
    sheet.rows.forEach((r) => {
      const v = mapping.target ? r[mapping.target] : null;
      if (typeof v === 'string' && /^\d{4}-/.test(v)) years.set(+v.slice(0, 4), (years.get(+v.slice(0, 4)) ?? 0) + 1);
    });
    let best = ctx.now.getFullYear();
    let bc = 0;
    years.forEach((c, y) => c > bc && ((best = y), (bc = c)));
    return best;
  })();

  const updateMeta = updateCols.map((c) => {
    const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(c);
    const d = m ? parseDate(`${m[1]}-${m[2]}-${m[3]}`, 'dmy') : null;
    return { column: c, label: c.replace(/^Latest Update\s*-\s*/i, '').trim(), date: d?.date ?? null };
  });
  updateMeta.forEach((u) => {
    if (u.date && +u.date.slice(0, 4) !== commonYear) {
      issues.add({ code: 'SUSPICIOUS_DATE', severity: 'warning', message: `Update column "${u.column}" is dated ${u.date}, a different year from the rest of the tracker (${commonYear}); probably a typo. Kept as written.`, field: u.column });
    }
  });

  const recs: IssueRec[] = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Set<string>();
  sheet.rows.forEach((row, i) => {
    const g = reader(row, mapping);
    const rowNo = sheet.rowNumbers[i];
    const pointer = str(g('pointer'));
    if (!pointer) {
      invalid++;
      issues.add({ code: 'MISSING_ID', severity: 'warning', message: 'Row has no pointer text and was excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    const flags: string[] = [];
    let typeRaw = str(g('type'));
    let priorityRaw = str(g('priority'));
    // The Type and priority columns are swapped on some rows (P1/P2 in "Type", Dev/Report in the unnamed column).
    if (typeRaw && /^p\d$/i.test(typeRaw) && priorityRaw && !/^p\d$/i.test(priorityRaw)) {
      [typeRaw, priorityRaw] = [priorityRaw, typeRaw];
      flags.push('type_priority_swapped');
    }
    const priority = priorityRaw && /^p[1-3]$/i.test(priorityRaw) ? (priorityRaw.toUpperCase() as IssueRec['priority']) : null;
    if (priorityRaw && !priority) flags.push('priority_not_p1_p3');
    const type = typeRaw && TYPE_VALUES.has(typeRaw.toLowerCase()) ? typeRaw : typeRaw;
    const rawStatus = str(g('status')) ?? '';
    const sm = ISSUE_STATUS_MAP[rawStatus.toLowerCase()];
    if (!sm) issues.add({ code: 'UNMAPPED_STATUS', severity: 'warning', message: `Status "${rawStatus}" is not mapped.`, ref: `row ${rowNo}`, field: 'Status', value: rawStatus });
    if (sm && sm.label !== rawStatus) flags.push('status_case_normalised');
    const targetRaw = (() => {
      const v = g('target');
      return v === null ? null : str(v);
    })();
    const t = parseTarget(targetRaw, commonYear);
    if (t.kind === 'non-date') issues.add({ code: 'TARGET_NOT_A_DATE', severity: 'info', message: `Target "${targetRaw}" is not a date; overdue status cannot be evaluated.`, ref: `row ${rowNo}`, field: 'Target Date', value: targetRaw ?? '' });
    if (t.kind === 'text-date' && t.note) issues.add({ code: 'TARGET_TEXT_DATE', severity: 'info', message: `Target "${targetRaw}" read as ${t.date}. ${t.note}`, ref: `row ${rowNo}`, field: 'Target Date', value: targetRaw ?? '' });
    const updates: IssueUpdate[] = updateMeta
      .map((u) => ({ label: u.label, date: u.date, text: str(row[u.column]) ?? '' }))
      .filter((u) => u.text && u.text !== ' ');
    const last = updates.length ? updates[updates.length - 1] : null;
    const sig = [pointer.toLowerCase(), g('platform'), rawStatus].join('~');
    if (seen.has(sig)) {
      duplicates++;
      issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Same pointer, platform and status repeated; extra copy excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    seen.add(sig);
    recs.push({
      key: `row-${rowNo}`,
      datasetId: '',
      rowNo,
      pointer,
      type,
      typeRaw,
      priority,
      priorityRaw,
      platform: str(g('platform'))?.replace(/\s+/g, ' ') ?? null,
      status: sm?.label ?? rawStatus,
      rawStatus,
      statusGroup: sm?.group ?? 'unmapped',
      targetRaw,
      targetDate: t.date,
      targetKind: t.kind,
      updates,
      lastUpdateText: last?.text ?? null,
      lastUpdateLabel: last?.label ?? null,
      flags,
    });
  });

  const swapped = recs.filter((r) => r.flags.includes('type_priority_swapped')).length;
  if (swapped) issues.add({ code: 'COLUMNS_SWAPPED', severity: 'info', message: `${swapped} rows had Type and priority values in each other's column (P1/P2 under "Type"); they were read the right way round.` });
  const notP = recs.filter((r) => r.flags.includes('priority_not_p1_p3')).length;
  if (notP) issues.add({ code: 'PRIORITY_COLUMN_MIXED', severity: 'info', message: `${notP} rows hold "Completed"/"Ongoing" in the priority column; they have no priority (raw value kept).` });
  issues.add({ code: 'FIELD_NOT_IN_SOURCE', severity: 'info', message: 'The tracker has no department, owner, created date or resolved date columns. Platform is used for grouping; owner, aging and resolution time are shown as unavailable.' });

  const dash = readDashboard(file, sheet);
  const trackerCompleted = recs.filter((r) => r.statusGroup === 'resolved').length;
  let dashboardCheck: DashboardCheck | null = null;
  if (dash) {
    dashboardCheck = { ...dash, trackerTotal: recs.length, trackerCompleted };
    if (dash.headlineTotal !== null && dash.headlineTotal !== recs.length) {
      issues.add({ code: 'DASHBOARD_MISMATCH', severity: 'warning', message: `Dashboard sheet says ${dash.headlineTotal} pointers; the Tracker sheet has ${recs.length}.` });
    }
    if (dash.platformTableTotal !== null && dash.headlineTotal !== null && dash.platformTableTotal !== dash.headlineTotal) {
      issues.add({ code: 'DASHBOARD_MISMATCH', severity: 'warning', message: `Dashboard sheet is internally inconsistent: headline total ${dash.headlineTotal} vs platform table total ${dash.platformTableTotal} (the platform table does not list every platform and looks stale). CRM Tracker recomputes from the Tracker rows.` });
    }
  }

  const meta = baseMeta('issue_tracker', ctx.scopeOverride ?? 'all', file, sheet, mapping);
  recs.forEach((r) => (r.datasetId = meta.id));
  const dates = updateMeta.map((u) => u.date).filter(Boolean) as string[];
  const [lo, hi] = minMax(dates.filter((d) => +d.slice(0, 4) === commonYear));
  meta.periodStart = lo;
  meta.periodEnd = hi;
  meta.period = lo && hi ? `${lo} to ${hi}` : null;
  meta.asOfDate = hi;
  meta.validCount = recs.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity === 'warning').map((i) => i.ref)).size;
  meta.inference = [
    `Header row detected at sheet row ${sheet.headerRow}; ${sheet.blankRowsSkipped} blank rows skipped.`,
    `Worksheet dimension ${sheet.declaredDimension ?? '?'}; ${recs.length} pointers found.`,
    'The unnamed third column holds the priority (P1/P2/P3).',
  ];
  meta.extra = { dashboardCheck, updateColumns: updateMeta, commonYear };
  return { meta, raw: sheet.rows, records: recs, issues: issues.items };
}

/* ================================ Hero Smiles ================================ */

export function normalizeLoyalty(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<LoyaltyRec> {
  const sheet = pickSheet(file, ctx, 'loyalty_snapshot');
  const mapping = getMapping(sheet, 'loyalty_snapshot', ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, 'loyalty_snapshot', issues);

  const inference: string[] = [];
  let snapshotDate: string | null = ctx.scopeOverride ?? null;
  if (snapshotDate) inference.push(`Snapshot date set manually to ${snapshotDate}.`);
  else {
    const dm = dayMonthFromFilename(file.fileName);
    if (dm) {
      snapshotDate = `${inferYear(dm.month, dm.day, ctx.now)}-${pad2(dm.month)}-${pad2(dm.day)}`;
      inference.push(`Snapshot date ${snapshotDate} inferred from the file name (the file has no date column); year chosen as the latest year not in the future.`);
    } else issues.add({ code: 'PERIOD_UNKNOWN', severity: 'error', message: 'Snapshot date could not be inferred from the file name. Set it manually in the Identify step.' });
  }
  const snap = snapshotDate ?? 'unknown';

  const recs: LoyaltyRec[] = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Map<string, LoyaltyRec>();
  sheet.rows.forEach((row, i) => {
    const g = reader(row, mapping);
    const rowNo = sheet.rowNumbers[i];
    const idRaw = str(g('customerId'));
    if (!idRaw) {
      invalid++;
      issues.add({ code: 'MISSING_ID', severity: 'error', message: 'Row has no customer_external_ID and was excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    const key = dealerKeyOf(idRaw);
    const verified = isNumericCode(key);
    const mobileRaw = str(g('mobile'));
    const flags: string[] = [];
    if (!verified) {
      flags.push('unverified_id');
      issues.add({ code: 'UNVERIFIED_ID', severity: 'warning', message: `Customer ID "${idRaw}" is not a stable dealer code; this row is never joined to other systems.`, ref: idRaw, field: 'customer_external_ID', value: idRaw });
    }
    const vals: Record<string, number | null> = {};
    for (const f of ['lifetime', 'opening', 'issued', 'expired', 'adjustment', 'current']) {
      const n = parseNumber(g(f));
      if (n !== null && Number.isNaN(n)) {
        issues.add({ code: 'INVALID_NUMBER', severity: 'warning', message: `${f} is not a number.`, ref: idRaw, field: f, value: String(g(f)) });
        vals[f] = null;
      } else vals[f] = n;
    }
    const firm = str(g('firmName')) ?? '';
    if (!firm) issues.add({ code: 'MISSING_NAME', severity: 'info', message: 'Firm name is blank.', ref: idRaw });
    const { opening, issued, expired, adjustment, current } = vals;
    if ([opening, issued, expired, adjustment, current].every((v) => v !== null)) {
      const expected = (opening as number) + (issued as number) - (expired as number) + (adjustment as number);
      if (Math.abs(expected - (current as number)) > 0.5) {
        flags.push('balance_mismatch');
        issues.add({ code: 'BALANCE_MISMATCH', severity: 'warning', message: `Current points ${current} do not equal opening + issued - expired + adjustment (${expected}).`, ref: idRaw });
      }
    }
    const rec: LoyaltyRec = {
      key: `${snap}|${verified ? key : `unverified:${mobileRaw ?? idRaw}:${firm}`}`,
      datasetId: '',
      rowNo,
      snapshotDate: snap,
      customerId: idRaw,
      idKind: verified ? 'verified' : 'unverified',
      entityKey: verified ? (key as string) : `unverified:${mobileRaw ?? ''}:${firm}`,
      mobileMasked: maskMobile(mobileRaw),
      firmName: firm,
      lifetime: vals.lifetime,
      opening: vals.opening,
      issued: vals.issued,
      expired: vals.expired,
      adjustment: vals.adjustment,
      current: vals.current,
      flags,
    };
    const prev = seen.get(rec.key);
    if (prev) {
      if (prev.current === rec.current && prev.lifetime === rec.lifetime) {
        duplicates++;
        issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Identical loyalty row repeated; extra copy excluded.', ref: idRaw, excluded: true });
        return;
      }
      rec.key = `${rec.key}#${rowNo}`;
      issues.add({ code: 'DUPLICATE_KEY', severity: 'warning', message: 'Customer appears twice in one snapshot with different balances; both retained.', ref: idRaw });
    } else seen.set(rec.key, rec);
    recs.push(rec);
  });

  const meta = baseMeta('loyalty_snapshot', snap, file, sheet, mapping);
  recs.forEach((r) => (r.datasetId = meta.id));
  meta.snapshotDate = snapshotDate;
  meta.period = snapshotDate;
  meta.periodStart = snapshotDate;
  meta.periodEnd = snapshotDate;
  meta.asOfDate = snapshotDate;
  meta.validCount = recs.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity === 'warning').map((i) => i.ref)).size;
  meta.inference = [...inference, 'Balances are point-in-time values. They are never added together across snapshots; trends use per-dealer changes between snapshots.'];
  meta.extra = { unverified: recs.filter((r) => r.idKind === 'unverified').length };
  return { meta, raw: sheet.rows, records: recs, issues: issues.items };
}

/* ================================ Focus & Liquidation ================================ */

export function normalizeFocus(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<FocusRec> {
  const def = SOURCES.focus_liquidation;
  const issues = new IssueLog();
  const recs: FocusRec[] = [];
  const raw: Row[] = [];
  const sheetProfiles: Array<Record<string, unknown>> = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Set<string>();
  const first = file.sheets[0];
  const mapping = getMapping(first, 'focus_liquidation', ctx);
  missingColumnIssues(mapping, 'focus_liquidation', issues);
  let rawCount = 0;
  for (const sh of file.sheets) {
    const m = { ...autoMap(sh.columns, def.fields), ...(ctx.mapping ?? {}) };
    if (!m.materialCode) {
      issues.add({ code: 'SHEET_SKIPPED', severity: 'warning', message: `Sheet "${sh.name}" has no Material Code column and was not read.` });
      continue;
    }
    let focusSet = 0;
    let liqActive = 0;
    let stockPositive = 0;
    sh.rows.forEach((row, i) => {
      rawCount++;
      raw.push({ ...row, __sheet: sh.name });
      const g = reader(row, m);
      const code = str(g('materialCode'));
      if (!code) {
        invalid++;
        issues.add({ code: 'MISSING_ID', severity: 'warning', message: 'Row has no Material Code and was excluded.', ref: `${sh.name} row ${sh.rowNumbers[i]}`, excluded: true });
        return;
      }
      const plant = str(g('plantCode')) ?? sh.name;
      const key = `${plant}|${code}`;
      if (seen.has(key)) {
        duplicates++;
        issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Same plant and material appear twice; extra copy excluded.', ref: key, excluded: true });
        return;
      }
      seen.add(key);
      const stock = num(g('skuStock'));
      const fs = parseDate(g('focusStart'), 'dmy');
      const fe = parseDate(g('focusEnd'), 'dmy');
      const liq = str(g('liquidationStatus'));
      if (fs) focusSet++;
      if (liq && !/^inactive$/i.test(liq)) liqActive++;
      if ((stock ?? 0) > 0) stockPositive++;
      recs.push({
        key,
        datasetId: '',
        plantCode: plant,
        plantName: str(g('plantName')),
        materialCode: code,
        description: str(g('description')),
        brand: str(g('brand')),
        segment: str(g('segment')),
        status: str(g('status')),
        liquidationStatus: liq,
        focusStart: fs?.date ?? null,
        focusEnd: fe?.date ?? null,
        skuStock: stock,
      });
    });
    sheetProfiles.push({ sheet: sh.name, rows: sh.rows.length, columns: sh.columns.length, focusConfigured: focusSet, liquidationActive: liqActive, stockPositive });
  }
  const meta = baseMeta('focus_liquidation', ctx.scopeOverride ?? 'all', file, first, mapping);
  recs.forEach((r) => (r.datasetId = meta.id));
  meta.rawCount = rawCount;
  meta.validCount = recs.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.flaggedCount = 0;
  meta.sheet = file.sheets.map((s) => s.name).join(', ');
  meta.inference = [
    'Registered and preserved as raw records. Stock and liquidation data are not mixed into order KPIs.',
    `${file.sheets.length} plant sheets read (${file.sheets.map((s) => s.name).join(', ')}).`,
  ];
  meta.extra = { sheets: sheetProfiles };
  return { meta, raw, records: recs, issues: issues.items };
}
