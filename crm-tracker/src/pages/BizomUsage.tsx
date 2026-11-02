import { useMemo, useState } from 'react';
import { BarChart3, FileBarChart, TrendingUp, UserCheck, Users } from 'lucide-react';
import { useData } from '../state/DataContext';
import { DataGate, PeriodGate } from '../components/States';
import { KpiCard, KpiGrid } from '../components/KpiCard';
import { MoreMeasures } from '../components/MoreMeasures';
import { BarsChart, ChartCard, HeatTable, TrendChart, SERIES_COLOR } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { Tabs } from '../components/Tabs';
import { describeFilters, useCrossFilter, useUrlValue } from '../components/filters';
import { FilterBar, FilterField, buildOptions } from '../components/FilterBar';
import { Drawer, Facts } from '../components/Drawer';
import { PageHeader } from '../components/ui';
import type { Col } from '../lib/export/excel';
import { fDec, fInt, fPct } from '../lib/export/format';
import { ReportRow, UserRow, cohortChange, filterUsage, reportByMonth, reportRanking, splitTest, usageBy, usageByMonth, usageKpis, userNamesLost, userRanking } from '../lib/metrics/bizom';
import { changeOf, lastTwoCompleteMonths, monthCompleteFn } from '../lib/metrics/windows';
import type { UsageRec } from '../lib/types';
import { monthKeyLabel, periodNote } from './common';
import { titleCase } from '../lib/util/parse';

type TabId = 'usage' | 'reports' | 'users';

const DIM_LABELS: Record<string, string> = { month: 'Month', report: 'Report', kind: 'Account type', designation: 'Designation', zone: 'Zone', user: 'User', kpi: 'Measure' };

