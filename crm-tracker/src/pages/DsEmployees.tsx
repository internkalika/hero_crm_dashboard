import { useMemo, useState } from 'react';
import { BarChart3, MapPinned, PackageCheck, Percent, UserCheck, UserX, Users, MessageSquareWarning, FlaskConical } from 'lucide-react';
import { useData } from '../state/DataContext';
import { DataGate, PeriodGate } from '../components/States';
import { KpiCard, KpiGrid } from '../components/KpiCard';
import { MoreMeasures } from '../components/MoreMeasures';
import { Tabs } from '../components/Tabs';
import { BarsChart, ChartCard, StackedBarsChart, TrendChart, SERIES_COLOR } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { describeFilters, useCrossFilter, useUrlValue } from '../components/filters';
import { FilterBar, FilterField, buildOptions } from '../components/FilterBar';
import { Drawer, Facts } from '../components/Drawer';
import { Badge, PageHeader } from '../components/ui';
import type { Col } from '../lib/export/excel';
import { fDec, fInt } from '../lib/export/format';
import { EmployeeRow, byRole, employeeInsights, employeeKpis, employeeRanking, employeesByMonth, filterEmployees } from '../lib/metrics/employees';
import { periodNote, monthKeyLabel } from './common';
import { SignalCard, SignalGrid } from '../components/SignalCard';
import { titleCase } from '../lib/util/parse';

const DIM_LABELS: Record<string, string> = { role: 'Role', month: 'Month', employee: 'Employee', kpi: 'Measure' };
const levelTone = { good: 'good', info: 'info', watch: 'warn', concern: 'bad' } as const;
type TabId = 'overview' | 'employees';

