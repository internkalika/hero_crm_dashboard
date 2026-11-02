import { useMemo, useState } from 'react';
import { Activity, Award, CalendarClock, Star, TrendingUp, Users, ShoppingCart, AlertTriangle } from 'lucide-react';
import { useData } from '../state/DataContext';
import { DataGate } from '../components/States';
import { KpiCard, KpiGrid } from '../components/KpiCard';
import { MoreMeasures } from '../components/MoreMeasures';
import { Tabs } from '../components/Tabs';
import { DealerLink } from '../components/DealerLink';
import { BarsChart, ChartCard, TrendChart, SERIES_COLOR } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { describeFilters, useCrossFilter, useDealerProfile, useUrlValue } from '../components/filters';
import { FilterBar, FilterField, buildOptions } from '../components/FilterBar';
import { Drawer, Facts } from '../components/Drawer';
import { Badge, PageHeader } from '../components/ui';
import type { Col } from '../lib/export/excel';
import { fDate, fInr, fInt } from '../lib/export/format';
import { DealerChange, SnapshotAnomaly, SnapshotTotals, changesBetween, dealerSeries, isValidSnapshot, latestValidSnapshot, loyaltyAnomalies, snapshotTotals, snapshotsOf } from '../lib/metrics/loyalty';
import { buildDealerOrders, dsOrderSummaries, orderKpis } from '../lib/metrics/orders';
import type { LoyaltyRec } from '../lib/types';
import { titleCase } from '../lib/util/parse';

const DIM_LABELS: Record<string, string> = { kind: 'ID check', balance: 'Balance', orders: 'Orders', move: 'Change', member: 'Member', kpi: 'Measure' };
type TabId = 'overview' | 'members' | 'changes' | 'snapshots' | 'anomalies';

interface Row extends LoyaltyRec {
  dsOrders: number | null;
  dsValue: number | null;
  appOrders: number | null;
  appValue: number | null;
  delta: number | null;
}

