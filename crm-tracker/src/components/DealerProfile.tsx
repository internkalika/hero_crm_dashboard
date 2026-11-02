import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Boxes, Building2, Gauge, Headset, Inbox, Smile, X } from 'lucide-react';
import clsx from 'clsx';
import { useData } from '../state/DataContext';
import { useDealerProfile, useUrlValue } from './filters';
import { Tabs } from './Tabs';
import { Badge, Segmented } from './ui';
import { ChartCard, DonutChart, GroupedColumnsChart, SERIES_COLOR, TrendChart, statusColor } from './charts';
import { DataTable } from './DataTable';
import { DealerGrowthBlock } from './DealerGrowth';
import { OrderStatusBadge, ComplaintStatusBadge, monthKeyLabel } from '../pages/common';
import type { Col } from '../lib/export/excel';
import { fDate, fDelta, fInr, fInrCompact, fInt, fPct } from '../lib/export/format';
import { buildDealerProfile, dealerExists, DealerProfileData, MetricLine, SideSummary } from '../lib/metrics/dealerProfile';
import { COMPLAINT_STATUS_LABELS, ageDays, isBacklog } from '../lib/metrics/complaints';
import { STATUS_LABELS } from '../lib/metrics/orders';
import { pageLink } from '../lib/nav/links';
import type { ComplaintRec, ComplaintStatusGroup, OrderSummary } from '../lib/types';

