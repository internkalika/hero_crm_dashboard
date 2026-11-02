// Normaliser for the DataSense App Usage Report (a workbook with an Orders sheet, a Summary sheet and an
// ASM-Employee-wise sheet; a CSV carries the Orders sheet only). Counts are orders recorded per platform,
// not report accesses.
import type { DatasetPayload, DsUsageAsmRow, DsUsageRec, DsUsageReported, ReadFile, Row, SheetData } from '../types';
import { IssueLog, NormalizeCtx, baseMeta, getMapping, minMax, missingColumnIssues, pickSheet, reader } from './common';
import { detectDateOrder, normHeader, parseDate, parseNumber, str } from '../util/parse';

export const USAGE_PLATFORMS = ['Mobile', 'Web', 'Old App'] as const;
/** statuses that mean the order was turned down (the page counts these as "rejected") */
export const USAGE_REJECTED = ['Rejected by ASM', 'Rejected by SAP', 'SAP Order Not Created'] as const;
export const USAGE_SUMMARY_LABELS = [
  'Total orders',
  'SFA app orders',
  'Manual SAP orders',
  'SFA adoption %',
  'Net valid orders',
  'Valid SFA orders',
  'Adoption on valid orders %',
  'Archived orders',
  'Rejected orders (ASM / SAP / Not created)',
  'Rejection rate % (SFA)',
] as const;

export function normalizePlatform(v: string | null): { value: string; known: boolean } {
  const t = (v ?? '').trim();
  if (/^mobile/i.test(t)) return { value: 'Mobile', known: true };
  if (/^web/i.test(t)) return { value: 'Web', known: true };
  if (/^(old\s*app|sap|manual)/i.test(t)) return { value: 'Old App', known: true };
  return { value: t, known: false };
}

const isTotalRow = (row: Row) => {
  const first = Object.values(row).find((v) => v !== null && String(v).trim() !== '');
  return typeof first === 'string' && /^(grand\s+)?total\b/i.test(first.trim());
};

/* ------------------------------ sibling sheets ------------------------------ */

const findSheet = (file: ReadFile, re: RegExp): SheetData | undefined => file.sheets.find((s) => re.test(s.name));

const num = (v: unknown): number | null => {
  const n = parseNumber(v);
  return n === null || Number.isNaN(n) ? null : n;
};

/** Summary sheet: first column is the metric, the next populated column its value. Title lines give Period/Zone/Generated on. */
export function readSummarySheet(sheet: SheetData | undefined): { summary: Record<string, number> | null; reported: Record<string, string> | null } {
  if (!sheet) return { summary: null, reported: null };
  const summary: Record<string, number> = {};
  const reported: Record<string, string> = {};
  const take = (label: string, value: unknown) => {
    const l = label.trim();
    const canon = USAGE_SUMMARY_LABELS.find((x) => normHeader(x) === normHeader(l));
    if (canon) {
      const n = num(value);
      if (n !== null) summary[canon] = n;
    } else if (/^(period|zone|generated on)$/i.test(l.replace(/:$/, ''))) {
      const s = str(value);
      if (s) reported[l.replace(/:$/, '').replace(/^generated on$/i, 'Generated on').replace(/^period$/i, 'Period').replace(/^zone$/i, 'Zone')] = s;
    }
  };
  // the header detector may have taken the first metric row as the header
  const cols = sheet.columns;
  if (cols.length >= 2) take(cols[0], cols[1]);
  for (const row of sheet.rows) {
    const vals = cols.map((c) => row[c]);
    if (vals[0] !== null && vals[0] !== undefined) take(String(vals[0]), vals.slice(1).find((v) => v !== null && v !== undefined && String(v).trim() !== ''));
  }
  for (const line of sheet.preamble) {
    const m = /^(period|zone|generated on)\s*:?\s*(.+)$/i.exec(line.trim());
    if (m) take(m[1], m[2]);
  }
  return { summary: Object.keys(summary).length ? summary : null, reported: Object.keys(reported).length ? reported : null };
}

