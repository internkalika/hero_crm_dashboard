// Dealer App vs DataSense SFA: the one comparison page, and the page the dashboard opens on.
//
// The question it answers is "is the Dealer App helping Hero Cycles grow its business, compared with the existing SFA
// channel?". It compares two explicit date windows of the same length (the reporting period and the comparison
// period), puts Dealer App and DataSense side by side on every measure (cards, bridge, monthly and weekly charts), asks
// dealer by dealer whether the combined business grew or merely moved between channels, and keeps the grouped
// dealer-by-dealer comparison table. Order value is sales, never profit: the supplied files contain no cost data.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banknote, Boxes, Layers, Link2, Percent } from 'lucide-react';
import { useData } from '../state/DataContext';
import { DataGate } from '../components/States';
import { KpiCard, KpiGrid } from '../components/KpiCard';
import { DataTable } from '../components/DataTable';
import { DealerLink } from '../components/DealerLink';
import { DownloadMenu } from '../components/DownloadMenu';
import { FilterBar, FilterField, MultiSelect } from '../components/FilterBar';
import { describeFilters, useDealerProfile, useQueryWriter } from '../components/filters';
import { Badge, Notice, PageHeader, SectionTitle, Segmented } from '../components/ui';
import type { Col } from '../lib/export/excel';
import { downloadXlsx, stamp } from '../lib/export/excel';
import { fInrCompact, fInt } from '../lib/export/format';
import { dealerAppAdoption } from '../lib/metrics/adoption';
import { ALL_PERIOD } from '../lib/metrics/period';
import { GrowthOrder, buildGrowth, growthCatalogue } from '../lib/metrics/growth';
import { inspectProfitability } from '../lib/metrics/profitability';
import { modelOf, sliceOptions, wheelSizeLabel, wheelSizeOf, wheelSizeOrder } from '../lib/metrics/models';
import { dealerGrowthSheet, growthNotes, growthOrdersSheet, kpiSheet, monthlySheet, profitabilitySheet } from '../lib/export/growth';
import { FilterSpec, pageLink } from '../lib/nav/links';
import { AdoptionCharts } from './growth/AdoptionCharts';
import { ChannelCharts } from './growth/Charts';
import { ComparisonTableSection } from './growth/ComparisonTableSection';
import { Controls } from './growth/Controls';
import { PairGrid } from './growth/ComparisonCards';
import { ClassTiles, DealerCharts, DealerHeat, DealerTable } from './growth/DealerSection';
import { Drivers } from './growth/Drivers';
import { MbdSection, Profitability } from './growth/ProfitMbd';
import { DIM_LABELS, SECTIONS, fSignedPct, sectionId, useGrowthState } from './growth/shared';