export default function BizomUsage() {
  const { data, period, settings, asOf } = useData();
  const cf = useCrossFilter();
  const [tabRaw, setTab] = useUrlValue('tab', 'usage');
  const tab = (['usage', 'reports', 'users'].includes(tabRaw) ? tabRaw : 'usage') as TabId;
  const [selReport, setSelReport] = useState<ReportRow | null>(null);
  const [selUser, setSelUser] = useState<UserRow | null>(null);
  const months = useMemo(() => [...new Set(data.usage.map((u) => u.month))].sort(), [data.usage]);
  const sp = useMemo(() => splitTest(filterUsage(data.usage, period), settings.includeTestAccounts), [data.usage, period, settings.includeTestAccounts]);
  const base = sp.kept;

  const filtered = useMemo(() => {
    const f = cf.filters;
    return base.filter((u) => {
      if (!cf.ok('month', u.month)) return false;
      if (!cf.ok('report', (u.reportName || u.reportId))) return false;
      if (!cf.ok('kind', u.accountKind)) return false;
      if (!cf.ok('designation', u.designation)) return false;
      if (!cf.ok('zone', (u.zone ?? 'Not specified'))) return false;
      if (!cf.ok('user', u.userId)) return false;
      return true;
    });
  }, [base, cf]);

  // The filter bar offers what the Bizom usage export contains in the selected period. A row is one user, report and
  // month, so no row counts are shown beside the options.
  const filterFields: FilterField[] = useMemo(() => {
    const o = { noCounts: true } as const;
    return [
      { dim: 'month', label: 'Month', allLabel: 'All months', options: buildOptions(base, (u) => u.month, { ...o, sort: 'value', label: (k) => monthKeyLabel(k) }) },
      { dim: 'zone', label: 'Zone', allLabel: 'All zones', options: buildOptions(base, (u) => u.zone ?? 'Not specified', { ...o, sort: 'label' }) },
      { dim: 'kind', label: 'Account type', allLabel: 'All account types', options: buildOptions(base, (u) => u.accountKind, { ...o, sort: ['Field staff', 'Distributor', 'Company / admin'] }) },
      { dim: 'designation', label: 'Designation', allLabel: 'All designations', search: true, options: buildOptions(base, (u) => u.designation, { ...o, sort: 'label' }) },
      { dim: 'report', label: 'Report', allLabel: 'All reports', search: true, options: buildOptions(base, (u) => u.reportName || u.reportId, { ...o, sort: 'label', label: (k) => k.replace(/\s+/g, ' ') }) },
      { dim: 'user', label: 'User', allLabel: 'All users', search: true, options: buildOptions(base, (u) => u.userId, { ...o, sort: 'label', label: (_k, s) => s.name || s.userId }) },
    ];
  }, [base]);

  const k = useMemo(() => usageKpis(filtered, settings.lowUsageThreshold, sp.excluded), [filtered, settings.lowUsageThreshold, sp.excluded]);
  const reports = useMemo(() => reportRanking(filtered), [filtered]);
  const users = useMemo(() => userRanking(filtered), [filtered]);
  const monthly = useMemo(() => usageByMonth(filtered), [filtered]);
  const kinds = useMemo(() => usageBy(filtered, (u) => u.accountKind), [filtered]);
  const desigs = useMemo(() => usageBy(filtered, (u) => u.designation), [filtered]);
  const zones = useMemo(() => usageBy(filtered, (u) => u.zone ?? 'Not specified'), [filtered]);
  const heat = useMemo(() => reportByMonth(filtered, 15), [filtered]);
  // changes are only read between two complete months: a month still in progress would look like a fall
  const lastTwo = useMemo(() => lastTwoCompleteMonths(monthly.map((m) => m.month), () => true, monthCompleteFn(data, ['bizom_usage'], asOf)), [monthly, data, asOf]);
  const momAccesses = lastTwo ? changeOf(monthly.find((m) => m.month === lastTwo[0])?.accesses, monthly.find((m) => m.month === lastTwo[1])?.accesses) : null;
  const cohort = useMemo(() => (lastTwo ? cohortChange(base, lastTwo[0], lastTwo[1]) : null), [base, lastTwo?.[0], lastTwo?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const lost = useMemo(() => (lastTwo ? userNamesLost(base, lastTwo[0], lastTwo[1]) : []), [base, lastTwo?.[0], lastTwo?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const reportCols: Col<ReportRow>[] = [
    { id: 'name', header: 'Report', value: (r) => r.reportName, width: 280 },
    { id: 'id', header: 'Report ID', value: (r) => r.reportId, hidden: true },
    { id: 'type', header: 'Type', value: (r) => r.type },
    { id: 'acc', header: 'Recorded accesses', value: (r) => r.accesses, format: 'int' },
    { id: 'users', header: 'Users', value: (r) => r.users, format: 'int' },
    { id: 'share', header: 'Share of accesses', value: (r) => r.share, format: 'pct' },
    { id: 'cum', header: 'Cumulative share', value: (r) => r.cumShare, format: 'pct', help: 'Running share when reports are ranked by accesses (Pareto).' },
    { id: 'months', header: 'Months active', value: (r) => r.months, format: 'int' },
    { id: 'apu', header: 'Accesses per user', value: (r) => (r.users ? r.accesses / r.users : null), format: 'dec', hidden: true },
  ];
  const userCols: Col<UserRow>[] = [
    { id: 'name', header: 'User', value: (u) => u.name, width: 200 },
    { id: 'des', header: 'Designation', value: (u) => u.designation },
    { id: 'kind', header: 'Account type', value: (u) => u.accountKind },
    { id: 'zone', header: 'Zone', value: (u) => u.zone },
    { id: 'sub', header: 'Sub-zone', value: (u) => u.subzone, hidden: true },
    { id: 'acc', header: 'Recorded accesses', value: (u) => u.accesses, format: 'int' },
    { id: 'rep', header: 'Reports used', value: (u) => u.reports, format: 'int' },
    { id: 'share', header: 'Share', value: (u) => u.share, format: 'pct' },
    { id: 'months', header: 'Months active', value: (u) => u.months, format: 'int' },
  ];

  const exportNotes = describeFilters(cf, DIM_LABELS, [periodNote(period), 'Access_Count = recorded report accesses (not downloads)', sp.excluded.length ? `${new Set(sp.excluded.map((u) => u.userId)).size} test/service accounts excluded` : 'No test accounts excluded']);

  const reportDetail = useMemo(() => (selReport ? userRanking(filtered.filter((u) => (u.reportName || u.reportId) === selReport.reportName)) : []), [selReport, filtered]);
  const userDetail = useMemo(() => (selUser ? reportRanking(filtered.filter((u) => u.userId === selUser.userId)) : []), [selUser, filtered]);

  return (
    <DataGate need={['bizom_usage']} what="Bizom MIS usage">
      <PageHeader title="Bizom SFA: Report Usage" />
      <PeriodGate months={months} system="Bizom usage">
        <FilterBar cf={cf} fields={filterFields} />
        <KpiGrid cols={5}>
          <KpiCard label="Report accesses" icon={BarChart3} value={fInt(k.accesses)} sub={`${k.months} month${k.months === 1 ? '' : 's'} of data`} info={{ formula: 'Σ Access_Count: the number of times reports were accessed, as recorded by Bizom', exclusions: 'Not downloads. Duplicate user–report rows and test or service accounts.' }} onClick={() => cf.clear()} hint="Clears all filters." />
          <KpiCard label="Active users" icon={Users} value={fInt(k.users)} sub={`${fDec(k.avgAccessesPerUser, 1)} accesses per user`} info={{ formula: 'Distinct users with at least one recorded access', exclusions: 'Users with zero accesses.' }} onClick={() => setTab('users')} hint="Shows the users." />
          <KpiCard label="Reports accessed" icon={FileBarChart} value={fInt(k.reports)} sub={`${fDec(k.avgReportsPerUser, 1)} reports per active user`} info={{ formula: 'Distinct reports with at least one recorded access' }} onClick={() => setTab('reports')} hint="Shows the reports." />
          <KpiCard label="Top-5 reports’ share" icon={UserCheck} value={fPct(k.top5Share, 0)} tone={k.top5Share !== null && k.top5Share > 0.6 ? 'warn' : 'neutral'} info={{ formula: 'Accesses of the five most-accessed reports ÷ all accesses', exclusions: 'A measure of concentration, not of quality.' }} onClick={() => setTab('reports')} hint="Shows the reports." />
          <KpiCard label="Change on previous month" icon={TrendingUp} value={momAccesses && momAccesses.pct !== null ? `${momAccesses.pct >= 0 ? '+' : '−'}${fPct(Math.abs(momAccesses.pct), 0)}` : '—'} unavailable={momAccesses && momAccesses.pct !== null ? undefined : 'Needs two complete months'} sub={lastTwo ? `${monthKeyLabel(lastTwo[1])} vs ${monthKeyLabel(lastTwo[0])}` : undefined} info={{ formula: '(accesses in the latest complete month − accesses in the month before) ÷ the month before', exclusions: 'A month still in progress is not compared.' }} />
        </KpiGrid>
        <MoreMeasures>
          <KpiCard compact label="Field-staff share" value={fPct(k.fieldStaffShare, 0)} info={{ formula: 'Accesses by field-staff designations ÷ all accesses', exclusions: 'Distributor and company/admin accounts count in the denominator.' }} onClick={() => cf.toggle('kind', 'Field staff')} active={cf.has('kind', 'Field staff')} />
          <KpiCard compact label="Single-user reports" value={fInt(k.singleUserReports)} info={{ formula: 'Reports accessed by exactly one user in view' }} onClick={() => setTab('reports')} hint="Shows the reports." />
          <KpiCard compact label="Low-usage reports" value={fInt(k.lowUsageReports)} sub={`${settings.lowUsageThreshold} accesses or fewer`} info={{ formula: `Reports with ${settings.lowUsageThreshold} or fewer recorded accesses in view`, exclusions: 'Reports are counted as low-usage at or below this number of accesses.' }} onClick={() => setTab('reports')} hint="Shows the reports." />
        </MoreMeasures>

        <div className="mt-5" />
        <Tabs<TabId>
          label="Bizom usage"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'usage', label: 'Usage patterns' },
            { id: 'reports', label: 'Reports', badge: reports.length },
            { id: 'users', label: 'Users', badge: users.length },
          ]}
        />

        {tab === 'usage' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Report accesses by month" subtitle="Click a month to filter." table={{ columns: [{ header: 'Month' }, { header: 'Accesses', format: 'int' }, { header: 'Active users', format: 'int' }, { header: 'Reports', format: 'int' }], rows: monthly.map((m) => [m.label, m.accesses, m.users, m.reports]) }}>
              <TrendChart data={monthly.map((m) => ({ key: m.month, label: m.label, accesses: m.accesses }))} series={[{ key: 'accesses', label: 'Recorded accesses', color: SERIES_COLOR.bizom }]} onSelect={(key, lab) => cf.toggle('month', key, lab)} />
            </ChartCard>
            <ChartCard title="Active users by month" subtitle="Users with at least one recorded access. Click a month to filter." table={{ columns: [{ header: 'Month' }, { header: 'Active users', format: 'int' }], rows: monthly.map((m) => [m.label, m.users]) }}>
              <BarsChart layout="vertical" color={SERIES_COLOR.bizom} seriesName="Active users" activeKey={cf.filters.month} onSelect={(key, lab) => cf.toggle('month', key, lab)} data={monthly.map((m) => ({ key: m.month, label: m.label, value: m.users }))} />
            </ChartCard>
            <ChartCard title="Most-used reports" subtitle="Top 15 by recorded accesses. Click a bar to filter." table={{ columns: [{ header: 'Report' }, { header: 'Accesses', format: 'int' }, { header: 'Users', format: 'int' }, { header: 'Cumulative', format: 'pct' }], rows: reports.slice(0, 15).map((r) => [r.reportName, r.accesses, r.users, r.cumShare]) }}>
              <BarsChart color={SERIES_COLOR.bizom} seriesName="Recorded accesses" activeKey={cf.filters.report} onSelect={(key) => cf.toggle('report', key)} data={reports.slice(0, 15).map((r) => ({ key: r.reportName, label: r.reportName.replace(/\s+/g, ' '), value: r.accesses }))} />
            </ChartCard>
            <ChartCard title="Accesses by account type" subtitle="Field staff, distributors and company/admin accounts. Click a bar to filter." table={{ columns: [{ header: 'Account type' }, { header: 'Accesses', format: 'int' }, { header: 'Users', format: 'int' }, { header: 'Accesses/user', format: 'dec' }], rows: kinds.map((g) => [g.label, g.accesses, g.users, g.accessesPerUser]) }}>
              <BarsChart layout="vertical" color={SERIES_COLOR.bizom} seriesName="Recorded accesses" activeKey={cf.filters.kind} onSelect={(key) => cf.toggle('kind', key)} data={kinds.map((g) => ({ key: g.key, label: g.label, value: g.accesses }))} />
            </ChartCard>
            <ChartCard title="Accesses by designation" subtitle="Top 10. Click a bar to filter." table={{ columns: [{ header: 'Designation' }, { header: 'Accesses', format: 'int' }, { header: 'Users', format: 'int' }], rows: desigs.slice(0, 10).map((g) => [g.label, g.accesses, g.users]) }}>
              <BarsChart color={SERIES_COLOR.bizom} seriesName="Recorded accesses" activeKey={cf.filters.designation} onSelect={(key) => cf.toggle('designation', key)} data={desigs.slice(0, 10).map((g) => ({ key: g.key, label: g.label, value: g.accesses }))} />
            </ChartCard>
            <ChartCard title="Accesses by zone" subtitle="Top 10. Click a bar to filter." table={{ columns: [{ header: 'Zone' }, { header: 'Accesses', format: 'int' }, { header: 'Users', format: 'int' }], rows: zones.slice(0, 10).map((g) => [g.label, g.accesses, g.users]) }}>
              <BarsChart color={SERIES_COLOR.bizom} seriesName="Recorded accesses" activeKey={cf.filters.zone} onSelect={(key) => cf.toggle('zone', key)} data={zones.slice(0, 10).map((g) => ({ key: g.key, label: g.label, value: g.accesses }))} />
            </ChartCard>
          </div>
        )}

        {tab === 'reports' && (
          <div className="space-y-4">
            {heat.months.length > 0 && (
              <ChartCard title="Report usage by month" subtitle="Top 15 reports. Click a cell to filter to that report and month.">
                <HeatTable rowHeader="Report" rowLabels={heat.rows.map((r) => r.reportName)} colLabels={heat.months.map(monthKeyLabel)} values={heat.rows.map((r) => r.byMonth)} onCell={(row, col) => (cf.set('report', row), cf.set('month', heat.months.find((m) => monthKeyLabel(m) === col) ?? null, col))} />
              </ChartCard>
            )}
            <DataTable title="Reports" rows={reports} columns={reportCols} getRowId={(r) => r.reportName} fullRows={reportRanking(data.usage)} exportName="Bizom_report_usage" exportNotes={exportNotes} initialSort={{ id: 'acc', desc: true }} onRowClick={setSelReport} selectedId={selReport?.reportName} pageSize={15} searchPlaceholder="Search reports…" />
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-4">
            {cohort && lastTwo && (
              <>
                <h3 className="text-sm font-semibold">Who is using it: {monthKeyLabel(lastTwo[0])} → {monthKeyLabel(lastTwo[1])}</h3>
                <KpiGrid cols={4}>
                  <KpiCard compact label="Active in both months" value={fInt(cohort.retained)} sub={`${cohort.increased} used more, ${cohort.decreased} used less`} info={{ formula: 'Users with recorded accesses in both months' }} />
                  <KpiCard compact label="New in latest month" value={fInt(cohort.newUsers)} info={{ formula: 'Users with accesses in the latest month and none in the previous one' }} />
                  <KpiCard compact label="Not seen in latest month" value={fInt(cohort.lostUsers)} tone={cohort.lostUsers ? 'warn' : 'neutral'} info={{ formula: 'Users with accesses in the previous month and none in the latest', exclusions: 'May reflect leave or a role change, not disengagement.' }} />
                  <KpiCard compact label="Their accesses the month before" value={fInt(lost.reduce((a, u) => a + u.accesses, 0))} info={{ formula: 'Σ previous-month accesses of users not seen in the latest month' }} />
                </KpiGrid>
              </>
            )}
            <DataTable title="Users" rows={users} columns={userCols} getRowId={(u) => u.userId} exportName="Bizom_user_usage" exportNotes={exportNotes} initialSort={{ id: 'acc', desc: true }} onRowClick={setSelUser} selectedId={selUser?.userId} pageSize={15} searchPlaceholder="Search users…" />
            {lastTwo && lost.length > 0 && <DataTable title={`Users active in ${monthKeyLabel(lastTwo[0])} but not in ${monthKeyLabel(lastTwo[1])}`} rows={lost} columns={userCols} getRowId={(u) => `lost-${u.userId}`} exportName="Bizom_users_not_seen_latest_month" exportNotes={exportNotes} initialSort={{ id: 'acc', desc: true }} pageSize={10} />}
          </div>
        )}
      </PeriodGate>

      <Drawer open={!!selReport} onClose={() => setSelReport(null)} title={selReport?.reportName ?? ''} subtitle={selReport ? `Report ${selReport.reportId} · ${selReport.type}` : undefined}>
        {selReport && (
          <div className="space-y-4">
            <Facts items={[['Recorded accesses', fInt(selReport.accesses)], ['Users', fInt(selReport.users)], ['Share of all accesses', fPct(selReport.share)], ['Cumulative share', fPct(selReport.cumShare)], ['Months with accesses', fInt(selReport.months)]]} />
            <DataTable title="Users of this report" rows={reportDetail} columns={userCols.slice(0, 8)} getRowId={(u) => `rd-${u.userId}`} exportName={`report_${selReport.reportId}_users`} pageSize={10} initialSort={{ id: 'acc', desc: true }} />
            <button className="btn btn-primary" onClick={() => (cf.set('report', selReport.reportName), setSelReport(null))}>
              Filter the page to this report
            </button>
          </div>
        )}
      </Drawer>
      <Drawer open={!!selUser} onClose={() => setSelUser(null)} title={selUser ? titleCase(selUser.name.toLowerCase()) : ''} subtitle={selUser ? `${selUser.designation} · ${selUser.accountKind}` : undefined}>
        {selUser && (
          <div className="space-y-4">
            <Facts items={[['Zone', selUser.zone ?? '—'], ['Sub-zone', selUser.subzone ?? '—'], ['Recorded accesses', fInt(selUser.accesses)], ['Reports used', fInt(selUser.reports)], ['Months active', fInt(selUser.months)]]} />
            <DataTable title="Reports used" rows={userDetail} columns={reportCols.filter((c) => ['name', 'type', 'acc', 'share'].includes(c.id))} getRowId={(r) => `ud-${r.reportName}`} exportName={`user_${selUser.userId}_reports`} pageSize={10} initialSort={{ id: 'acc', desc: true }} />
            <button className="btn btn-primary" onClick={() => (cf.set('user', selUser.userId, selUser.name), setSelUser(null))}>
              Filter the page to this user
            </button>
          </div>
        )}
      </Drawer>
    </DataGate>
  );
}

export type { UsageRec };
