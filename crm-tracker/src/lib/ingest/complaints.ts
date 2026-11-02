// Normalisers for the Dealer App and DataSense complaint dumps.
import type { ComplaintRec, ComplaintStatusGroup, DatasetPayload, ReadFile } from '../types';
import { IssueLog, NormalizeCtx, baseMeta, getMapping, minMax, missingColumnIssues, pickSheet, reader } from './common';
import {
  daysBetween,
  dealerKeyOf,
  detectDateOrder,
  extractBracketId,
  isNumericCode,
  monthOf,
  parseDate,
  parseTatMinutes,
  str,
  titleCase,
} from '../util/parse';
import { dayMonthFromFilename, inferYear, pad2 } from './common';

/** Transparent status mapping (also shown in the UI). */
export const DEALER_COMPLAINT_STATUS_MAP: Record<string, ComplaintStatusGroup> = {
  CLOSED: 'closed',
  RESOLVED: 'closed',
  ASSIGNED: 'pending',
  OPEN: 'open',
  NEW: 'open',
  PENDING: 'pending',
  'IN PROGRESS': 'in_process',
  INPROGRESS: 'in_process',
  ESCALATED: 'escalated',
  REJECTED: 'rejected',
};

export const DS_COMPLAINT_STATUS_MAP: Record<string, ComplaintStatusGroup> = {
  'TICKET GENERATE': 'open',
  PROCESS: 'in_process',
  'CHANGE DEPARTMENT': 'in_process',
  CLOSED: 'closed',
  REJECTED: 'rejected',
};

const FUNCTIONS = new Set([
  'quality mgmt', 'quality management', 'quality', 'logistics', 'finance', 'warranty & replacement', 'product & r&d',
  'sales', 'it', 'marketing', 'hr', 'operations', 'customer service', 'accounts',
]);
const OWNERSHIP_ALIASES: Record<string, string> = { quality: 'Quality Mgmt', 'quality management': 'Quality Mgmt' };

export function mapStatus(raw: string, map: Record<string, ComplaintStatusGroup>): ComplaintStatusGroup {
  return map[raw.trim().toUpperCase()] ?? 'unmapped';
}

/** Date from a file name like "... - 26 Oct.xlsx" (year inferred) */
export function asOfFromFilename(fileName: string, now: Date): string | null {
  const dm = dayMonthFromFilename(fileName);
  if (!dm) return null;
  return `${inferYear(dm.month, dm.day, now)}-${pad2(dm.month)}-${pad2(dm.day)}`;
}

/* ============================== Dealer App complaints ============================== */