const ASM_FIELDS: Record<keyof DsUsageAsmRow, string[]> = {
  zone: ['Zone'],
  name: ['ASM / Employee', 'ASM Employee', 'Name', 'Employee Name', 'ASM-Employee', 'Team / Employee'],
  level: ['Level', 'Role', 'Designation'],
  sfa: ['SFA Orders', 'SFA', 'SFA App Orders', 'SFA App'],
  sap: ['SAP Orders', 'SAP', 'Old App Orders', 'Manual SAP Orders', 'Old App'],
  archived: ['Archived', 'Archived Orders'],
  rejected: ['Rejected', 'Rejected Orders'],
  value: ['Valid Order Value', 'Value', 'Order Value', 'Total Value', 'Valid Value'],
  adoption: ['SFA Adoption', 'SFA Adoption %', 'Adoption', 'Adoption %'],
};

export function readAsmSheet(sheet: SheetData | undefined): DsUsageAsmRow[] | null {
  if (!sheet) return null;
  const byNorm = new Map(sheet.columns.map((c) => [normHeader(c), c]));
  const col = (k: keyof DsUsageAsmRow) => ASM_FIELDS[k].map((a) => byNorm.get(normHeader(a))).find(Boolean) as string | undefined;
  const c = { zone: col('zone'), name: col('name'), level: col('level'), sfa: col('sfa'), sap: col('sap'), archived: col('archived'), rejected: col('rejected'), value: col('value'), adoption: col('adoption') };
  if (!c.name || !c.sfa) return null;
  const rows = sheet.rows
    .filter((r) => str(r[c.name!]) !== null)
    .map<DsUsageAsmRow>((r) => ({
      zone: str(c.zone ? r[c.zone] : null) ?? '',
      // leading spaces mark the indented "own orders" / employee rows of the report; they are kept as printed
      name: String(r[c.name!] ?? ''),
      level: str(c.level ? r[c.level] : null) ?? '',
      sfa: num(r[c.sfa!]),
      sap: c.sap ? num(r[c.sap]) : null,
      archived: c.archived ? num(r[c.archived]) : null,
      rejected: c.rejected ? num(r[c.rejected]) : null,
      value: c.value ? num(r[c.value]) : null,
      adoption: c.adoption ? num(r[c.adoption]) : null,
    }));
  return rows.length ? rows : null;
}

/* ================================== orders ================================== */

