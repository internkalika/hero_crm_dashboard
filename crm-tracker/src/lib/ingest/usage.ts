// Normalisers for Bizom MIS usage and employee-activity exports (monthly, no date column).
import type { DatasetPayload, EmployeeActivityRec, ReadFile, UsageRec } from '../types';
import { IssueLog, NormalizeCtx, baseMeta, getMapping, missingColumnIssues, monthScopeFromFilename, pickSheet, reader } from './common';
import { monthEnd, normName, num, parseNumber, str } from '../util/parse';

/* ================================ Bizom usage ================================ */

export function accountKindOf(designation: string): UsageRec['accountKind'] {
  const d = designation.trim().toLowerCase();
  if (!d) return 'Company / admin';
  if (d === 'distributor') return 'Distributor';
  return 'Field staff';
}

export function normalizeBizomUsage(file: ReadFile, ctx: NormalizeCtx): DatasetPayload<UsageRec> {
  const sheet = pickSheet(file, ctx, 'bizom_usage');
  const mapping = getMapping(sheet, 'bizom_usage', ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, 'bizom_usage', issues);
  const sc = monthScopeFromFilename(file.fileName, ctx.now, ctx.scopeOverride);
  if (!sc) issues.add({ code: 'PERIOD_UNKNOWN', severity: 'error', message: 'Reporting period could not be determined from the file name. Set it manually in the Identify step.' });
  const scope = sc?.scope ?? 'unknown';

  const recs: UsageRec[] = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Map<string, UsageRec>();
  sheet.rows.forEach((row, i) => {
    const g = reader(row, mapping);
    const rowNo = sheet.rowNumbers[i];
    const userId = str(g('userId'));
    const reportId = str(g('reportId'));
    if (!userId || !reportId) {
      invalid++;
      issues.add({ code: 'MISSING_ID', severity: 'error', message: 'Row has no User_ID or Report_Id and was excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    const cnt = parseNumber(g('accessCount'));
    if (cnt === null || Number.isNaN(cnt)) {
      invalid++;
      issues.add({ code: 'INVALID_NUMBER', severity: 'error', message: 'Access_Count is blank or not a number; row excluded (blank is not treated as zero).', ref: `row ${rowNo}`, field: 'Access_Count', value: String(g('accessCount') ?? ''), excluded: true });
      return;
    }
    if (cnt < 0) issues.add({ code: 'NEGATIVE_VALUE', severity: 'warning', message: 'Access_Count is negative.', ref: `row ${rowNo}`, field: 'Access_Count', value: String(cnt) });
    const name = str(g('name')) ?? str(g('loginName')) ?? `User ${userId}`;
    const designation = str(g('designation')) ?? '';
    const flags: string[] = [];
    if (/^hero\.|maintain|^test\b/i.test(name) || /hero cycle zone/i.test(str(g('zone')) ?? '')) {
      flags.push('test_or_service_account');
      issues.add({ code: 'TEST_ACCOUNT', severity: 'info', message: `"${name}" looks like a test/service account. Retained and flagged.`, ref: userId });
    }
    const rec: UsageRec = {
      key: `${scope}|${userId}|${reportId}`,
      datasetId: '',
      rowNo,
      period: scope,
      month: scope.slice(0, 7),
      zone: str(g('zone')),
      subzone: str(g('subzone')),
      userId,
      name,
      loginName: str(g('loginName')),
      designation: designation || '(no designation)',
      accountKind: accountKindOf(designation),
      roleId: str(g('roleId')),
      reportId,
      reportName: str(g('reportName')) ?? `Report ${reportId}`,
      type: str(g('type')) ?? 'Report',
      accessCount: cnt,
      flags,
    };
    const prev = seen.get(rec.key);
    if (prev) {
      if (prev.accessCount === rec.accessCount) {
        duplicates++;
        issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Identical user/report row repeated; extra copy excluded so access counts are not double counted.', ref: `${userId}/${reportId}`, excluded: true });
        return;
      }
      rec.key = `${rec.key}#${rowNo}`;
      issues.add({ code: 'DUPLICATE_KEY', severity: 'warning', message: 'Same user and report appear twice with different counts; both retained (counts add up).', ref: `${userId}/${reportId}` });
    } else seen.set(rec.key, rec);
    recs.push(rec);
  });

  // a report id should have one name
  const names = new Map<string, Set<string>>();
  recs.forEach((r) => names.set(r.reportId, (names.get(r.reportId) ?? new Set()).add(r.reportName)));
  names.forEach((s, id) => {
    if (s.size > 1) issues.add({ code: 'REPORT_NAME_CONFLICT', severity: 'warning', message: `Report ${id} has several names: ${[...s].join(' / ')}`, ref: id });
  });

  const meta = baseMeta('bizom_usage', scope, file, sheet, mapping);
  recs.forEach((r) => (r.datasetId = meta.id));
  meta.period = scope;
  meta.periodStart = scope === 'unknown' ? null : `${scope}-01`;
  meta.periodEnd = scope === 'unknown' ? null : monthEnd(scope);
  meta.asOfDate = meta.periodEnd;
  meta.validCount = recs.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity === 'warning').map((i) => i.ref)).size;
  meta.inference = [
    sc?.inference ?? 'Period unknown.',
    '"Name" identifies the Bizom user account (distributors, field staff and company-level admins); "User_Name" is the login name and is blank for company-level users.',
    'Access_Count is the number of recorded report accesses. It is not a download count.',
  ];
  meta.extra = { users: new Set(recs.map((r) => r.userId)).size, reports: new Set(recs.map((r) => r.reportId)).size, totalAccess: recs.reduce((a, r) => a + r.accessCount, 0) };
  return { meta, raw: sheet.rows, records: recs, issues: issues.items };
}

/* ============================== Employee activity ============================== */

export function normalizeEmployeeActivity(
  file: ReadFile,
  ctx: NormalizeCtx,
  source: 'ds_employee_activity' | 'dealer_sfa_activity' = 'ds_employee_activity',
): DatasetPayload<EmployeeActivityRec> {
  const sheet = pickSheet(file, ctx, source);
  const mapping = getMapping(sheet, source, ctx);
  const issues = new IssueLog();
  missingColumnIssues(mapping, source, issues);
  const sc = monthScopeFromFilename(file.fileName, ctx.now, ctx.scopeOverride);
  if (!sc) issues.add({ code: 'PERIOD_UNKNOWN', severity: 'error', message: 'Reporting period could not be determined from the file name. Set it manually in the Identify step.' });
  const scope = sc?.scope ?? 'unknown';
  const recs: EmployeeActivityRec[] = [];
  let invalid = 0;
  let duplicates = 0;
  let totalRow: Record<string, number | null> | null = null;
  let totalRows = 0;
  const seen = new Map<string, EmployeeActivityRec>();
  const fields = ['mktCoverage', 'tour', 'visited', 'orders', 'complaints', 'expenses'] as const;

  sheet.rows.forEach((row, i) => {
    const g = reader(row, mapping);
    const rowNo = sheet.rowNumbers[i];
    const employee = str(g('employee'));
    const role = str(g('role')) ?? '';
    if (/^total$/i.test(role) || (employee && /^total$/i.test(employee))) {
      totalRow = Object.fromEntries(fields.map((f) => [f, num(g(f))]));
      issues.add({ code: 'TOTAL_ROW_EXCLUDED', severity: 'info', message: 'Footer "TOTAL" row excluded from employee records and used for reconciliation.', ref: `row ${rowNo}`, excluded: true });
      totalRows++;
      return;
    }
    if (!employee) {
      invalid++;
      issues.add({ code: 'MISSING_ID', severity: 'error', message: 'Row has no employee name and was excluded.', ref: `row ${rowNo}`, excluded: true });
      return;
    }
    const vals: Record<string, number | null> = {};
    for (const f of fields) {
      const n = parseNumber(g(f));
      if (n !== null && Number.isNaN(n)) {
        issues.add({ code: 'INVALID_NUMBER', severity: 'warning', message: `${f} is not a number; treated as missing.`, ref: employee, field: f, value: String(g(f)) });
        vals[f] = null;
      } else {
        if (typeof n === 'number' && n < 0) issues.add({ code: 'NEGATIVE_VALUE', severity: 'warning', message: `${f} is negative.`, ref: employee, field: f, value: String(n) });
        vals[f] = n;
      }
    }
    const flags: string[] = [];
    const isTest = /\btest\b/i.test(employee);
    if (isTest) {
      flags.push('test_account');
      issues.add({ code: 'TEST_ACCOUNT', severity: 'info', message: `"${employee}" looks like a test account. Retained and flagged.`, ref: employee });
    }
    if ((vals.orders ?? 0) > (vals.visited ?? 0) && (vals.orders ?? 0) > 0) {
      flags.push('orders_exceed_visits');
      issues.add({ code: 'ORDERS_EXCEED_VISITS', severity: 'info', message: 'Orders recorded exceed visits recorded, so orders-per-visit is only indicative for this employee.', ref: employee });
    }
    const rec: EmployeeActivityRec = {
      key: `${scope}|${normName(employee)}`,
      datasetId: '',
      source,
      rowNo,
      period: scope,
      month: scope.slice(0, 7),
      employee,
      employeeKey: normName(employee),
      role,
      mktCoverage: vals.mktCoverage,
      tour: vals.tour,
      visited: vals.visited,
      orders: vals.orders,
      complaints: vals.complaints,
      expenses: vals.expenses,
      isTest,
      flags,
    };
    const prev = seen.get(rec.key);
    if (prev) {
      const same = fields.every((f) => prev[f] === rec[f]);
      if (same) {
        duplicates++;
        issues.add({ code: 'DUPLICATE_ROW', severity: 'warning', message: 'Identical employee row repeated; extra copy excluded.', ref: employee, excluded: true });
        return;
      }
      rec.key = `${rec.key}#${rowNo}`;
      issues.add({ code: 'DUPLICATE_KEY', severity: 'warning', message: 'Employee appears twice with different figures; both retained.', ref: employee });
    } else seen.set(rec.key, rec);
    recs.push(rec);
  });

  // Reconcile with the file's TOTAL row.
  const recon: Array<{ field: string; reported: number; computed: number; diff: number }> = [];
  if (totalRow) {
    for (const f of fields) {
      const reported = (totalRow as Record<string, number | null>)[f];
      if (reported === null || reported === undefined) continue;
      const computed = recs.reduce((a, r) => a + (r[f] ?? 0), 0);
      recon.push({ field: f, reported, computed, diff: computed - reported });
      if (computed !== reported) issues.add({ code: 'TOTAL_MISMATCH', severity: 'warning', message: `${f}: TOTAL row says ${reported} but employee rows add to ${computed}.` });
    }
  }
  const expensesPopulated = recs.some((r) => (r.expenses ?? 0) !== 0);
  if (recs.length && !expensesPopulated) issues.add({ code: 'FIELD_NOT_POPULATED', severity: 'info', message: 'EXPENSES is zero for every employee; treated as not captured rather than as real zero spend.', field: 'EXPENSES' });

  const meta = baseMeta(source, scope, file, sheet, mapping);
  recs.forEach((r) => (r.datasetId = meta.id));
  meta.period = scope;
  meta.periodStart = scope === 'unknown' ? null : `${scope}-01`;
  meta.periodEnd = scope === 'unknown' ? null : monthEnd(scope);
  meta.asOfDate = meta.periodEnd;
  meta.validCount = recs.length;
  meta.duplicateCount = duplicates;
  meta.invalidCount = invalid;
  meta.totalRowCount = totalRows;
  meta.flaggedCount = new Set(issues.items.filter((i) => !i.excluded && i.severity === 'warning').map((i) => i.ref)).size;
  meta.inference = [
    sc?.inference ?? 'Period unknown.',
    'Figures are monthly totals per employee (the file has no daily dates), so no daily trend is shown.',
    source === 'ds_employee_activity' ? 'Identified as DataSense SFA activity from the file name; it is not assumed to be Dealer SFA activity.' : 'Identified as Dealer SFA activity from the file name.',
  ];
  meta.extra = { reconciliation: recon, expensesPopulated };
  return { meta, raw: sheet.rows, records: recs, issues: issues.items };
}
