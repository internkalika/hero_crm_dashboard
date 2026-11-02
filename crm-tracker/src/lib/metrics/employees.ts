// Employee-activity analytics (DataSense SFA / Dealer SFA) and the Bizom-vs-Dealer-SFA usage comparison.
//
// The employee daily-activity report is the usage record of the Dealer SFA (confirmed by the business), and the Bizom MIS
// usage report is the usage record of Bizom SFA. The two are compared by month and by group (zone, designation, role);
// there is no shared employee ID, so people are never paired across the two reports.
import type { AppData, EmployeeActivityRec, Insight, Settings, UsageRec } from '../types';
import { Period, monthInPeriod } from './period';
import { monthLabel } from '../util/parse';

export function filterEmployees(recs: EmployeeActivityRec[], period: Period, includeTest: boolean): { kept: EmployeeActivityRec[]; excluded: EmployeeActivityRec[] } {
  const inP = recs.filter((r) => monthInPeriod(r.month, period));
  return includeTest ? { kept: inP, excluded: [] } : { kept: inP.filter((r) => !r.isTest), excluded: inP.filter((r) => r.isTest) };
}

export interface EmployeeKpis {
  employees: number;
  visits: number;
  orders: number;
  complaints: number;
  tour: number;
  ordersPerVisit: number | null;
  visitsPerEmployee: number | null;
  ordersPerEmployee: number | null;
  avgCoverage: number | null;
  zeroVisitEmployees: number;
  zeroOrderEmployees: number;
  ordersExceedVisits: number;
  expensesCaptured: boolean;
  excludedTest: number;
}

const sumF = (rs: EmployeeActivityRec[], f: (r: EmployeeActivityRec) => number | null) => rs.reduce((a, r) => a + (f(r) ?? 0), 0);

export function employeeKpis(recs: EmployeeActivityRec[], excluded: EmployeeActivityRec[] = []): EmployeeKpis {
  const emp = new Set(recs.map((r) => r.employeeKey));
  const visits = sumF(recs, (r) => r.visited);
  const orders = sumF(recs, (r) => r.orders);
  // coverage is a percentage-like figure per row; average only the populated values
  const cov = recs.map((r) => r.mktCoverage).filter((x): x is number => x !== null);
  const perEmp = new Map<string, { v: number; o: number }>();
  recs.forEach((r) => {
    const e = perEmp.get(r.employeeKey) ?? { v: 0, o: 0 };
    e.v += r.visited ?? 0;
    e.o += r.orders ?? 0;
    perEmp.set(r.employeeKey, e);
  });
  return {
    employees: emp.size,
    visits,
    orders,
    complaints: sumF(recs, (r) => r.complaints),
    tour: sumF(recs, (r) => r.tour),
    ordersPerVisit: visits > 0 ? orders / visits : null,
    visitsPerEmployee: emp.size ? visits / emp.size : null,
    ordersPerEmployee: emp.size ? orders / emp.size : null,
    avgCoverage: cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : null,
    zeroVisitEmployees: [...perEmp.values()].filter((e) => e.v === 0).length,
    zeroOrderEmployees: [...perEmp.values()].filter((e) => e.o === 0).length,
    ordersExceedVisits: recs.filter((r) => r.flags.includes('orders_exceed_visits')).length,
    expensesCaptured: recs.some((r) => (r.expenses ?? 0) !== 0),
    excludedTest: new Set(excluded.map((r) => r.employeeKey)).size,
  };
}

export interface EmployeeRow {
  employeeKey: string;
  employee: string;
  role: string;
  months: number;
  visits: number;
  orders: number;
  complaints: number;
  tour: number;
  coverage: number | null;
  ordersPerVisit: number | null;
  flags: string[];
}

