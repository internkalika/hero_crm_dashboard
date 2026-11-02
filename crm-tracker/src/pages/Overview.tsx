import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, ArrowDownRight, ArrowUpRight, BarChart3, ClipboardList, Coins, DatabaseZap, Headset, Layers, ListChecks, MousePointerClick, Receipt, Scale, ScrollText, ShoppingCart, Smile, Sparkles, Store, Trophy, Users, type LucideIcon } from 'lucide-react';
import { useData } from '../state/DataContext';
import { EmptyState } from '../components/States';
import { KpiCard, KpiGrid, KpiTrend } from '../components/KpiCard';
import { MiniGrid, MiniTile, SystemColumn, SystemTile, WideTile } from '../components/SystemTiles';
import { BarsChart, ChartCard, DonutChart, SERIES_COLOR, StackedBarsChart, TrendChart, statusColor } from '../components/charts';
import { Tabs } from '../components/Tabs';
import { describeFilters, useCrossFilter, useDealerProfile, useUrlValue } from '../components/filters';
import { FilterBar, FilterField } from '../components/FilterBar';
import { DownloadMenu } from '../components/DownloadMenu';
import { downloadXlsx, stamp } from '../lib/export/excel';
import { briefSheets, figuresSheet, FigureRow } from '../lib/export/executive';
import { PageHeader, SectionTitle } from '../components/ui';
import { fDate, fDec, fInr, fInrCompact, fInt, fPct } from '../lib/export/format';
import { buildDealerOrders, dsOrderSummaries, groupOrders, orderKpis, STATUS_LABELS } from '../lib/metrics/orders';
import { mbdOfOrders } from '../lib/metrics/models';
import { dateInPeriod } from '../lib/metrics/period';
import { COMPLAINT_STATUS_LABELS, complaintKpis, complaintsByMonth, countBy, filterComplaints, splitTestComplaints } from '../lib/metrics/complaints';
import { filterUsage, reportRanking, splitTest, usageByMonth, usageKpis } from '../lib/metrics/bizom';
import { issueKpis, issuesBy, isOpen } from '../lib/metrics/issues';
import { employeeKpis, filterEmployees } from '../lib/metrics/employees';
import { activeDealers, dealerKeyOfOrder, loyaltyOverview, orderTrend, ordersByMonth, usageTrend } from '../lib/metrics/overview';
import { KeyInsight, InsightIcon, keyInsights } from '../lib/metrics/keyInsights';
import { buildComparison } from '../lib/metrics/comparison';
import { buildGrowth } from '../lib/metrics/growth';
import { buildServiceFacts, executiveBrief } from '../lib/metrics/executive';
import { inspectProfitability } from '../lib/metrics/profitability';
import { ActionChips, Signals } from './overview/Brief';
import { dealerChoices, scopeToDealer } from '../lib/metrics/scope';
import { Change } from '../lib/metrics/windows';
import { isValidatedDealerKey, pageLink } from '../lib/nav/links';
import { monthKeyLabel, periodNote } from './common';
import { monthLabel, titleCase } from '../lib/util/parse';
import type { OrderStatusGroup } from '../lib/types';

type SysTab = 'dealer' | 'ds' | 'bizom' | 'loyalty';

const INSIGHT_ICON: Record<InsightIcon, LucideIcon> = { trophy: Trophy, orders: ShoppingCart, change: BarChart3, report: MousePointerClick, backlog: ListChecks, complaint: Headset, dealers: ArrowLeftRight, points: Smile };

const trendOf = (c: Change | null | undefined, vs: string): KpiTrend | undefined => (c && c.pct !== null ? { text: `${fPct(Math.abs(c.pct))} vs ${vs}`, dir: c.pct > 0.0005 ? 'up' : c.pct < -0.0005 ? 'down' : 'flat', good: true } : undefined);
const nice = (s: string) => titleCase(s.toLowerCase());
const NOT_PER_DEALER = 'Bizom usage is not recorded per dealer';
const NOT_PER_DEALER_ISSUES = 'The issue tracker has no dealer column';

/** The colour of the system a finding is about (a rail, a dot and the share bar; text always stays in ink). */
const TAG_COLOR: Record<string, string> = {
  'Dealer App': SERIES_COLOR.dealer,
  DataSense: SERIES_COLOR.ds,
  'Bizom SFA': SERIES_COLOR.bizom,
  'Issue Tracker': '#52514E',
  'Hero Smiles': '#eda100',
  Both: '#6250d6',
};
const tagColor = (tag: string) => TAG_COLOR[tag] ?? '#898781';

