import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Headset, Repeat, ShieldAlert, TimerReset, UserX } from 'lucide-react';
import { useData } from '../state/DataContext';
import { DataGate, PeriodGate } from '../components/States';
import { KpiCard, KpiGrid } from '../components/KpiCard';
import { MoreMeasures } from '../components/MoreMeasures';
import { BarsChart, ChartCard, DonutChart, SERIES_COLOR, StackedBarsChart, statusColor } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { DealerLink } from '../components/DealerLink';
import { Tabs } from '../components/Tabs';
import { describeFilters, useCrossFilter, useDealerProfile, useUrlValue } from '../components/filters';
import { FilterBar, FilterField, buildOptions } from '../components/FilterBar';
import { Drawer, Facts } from '../components/Drawer';
import { PageHeader } from '../components/ui';
import type { Col } from '../lib/export/excel';
import { fDate, fDec, fInt, fPct } from '../lib/export/format';
import { AGE_BUCKETS, COMPLAINT_STATUS_LABELS, CountRow, ageDays, complaintKpis, complaintsByMonth, countBy, filterComplaints, isBacklog, splitTestComplaints, topWithOther } from '../lib/metrics/complaints';
import { isValidatedDealerKey } from '../lib/nav/links';
import type { ComplaintRec, ComplaintStatusGroup } from '../lib/types';
import { ComplaintStatusBadge, monthKeyLabel, periodNote } from './common';
import { titleCase } from '../lib/util/parse';

type TabId = 'overview' | 'dealers' | 'register';

const DIM_LABELS: Record<string, string> = { status: 'Status', month: 'Month raised', func: 'Responsible function', category: 'Category', sub: 'Sub-type', age: 'Ageing', who: 'Raised by', role: 'Role', dealer: 'Dealer', kpi: 'Measure' };