type TabId = 'overview' | 'orders' | 'complaints' | 'activity' | 'loyalty' | 'comparison';

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className={clsx('tnum text-lg font-bold leading-tight', tone === 'warn' ? 'text-warn-text' : tone === 'bad' ? 'text-bad-text' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

function SystemCard({ title, color, icon, present, children, link }: { title: string; color: string; icon: ReactNode; present: boolean; children: ReactNode; link?: ReactNode }) {
  return (
    <section className="card p-4" aria-label={title}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md text-white" style={{ background: color }} aria-hidden>
            {icon}
          </span>
          {title}
        </h3>
        {link}
      </header>
      {present ? children : <p className="py-6 text-center text-sm text-ink-3">No orders from this dealer in {title} for the selected period.</p>}
    </section>
  );
}

const asLink = (to: string, text: string) => (
  <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-hero-700 hover:underline">
    {text} <ArrowRight size={12} />
  </Link>
);

function OrdersGrid({ s, isDealer }: { s: SideSummary; isDealer: boolean }) {
  const k = s.kpis;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Stat label="Orders" value={fInt(k.eligible)} sub={`${fInt(k.gross)} valid in total`} />
      <Stat label="Order value" value={fInrCompact(k.eligibleValue)} sub={fInr(k.eligibleValue)} />
      <Stat label="Avg order value" value={fInr(k.aov)} />
      <Stat label="Cycles quantity" value={fInt(k.qty)} />
      <Stat label="Avg selling price" value={fInr(k.asp)} sub={k.asp === null ? 'Needs cycles quantity' : undefined} />
      {isDealer ? <Stat label="Fulfilment" value={fPct(k.fulfilmentRate)} sub={k.fulfilmentRate === null ? 'Not recorded' : 'by quantity'} /> : <Stat label="Billed / dispatched" value={fPct(k.billedRate)} sub="by status" />}
      <Stat label="Rejection" value={fPct(k.rejectionRate)} sub={`${fInt(k.rejected)} rejected`} tone={k.rejectionRate !== null && k.rejectionRate > 0.1 ? 'warn' : undefined} />
      <Stat label="Complaints" value={fInt(s.complaints.total)} sub={`${fInt(s.complaints.backlog)} not closed`} tone={s.complaints.backlog ? 'warn' : undefined} />
      <Stat label="Last order" value={fDate(s.lastOrder)} sub={s.activeMonths ? `${s.activeMonths} active month${s.activeMonths === 1 ? '' : 's'}` : undefined} />
    </div>
  );
}

function Overview({ p }: { p: DealerProfileData }) {
  const { key } = p.identity;
  const chart = p.months.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), dealer: m.dealerValue, ds: m.dsValue }));
  return (
    <div className="space-y-4">
      <DealerGrowthBlock dealerKey={key} name={p.identity.name} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SystemCard title="Dealer App" color={SERIES_COLOR.dealer} icon={<Boxes size={14} />} present={p.dealerApp.orders.length > 0} link={asLink(pageLink('/dealer/orders', { dealer: [key, p.identity.name] }), 'Orders')}>
          <OrdersGrid s={p.dealerApp} isDealer />
        </SystemCard>
        <SystemCard title="DataSense SFA" color={SERIES_COLOR.ds} icon={<Inbox size={14} />} present={p.ds.orders.length > 0} link={asLink(pageLink('/datasense/orders', { dealer: [key, p.identity.name] }), 'Orders')}>
          <OrdersGrid s={p.ds} isDealer={false} />
        </SystemCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Order value by month" subtitle="Eligible orders. Both systems use the same rupee axis for this one dealer; the systems can record the same order, so do not add them." table={{ columns: [{ header: 'Month' }, { header: 'Dealer App', format: 'inr' }, { header: 'DataSense', format: 'inr' }], rows: chart.map((c) => [c.label, c.dealer, c.ds]) }}>
            <GroupedColumnsChart format="inr" data={chart} series={[{ key: 'dealer', label: 'Dealer App', color: SERIES_COLOR.dealer }, { key: 'ds', label: 'DataSense SFA', color: SERIES_COLOR.ds }]} />
          </ChartCard>
        </div>
        <section className="card p-4" aria-label="Hero Smiles">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-warn text-white" aria-hidden>
              <Smile size={14} />
            </span>
            Hero Smiles
          </h3>
          {p.loyalty.current === null ? (
            <p className="py-6 text-center text-sm text-ink-3">{p.identity.inLoyalty ? 'No balance in the latest snapshot.' : 'This dealer is not in the Hero Smiles snapshots.'}</p>
          ) : (
            <>
              <div className="tnum text-3xl font-bold">{fInt(p.loyalty.current)}</div>
              <div className="text-xs text-ink-3">current points · snapshot of {fDate(p.loyalty.snapshotDate)}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Lifetime" value={fInt(p.loyalty.lifetime)} />
                <Stat label="Issued" value={fInt(p.loyalty.issued)} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function OrdersTab({ p }: { p: DealerProfileData }) {
  const [sys, setSys] = useState<'dealer' | 'ds'>(p.dealerApp.orders.length || !p.ds.orders.length ? 'dealer' : 'ds');
  const rows = sys === 'dealer' ? p.dealerApp.orders : p.ds.orders;
  const cols: Array<Col<OrderSummary>> = [
    { id: 'id', header: 'Order ID', value: (o) => o.orderId },
    { id: 'date', header: 'Date', value: (o) => o.date, format: 'date' },
    { id: 'status', header: 'Status', value: (o) => STATUS_LABELS[o.statusGroup], render: (o) => <OrderStatusBadge s={o.statusGroup} /> },
    { id: 'value', header: 'Order value', value: (o) => o.value, format: 'inr' },
    { id: 'qty', header: 'Cycles qty', value: (o) => o.qty, format: 'int' },
    ...(sys === 'dealer' ? [{ id: 'ful', header: 'Fulfilled %', value: (o: OrderSummary) => (o.fulfilledQty !== null && o.qty ? o.fulfilledQty / o.qty : null), format: 'pct' } as Col<OrderSummary>] : [{ id: 'emp', header: 'Employee', value: (o: OrderSummary) => o.employee } as Col<OrderSummary>]),
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<'dealer' | 'ds'> label="System" value={sys} onChange={setSys} options={[{ value: 'dealer', label: `Dealer App (${p.dealerApp.orders.length})` }, { value: 'ds', label: `DataSense SFA (${p.ds.orders.length})` }]} />
        {asLink(pageLink(sys === 'dealer' ? '/dealer/orders' : '/datasense/orders', { dealer: [p.identity.key, p.identity.name] }), 'Open in Orders & Performance')}
      </div>
      <DataTable title={`${sys === 'dealer' ? 'Dealer App' : 'DataSense'} orders`} rows={rows} columns={cols} getRowId={(o) => o.key} exportName={`dealer_${p.identity.key}_${sys}_orders`} initialSort={{ id: 'date', desc: true }} pageSize={10} emptyText="No orders for this dealer in the selected period." />
    </div>
  );
}

function ComplaintsBlock({ title, recs, k, system, p }: { title: string; recs: ComplaintRec[]; k: SideSummary['complaints']; system: 'dealer' | 'ds'; p: DealerProfileData }) {
  const status = (Object.keys(COMPLAINT_STATUS_LABELS) as ComplaintStatusGroup[]).map((s) => ({ key: s, label: COMPLAINT_STATUS_LABELS[s], value: recs.filter((c) => c.statusGroup === s).length, color: statusColor(COMPLAINT_STATUS_LABELS[s]) }));
  const cols: Array<Col<ComplaintRec>> = [
    { id: 'id', header: 'Complaint ID', value: (c) => c.id },
    { id: 'date', header: 'Raised', value: (c) => c.raisedDate, format: 'date' },
    { id: 'status', header: 'Status', value: (c) => COMPLAINT_STATUS_LABELS[c.statusGroup], render: (c) => <ComplaintStatusBadge s={c.statusGroup} /> },
    { id: 'age', header: 'Age (days)', value: (c) => (isBacklog(c) ? ageDays(c, p.asOf) : null), format: 'int' },
    { id: 'cat', header: 'Category', value: (c) => c.category },
    { id: 'desc', header: 'Description', value: (c) => c.description, width: 260 },
  ];
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {asLink(pageLink(system === 'dealer' ? '/dealer/complaints' : '/datasense/complaints', { dealer: [p.identity.key, p.identity.name] }), 'Open in Complaints')}
      </div>
      {recs.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-3">No complaints in {title} for this dealer in the selected period.</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Raised" value={fInt(k.total)} />
            <Stat label="Not closed" value={fInt(k.backlog)} tone={k.backlog ? 'warn' : undefined} />
            <Stat label="Closed" value={fInt(k.closed)} />
            <Stat label="Oldest open" value={k.oldestAgeDays === null ? '—' : `${fInt(k.oldestAgeDays)} days`} />
          </div>
          <div className="card p-4">
            <DonutChart data={status} centerValue={fInt(k.total)} centerLabel="complaints" height={150} />
          </div>
          <DataTable title="Complaints" rows={recs} columns={cols} getRowId={(c) => c.key} exportName={`dealer_${p.identity.key}_${system}_complaints`} initialSort={{ id: 'date', desc: true }} pageSize={5} />
        </>
      )}
    </section>
  );
}

function ActivityTab({ p }: { p: DealerProfileData }) {
  const empCols: Array<Col<(typeof p.employees)[number]>> = [
    { id: 'e', header: 'Employee', value: (e) => e.employee },
    { id: 'r', header: 'Role', value: (e) => e.role },
    { id: 'o', header: 'Orders', value: (e) => e.orders, format: 'int' },
    { id: 'v', header: 'Order value', value: (e) => e.value, format: 'inr' },
    { id: 'l', header: 'Last order', value: (e) => e.lastOrder, format: 'date' },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Dealer App: first order" value={fDate(p.dealerApp.firstOrder)} />
        <Stat label="Dealer App: last order" value={fDate(p.dealerApp.lastOrder)} />
        <Stat label="Dealer App: active months" value={fInt(p.dealerApp.activeMonths)} />
        <Stat label="Different SKUs ordered" value={fInt(p.skusOrdered)} sub="Dealer App" />
        <Stat label="DataSense: first order" value={fDate(p.ds.firstOrder)} />
        <Stat label="DataSense: last order" value={fDate(p.ds.lastOrder)} />
        <Stat label="DataSense: active months" value={fInt(p.ds.activeMonths)} />
        <Stat label="Field staff serving" value={fInt(p.employees.filter((e) => e.employee !== 'Not specified').length)} sub="punching DataSense orders" />
      </div>
      <DataTable title="DataSense field staff who punched this dealer’s orders" rows={p.employees} columns={empCols} getRowId={(e) => e.employee} exportName={`dealer_${p.identity.key}_field_staff`} initialSort={{ id: 'v', desc: true }} pageSize={5} emptyText="No DataSense orders for this dealer in the selected period." />
      <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-ink-2">
        <Gauge size={14} className="mt-0.5 shrink-0 text-ink-3" />
        Bizom report usage is recorded per user, not per dealer, so it cannot be attributed to this dealer. Order and complaint activity above comes from the Dealer App and DataSense records.
      </p>
    </div>
  );
}

function LoyaltyTab({ p }: { p: DealerProfileData }) {
  const l = p.loyalty;
  const series = l.series.filter((s) => s.current !== null || s.lifetime !== null).map((s) => ({ key: s.date, label: fDate(s.date), current: s.current, lifetime: s.lifetime }));
  if (!p.identity.inLoyalty) return <div className="card p-8 text-center text-sm text-ink-3">This dealer code is not in any Hero Smiles snapshot.</div>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Current points" value={fInt(l.current)} sub={`snapshot of ${fDate(l.snapshotDate)}`} />
        <Stat label="Lifetime points" value={fInt(l.lifetime)} />
        <Stat label="Points issued" value={fInt(l.issued)} />
        <Stat label="Points expired" value={fInt(l.expired)} />
        <Stat label="Opening balance" value={fInt(l.opening)} />
        <Stat label="Smile quiz points" value="—" sub="Not in the export" />
      </div>
      <ChartCard title="Points at each snapshot" subtitle="Each point is a balance on that date. Snapshots are positions in time, never added together." table={{ columns: [{ header: 'Snapshot' }, { header: 'Current', format: 'int' }, { header: 'Lifetime', format: 'int' }], rows: series.map((s) => [s.label, s.current, s.lifetime]) }}>
        <TrendChart format="int" data={series} series={[{ key: 'current', label: 'Current points', color: '#C8202F' }, { key: 'lifetime', label: 'Lifetime points', color: SERIES_COLOR.ds }]} />
      </ChartCard>
      <div className="text-right">{asLink(pageLink('/hero-smiles'), 'Open Hero Smiles')}</div>
    </div>
  );
}