export function employeeRanking(recs: EmployeeActivityRec[]): EmployeeRow[] {
  const by = new Map<string, EmployeeActivityRec[]>();
  for (const r of recs) {
    const a = by.get(r.employeeKey);
    if (a) a.push(r);
    else by.set(r.employeeKey, [r]);
  }
  return [...by.entries()]
    .map(([employeeKey, rs]) => {
      const visits = sumF(rs, (r) => r.visited);
      const orders = sumF(rs, (r) => r.orders);
      const cov = rs.map((r) => r.mktCoverage).filter((x): x is number => x !== null);
      return {
        employeeKey,
        employee: rs[0].employee,
        role: rs[rs.length - 1].role,
        months: new Set(rs.map((r) => r.month)).size,
        visits,
        orders,
        complaints: sumF(rs, (r) => r.complaints),
        tour: sumF(rs, (r) => r.tour),
        coverage: cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : null,
        ordersPerVisit: visits > 0 ? orders / visits : null,
        flags: [...new Set(rs.flatMap((r) => r.flags))],
      };
    })
    .sort((a, b) => b.orders - a.orders || b.visits - a.visits || a.employee.localeCompare(b.employee));
}

export interface RoleRow {
  role: string;
  employees: number;
  visits: number;
  orders: number;
  complaints: number;
  ordersPerVisit: number | null;
}

export function byRole(recs: EmployeeActivityRec[]): RoleRow[] {
  const by = new Map<string, EmployeeActivityRec[]>();
  recs.forEach((r) => {
    const a = by.get(r.role || 'Not specified');
    if (a) a.push(r);
    else by.set(r.role || 'Not specified', [r]);
  });
  return [...by.entries()]
    .map(([role, rs]) => {
      const v = sumF(rs, (r) => r.visited);
      const o = sumF(rs, (r) => r.orders);
      return { role, employees: new Set(rs.map((r) => r.employeeKey)).size, visits: v, orders: o, complaints: sumF(rs, (r) => r.complaints), ordersPerVisit: v > 0 ? o / v : null };
    })
    .sort((a, b) => b.orders - a.orders);
}

export function employeesByMonth(recs: EmployeeActivityRec[]) {
  const by = new Map<string, EmployeeActivityRec[]>();
  recs.forEach((r) => {
    const a = by.get(r.month);
    if (a) a.push(r);
    else by.set(r.month, [r]);
  });
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, rs]) => {
      const visits = sumF(rs, (r) => r.visited);
      const orders = sumF(rs, (r) => r.orders);
      return { month, label: monthLabel(month), employees: new Set(rs.map((r) => r.employeeKey)).size, visits, orders, complaints: sumF(rs, (r) => r.complaints), ordersPerVisit: visits > 0 ? orders / visits : null };
    });
}

export function employeeInsights(recs: EmployeeActivityRec[], excluded: EmployeeActivityRec[]): Insight[] {
  const out: Insight[] = [];
  if (!recs.length) return out;
  const k = employeeKpis(recs, excluded);
  if (k.ordersPerVisit !== null) out.push({ id: 'emp-conv', level: 'info', title: `${k.orders.toLocaleString('en-IN')} orders from ${k.visits.toLocaleString('en-IN')} recorded visits (${k.ordersPerVisit.toFixed(2)} orders per visit)`, detail: 'Orders per visit is a ratio of the two recorded totals; visits to dealers without an order are included in the denominator.', to: '/datasense/employees' });
  if (k.zeroVisitEmployees > 0) out.push({ id: 'emp-zero', level: 'watch', title: `${k.zeroVisitEmployees} employees recorded no visits in the period`, detail: 'They appear in the activity report with zero visits. This can mean leave, a role without field visits, or an unmapped login; the data cannot say which.', to: '/datasense/employees' });
  if (k.ordersExceedVisits > 0) out.push({ id: 'emp-exceed', level: 'watch', title: `${k.ordersExceedVisits} employee-month rows have more orders than visits`, detail: 'Possible when orders are punched without a logged visit; worth checking before using orders-per-visit for those rows.', to: '/datasense/employees' });
  if (!k.expensesCaptured) out.push({ id: 'emp-exp', level: 'info', title: 'Expenses are not captured in this report', detail: 'The EXPENSES column is zero for every employee, so it is treated as not populated rather than as zero spend.', to: '/datasense/employees' });
  return out;
}

/* ------------------------- Bizom vs Dealer SFA usage ------------------------- */