export default function HeroSmiles() {
  const { data, settings } = useData();
  const cf = useCrossFilter();
  const profile = useDealerProfile();
  const [tabRaw, setTab] = useUrlValue('tab', 'overview');
  const snaps = useMemo(() => snapshotsOf(data), [data]);
  const latest = useMemo(() => latestValidSnapshot(snaps), [snaps]);
  const [date, setDate] = useState<string | null>(null);
  const [sel, setSel] = useState<Row | null>(null);
  const snap = snaps.find((s) => s.date === (date ?? latest?.date)) ?? latest;
  const idx = snap ? snaps.findIndex((s) => s.date === snap.date) : -1;
  const prev = idx > 0 ? snaps[idx - 1] : null;
  const totals = useMemo(() => snaps.map(snapshotTotals), [snaps]);
  const t: SnapshotTotals | null = snap ? snapshotTotals(snap) : null;
  const changes = useMemo(() => (snap && prev ? changesBetween(prev, snap) : []), [snap, prev]);
  const changeBy = useMemo(() => new Map(changes.map((c) => [c.entityKey, c])), [changes]);
  const anomalies = useMemo(() => loyaltyAnomalies(snaps), [snaps]);
  const realAnomalies = useMemo(() => anomalies.filter((a) => a.kind !== 'Unverified customer ID'), [anomalies]);

  const orderIndex = useMemo(() => {
    const ds = new Map<string, { n: number; v: number }>();
    const app = new Map<string, { n: number; v: number }>();
    for (const [map, orders, sys] of [[ds, dsOrderSummaries(data.dsOrders), 'ds'], [app, buildDealerOrders(data.dealerLines), 'dealer']] as const) {
      const by = new Map<string, typeof orders>();
      orders.forEach((o) => o.dealerKey && by.set(o.dealerKey, [...(by.get(o.dealerKey) ?? []), o]));
      by.forEach((os, key) => {
        const k = orderKpis(os, settings, sys);
        map.set(key, { n: k.eligible, v: k.eligibleValue });
      });
    }
    return { ds, app };
  }, [data.dsOrders, data.dealerLines, settings]);

  const rows: Row[] = useMemo(() => {
    if (!snap) return [];
    return snap.rows.map((r) => ({
      ...r,
      dsOrders: r.idKind === 'verified' ? orderIndex.ds.get(r.entityKey)?.n ?? null : null,
      dsValue: r.idKind === 'verified' ? orderIndex.ds.get(r.entityKey)?.v ?? null : null,
      appOrders: r.idKind === 'verified' ? orderIndex.app.get(r.entityKey)?.n ?? null : null,
      appValue: r.idKind === 'verified' ? orderIndex.app.get(r.entityKey)?.v ?? null : null,
      delta: changeBy.get(r.entityKey)?.deltaCurrent ?? null,
    }));
  }, [snap, orderIndex, changeBy]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const f = cf.filters;
        if (!cf.ok('kind', r.idKind)) return false;
        if (cf.has('balance', 'positive') && !((r.current ?? 0) > 0)) return false;
        if (cf.has('balance', 'zero') && (r.current ?? 0) > 0) return false;
        if (cf.has('orders', 'app') && !(r.appOrders && r.appOrders > 0)) return false;
        if (cf.has('orders', 'ds') && !(r.dsOrders && r.dsOrders > 0)) return false;
        if (cf.has('orders', 'none') && ((r.appOrders ?? 0) > 0 || (r.dsOrders ?? 0) > 0)) return false;
        if (cf.has('move', 'up') && !((r.delta ?? 0) > 0)) return false;
        if (cf.has('move', 'down') && !((r.delta ?? 0) < 0)) return false;
        if (cf.has('move', 'flat') && r.delta !== 0) return false;
        if (!cf.ok('member', r.entityKey)) return false;
        return true;
      }),
    [rows, cf],
  );

  // The filter bar offers what the selected snapshot contains. Balances are point-in-time: the counts below are members,
  // never points added up across snapshots.
  const filterFields: FilterField[] = useMemo(() => {
    const n = (p: (r: Row) => boolean) => rows.filter(p).length;
    return [
      { dim: 'balance', label: 'Balance', allLabel: 'All members', options: [{ value: 'positive', label: 'With a balance', count: n((r) => (r.current ?? 0) > 0) }, { value: 'zero', label: 'No balance', count: n((r) => (r.current ?? 0) <= 0) }] },
      { dim: 'kind', label: 'ID check', allLabel: 'All IDs', options: [{ value: 'verified', label: 'Dealer code', count: n((r) => r.idKind === 'verified') }, { value: 'unverified', label: 'No dealer code', count: n((r) => r.idKind !== 'verified') }] },
      {
        dim: 'orders',
        label: 'Orders (all periods)',
        allLabel: 'Any',
        options: [
          { value: 'app', label: 'Has Dealer App orders', count: n((r) => (r.appOrders ?? 0) > 0) },
          { value: 'ds', label: 'Has DataSense orders', count: n((r) => (r.dsOrders ?? 0) > 0) },
          { value: 'none', label: 'No orders in either', count: n((r) => (r.appOrders ?? 0) === 0 && (r.dsOrders ?? 0) === 0) },
        ],
      },
      ...(prev
        ? [{ dim: 'move', label: 'Points movement', allLabel: 'Any', options: [{ value: 'up', label: 'Points up', count: n((r) => (r.delta ?? 0) > 0) }, { value: 'down', label: 'Points down', count: n((r) => (r.delta ?? 0) < 0) }, { value: 'flat', label: 'No change', count: n((r) => r.delta === 0) }] } as FilterField]
        : []),
      { dim: 'member', label: 'Member', allLabel: 'All members', search: true, options: buildOptions(rows, (r) => r.entityKey, { sort: 'label', noCounts: true, label: (_k, s) => `${titleCase((s.firmName || s.customerId || '').toLowerCase())}${s.customerId ? ` · ${s.customerId}` : ''}` }) },
    ];
  }, [rows, prev]);

  const cols: Col<Row>[] = [
    { id: 'firm', header: 'Dealer / firm', value: (r) => titleCase((r.firmName || '').toLowerCase()), width: 220, render: (r) => <DealerLink dealerKey={r.idKind === 'verified' ? r.entityKey : null} tab="loyalty">{titleCase((r.firmName || '').toLowerCase())}</DealerLink> },
    { id: 'id', header: 'Customer ID', value: (r) => r.customerId, render: (r) => (r.idKind === 'verified' ? <span>{r.customerId}</span> : <span className="inline-flex items-center gap-1">{r.customerId}<Badge tone="warn">Unverified</Badge></span>) },
    { id: 'mob', header: 'Mobile (masked)', value: (r) => r.mobileMasked, hidden: true },
    { id: 'cur', header: 'Current points', value: (r) => r.current, format: 'int' },
    { id: 'delta', header: 'Change since previous snapshot', value: (r) => r.delta, format: 'int', help: prev ? `Current points now minus current points on ${prev.date}; only for verified IDs present in both snapshots.` : 'Needs an earlier snapshot' },
    { id: 'life', header: 'Lifetime points', value: (r) => r.lifetime, format: 'int' },
    { id: 'open', header: 'Opening', value: (r) => r.opening, format: 'int', hidden: true },
    { id: 'iss', header: 'Issued', value: (r) => r.issued, format: 'int' },
    { id: 'exp', header: 'Expired', value: (r) => r.expired, format: 'int', hidden: true },
    { id: 'adj', header: 'Adjustment', value: (r) => r.adjustment, format: 'int', hidden: true },
    { id: 'dsv', header: 'DataSense order value (all periods)', value: (r) => r.dsValue, format: 'inr', hidden: false },
    { id: 'appv', header: 'Dealer App order value (all periods)', value: (r) => r.appValue, format: 'inr' },
    { id: 'flags', header: 'Flags', value: (r) => r.flags.join(', '), hidden: true },
  ];
  const snapCols: Col<SnapshotTotals>[] = [
    { id: 'date', header: 'Snapshot date', value: (s) => s.date, format: 'date' },
    { id: 'rows', header: 'Members', value: (s) => s.rows, format: 'int' },
    { id: 'ver', header: 'Verified IDs', value: (s) => s.verified, format: 'int' },
    { id: 'unv', header: 'Unverified IDs', value: (s) => s.unverified, format: 'int' },
    { id: 'pos', header: 'With balance', value: (s) => s.positiveBalances, format: 'int' },
    { id: 'cur', header: 'Current points (this snapshot only)', value: (s) => s.current, format: 'int' },
    { id: 'life', header: 'Lifetime points (this snapshot only)', value: (s) => s.lifetime, format: 'int' },
    { id: 'iss', header: 'Issued', value: (s) => s.issued, format: 'int' },
  ];
  const anomCols: Col<SnapshotAnomaly>[] = [
    { id: 'date', header: 'Snapshot', value: (a) => a.date, format: 'date' },
    { id: 'firm', header: 'Dealer / firm', value: (a) => titleCase(a.firmName.toLowerCase()), render: (a) => <DealerLink dealerKey={a.entityKey} tab="loyalty">{titleCase(a.firmName.toLowerCase())}</DealerLink> },
    { id: 'id', header: 'Customer ID', value: (a) => a.entityKey },
    { id: 'kind', header: 'Issue', value: (a) => a.kind },
    { id: 'detail', header: 'Detail', value: (a) => a.detail, width: 420 },
  ];
  const changeCols: Col<DealerChange>[] = [
    { id: 'firm', header: 'Dealer / firm', value: (c) => titleCase(c.firmName.toLowerCase()), width: 220, render: (c) => <DealerLink dealerKey={c.entityKey} tab="loyalty">{titleCase(c.firmName.toLowerCase())}</DealerLink> },
    { id: 'id', header: 'Customer ID', value: (c) => c.entityKey },
    { id: 'from', header: `Current on ${prev?.date ?? ''}`, value: (c) => c.currentFrom, format: 'int' },
    { id: 'to', header: `Current on ${snap?.date ?? ''}`, value: (c) => c.currentTo, format: 'int' },
    { id: 'd', header: 'Change', value: (c) => c.deltaCurrent, format: 'int' },
    { id: 'dl', header: 'Change in lifetime points', value: (c) => c.deltaLifetime, format: 'int' },
    { id: 'flags', header: 'Flags', value: (c) => c.flags.join(', '), hidden: true },
  ];

  const series = sel && sel.idKind === 'verified' ? dealerSeries(snaps, sel.entityKey) : [];
  const likeForLike = changes.filter((c) => c.deltaCurrent !== null);
  const lflDelta = likeForLike.reduce((a, c) => a + (c.deltaCurrent ?? 0), 0);
  const exportNotes = describeFilters(cf, DIM_LABELS, [`Snapshot: ${snap?.date ?? ''}`, 'Balances are point-in-time and are not summed across snapshots']);

  const tabs: Array<{ id: TabId; label: string; badge?: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members', badge: fInt(filtered.length) },
    ...(prev && likeForLike.length > 0 ? [{ id: 'changes' as TabId, label: 'Changes', badge: fInt(changes.length) }] : []),
    { id: 'snapshots', label: 'Snapshots', badge: fInt(totals.length) },
    ...(realAnomalies.length > 0 ? [{ id: 'anomalies' as TabId, label: 'Anomalies', badge: fInt(realAnomalies.length) }] : []),
  ];
  const tab = (tabs.some((x) => x.id === tabRaw) ? tabRaw : 'overview') as TabId;
  const openRow = (r: Row) => (r.idKind === 'verified' ? profile.open(r.entityKey, 'loyalty') : setSel(r));
  const topRows = [...rows].filter((r) => r.idKind === 'verified' && (r.current ?? 0) > 0).sort((a, b) => (b.current ?? 0) - (a.current ?? 0)).slice(0, 10);
  const moverBars = [...changes]
    .filter((c) => c.deltaCurrent)
    .sort((a, b) => Math.abs(b.deltaCurrent ?? 0) - Math.abs(a.deltaCurrent ?? 0))
    .slice(0, 10)
    .map((c) => ({ key: c.entityKey, label: titleCase(c.firmName.toLowerCase()), value: c.deltaCurrent ?? 0, color: (c.deltaCurrent ?? 0) >= 0 ? '#1baf7a' : '#C8202F' }));
  const validTotals = totals.filter((x) => x.verified > 0);

  return (
    <DataGate need={['loyalty_snapshot']} what="Hero Smiles (Capillary)">
      <PageHeader
        title="Hero Smiles"
        actions={
          snaps.length > 0 && (
            <>
              <Badge tone="neutral" icon={false}>Balances · not period-filtered</Badge>
              <label className="flex items-center gap-2 text-xs text-ink-2">
              Snapshot
              <select className="input py-1" value={snap?.date ?? ''} onChange={(e) => setDate(e.target.value)} aria-label="Snapshot date">
                {snaps.map((x) => (
                  <option key={x.date} value={x.date}>
                    {fDate(x.date)}
                    {isValidSnapshot(x) ? '' : ' (no verified IDs)'}
                  </option>
                ))}
              </select>
              </label>
            </>
          )
        }
      />
      <FilterBar cf={cf} fields={filterFields} />
      {t && snap && (
        <>
          <KpiGrid cols={5}>
            <KpiCard label="Current points" icon={Star} value={fInt(t.current)} sub={`balance on ${fDate(snap.date)}`} info={{ formula: 'Σ current points across members of THIS snapshot', exclusions: 'Never added to other snapshots: each snapshot is a balance, not a flow.' }} onClick={() => setTab('members')} hint="Opens the member list." />
            <KpiCard label="Members" icon={Users} value={fInt(t.rows)} sub={`${fInt(t.verified)} with a dealer code`} info={{ formula: 'Rows in the selected snapshot', exclusions: 'Exact duplicate rows.' }} onClick={() => (cf.clear(), setTab('members'))} hint="Clears filters and opens the member list." />
            <KpiCard label="Members with a balance" icon={Award} value={fInt(t.positiveBalances)} info={{ formula: 'Members whose current points are greater than 0 on the snapshot date' }} onClick={() => (cf.toggle('balance', 'positive', 'With a balance'), setTab('members'))} active={cf.has('balance', 'positive')} />
            <KpiCard label="Lifetime points" icon={TrendingUp} value={fInt(t.lifetime)} sub={`balance on ${fDate(snap.date)}`} info={{ formula: 'Σ lifetime points across members of THIS snapshot' }} />
            <KpiCard
              label="Change since previous snapshot"
              icon={Activity}
              value={prev ? `${lflDelta >= 0 ? '+' : '−'}${fInt(Math.abs(lflDelta))}` : '—'}
              unavailable={!prev ? 'Needs an earlier snapshot' : undefined}
              sub={prev ? `${fInt(likeForLike.length)} dealers in both snapshots` : undefined}
              tone={prev ? (lflDelta >= 0 ? 'good' : 'bad') : undefined}
              info={{ formula: 'Σ (current points now − current points in the previous snapshot) over dealer codes present in both', exclusions: 'New, dropped and unverified members.' }}
              onClick={prev ? () => setTab('changes') : undefined}
              hint="Opens the dealer-by-dealer changes."
            />
          </KpiGrid>
          <MoreMeasures>
            <KpiCard compact label="Points issued" icon={CalendarClock} value={fInt(t.issued)} info={{ formula: 'Σ issued points column of THIS snapshot', exclusions: 'The accumulation window of this column is not stated in the export.' }} />
            <KpiCard compact label="Members with orders" icon={ShoppingCart} value={fInt(rows.filter((r) => (r.appOrders ?? 0) > 0 || (r.dsOrders ?? 0) > 0).length)} sub={`of ${fInt(t.verified)} with a dealer code`} info={{ formula: 'Members whose dealer code has at least one eligible order in either system (all imported periods)' }} />
            <KpiCard compact label="Members without a dealer code" icon={AlertTriangle} value={fInt(t.unverified)} tone={t.unverified ? 'warn' : 'neutral'} info={{ formula: 'Members whose customer ID is not a dealer code', exclusions: 'They are shown but left out of dealer joins and changes.' }} onClick={() => (cf.toggle('kind', 'unverified', 'No dealer code'), setTab('members'))} active={cf.has('kind', 'unverified')} />
            <KpiCard compact label="Anomalies" icon={AlertTriangle} value={fInt(realAnomalies.length)} tone={realAnomalies.length ? 'warn' : 'neutral'} info={{ formula: 'Lifetime points that fell, balances that do not reconcile, opening ≠ previous closing' }} onClick={realAnomalies.length ? () => setTab('anomalies') : undefined} />
          </MoreMeasures>
        </>
      )}

      <div className="mt-5" />
      <Tabs<TabId> label="Hero Smiles" value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Current points by snapshot" subtitle="Each bar is the balance on one day. Click a bar to view that snapshot." table={{ columns: [{ header: 'Snapshot' }, { header: 'Current points', format: 'int' }, { header: 'Members', format: 'int' }], rows: validTotals.map((x) => [fDate(x.date), x.current, x.rows]) }}>
            <BarsChart layout="vertical" color="#eda100" seriesName="Current points" onSelect={(key) => setDate(key)} activeKey={snap?.date} data={validTotals.map((x) => ({ key: x.date, label: fDate(x.date).slice(0, 6), value: x.current }))} />
          </ChartCard>
          <ChartCard title={`Top 10 balances on ${snap ? fDate(snap.date) : ''}`} subtitle="Click a dealer to open the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Current points', format: 'int' }], rows: topRows.map((r) => [titleCase(r.firmName.toLowerCase()), r.current]) }}>
            <BarsChart seriesName="Current points" color="#eda100" onSelect={(key) => profile.open(key, 'loyalty')} data={topRows.map((r) => ({ key: r.entityKey, label: titleCase(r.firmName.toLowerCase()), value: r.current ?? 0 }))} />
          </ChartCard>
          {prev && moverBars.length > 0 && (
            <ChartCard title="Largest changes since the previous snapshot" subtitle="Gains in green, falls in red. Click a dealer to open the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Change', format: 'int' }], rows: moverBars.map((r) => [r.label, r.value]) }}>
              <BarsChart seriesName="Change in points" onSelect={(key) => profile.open(key, 'loyalty')} data={moverBars} />
            </ChartCard>
          )}
        </div>
      )}

      {tab === 'members' && <DataTable title={`Members on ${snap ? fDate(snap.date) : ''} (${fInt(filtered.length)})`} rows={filtered} columns={cols} getRowId={(r) => r.key} fullRows={data.loyalty as Row[]} exportName="HeroSmiles_members" exportNotes={exportNotes} initialSort={{ id: 'cur', desc: true }} onRowClick={openRow} selectedId={sel?.key} searchPlaceholder="Search dealers…" />}

      {tab === 'changes' && prev && <DataTable title="Change since the previous snapshot" rows={changes} columns={changeCols} getRowId={(c) => c.entityKey} exportName="HeroSmiles_changes" exportNotes={exportNotes} initialSort={{ id: 'd', desc: true }} onRowClick={(c) => profile.open(c.entityKey, 'loyalty')} pageSize={15} searchPlaceholder="Search dealers…" />}

      {tab === 'snapshots' && <DataTable title="Snapshots" rows={totals} columns={snapCols} getRowId={(x) => x.date} exportName="HeroSmiles_snapshots" exportNotes={exportNotes} onRowClick={(x) => (setDate(x.date), setTab('overview'))} selectedId={snap?.date} pageSize={10} />}

      {tab === 'anomalies' && <DataTable title="Anomalies across snapshots" rows={realAnomalies} columns={anomCols} getRowId={(a) => `${a.date}-${a.entityKey}-${a.kind}`} exportName="HeroSmiles_anomalies" exportNotes={exportNotes} pageSize={15} onRowClick={(a) => profile.open(a.entityKey, 'loyalty')} />}

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel ? titleCase(sel.firmName.toLowerCase()) : ''} subtitle={sel ? `Customer ID ${sel.customerId}` : undefined}>
        {sel && (
          <div className="space-y-4">
            <Facts items={[['ID check', sel.idKind === 'verified' ? 'Dealer code' : 'Not a dealer code, so it is not linked to orders'], ['Current points', fInt(sel.current)], ['Lifetime points', fInt(sel.lifetime)], ['Opening', fInt(sel.opening)], ['Issued', fInt(sel.issued)], ['Expired', fInt(sel.expired)], ['Adjustment', fInt(sel.adjustment)]]} />
            {series.length > 1 && (
              <ChartCard title="Balance across snapshots" subtitle="Each point is a separate day’s balance; they are not added." table={{ columns: [{ header: 'Snapshot' }, { header: 'Current', format: 'int' }, { header: 'Lifetime', format: 'int' }], rows: series.map((s) => [fDate(s.date), s.current, s.lifetime]) }}>
                <TrendChart height={220} data={series.map((s) => ({ key: s.date, label: fDate(s.date).slice(0, 6), current: s.current, lifetime: s.lifetime }))} series={[{ key: 'current', label: 'Current points', color: SERIES_COLOR.dealer }, { key: 'lifetime', label: 'Lifetime points', color: SERIES_COLOR.ds }]} />
              </ChartCard>
            )}
          </div>
        )}
      </Drawer>
    </DataGate>
  );
}