export function normalizeDsUsage(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<DsUsageRec> {
  const sheet = pickSheet(file, ctx, 'ds_usage');
  const mapping = getMapping(sheet, 'ds_usage', ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, 'ds_usage', issues);
  const g0 = (canon: string) => sheet.rows.map((r) => (mapping[canon] ? r[mapping[canon]] : null));
  const dateOrder = mapping.date ? detectDateOrder(g0('date')) : 'dmy';
  const limit = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + 1).toISOString().slice(0, 10);

  const recs: DsUsageRec[] = [];
  const seenOrderNo = new Map<string, DsUsageRec>();
  const dealersByOrderNo = new Map<string, Map<string, number>>();
  const occ = new Map<string, number>();
  let invalid = 0;
  let duplicates = 0;
  let totalRows = 0;
  sheet.rows.forEach((row, i) => {
    const rowNo = sheet.rowNumbers[i];
    const g = reader(row, mapping);
    const pd = parseDate(g('date'), dateOrder);
    if (!pd) {
      if (isTotalRow(row)) {
        totalRows++;
        issues.add({ code: 'TOTAL_ROW_EXCLUDED', severity: 'info', message: 'Report footer "Total" row excluded from the orders.', ref: `row ${rowNo}`, excluded: true });
        return;
      }
      invalid++;
      issues.add({ code: 'INVALID_DATE', severity: 'error', message: 'Order date is missing or not a date; row excluded.', ref: `row ${rowNo}`, field: 'Date', value: String(g('date') ?? ''), excluded: true });
      return;
    }
    if (pd.date > limit) issues.add({ code: 'FUTURE_DATE', severity: 'warning', message: `Order date ${pd.date} is in the future.`, ref: `row ${rowNo}`, field: 'Date', value: pd.date });
    const dealer = str(g('dealer')) ?? '';
    if (!dealer) issues.add({ code: 'MISSING_DEALER', severity: 'warning', message: 'Row has no dealer; retained.', ref: `row ${rowNo}`, field: 'Dealer' });
    const pf = normalizePlatform(str(g('platform')));
    if (!pf.known) issues.add({ code: 'UNKNOWN_PLATFORM', severity: 'warning', message: `Platform "${pf.value || '(blank)'}" is not Mobile, Web or Old App; retained, but it is not part of the platform split.`, ref: `row ${rowNo}`, field: 'Platform', value: pf.value });
    const derived = pf.value === 'Old App' ? 'SAP' : pf.known ? 'SFA' : '';
    const srcCell = (str(g('source')) ?? '').toUpperCase();
    const source = srcCell === 'SFA' || srcCell === 'SAP' ? srcCell : derived;
    if (srcCell && derived && source !== derived) issues.add({ code: 'PLATFORM_SOURCE_MISMATCH', severity: 'warning', message: `Source ${source} does not match platform ${pf.value}.`, ref: `row ${rowNo}` });
    const status = str(g('status')) ?? '';
    if (!status) issues.add({ code: 'MISSING_STATUS', severity: 'warning', message: 'Row has no status; retained as "(no status)".', ref: `row ${rowNo}`, field: 'Status' });
    const items = num(g('items'));
    const total = num(g('total'));
    if ((items ?? 0) < 0) issues.add({ code: 'NEGATIVE_VALUE', severity: 'warning', message: 'Items is negative.', ref: `row ${rowNo}`, field: 'Items', value: String(items) });
    if ((total ?? 0) < 0) issues.add({ code: 'NEGATIVE_VALUE', severity: 'warning', message: 'Total is negative.', ref: `row ${rowNo}`, field: 'Total', value: String(total) });
    const employee = str(g('employee')) ?? '';
    const orderNo = str(g('orderNo'));
    const rec: DsUsageRec = {
      key: '',
      datasetId: '',
      rowNo,
      date: pd.date,
      month: pd.date.slice(0, 7),
      zone: str(g('zone')) ?? '',
      asm: str(g('asm')) ?? '',
      employee,
      punchedBy: str(g('punchedBy')) ?? 'Other / Unknown',
      dealer,
      platform: pf.value,
      source,
      status: status || '(no status)',
      rejectReason: str(g('rejectReason')) ?? '',
      items,
      total,
      orderNo,
    };
    if (orderNo) {
      const by = dealersByOrderNo.get(orderNo) ?? new Map<string, number>();
      by.set(dealer, (by.get(dealer) ?? 0) + 1);
      dealersByOrderNo.set(orderNo, by);
      // the same order number may legitimately sit on two rows with different dealers: every row is its own order
      rec.key = `${orderNo}|${dealer}`;
      const prev = seenOrderNo.get(rec.key);
      if (prev) {
        const same = prev.date === rec.date && prev.status === rec.status && prev.total === rec.total && prev.items === rec.items && prev.platform === rec.platform;
        if (same) {
          duplicates++;
          issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Identical order number and dealer repeated; extra copy excluded so orders are not double counted.', ref: orderNo, excluded: true });
          return;
        }
        rec.key = `${rec.key}#${rowNo}`;
        issues.add({ code: 'DUPLICATE_KEY', severity: 'warning', message: 'Order number and dealer appear twice with different content; both retained.', ref: orderNo });
      } else seenOrderNo.set(rec.key, rec);
    } else {
      // no order number in the file: identify an order by what does not change when its status moves on
      const base = `${rec.date}|${employee}|${dealer}|${items ?? ''}|${total ?? ''}`;
      const n = (occ.get(base) ?? 0) + 1;
      occ.set(base, n);
      rec.key = `${base}#${n}`;
    }
    recs.push(rec);
  });

  const { summary, reported } = readSummarySheet(findSheet(file, /summary/i));
  const employees = readAsmSheet(findSheet(file, /asm.*employee|employee.*wise/i));
  const kinds = {
    total: recs.length,
    sfa: recs.filter((r) => r.source === 'SFA').length,
    sap: recs.filter((r) => r.source === 'SAP').length,
    archived: recs.filter((r) => r.status === 'Archived').length,
    rejected: recs.filter((r) => (USAGE_REJECTED as readonly string[]).includes(r.status)).length,
  };
  const reconciliation: Array<{ field: string; reported: number; computed: number; diff: number }> = [];
  if (summary) {
    const pairs: Array<[string, number]> = [
      ['Total orders', kinds.total],
      ['SFA app orders', kinds.sfa],
      ['Manual SAP orders', kinds.sap],
      ['Archived orders', kinds.archived],
      ['Rejected orders (ASM / SAP / Not created)', kinds.rejected],
    ];
    for (const [field, computed] of pairs) {
      const rep = summary[field];
      if (rep === undefined) continue;
      const diff = computed - rep;
      reconciliation.push({ field, reported: rep, computed, diff });
      issues.add({
        code: diff === 0 ? 'TOTAL_RECONCILED' : 'TOTAL_MISMATCH',
        severity: diff === 0 ? 'info' : 'warning',
        message: `${field}: Summary sheet ${rep.toLocaleString('en-IN')} vs orders ${computed.toLocaleString('en-IN')}${diff === 0 ? '' : ` (difference ${diff.toLocaleString('en-IN')})`}.`,
      });
    }
  } else {
    issues.add({ code: 'NO_SUMMARY_SHEET', severity: 'info', message: 'No Summary sheet in this file: the orders are not reconciled against the report\'s own totals.' });
  }
  if (!employees) issues.add({ code: 'NO_ASM_SHEET', severity: 'info', message: 'No ASM-Employee-wise sheet in this file: the "as reported" team table is not shown.' });

  const [lo, hi] = minMax(recs.map((r) => r.date));
  const meta = baseMeta('ds_usage', ctx.scopeOverride ?? 'all', file, sheet, mapping);
  recs.forEach((r) => (r.datasetId = meta.id));
  meta.periodStart = lo;
  meta.periodEnd = hi;
  meta.period = lo && hi ? `${lo} to ${hi}` : null;
  meta.asOfDate = hi;
  meta.rawCount = sheet.rows.length;
  meta.validCount = recs.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.totalRowCount = totalRows;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity === 'warning').map((i) => i.ref)).size;
  meta.inference = [
    `Orders read from the "${sheet.name}" sheet; ${summary ? 'the Summary sheet' : 'no Summary sheet'} and ${employees ? 'the ASM-Employee-wise sheet' : 'no ASM-Employee-wise sheet'} were ${summary || employees ? 'found in the same workbook' : 'found'}.`,
    'Each row is one order recorded on a platform (Mobile, Web or Old App / SAP). Counts are orders, not report accesses, downloads or successful transactions.',
    mapping.orderNo
      ? 'Orders are identified by order number and dealer.'
      : 'The file has no order number: an order is identified by date, employee, dealer, items and total, so a changed status updates the same order when files are merged.',
  ];
  const multi = [...dealersByOrderNo.values()].filter((by) => by.size > 1);
  const notes: string[] = [];
  if (multi.length) {
    const twice = multi.every((by) => [...by.values()].reduce((a, b) => a + b, 0) === 2);
    notes.push(`${multi.length} order number${multi.length === 1 ? ' appears' : 's appear'} on ${twice ? 'two rows each' : 'several rows'} with different dealers; every row is kept as its own order.`);
  }
  const usageReport: DsUsageReported = { reported, summary, employees, notes };
  meta.extra = { reconciliation, usageReport, fileKind: file.kind, sheets: file.sheets.map((s) => s.name) };
  return { meta, raw: sheet.rows, records: recs, issues: issues.items };
}