export interface SfaSource {
  kind: 'dealer_sfa' | 'none';
  records: EmployeeActivityRec[];
  note: string;
}

/**
 * Dealer SFA usage is the employee daily-activity report: the DataSense employee-activity files are the usage record of
 * the Dealer SFA (confirmed by the business). A separately imported Dealer SFA activity file, if there is one, takes
 * priority.
 */
export function sfaSource(data: AppData): SfaSource {
  if (data.dealerSfa.length) return { kind: 'dealer_sfa', records: data.dealerSfa, note: 'Dealer SFA employee-activity export.' };
  if (data.dsEmployees.length) return { kind: 'dealer_sfa', records: data.dsEmployees, note: 'Dealer SFA usage is the employee daily-activity report.' };
  return { kind: 'none', records: [], note: 'No employee-activity file is imported.' };
}

export interface SfaComparison {
  source: SfaSource;
  available: boolean;
  months: string[];
  monthly: Array<{ month: string; label: string; bizomUsers: number; bizomAccesses: number; sfaEmployees: number | null; sfaVisits: number | null; sfaOrders: number | null }>;
  bizomFieldUsers: number;
  sfaEmployees: number;
}

/**
 * `sfaFilter` narrows the Dealer SFA side only (for example to one role); the Bizom side is narrowed by passing a
 * filtered `usage`. Both sides are always cut in the same months.
 */
export function bizomVsSfa(data: AppData, usage: UsageRec[], period: Period, settings: Pick<Settings, 'includeTestAccounts'>, sfaFilter?: (r: EmployeeActivityRec) => boolean): SfaComparison {
  const source = sfaSource(data);
  const sfa = source.records.filter((r) => monthInPeriod(r.month, period) && (settings.includeTestAccounts || !r.isTest) && (!sfaFilter || sfaFilter(r)));
  const bizomMonths = new Set(usage.map((u) => u.month));
  const sfaMonths = new Set(sfa.map((r) => r.month));
  const allMonths = [...new Set([...bizomMonths, ...sfaMonths])].sort();
  const monthly = allMonths.map((m) => {
    const u = usage.filter((x) => x.month === m && x.accessCount > 0);
    const s = sfa.filter((x) => x.month === m);
    return {
      month: m,
      label: monthLabel(m),
      bizomUsers: new Set(u.map((x) => x.userId)).size,
      bizomAccesses: u.reduce((a, x) => a + x.accessCount, 0),
      sfaEmployees: sfaMonths.has(m) ? new Set(s.map((x) => x.employeeKey)).size : null,
      sfaVisits: sfaMonths.has(m) ? s.reduce((a, x) => a + (x.visited ?? 0), 0) : null,
      sfaOrders: sfaMonths.has(m) ? s.reduce((a, x) => a + (x.orders ?? 0), 0) : null,
    };
  });
  const months = allMonths.filter((m) => bizomMonths.has(m) && sfaMonths.has(m));

  // per-user bizom totals on the common months
  const bizomUsers = new Map<string, { name: string; designation: string; accesses: number; reports: Set<string> }>();
  usage
    .filter((u) => months.includes(u.month) && u.accountKind === 'Field staff')
    .forEach((u) => {
      const e = bizomUsers.get(u.userId) ?? { name: u.name, designation: u.designation, accesses: 0, reports: new Set<string>() };
      e.accesses += u.accessCount;
      if (u.accessCount > 0) e.reports.add(u.reportName || u.reportId);
      bizomUsers.set(u.userId, e);
    });
  const sfaEmp = new Map<string, { name: string; visits: number; orders: number }>();
  sfa
    .filter((r) => months.includes(r.month))
    .forEach((r) => {
      const e = sfaEmp.get(r.employeeKey) ?? { name: r.employee, visits: 0, orders: 0 };
      e.visits += r.visited ?? 0;
      e.orders += r.orders ?? 0;
      sfaEmp.set(r.employeeKey, e);
    });

  return {
    source,
    available: source.kind !== 'none',
    months,
    monthly,
    bizomFieldUsers: bizomUsers.size,
    sfaEmployees: sfaEmp.size,
  };
}