function ComplaintsPage({ system }: { system: 'dealer' | 'ds' }) {
  const { data, period, settings, asOf, focusMonth } = useData();
  const cf = useCrossFilter();
  const { open: openProfile } = useDealerProfile();
  const [tabRaw, setTab] = useUrlValue('tab', 'overview');
  const tab = (['overview', 'dealers', 'register'].includes(tabRaw) ? tabRaw : 'overview') as TabId;
  const [selected, setSelected] = useState<ComplaintRec | null>(null);
  const isDealer = system === 'dealer';
  const color = isDealer ? SERIES_COLOR.dealer : SERIES_COLOR.ds;
  const label = isDealer ? 'Dealer App' : 'DataSense SFA';
  const all = isDealer ? data.dealerComplaints : data.dsComplaints;
  const months = useMemo(() => [...new Set(all.map((c) => c.month).filter(Boolean) as string[])].sort(), [all]);
  const sp = useMemo(() => splitTestComplaints(filterComplaints(all, period), settings.includeTestAccounts), [all, period, settings.includeTestAccounts]);
  const recs = sp.kept;

  const ageBucketOf = (c: ComplaintRec) => {
    if (!isBacklog(c)) return null;
    const a = ageDays(c, asOf);
    return a === null ? null : AGE_BUCKETS.find((b) => a >= b.min && a <= b.max)?.label ?? null;
  };
  const dealerKeyOf = (c: ComplaintRec) => c.dealerKey ?? `name:${c.dealerName ?? 'Unknown'}`;
  const funcOf = (c: ComplaintRec) => (isDealer ? c.department : c.owner) ?? 'Not specified';

  const filtered = useMemo(() => {
    const f = cf.filters;
    return recs.filter((c) => {
      if (!cf.ok('status', c.statusGroup)) return false;
      if (!cf.ok('func', funcOf(c))) return false;
      if (!cf.ok('category', (c.category ?? 'Not specified'))) return false;
      if (!cf.ok('sub', (c.subType ?? 'Not specified'))) return false;
      if (!cf.ok('age', ageBucketOf(c))) return false;
      if (!cf.ok('who', (c.createdBy ?? 'Not specified'))) return false;
      if (!cf.ok('role', (c.role ?? 'Not specified'))) return false;
      if (!cf.ok('dealer', dealerKeyOf(c))) return false;
      if (cf.has('kpi', 'backlog') && !isBacklog(c)) return false;
      if (cf.has('kpi', 'over30') && !(isBacklog(c) && (ageDays(c, asOf) ?? 0) > 30)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, cf, asOf, isDealer]);

  // The filter bar offers what this page's own complaints contain in the selected period.
  const filterFields: FilterField[] = useMemo(() => {
    const nice = (k: string) => titleCase(k.toLowerCase());
    const notSpecified = (v: string | null | undefined) => v ?? 'Not specified';
    return [
      { dim: 'status', label: 'Status', allLabel: 'All statuses', options: buildOptions(recs, (c) => c.statusGroup, { label: (k) => COMPLAINT_STATUS_LABELS[k as ComplaintStatusGroup] ?? k }) },
      { dim: 'func', label: isDealer ? 'Department' : 'Responsible function', allLabel: isDealer ? 'All departments' : 'All functions', search: true, options: buildOptions(recs, (c) => notSpecified(isDealer ? c.department : c.owner)) },
      { dim: 'category', label: 'Category', allLabel: 'All categories', search: true, options: buildOptions(recs, (c) => notSpecified(c.category)) },
      ...(isDealer
        ? [{ dim: 'sub', label: 'Sub-type', allLabel: 'All sub-types', search: true, options: buildOptions(recs, (c) => notSpecified(c.subType)) } as FilterField]
        : [
            { dim: 'role', label: 'Role', allLabel: 'All roles', options: buildOptions(recs, (c) => notSpecified(c.role)) } as FilterField,
            { dim: 'who', label: 'Raised by', allLabel: 'Everyone', search: true, options: buildOptions(recs, (c) => notSpecified(c.createdBy), { label: nice }) } as FilterField,
          ]),
      { dim: 'age', label: 'Ageing (not closed)', allLabel: 'Any age', options: buildOptions(recs, ageBucketOf, { sort: AGE_BUCKETS.map((b) => b.label) }) },
      { dim: 'dealer', label: 'Dealer', allLabel: 'All dealers', search: true, options: buildOptions(recs, (c) => (c.dealerKey || c.dealerName ? dealerKeyOf(c) : null), { label: (k, s) => nice(s.dealerName ?? k) }) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, isDealer, asOf]);

  const k = useMemo(() => complaintKpis(filtered, asOf, sp.excluded.length), [filtered, asOf, sp.excluded.length]);
  const statusRows = useMemo(() => countBy(filtered, (c) => c.statusGroup, (key) => COMPLAINT_STATUS_LABELS[key as ComplaintStatusGroup]), [filtered]);
  const monthly = useMemo(() => complaintsByMonth(filtered), [filtered]);
  const funcRows = useMemo(() => countBy(filtered, funcOf), [filtered, isDealer]);
  const catRows = useMemo(() => topWithOther(countBy(filtered, (c) => c.category ?? 'Not specified'), 10), [filtered]);
  const subRows = useMemo(() => countBy(filtered, (c) => c.subType ?? 'Not specified'), [filtered]);
  const whoRows = useMemo(() => countBy(filtered, (c) => c.createdBy ?? 'Not specified'), [filtered]);
  const roleRows = useMemo(() => countBy(filtered, (c) => c.role ?? 'Not specified'), [filtered]);
  const dealerRows = useMemo(() => countBy(filtered, (c) => (c.dealerKey || c.dealerName ? dealerKeyOf(c) : null), (key, rs) => rs[0].dealerName ?? key), [filtered]);

  const cols: Col<ComplaintRec>[] = useMemo(
    () => [
      { id: 'id', header: 'Complaint ID', value: (c) => c.id, width: 150 },
      { id: 'raised', header: 'Raised', value: (c) => c.raisedAt ?? c.raisedDate, format: 'datetime' },
      { id: 'status', header: 'Status', value: (c) => COMPLAINT_STATUS_LABELS[c.statusGroup], render: (c) => <ComplaintStatusBadge s={c.statusGroup} /> },
      { id: 'age', header: 'Age (days)', value: (c) => (isBacklog(c) ? ageDays(c, asOf) : null), format: 'int', help: 'As-of date minus raised date; only for complaints that are not closed or rejected.' },
      { id: 'dealer', header: 'Dealer', value: (c) => c.dealerName, width: 180, render: (c) => <DealerLink dealerKey={c.dealerKey}>{c.dealerName ? titleCase(c.dealerName.toLowerCase()) : '—'}</DealerLink> },
      { id: 'code', header: 'Dealer code', value: (c) => c.dealerKey },
      { id: 'func', header: isDealer ? 'Department' : 'Responsible function', value: (c) => funcOf(c) },
      ...(isDealer ? [] : [{ id: 'assignee', header: 'Currently with', value: (c: ComplaintRec) => (c.departmentKind === 'individual' ? c.department : null) } as Col<ComplaintRec>]),
      { id: 'cat', header: 'Category', value: (c) => c.category },
      ...(isDealer ? [{ id: 'sub', header: 'Sub-type', value: (c: ComplaintRec) => c.subType } as Col<ComplaintRec>, { id: 'level', header: 'Level', value: (c: ComplaintRec) => c.assignmentLevel } as Col<ComplaintRec>] : [{ id: 'who', header: 'Raised by', value: (c: ComplaintRec) => c.createdBy } as Col<ComplaintRec>, { id: 'role', header: 'Role', value: (c: ComplaintRec) => c.role } as Col<ComplaintRec>]),
      { id: 'tat', header: 'TAT (hours)', value: (c) => (c.statusGroup === 'closed' && c.tatMinutes !== null ? c.tatMinutes / 60 : null), format: 'hours', hidden: isDealer },
      { id: 'desc', header: 'Description', value: (c) => c.description, width: 300, hidden: true },
      { id: 'inv', header: 'Invoice', value: (c) => c.invoiceNumber, hidden: true },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDealer, asOf],
  );

  const exportNotes = describeFilters(cf, DIM_LABELS, [periodNote(period), `Ageing measured at ${asOf}`]);
  const kpiLabel = (v: string) => ({ backlog: 'Not yet closed', over30: 'Open > 30 days' }[v] ?? v);

  const dealerSelect = (key: string, lab: string) => (isValidatedDealerKey(key) ? openProfile(key, 'complaints') : cf.toggle('dealer', key, lab));
  const dealerCols: Col<CountRow>[] = [
    { id: 'label', header: 'Dealer', value: (r) => r.label, width: 240, render: (r) => <DealerLink dealerKey={r.key} tab="complaints">{titleCase(r.label.toLowerCase())}</DealerLink> },
    { id: 'count', header: 'Complaints', value: (r) => r.count, format: 'int' },
    { id: 'backlog', header: 'Not closed', value: (r) => r.backlog, format: 'int' },
    { id: 'closed', header: 'Closed', value: (r) => r.closed, format: 'int' },
    { id: 'share', header: 'Share of all', value: (r) => r.share, format: 'pct' },
  ];

  return (
    <DataGate need={[isDealer ? 'dealer_complaints' : 'ds_complaints']} what={`${label} complaints`}>
      <PageHeader title={`${label}: Complaints`} />
      <PeriodGate months={months} system={`${label} complaint`}>
        <FilterBar cf={cf} fields={filterFields} />
        <KpiGrid cols={5}>
          <KpiCard label="Complaints" icon={Headset} value={fInt(k.total)} sub={`${fInt(k.dealersAffected)} dealers affected`} info={{ formula: 'Complaints raised in the period', exclusions: 'Exact duplicate rows and test records.' }} onClick={() => cf.clearDim('kpi')} active={!cf.filters.kpi} hint="Clears the measure filter." />
          <KpiCard label="Not yet closed" icon={AlertTriangle} value={fInt(k.backlog)} sub={fPct(k.backlogRate)} tone={k.backlogRate !== null && k.backlogRate > 0.5 ? 'warn' : 'neutral'} info={{ formula: 'Complaints whose status is open, pending, in process or escalated', exclusions: 'Closed and rejected complaints.' }} onClick={() => cf.toggle('kpi', 'backlog', kpiLabel('backlog'))} active={cf.has('kpi', 'backlog')} />
          <KpiCard label="Resolution rate" icon={CheckCircle2} value={fPct(k.resolutionRate)} sub={`${fInt(k.closed)} closed`} tone="good" info={{ formula: 'Closed complaints ÷ all complaints', exclusions: 'Rejected complaints count in the denominator but not as resolved.' }} onClick={() => cf.toggle('status', 'closed', 'Closed')} active={cf.has('status', 'closed')} />
          <KpiCard label="Open more than 30 days" icon={CalendarClock} value={fInt(k.over30)} tone={k.over30 ? 'bad' : 'neutral'} sub={k.oldestAgeDays !== null ? `oldest ${k.oldestAgeDays} days` : undefined} info={{ formula: `Not-yet-closed complaints raised more than 30 days before ${asOf}` }} onClick={() => cf.toggle('kpi', 'over30', kpiLabel('over30'))} active={cf.has('kpi', 'over30')} />
          <KpiCard label="Average age of backlog" icon={Clock3} value={k.avgAgeDays === null ? '—' : `${fDec(k.avgAgeDays, 1)} days`} info={{ formula: 'Mean of (report date − raised date) over not-yet-closed complaints' }} />
        </KpiGrid>
        <MoreMeasures>
          <KpiCard compact label="Average turnaround" icon={TimerReset} value={k.avgTatHours === null ? '—' : `${fDec(k.avgTatHours / 24, 1)} days`} sub={k.avgTatHours === null ? undefined : `median ${fDec((k.medianTatHours ?? 0) / 24, 1)} days · ${fInt(k.tatCount)} closed`} unavailable={!k.tatAvailable ? 'Not recorded in the Dealer App export' : undefined} info={{ formula: 'Mean TAT of closed complaints (reported TAT, otherwise closed − raised date)', exclusions: 'Complaints that are not closed; negative values.' }} />
          <KpiCard compact label="Rejected" icon={ShieldAlert} value={fInt(k.rejected)} info={{ formula: 'Complaints with a rejected status' }} onClick={() => cf.toggle('status', 'rejected', 'Rejected')} active={cf.has('status', 'rejected')} />
          <KpiCard compact label="Escalated" icon={AlertTriangle} value={fInt(k.escalated)} info={{ formula: 'Complaints with an escalated status' }} onClick={() => cf.toggle('status', 'escalated', 'Escalated')} active={cf.has('status', 'escalated')} />
          <KpiCard compact label="Dealers with repeat complaints" icon={Repeat} value={fInt(k.repeatDealers)} info={{ formula: 'Dealers (by dealer code) with more than one complaint in view' }} onClick={() => setTab('dealers')} hint="Shows complaints by dealer." />
          <KpiCard compact label="Without a dealer code" icon={UserX} value={fInt(k.withoutDealer)} tone={k.withoutDealer ? 'warn' : 'neutral'} info={{ formula: 'Complaints that do not carry a usable dealer code; they cannot be joined to a dealer profile' }} />
        </MoreMeasures>

        <div className="mt-5" />
        <Tabs<TabId>
          label={`${label} complaints`}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'dealers', label: 'Dealers', badge: dealerRows.length },
            { id: 'register', label: 'Complaint register', badge: fInt(filtered.length) },
          ]}
        />

        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Complaints by status" subtitle="Click a status to filter." table={{ columns: [{ header: 'Status' }, { header: 'Complaints', format: 'int' }], rows: statusRows.map((r) => [r.label, r.count]) }}>
              <DonutChart centerValue={fInt(k.total)} centerLabel="complaints" activeKey={cf.filters.status} onSelect={(key, lab) => cf.toggle('status', key, lab)} data={statusRows.map((r, i) => ({ key: r.key, label: r.label, value: r.count, color: statusColor(r.label, i) }))} />
            </ChartCard>
            <ChartCard title="Complaints raised by month" subtitle="Closed and not closed. Click a month to focus the reporting range on it." table={{ columns: [{ header: 'Month' }, { header: 'Total', format: 'int' }, { header: 'Closed', format: 'int' }, { header: 'Not closed', format: 'int' }], rows: monthly.map((m) => [monthKeyLabel(m.month), m.total, m.closed, m.backlog]) }}>
              <StackedBarsChart
                data={monthly.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), closed: m.closed, notClosed: m.total - m.closed }))}
                series={[
                  { key: 'closed', label: 'Closed', color: '#1baf7a' },
                  { key: 'notClosed', label: 'Not closed (incl. rejected)', color: '#C8202F' },
                ]}
                onSelect={(_s, key, lab) => focusMonth(key)}
              />
            </ChartCard>
            <ChartCard title="Ageing of complaints not yet closed" subtitle="Days since raised. Click a bar to filter." table={{ columns: [{ header: 'Age' }, { header: 'Complaints', format: 'int' }], rows: k.ageBuckets.map((b) => [b.label, b.count]) }}>
              <BarsChart layout="vertical" color={color} seriesName="Complaints" activeKey={cf.filters.age} onSelect={(key) => cf.toggle('age', key)} data={k.ageBuckets.map((b) => ({ key: b.label, label: b.label, value: b.count }))} />
            </ChartCard>
            <ChartCard title={isDealer ? 'Complaints by department' : 'Complaints by responsible function'} subtitle="Closed and not closed. Click a bar to filter." table={{ columns: [{ header: 'Function' }, { header: 'Complaints', format: 'int' }, { header: 'Not closed', format: 'int' }], rows: funcRows.map((r) => [r.label, r.count, r.backlog]) }}>
              <StackedBarsChart layout="horizontal" data={funcRows.slice(0, 10).map((r) => ({ key: r.key, label: r.label, closed: r.count - r.backlog, notClosed: r.backlog }))} series={[{ key: 'closed', label: 'Closed or rejected', color: '#1baf7a' }, { key: 'notClosed', label: 'Not closed', color: '#C8202F' }]} onSelect={(_s, key) => cf.toggle('func', key)} />
            </ChartCard>
            <ChartCard title="Complaints by category" subtitle="Top 10 categories. Click a bar to filter." table={{ columns: [{ header: 'Category' }, { header: 'Complaints', format: 'int' }, { header: 'Share', format: 'pct' }], rows: catRows.map((r) => [r.label, r.count, r.share]) }}>
              <BarsChart color={color} seriesName="Complaints" activeKey={cf.filters.category} onSelect={(key) => key !== '__other' && cf.toggle('category', key)} data={catRows.map((r) => ({ key: r.key, label: r.label, value: r.count }))} />
            </ChartCard>
            {isDealer ? (
              <ChartCard title="Complaints by sub-type" subtitle="Click a bar to filter." table={{ columns: [{ header: 'Sub-type' }, { header: 'Complaints', format: 'int' }], rows: subRows.map((r) => [r.label, r.count]) }}>
                <BarsChart color={color} seriesName="Complaints" activeKey={cf.filters.sub} onSelect={(key) => cf.toggle('sub', key)} data={subRows.map((r) => ({ key: r.key, label: r.label, value: r.count }))} />
              </ChartCard>
            ) : (
              <ChartCard title="Top people raising complaints" subtitle="Field staff who created the ticket. Click a bar to filter." table={{ columns: [{ header: 'Raised by' }, { header: 'Complaints', format: 'int' }], rows: whoRows.slice(0, 10).map((r) => [r.label, r.count]) }}>
                <BarsChart color={color} seriesName="Complaints" activeKey={cf.filters.who} onSelect={(key) => cf.toggle('who', key)} data={whoRows.slice(0, 10).map((r) => ({ key: r.key, label: titleCase(r.label.toLowerCase()), value: r.count }))} />
              </ChartCard>
            )}
            {!isDealer && (
              <ChartCard title="Complaints by raiser’s role" subtitle="Click a bar to filter." table={{ columns: [{ header: 'Role' }, { header: 'Complaints', format: 'int' }], rows: roleRows.map((r) => [r.label, r.count]) }}>
                <BarsChart layout="vertical" color={color} seriesName="Complaints" activeKey={cf.filters.role} onSelect={(key) => cf.toggle('role', key)} data={roleRows.map((r) => ({ key: r.key, label: r.label, value: r.count }))} />
              </ChartCard>
            )}
          </div>
        )}

        {tab === 'dealers' && (
          <div className="space-y-4">
            <ChartCard title="Top dealers by complaints" subtitle="Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Complaints', format: 'int' }, { header: 'Not closed', format: 'int' }], rows: dealerRows.slice(0, 10).map((r) => [r.label, r.count, r.backlog]) }}>
              <BarsChart color={color} seriesName="Complaints" activeKey={cf.filters.dealer} onSelect={dealerSelect} data={dealerRows.slice(0, 10).map((r) => ({ key: r.key, label: titleCase(r.label.toLowerCase()), value: r.count }))} />
            </ChartCard>
            <DataTable title="Complaints by dealer" rows={dealerRows} columns={dealerCols} getRowId={(r) => r.key} exportName={`${isDealer ? 'DealerApp' : 'DataSense'}_complaints_by_dealer`} exportNotes={exportNotes} initialSort={{ id: 'count', desc: true }} onRowClick={(r) => dealerSelect(r.key, r.label)} selectedId={cf.filters.dealer} pageSize={10} searchPlaceholder="Search dealers…" />
          </div>
        )}

        {tab === 'register' && <DataTable title="Complaint register" rows={filtered} columns={cols} getRowId={(c) => c.key} fullRows={all} exportName={`${isDealer ? 'DealerApp' : 'DataSense'}_complaints`} exportNotes={exportNotes} initialSort={{ id: 'raised', desc: true }} onRowClick={setSelected} selectedId={selected?.key} searchPlaceholder="Search complaints, dealers, categories…" />}
      </PeriodGate>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Complaint ${selected.id}` : ''} subtitle={selected ? `${selected.dealerName ?? 'Dealer not specified'} · raised ${fDate(selected.raisedDate)}` : undefined}>
        {selected && (
          <Facts
            items={[
              ['Dealer', selected.dealerKey ? <DealerLink key="d" dealerKey={selected.dealerKey} tab="complaints">{titleCase((selected.dealerName ?? selected.dealerKey).toLowerCase())}</DealerLink> : selected.dealerName ?? 'Not specified'],
              ['Status', <ComplaintStatusBadge key="s" s={selected.statusGroup} />],
              ['Age (not closed)', isBacklog(selected) ? `${ageDays(selected, asOf) ?? '—'} days` : '—'],
              ['Turnaround', selected.statusGroup === 'closed' && selected.tatMinutes !== null ? `${fDec(selected.tatMinutes / 60 / 24, 1)} days` : 'Not available'],
              [isDealer ? 'Department' : 'Responsible function', funcOf(selected)],
              ...(isDealer ? ([['Level', selected.assignmentLevel ?? '—']] as Array<[string, React.ReactNode]>) : ([['Currently with', selected.departmentKind === 'individual' ? selected.department : '—'], ['Raised by', selected.createdBy ?? '—'], ['Role', selected.role ?? '—']] as Array<[string, React.ReactNode]>)),
              ['Category', selected.category ?? '—'],
              ['Sub-type', selected.subType ?? '—'],
              ['Invoice', selected.invoiceNumber ?? '—'],
              ['Description', selected.description ?? '—'],
              ['Additional info', selected.additionalInfo ?? '—'],
            ]}
          />
        )}
      </Drawer>
    </DataGate>
  );
}

export const DealerComplaintsPage = () => <ComplaintsPage system="dealer" />;
export const DsComplaintsPage = () => <ComplaintsPage system="ds" />;