export default function DsEmployees() {
  const { data, period, settings } = useData();
  const cf = useCrossFilter();
  const [tabRaw, setTab] = useUrlValue('tab', 'overview');
  const tab = (tabRaw === 'employees' ? 'employees' : 'overview') as TabId;
  const [sel, setSel] = useState<EmployeeRow | null>(null);
  const months = useMemo(() => [...new Set(data.dsEmployees.map((e) => e.month))].sort(), [data.dsEmployees]);
  const sp = useMemo(() => filterEmployees(data.dsEmployees, period, settings.includeTestAccounts), [data.dsEmployees, period, settings.includeTestAccounts]);

  const filtered = useMemo(() => {
    const f = cf.filters;
    return sp.kept.filter((e) => {
      if (!cf.ok('role', (e.role || 'Not specified'))) return false;
      if (!cf.ok('month', e.month)) return false;
      if (!cf.ok('employee', e.employeeKey)) return false;
      return true;
    });
  }, [sp.kept, cf]);

  // The filter bar offers what the employee-activity export contains in the selected period.
  const filterFields: FilterField[] = useMemo(() => {
    const everyone = employeeRanking(sp.kept);
    return [
      { dim: 'month', label: 'Month', allLabel: 'All months', options: buildOptions(sp.kept, (e) => e.month, { sort: 'value', label: (k) => monthKeyLabel(k) }) },
      { dim: 'role', label: 'Role', allLabel: 'All roles', options: buildOptions(sp.kept, (e) => e.role || 'Not specified') },
      { dim: 'employee', label: 'Employee', allLabel: 'All employees', search: true, options: buildOptions(sp.kept, (e) => e.employeeKey, { sort: 'label', noCounts: true, label: (_k, s) => titleCase(s.employee.toLowerCase()) }) },
      {
        dim: 'kpi',
        label: 'Show',
        allLabel: 'All employees',
        options: [
          { value: 'zero', label: 'Employees with no visits', count: everyone.filter((r) => r.visits === 0).length },
          { value: 'noorders', label: 'Employees with no orders', count: everyone.filter((r) => r.orders === 0).length },
        ],
      },
    ];
  }, [sp.kept]);

  const rows = useMemo(() => employeeRanking(filtered).filter((r) => !cf.filters.kpi || (cf.has('kpi', 'zero') ? r.visits === 0 : cf.has('kpi', 'noorders') ? r.orders === 0 : true)), [filtered, cf.filters.kpi]);
  const k = useMemo(() => employeeKpis(filtered, sp.excluded), [filtered, sp.excluded]);
  const roles = useMemo(() => byRole(filtered), [filtered]);
  const monthly = useMemo(() => employeesByMonth(filtered), [filtered]);
  const insights = useMemo(() => employeeInsights(sp.kept, sp.excluded), [sp.kept, sp.excluded]);

  const cols: Col<EmployeeRow>[] = [
    { id: 'emp', header: 'Employee', value: (r) => titleCase(r.employee.toLowerCase()), width: 200 },
    { id: 'role', header: 'Role', value: (r) => r.role },
    { id: 'months', header: 'Months', value: (r) => r.months, format: 'int' },
    { id: 'visits', header: 'Visits', value: (r) => r.visits, format: 'int' },
    { id: 'orders', header: 'Orders', value: (r) => r.orders, format: 'int' },
    { id: 'opv', header: 'Orders per visit', value: (r) => r.ordersPerVisit, format: 'dec' },
    { id: 'cov', header: 'Market coverage', value: (r) => r.coverage, format: 'dec', help: 'Mean of the MKT COVERAGE column over the months in view' },
    { id: 'tour', header: 'Tour days', value: (r) => r.tour, format: 'int', help: 'TOUR column as supplied' },
    { id: 'compl', header: 'Complaints', value: (r) => r.complaints, format: 'int' },
    { id: 'flags', header: 'Flags', value: (r) => r.flags.join(', '), hidden: true },
  ];
  const exportNotes = describeFilters(cf, DIM_LABELS, [periodNote(period), 'DataSense SFA employee activity (monthly totals per employee)', settings.includeTestAccounts ? 'Test accounts included' : 'Test accounts excluded']);

  return (
    <DataGate need={['ds_employee_activity']} what="DataSense employee activity">
      <PageHeader title="DataSense SFA: Employee Activity" />
      <PeriodGate months={months} system="DataSense employee activity">
        <FilterBar cf={cf} fields={filterFields} />
        <KpiGrid cols={5}>
          <KpiCard label="Employees" icon={Users} value={fInt(k.employees)} sub={`${fInt(k.zeroVisitEmployees)} with no visits`} info={{ formula: 'Distinct employees with a row in view', exclusions: 'TOTAL row; test accounts.' }} onClick={() => cf.clearDim('kpi')} active={!cf.filters.kpi} hint="Clears the measure filter." />
          <KpiCard label="Visits" icon={MapPinned} value={fInt(k.visits)} sub={`${fDec(k.visitsPerEmployee, 1)} per employee`} info={{ formula: 'Σ VISITED' }} onClick={() => setTab('employees')} hint="Opens the employee list." />
          <KpiCard label="Orders" icon={PackageCheck} value={fInt(k.orders)} sub={`${fDec(k.ordersPerEmployee, 1)} per employee`} info={{ formula: 'Σ ORDERS (count of orders punched)' }} onClick={() => setTab('employees')} hint="Opens the employee list." />
          <KpiCard label="Orders per visit" icon={Percent} value={fDec(k.ordersPerVisit)} info={{ formula: 'Σ orders ÷ Σ visits', exclusions: 'Rows where orders exceed visits are flagged but still included.' }} />
          <KpiCard label="Complaints raised" icon={MessageSquareWarning} value={fInt(k.complaints)} info={{ formula: 'Σ COMPLAINTS' }} />
        </KpiGrid>
        <MoreMeasures>
          <KpiCard compact label="Average market coverage" icon={BarChart3} value={fDec(k.avgCoverage)} info={{ formula: 'Mean of MKT COVERAGE where populated', exclusions: 'Blank is not treated as 0.' }} />
          <KpiCard compact label="Employees with no visits" icon={UserX} value={fInt(k.zeroVisitEmployees)} tone={k.zeroVisitEmployees ? 'warn' : 'neutral'} info={{ formula: 'Employees whose visits sum to 0' }} onClick={() => (cf.toggle('kpi', 'zero', 'No visits'), setTab('employees'))} active={cf.has('kpi', 'zero')} />
          <KpiCard compact label="Employees with no orders" icon={UserCheck} value={fInt(k.zeroOrderEmployees)} info={{ formula: 'Employees whose orders sum to 0' }} onClick={() => (cf.toggle('kpi', 'noorders', 'No orders'), setTab('employees'))} active={cf.has('kpi', 'noorders')} />
          <KpiCard compact label="Test accounts left out" icon={FlaskConical} value={fInt(k.excludedTest)} info={{ formula: 'Employees recognised as test accounts', exclusions: 'Test and service accounts are left out of every employee measure.' }} />
        </MoreMeasures>

        <div className="mt-5" />
        <Tabs<TabId>
          label="Employee activity"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'employees', label: 'Employees', badge: fInt(rows.length) },
          ]}
        />

        {tab === 'overview' && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Visits and orders by month" subtitle="Click a bar to filter." table={{ columns: [{ header: 'Month' }, { header: 'Employees', format: 'int' }, { header: 'Visits', format: 'int' }, { header: 'Orders', format: 'int' }], rows: monthly.map((m) => [m.label, m.employees, m.visits, m.orders]) }}>
                <StackedBarsChart data={monthly.map((m) => ({ key: m.month, label: m.label, visits: m.visits, orders: m.orders }))} series={[{ key: 'visits', label: 'Visits', color: SERIES_COLOR.ds }, { key: 'orders', label: 'Orders', color: SERIES_COLOR.sfa }]} onSelect={(_s, key, lab) => cf.toggle('month', key, lab)} />
              </ChartCard>
              <ChartCard title="Orders per visit by month" subtitle="Orders recorded for each visit recorded." table={{ columns: [{ header: 'Month' }, { header: 'Orders per visit', format: 'dec' }], rows: monthly.map((m) => [m.label, m.ordersPerVisit]) }}>
                <TrendChart format="dec" data={monthly.map((m) => ({ key: m.month, label: m.label, opv: m.ordersPerVisit }))} series={[{ key: 'opv', label: 'Orders per visit', color: SERIES_COLOR.sfa }]} onSelect={(key, lab) => cf.toggle('month', key, lab)} />
              </ChartCard>
              <ChartCard title="Top 10 employees by orders" subtitle="Click a bar to filter to that employee." table={{ columns: [{ header: 'Employee' }, { header: 'Orders', format: 'int' }, { header: 'Visits', format: 'int' }], rows: rows.slice(0, 10).map((r) => [titleCase(r.employee.toLowerCase()), r.orders, r.visits]) }}>
                <BarsChart seriesName="Orders" activeKey={cf.filters.employee} onSelect={(key, lab) => cf.toggle('employee', key, lab)} data={rows.slice(0, 10).map((r) => ({ key: r.employeeKey, label: titleCase(r.employee.toLowerCase()), value: r.orders }))} />
              </ChartCard>
              <ChartCard title="Activity by role" subtitle="Click a bar to filter." table={{ columns: [{ header: 'Role' }, { header: 'Employees', format: 'int' }, { header: 'Visits', format: 'int' }, { header: 'Orders', format: 'int' }, { header: 'Orders/visit', format: 'dec' }], rows: roles.map((r) => [r.role, r.employees, r.visits, r.orders, r.ordersPerVisit]) }}>
                <StackedBarsChart layout="horizontal" data={roles.map((r) => ({ key: r.role, label: r.role, visits: r.visits, orders: r.orders }))} series={[{ key: 'visits', label: 'Visits', color: SERIES_COLOR.ds }, { key: 'orders', label: 'Orders', color: SERIES_COLOR.sfa }]} onSelect={(_s, key) => cf.toggle('role', key)} />
              </ChartCard>
            </div>
            {insights.length > 0 && (
              <div className="mt-4">
                <SignalGrid>
                  {insights.slice(0, 4).map((i) => {
                    const card: Record<string, [string, string]> = {
                      'emp-conv': ['Orders per visit', k.ordersPerVisit === null ? '—' : fDec(k.ordersPerVisit, 2)],
                      'emp-zero': ['No visits recorded', `${fInt(k.zeroVisitEmployees)} employees`],
                      'emp-exceed': ['Orders above visits', `${fInt(k.ordersExceedVisits)} employee-months`],
                      'emp-exp': ['Expenses', 'Not captured'],
                    };
                    const [label, metric] = card[i.id] ?? [i.title, ''];
                    return <SignalCard key={i.id} label={label} metric={metric} tone={i.level === 'watch' ? 'warn' : 'neutral'} detail={`${i.title}. ${i.detail}`} onClick={() => setTab('employees')} />;
                  })}
                </SignalGrid>
              </div>
            )}
          </>
        )}

        {tab === 'employees' && <DataTable title={`Employees (${fInt(rows.length)})`} rows={rows} columns={cols} getRowId={(r) => r.employeeKey} exportName="DataSense_employee_activity" exportNotes={exportNotes} initialSort={{ id: 'orders', desc: true }} onRowClick={setSel} selectedId={sel?.employeeKey} searchPlaceholder="Search employees…" />}
      </PeriodGate>
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel ? titleCase(sel.employee.toLowerCase()) : ''} subtitle={sel?.role}>
        {sel && (
          <div className="space-y-4">
            <Facts items={[['Months in view', fInt(sel.months)], ['Visits', fInt(sel.visits)], ['Orders', fInt(sel.orders)], ['Orders per visit', fDec(sel.ordersPerVisit)], ['Market coverage', fDec(sel.coverage)], ['Complaints', fInt(sel.complaints)]]} />
            <DataTable
              title="By month"
              rows={filtered.filter((e) => e.employeeKey === sel.employeeKey).sort((a, b) => a.month.localeCompare(b.month))}
              columns={[
                { id: 'm', header: 'Month', value: (e) => monthKeyLabel(e.month) },
                { id: 'v', header: 'Visits', value: (e) => e.visited, format: 'int' },
                { id: 'o', header: 'Orders', value: (e) => e.orders, format: 'int' },
                { id: 'c', header: 'Coverage', value: (e) => e.mktCoverage, format: 'dec' },
              ]}
              exportName={`employee_${sel.employeeKey}`}
              pageSize={10}
            />
            <button className="btn btn-primary" onClick={() => (cf.set('employee', sel.employeeKey, sel.employee), setSel(null))}>
              Filter the page to this employee
            </button>
          </div>
        )}
      </Drawer>
    </DataGate>
  );
}