const jump = (show: string) => {
  const id = sectionId(show);
  if (id) window.setTimeout(() => document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
};

export default function GrowthComparison() {
  const { data, settings, crosswalk, setCustomRange } = useData();
  const st = useGrowthState();
  const { cf, input } = st;
  const navigate = useNavigate();
  const write = useQueryWriter();
  const { open } = useDealerProfile();
  const [ow, setOw] = useState<'all' | 'reporting' | 'comparison'>('all');
  const [och, setOch] = useState<'all' | 'dealer' | 'ds'>('all');

  const model = useMemo(() => buildGrowth(data, settings, input), [data, settings, input]);
  const catalogue = useMemo(() => growthCatalogue(data), [data]);
  const profit = useMemo(() => inspectProfitability(data), [data]);
  // adoption is looked at over everything imported, whichever reporting period is chosen above
  const adoption = useMemo(() => dealerAppAdoption(data, ALL_PERIOD, settings, crosswalk), [data, settings, crosswalk]);

  // ?show=<section> scrolls to it once and is then removed, so a link from another page (or a card) lands in the right place
  const [params] = useSearchParams();
  const showParam = params.get('show');
  useEffect(() => {
    if (!showParam) return;
    jump(showParam);
    write((q) => q.delete('show'));
  }, [showParam, write]);

  /** Applies an in-page link (`/?rp=…&cp=…&cls=…&f.status=…&show=…`) on top of the current address. */
  const go = useCallback(
    (to: string) => {
      if (!(to === '/' || to.startsWith('/?'))) {
        navigate(to);
        return;
      }
      const incoming = new URLSearchParams(to.slice(2));
      write((q) => {
        const dims = new Set<string>();
        incoming.forEach((_v, k) => (k.startsWith('f.') || k.startsWith('l.')) && dims.add(k.slice(2)));
        dims.forEach((d) => {
          q.delete(`f.${d}`);
          q.delete(`l.${d}`);
        });
        incoming.forEach((v, k) => (k === 'show' ? undefined : k.startsWith('f.') || k.startsWith('l.') ? q.append(k, v) : q.set(k, v)));
      });
      const s = incoming.get('show');
      if (s) jump(s);
    },
    [navigate, write],
  );

  /** Opens a channel's own page for the reporting period of this page (the header period is set to match). */
  const openChannel = (path: string) => {
    if (!model) return;
    setCustomRange(model.reporting.from, model.reporting.to);
    const spec: FilterSpec = cf.filters.dealer?.length ? { dealer: { values: cf.filters.dealer, labels: cf.filters.dealer.map((v) => cf.labelOf('dealer', v)) } } : {};
    navigate(pageLink(path, spec));
  };

  const dealerOptions = useMemo(
    () => [...catalogue].sort((a, b) => Number(b.onDealerApp) - Number(a.onDealerApp) || a.name.localeCompare(b.name)).map((d) => ({ value: d.key, label: `${d.name}${d.key.startsWith('name:') ? '' : ` · ${d.key}`}` })).filter((o) => !o.value.startsWith('name:')),
    [catalogue],
  );
  const filterFields: FilterField[] = useMemo(() => {
    const zones = [...new Set(catalogue.map((d) => d.zone ?? 'Not recorded'))].sort();
    const cities = [...new Set(catalogue.map((d) => d.city).filter((c): c is string => !!c))].sort();
    const titleCity = (c: string) => c.charAt(0) + c.slice(1).toLowerCase();
    const sizeCounts = new Map(sliceOptions(data.dealerLines, wheelSizeOf).map((o) => [o.value, o.count]));
    return [
      { dim: 'dealer', label: 'Dealer', allLabel: 'All dealers', search: true, options: dealerOptions },
      { dim: 'db', label: 'DB code', allLabel: 'All DB codes', search: true, options: dealerOptions.map((o) => ({ value: o.value, label: `${o.value} · ${o.label.split(' · ')[0]}` })) },
      { dim: 'outlet', label: 'Outlet ID', allLabel: 'All outlets', search: true, options: catalogue.filter((d) => d.outletId).map((d) => ({ value: d.outletId as string, label: `${d.outletId} · ${d.name}` })) },
      { dim: 'zone', label: 'Zone', allLabel: 'All zones', options: zones.map((z) => ({ value: z, label: z })) },
      { dim: 'city', label: 'City / territory', allLabel: 'All cities', search: true, options: cities.map((c) => ({ value: c, label: titleCity(c) })) },
      { dim: 'channel', label: 'Channel', allLabel: 'Both channels', options: [{ value: 'dealer', label: 'Dealer App' }, { value: 'ds', label: 'DataSense SFA' }] },
      { dim: 'model', label: 'Model (Dealer App)', allLabel: 'All models', search: true, options: sliceOptions(data.dealerLines, modelOf).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).map((o) => ({ value: o.value, label: o.value, count: o.count })) },
      { dim: 'size', label: 'Wheel size (Dealer App)', allLabel: 'All sizes', options: wheelSizeOrder([...sizeCounts.keys()]).map((k) => ({ value: k, label: wheelSizeLabel(k), count: sizeCounts.get(k) })) },
    ];
  }, [catalogue, dealerOptions, data.dealerLines]);

  // the dealer filters apply to the comparison table the same way they apply to the rest of the page
  const attrs = useMemo(() => new Map(catalogue.map((d) => [d.key, d])), [catalogue]);
  const dealerOk = useCallback(
    (code: string) => {
      const a = attrs.get(code);
      return cf.ok('dealer', code) && cf.ok('db', code) && cf.ok('outlet', a?.outletId ?? null) && cf.ok('zone', a?.zone ?? 'Not recorded') && cf.ok('city', a?.city ?? null);
    },
    [attrs, cf],
  );

  const orderCols: Col<GrowthOrder>[] = useMemo(
    () => [
      { id: 'sys', header: 'Channel', value: (o) => (o.system === 'dealer' ? 'Dealer App' : 'DataSense'), render: (o) => <Badge tone={o.system === 'dealer' ? 'bad' : 'info'} icon={false}>{o.system === 'dealer' ? 'Dealer App' : 'DataSense'}</Badge> },
      { id: 'win', header: 'Period', value: (o) => (o.window === 'reporting' ? 'Reporting' : 'Comparison') },
      { id: 'id', header: 'Order ID', value: (o) => o.orderId },
      { id: 'sap', header: 'SAP order no.', value: (o) => o.sapOrderId },
      { id: 'dealer', header: 'Dealer', value: (o) => o.dealerName, render: (o) => <DealerLink dealerKey={o.dealerKey} tab="orders">{o.dealerName}</DealerLink>, width: 220 },
      { id: 'code', header: 'DB code', value: (o) => (o.dealerKey && !o.dealerKey.startsWith('name:') ? o.dealerKey : null) },
      { id: 'date', header: 'Order date', value: (o) => o.date, format: 'date' },
      { id: 'status', header: 'Status', value: (o) => o.status },
      { id: 'qty', header: 'Cycles', value: (o) => o.qty, format: 'int' },
      { id: 'value', header: 'Order value', value: (o) => o.value, format: 'inr' },
      { id: 'counted', header: 'Counted', value: (o) => (o.duplicate ? 'No – same order as a Dealer App order' : o.eligible ? 'Yes' : 'No – rejected or zero value'), render: (o) => (o.duplicate ? <Badge tone="info" icon={false} title="This DataSense order carries the SAP number of a Dealer App order of the same dealer; it is counted once, as Dealer App.">Duplicate</Badge> : o.eligible ? <span className="text-xs text-ink-2">Yes</span> : <Badge tone="neutral" icon={false}>Not counted</Badge>) },
    ],
    [],
  );

  if (!model) {
    return (
      <DataGate any={['dealer_orders', 'ds_orders']} what="the Dealer App vs DataSense SFA comparison">
        <Notice tone="warn" title="No orders to compare">The imported order files contain no dated orders.</Notice>
      </DataGate>
    );
  }
  const m = model;
  const statusOptions = [...new Set(m.orders.map((o) => o.status))].sort().map((s) => ({ value: s, label: s, count: m.orders.filter((o) => o.status === s).length }));
  const statusField: FilterField = { dim: 'status', label: 'Order status', allLabel: 'All statuses', options: statusOptions };
  const shownOrders = m.orders.filter((o) => (ow === 'all' || o.window === ow) && (och === 'all' || o.system === och) && cf.ok('status', o.status));
  const notesFor = (extra: string[] = []) => describeFilters(cf, DIM_LABELS, growthNotes(m, extra));

  const downloads = (which: 'kpi' | 'monthly' | 'dealers' | 'orders' | 'all') => async () => {
    const sheets = {
      kpi: [kpiSheet(m)],
      monthly: [monthlySheet(m)],
      dealers: [dealerGrowthSheet(m)],
      orders: [growthOrdersSheet(m, shownOrders)],
      all: [kpiSheet(m), monthlySheet(m), dealerGrowthSheet(m), growthOrdersSheet(m, shownOrders)],
    }[which];
    const names = { kpi: 'Comparison_KPIs', monthly: 'Monthly_performance', dealers: 'Dealer_comparison', orders: 'Orders', all: 'Dealer_App_vs_DataSense_SFA' } as const;
    await downloadXlsx(sheets, { title: `CRM Tracker – Dealer App vs DataSense SFA (${names[which].replace(/_/g, ' ')})`, notes: notesFor() }, `${names[which]}_${stamp()}`);
  };

  // headline cards
  const cpShort = m.comparison?.label ?? '';
  const dealerLive = !!m.prev && m.prev.covered.dealer > 0;
  const dealerPartialBase = !!m.prev && !!m.comparison && m.prev.covered.dealer < m.comparison.days;
  const pts = m.cur.adoption !== null && m.prev?.adoption != null ? (m.cur.adoption - m.prev.adoption) * 100 : null;
  const growthTone = (pct: number | null | undefined) => (pct === null || pct === undefined ? 'neutral' : pct >= 0.02 ? 'good' : pct <= -0.02 ? 'bad' : 'warn');

  const openPair = (id: string) => {
    if (id === 'rejection') go('/?show=orders&f.status=Rejected&l.status=Rejected');
    else go('/?show=orders');
  };
  const onDealer = (key: string, name: string) => cf.toggle('dealer', key, name);
  /** A click on a week of the adoption charts reports on that week (to the cut-off at most). */
  const onWeek = (weekStart: string) => {
    const w = adoption?.weeks.find((x) => x.key === weekStart);
    if (w) st.setRp(`c:${w.from}..${w.to < m.span.cutoff ? w.to : m.span.cutoff}`);
  };

  return (
    <DataGate any={['dealer_orders', 'ds_orders']} what="the Dealer App vs DataSense SFA comparison">
      <PageHeader
        title="Dealer App vs DataSense SFA"
        actions={
          <DownloadMenu
            label="Download"
            items={[
              { label: 'Comparison KPIs (Excel)', run: downloads('kpi') },
              { label: 'Monthly performance (Excel)', run: downloads('monthly') },
              { label: 'Dealer comparison (Excel)', run: downloads('dealers') },
              { label: 'Orders behind these numbers (Excel)', run: downloads('orders') },
              { label: 'All four in one workbook', run: downloads('all') },
            ]}
          />
        }
      />

      <Controls span={m.span} reporting={m.reporting} comparison={m.comparison} rp={input.rp} cp={input.cp} cohort={input.cohort} onRp={st.setRp} onCp={st.setCp} onCohort={st.setCohort} onReset={st.reset} changed={st.changed} dealerCount={m.dealersInView} notes={m.notes}>
        <FilterBar cf={cf} fields={filterFields} embedded />
      </Controls>

      <nav aria-label="Sections of this page" className="no-print mb-3 flex flex-wrap gap-1.5 text-xs">
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => jump(id)} className="rounded-full border border-slate-300 bg-surface px-2.5 py-1 font-medium text-ink-2 hover:border-hero-600 hover:text-hero-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600">
            {label}
          </button>
        ))}
      </nav>

      <div id="g-kpis" className="scroll-mt-4">
        <KpiGrid cols={5}>
          <KpiCard compact icon={Banknote} label="Value growth" value={m.combinedValue && m.combinedValue.pct !== null ? fSignedPct(m.combinedValue.pct, 1) : '—'} sub={m.comparison && m.prev ? `${fInrCompact(m.prev.combined.value)} → ${fInrCompact(m.cur.combined.value)}` : undefined} unavailable={m.sliced ? 'DataSense has no model data' : !m.comparison ? 'Choose a comparison period' : m.combinedValue?.pct === null ? 'No value in the comparison period' : undefined} onClick={() => go('/?show=trends')} hint="Opens the monthly trends." info={{ formula: '(Combined order value now − before) ÷ before, Dealer App + DataSense, each order counted once', exclusions: 'Sales value, not profit.' }} tone={growthTone(m.combinedValue?.pct)} />
          <KpiCard compact icon={Boxes} label="Volume growth" value={m.combinedQty && m.combinedQty.pct !== null ? fSignedPct(m.combinedQty.pct, 1) : '—'} sub={m.comparison && m.prev ? `${fInt(m.prev.combined.qty)} → ${fInt(m.cur.combined.qty)} cycles` : undefined} unavailable={m.sliced ? 'DataSense has no model data' : !m.comparison ? 'Choose a comparison period' : m.combinedQty?.pct === null ? 'No quantity in the comparison period' : undefined} onClick={() => go('/?show=trends')} hint="Opens the monthly trends." info={{ formula: '(Combined cycles quantity now − before) ÷ before', exclusions: 'Spares.' }} tone={growthTone(m.combinedQty?.pct)} />
          <KpiCard compact icon={Link2} label="Ordering in both channels" value={fInt(m.cur.commonActive)} sub={`of ${fInt(m.cur.activeEither)} active dealers`} trend={m.prev ? { text: `${m.cur.commonActive - m.prev.commonActive >= 0 ? '+' : '−'}${Math.abs(m.cur.commonActive - m.prev.commonActive)} vs ${fInt(m.prev.commonActive)} before`, dir: m.cur.commonActive > m.prev.commonActive ? 'up' : m.cur.commonActive < m.prev.commonActive ? 'down' : 'flat', good: true } : undefined} onClick={() => go('/?show=table')} hint="Opens the dealer comparison table." info={{ formula: 'Dealers with an eligible order in the Dealer App AND in DataSense in the reporting period', exclusions: 'Matched on the ERP dealer code only.' }} />
          <KpiCard compact icon={Percent} label="Dealer App adoption" value={m.cur.adoption === null ? '—' : `${(m.cur.adoption * 100).toFixed(0)}%`} sub="of active dealers ordered via the app" unavailable={m.channels.dealer ? undefined : 'Dealer App is not shown'} trend={pts !== null && dealerLive ? { text: `${pts >= 0 ? '+' : '−'}${Math.abs(pts).toFixed(0)} pts vs ${cpShort}${dealerPartialBase ? ' · indicative' : ''}`, dir: pts > 0 ? 'up' : pts < 0 ? 'down' : 'flat', good: dealerPartialBase ? undefined : true } : undefined} onClick={() => go('/?show=adoption')} hint="Opens the adoption charts." info={{ formula: 'Dealers with an eligible Dealer App order ÷ dealers with an eligible order in either channel', exclusions: dealerLive ? undefined : 'No comparison: the Dealer App had not started in the comparison period.' }} />
          <KpiCard compact icon={Layers} label="Margin / profit" value="Not verified" unavailable="No cost data in any imported file" onClick={() => go('/?show=profit')} hint="Opens what is missing." info={{ formula: 'Needs cost of goods, discounts, returns, freight and incentives, none of which are in the files.' }} />
        </KpiGrid>
        <div className="mt-3">
          <PairGrid m={m} onOpen={openPair} />
        </div>
      </div>

      <SectionTitle>What changed</SectionTitle>
      <Drivers m={m} onGo={go} />

      <div id="g-trends" className="scroll-mt-4">
        <SectionTitle>Trends</SectionTitle>
        <ChannelCharts m={m} onMonth={(month) => st.setRp(`m:${month}`)} onChannel={(ch) => cf.toggle('channel', ch, ch === 'dealer' ? 'Dealer App' : 'DataSense SFA')} />
      </div>

      {adoption && adoption.weeks.length > 1 && (
        <div id="g-adoption" className="scroll-mt-4">
          <SectionTitle>Dealer App adoption</SectionTitle>
          <AdoptionCharts adoption={adoption} onWeek={onWeek} />
        </div>
      )}

      <div id="g-dealers" className="scroll-mt-4">
        <SectionTitle>New business or moved business</SectionTitle>
        <ClassTiles m={m} active={st.cls} onPick={st.setCls} />
        <div className="mt-4">
          <DealerCharts m={m} rows={m.rows} onDealer={onDealer} activeDealers={cf.filters.dealer ?? []} />
        </div>
        <div className="mt-4">
          <DealerHeat m={m} onDealer={onDealer} />
        </div>
        <div className="mt-4">
          <DealerTable m={m} rows={m.rows} cls={st.cls} onRow={(r) => r.dbCode && open(r.dbCode, 'comparison')} notes={notesFor()} />
        </div>
      </div>

      <div id="g-table" className="scroll-mt-4">
        <SectionTitle>Comparison table</SectionTitle>
        <ComparisonTableSection dealerOk={dealerOk} />
      </div>

      <div id="g-profit" className="scroll-mt-4">
        <SectionTitle>Profitability</SectionTitle>
        <Profitability check={profit} m={m} onDownload={async () => downloadXlsx([profitabilitySheet(data)], { title: 'CRM Tracker – data needed to verify profitability', notes: [profit.statement] }, `Profitability_data_needed_${stamp()}`)} />
      </div>

      <div id="g-mbd" className="scroll-mt-4">
        <SectionTitle>Models billed per dealer (MBD)</SectionTitle>
        <MbdSection m={m} onModels={() => navigate('/dealer/orders?tab=models')} onDealer={onDealer} />
      </div>

      <div id="g-orders" className="scroll-mt-4">
        <SectionTitle
          right={
            <span className="flex gap-3 text-xs">
              <button type="button" className="font-semibold text-hero-700 hover:underline" onClick={() => openChannel('/dealer/orders')}>Dealer App orders →</button>
              <button type="button" className="font-semibold text-hero-700 hover:underline" onClick={() => openChannel('/datasense/orders')}>DataSense orders →</button>
            </span>
          }
        >
          Orders behind these numbers
        </SectionTitle>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Segmented<'all' | 'reporting' | 'comparison'> label="Period" value={ow} onChange={setOw} options={[{ value: 'all', label: 'Both periods' }, { value: 'reporting', label: 'Reporting' }, { value: 'comparison', label: 'Comparison' }]} />
          <Segmented<'all' | 'dealer' | 'ds'> label="Channel" value={och} onChange={setOch} options={[{ value: 'all', label: 'Both channels' }, { value: 'dealer', label: 'Dealer App' }, { value: 'ds', label: 'DataSense' }]} />
          <MultiSelect field={statusField} selected={cf.filters.status ?? []} selectedLabels={cf.labels.status} onApply={(v, l) => cf.setMany('status', v, l)} />
          <span className="text-xs text-ink-3">{fInt(shownOrders.length)} orders</span>
        </div>
        <DataTable rows={shownOrders} columns={orderCols} getRowId={(o) => o.key} exportName="Dealer_App_vs_DataSense_orders" exportNotes={notesFor()} initialSort={{ id: 'date', desc: true }} pageSize={10} onRowClick={(o) => o.dealerKey && !o.dealerKey.startsWith('name:') && open(o.dealerKey, 'orders')} searchPlaceholder="Search order, SAP number or dealer…" emptyText="No orders match these filters." />
      </div>
    </DataGate>
  );
}
