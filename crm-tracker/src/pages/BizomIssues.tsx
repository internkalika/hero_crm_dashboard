import { useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, CircleDot, Clock3, ListChecks, ShieldAlert } from 'lucide-react';
import { useData } from '../state/DataContext';
import { DataGate } from '../components/States';
import { KpiCard, KpiGrid } from '../components/KpiCard';
import { MoreMeasures } from '../components/MoreMeasures';
import { BarsChart, ChartCard, DonutChart, StackedBarsChart, SERIES_COLOR, statusColor } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { Tabs } from '../components/Tabs';
import { describeFilters, useCrossFilter, useUrlValue } from '../components/filters';
import { FilterBar, FilterField, buildOptions } from '../components/FilterBar';
import { Drawer, Facts } from '../components/Drawer';
import { Badge, PageHeader } from '../components/ui';
import type { Col } from '../lib/export/excel';
import { fDate, fInt, fPct } from '../lib/export/format';
import { isOpen, isOverdue, issueKpis, issuesBy } from '../lib/metrics/issues';
import type { IssueRec } from '../lib/types';
import { IssueStatusBadge, monthKeyLabel } from './common';

const DIM_LABELS: Record<string, string> = { status: 'Status', priority: 'Priority', type: 'Type', platform: 'Platform', target: 'Target month', kpi: 'Measure' };
type TabId = 'overview' | 'register';

