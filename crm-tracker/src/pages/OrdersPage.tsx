import { useMemo, useState } from 'react';
import { Boxes, Coins, IndianRupee, Layers, Receipt, Scale, ScrollText, ShoppingCart, Sparkles, Store, Users } from 'lucide-react';
import { useData } from '../state/DataContext';
import { DataGate, PeriodGate } from '../components/States';
import { KpiCard, KpiGrid } from '../components/KpiCard';
import { MoreMeasures } from '../components/MoreMeasures';
import { BarsChart, ChartCard, DonutChart, StackedBarsChart, statusColor } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { DealerLink } from '../components/DealerLink';
import { Tabs } from '../components/Tabs';
import { describeFilters, useCrossFilter, useDealerProfile, useUrlValue } from '../components/filters';
import { FilterBar, FilterField, buildOptions } from '../components/FilterBar';
import { Drawer, Facts } from '../components/Drawer';
import { Badge, InfoTip, PageHeader } from '../components/ui';
import type { Col } from '../lib/export/excel';
import { fDate, fInr, fInrCompact, fInt, fPct, fDec } from '../lib/export/format';
import { buildDealerOrders, dsOrderSummaries, groupOrders, GroupRow, isEligible, orderKpis, STATUS_LABELS } from '../lib/metrics/orders';
import { eligibleLines, inSlice, LineSlice, modelOf, ModelRow, MbdDealer, modelRows, modelsBilledPerDealer, sliceOptions, wheelSizeLabel, wheelSizeOf, wheelSizeOrder } from '../lib/metrics/models';
import { dateInPeriod } from '../lib/metrics/period';
import { isValidatedDealerKey } from '../lib/nav/links';
import type { DealerOrderLine, OrderStatusGroup, OrderSummary } from '../lib/types';
import { OrderStatusBadge, monthKeyLabel, periodNote } from './common';
import { titleCase } from '../lib/util/parse';
import { SERIES_COLOR } from '../components/charts';

type Sys = 'dealer' | 'ds';
type TabId = 'trends' | 'dealers' | 'orders' | 'models';

const DIM_LABELS: Record<string, string> = { status: 'Status', month: 'Month', dealer: 'Dealer', db: 'DB code', outlet: 'Outlet ID', region: 'Zone/City', city: 'City', role: 'Role', employee: 'Employee', band: 'Order size', model: 'Model', size: 'Wheel size', kpi: 'Measure' };
const NOT_SPECIFIED = 'Not specified';

const BANDS: Array<{ key: string; label: string; min: number; max: number }> = [
  { key: 'b1', label: 'Under ₹50K', min: 0, max: 50_000 },
  { key: 'b2', label: '₹50K–1L', min: 50_000, max: 100_000 },
  { key: 'b3', label: '₹1–2L', min: 100_000, max: 200_000 },
  { key: 'b4', label: '₹2–5L', min: 200_000, max: 500_000 },
  { key: 'b5', label: '₹5–10L', min: 500_000, max: 1_000_000 },
  { key: 'b6', label: '₹10L+', min: 1_000_000, max: Infinity },
];
const bandOf = (v: number | null) => (v === null ? null : BANDS.find((b) => v >= b.min && v < b.max)?.key ?? null);