function InsightCard({ insight }: { insight: KeyInsight }) {
  const Icon = INSIGHT_ICON[insight.icon];
  return (
    <section className="card overflow-hidden" aria-label={insight.title}>
      <header className="flex items-center gap-2 border-b border-slate-100 bg-surface-2 px-4 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-hero-700 shadow-card" aria-hidden>
          <Icon size={16} />
        </span>
        <h3 className="text-sm font-semibold leading-tight">{insight.title}</h3>
      </header>
      <ul className="divide-y divide-slate-100">
        {insight.rows.map((r) => {
          const color = tagColor(r.tag);
          const statCls = r.dir === 'up' ? 'text-good-text' : r.dir === 'down' ? 'text-bad-text' : 'text-ink';
          const Arrow = r.dir === 'up' ? ArrowUpRight : r.dir === 'down' ? ArrowDownRight : null;
          return (
            <li key={`${r.tag}-${r.text}`}>
              <Link to={r.to} title={r.sub} className="group block px-4 py-3 transition-colors hover:bg-hero-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hero-600" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
                <div className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="mb-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-ink-2">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
                      {r.tag}
                    </span>
                    <span className="block text-sm font-semibold leading-snug text-ink group-hover:text-hero-700">{r.text}</span>
                  </span>
                  {r.stat && (
                    <span className="shrink-0 text-right">
                      <span className={`tnum flex items-center justify-end gap-0.5 whitespace-nowrap text-lg font-bold leading-tight ${statCls}`}>
                        {Arrow && <Arrow size={16} aria-label={r.dir === 'up' ? 'Up' : 'Down'} role="img" />}
                        {r.stat}
                      </span>
                      {r.unit && <span className="block text-[11px] leading-tight text-ink-3">{r.unit}</span>}
                    </span>
                  )}
                </div>
                {r.share !== undefined && (
                  <div className="mt-2.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={r.shareLabel ?? `${fPct(r.share, 0)}`}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, r.share * 100))}%`, background: color }} />
                    </div>
                    {r.shareLabel && <span className="mt-1 block text-[11px] leading-tight text-ink-3">{r.shareLabel}</span>}
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Overview() {
  const { data: fullData, loading, period, settings, crosswalk, asOf, focusMonth } = useData();
  const nav = useNavigate();
  const cf = useCrossFilter();
  const { open: openProfile } = useDealerProfile();
  // The dealer filter narrows every dealer-level figure on this page to one validated ERP dealer code.
  const choices = useMemo(() => dealerChoices(fullData), [fullData]);
  const dealerKeys = useMemo(() => (cf.filters.dealer ?? []).filter((k) => choices.some((c) => c.key === k)), [cf.filters.dealer, choices]);
  const dealerLabels = dealerKeys.map((k) => choices.find((c) => c.key === k)?.label ?? k);
  // one dealer keeps its own name in notes and links; several are described by their number
  const dealerKey = dealerKeys.length === 1 ? dealerKeys[0] : null;
  const dealerLabel = dealerKeys.length === 1 ? dealerLabels[0] : dealerKeys.length > 1 ? `${dealerKeys.length} dealers` : null;
  const data = useMemo(() => scopeToDealer(fullData, dealerKeys), [fullData, dealerKeys]);
  const notPerDealer = dealerKeys.length > 0;
  const filterFields: FilterField[] = useMemo(() => [{ dim: 'dealer', label: 'Dealer', allLabel: 'All dealers', search: true, options: choices.map((c) => ({ value: c.key, label: c.label })) }], [choices]);
  const [tabRaw, setTab] = useUrlValue('sys', 'dealer');
  const [showAllInsights, setShowAllInsights] = useState(false);
  const [showAllSignals, setShowAllSignals] = useState(false);

  const has = (s: string) => data.datasets.some((d) => d.source === s);
  const hasDealer = has('dealer_orders');
  const hasDs = has('ds_orders');
  const hasUsage = has('bizom_usage');
  const hasIssues = has('issue_tracker');
  const hasDealerC = has('dealer_complaints');
  const hasDsC = has('ds_complaints');
  const hasEmp = has('ds_employee_activity');

  // ---- orders
  const dealerAll = useMemo(() => buildDealerOrders(data.dealerLines), [data.dealerLines]);
  const dsAll = useMemo(() => dsOrderSummaries(data.dsOrders), [data.dsOrders]);
  const dealerOrders = useMemo(() => dealerAll.filter((o) => dateInPeriod(o.date, period)), [dealerAll, period]);
  const dsOrders = useMemo(() => dsAll.filter((o) => dateInPeriod(o.date, period)), [dsAll, period]);
  const dk = useMemo(() => orderKpis(dealerOrders, settings, 'dealer'), [dealerOrders, settings]);
  // models billed per dealer over the same eligible orders as the cards beside it
  const dMbd = useMemo(() => mbdOfOrders(data.dealerLines, dealerOrders, settings), [data.dealerLines, dealerOrders, settings]);
  const sk = useMemo(() => orderKpis(dsOrders, settings, 'ds'), [dsOrders, settings]);
  const dTrend = useMemo(() => orderTrend(dealerAll, 'dealer', period, settings, data, asOf), [dealerAll, period, settings, data, asOf]);
  const sTrend = useMemo(() => orderTrend(dsAll, 'ds', period, settings, data, asOf), [dsAll, period, settings, data, asOf]);
  const dMonthly = useMemo(() => ordersByMonth(dealerOrders, 'dealer', settings), [dealerOrders, settings]);
  const sMonthly = useMemo(() => ordersByMonth(dsOrders, 'ds', settings), [dsOrders, settings]);
  const active = useMemo(() => activeDealers(dealerOrders, dsOrders, settings), [dealerOrders, dsOrders, settings]);

  // ---- complaints
  const dealerC = useMemo(() => splitTestComplaints(filterComplaints(data.dealerComplaints, period), settings.includeTestAccounts).kept, [data.dealerComplaints, period, settings.includeTestAccounts]);
  const dsC = useMemo(() => splitTestComplaints(filterComplaints(data.dsComplaints, period), settings.includeTestAccounts).kept, [data.dsComplaints, period, settings.includeTestAccounts]);
  const dealerCk = useMemo(() => complaintKpis(dealerC, asOf), [dealerC, asOf]);
  const dsCk = useMemo(() => complaintKpis(dsC, asOf), [dsC, asOf]);

  // ---- Bizom
  const allUsage = useMemo(() => splitTest(data.usage, settings.includeTestAccounts).kept, [data.usage, settings.includeTestAccounts]);
  const usage = useMemo(() => splitTest(filterUsage(data.usage, period), settings.includeTestAccounts).kept, [data.usage, period, settings.includeTestAccounts]);
  const uk = useMemo(() => usageKpis(usage, settings.lowUsageThreshold), [usage, settings.lowUsageThreshold]);
  const uTrend = useMemo(() => usageTrend(allUsage, period, data, asOf), [allUsage, period, data, asOf]);
  const usageMonthly = useMemo(() => usageByMonth(usage), [usage]);
  const reports = useMemo(() => reportRanking(usage), [usage]);
  const ik = useMemo(() => issueKpis(data.issues, asOf), [data.issues, asOf]);
  const issueStatus = useMemo(() => issuesBy(data.issues, (i) => i.status, asOf), [data.issues, asOf]);
  const issuePlatform = useMemo(() => issuesBy(data.issues.filter(isOpen), (i) => i.platform, asOf).sort((a, b) => b.open - a.open), [data.issues, asOf]);

  // ---- DataSense field staff
  const emp = useMemo(() => filterEmployees(data.dsEmployees, period, settings.includeTestAccounts).kept, [data.dsEmployees, period, settings.includeTestAccounts]);
  const ek = useMemo(() => employeeKpis(emp), [emp]);

  // ---- Hero Smiles
  const loy = useMemo(() => loyaltyOverview(data), [data]);

  const insights = useMemo(() => keyInsights(data, period, settings, crosswalk, asOf), [data, period, settings, crosswalk, asOf]);
  // dealers that have placed a Dealer App order of any status: a dealer whose orders were all rejected has still started using the app
  const appDealers = useMemo(() => new Set(dealerOrders.map((o) => o.dealerKey).filter(Boolean)).size, [dealerOrders]);
  const cmp = useMemo(() => {
    if (!hasDealer || !hasDs) return null;
    const c = buildComparison(data, period, settings, crosswalk);
    return c.months.length ? c : null;
  }, [data, period, settings, crosswalk, hasDealer, hasDs]);

  // ---- management brief: the same growth model the first page shows, so the two pages cannot disagree
  const [qs] = useSearchParams();
  const rpParam = qs.get('rp') ?? '';
  const cpParam = qs.get('cp') ?? 'prev';
  const brief = useMemo(() => {
    const input = { rp: rpParam, cp: cpParam, dealers: dealerKeys };
    const pilot = buildGrowth(fullData, settings, dealerKeys.length ? { ...input, cohort: 'all' } : input);
    if (!pilot) return null;
    const all = dealerKeys.length ? null : buildGrowth(fullData, settings, { ...input, cohort: 'all' });
    return executiveBrief({
      pilot,
      all,
      profit: inspectProfitability(fullData),
      service: buildServiceFacts({ data, settings, period, asOf, scoped: notPerDealer }),
    });
  }, [fullData, data, settings, period, asOf, dealerKeys, rpParam, cpParam, notPerDealer]);

  // top dealers per system
  const topDealers = (orders: typeof dealerOrders, by: 'value' | 'orders') =>
    groupOrders(orders, settings, dealerKeyOfOrder, (_k, rs) => rs[0].dealerName || rs[0].dealerKey || 'Unnamed dealer')
      .filter((r) => r.orders > 0)
      .sort((a, b) => (by === 'value' ? b.value - a.value : b.orders - a.orders || b.value - a.value))
      .slice(0, 10);
  const dTopValue = useMemo(() => topDealers(dealerOrders, 'value'), [dealerOrders, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const dTopCount = useMemo(() => topDealers(dealerOrders, 'orders'), [dealerOrders, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const sTopValue = useMemo(() => topDealers(dsOrders, 'value'), [dsOrders, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const sTopCount = useMemo(() => topDealers(dsOrders, 'orders'), [dsOrders, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusRows = (orders: typeof dealerOrders) => {
    const m = new Map<OrderStatusGroup, number>();
    orders.forEach((o) => m.set(o.statusGroup, (m.get(o.statusGroup) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const dStatus = useMemo(() => statusRows(dealerOrders), [dealerOrders]);
  const sStatus = useMemo(() => statusRows(dsOrders), [dsOrders]);
  const dDept = useMemo(() => countBy(dealerC, (c) => c.department ?? 'Not specified').slice(0, 8), [dealerC]);
  const sMonthlyC = useMemo(() => complaintsByMonth(dsC), [dsC]);

  if (loading && !data.datasets.length) return <div className="p-6 text-ink-2">Loading saved data…</div>;
  if (!data.datasets.length) {
    return (
      <div>
        <PageHeader title="Overall Summary" />
        <EmptyState icon={<DatabaseZap size={36} />} title="No data has been imported yet" action={<Link to="/import" className="btn btn-primary mt-2">Import the MIS files</Link>}>
          Import the monthly CRM MIS files (a ZIP, a folder or individual CSV/Excel files) and every page fills in from them. All calculation happens in this browser.
        </EmptyState>
      </div>
    );
  }

  // A link to a dealer-level page carries the dealer filter, so the page opens on the same dealer.
  const DEALER_DIM: Record<string, string> = { '/': 'dealer', '/dealer/orders': 'dealer', '/datasense/orders': 'dealer', '/dealer/complaints': 'dealer', '/datasense/complaints': 'dealer', '/hero-smiles': 'member' };
  const withDealer = (target: string) => {
    const [path, q = ''] = target.split('?');
    const dim = DEALER_DIM[path];
    if (!dealerKeys.length || !dim) return target;
    const params = new URLSearchParams(q);
    if (!params.has(`f.${dim}`)) {
      dealerKeys.forEach((k, i) => {
        params.append(`f.${dim}`, k);
        params.append(`l.${dim}`, dealerLabels[i] ?? k);
      });
    }
    if (path === '/hero-smiles' && !params.has('tab')) params.set('tab', 'members');
    return `${path}?${params.toString()}`;
  };
  const goTo = (to: string) => nav(withDealer(to));
  const go = (to: string) => () => goTo(to);
  const missing = (what: string) => `${what} not imported`;
  const sysAvail: Record<SysTab, boolean> = { dealer: hasDealer || hasDealerC, ds: hasDs || hasDsC || hasEmp, bizom: (hasUsage || hasIssues) && !notPerDealer, loyalty: !!loy };
  const tabs = ([
    { id: 'dealer', label: 'Dealer App' },
    { id: 'ds', label: 'DataSense SFA' },
    { id: 'bizom', label: 'Bizom SFA' },
    { id: 'loyalty', label: 'Hero Smiles' },
  ] as Array<{ id: SysTab; label: string }>).filter((t) => sysAvail[t.id]);
  const tab: SysTab = tabs.some((t) => t.id === tabRaw) ? (tabRaw as SysTab) : tabs[0]?.id ?? 'dealer';

  const complaintsTotal = (hasDealerC ? dealerCk.total : 0) + (hasDsC ? dsCk.total : 0);
  const complaintsOpen = (hasDealerC ? dealerCk.backlog : 0) + (hasDsC ? dsCk.backlog : 0);
  const complaintMenu = [
    ...(hasDealerC ? [{ label: `Dealer App complaints (${fInt(dealerCk.total)})`, onClick: go('/dealer/complaints') }] : []),
    ...(hasDsC ? [{ label: `DataSense complaints (${fInt(dsCk.total)})`, onClick: go('/datasense/complaints') }] : []),
  ];

  const dealerClick = (path: string) => (key: string, label: string) => (isValidatedDealerKey(key) ? openProfile(key, 'overview') : goTo(pageLink(path, { dealer: [key, label] })));
  const monthClick = (key: string) => focusMonth(key);
  const singleMonth = /^\d{4}-\d{2}$/.test(period.id) ? period.id : null;

  const downloadSummary = async () => {
    const basis = periodNote(period);
    const R = (system: string, measure: string, value: number | null, unit: string, b = basis): FigureRow => ({ system, measure, value: value === null ? null : Math.round(value * 100) / 100, unit, basis: b });
    const pc = (v: number | null) => (v === null ? null : v * 100);
    const rows: FigureRow[] = [
      ...(hasDealer ? [R('Dealer App', 'Order value', dk.eligibleValue, '₹'), R('Dealer App', 'Orders', dk.eligible, 'orders'), R('Dealer App', 'Average order value', dk.aov, '₹ per order'), R('Dealer App', 'Average selling price', dk.asp, '₹ per cycle'), R('Dealer App', 'Cycles ordered', dk.qty, 'cycles'), R('Dealer App', 'Fulfilment rate', pc(dk.fulfilmentRate), '% of quantity'), R('Dealer App', 'Rejection rate', pc(dk.rejectionRate), '% of valid orders'), R('Dealer App', 'Dealers on the app', appDealers, 'dealers'), R('Dealer App', 'Models billed per dealer (MBD)', dMbd.mbd, 'models per dealer')] : []),
      ...(hasDealerC ? [R('Dealer App', 'Complaints raised', dealerCk.total, 'complaints'), R('Dealer App', 'Complaints not closed', dealerCk.backlog, 'complaints')] : []),
      ...(hasDs ? [R('DataSense', 'Order value', sk.eligibleValue, '₹'), R('DataSense', 'Orders', sk.eligible, 'orders'), R('DataSense', 'Average order value', sk.aov, '₹ per order'), R('DataSense', 'Average selling price', sk.asp, '₹ per cycle'), R('DataSense', 'Cycles ordered', sk.qty, 'cycles'), R('DataSense', 'Billed rate', pc(sk.billedRate), '% of orders (by status)'), R('DataSense', 'Rejection rate', pc(sk.rejectionRate), '% of valid orders'), R('DataSense', 'Active dealers', sk.activeDealers, 'dealers')] : []),
      ...(hasDsC ? [R('DataSense', 'Complaints raised', dsCk.total, 'complaints'), R('DataSense', 'Complaints not closed', dsCk.backlog, 'complaints')] : []),
      ...(hasUsage && !notPerDealer ? [R('Bizom SFA', 'Report accesses', uk.accesses, 'accesses'), R('Bizom SFA', 'Active users', uk.users, 'users'), R('Bizom SFA', 'Reports used', uk.reports, 'reports')] : []),
      ...(hasIssues && !notPerDealer ? [R('Issue Tracker', 'Tracked issues', ik.total, 'issues', 'Point in time'), R('Issue Tracker', 'Open issues', ik.open, 'issues', 'Point in time'), R('Issue Tracker', 'Overdue issues', ik.overdue, 'issues', `As of ${asOf}`), R('Issue Tracker', 'P1 issues still open', ik.p1Open, 'issues', 'Point in time')] : []),
      ...(loy ? [R('Hero Smiles', 'Current points', loy.latestTotals.current, 'points', `Snapshot of ${loy.latest.date} (a balance, never added across snapshots)`), R('Hero Smiles', 'Dealers with a balance', loy.latestTotals.positiveBalances, 'dealers', `Snapshot of ${loy.latest.date}`)] : []),
    ];
    const notes = describeFilters(cf, { dealer: 'Dealer' }, [
      `Figures by system: ${basis}`,
      brief ? `Management signals, risks and actions: ${brief.period} (the periods of the Dealer App vs DataSense SFA page; open it to change them)` : 'No management brief: no dated orders were imported',
      dealerKeys.length ? 'Bizom usage and the Issue Tracker are not recorded per dealer and are left out while a dealer is selected.' : 'All dealers.',
      'Order value is sales value, never profit: the imported files contain no cost data.',
    ]);
    await downloadXlsx([...(brief ? briefSheets(brief) : []), figuresSheet(rows)], { title: 'CRM Tracker – Overall Summary', notes }, `Overall_Summary_${stamp()}`);
  };

  const signals = brief ? [...brief.takeaways, ...brief.risks].filter((s) => s.id !== 'profit' && s.id !== 'r-profit') : [];
  const rankData = (rows: ReturnType<typeof topDealers>, by: 'value' | 'orders') => rows.map((r) => ({ key: r.key, label: nice(r.label), value: by === 'value' ? r.value : r.orders }));

  return (
    <div>
      <PageHeader title="Overall Summary" actions={<DownloadMenu label="Download" items={[{ label: 'Overall summary: signals, risks, actions and figures (Excel)', run: downloadSummary }]} />} />
      <FilterBar cf={cf} fields={filterFields} />

      {brief && signals.length > 0 && (
        <section aria-label="Signals">
          <SectionTitle
            right={
              <button type="button" onClick={go('/')} className="text-xs font-semibold text-hero-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600">
                {brief.period} · change periods
              </button>
            }
          >
            Signals
          </SectionTitle>
          <Signals items={showAllSignals ? signals : signals.slice(0, 8)} onGo={goTo} />
          {signals.length > 8 && (
            <div className="mt-2">
              <button className="btn btn-ghost btn-sm text-hero-700" onClick={() => setShowAllSignals((v) => !v)} aria-expanded={showAllSignals}>
                {showAllSignals ? 'Show fewer' : `Show all ${signals.length}`}
              </button>
            </div>
          )}
        </section>
      )}

      <SectionTitle>Where each system stands</SectionTitle>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <SystemColumn label="DataSense SFA">
          <SystemTile
            accent={SERIES_COLOR.ds}
            name="DataSense SFA"
            icon={Store}
            label="Order value"
            value={fInrCompact(sk.eligibleValue)}
            sub={`${fInt(sk.eligible)} orders · ${fInt(sk.activeDealers)} dealers`}
            trend={trendOf(sTrend?.value, sTrend?.vs ?? '')}
            unavailable={hasDs ? undefined : missing('DataSense orders')}
            onClick={go(hasDs ? '/datasense/orders' : '/import')}
            hint="Opens DataSense orders."
            info={{ formula: 'Σ “value of Order” over eligible orders', exclusions: 'Rejected orders, zero-value orders and the report’s footer total row.' }}
          />
          <MiniGrid>
            <MiniTile accent={SERIES_COLOR.ds} label="Orders" value={fInt(sk.eligible)} sub={`${fInt(sk.qty)} cycles`} trend={trendOf(sTrend?.orders, sTrend?.vs ?? '')} unavailable={hasDs ? undefined : 'Not imported'} onClick={go('/datasense/orders')} hint="Opens DataSense orders." info={{ formula: 'Order rows with value > 0 and status not rejected' }} />
            <MiniTile accent={SERIES_COLOR.ds} label="Avg order value" value={fInr(sk.aov)} sub={sk.asp !== null ? `${fInr(sk.asp)} per cycle` : undefined} trend={trendOf(sTrend?.aov, sTrend?.vs ?? '')} unavailable={hasDs ? undefined : 'Not imported'} onClick={go('/datasense/orders')} hint="Opens DataSense orders." info={{ formula: 'Order value ÷ eligible orders', exclusions: 'Not weighted by dealer.' }} />
            <MiniTile accent={SERIES_COLOR.ds} label="Active dealers" value={fInt(sk.activeDealers)} sub={cmp ? `${fInt(cmp.counts.common)} also order via Dealer App` : undefined} unavailable={hasDs ? undefined : 'Not imported'} onClick={go(cmp ? pageLink('/', {}, { scope: 'common', show: 'table' }) : '/datasense/orders')} hint={cmp ? 'Opens the dealers that placed orders through both systems.' : 'Opens DataSense orders.'} info={{ formula: 'Distinct dealers with at least one eligible DataSense order', exclusions: 'Rejected and zero-value orders.' }} />
            <MiniTile accent={SERIES_COLOR.ds} label="Complaints open" value={fInt(dsCk.backlog)} sub={`of ${fInt(dsCk.total)} raised`} tone={dsCk.over30 ? 'warn' : 'neutral'} unavailable={hasDsC ? undefined : 'Not imported'} onClick={() => goTo(hasDsC ? pageLink('/datasense/complaints', { kpi: ['backlog', 'Not yet closed'] }) : '/import')} hint="Shows the complaints not yet closed." info={{ formula: 'DataSense complaints whose status is not closed or rejected', exclusions: 'Test records.' }} />
          </MiniGrid>
        </SystemColumn>

        <SystemColumn label="Dealer App">
          <SystemTile
            accent={SERIES_COLOR.dealer}
            name="Dealer App"
            icon={ShoppingCart}
            label="Order value"
            value={fInrCompact(dk.eligibleValue)}
            sub={`${fInt(dk.eligible)} orders · ${fInt(appDealers)} dealers`}
            trend={trendOf(dTrend?.value, dTrend?.vs ?? '')}
            unavailable={hasDealer ? undefined : missing('Dealer App orders')}
            onClick={go(hasDealer ? '/dealer/orders' : '/import')}
            hint="Opens Dealer App orders."
            info={{ formula: 'Σ line Amount over eligible orders (one order per Order ID)', exclusions: 'Rejected orders, zero-value orders, duplicate lines.' }}
          />
          <MiniGrid>
            <MiniTile accent={SERIES_COLOR.dealer} label="Orders" value={fInt(dk.eligible)} sub={`${fInt(dk.qty)} cycles`} trend={trendOf(dTrend?.orders, dTrend?.vs ?? '')} unavailable={hasDealer ? undefined : 'Not imported'} onClick={go('/dealer/orders')} hint="Opens Dealer App orders." info={{ formula: 'Distinct Order_ID with value > 0 and status not rejected', exclusions: 'SKU lines are never counted as orders.' }} />
            <MiniTile accent={SERIES_COLOR.dealer} label="Avg order value" value={fInr(dk.aov)} sub={dk.asp !== null ? `${fInr(dk.asp)} per cycle` : undefined} trend={trendOf(dTrend?.aov, dTrend?.vs ?? '')} unavailable={hasDealer ? undefined : 'Not imported'} onClick={go('/dealer/orders')} hint="Opens Dealer App orders." info={{ formula: 'Order value ÷ eligible orders', exclusions: 'Not weighted by dealer.' }} />
            <MiniTile accent={SERIES_COLOR.dealer} label="Dealers on app" value={fInt(appDealers)} sub={cmp ? `${fInt(cmp.counts.common)} also order via DataSense` : undefined} unavailable={hasDealer ? undefined : 'Not imported'} onClick={go(cmp ? pageLink('/', {}, { scope: 'common', show: 'table' }) : '/dealer/orders')} hint={cmp ? 'Opens the dealers that placed orders through both systems.' : 'Opens Dealer App orders.'} info={{ formula: 'Distinct dealers with at least one Dealer App order of any status in the period', exclusions: 'A dealer whose orders were all rejected still counts as having started to use the app. Matching to DataSense uses the ERP dealer code only.' }} />
            <MiniTile accent={SERIES_COLOR.dealer} label="Complaints open" value={fInt(dealerCk.backlog)} sub={`of ${fInt(dealerCk.total)} raised`} tone={dealerCk.over30 ? 'warn' : 'neutral'} unavailable={hasDealerC ? undefined : 'Not imported'} onClick={() => goTo(hasDealerC ? pageLink('/dealer/complaints', { kpi: ['backlog', 'Not yet closed'] }) : '/import')} hint="Shows the complaints not yet closed." info={{ formula: 'Dealer App complaints whose status is not closed or rejected', exclusions: 'Test records.' }} />
            <div className="col-span-2">
              <MiniTile accent={SERIES_COLOR.dealer} label="Models billed per dealer (MBD)" value={fDec(dMbd.mbd, 1)} sub={`${fInt(dMbd.models)} ${dMbd.models === 1 ? 'model' : 'models'} billed · ${fInt(dMbd.billedDealers)} of ${fInt(dMbd.dealers)} ${dMbd.dealers === 1 ? 'dealer' : 'dealers'} billed`} unavailable={hasDealer ? undefined : 'Not imported'} onClick={go(pageLink('/dealer/orders', {}, { tab: 'models' }))} hint="Shows which models each dealer was billed for." info={{ formula: 'For each dealer, the distinct models (Sku_Brand) with at least one billed line; the dealers’ counts added up ÷ dealers with an eligible order', source: 'Billed = Invoice_Id present and Fulfilled_Quantity above zero. A model is the Sku_Brand recorded by the Dealer App.', exclusions: 'Rejected and zero-value orders; models ordered but not billed.' }} />
            </div>
          </MiniGrid>
        </SystemColumn>

        <SystemColumn label="Bizom SFA">
          <SystemTile
            accent={SERIES_COLOR.bizom}
            name="Bizom SFA"
            icon={MousePointerClick}
            label="Report accesses"
            value={fInt(uk.accesses)}
            sub={`${fInt(uk.users)} users · ${fInt(uk.reports)} reports`}
            trend={trendOf(uTrend?.accesses, uTrend?.vs ?? '')}
            unavailable={notPerDealer ? NOT_PER_DEALER : hasUsage ? undefined : missing('Bizom usage')}
            onClick={go(hasUsage ? '/bizom/usage' : '/import')}
            hint="Opens Bizom usage."
            info={{ formula: 'Σ Access_Count (recorded report accesses)', exclusions: 'Test and service accounts. Not downloads.' }}
          />
          <MiniGrid>
            <MiniTile accent={SERIES_COLOR.bizom} label="Active users" value={fInt(uk.users)} sub={uk.avgAccessesPerUser !== null ? `${fDec(uk.avgAccessesPerUser, 1)} accesses each` : undefined} trend={trendOf(uTrend?.users, uTrend?.vs ?? '')} unavailable={notPerDealer ? 'Not per dealer' : hasUsage ? undefined : 'Not imported'} onClick={go(pageLink('/bizom/usage', {}, { tab: 'users' }))} hint="Opens the Bizom users." info={{ formula: 'Distinct user ids with at least one access row', exclusions: 'Test and service accounts.' }} />
            <MiniTile accent={SERIES_COLOR.bizom} label="Reports used" value={fInt(uk.reports)} sub={`${fInt(uk.singleUserReports)} used by one user`} unavailable={notPerDealer ? 'Not per dealer' : hasUsage ? undefined : 'Not imported'} onClick={go(pageLink('/bizom/usage', {}, { tab: 'reports' }))} hint="Opens the Bizom reports." info={{ formula: 'Distinct reports with at least one recorded access' }} />
            <MiniTile accent={SERIES_COLOR.bizom} label="Top 5 reports" value={fPct(uk.top5Share, 0)} sub="of all accesses" unavailable={notPerDealer ? 'Not per dealer' : hasUsage ? undefined : 'Not imported'} onClick={go(pageLink('/bizom/usage', {}, { tab: 'reports' }))} hint="Opens the Bizom reports." info={{ formula: 'Accesses to the five most-used reports ÷ all recorded accesses' }} />
            <MiniTile accent={SERIES_COLOR.bizom} label="Low-use reports" value={fInt(uk.lowUsageReports)} sub={`${fInt(settings.lowUsageThreshold)} or fewer accesses`} tone={uk.lowUsageReports ? 'warn' : 'neutral'} unavailable={notPerDealer ? 'Not per dealer' : hasUsage ? undefined : 'Not imported'} onClick={go(pageLink('/bizom/usage', {}, { tab: 'reports' }))} hint="Opens the Bizom reports." info={{ formula: 'Reports with no more recorded accesses than the low-usage threshold', source: 'The threshold is a setting.' }} />
          </MiniGrid>
        </SystemColumn>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <WideTile
          accent="#eda100"
          icon={Smile}
          title="Hero Smiles points"
          value={loy ? fInt(loy.latestTotals.current) : '—'}
          sub={loy ? (dealerKeys.length ? `balance on ${fDate(loy.latest.date)}` : `as of ${fDate(loy.latest.date)} · ${fInt(loy.latestTotals.positiveBalances)} dealers with a balance`) : undefined}
          trend={loy?.points && loy.points.pct !== null ? { text: `${fPct(Math.abs(loy.points.pct))} since previous snapshot`, dir: loy.points.pct > 0.0005 ? 'up' : loy.points.pct < -0.0005 ? 'down' : 'flat' } : undefined}
          unavailable={loy ? undefined : dealerKeys.length ? 'These dealers are not in the Hero Smiles file' : missing('Hero Smiles')}
          onClick={go(loy ? '/hero-smiles' : '/import')}
          hint="Opens Hero Smiles."
          label="Hero Smiles points"
          info={{ formula: 'Σ current points in the latest valid snapshot', exclusions: 'Balances are point-in-time and are never added across snapshots.' }}
        />
        <WideTile
          accent="#52514E"
          icon={ClipboardList}
          title="Issue Tracker"
          label="Issue Tracker"
          value={hasIssues ? `${fInt(ik.open)} open` : '—'}
          sub={hasIssues ? `${fInt(ik.overdue)} overdue · ${fInt(ik.total)} tracked` : undefined}
          unavailable={notPerDealer ? NOT_PER_DEALER_ISSUES : hasIssues ? undefined : missing('Issue tracker')}
          onClick={() => goTo(hasIssues ? pageLink('/issues', { kpi: ['open', 'Open'] }) : '/import')}
          hint="Opens the open issues."
          info={{ formula: 'Issue-tracker items whose status is not Completed/Closed', exclusions: 'Items without a usable target date are never counted as overdue.', source: 'The tracker is not period filtered.' }}
        />
      </div>
      {insights.length > 0 && (
        <>
          <SectionTitle>Key insights</SectionTitle>
          <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(showAllInsights ? insights : insights.slice(0, 3)).map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
          {insights.length > 3 && (
            <div className="mt-2">
              <button className="btn btn-ghost btn-sm text-hero-700" onClick={() => setShowAllInsights((v) => !v)} aria-expanded={showAllInsights}>
                {showAllInsights ? 'Show fewer insights' : `Show all ${insights.length} insights`}
              </button>
            </div>
          )}
        </>
      )}

      {(hasDealer || hasDs) && (
        <>
          <SectionTitle>Orders by month</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Order value"
              subtitle="Click a month to focus the dashboard on it. Each system has its own scale."
              info={{ formula: 'Σ order value of eligible orders by order-date month', exclusions: 'Rejected and zero-value orders. A month in progress is a part month.' }}
              table={{ columns: [{ header: 'Month' }, { header: 'Dealer App', format: 'inr' }, { header: 'DataSense', format: 'inr' }], rows: [...new Set([...dMonthly, ...sMonthly].map((m) => m.month))].sort().map((m) => [monthKeyLabel(m), dMonthly.find((x) => x.month === m)?.value ?? null, sMonthly.find((x) => x.month === m)?.value ?? null]) }}
            >
              <div className={hasDealer && hasDs ? 'grid gap-3 sm:grid-cols-2' : ''}>
                {hasDealer && (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLOR.dealer }} /> Dealer App</div>
                    <BarsChart layout="vertical" format="inr" height={210} color={SERIES_COLOR.dealer} seriesName="Dealer App order value" activeKey={singleMonth} onSelect={monthClick} data={dMonthly.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), value: m.value }))} />
                  </div>
                )}
                {hasDs && (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLOR.ds }} /> DataSense SFA</div>
                    <BarsChart layout="vertical" format="inr" height={210} color={SERIES_COLOR.ds} seriesName="DataSense order value" activeKey={singleMonth} onSelect={monthClick} data={sMonthly.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), value: m.value }))} />
                  </div>
                )}
              </div>
            </ChartCard>
            <ChartCard
              title="Order count"
              subtitle="Eligible orders. Click a month to focus the dashboard on it."
              info={{ formula: 'Distinct eligible orders by order-date month' }}
              table={{ columns: [{ header: 'Month' }, { header: 'Dealer App', format: 'int' }, { header: 'DataSense', format: 'int' }], rows: [...new Set([...dMonthly, ...sMonthly].map((m) => m.month))].sort().map((m) => [monthKeyLabel(m), dMonthly.find((x) => x.month === m)?.orders ?? null, sMonthly.find((x) => x.month === m)?.orders ?? null]) }}
            >
              <div className={hasDealer && hasDs ? 'grid gap-3 sm:grid-cols-2' : ''}>
                {hasDealer && (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLOR.dealer }} /> Dealer App</div>
                    <BarsChart layout="vertical" height={210} color={SERIES_COLOR.dealer} seriesName="Dealer App orders" activeKey={singleMonth} onSelect={monthClick} data={dMonthly.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), value: m.orders }))} />
                  </div>
                )}
                {hasDs && (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLOR.ds }} /> DataSense SFA</div>
                    <BarsChart layout="vertical" height={210} color={SERIES_COLOR.ds} seriesName="DataSense orders" activeKey={singleMonth} onSelect={monthClick} data={sMonthly.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), value: m.orders }))} />
                  </div>
                )}
              </div>
            </ChartCard>
          </div>
        </>
      )}

      {tabs.length > 0 && (
        <>
          <SectionTitle>By system</SectionTitle>
          <Tabs<SysTab> label="System" tabs={tabs} value={tab} onChange={setTab} />

          {tab === 'dealer' && (
            <div className="space-y-4">
              <KpiGrid cols={6}>
                {hasDealer && (
                  <>
                    <KpiCard compact label="Cycles ordered" icon={ShoppingCart} value={fInt(dk.qty)} sub={`${fInt(dk.lines)} SKU lines`} onClick={go('/dealer/orders')} hint="Opens Dealer App orders." info={{ formula: 'Σ Order_Quantity of cycles lines on eligible orders' }} />
                    <KpiCard compact label="Average selling price" icon={Scale} value={fInr(dk.asp)} sub="per cycle" onClick={go('/dealer/orders')} hint="Opens Dealer App orders." info={{ formula: 'Cycles value ÷ cycles quantity', exclusions: 'Spares are kept out of the numerator.' }} />
                    <KpiCard compact label="Fulfilment rate" icon={Sparkles} value={fPct(dk.fulfilmentRate)} sub="by quantity" tone={dk.fulfilmentRate !== null && dk.fulfilmentRate < 0.8 ? 'warn' : 'good'} onClick={() => goTo(pageLink('/dealer/orders', { kpi: ['unfulfilled', 'Not yet fulfilled'] }))} hint="Shows orders not yet fully fulfilled." info={{ formula: 'Σ Fulfilled_Quantity ÷ Σ Order_Quantity (cycles)', exclusions: 'Orders where fulfilled quantity is not recorded.' }} />
                    <KpiCard compact label="Rejection rate" icon={ScrollText} value={fPct(dk.rejectionRate)} sub={`${fInt(dk.rejected)} rejected`} tone={dk.rejectionRate !== null && dk.rejectionRate > 0.1 ? 'warn' : 'neutral'} onClick={() => goTo(pageLink('/dealer/orders', { kpi: ['rejected', 'Rejected orders'] }))} hint="Shows the rejected orders." info={{ formula: 'Rejected orders ÷ all valid orders', exclusions: 'The export has no rejection reason.' }} />
                    <KpiCard compact label="Models billed per dealer" icon={Layers} value={fDec(dMbd.mbd, 1)} sub={`${fInt(dMbd.models)} ${dMbd.models === 1 ? 'model' : 'models'} billed`} onClick={go(pageLink('/dealer/orders', {}, { tab: 'models' }))} hint="Shows which models each dealer was billed for." info={{ formula: 'For each dealer, the distinct models (Sku_Brand) with at least one billed line; the dealers’ counts added up ÷ dealers with an eligible order', source: 'Billed = Invoice_Id present and Fulfilled_Quantity above zero. A model is the Sku_Brand recorded by the Dealer App.', exclusions: 'Rejected and zero-value orders; models ordered but not billed.' }} />
                  </>
                )}
                {hasDealerC && <KpiCard compact label="Complaints not closed" icon={Headset} value={fInt(dealerCk.backlog)} sub={`of ${fInt(dealerCk.total)} raised`} tone={dealerCk.over30 ? 'warn' : 'neutral'} onClick={() => goTo(pageLink('/dealer/complaints', { kpi: ['backlog', 'Not yet closed'] }))} hint="Shows the complaints not yet closed." info={{ formula: 'Complaints whose status is not closed or rejected' }} />}
              </KpiGrid>
              <div className="grid gap-4 lg:grid-cols-2">
                {hasDealer && (
                  <>
                    <ChartCard title="Top dealers by order value" subtitle="Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Order value', format: 'inr' }, { header: 'Orders', format: 'int' }], rows: dTopValue.map((r) => [r.label, r.value, r.orders]) }}>
                      <BarsChart format="inr" color={SERIES_COLOR.dealer} seriesName="Order value" onSelect={dealerClick('/dealer/orders')} data={rankData(dTopValue, 'value')} />
                    </ChartCard>
                    <ChartCard title="Top dealers by order count" subtitle="Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Orders', format: 'int' }, { header: 'Order value', format: 'inr' }], rows: dTopCount.map((r) => [r.label, r.orders, r.value]) }}>
                      <BarsChart color={SERIES_COLOR.dealer} seriesName="Orders" onSelect={dealerClick('/dealer/orders')} data={rankData(dTopCount, 'orders')} />
                    </ChartCard>
                    <ChartCard title="Orders by status" subtitle="Includes rejected orders. Click a status to see its orders." table={{ columns: [{ header: 'Status' }, { header: 'Orders', format: 'int' }], rows: dStatus.map(([s, n]) => [STATUS_LABELS[s], n]) }}>
                      <DonutChart centerValue={fInt(dealerOrders.length)} centerLabel="orders" data={dStatus.map(([s, n], i) => ({ key: s, label: STATUS_LABELS[s], value: n, color: statusColor(STATUS_LABELS[s], i) }))} onSelect={(key, lab) => goTo(pageLink('/dealer/orders', { status: [key, lab] }))} />
                    </ChartCard>
                  </>
                )}
                {hasDealerC && (
                  <>
                    <ChartCard title="Complaint backlog by department" subtitle="Closed and not closed. Click a department to see its complaints." table={{ columns: [{ header: 'Department' }, { header: 'Complaints', format: 'int' }, { header: 'Not closed', format: 'int' }], rows: dDept.map((r) => [r.label, r.count, r.backlog]) }}>
                      <StackedBarsChart layout="horizontal" data={dDept.map((r) => ({ key: r.key, label: r.label, closed: r.count - r.backlog, notClosed: r.backlog }))} series={[{ key: 'closed', label: 'Closed or rejected', color: '#1baf7a' }, { key: 'notClosed', label: 'Not closed', color: '#C8202F' }]} onSelect={(_s, key) => goTo(pageLink('/dealer/complaints', { func: key }))} />
                    </ChartCard>
                  </>
                )}
              </div>
            </div>
          )}

          {tab === 'ds' && (
            <div className="space-y-4">
              <KpiGrid cols={5}>
                {hasDs && (
                  <>
                    <KpiCard compact label="Average order value" icon={Receipt} value={fInr(sk.aov)} sub={`${fInt(sk.eligible)} orders`} trend={trendOf(sTrend?.aov, sTrend?.vs ?? '')} onClick={go('/datasense/orders')} hint="Opens DataSense orders." info={{ formula: 'Order value ÷ eligible orders' }} />
                    <KpiCard compact label="Average selling price" icon={Scale} value={fInr(sk.asp)} sub={`${fInt(sk.qty)} cycles`} onClick={go('/datasense/orders')} hint="Opens DataSense orders." info={{ formula: 'Cycles value ÷ cycles quantity', exclusions: 'Spares are kept out of the numerator.' }} />
                    <KpiCard compact label="Billed rate" icon={Sparkles} value={fPct(sk.billedRate)} sub="by status" onClick={go('/datasense/orders')} hint="Opens DataSense orders." info={{ formula: 'Orders with a billing, dispatch or delivered status ÷ eligible orders', exclusions: 'Status based; not comparable with the Dealer App’s quantity-based fulfilment.' }} />
                    <KpiCard compact label="Rejection rate" icon={ScrollText} value={fPct(sk.rejectionRate)} sub={`${fInt(sk.rejected)} rejected`} tone={sk.rejectionRate !== null && sk.rejectionRate > 0.1 ? 'warn' : 'neutral'} onClick={() => goTo(pageLink('/datasense/orders', { kpi: ['rejected', 'Rejected orders'] }))} hint="Shows the rejected orders." info={{ formula: 'Rejected orders ÷ all valid orders' }} />
                  </>
                )}
                {hasEmp && !notPerDealer && <KpiCard compact label="Field employees" icon={Users} value={fInt(ek.employees)} sub={`${fInt(ek.visits)} visits · ${ek.ordersPerVisit !== null ? fDec(ek.ordersPerVisit, 2) : '—'} orders per visit`} onClick={go('/datasense/employees')} hint="Opens DataSense employee activity." info={{ formula: 'Distinct employees with activity in the selected months', exclusions: 'Test and service accounts.' }} />}
              </KpiGrid>
              <div className="grid gap-4 lg:grid-cols-2">
                {hasDs && (
                  <>
                    <ChartCard title="Top dealers by order value" subtitle="Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Order value', format: 'inr' }, { header: 'Orders', format: 'int' }], rows: sTopValue.map((r) => [r.label, r.value, r.orders]) }}>
                      <BarsChart format="inr" color={SERIES_COLOR.ds} seriesName="Order value" onSelect={dealerClick('/datasense/orders')} data={rankData(sTopValue, 'value')} />
                    </ChartCard>
                    <ChartCard title="Top dealers by order count" subtitle="Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Orders', format: 'int' }, { header: 'Order value', format: 'inr' }], rows: sTopCount.map((r) => [r.label, r.orders, r.value]) }}>
                      <BarsChart color={SERIES_COLOR.ds} seriesName="Orders" onSelect={dealerClick('/datasense/orders')} data={rankData(sTopCount, 'orders')} />
                    </ChartCard>
                    <ChartCard title="Orders by status" subtitle="Includes rejected orders. Click a status to see its orders." table={{ columns: [{ header: 'Status' }, { header: 'Orders', format: 'int' }], rows: sStatus.map(([s, n]) => [STATUS_LABELS[s], n]) }}>
                      <DonutChart centerValue={fInt(dsOrders.length)} centerLabel="orders" data={sStatus.map(([s, n], i) => ({ key: s, label: STATUS_LABELS[s], value: n, color: statusColor(STATUS_LABELS[s], i) }))} onSelect={(key, lab) => goTo(pageLink('/datasense/orders', { status: [key, lab] }))} />
                    </ChartCard>
                  </>
                )}
                {hasDsC && (
                  <>
                    <ChartCard title="Complaints by month" subtitle="Closed and not closed. Click a month to see its complaints." table={{ columns: [{ header: 'Month' }, { header: 'Raised', format: 'int' }, { header: 'Not closed', format: 'int' }], rows: sMonthlyC.map((m) => [monthKeyLabel(m.month), m.total, m.backlog]) }}>
                      <StackedBarsChart data={sMonthlyC.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), closed: m.total - m.backlog, notClosed: m.backlog }))} series={[{ key: 'closed', label: 'Closed or rejected', color: '#1baf7a' }, { key: 'notClosed', label: 'Not closed', color: '#C8202F' }]} onSelect={(_s, key, lab) => goTo(pageLink('/datasense/complaints', { month: [key, lab] }))} />
                    </ChartCard>
                  </>
                )}
              </div>
            </div>
          )}

          {tab === 'bizom' && (
            <div className="space-y-4">
              <KpiGrid cols={5}>
                {hasUsage && (
                  <>
                    <KpiCard compact label="Active users" icon={Users} value={fInt(uk.users)} sub={uk.avgAccessesPerUser !== null ? `${fDec(uk.avgAccessesPerUser, 1)} accesses per user` : undefined} trend={trendOf(uTrend?.users, uTrend?.vs ?? '')} onClick={go('/bizom/usage')} hint="Opens Bizom usage." info={{ formula: 'Distinct user ids with at least one access row' }} />
                    <KpiCard compact label="Reports used" icon={BarChart3} value={fInt(uk.reports)} sub={`${fInt(uk.singleUserReports)} used by one user`} onClick={go('/bizom/usage')} hint="Opens Bizom usage." info={{ formula: 'Distinct reports with at least one recorded access' }} />
                  </>
                )}
                {hasIssues && (
                  <>
                    <KpiCard compact label="Open issues" icon={ListChecks} value={fInt(ik.open)} sub={`of ${fInt(ik.total)} tracked`} onClick={() => goTo(pageLink('/issues', { kpi: ['open', 'Open'] }))} hint="Opens the open issues." info={{ formula: 'Items whose status is not Completed/Closed' }} />
                    <KpiCard compact label="Overdue issues" icon={ScrollText} value={fInt(ik.overdue)} sub={`${fInt(ik.p1Open)} P1 still open`} tone={ik.overdue ? 'bad' : 'good'} onClick={() => goTo(pageLink('/issues', { kpi: ['overdue', 'Overdue'] }))} hint="Opens the overdue issues." info={{ formula: 'Open items with a real target date earlier than the as-of date' }} />
                    <KpiCard compact label="Resolution rate" icon={Sparkles} value={fPct(ik.resolutionRate)} sub={`${fInt(ik.resolved)} resolved`} onClick={() => goTo(pageLink('/issues', { status: ['Completed', 'Completed'] }))} hint="Opens the resolved issues." info={{ formula: 'Resolved issues ÷ all tracked issues' }} />
                  </>
                )}
              </KpiGrid>
              <div className="grid gap-4 lg:grid-cols-2">
                {hasUsage && (
                  <>
                    <ChartCard title="Report accesses by month" subtitle="Recorded accesses, not downloads. Click a month to focus on it." table={{ columns: [{ header: 'Month' }, { header: 'Accesses', format: 'int' }, { header: 'Users', format: 'int' }], rows: usageMonthly.map((m) => [m.label, m.accesses, m.users]) }}>
                      <TrendChart data={usageMonthly.map((m) => ({ key: m.month, label: m.label, accesses: m.accesses }))} series={[{ key: 'accesses', label: 'Recorded accesses', color: SERIES_COLOR.bizom }]} onSelect={(key) => monthClick(key)} />
                    </ChartCard>
                    <ChartCard title="Most-used reports" subtitle="Click a report to see who uses it." table={{ columns: [{ header: 'Report' }, { header: 'Accesses', format: 'int' }, { header: 'Users', format: 'int' }], rows: reports.slice(0, 10).map((r) => [r.reportName, r.accesses, r.users]) }}>
                      <BarsChart color={SERIES_COLOR.bizom} seriesName="Accesses" onSelect={(key) => goTo(pageLink('/bizom/usage', { report: key }))} data={reports.slice(0, 10).map((r) => ({ key: r.reportName, label: r.reportName.replace(/\s+/g, ' '), value: r.accesses }))} />
                    </ChartCard>
                  </>
                )}
                {hasIssues && (
                  <>
                    <ChartCard title="Issue status" subtitle="All tracked issues. Click a status to see them." table={{ columns: [{ header: 'Status' }, { header: 'Issues', format: 'int' }], rows: issueStatus.map((g) => [g.label, g.total]) }}>
                      <DonutChart centerValue={fInt(ik.total)} centerLabel="issues" data={issueStatus.map((g, i) => ({ key: g.key, label: g.label, value: g.total, color: statusColor(g.label, i) }))} onSelect={(key, lab) => goTo(pageLink('/issues', { status: [key, lab] }))} />
                    </ChartCard>
                    <ChartCard title="Unresolved issues by platform" subtitle="The tracker has no department column, so open issues are grouped by platform. Click a platform to see them." table={{ columns: [{ header: 'Platform' }, { header: 'Open', format: 'int' }, { header: 'Overdue', format: 'int' }], rows: issuePlatform.map((g) => [g.label, g.open, g.overdue]) }}>
                      <BarsChart layout="horizontal" color="#C8202F" seriesName="Open issues" onSelect={(key) => goTo(pageLink('/issues', { platform: key, kpi: ['open', 'Open'] }))} data={issuePlatform.map((g) => ({ key: g.key, label: g.label, value: g.open }))} />
                    </ChartCard>
                  </>
                )}
              </div>
            </div>
          )}

          {tab === 'loyalty' && loy && (
            <div className="space-y-4">
              <KpiGrid cols={4}>
                <KpiCard compact label="Members with a balance" icon={Users} value={fInt(loy.latestTotals.positiveBalances)} sub={`of ${fInt(loy.latestTotals.rows)} members`} onClick={() => goTo(pageLink('/hero-smiles', { balance: ['positive', 'With a balance'] }))} hint="Shows the members with a balance." info={{ formula: 'Members whose current points are above 0 in the latest snapshot' }} />
                <KpiCard compact label="Lifetime points earned" icon={Trophy} value={fInt(loy.latestTotals.lifetime)} sub={`as of ${fDate(loy.latest.date)}`} onClick={go('/hero-smiles')} hint="Opens Hero Smiles." info={{ formula: 'Σ lifetime points in the latest snapshot' }} />
                <KpiCard compact label="Average balance" icon={Coins} value={loy.latestTotals.positiveBalances ? fInt(loy.latestTotals.current / loy.latestTotals.positiveBalances) : '—'} sub="per member with a balance" onClick={go('/hero-smiles')} hint="Opens Hero Smiles." info={{ formula: 'Current points ÷ members with a balance, latest snapshot' }} />
                <KpiCard compact label="Change since previous snapshot" icon={BarChart3} value={loy.points ? `${loy.points.abs >= 0 ? '+' : '−'}${fInt(Math.abs(loy.points.abs))}` : '—'} unavailable={loy.points ? undefined : 'Needs two snapshots'} sub={loy.previous ? `since ${fDate(loy.previous.date)}` : undefined} onClick={go('/hero-smiles')} hint="Opens Hero Smiles." info={{ formula: 'Total current points now minus the total in the previous valid snapshot', exclusions: 'Two point-in-time positions; they are not added together.' }} />
              </KpiGrid>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Top dealers by current points" subtitle="Latest snapshot. Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Current points', format: 'int' }], rows: loy.top.map((r) => [r.label, r.value]) }}>
                  <BarsChart color="#eda100" seriesName="Current points" onSelect={(key) => openProfile(key, 'loyalty')} data={loy.top} />
                </ChartCard>
                <ChartCard title="Total current points by snapshot" subtitle="Each bar is the balance on one day. Bars are never added together." table={{ columns: [{ header: 'Snapshot' }, { header: 'Current points', format: 'int' }], rows: loy.series.map((s) => [fDate(s.date), s.current]) }}>
                  <BarsChart layout="vertical" color="#eda100" seriesName="Current points" onSelect={() => goTo('/hero-smiles')} data={loy.series.map((x) => ({ key: x.date, label: shortDate(x.date), value: x.current }))} />
                </ChartCard>
                {loy.previous && loy.moverBars.length > 0 && (
                  <ChartCard title="Largest point changes since the previous snapshot" subtitle="Biggest gains and falls among dealers present in both snapshots. Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Change', format: 'int' }], rows: loy.moverBars.map((r) => [r.label, r.value]) }}>
                    <BarsChart seriesName="Change in points" onSelect={(key) => openProfile(key, 'loyalty')} data={loy.moverBars} />
                  </ChartCard>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const shortDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]} ${monthLabel(`${m[1]}-${m[2]}`).slice(0, 3)}` : iso;
};
