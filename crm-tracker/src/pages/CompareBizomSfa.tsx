import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, Footprints, UserCheck, Users } from 'lucide-react';
import { useData } from '../state/DataContext';
import { DataGate } from '../components/States';
import { KpiCard, KpiGrid } from '../components/KpiCard';
import { useCrossFilter } from '../components/filters';
import { FilterBar, FilterField, buildOptions } from '../components/FilterBar';
import { ChartCard, GroupedColumnsChart, SERIES_COLOR } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { Badge, Notice, PageHeader } from '../components/ui';
import { fInt } from '../lib/export/format';
import { bizomVsSfa } from '../lib/metrics/employees';
import type { EmployeeActivityRec } from '../lib/types';
import { filterUsage, splitTest } from '../lib/metrics/bizom';
import { monthLabel } from '../lib/util/parse';
import { periodNote } from './common';

export default function CompareBizomSfa() {
  const { data, period, settings, focusMonth } = useData();
  const nav = useNavigate();
  const cf = useCrossFilter();
  const usageAll = useMemo(() => splitTest(filterUsage(data.usage, period), settings.includeTestAccounts).kept, [data.usage, period, settings.includeTestAccounts]);
  // Zone and designation narrow the Bizom side; role narrows the Dealer SFA side. Both sides stay in the same months.
  const usage = useMemo(() => usageAll.filter((u) => cf.ok('zone', u.zone ?? 'Not specified') && cf.ok('designation', u.designation)), [usageAll, cf]);
  const sfaFilter = useMemo(() => (cf.filters.role ? (r: EmployeeActivityRec) => cf.ok('role', r.role || 'Not specified') : undefined), [cf]);
  const cmp = useMemo(() => bizomVsSfa(data, usage, period, settings, sfaFilter), [data, usage, period, settings, sfaFilter]);
  const filterFields: FilterField[] = useMemo(() => {
    const months = new Set(cmp.monthly.map((m) => m.month));
    const sfaRecs = cmp.source.records.filter((r) => months.has(r.month) && (settings.includeTestAccounts || !r.isTest));
    return [
      { dim: 'zone', label: 'Bizom zone', allLabel: 'All zones', options: buildOptions(usageAll, (u) => u.zone ?? 'Not specified', { noCounts: true, sort: 'label' }) },
      { dim: 'designation', label: 'Bizom designation', allLabel: 'All designations', search: true, options: buildOptions(usageAll, (u) => u.designation, { noCounts: true, sort: 'label' }) },
      { dim: 'role', label: 'Dealer SFA role', allLabel: 'All roles', options: buildOptions(sfaRecs, (r) => r.role || 'Not specified', { noCounts: true, sort: 'label' }) },
    ];
  }, [usageAll, cmp.monthly, cmp.source.records, settings.includeTestAccounts]);

  // People who opened a Bizom report, and Bizom field staff only (the Dealer SFA is used by field staff)
  const fieldUsersByMonth = useMemo(() => {
    const m = new Map<string, Set<string>>();
    usage.filter((u) => u.accountKind === 'Field staff' && u.accessCount > 0).forEach((u) => m.set(u.month, (m.get(u.month) ?? new Set()).add(u.userId)));
    return m;
  }, [usage]);

  // KPIs cover the months in which both systems have data, so the two sides are like for like
  const kpiMonths = cmp.months.length ? new Set(cmp.months) : null;
  const kpi = useMemo(() => {
    const inScope = (m: string) => !kpiMonths || kpiMonths.has(m);
    const u = usage.filter((x) => inScope(x.month) && x.accessCount > 0);
    const rows = cmp.monthly.filter((r) => inScope(r.month));
    const has = (k: 'sfaVisits' | 'sfaOrders') => rows.some((r) => r[k] !== null);
    return {
      users: new Set(u.map((x) => x.userId)).size,
      accesses: u.reduce((a, x) => a + x.accessCount, 0),
      visits: has('sfaVisits') ? rows.reduce((a, r) => a + (r.sfaVisits ?? 0), 0) : null,
      orders: has('sfaOrders') ? rows.reduce((a, r) => a + (r.sfaOrders ?? 0), 0) : null,
    };
  }, [usage, cmp.monthly, kpiMonths]);
  const monthsText = cmp.months.length ? cmp.months.map(monthLabel).join(' and ') : periodNote(period);

  const monthRows = cmp.monthly.map((m) => ({ ...m, fieldUsers: fieldUsersByMonth.get(m.month)?.size ?? 0 }));
  

  return (
    <DataGate need={['bizom_usage']} what="the Bizom SFA vs Dealer SFA usage comparison">
      <PageHeader title="Bizom SFA vs Dealer SFA Usage" actions={<Badge tone="info" icon={false}>{monthsText}</Badge>} />
      <FilterBar cf={cf} fields={filterFields} />
      {cmp.source.kind === 'none' && (
        <div className="mb-4">
          <Notice tone="warn" title="No Dealer SFA usage data" action={<Link to="/import" className="btn btn-sm btn-primary">Import the employee activity file</Link>}>
            Only the Bizom side can be shown until the employee daily-activity report is imported.
          </Notice>
        </div>
      )}

      <KpiGrid cols={4}>
        <KpiCard label="Bizom active users" icon={Users} value={fInt(kpi.users)} sub="opened a report" onClick={() => nav('/bizom/usage')} hint="Opens Bizom MIS usage." info={{ formula: 'Distinct Bizom users with at least one recorded report access', exclusions: 'Test and service accounts.' }} />
        <KpiCard label="Bizom report accesses" icon={Activity} value={fInt(kpi.accesses)} sub="recorded, not downloads" onClick={() => nav('/bizom/usage')} hint="Opens Bizom MIS usage." info={{ formula: 'Σ Access_Count' }} />
        <KpiCard label="Dealer SFA employees" icon={UserCheck} value={cmp.available ? fInt(cmp.sfaEmployees) : '—'} unavailable={cmp.available ? undefined : 'No activity file'} sub="with recorded activity" onClick={cmp.available ? () => nav('/datasense/employees') : undefined} hint="Opens the employee activity page." info={{ formula: 'Distinct employees in the daily-activity report', exclusions: 'Test and service accounts.' }} />
        <KpiCard label="Dealer SFA visits" icon={Footprints} value={kpi.visits !== null ? fInt(kpi.visits) : '—'} unavailable={cmp.available ? undefined : 'No activity file'} sub={kpi.orders !== null ? `${fInt(kpi.orders)} orders` : undefined} onClick={cmp.available ? () => nav('/datasense/employees') : undefined} hint="Opens the employee activity page." info={{ formula: 'Σ VISITED in the daily-activity report' }} />
      </KpiGrid>

      <div className="mt-5" />
      {cmp.monthly.length === 0 ? (
        <Notice tone="neutral" title="No months in the selected period">Choose another reporting period.</Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard
            title="People using each app"
            subtitle="Active each month. Click a month to focus on it."
            info={{ formula: 'Bizom: field-staff users with at least one recorded report access. Dealer SFA: employees in the daily-activity report.' }}
            table={{ columns: [{ header: 'Month' }, { header: 'Bizom field users', format: 'int' }, { header: 'Dealer SFA employees', format: 'int' }], rows: monthRows.map((m) => [m.label, m.fieldUsers, m.sfaEmployees]) }}
          >
            <GroupedColumnsChart onSelect={focusMonth} format="int" height={230} data={monthRows.map((m) => ({ key: m.month, label: m.label.replace(' 20', ' ’'), bizom: m.fieldUsers, sfa: m.sfaEmployees }))} series={[{ key: 'bizom', label: 'Bizom SFA', color: SERIES_COLOR.bizom }, { key: 'sfa', label: 'Dealer SFA', color: SERIES_COLOR.sfa }]} />
          </ChartCard>
          <ChartCard
            title="Bizom report accesses"
            subtitle="Recorded accesses by month. Click a month."
            table={{ columns: [{ header: 'Month' }, { header: 'Active users', format: 'int' }, { header: 'Accesses', format: 'int' }], rows: cmp.monthly.map((m) => [m.label, m.bizomUsers, m.bizomAccesses]) }}
          >
            <GroupedColumnsChart onSelect={focusMonth} format="int" height={230} data={cmp.monthly.map((m) => ({ key: m.month, label: m.label.replace(' 20', ' ’'), accesses: m.bizomAccesses }))} series={[{ key: 'accesses', label: 'Bizom accesses', color: SERIES_COLOR.bizom }]} />
          </ChartCard>
          {cmp.available ? (
            <ChartCard
              title="Dealer SFA visits and orders"
              subtitle="By month. Click a month."
              table={{ columns: [{ header: 'Month' }, { header: 'Employees', format: 'int' }, { header: 'Visits', format: 'int' }, { header: 'Orders', format: 'int' }], rows: cmp.monthly.map((m) => [m.label, m.sfaEmployees, m.sfaVisits, m.sfaOrders]) }}
            >
              <GroupedColumnsChart onSelect={focusMonth} format="int" height={230} data={cmp.monthly.filter((m) => m.sfaVisits !== null).map((m) => ({ key: m.month, label: m.label.replace(' 20', ' ’'), visits: m.sfaVisits, orders: m.sfaOrders }))} series={[{ key: 'visits', label: 'Visits', color: SERIES_COLOR.sfa }, { key: 'orders', label: 'Orders', color: SERIES_COLOR.ds }]} />
            </ChartCard>
          ) : (
            <div className="card flex items-center justify-center p-6 text-sm text-ink-3">Dealer SFA activity is not imported.</div>
          )}
        </div>
      )}
      <div className="mt-4">
        <DataTable
          title="Month by month"
          rows={monthRows}
          columns={[
            { id: 'm', header: 'Month', value: (r) => r.label },
            { id: 'bu', header: 'Bizom active users', value: (r) => r.bizomUsers, format: 'int' },
            { id: 'ba', header: 'Bizom accesses', value: (r) => r.bizomAccesses, format: 'int' },
            { id: 'se', header: 'Dealer SFA employees', value: (r) => r.sfaEmployees, format: 'int' },
            { id: 'sv', header: 'Dealer SFA visits', value: (r) => r.sfaVisits, format: 'int' },
            { id: 'so', header: 'Dealer SFA orders', value: (r) => r.sfaOrders, format: 'int' },
            { id: 'apv', header: 'Bizom accesses per SFA visit', value: (r) => (r.sfaVisits ? r.bizomAccesses / r.sfaVisits : null), format: 'dec' },
          ]}
          getRowId={(r) => r.month}
          exportName="Bizom_vs_Dealer_SFA_monthly"
          exportNotes={[periodNote(period), cmp.source.note]}
          onRowClick={(r) => focusMonth(r.month)}
          pageSize={10}
        />
      </div>
    </DataGate>
  );
}