function OrdersPage({ system }: { system: Sys }) {
  const { data, period, settings, focusMonth } = useData();
  const cf = useCrossFilter();
  const { open: openProfile } = useDealerProfile();
  const [tabRaw, setTab] = useUrlValue('tab', 'trends');
  const isDealerSys = system === 'dealer';
  const tab = ((isDealerSys ? ['trends', 'dealers', 'models', 'orders'] : ['trends', 'dealers', 'orders']).includes(tabRaw) ? tabRaw : 'trends') as TabId;
  const [selected, setSelected] = useState<OrderSummary | null>(null);
  const isDealer = system === 'dealer';
  const label = isDealer ? 'Dealer App' : 'DataSense SFA';
  const color = isDealer ? SERIES_COLOR.dealer : SERIES_COLOR.ds;

  const allOrders = useMemo(() => (isDealer ? buildDealerOrders(data.dealerLines) : dsOrderSummaries(data.dsOrders)), [data.dealerLines, data.dsOrders, isDealer]);
  const months = useMemo(() => [...new Set(allOrders.map((o) => o.month).filter(Boolean) as string[])].sort(), [allOrders]);
  const orders = useMemo(() => allOrders.filter((o) => dateInPeriod(o.date, period)), [allOrders, period]);

  const regionOf = (o: OrderSummary) => (isDealer ? o.zone : o.city);
  const dealerLabel = (o: OrderSummary) => o.dealerName || o.dealerKey || '—';
  const dealerKeyOf = (o: OrderSummary) => o.dealerKey ?? `name:${o.dealerName}`;

  // Model and wheel size slice the order LINES: with either chosen, every order is rebuilt from only its lines of that model
  // / size, so orders, value, quantity and fulfilment below describe that model and not the whole basket it came in.
  // The other filters (status, zone, order size ...) are judged on the whole order.
  const modelSel = isDealer ? cf.filters.model : undefined;
  const sizeSel = isDealer ? cf.filters.size : undefined;
  const slice: LineSlice = useMemo(() => ({ model: modelSel, size: sizeSel }), [modelSel, sizeSel]);
  const sliced = !!(modelSel || sizeSel);
  const slicedById = useMemo(() => (sliced ? new Map(buildDealerOrders(data.dealerLines.filter((l) => inSlice(l, slice))).map((o) => [o.orderId, o])) : null), [sliced, data.dealerLines, slice]);
  const inView = useMemo(() => (slicedById ? orders.flatMap((o) => slicedById.get(o.orderId) ?? []) : orders), [orders, slicedById]);

  const filtered = useMemo(() => {
    const f = cf.filters;
    const passing = orders.filter((o) => {
      if (!cf.ok('status', o.statusGroup)) return false;
      if (!cf.ok('dealer', dealerKeyOf(o))) return false;
      if (!cf.ok('db', o.dealerKey)) return false;
      if (!cf.ok('outlet', o.outletId)) return false;
      if (!cf.ok('region', (regionOf(o) ?? NOT_SPECIFIED))) return false;
      if (!cf.ok('city', (o.city ?? NOT_SPECIFIED))) return false;
      if (!cf.ok('role', (o.role ?? NOT_SPECIFIED))) return false;
      if (!cf.ok('employee', (o.employee ?? NOT_SPECIFIED))) return false;
      if (!cf.ok('band', bandOf(o.value))) return false;
      if (cf.has('kpi', 'zero') && !(o.value === null || o.value <= 0)) return false;
      if (cf.has('kpi', 'rejected') && o.statusGroup !== 'rejected') return false;
      if (cf.has('kpi', 'unfulfilled') && !(isEligible(o, { includeRejected: false }) && o.statusGroup !== 'fulfilled')) return false;
      return true;
    });
    return slicedById ? passing.flatMap((o) => slicedById.get(o.orderId) ?? []) : passing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, cf, isDealer, slicedById]);

  // Model and wheel size choices come from the order lines of the selected period; the number is how many orders contain it.
  const periodLines = useMemo(() => (isDealer ? data.dealerLines.filter((l) => dateInPeriod(l.orderDate, period)) : []), [isDealer, data.dealerLines, period]);
  const modelOptions = useMemo(() => sliceOptions(periodLines, modelOf).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).map((o) => ({ value: o.value, label: o.value, count: o.count })), [periodLines]);
  const sizeOptions = useMemo(() => {
    const counts = new Map(sliceOptions(periodLines, wheelSizeOf).map((o) => [o.value, o.count]));
    return wheelSizeOrder([...counts.keys()]).map((k) => ({ value: k, label: wheelSizeLabel(k), count: counts.get(k) }));
  }, [periodLines]);

  // The filter bar offers what this page's own orders contain in the selected period (never a fixed list).
  const filterFields: FilterField[] = useMemo(() => {
    const nice = (k: string) => titleCase(k.toLowerCase());
    return [
      { dim: 'status', label: 'Status', allLabel: 'All statuses', options: buildOptions(orders, (o) => o.statusGroup, { label: (k) => STATUS_LABELS[k as OrderStatusGroup] ?? k }) },
      { dim: 'region', label: isDealer ? 'Zone' : 'City', allLabel: isDealer ? 'All zones' : 'All cities', search: !isDealer, options: buildOptions(orders, (o) => (isDealer ? o.zone : o.city) ?? NOT_SPECIFIED, { label: nice }) },
      ...(isDealer
        ? [{ dim: 'city', label: 'City', allLabel: 'All cities', search: true, options: buildOptions(orders, (o) => o.city ?? NOT_SPECIFIED, { label: nice }) } as FilterField]
        : [
            { dim: 'role', label: 'Role', allLabel: 'All roles', options: buildOptions(orders, (o) => o.role ?? NOT_SPECIFIED) } as FilterField,
            { dim: 'employee', label: 'Employee', allLabel: 'All employees', search: true, options: buildOptions(orders, (o) => o.employee ?? NOT_SPECIFIED, { label: nice }) } as FilterField,
          ]),
      { dim: 'dealer', label: 'Dealer / distributor', allLabel: 'All dealers', search: true, options: buildOptions(orders, (o) => o.dealerKey ?? `name:${o.dealerName}`, { label: (_k, s) => `${nice(s.dealerName || s.dealerKey || '—')}${isValidatedDealerKey(s.dealerKey) ? ` · ${s.dealerKey}` : ''}` }) },
      { dim: 'db', label: 'DB code', allLabel: 'All DB codes', search: true, options: buildOptions(orders, (o) => (isValidatedDealerKey(o.dealerKey) ? o.dealerKey : null), { sort: 'value', label: (k, s) => `${k} · ${nice(s.dealerName || '—')}` }) },
      ...(isDealer ? [{ dim: 'outlet', label: 'Outlet ID', allLabel: 'All outlets', search: true, options: buildOptions(orders, (o) => o.outletId, { sort: 'value', label: (k, s) => `${k} · ${nice(s.dealerName || '—')}` }) } as FilterField] : []),
      { dim: 'band', label: 'Order size', allLabel: 'All sizes', options: buildOptions(orders, (o) => bandOf(o.value), { sort: BANDS.map((b) => b.key), label: (k) => BANDS.find((b) => b.key === k)?.label ?? k }) },
      ...(isDealer ? [
        { dim: 'model', label: 'Model', allLabel: 'All models', search: true, options: modelOptions } as FilterField,
        { dim: 'size', label: 'Wheel size', allLabel: 'All wheel sizes', options: sizeOptions } as FilterField,
      ] : []),
    ];
  }, [orders, isDealer, modelOptions, sizeOptions]);

  const k = useMemo(() => orderKpis(filtered, settings, system), [filtered, settings, system]);
  const eligible = useMemo(() => filtered.filter((o) => isEligible(o, settings)), [filtered, settings]);
  const viewLines = useMemo(() => (isDealer ? eligibleLines(data.dealerLines, filtered, settings, slice) : []), [isDealer, data.dealerLines, filtered, settings, slice]);
  const skuCount = useMemo(() => (isDealer ? new Set(viewLines.map((l) => l.skuCode ?? l.sku ?? l.key)).size : null), [isDealer, viewLines]);
  const mbd = useMemo(() => modelsBilledPerDealer(viewLines), [viewLines]);
  const modelTable = useMemo(() => modelRows(viewLines), [viewLines]);
  const mbdDealers = useMemo(() => [...mbd.perDealer.values()].sort((a, b) => b.modelsBilled - a.modelsBilled || b.billedQty - a.billedQty || a.label.localeCompare(b.label)), [mbd]);

  const byMonth = useMemo(() => {
    const m = new Map<string, OrderSummary[]>();
    inView.forEach((o) => o.month && m.set(o.month, [...(m.get(o.month) ?? []), o]));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, os]) => ({ month, k: orderKpis(os, settings, system) }));
  }, [inView, settings, system]);

  const statusRows = useMemo(() => {
    const m = new Map<OrderStatusGroup, number>();
    filtered.forEach((o) => m.set(o.statusGroup, (m.get(o.statusGroup) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const dealerRows = useMemo(
    () => groupOrders(filtered, settings, dealerKeyOf, (_key, rs) => dealerLabel(rs[0])).sort((a, b) => b.value - a.value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, settings],
  );
  const topByCount = useMemo(() => [...dealerRows].sort((a, b) => b.orders - a.orders || b.value - a.value).slice(0, 10), [dealerRows]);
  const regionRows = useMemo(() => groupOrders(filtered, settings, (o) => regionOf(o) ?? 'Not specified').sort((a, b) => b.value - a.value), [filtered, settings, isDealer]); // eslint-disable-line react-hooks/exhaustive-deps
  const empRows = useMemo(() => (isDealer ? [] : groupOrders(filtered, settings, (o) => o.employee ?? 'Not specified').sort((a, b) => b.value - a.value)), [filtered, settings, isDealer]);
  const bandRows = useMemo(() => BANDS.map((b) => ({ key: b.key, label: b.label, value: eligible.filter((o) => bandOf(o.value) === b.key).length })), [eligible]);

  const orderCols: Col<OrderSummary>[] = useMemo(
    () => [
      { id: 'orderId', header: 'Order ID', value: (o) => o.orderId, width: 130 },
      { id: 'date', header: 'Order date', value: (o) => o.date, format: 'date' },
      { id: 'dealer', header: 'Dealer', value: (o) => dealerLabel(o), width: 200, render: (o) => <DealerLink dealerKey={o.dealerKey}>{titleCase(dealerLabel(o).toLowerCase())}</DealerLink> },
      { id: 'code', header: 'Dealer code', value: (o) => o.dealerKey },
      { id: 'region', header: isDealer ? 'Zone' : 'City', value: (o) => regionOf(o) },
      ...(isDealer ? [{ id: 'city', header: 'City', value: (o: OrderSummary) => o.city, hidden: true } as Col<OrderSummary>] : [{ id: 'emp', header: 'Employee', value: (o: OrderSummary) => o.employee } as Col<OrderSummary>, { id: 'role', header: 'Role', value: (o: OrderSummary) => o.role, hidden: true } as Col<OrderSummary>]),
      ...(isDealer ? [{ id: 'models', header: 'Models', value: (o: OrderSummary) => (o.models ?? []).join(', '), width: 220, help: 'Models (Sku_Brand) on the order’s lines' } as Col<OrderSummary>] : []),
      { id: 'status', header: 'Status', value: (o) => STATUS_LABELS[o.statusGroup], render: (o) => <OrderStatusBadge s={o.statusGroup} /> },
      { id: 'value', header: 'Order value', value: (o) => o.value, format: 'inr', help: isDealer ? 'Sum of line Amount for the order' : 'value of Order' },
      { id: 'qty', header: 'Cycles qty', value: (o) => o.qty, format: 'int' },
      { id: 'asp', header: 'ASP (cycles)', value: (o) => (o.qty && o.qty > 0 && o.cyclesValue !== null ? o.cyclesValue / o.qty : null), format: 'inr', hidden: true, help: 'Cycles value ÷ cycles quantity' },
      ...(isDealer
        ? [
            { id: 'fq', header: 'Fulfilled qty', value: (o: OrderSummary) => o.fulfilledQty, format: 'int' } as Col<OrderSummary>,
            { id: 'fr', header: 'Fulfilled %', value: (o: OrderSummary) => (o.fulfilledQty !== null && o.qty ? o.fulfilledQty / o.qty : null), format: 'pct' } as Col<OrderSummary>,
            { id: 'sap', header: 'SAP order ID', value: (o: OrderSummary) => o.sapOrderId, hidden: true } as Col<OrderSummary>,
          ]
        : [{ id: 'sap', header: 'Invoice / SAP ref', value: (o: OrderSummary) => o.sapOrderId, hidden: true } as Col<OrderSummary>]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDealer],
  );

  const dealerCols: Col<GroupRow>[] = [
    { id: 'label', header: 'Dealer', value: (r) => r.label, width: 220, render: (r) => <DealerLink dealerKey={r.key}>{titleCase(r.label.toLowerCase())}</DealerLink> },
    { id: 'orders', header: 'Orders', value: (r) => r.orders, format: 'int' },
    { id: 'value', header: 'Order value', value: (r) => r.value, format: 'inr' },
    { id: 'qty', header: 'Cycles qty', value: (r) => r.qty, format: 'int' },
    { id: 'aov', header: 'AOV', value: (r) => r.aov, format: 'inr' },
    { id: 'asp', header: 'ASP', value: (r) => r.asp, format: 'inr' },
    ...(isDealer ? [{ id: 'ful', header: 'Fulfilment %', value: (r: GroupRow) => r.fulfilmentRate, format: 'pct' } as Col<GroupRow>, { id: 'mbd', header: 'Models billed (MBD)', value: (r: GroupRow) => mbd.perDealer.get(r.key)?.modelsBilled ?? 0, format: 'int', help: 'Distinct models with at least one billed line for the dealer' } as Col<GroupRow>] : []),
    { id: 'rej', header: 'Rejected', value: (r) => r.rejected, format: 'int' },
    { id: 'rejr', header: 'Rejection %', value: (r) => r.rejectionRate, format: 'pct' },
  ];

  const modelCols: Col<ModelRow>[] = [
    { id: 'model', header: 'Model', value: (r) => r.model, width: 170 },
    { id: 'sizes', header: 'Wheel sizes', value: (r) => r.sizes.map(wheelSizeLabel).join(', '), width: 190 },
    { id: 'orders', header: 'Orders', value: (r) => r.orders, format: 'int' },
    { id: 'dealers', header: 'Dealers ordered', value: (r) => r.dealers, format: 'int' },
    { id: 'bdealers', header: 'Dealers billed', value: (r) => r.billedDealers, format: 'int', help: 'Dealers with at least one billed line of this model' },
    { id: 'qty', header: 'Cycles ordered', value: (r) => r.qty, format: 'int' },
    { id: 'bqty', header: 'Cycles billed', value: (r) => r.billedQty, format: 'int', help: 'Σ Fulfilled_Quantity of billed lines' },
    { id: 'value', header: 'Order value', value: (r) => r.value, format: 'inr' },
    { id: 'bvalue', header: 'Billed value', value: (r) => r.billedValue, format: 'inr', help: 'Σ Fulfilled_Amount of billed lines' },
  ];
  const mbdCols: Col<MbdDealer>[] = [
    { id: 'dealer', header: 'Dealer', value: (r) => r.label, width: 220, render: (r) => <DealerLink dealerKey={r.key}>{r.label}</DealerLink> },
    { id: 'ordered', header: 'Models ordered', value: (r) => r.modelsOrdered, format: 'int' },
    { id: 'billed', header: 'Models billed (MBD)', value: (r) => r.modelsBilled, format: 'int', help: 'Distinct models with at least one billed line' },
    { id: 'bqty', header: 'Cycles billed', value: (r) => r.billedQty, format: 'int' },
    { id: 'list', header: 'Models billed', value: (r) => r.models.join(', '), width: 440, help: 'The models this dealer was billed for' },
  ];

  const toggleKpi = (v: string) => cf.toggle('kpi', v, { zero: 'Zero-value orders', rejected: 'Rejected orders', unfulfilled: 'Not yet fulfilled' }[v] ?? v);
  const dealerSelect = (key: string, lab: string) => (isValidatedDealerKey(key) ? openProfile(key, 'overview') : cf.toggle('dealer', key, lab));

  const lineRows: DealerOrderLine[] = useMemo(() => (selected && isDealer ? data.dealerLines.filter((l) => l.orderId === selected.orderId) : []), [selected, isDealer, data.dealerLines]);
  const lineCols: Col<DealerOrderLine>[] = [
    { id: 'sku', header: 'SKU', value: (l) => l.sku ?? l.skuCode, width: 200 },
    { id: 'cat', header: 'Category', value: (l) => l.category },
    { id: 'qty', header: 'Qty', value: (l) => l.qty, format: 'int' },
    { id: 'price', header: 'Unit price', value: (l) => l.unitPrice, format: 'inr' },
    { id: 'amt', header: 'Amount', value: (l) => l.amount, format: 'inr' },
    { id: 'fq', header: 'Fulfilled qty', value: (l) => l.fulfilledQty, format: 'int' },
    { id: 'ls', header: 'Line status', value: (l) => l.lineStatus.replace('_', ' ') },
  ];

  const exportNotes = describeFilters(cf, DIM_LABELS, [periodNote(period), `Rejected orders ${settings.includeRejected ? 'included in' : 'excluded from'} value measures`, ...(sliced ? ['With a model or wheel size chosen, orders, values and quantities count only the lines of that model / size.'] : [])]);
  const rankBars = (rows: GroupRow[], by: 'value' | 'orders') => rows.slice(0, 10).map((r) => ({ key: r.key, label: titleCase(r.label.toLowerCase()), value: by === 'value' ? r.value : r.orders }));

  return (
    <DataGate need={[isDealer ? 'dealer_orders' : 'ds_orders']} what={`${label} orders`}>
      <PageHeader title={`${label}: Orders`} />
      <PeriodGate months={months} system={label}>
        <FilterBar cf={cf} fields={filterFields} />
        {sliced && (
          <div className="mb-2 mt-2 flex items-center gap-1">
            <Badge tone="info" icon={false}>Selected model lines only</Badge>
            <InfoTip title="Selected model lines only" lines={[{ text: `Counting only the lines of ${modelSel ? modelSel.join(', ') : 'every model'}${sizeSel ? ` in ${sizeSel.map(wheelSizeLabel).join(', ')}` : ''}: orders, values, quantities and fulfilment describe those lines, not the whole order they came in.` }]} />
          </div>
        )}
        <KpiGrid cols={isDealer ? 6 : 5}>
          <KpiCard label="Orders" icon={ShoppingCart} value={fInt(k.eligible)} sub={`of ${fInt(k.gross)} placed · ${fInt(k.rejected)} rejected`} info={{ formula: isDealer ? 'Distinct Order_ID with order value > 0 and status not rejected (SKU lines are never counted as orders)' : 'Order rows with value > 0 and status not rejected', exclusions: 'Rejected orders, zero or blank value, duplicate rows.' }} onClick={() => cf.clearDim('kpi')} active={!cf.filters.kpi} hint="Clears the measure filter." />
          <KpiCard label="Order value" icon={IndianRupee} value={fInrCompact(k.eligibleValue)} sub={fInr(k.eligibleValue)} info={{ formula: isDealer ? 'Σ line Amount over eligible orders' : 'Σ “value of Order” over eligible orders', exclusions: 'Rejected and zero-value orders.' }} />
          <KpiCard label="Average order value" icon={Receipt} value={fInr(k.aov)} sub={k.asp !== null ? `${fInr(k.asp)} per cycle` : undefined} info={{ formula: 'Order value ÷ eligible orders', exclusions: 'Rejected and zero-value orders; not weighted by dealer.' }} />
          <KpiCard label="Active dealers" icon={Users} value={fInt(k.activeDealers)} sub={`${fDec(k.avgOrdersPerDealer, 1)} orders per dealer`} info={{ formula: 'Distinct dealers with at least one eligible order' }} onClick={() => setTab('dealers')} hint="Shows the dealer table." />
          {isDealer ? (
            <KpiCard label="Fulfilment rate" icon={Sparkles} value={fPct(k.fulfilmentRate)} sub={`${fInt(k.fulfilledQty)} cycles fulfilled`} tone={k.fulfilmentRate !== null && k.fulfilmentRate < 0.8 ? 'warn' : 'good'} info={{ formula: 'Σ Fulfilled_Quantity ÷ Σ Order_Quantity (cycles), eligible orders', exclusions: `Orders where fulfilled quantity is not recorded (${k.unknownFulfilmentOrders}).` }} onClick={() => toggleKpi('unfulfilled')} active={cf.has('kpi', 'unfulfilled')} hint="Shows eligible orders that are not fully fulfilled." />
          ) : (
            <KpiCard label="Billed rate" icon={Sparkles} value={fPct(k.billedRate)} sub={`${fInt(k.billed)} billed or dispatched`} tone="good" info={{ formula: 'Orders with a billing, dispatch or delivered status ÷ eligible orders', exclusions: 'Status based; not comparable with the Dealer App’s quantity-based fulfilment.' }} />
          )}
          {isDealer && (
            <KpiCard
              label="Models billed per dealer"
              icon={Layers}
              value={fDec(mbd.mbd, 1)}
              sub={`MBD · ${fInt(mbd.models)} ${mbd.models === 1 ? 'model' : 'models'} · ${fInt(mbd.billedDealers)} of ${fInt(mbd.dealers)} ${mbd.dealers === 1 ? 'dealer' : 'dealers'} billed`}
              info={{
                formula: 'For each dealer, the distinct models (Sku_Brand) with at least one billed line; the dealers’ counts are added up and divided by the dealers with an eligible order',
                source: 'A line is billed when it has an Invoice_Id and a fulfilled quantity above zero. A model is the Sku_Brand recorded by the Dealer App (NEXT, NEXT SPORTS and NEXT T25 are three models).',
                exclusions: 'Rejected and zero-value orders. A model ordered but not billed does not count. A dealer with an eligible order but nothing billed counts as 0.',
              }}
              onClick={() => setTab('models')}
              hint="Shows which models each dealer was billed for."
            />
          )}
        </KpiGrid>
        <MoreMeasures>
          <KpiCard compact label="Cycles quantity" icon={Boxes} value={fInt(k.qty)} info={{ formula: isDealer ? 'Σ Order_Quantity of cycles lines (spares are not counted as cycles)' : 'Σ Cycles Volume', exclusions: 'Rejected orders.' }} />
          <KpiCard compact label="Average selling price" icon={Scale} value={fInr(k.asp)} info={{ formula: 'Cycles value ÷ cycles quantity', exclusions: 'Spares value is kept out of the numerator.' }} />
          <KpiCard compact label="Rejection rate" icon={ScrollText} value={fPct(k.rejectionRate)} sub={`${fInt(k.rejected)} rejected · ${fInr(k.rejectedValue)}`} tone={k.rejectionRate !== null && k.rejectionRate > 0.1 ? 'warn' : 'neutral'} info={{ formula: 'Rejected orders ÷ all valid orders', exclusions: 'The export has no rejection reason.' }} onClick={() => toggleKpi('rejected')} active={cf.has('kpi', 'rejected')} />
          {isDealer ? <KpiCard compact label="Unique SKUs ordered" icon={Store} value={fInt(skuCount)} sub={`${fInt(k.lines)} SKU lines`} info={{ formula: 'Distinct SKU code across lines of eligible orders' }} /> : <KpiCard compact label="Zero-value orders" icon={Coins} value={fInt(k.zeroValue)} tone={k.zeroValue ? 'warn' : 'neutral'} info={{ formula: 'Orders with value 0 or blank; kept in the data but left out of value measures' }} onClick={() => toggleKpi('zero')} active={cf.has('kpi', 'zero')} />}
          <KpiCard compact label={isDealer ? 'Orders with invoice' : 'Invoiced orders'} icon={Receipt} value={fInt(k.invoicedOrders)} sub={k.eligible ? `${fPct((k.invoicedOrders ?? 0) / k.eligible)} of eligible` : undefined} info={{ formula: isDealer ? 'Eligible orders where any line has an Invoice_Id' : 'Eligible orders with an invoice number' }} />
        </MoreMeasures>

        <div className="mt-5" />
        <Tabs<TabId>
          label={`${label} orders`}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'trends', label: 'Trends' },
            { id: 'dealers', label: 'Dealers', badge: dealerRows.length },
            ...(isDealer ? [{ id: 'models' as TabId, label: 'Models', badge: modelTable.length }] : []),
            { id: 'orders', label: 'Orders', badge: fInt(filtered.length) },
          ]}
        />

        {tab === 'trends' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Order value by month" subtitle="Click a month to focus the reporting range on it." info={{ formula: 'Σ order value by order-date month' }} table={{ columns: [{ header: 'Month' }, { header: 'Orders', format: 'int' }, { header: 'Order value', format: 'inr' }], rows: byMonth.map((m) => [monthKeyLabel(m.month), m.k.eligible, m.k.eligibleValue]) }}>
              <BarsChart layout="vertical" format="inr" color={color} seriesName="Order value" onSelect={(key, lab) => focusMonth(key)} data={byMonth.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), value: m.k.eligibleValue }))} />
            </ChartCard>
            <ChartCard title="Orders by status" subtitle="All valid orders, rejected included. Click a status to filter." table={{ columns: [{ header: 'Status' }, { header: 'Orders', format: 'int' }], rows: statusRows.map(([s, n]) => [STATUS_LABELS[s], n]) }}>
              <DonutChart centerValue={fInt(filtered.length)} centerLabel="orders" activeKey={cf.filters.status} onSelect={(key, lab) => cf.toggle('status', key, lab)} data={statusRows.map(([s, n], i) => ({ key: s, label: STATUS_LABELS[s], value: n, color: statusColor(STATUS_LABELS[s], i) }))} />
            </ChartCard>
            {isDealer ? (
              <ChartCard title="Ordered and fulfilled cycles by month" subtitle="Units; orders where fulfilled quantity is unknown are left out." info={{ formula: 'Σ Order_Quantity and Σ Fulfilled_Quantity (cycles) by month' }} table={{ columns: [{ header: 'Month' }, { header: 'Ordered', format: 'int' }, { header: 'Fulfilled', format: 'int' }], rows: byMonth.map((m) => [monthKeyLabel(m.month), m.k.qty, m.k.fulfilledQty]) }}>
                <StackedBarsChart
                  data={byMonth.map((m) => ({ key: m.month, label: monthKeyLabel(m.month), pending: Math.max(0, m.k.qty - (m.k.fulfilledQty ?? 0)), fulfilled: m.k.fulfilledQty ?? 0 }))}
                  series={[
                    { key: 'fulfilled', label: 'Fulfilled units', color: '#1baf7a' },
                    { key: 'pending', label: 'Not fulfilled units', color: '#eda100' },
                  ]}
                  onSelect={(_s, key, lab) => focusMonth(key)}
                />
              </ChartCard>
            ) : (
              <ChartCard title="Top employees by order value" subtitle="Employee named on the order. Click a bar to filter." table={{ columns: [{ header: 'Employee' }, { header: 'Order value', format: 'inr' }, { header: 'Orders', format: 'int' }], rows: empRows.slice(0, 10).map((r) => [r.label, r.value, r.orders]) }}>
                <BarsChart format="inr" color={color} seriesName="Order value" activeKey={cf.filters.employee} onSelect={(key, lab) => cf.toggle('employee', key, lab)} data={empRows.slice(0, 10).map((r) => ({ key: r.key, label: titleCase(r.label.toLowerCase()), value: r.value }))} />
              </ChartCard>
            )}
            <ChartCard title={isDealer ? 'Order value by zone' : 'Order value by city'} subtitle="Click a bar to filter." table={{ columns: [{ header: isDealer ? 'Zone' : 'City' }, { header: 'Order value', format: 'inr' }, { header: 'Orders', format: 'int' }], rows: regionRows.slice(0, 10).map((r) => [r.label, r.value, r.orders]) }}>
              <BarsChart format="inr" color={color} seriesName="Order value" activeKey={cf.filters.region} onSelect={(key, lab) => cf.toggle('region', key, lab)} data={regionRows.slice(0, 10).map((r) => ({ key: r.key, label: titleCase(r.label.toLowerCase()), value: r.value }))} />
            </ChartCard>
            <ChartCard title="Orders by size" subtitle="Eligible orders grouped by order value. Click a bar to filter." table={{ columns: [{ header: 'Order value band' }, { header: 'Orders', format: 'int' }], rows: bandRows.map((b) => [b.label, b.value]) }}>
              <BarsChart layout="vertical" color={color} seriesName="Orders" activeKey={cf.filters.band} onSelect={(key, lab) => cf.toggle('band', key, lab)} data={bandRows} />
            </ChartCard>
          </div>
        )}

        {tab === 'dealers' && (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Top dealers by order value" subtitle="Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Order value', format: 'inr' }, { header: 'Orders', format: 'int' }], rows: dealerRows.slice(0, 10).map((r) => [r.label, r.value, r.orders]) }}>
                <BarsChart format="inr" color={color} seriesName="Order value" activeKey={cf.filters.dealer} onSelect={dealerSelect} data={rankBars(dealerRows, 'value')} />
              </ChartCard>
              <ChartCard title="Top dealers by order count" subtitle="Click a dealer for the profile." table={{ columns: [{ header: 'Dealer' }, { header: 'Orders', format: 'int' }, { header: 'Order value', format: 'inr' }], rows: topByCount.map((r) => [r.label, r.orders, r.value]) }}>
                <BarsChart color={color} seriesName="Orders" activeKey={cf.filters.dealer} onSelect={dealerSelect} data={rankBars(topByCount, 'orders')} />
              </ChartCard>
            </div>
            <DataTable title="Dealer performance" rows={dealerRows} columns={dealerCols} getRowId={(r) => r.key} exportName={`${isDealer ? 'DealerApp' : 'DataSense'}_dealer_performance`} exportNotes={exportNotes} initialSort={{ id: 'value', desc: true }} onRowClick={(r) => dealerSelect(r.key, r.label)} selectedId={cf.filters.dealer} pageSize={10} searchPlaceholder="Search dealers…" />
          </div>
        )}

        {tab === 'models' && isDealer && (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Models billed per dealer"
                subtitle="Distinct models each dealer was billed for. Click a dealer for the profile."
                info={{ formula: 'Per dealer: distinct Sku_Brand with at least one billed line (Invoice_Id present and Fulfilled_Quantity above zero)', exclusions: 'Rejected and zero-value orders.' }}
                table={{ columns: [{ header: 'Dealer' }, { header: 'Models billed', format: 'int' }, { header: 'Models ordered', format: 'int' }], rows: mbdDealers.slice(0, 10).map((r) => [r.label, r.modelsBilled, r.modelsOrdered]) }}
              >
                <BarsChart color={color} seriesName="Models billed" activeKey={cf.filters.dealer} onSelect={dealerSelect} data={mbdDealers.slice(0, 10).map((r) => ({ key: r.key, label: r.label, value: r.modelsBilled }))} />
              </ChartCard>
              <ChartCard
                title="Cycles billed by model"
                subtitle="Top 10 models by billed cycles. Click a model to filter."
                info={{ formula: 'Σ Fulfilled_Quantity of billed lines, by Sku_Brand' }}
                table={{ columns: [{ header: 'Model' }, { header: 'Cycles billed', format: 'int' }, { header: 'Dealers billed', format: 'int' }], rows: modelTable.slice(0, 10).map((r) => [r.model, r.billedQty, r.billedDealers]) }}
              >
                <BarsChart color={color} seriesName="Cycles billed" activeKey={cf.filters.model} onSelect={(key, lab) => cf.toggle('model', key, lab)} data={modelTable.slice(0, 10).map((r) => ({ key: r.model, label: r.model, value: r.billedQty }))} />
              </ChartCard>
            </div>
            <DataTable title="Which dealer was billed for which model" rows={mbdDealers} columns={mbdCols} getRowId={(r) => r.key} exportName="DealerApp_models_billed_by_dealer" exportNotes={exportNotes} initialSort={{ id: 'billed', desc: true }} onRowClick={(r) => dealerSelect(r.key, r.label)} selectedId={cf.filters.dealer} pageSize={10} searchPlaceholder="Search dealers or models…" />
            <DataTable title="Models" rows={modelTable} columns={modelCols} getRowId={(r) => r.model} exportName="DealerApp_models" exportNotes={exportNotes} initialSort={{ id: 'bqty', desc: true }} onRowClick={(r) => cf.toggle('model', r.model, r.model)} selectedId={cf.filters.model} pageSize={10} searchPlaceholder="Search models…" />
          </div>
        )}

        {tab === 'orders' && (
          <DataTable title="Orders" rows={filtered} columns={orderCols} getRowId={(o) => o.key} fullRows={allOrders} exportName={`${isDealer ? 'DealerApp' : 'DataSense'}_orders`} exportNotes={exportNotes} initialSort={{ id: 'date', desc: true }} onRowClick={setSelected} selectedId={selected?.key} searchPlaceholder="Search orders, dealers, status…" />
        )}
      </PeriodGate>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Order ${selected.orderId}` : ''} subtitle={selected ? `${dealerLabel(selected)} · ${fDate(selected.date)}` : undefined}>
        {selected && (
          <div className="space-y-4">
            <Facts
              items={[
                ['Dealer', selected.dealerKey ? <DealerLink key="d" dealerKey={selected.dealerKey}>{titleCase(dealerLabel(selected).toLowerCase())}</DealerLink> : dealerLabel(selected)],
                ['Status', <OrderStatusBadge key="s" s={selected.statusGroup} />],
                ['Order value', fInr(selected.value)],
                ['Cycles quantity', fInt(selected.qty)],
                ['ASP (cycles)', selected.qty && selected.cyclesValue !== null ? fInr(selected.cyclesValue / selected.qty) : '—'],
                ...(isDealer ? ([['Fulfilled qty', fInt(selected.fulfilledQty)], ['Fulfilled value', fInr(selected.fulfilledValue)], ['SKU lines', fInt(selected.lines)], ['Models', (selected.models ?? []).join(', ') || '—']] as Array<[string, React.ReactNode]>) : ([['Employee', selected.employee ?? '—'], ['Role', selected.role ?? '—']] as Array<[string, React.ReactNode]>)),
                [isDealer ? 'SAP order ID' : 'Invoice / SAP ref', selected.sapOrderId ?? 'None'],
              ]}
            />
            {isDealer && <DataTable rows={lineRows} columns={lineCols} exportName={`order_${selected.orderId}_lines`} pageSize={10} title="SKU lines in this order" />}
          </div>
        )}
      </Drawer>
    </DataGate>
  );
}

export const DealerOrdersPage = () => <OrdersPage system="dealer" />;
export const DsOrdersPage = () => <OrdersPage system="ds" />;