function ComparisonTab({ p }: { p: DealerProfileData }) {
  const { settings } = useData();
  const base = settings.comparisonBaseline === 'dealer' ? 'Dealer App' : 'DataSense';
  const other = settings.comparisonBaseline === 'dealer' ? 'DataSense' : 'Dealer App';
  const fv = (v: number | null, f: MetricLine['fmt']) => (v === null ? '—' : f === 'inr' ? fInr(v) : f === 'pct' ? fPct(v) : fInt(v));
  const cols: Array<Col<MetricLine>> = [
    { id: 'm', header: 'Measure', value: (r) => r.label },
    { id: 'd', header: 'Dealer App', value: (r) => r.dealer, render: (r) => fv(r.dealer, r.fmt), align: 'right' },
    { id: 's', header: 'DataSense SFA', value: (r) => r.ds, render: (r) => fv(r.ds, r.fmt), align: 'right' },
    { id: 'abs', header: `Difference (${other} − ${base})`, value: (r) => r.diff.abs, render: (r) => (r.dealer === null || r.ds === null ? '—' : fDelta(r.diff.abs, r.fmt === 'inr' ? 'inr' : 'int')), align: 'right' },
    { id: 'pct', header: `% of ${base}`, value: (r) => r.diff.pct, render: (r) => (r.dealer === null || r.ds === null ? '—' : fDelta(r.diff.pct, 'pct')), align: 'right' },
  ];
  const bars = [
    { key: 'orders', label: 'Orders', dealer: p.comparison[0].dealer, ds: p.comparison[0].ds },
    { key: 'compl', label: 'Complaints', dealer: p.comparison[6].dealer, ds: p.comparison[6].ds },
  ];
  const valueBars = [{ key: 'value', label: 'Order value', dealer: p.comparison[1].dealer, ds: p.comparison[1].ds }];
  const notOnApp = !p.identity.inDealerApp;
  return (
    <div className="space-y-4">
      {p.ordersOnlyViaDealerApp && <div className="rounded-lg bg-slate-100 p-3 text-sm text-ink-2"><strong className="text-ink">Orders only placed through Dealer App.</strong> No DataSense order in the compared months, so DataSense shows 0.</div>}
      {notOnApp && <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn-text">This dealer has no Dealer App orders, so there is nothing to compare side by side. Missing values are shown as a dash, not zero.</div>}
      <p className="text-xs text-ink-2">
        Like-for-like months: {p.commonMonths.length ? p.commonMonths.map(monthKeyLabel).join(', ') : 'none in the selected period'}. Only months in which both systems have data are compared.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Orders and complaints" table={{ columns: [{ header: 'Measure' }, { header: 'Dealer App', format: 'int' }, { header: 'DataSense', format: 'int' }], rows: bars.map((b) => [b.label, b.dealer, b.ds]) }}>
          <GroupedColumnsChart format="int" height={200} data={bars} series={[{ key: 'dealer', label: 'Dealer App', color: SERIES_COLOR.dealer }, { key: 'ds', label: 'DataSense SFA', color: SERIES_COLOR.ds }]} />
        </ChartCard>
        <ChartCard title="Order value" table={{ columns: [{ header: 'Measure' }, { header: 'Dealer App', format: 'inr' }, { header: 'DataSense', format: 'inr' }], rows: valueBars.map((b) => [b.label, b.dealer, b.ds]) }}>
          <GroupedColumnsChart format="inr" height={200} data={valueBars} series={[{ key: 'dealer', label: 'Dealer App', color: SERIES_COLOR.dealer }, { key: 'ds', label: 'DataSense SFA', color: SERIES_COLOR.ds }]} />
        </ChartCard>
      </div>
      <DataTable rows={p.comparison} columns={cols} getRowId={(r) => r.id} exportName={`dealer_${p.identity.key}_comparison`} pageSize={10} stickyFirst />
      <p className="text-xs text-ink-3">Fulfilment (Dealer App, by quantity) and billed rate (DataSense, by status) are different definitions and are shown on the Overview tab but never compared.</p>
      <div className="text-right">{asLink(pageLink('/', {}, { show: 'table' }), 'Open the full comparison')}</div>
    </div>
  );
}

export function DealerProfile() {
  const { dealer, close } = useDealerProfile();
  const { data, period, settings, crosswalk } = useData();
  const [tab, setTab] = useUrlValue('dtab', 'overview');
  const closeRef = useRef<HTMLButtonElement>(null);

  const exists = useMemo(() => (dealer ? dealerExists(data, dealer) : false), [data, dealer]);
  const p = useMemo(() => (dealer && exists ? buildDealerProfile(data, dealer, period, settings, crosswalk) : null), [data, dealer, exists, period, settings, crosswalk]);

  useEffect(() => {
    if (!dealer) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', h);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', h);
  }, [dealer, close]);

  if (!dealer) return null;
  const tabs: Array<{ id: TabId; label: string; badge?: ReactNode }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'orders', label: 'Orders', badge: p ? p.dealerApp.orders.length + p.ds.orders.length : undefined },
    { id: 'complaints', label: 'Complaints', badge: p ? p.dealerApp.complaintRecs.length + p.ds.complaintRecs.length : undefined },
    { id: 'activity', label: 'Activity' },
    { id: 'loyalty', label: 'Loyalty' },
    { id: 'comparison', label: 'Comparison' },
  ];
  const cur = (tabs.some((t) => t.id === tab) ? tab : 'overview') as TabId;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onMouseDown={close} data-testid="dealer-profile">
      <aside role="dialog" aria-modal="true" aria-label={p ? `Dealer profile: ${p.identity.name}` : 'Dealer profile'} className="flex h-full w-full max-w-5xl flex-col bg-surface-2 shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-hero-600 text-white" aria-hidden>
              <Building2 size={22} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold leading-tight">{p ? p.identity.name : `Dealer ${dealer}`}</h2>
              {p && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">DB / ERP code <strong className="text-ink">{p.identity.dbCode}</strong></span>
                  {p.identity.outletId && <span className="rounded bg-slate-100 px-1.5 py-0.5">Outlet ID <strong className="text-ink">{p.identity.outletId}</strong></span>}
                  {p.identity.warehouse && <span className="rounded bg-slate-100 px-1.5 py-0.5">Warehouse <strong className="text-ink">{p.identity.warehouse}</strong></span>}
                  {(p.identity.city || p.identity.zone) && <span className="rounded bg-slate-100 px-1.5 py-0.5">{[p.identity.city, p.identity.zone].filter(Boolean).join(' · ')}</span>}
                  <Badge tone={p.identity.inDealerApp ? 'good' : 'neutral'} icon={false}>Dealer App orders</Badge>
                  <Badge tone={p.identity.inDataSense ? 'good' : 'neutral'} icon={false}>DataSense orders</Badge>
                  <Badge tone={p.identity.inLoyalty ? 'good' : 'neutral'} icon={false}>Hero Smiles</Badge>
                </div>
              )}
            </div>
          </div>
          <button ref={closeRef} aria-label="Close dealer profile" className="btn btn-ghost btn-sm" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-auto px-5 pb-6 pt-3">
          {!p ? (
            <div className="card mt-4 p-8 text-center">
              <Headset size={28} className="mx-auto mb-2 text-ink-3" />
              <div className="font-semibold">No records for dealer code {dealer}</div>
              <p className="mt-1 text-sm text-ink-2">The code is not in the imported Dealer App, DataSense or Hero Smiles files. Dealers are only looked up by their validated code, never by name.</p>
            </div>
          ) : (
            <>
              <Tabs<TabId> label="Dealer profile sections" tabs={tabs} value={cur} onChange={setTab} />
              {cur === 'overview' && <Overview p={p} />}
              {cur === 'orders' && <OrdersTab p={p} />}
              {cur === 'complaints' && (
                <div className="space-y-6">
                  <ComplaintsBlock title="Dealer App complaints" recs={p.dealerApp.complaintRecs} k={p.dealerApp.complaints} system="dealer" p={p} />
                  <ComplaintsBlock title="DataSense complaints" recs={p.ds.complaintRecs} k={p.ds.complaints} system="ds" p={p} />
                </div>
              )}
              {cur === 'activity' && <ActivityTab p={p} />}
              {cur === 'loyalty' && <LoyaltyTab p={p} />}
              {cur === 'comparison' && <ComparisonTab p={p} />}
              <p className="mt-6 text-[11px] text-ink-3">Figures follow the reporting period selected at the top and use the same formulas as the dashboards. Rejected orders are left out of value measures.</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