export function normalizeDealerComplaints(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<ComplaintRec> {
  const sheet = pickSheet(file, ctx, 'dealer_complaints');
  const mapping = getMapping(sheet, 'dealer_complaints', ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, 'dealer_complaints', issues);
  const order = mapping.raisedOn ? detectDateOrder(sheet.rows.map((r) => r[mapping.raisedOn])) : 'dmy';
  const recs: ComplaintRec[] = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Map<string, ComplaintRec>();

  sheet.rows.forEach((row, i) => {
    const g = reader(row, mapping);
    const rowNo = sheet.rowNumbers[i];
    const id = str(g('ticket'));
    if (!id) {
      invalid++;
      issues.add({ code: 'MISSING_TICKET_ID', severity: 'error', message: 'Row has no ticket number and was excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    const raised = parseDate(g('raisedOn'), order);
    if (!raised) issues.add({ code: 'INVALID_DATE', severity: 'warning', message: 'Ticket raised date missing or invalid.', ref: id, field: 'Ticket Raised on', value: String(g('raisedOn') ?? '') });
    const rawStatus = str(g('status')) ?? '';
    const statusGroup = mapStatus(rawStatus, DEALER_COMPLAINT_STATUS_MAP);
    if (statusGroup === 'unmapped') issues.add({ code: 'UNMAPPED_STATUS', severity: 'warning', message: `Status "${rawStatus}" is not mapped.`, ref: id, field: 'Status', value: rawStatus });
    const codeRaw = str(g('dealerCode'));
    const key = dealerKeyOf(codeRaw);
    const flags: string[] = [];
    if (!key) {
      flags.push('no_dealer_code');
      issues.add({ code: 'MISSING_DEALER_KEY', severity: 'warning', message: 'Dealer code is blank or 0 - complaint cannot be tied to a dealer.', ref: id, field: 'Dealer code', value: codeRaw ?? '' });
    } else if (!isNumericCode(key)) {
      flags.push('non_numeric_dealer_code');
      issues.add({ code: 'SUSPICIOUS_ID', severity: 'warning', message: 'Dealer code is not an ERP-style numeric code.', ref: id, field: 'Dealer code', value: codeRaw ?? '' });
    }
    const desc = str(g('description'));
    if (desc && /\btest\b/i.test(desc)) {
      flags.push('test_record');
      issues.add({ code: 'TEST_RECORD', severity: 'info', message: 'Description mentions "test" - may be a test ticket. Retained.', ref: id });
    }
    const assigned = str(g('assignedTo'));
    const owner = assigned && assigned !== '0' ? assigned : null;
    const rec: ComplaintRec = {
      key: id,
      datasetId: '',
      system: 'dealer',
      id,
      rowNo,
      raisedAt: raised?.dateTime ?? raised?.date ?? null,
      raisedDate: raised?.date ?? null,
      month: monthOf(raised?.date),
      closedAt: null, // the export has no resolution timestamp
      rawStatus,
      statusGroup,
      department: str(g('department')),
      departmentKind: str(g('department')) ? 'function' : 'none',
      category: str(g('category')),
      subType: str(g('subType')),
      owner,
      assignmentLevel: str(g('assignmentLevel')),
      dealerKey: key && isNumericCode(key) ? key : null,
      dealerCode: codeRaw,
      dealerName: str(g('dealerName')),
      description: desc,
      additionalInfo: null,
      createdBy: null,
      role: null,
      invoiceNumber: null,
      invoiceDate: null,
      tatMinutes: null,
      tatSource: null,
      flags,
    };
    const prev = seen.get(id);
    if (prev) {
      if (prev.rawStatus === rec.rawStatus && prev.raisedAt === rec.raisedAt && prev.description === rec.description) {
        duplicates++;
        issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Identical ticket row repeated; extra copy excluded.', ref: id, excluded: true });
        return;
      }
      rec.key = `${id}#${rowNo}`;
      issues.add({ code: 'DUPLICATE_KEY', severity: 'warning', message: 'Ticket number appears twice with different content; both retained.', ref: id });
    } else seen.set(id, rec);
    recs.push(rec);
  });

  const [lo, hi] = minMax(recs.map((r) => r.raisedDate));
  const meta = baseMeta('dealer_complaints', ctx.scopeOverride ?? 'all', file, sheet, mapping);
  recs.forEach((r) => (r.datasetId = meta.id));
  meta.periodStart = lo;
  meta.periodEnd = hi;
  meta.period = lo && hi ? `${lo} to ${hi}` : null;
  const asOf = asOfFromFilename(file.fileName, ctx.now) ?? hi;
  meta.asOfDate = asOf;
  meta.validCount = recs.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity === 'warning').map((i) => i.ref)).size;
  meta.inference = [
    `Export date ${asOf ?? 'unknown'} ${asOfFromFilename(file.fileName, ctx.now) ? 'taken from the file name' : 'taken from the latest ticket date'}; used for ticket aging.`,
    'The export has no resolution timestamp, so average resolution time is not calculated.',
    '"Ticket Assigned To" is a numeric user ID (no names are provided).',
  ];
  return { meta, raw: sheet.rows, records: recs, issues: issues.items };
}

/* ============================== DataSense complaints ============================== */

function classifyDepartment(raw: string | null): { value: string | null; kind: ComplaintRec['departmentKind'] } {
  if (!raw) return { value: null, kind: 'none' };
  const lower = raw.toLowerCase().trim();
  if (lower === 'closed') return { value: 'Closed (department cleared)', kind: 'closed' };
  if (FUNCTIONS.has(lower)) return { value: OWNERSHIP_ALIASES[lower] ?? titleCase(raw.trim()), kind: 'function' };
  return { value: titleCase(raw.trim()), kind: 'individual' };
}

export function normalizeDsComplaints(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<ComplaintRec> {
  const sheet = pickSheet(file, ctx, 'ds_complaints');
  const mapping = getMapping(sheet, 'ds_complaints', ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, 'ds_complaints', issues);
  const order = mapping.date ? detectDateOrder(sheet.rows.map((r) => r[mapping.date])) : 'dmy';
  const asOfName = asOfFromFilename(file.fileName, ctx.now);
  const recs: ComplaintRec[] = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Map<string, ComplaintRec>();
  let tatFromDates = 0;
  let tatMissing = 0;

  sheet.rows.forEach((row, i) => {
    const g = reader(row, mapping);
    const rowNo = sheet.rowNumbers[i];
    const idRaw = g('caseRef');
    const id = idRaw === null ? null : typeof idRaw === 'number' ? String(Math.round(idRaw)) : str(idRaw);
    if (!id) {
      invalid++;
      issues.add({ code: 'MISSING_CASE_REF', severity: 'error', message: 'Row has no case reference number and was excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    const raised = parseDate(g('date'), order);
    if (!raised) {
      issues.add({ code: 'INVALID_DATE', severity: 'warning', message: 'Complaint date missing or invalid.', ref: id, field: 'Complaint Date', value: String(g('date') ?? '') });
    }
    const rawStatus = str(g('status')) ?? '';
    const statusGroup = mapStatus(rawStatus, DS_COMPLAINT_STATUS_MAP);
    if (statusGroup === 'unmapped') issues.add({ code: 'UNMAPPED_STATUS', severity: 'warning', message: `Status "${rawStatus}" is not mapped.`, ref: id, field: 'Status', value: rawStatus });
    const closedRaw = g('closedDate');
    const closed = parseDate(closedRaw, order);
    if (closedRaw !== null && !closed && str(closedRaw) !== '---') {
      issues.add({ code: 'INVALID_DATE', severity: 'warning', message: 'Complaint closed date is not a valid date.', ref: id, field: 'Complaint Closed Date', value: String(closedRaw) });
    }
    if (closed && raised && closed.date < raised.date) {
      issues.add({ code: 'CLOSED_BEFORE_RAISED', severity: 'warning', message: 'Closed date is earlier than the complaint date.', ref: id });
    }
    const isClosedLike = statusGroup === 'closed' || statusGroup === 'rejected';
    if (isClosedLike && !closed) issues.add({ code: 'CLOSED_WITHOUT_DATE', severity: 'warning', message: 'Status says closed/rejected but there is no closed date.', ref: id });
    if (!isClosedLike && closed) issues.add({ code: 'OPEN_WITH_CLOSED_DATE', severity: 'warning', message: 'Has a closed date but the status is still open.', ref: id });

    const tatRaw = g('tat');
    let tat = parseTatMinutes(tatRaw);
    let tatSource: ComplaintRec['tatSource'] = tat !== null ? 'tat' : null;
    if (tatRaw !== null && tat === null) issues.add({ code: 'INVALID_TAT', severity: 'warning', message: 'TAT text could not be parsed.', ref: id, field: 'TAT', value: String(tatRaw) });
    if (tat === null && closed && raised && closed.date >= raised.date) {
      tat = daysBetween(raised.date, closed.date) * 1440;
      tatSource = 'dates';
      tatFromDates++;
    }
    if (tat === null) tatMissing++;

    const dealer = extractBracketId(g('dealer'));
    const key = dealerKeyOf(dealer.id);
    const flags: string[] = [];
    if (!key) {
      flags.push('no_dealer_code');
      issues.add({ code: 'MISSING_DEALER_KEY', severity: 'warning', message: 'Dealer name has no [code].', ref: id, field: 'Dealer Name' });
    }
    const dept = classifyDepartment(str(g('department')));
    const ownershipRaw = str(g('ownership'));
    const ownership = ownershipRaw ? OWNERSHIP_ALIASES[ownershipRaw.toLowerCase()] ?? ownershipRaw : null;
    const invNo = g('invoiceNumber');
    const inv = parseDate(g('invoiceDate'), order);
    const rec: ComplaintRec = {
      key: id,
      datasetId: '',
      system: 'ds',
      id,
      rowNo,
      raisedAt: raised?.dateTime ?? raised?.date ?? null,
      raisedDate: raised?.date ?? null,
      month: monthOf(raised?.date),
      closedAt: closed?.date ?? null,
      rawStatus,
      statusGroup,
      department: dept.value,
      departmentKind: dept.kind,
      category: str(g('complaint')),
      subType: null,
      owner: ownership,
      assignmentLevel: null,
      dealerKey: key,
      dealerCode: dealer.id,
      dealerName: dealer.name || null,
      description: str(g('description')),
      additionalInfo: str(g('additional')),
      createdBy: str(g('createdBy')),
      role: str(g('role')),
      invoiceNumber: invNo === null ? null : String(invNo),
      invoiceDate: inv?.date ?? null,
      tatMinutes: tat,
      tatSource,
      flags,
    };
    const prev = seen.get(id);
    if (prev) {
      const same = prev.rawStatus === rec.rawStatus && prev.raisedAt === rec.raisedAt && prev.description === rec.description && prev.dealerName === rec.dealerName;
      if (same) {
        duplicates++;
        issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Identical complaint row repeated; extra copy excluded.', ref: id, excluded: true });
        return;
      }
      rec.key = `${id}#${rowNo}`;
      issues.add({ code: 'DUPLICATE_KEY', severity: 'warning', message: 'Case reference number is used by two different complaints; both retained (distinct dealers/descriptions).', ref: id });
    } else seen.set(id, rec);
    recs.push(rec);
  });

  // Department field hygiene summary
  const deptKinds = recs.reduce<Record<string, number>>((a, r) => ((a[r.departmentKind] = (a[r.departmentKind] ?? 0) + 1), a), {});
  if ((deptKinds.individual ?? 0) + (deptKinds.closed ?? 0) > 0) {
    issues.add({
      code: 'DEPARTMENT_FIELD_MIXED',
      severity: 'info',
      message: `The Department column mixes functions (${deptKinds.function ?? 0}), individual names (${deptKinds.individual ?? 0}) and "Closed" (${deptKinds.closed ?? 0}). The Ownership column holds the owning function and is used as the primary grouping.`,
    });
  }
  if (!sheet.declaredDimension || /A1:[A-Z]+(\d+)/.test(sheet.declaredDimension)) {
    const m = /A1:[A-Z]+(\d+)/.exec(sheet.declaredDimension ?? '');
    if (m && +m[1] > sheet.populatedRows * 20) {
      issues.add({ code: 'OVERSIZED_DIMENSION', severity: 'info', message: `Worksheet claims ${(+m[1]).toLocaleString('en-IN')} rows but only ${sheet.populatedRows.toLocaleString('en-IN')} are populated. Only populated rows were read.` });
    }
  }

  const [lo, hi] = minMax(recs.map((r) => r.raisedDate));
  const meta = baseMeta('ds_complaints', ctx.scopeOverride ?? 'all', file, sheet, mapping);
  recs.forEach((r) => (r.datasetId = meta.id));
  meta.periodStart = lo;
  meta.periodEnd = hi;
  meta.period = lo && hi ? `${lo} to ${hi}` : null;
  meta.asOfDate = asOfName ?? hi;
  meta.validCount = recs.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity === 'warning').map((i) => i.ref)).size;
  meta.inference = [
    `Export date ${meta.asOfDate} ${asOfName ? 'taken from the file name' : 'taken from the latest complaint date'}; used for aging of open complaints.`,
    'TAT text ("1 Hr 25 Mins") is parsed to minutes. For closed complaints it is the turnaround; for open ones it is the elapsed time at export.',
    tatFromDates ? `${tatFromDates} closed complaints had no TAT text; turnaround was derived from complaint and closed dates (day precision).` : 'All closed complaints with a TAT text use that value.',
  ];
  meta.extra = { declaredDimension: sheet.declaredDimension, populatedRows: sheet.populatedRows, tatMissing, deptKinds };
  return { meta, raw: sheet.rows, records: recs, issues: issues.items };
}