export default function BizomIssues() {
  const { data, asOf } = useData();
  const cf = useCrossFilter();
  const [tabRaw, setTab] = useUrlValue('tab', 'overview');
  const tab = (['overview', 'register'].includes(tabRaw) ? tabRaw : 'overview') as TabId;
  const [sel, setSel] = useState<IssueRec | null>(null);
  const issues = data.issues;
  const targetMonth = (i: IssueRec) => (i.targetDate ? i.targetDate.slice(0, 7) : i.targetKind === 'none' ? 'No target' : 'Free-text target');

  const filtered = useMemo(() => {
    const f = cf.filters;
    return issues.filter((i) => {
      if (!cf.ok('status', i.status)) return false;
      if (!cf.ok('priority', (i.priority ?? 'None'))) return false;
      if (!cf.ok('type', (i.type ?? 'Not specified'))) return false;
      if (!cf.ok('platform', (i.platform ?? 'Not specified'))) return false;
      if (!cf.ok('target', targetMonth(i))) return false;
      if (cf.has('kpi', 'open') && !isOpen(i)) return false;
      if (cf.has('kpi', 'overdue') && !isOverdue(i, asOf)) return false;
      if (cf.has('kpi', 'p1open') && !(i.priority === 'P1' && isOpen(i))) return false;
      if (cf.has('kpi', 'notarget') && !(isOpen(i) && !i.targetDate)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, cf, asOf]);

  // The filter bar offers what the tracker's own rows contain. "Show" is the same measure filter the cards set.
  const filterFields: FilterField[] = useMemo(() => {
    const shows: Array<[string, string, number]> = [
      ['open', 'Open issues', issues.filter(isOpen).length],
      ['overdue', 'Overdue', issues.filter((i) => isOverdue(i, asOf)).length],
      ['p1open', 'P1 and open', issues.filter((i) => i.priority === 'P1' && isOpen(i)).length],
      ['notarget', 'Open, no target date', issues.filter((i) => isOpen(i) && !i.targetDate).length],
    ];
    return [
      { dim: 'status', label: 'Status', allLabel: 'All statuses', options: buildOptions(issues, (i) => i.status) },
      { dim: 'priority', label: 'Priority', allLabel: 'All priorities', options: buildOptions(issues, (i) => i.priority ?? 'None', { sort: 'label' }) },
      { dim: 'type', label: 'Type', allLabel: 'All types', options: buildOptions(issues, (i) => i.type ?? 'Not specified') },
      { dim: 'platform', label: 'Platform', allLabel: 'All platforms', options: buildOptions(issues, (i) => i.platform ?? 'Not specified') },
      { dim: 'target', label: 'Target month', allLabel: 'Any target', options: buildOptions(issues, targetMonth, { sort: 'value', label: (k) => (/^\d{4}-\d{2}$/.test(k) ? monthKeyLabel(k) : k) }) },
      { dim: 'kpi', label: 'Show', allLabel: 'All issues', options: shows.map(([value, label, count]) => ({ value, label, count })) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, asOf]);

  const k = useMemo(() => issueKpis(filtered, asOf), [filtered, asOf]);
  const byStatus = useMemo(() => issuesBy(filtered, (i) => i.status, asOf), [filtered, asOf]);
  const byPriority = useMemo(() => issuesBy(filtered, (i) => i.priority ?? 'None', asOf).sort((a, b) => a.label.localeCompare(b.label)), [filtered, asOf]);
  const byType = useMemo(() => issuesBy(filtered, (i) => i.type, asOf), [filtered, asOf]);
  const byPlatform = useMemo(() => issuesBy(filtered, (i) => i.platform, asOf), [filtered, asOf]);
  const byTarget = useMemo(() => issuesBy(filtered.filter(isOpen), targetMonth, asOf).sort((a, b) => a.label.localeCompare(b.label)), [filtered, asOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols: Col<IssueRec>[] = [
    { id: 'pointer', header: 'Pointer', value: (i) => i.pointer, width: 340, render: (i) => <span className="line-clamp-2">{i.pointer}</span> },
    { id: 'type', header: 'Type', value: (i) => i.type },
    { id: 'pri', header: 'Priority', value: (i) => i.priority, render: (i) => (i.priority ? <Badge tone={i.priority === 'P1' ? 'bad' : i.priority === 'P2' ? 'warn' : 'neutral'}>{i.priority}</Badge> : <span className="text-ink-3">None</span>) },
    { id: 'platform', header: 'Platform', value: (i) => i.platform },
    { id: 'status', header: 'Status', value: (i) => i.status, render: (i) => <IssueStatusBadge s={i.statusGroup} label={i.status} /> },
    { id: 'target', header: 'Target (as written)', value: (i) => i.targetRaw },
    { id: 'tdate', header: 'Target date', value: (i) => i.targetDate, format: 'date', hidden: true },
    { id: 'overdue', header: 'Overdue', value: (i) => (isOpen(i) ? (isOverdue(i, asOf) ? 'Yes' : i.targetDate ? 'No' : 'Cannot tell') : '—'), render: (i) => (isOpen(i) ? isOverdue(i, asOf) ? <Badge tone="bad">Overdue</Badge> : i.targetDate ? <span className="text-ink-2">No</span> : <span className="text-ink-3">Cannot tell</span> : <span className="text-ink-3">—</span>) },
    { id: 'last', header: 'Latest note', value: (i) => i.lastUpdateText, width: 320, hidden: true },
  ];

  const exportNotes = describeFilters(cf, DIM_LABELS, [`Overdue measured at ${asOf}`, 'The tracker has no created/closed dates or owner column']);
  const toggleKpi = (v: string, lab: string) => cf.toggle('kpi', v, lab);

  return (
    <DataGate need={['issue_tracker']} what="the issue tracker">
      <PageHeader title="Issue Tracker" actions={<Badge tone="neutral" icon={false}>All issues · not period-filtered</Badge>} />
      <FilterBar cf={cf} fields={filterFields} />
      <KpiGrid cols={5}>
        <KpiCard label="Tracked issues" icon={ListChecks} value={fInt(k.total)} sub={`${fInt(k.resolved)} resolved · ${fInt(k.open)} open`} info={{ formula: 'Rows of the issue tracker', exclusions: 'Blank rows and exact duplicates.' }} onClick={() => cf.clear()} active={cf.count === 0} hint="Clears all filters." />
        <KpiCard label="Open issues" icon={CircleDot} value={fInt(k.open)} sub={`${fInt(k.inProgress)} in progress · ${fInt(k.waiting)} waiting`} tone={k.open ? 'warn' : 'good'} info={{ formula: 'Issues whose status is not resolved' }} onClick={() => toggleKpi('open', 'Open')} active={cf.has('kpi', 'open')} />
        <KpiCard label="Overdue" icon={Clock3} value={fInt(k.overdue)} tone={k.overdue ? 'bad' : 'good'} sub={`${fInt(k.dueNext14)} due in the next 14 days`} info={{ formula: `Open issues with a real target date earlier than ${asOf}`, exclusions: 'Free-text targets (“Weekly”, “Ph2”) and blank targets cannot be tested.' }} onClick={() => toggleKpi('overdue', 'Overdue')} active={cf.has('kpi', 'overdue')} />
        <KpiCard label="P1 issues open" icon={ShieldAlert} value={fInt(k.p1Open)} tone={k.p1Open ? 'warn' : 'good'} sub={`of ${fInt(k.p1Total)} P1 · ${fInt(k.p1Overdue)} overdue`} info={{ formula: 'Open issues with priority P1', exclusions: 'Priority is P1–P3 only; “Completed/Ongoing” entries in the priority column have no priority.' }} onClick={() => toggleKpi('p1open', 'P1 open')} active={cf.has('kpi', 'p1open')} />
        <KpiCard label="Resolution rate" icon={CheckCircle2} value={fPct(k.resolutionRate)} sub="resolved ÷ tracked" tone="good" info={{ formula: 'Issues with status Completed/Resolved ÷ all issues', exclusions: 'The tracker has no created or closed dates, so time to resolve cannot be calculated.' }} onClick={() => cf.toggle('status', 'Completed', 'Completed')} active={cf.has('status', 'Completed')} />
      </KpiGrid>
      <MoreMeasures>
        <KpiCard compact label="Open without a usable target" icon={AlertOctagon} value={fInt(k.targetUnknownOpen)} info={{ formula: 'Open issues whose target is blank or free text' }} onClick={() => toggleKpi('notarget', 'No usable target')} active={cf.has('kpi', 'notarget')} />
        <KpiCard compact label="Without a priority" icon={ListChecks} value={fInt(k.noPriority)} info={{ formula: 'Issues with no P1/P2/P3 value' }} />
        <KpiCard compact label="Status not recognised" icon={AlertOctagon} value={fInt(k.unmapped)} tone={k.unmapped ? 'warn' : 'neutral'} info={{ formula: 'Statuses not in the status map are kept as written and are never guessed to be open or resolved' }} />
      </MoreMeasures>

      <div className="mt-5" />
      <Tabs<TabId>
        label="Issue tracker"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'register', label: 'Issue register', badge: fInt(filtered.length) },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Issues by status" subtitle="Click a status to filter." table={{ columns: [{ header: 'Status' }, { header: 'Issues', format: 'int' }], rows: byStatus.map((g) => [g.label, g.total]) }}>
            <DonutChart centerValue={fInt(k.total)} centerLabel="issues" activeKey={cf.filters.status} onSelect={(key, lab) => cf.toggle('status', key, lab)} data={byStatus.map((g, i) => ({ key: g.key, label: g.label, value: g.total, color: statusColor(g.label, i) }))} />
          </ChartCard>
          <ChartCard title="Open and resolved by platform" subtitle="The tracker has no department column, so issues are grouped by platform. Click a bar to filter." table={{ columns: [{ header: 'Platform' }, { header: 'Issues', format: 'int' }, { header: 'Open', format: 'int' }, { header: 'Resolved', format: 'int' }], rows: byPlatform.map((g) => [g.label, g.total, g.open, g.resolved]) }}>
            <StackedBarsChart layout="horizontal" data={byPlatform.map((g) => ({ key: g.key, label: g.label, resolved: g.resolved, open: g.open }))} series={[{ key: 'resolved', label: 'Resolved', color: '#1baf7a' }, { key: 'open', label: 'Open', color: '#C8202F' }]} onSelect={(_s, key) => cf.toggle('platform', key)} />
          </ChartCard>
          <ChartCard title="Open and resolved by priority" subtitle="Click a bar to filter by priority." table={{ columns: [{ header: 'Priority' }, { header: 'Open', format: 'int' }, { header: 'Resolved', format: 'int' }, { header: 'Overdue', format: 'int' }], rows: byPriority.map((g) => [g.label, g.open, g.resolved, g.overdue]) }}>
            <StackedBarsChart data={byPriority.map((g) => ({ key: g.key, label: g.label, open: g.open, resolved: g.resolved }))} series={[{ key: 'resolved', label: 'Resolved', color: '#1baf7a' }, { key: 'open', label: 'Open', color: '#C8202F' }]} onSelect={(_s, key) => cf.toggle('priority', key)} />
          </ChartCard>
          <ChartCard title="Issues by type" subtitle="Click a bar to filter." table={{ columns: [{ header: 'Type' }, { header: 'Issues', format: 'int' }, { header: 'Open', format: 'int' }], rows: byType.map((g) => [g.label, g.total, g.open]) }}>
            <BarsChart color={SERIES_COLOR.bizom} seriesName="Issues" activeKey={cf.filters.type} onSelect={(key) => cf.toggle('type', key)} data={byType.map((g) => ({ key: g.key, label: g.label, value: g.total }))} />
          </ChartCard>
          <ChartCard title="Open issues by target month" subtitle="When open issues are due. “Free-text target” and “No target” cannot be dated." table={{ columns: [{ header: 'Target month' }, { header: 'Open issues', format: 'int' }, { header: 'Overdue', format: 'int' }], rows: byTarget.map((g) => [/^\d{4}-\d{2}$/.test(g.label) ? monthKeyLabel(g.label) : g.label, g.open, g.overdue]) }}>
            <BarsChart layout="vertical" color={SERIES_COLOR.bizom} seriesName="Open issues" activeKey={cf.filters.target} onSelect={(key) => cf.toggle('target', key)} data={byTarget.map((g) => ({ key: g.key, label: /^\d{4}-\d{2}$/.test(g.label) ? monthKeyLabel(g.label) : g.label, value: g.open }))} />
          </ChartCard>
        </div>
      )}

      {tab === 'register' && <DataTable title="Issue register" rows={filtered} columns={cols} getRowId={(i) => i.key} fullRows={issues} exportName="Issue_tracker" exportNotes={exportNotes} onRowClick={setSel} selectedId={sel?.key} initialSort={{ id: 'pri' }} searchPlaceholder="Search issues…" />}

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.pointer.slice(0, 90) ?? ''}>
        {sel && (
          <div className="space-y-4">
            <Facts
              items={[
                ['Status', <IssueStatusBadge key="s" s={sel.statusGroup} label={sel.status} />],
                ['Priority', sel.priority ?? `None${sel.priorityRaw ? ` (column says “${sel.priorityRaw}”)` : ''}`],
                ['Type', sel.type ?? '—'],
                ['Platform', sel.platform ?? '—'],
                ['Target as written', sel.targetRaw ?? '—'],
                ['Target date', sel.targetDate ? fDate(sel.targetDate) : `Not a date (${sel.targetKind})`],
                ['Overdue', isOpen(sel) ? (isOverdue(sel, asOf) ? 'Yes' : sel.targetDate ? 'No' : 'Cannot tell') : 'Resolved'],
              ]}
            />
            <div>
              <h3 className="mb-1 text-sm font-semibold">Pointer</h3>
              <p className="whitespace-pre-wrap text-sm text-ink-2">{sel.pointer}</p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Updates</h3>
              {sel.updates.length === 0 ? (
                <p className="text-sm text-ink-3">No update notes.</p>
              ) : (
                <ol className="space-y-2 border-l-2 border-slate-200 pl-3">
                  {sel.updates.map((u, i) => (
                    <li key={i}>
                      <div className="text-xs font-medium text-ink-2">{u.date ? fDate(u.date) : u.label}</div>
                      <div className="whitespace-pre-wrap text-sm">{u.text}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </DataGate>
  );
}
