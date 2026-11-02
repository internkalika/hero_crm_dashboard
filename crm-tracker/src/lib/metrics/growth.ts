// Business-growth analytics: is the Dealer App adding business, or only moving it from one channel to another?
//
// All figures are built from the same order roll-ups as the Dealer App and DataSense pages (one row per Order ID for the
// Dealer App, one row per order for DataSense, eligible = value above zero and not rejected), so a number here can
// always be traced to the detail pages. What this module adds is the COMPARISON LAYER:
//
//   * two explicit date windows (reporting and comparison) of the same length and the same days of the month;
//   * the same dealers in both windows and both channels, matched on the validated ERP dealer code only;
//   * a combined view in which an order counts once: a DataSense order that carries the SAP number of a Dealer App order
//     of the same dealer is the same order and is counted as Dealer App;
//   * a transparent classification of every dealer (see classify) that separates new business from business that has
//     only moved between channels;
//   * profitability and attribution are NOT inferred: nothing here is cost, margin or profit, and no class is proof that
//     the Dealer App caused a change.
import type { AppData, ComplaintRec, DealerOrderLine, OrderSummary, Settings } from '../types';
import { STATUS_LABELS, buildDealerOrders, dsOrderSummaries, isEligible, orderKpis } from './orders';
import { isTestRecord } from './complaints';
import { Change, changeOf } from './windows';
import { LineSlice, inSlice, mbdOfOrders } from './models';
import { DataSpan, Win, coveredDays, dataSpan, inWin, makeWin, monthShort, resolveWindows } from './growthWindows';
import { isValidatedDealerKey } from '../nav/links';
import { dealerKeyOfOrder } from './overview';
import { monthEnd, titleCase } from '../util/parse';
import { fDate } from '../export/format';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';
export type ChannelId = 'dealer' | 'ds';

/** A dealer moving by less than this share of its comparison-period business is "stable". */
export const GROWTH_THRESHOLD = 0.1;
/** A comparison period with fewer combined orders than this is too small a base to classify with confidence. */
export const MIN_BASE_ORDERS = 3;
/** Windows shorter than this many days are indicative only. */
export const MIN_WINDOW_DAYS = 14;
/** A change smaller than this is "flat" (amber) on a KPI card. */
export const FLAT_BAND = 0.02;

export interface GrowthInput {
  /** reporting window id (see growthWindows) */
  rp: string;
  /** comparison window id */
  cp: string;
  /** dealers chosen in the Dealer filter / the DB code filter (validated ERP codes). Both set = only dealers in both. */
  dealers: string[];
  dbs: string[];
  outlets: string[];
  zones: string[];
  cities: string[];
  /** with no dealer chosen: only the dealers that have a Dealer App order ('pilot') or every dealer ('all') */
  cohort: 'pilot' | 'all';
  /** channels shown on cards and charts; empty = both */
  channels: ChannelId[];
  /** Dealer App model / wheel-size slice of the order lines (DataSense has no model field, so it is left out when set) */
  models: string[];
  sizes: string[];
}

export const defaultGrowthInput = (): GrowthInput => ({ rp: '', cp: 'prev', dealers: [], dbs: [], outlets: [], zones: [], cities: [], cohort: 'pilot', channels: [], models: [], sizes: [] });

/* --------------------------------- statistics --------------------------------- */

export interface ChannelStats {
  orders: number;
  grossOrders: number;
  value: number;
  qty: number;
  aov: number | null;
  asp: number | null;
  activeDealers: number;
  rejected: number;
  rejectionRate: number | null;
  /** Dealer App: fulfilled ÷ ordered quantity; DataSense: share of orders billed / dispatched */
  fulfilmentRate: number | null;
  /** distinct complaints raised in the window; null when the complaint export does not cover the whole window */
  complaints: number | null;
  /** complaints ÷ eligible orders; null when the count is unknown or there are no orders */
  complaintRate: number | null;
}

export interface CombinedStats {
  orders: number;
  value: number;
  qty: number;
  aov: number | null;
  asp: number | null;
  activeDealers: number;
}

export interface WindowStats {
  win: Win;
  /** null = the channel does not apply (not selected, or a model slice that DataSense cannot be cut by) */
  dealer: ChannelStats | null;
  ds: ChannelStats | null;
  combined: CombinedStats;
  /** dealers with eligible orders in both channels / in either channel / Dealer App share of the second */
  commonActive: number;
  activeEither: number;
  adoption: number | null;
  /** days of the window that each export covers (Dealer App starts on its launch day) */
  covered: { dealer: number; ds: number };
}

export interface KpiPair {
  id: string;
  label: string;
  unit: 'inr' | 'int' | 'dec' | 'pct' | 'per100';
  /** 'up' = a rise is good news; 'down' = a rise is bad news (rejections, complaints) */
  polarity: 'up' | 'down';
  dealer: number | null;
  ds: number | null;
  dealerPrev: number | null;
  dsPrev: number | null;
  /** Dealer App minus DataSense in the reporting window, and as a share of DataSense when that is not zero */
  gapAbs: number | null;
  gapPct: number | null;
  dealerChange: Change | null;
  dsChange: Change | null;
  dealerTone: Tone;
  dsTone: Tone;
  /** the Dealer App change is measured against days before its launch, or on fewer than 10 orders: read it as indicative */
  dealerIndicative: boolean;
  /** a rate measured on fewer than 10 orders in either window */
  dsIndicative: boolean;
  note?: string;
}

export type GrowthClass = 'incremental' | 'migration' | 'declining' | 'stable' | 'insufficient';

export const CLASS_META: Record<GrowthClass, { label: string; short: string; tone: Tone; color: string; help: string }> = {
  incremental: { label: 'Incremental growth candidate', short: 'Incremental', tone: 'good', color: '#1baf7a', help: `Combined Dealer App + DataSense order value is at least ${GROWTH_THRESHOLD * 100}% above the comparison period.` },
  migration: { label: 'Possible channel migration', short: 'Channel shift', tone: 'warn', color: '#eda100', help: `Dealer App value rose, DataSense value fell by 0.5–2 times as much, and combined value moved by less than ${GROWTH_THRESHOLD * 100}%.` },
  declining: { label: 'Declining business', short: 'Declining', tone: 'bad', color: '#C8202F', help: `Combined order value is at least ${GROWTH_THRESHOLD * 100}% below the comparison period, or the dealer stopped ordering.` },
  stable: { label: 'Stable (no material change)', short: 'Stable', tone: 'neutral', color: '#2a78d6', help: `Combined order value moved by less than ${GROWTH_THRESHOLD * 100}% and Dealer App and DataSense did not offset each other.` },
  insufficient: { label: 'New or insufficient history', short: 'New / no history', tone: 'neutral', color: '#8b8a85', help: 'No orders in the comparison period, or no comparison period, so there is no baseline to classify against.' },
};

export const CLASS_ORDER: GrowthClass[] = ['incremental', 'migration', 'declining', 'stable', 'insufficient'];

export interface DealerPeriodFigures {
  dealerValue: number;
  dsValue: number;
  combinedValue: number;
  dealerOrders: number;
  dsOrders: number;
  combinedOrders: number;
  dealerQty: number;
  dsQty: number;
  combinedQty: number;
}

export interface DealerGrowthRow {
  key: string;
  name: string;
  outletId: string | null;
  dbCode: string | null;
  zone: string | null;
  city: string | null;
  /** has at least one Dealer App order (any status) in the data */
  onDealerApp: boolean;
  prev: DealerPeriodFigures | null;
  cur: DealerPeriodFigures;
  changeValue: number | null;
  changePct: number | null;
  changeOrders: number | null;
  changeQty: number | null;
  changeDealerValue: number | null;
  changeDsValue: number | null;
  /** shares of the reporting-period combined value */
  dealerShare: number | null;
  dsShare: number | null;
  /** the same shares in the comparison period (to see the movement between channels) */
  dealerSharePrev: number | null;
  cls: GrowthClass;
  /** 'indicative' = a reasoned estimate; 'inconclusive' = the base is too small or too short to rely on */
  confidence: 'indicative' | 'inconclusive';
  evidence: string;
  /** Dealer App models billed to the dealer in the reporting window (null when it had no eligible Dealer App order) */
  mbd: number | null;
}

export interface MonthPoint {
  month: string;
  label: string;
  win: Win;
  /** the month is cut short by the data cut-off */
  partial: boolean;
  dealer: ChannelStats | null;
  ds: ChannelStats | null;
  combinedValue: number;
  activeEither: number;
  adoption: number | null;
}

export interface HeatRow {
  key: string;
  name: string;
  /** one value per month in GrowthModel.months; null when the dealer had no eligible order that month (or the channel did not exist yet) */
  values: Array<number | null>;
  total: number;
}

export interface PeakDays {
  days: string[];
  share: number;
}

export interface GrowthOrder {
  key: string;
  system: ChannelId;
  window: 'reporting' | 'comparison';
  orderId: string;
  sapOrderId: string | null;
  dealerKey: string | null;
  dealerName: string;
  date: string | null;
  status: string;
  qty: number | null;
  value: number | null;
  /** counted in the figures (value above zero and not rejected, unless rejected orders are included) */
  eligible: boolean;
  /** a DataSense order that is the same order as a Dealer App order: shown, never counted twice */
  duplicate: boolean;
}

export interface Benchmark {
  /** dealers that have a Dealer App order vs all others, both channels combined, over the same two windows */
  pilot: { dealers: number; prev: number; cur: number; pct: number | null };
  others: { dealers: number; prev: number; cur: number; pct: number | null };
  /** other dealers whose comparison-period value lies in the pilot dealers' range */
  similar: { dealers: number; pct: number | null } | null;
  /** pilot growth minus other growth, in percentage points; null when either is not defined */
  diffPts: number | null;
}

export interface GrowthInsight {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  /** the supporting figure, shown as a chip */
  metric: string;
  /** reporting vs comparison period the figure is for */
  period: string;
  /** where the underlying records are (a link inside this app) */
  to: string;
  toLabel: string;
}

export interface GrowthModel {
  span: DataSpan;
  reporting: Win;
  comparison: Win | null;
  comparisonNote: string | null;
  input: GrowthInput;
  /** true while a model slice is applied (DataSense is then not comparable and is left out) */
  sliced: boolean;
  channels: { dealer: boolean; ds: boolean };
  cur: WindowStats;
  prev: WindowStats | null;
  kpis: KpiPair[];
  months: MonthPoint[];
  rows: DealerGrowthRow[];
  classCounts: Record<GrowthClass, number>;
  /** combined order value and quantity change of the dealers in view (both channels, de-duplicated) */
  combinedValue: Change | null;
  combinedQty: Change | null;
  combinedOrders: Change | null;
  benchmark: Benchmark | null;
  /** dealer–model pairs billed per dealer (Dealer App only) in each window */
  mbd: { cur: number | null; prev: number | null; dealersCur: number; models: number } | null;
  overlap: { orders: number; value: number };
  /** the Dealer App window figures that have days before the launch */
  dealerLaunch: string | null;
  notes: string[];
  insights: GrowthInsight[];
  /** number of dealers in view (the scope) */
  dealersInView: number;
  /** combined order value by dealer and month (Dealer App + DataSense, eligible orders), busiest dealers first; null = no business that month */
  heat: HeatRow[];
  /** the orders behind every figure: both windows, both channels, the dealers in view */
  orders: GrowthOrder[];
  /** share of each window's order value that falls on its three busiest days (null when there is no value) */
  peaks: { reporting: PeakDays | null; comparison: PeakDays | null };
  /** DataSense order value that is spares (the quantity and ASP are cycles only) */
  dsSparesShare: number | null;
}

/* --------------------------------- helpers --------------------------------- */

const norm = (s: string | null | undefined): string => (s ?? '').trim().replace(/^0+/, '');

export function toneOfChange(c: Change | null, polarity: 'up' | 'down', indicative = false): Tone {
  if (!c) return 'neutral';
  if (c.pct === null) {
    if (c.abs === 0) return 'warn';
    const good = polarity === 'up' ? c.abs > 0 : c.abs < 0;
    return indicative ? 'warn' : good ? 'good' : 'bad';
  }
  if (Math.abs(c.pct) < FLAT_BAND) return 'warn';
  const good = polarity === 'up' ? c.pct > 0 : c.pct < 0;
  if (indicative) return 'warn';
  return good ? 'good' : 'bad';
}

const pct = (a: number, b: number): number | null => (b === 0 ? null : (a - b) / Math.abs(b));

function emptyStats(): ChannelStats {
  return { orders: 0, grossOrders: 0, value: 0, qty: 0, aov: null, asp: null, activeDealers: 0, rejected: 0, rejectionRate: null, fulfilmentRate: null, complaints: null, complaintRate: null };
}

function channelStats(orders: OrderSummary[], sys: ChannelId, settings: Pick<Settings, 'includeRejected'>, complaints: number | null): ChannelStats {
  if (!orders.length) return { ...emptyStats(), complaints, complaintRate: complaints === null ? null : null };
  const k = orderKpis(orders, settings, sys);
  return {
    orders: k.eligible,
    grossOrders: k.gross,
    value: k.eligibleValue,
    qty: k.qty,
    aov: k.aov,
    asp: k.asp,
    activeDealers: k.activeDealers,
    rejected: k.rejected,
    rejectionRate: k.rejectionRate,
    fulfilmentRate: sys === 'dealer' ? k.fulfilmentRate : k.billedRate,
    complaints,
    complaintRate: complaints !== null && k.eligible > 0 ? complaints / k.eligible : null,
  };
}

function combinedStats(da: OrderSummary[], ds: OrderSummary[], settings: Pick<Settings, 'includeRejected'>): CombinedStats {
  const all = [...da, ...ds];
  if (!all.length) return { orders: 0, value: 0, qty: 0, aov: null, asp: null, activeDealers: 0 };
  const k = orderKpis(all, settings, 'ds');
  return { orders: k.eligible, value: k.eligibleValue, qty: k.qty, aov: k.aov, asp: k.asp, activeDealers: k.activeDealers };
}

const dealerKeys = (os: OrderSummary[], settings: Pick<Settings, 'includeRejected'>): Set<string> => new Set(os.filter((o) => isEligible(o, settings)).map(dealerKeyOfOrder));

function figures(da: OrderSummary[], ds: OrderSummary[], settings: Pick<Settings, 'includeRejected'>): DealerPeriodFigures {
  const a = orderKpis(da, settings, 'dealer');
  const s = orderKpis(ds, settings, 'ds');
  return {
    dealerValue: a.eligibleValue,
    dsValue: s.eligibleValue,
    combinedValue: a.eligibleValue + s.eligibleValue,
    dealerOrders: a.eligible,
    dsOrders: s.eligible,
    combinedOrders: a.eligible + s.eligible,
    dealerQty: a.qty,
    dsQty: s.qty,
    combinedQty: a.qty + s.qty,
  };
}

/* ------------------------------ classification ------------------------------ */

export interface ClassifyContext {
  /** a comparison period exists and the data covers it */
  hasBaseline: boolean;
  windowDays: number;
  /** the Dealer App existed for only part of the comparison window */
  dealerPartialBaseline: boolean;
  /** the last order the dealer placed before the comparison window, if any */
  earlierOrderDate?: string | null;
}

const inr = (v: number): string => `₹${Math.round(Math.abs(v)).toLocaleString('en-IN')}`;
const signed = (v: number): string => `${v < 0 ? '−' : '+'}${inr(v)}`;
const pc = (v: number): string => `${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(0)}%`;

/**
 * The rules, in order. Every number they use is shown beside the result, so a classification can be checked by hand.
 *
 *  1. No baseline (no comparison period, or no combined order in it)          -> New or insufficient history
 *  2. Ordered in the comparison period, nothing in the reporting period        -> Declining business (stopped ordering)
 *  3. Combined change ≥ +10%                                                   -> Incremental growth candidate
 *  4. Combined change ≤ −10%                                                   -> Declining business
 *  5. Dealer App value up, DataSense value down by 0.5–2× as much, and the
 *     combined change inside ±10%                                              -> Possible channel migration
 *  6. otherwise                                                                -> Stable
 *
 * Confidence is "inconclusive" when the comparison period has fewer than 3 combined orders, either window is shorter
 * than 14 days, or the Dealer App did not exist for the whole comparison period and moves the result.
 */
export function classify(prev: DealerPeriodFigures | null, cur: DealerPeriodFigures, ctx: ClassifyContext): { cls: GrowthClass; confidence: 'indicative' | 'inconclusive'; evidence: string } {
  const caveats: string[] = [];
  if (!ctx.hasBaseline || !prev) return { cls: 'insufficient', confidence: 'inconclusive', evidence: 'No comparison period, so there is no baseline to classify against.' };
  if (prev.combinedOrders === 0) {
    const earlier = ctx.earlierOrderDate ? ` Last order before it: ${ctx.earlierOrderDate}.` : ' No earlier orders in the data.';
    return { cls: 'insufficient', confidence: 'inconclusive', evidence: `No orders in the comparison period (${cur.combinedOrders} now, ${inr(cur.combinedValue)}): new, returning or not yet active.${earlier}` };
  }
  if (prev.combinedOrders < MIN_BASE_ORDERS) caveats.push(`small base (${prev.combinedOrders} order${prev.combinedOrders === 1 ? '' : 's'} before)`);
  if (ctx.windowDays < MIN_WINDOW_DAYS) caveats.push(`short window (${ctx.windowDays} days)`);
  const dA = cur.dealerValue - prev.dealerValue;
  const dS = cur.dsValue - prev.dsValue;
  const dC = cur.combinedValue - prev.combinedValue;
  const p = pct(cur.combinedValue, prev.combinedValue);
  const parts = `Dealer App ${signed(dA)}, DataSense ${signed(dS)}, combined ${signed(dC)}${p === null ? '' : ` (${pc(p)})`}`;
  const finish = (cls: GrowthClass, why: string): { cls: GrowthClass; confidence: 'indicative' | 'inconclusive'; evidence: string } => {
    if (ctx.dealerPartialBaseline && Math.abs(dA) > 0 && cls !== 'declining') caveats.push('the Dealer App was not live for the whole comparison period');
    return { cls, confidence: caveats.length ? 'inconclusive' : 'indicative', evidence: `${why} ${parts}.${caveats.length ? ` Treat as inconclusive: ${caveats.join('; ')}.` : ''}` };
  };
  if (cur.combinedOrders === 0) return finish('declining', 'No orders in the reporting period.');
  if (p !== null && p >= GROWTH_THRESHOLD) {
    const why = dA > 0 && dS < 0 ? 'Combined business grew; part of the Dealer App gain replaced DataSense orders.' : dA > 0 && dS >= 0 ? 'Both channels added value.' : dS > 0 && dA <= 0 ? 'Growth came from DataSense, not the Dealer App.' : 'Combined business grew.';
    return finish('incremental', why);
  }
  if (p !== null && p <= -GROWTH_THRESHOLD) return finish('declining', dA > 0 ? 'Dealer App value rose but DataSense fell by more.' : 'Combined business fell.');
  if (dA > 0 && dS < 0) {
    const offset = -dS / dA;
    if (offset >= 0.5 && offset <= 2) return finish('migration', `The DataSense decline offsets ${(offset * 100).toFixed(0)}% of the Dealer App gain, with little change overall.`);
  }
  return finish('stable', 'Combined business is within ±10%.');
}

/* ------------------------------ the model builder ------------------------------ */

const OTHER = (v: string | null | undefined, fallback = 'Not recorded'): string => (v && v.trim() ? v.trim() : fallback);

interface DealerAttr {
  name: string;
  outletId: string | null;
  zone: string | null;
  city: string | null;
  onDealerApp: boolean;
}

export function buildGrowth(data: AppData, settings: Pick<Settings, 'includeRejected' | 'includeTestAccounts'>, inputIn: Partial<GrowthInput> = {}): GrowthModel | null {
  const span = dataSpan(data);
  if (!span) return null;
  const input: GrowthInput = { ...defaultGrowthInput(), ...inputIn };
  const { reporting, comparison, comparisonNote } = resolveWindows(span, input.rp, input.cp);
  const showDealer = input.channels.length === 0 || input.channels.includes('dealer');
  const showDs = input.channels.length === 0 || input.channels.includes('ds');
  const sliced = input.models.length > 0 || input.sizes.length > 0;
  const slice: LineSlice = { model: input.models, size: input.sizes };

  // ---- order roll-ups; a model slice rebuilds the Dealer App orders from only the matching lines
  const lineOk = (l: DealerOrderLine) => (sliced ? inSlice(l, slice) : true);
  const daLines = sliced ? data.dealerLines.filter(lineOk) : data.dealerLines;
  const daAll = buildDealerOrders(daLines);
  const dsAllRaw = dsOrderSummaries(data.dsOrders);

  // ---- one order, one channel: a DataSense order with the SAP number of a Dealer App order of the same dealer is that order
  const daSap = new Map<string, string | null>();
  for (const o of buildDealerOrders(data.dealerLines)) if (o.sapOrderId) daSap.set(norm(o.sapOrderId), o.dealerKey);
  const isDup = (o: OrderSummary): boolean => {
    for (const id of [o.orderId, o.sapOrderId]) {
      const hit = id ? daSap.get(norm(id)) : undefined;
      if (hit !== undefined && hit === o.dealerKey) return true;
    }
    return false;
  };
  const dsDup = dsAllRaw.filter(isDup);
  const dsAll = dsAllRaw.filter((o) => !isDup(o));

  // ---- dealer attributes (names are labels only; the ERP code identifies the dealer)
  const attrs = new Map<string, DealerAttr>();
  const attr = (key: string, name: string): DealerAttr => {
    let a = attrs.get(key);
    if (!a) attrs.set(key, (a = { name, outletId: null, zone: null, city: null, onDealerApp: false }));
    return a;
  };
  for (const l of data.dealerLines) {
    const key = l.dealerKey ?? `name:${l.outletName}`;
    const a = attr(key, l.outletName);
    a.name = l.outletName || a.name;
    a.outletId = l.outletId || a.outletId;
    a.zone = l.zone ?? a.zone;
    a.city = l.city ?? a.city;
    a.onDealerApp = true;
  }
  for (const o of dsAllRaw) {
    const key = dealerKeyOfOrder(o);
    const a = attr(key, o.dealerName);
    if (!a.name) a.name = o.dealerName;
    if (!a.city && o.city) a.city = o.city;
  }
  const cityKey = (c: string | null) => (c ? c.trim().toUpperCase() : 'NOT RECORDED');

  // ---- who is in view
  let dealerSet: Set<string> | null = null;
  const intersect = (s: Set<string> | null, add: string[]): Set<string> => (s ? new Set(add.filter((k) => s.has(k))) : new Set(add));
  if (input.dealers.length) dealerSet = intersect(dealerSet, input.dealers);
  if (input.dbs.length) dealerSet = intersect(dealerSet, input.dbs);
  if (input.outlets.length) dealerSet = intersect(dealerSet, [...attrs.entries()].filter(([, a]) => a.outletId && input.outlets.includes(a.outletId)).map(([k]) => k));
  if (!input.dealers.length && !input.dbs.length && !input.outlets.length && input.cohort === 'pilot') dealerSet = new Set([...attrs.entries()].filter(([, a]) => a.onDealerApp).map(([k]) => k));
  if (input.zones.length || input.cities.length) {
    const pool = dealerSet ?? new Set(attrs.keys());
    dealerSet = new Set([...pool].filter((k) => {
      const a = attrs.get(k);
      return (!input.zones.length || input.zones.includes(OTHER(a?.zone))) && (!input.cities.length || input.cities.map(cityKey).includes(cityKey(a?.city ?? null)));
    }));
  }
  const inView = (key: string | null): boolean => !dealerSet || (key !== null && dealerSet.has(key));
  const orderInView = (o: OrderSummary) => inView(dealerKeyOfOrder(o));
  const daView = daAll.filter(orderInView);
  const dsView = sliced ? [] : dsAll.filter(orderInView);

  // ---- complaints (distinct ids; null when the export does not cover the whole window)
  const complaintCover = (recs: ComplaintRec[]): [string, string] | null => {
    const d = recs.map((c) => c.raisedDate).filter((x): x is string => !!x).sort();
    return d.length ? [d[0], d[d.length - 1]] : null;
  };
  const cover = { dealer: complaintCover(data.dealerComplaints), ds: complaintCover(data.dsComplaints) };
  const complaintCount = (recs: ComplaintRec[], w: Win, c: [string, string] | null): number | null => {
    if (!c || w.from < c[0] || w.to > c[1]) return null;
    const ids = new Set<string>();
    for (const r of recs) {
      if (!inWin(r.raisedDate, w)) continue;
      if (!settings.includeTestAccounts && isTestRecord(r)) continue;
      if (dealerSet && !(r.dealerKey && dealerSet.has(r.dealerKey))) continue;
      ids.add(r.id);
    }
    return ids.size;
  };

  const daFirstLast = span.dealer;
  const dsFirstLast = span.ds;
  const statsFor = (w: Win): WindowStats => {
    const da = daView.filter((o) => inWin(o.date, w));
    const ds = dsView.filter((o) => inWin(o.date, w));
    const daKeys = dealerKeys(da, settings);
    const dsKeys = dealerKeys(ds, settings);
    const either = new Set([...daKeys, ...dsKeys]);
    const common = [...daKeys].filter((k) => dsKeys.has(k)).length;
    return {
      win: w,
      dealer: showDealer ? channelStats(da, 'dealer', settings, complaintCount(data.dealerComplaints, w, cover.dealer)) : null,
      ds: showDs && !sliced ? channelStats(ds, 'ds', settings, complaintCount(data.dsComplaints, w, cover.ds)) : null,
      combined: combinedStats(da, ds, settings),
      commonActive: common,
      activeEither: either.size,
      adoption: either.size ? daKeys.size / either.size : null,
      covered: { dealer: coveredDays(w, daFirstLast?.[0], daFirstLast?.[1]), ds: coveredDays(w, dsFirstLast?.[0], dsFirstLast?.[1]) },
    };
  };
  const cur = statsFor(reporting);
  const prev = comparison ? statsFor(comparison) : null;

  // ---- KPI pairs
  const dealerPartial = !!prev && !!comparison && prev.covered.dealer < comparison.days && prev.covered.dealer > 0;
  const dealerAbsent = !!prev && !!comparison && prev.covered.dealer === 0;
  const pair = (id: string, label: string, unit: KpiPair['unit'], polarity: 'up' | 'down', pick: (s: ChannelStats) => number | null, note?: string): KpiPair => {
    const dv = cur.dealer ? pick(cur.dealer) : null;
    const sv = cur.ds ? pick(cur.ds) : null;
    const dp = prev?.dealer ? pick(prev.dealer) : null;
    const sp = prev?.ds ? pick(prev.ds) : null;
    // a Dealer App figure from a window with no Dealer App days at all is not a baseline (it did not exist yet)
    const dealerChange = dealerAbsent ? null : changeOf(dp, dv);
    const isRate = unit === 'pct' || unit === 'per100';
    const thin = (a?: ChannelStats | null, b?: ChannelStats | null) => isRate && Math.min(a?.grossOrders ?? 0, b?.grossOrders ?? 0) < 10;
    const dealerIndicative = (dealerPartial && !isRate) || thin(cur.dealer, prev?.dealer);
    const dsIndicative = thin(cur.ds, prev?.ds);
    const dsChange = changeOf(sp, sv);
    return {
      id,
      label,
      unit,
      polarity,
      dealer: dv,
      ds: sv,
      dealerPrev: dp,
      dsPrev: sp,
      gapAbs: dv !== null && sv !== null ? dv - sv : null,
      gapPct: dv !== null && sv !== null && sv !== 0 ? (dv - sv) / Math.abs(sv) : null,
      dealerChange,
      dsChange,
      dealerTone: toneOfChange(dealerChange, polarity, dealerIndicative),
      dsTone: toneOfChange(dsChange, polarity, dsIndicative),
      dealerIndicative,
      dsIndicative,
      note,
    };
  };
  const kpis: KpiPair[] = [
    pair('value', 'Order value', 'inr', 'up', (s) => s.value),
    pair('orders', 'Order count', 'int', 'up', (s) => s.orders),
    pair('qty', 'Quantity (cycles)', 'int', 'up', (s) => s.qty),
    pair('aov', 'Average order value', 'inr', 'up', (s) => s.aov),
    pair('asp', 'Average selling price', 'inr', 'up', (s) => s.asp),
    pair('dealers', 'Active dealers', 'int', 'up', (s) => s.activeDealers),
    pair('rejection', 'Rejection rate', 'pct', 'down', (s) => s.rejectionRate),
    pair('complaint', 'Complaints per 100 orders', 'per100', 'down', (s) => (s.complaintRate === null ? null : s.complaintRate * 100), 'Distinct complaints raised in the window ÷ eligible orders in the same window. A complaint is not always about an order, so this is a ratio, not a share.'),
  ];

  // ---- months
  const months: MonthPoint[] = span.months.map((m) => {
    const w = makeWin(`${m}-01`, monthEnd(m) > span.cutoff ? span.cutoff : monthEnd(m));
    const s = statsFor(w);
    const dealer = s.covered.dealer === 0 ? null : s.dealer;
    return { month: m, label: `${monthShort(m)}${w.partialMonth ? '*' : ''}`, win: w, partial: w.partialMonth, dealer, ds: s.ds, combinedValue: s.combined.value, activeEither: s.activeEither, adoption: s.covered.dealer === 0 ? null : s.adoption };
  });

  // ---- dealers
  const daByDealer = new Map<string, OrderSummary[]>();
  const dsByDealer = new Map<string, OrderSummary[]>();
  const push = (m: Map<string, OrderSummary[]>, o: OrderSummary) => {
    const k = dealerKeyOfOrder(o);
    const a = m.get(k);
    if (a) a.push(o);
    else m.set(k, [o]);
  };
  daView.forEach((o) => push(daByDealer, o));
  dsView.forEach((o) => push(dsByDealer, o));
  const dealerWindow = (m: Map<string, OrderSummary[]>, k: string, w: Win) => (m.get(k) ?? []).filter((o) => inWin(o.date, w));
  const allKeys = new Set([...daByDealer.keys(), ...dsByDealer.keys()]);
  const baselineOk = !!comparison && !!prev && (prev.covered.ds > 0 || prev.covered.dealer > 0);
  const winDays = Math.min(reporting.days, comparison?.days ?? reporting.days);
  const rows: DealerGrowthRow[] = [];
  const eligibleLinesOf = (k: string, w: Win) => dealerWindow(daByDealer, k, w);
  for (const k of allKeys) {
    const a = attrs.get(k);
    const curF = figures(dealerWindow(daByDealer, k, reporting), dealerWindow(dsByDealer, k, reporting), settings);
    const prevF = comparison ? figures(dealerWindow(daByDealer, k, comparison), dealerWindow(dsByDealer, k, comparison), settings) : null;
    if (curF.combinedOrders === 0 && (!prevF || prevF.combinedOrders === 0)) continue; // not active in either window
    const earlier = comparison ? [...(daByDealer.get(k) ?? []), ...(dsByDealer.get(k) ?? [])].map((o) => o.date).filter((d): d is string => !!d && d < comparison.from).sort().pop() ?? null : null;
    const c = classify(prevF, curF, { hasBaseline: baselineOk, windowDays: winDays, dealerPartialBaseline: dealerPartial, earlierOrderDate: earlier });
    const p = prevF ? pct(curF.combinedValue, prevF.combinedValue) : null;
    const daCurOrders = eligibleLinesOf(k, reporting);
    const mb = daCurOrders.some((o) => isEligible(o, settings)) ? mbdOfOrders(daLines, daCurOrders, settings, slice).perDealer.get(k)?.modelsBilled ?? null : null;
    rows.push({
      key: k,
      name: titleCase((a?.name ?? k).toLowerCase()),
      outletId: a?.outletId ?? null,
      dbCode: isValidatedDealerKey(k) ? k : null,
      zone: a?.zone ?? null,
      city: a?.city ? titleCase(a.city.toLowerCase()) : null,
      onDealerApp: !!a?.onDealerApp,
      prev: prevF,
      cur: curF,
      changeValue: prevF ? curF.combinedValue - prevF.combinedValue : null,
      changePct: p,
      changeOrders: prevF ? curF.combinedOrders - prevF.combinedOrders : null,
      changeQty: prevF ? curF.combinedQty - prevF.combinedQty : null,
      changeDealerValue: prevF ? curF.dealerValue - prevF.dealerValue : null,
      changeDsValue: prevF ? curF.dsValue - prevF.dsValue : null,
      dealerShare: curF.combinedValue > 0 ? curF.dealerValue / curF.combinedValue : null,
      dsShare: curF.combinedValue > 0 ? curF.dsValue / curF.combinedValue : null,
      dealerSharePrev: prevF && prevF.combinedValue > 0 ? prevF.dealerValue / prevF.combinedValue : null,
      cls: c.cls,
      confidence: c.confidence,
      evidence: c.evidence,
      mbd: mb,
    });
  }
  rows.sort((x, y) => y.cur.combinedValue - x.cur.combinedValue || x.name.localeCompare(y.name));
  const classCounts = Object.fromEntries(CLASS_ORDER.map((c) => [c, rows.filter((r) => r.cls === c).length])) as Record<GrowthClass, number>;

  // ---- combined change over everything in view
  const combinedValue = prev ? changeOf(prev.combined.value, cur.combined.value) : null;
  const combinedQty = prev ? changeOf(prev.combined.qty, cur.combined.qty) : null;
  const combinedOrders = prev ? changeOf(prev.combined.orders, cur.combined.orders) : null;

  // ---- benchmark: dealers with a Dealer App order against all other dealers, whole population, same windows
  let benchmark: Benchmark | null = null;
  if (comparison && baselineOk && !sliced) {
    const by = (os: OrderSummary[], w: Win) => {
      const m = new Map<string, number>();
      for (const o of os) if (inWin(o.date, w) && isEligible(o, settings)) m.set(dealerKeyOfOrder(o), (m.get(dealerKeyOfOrder(o)) ?? 0) + (o.value ?? 0));
      return m;
    };
    const dcur = by(daAll, reporting), dprev = by(daAll, comparison), scur = by(dsAll, reporting), sprev = by(dsAll, comparison);
    const keys = new Set([...dcur.keys(), ...dprev.keys(), ...scur.keys(), ...sprev.keys()]);
    const val = (m1: Map<string, number>, m2: Map<string, number>, k: string) => (m1.get(k) ?? 0) + (m2.get(k) ?? 0);
    const agg = (ks: string[]) => {
      const prevV = ks.reduce((a, k) => a + val(dprev, sprev, k), 0);
      const curV = ks.reduce((a, k) => a + val(dcur, scur, k), 0);
      return { dealers: ks.length, prev: prevV, cur: curV, pct: pct(curV, prevV) };
    };
    const pilotKeys = [...keys].filter((k) => attrs.get(k)?.onDealerApp && (val(dprev, sprev, k) > 0 || val(dcur, scur, k) > 0));
    const otherKeys = [...keys].filter((k) => !attrs.get(k)?.onDealerApp && (val(dprev, sprev, k) > 0 || val(dcur, scur, k) > 0));
    const pilotPrev = pilotKeys.map((k) => val(dprev, sprev, k)).filter((v) => v > 0);
    const lo = Math.min(...pilotPrev), hi = Math.max(...pilotPrev);
    const simKeys = pilotPrev.length ? otherKeys.filter((k) => { const v = val(dprev, sprev, k); return v >= lo && v <= hi; }) : [];
    const pilot = agg(pilotKeys), others = agg(otherKeys), sim = simKeys.length >= 5 ? agg(simKeys) : null;
    benchmark = { pilot, others, similar: sim ? { dealers: sim.dealers, pct: sim.pct } : null, diffPts: pilot.pct !== null && others.pct !== null ? (pilot.pct - others.pct) * 100 : null };
  }

  // ---- MBD (Dealer App only)
  let mbd: GrowthModel['mbd'] = null;
  if (showDealer) {
    const mOf = (w: Win) => mbdOfOrders(daLines, daView.filter((o) => inWin(o.date, w)), settings, slice);
    const c = mOf(reporting);
    const p = comparison ? mOf(comparison) : null;
    mbd = { cur: c.mbd, prev: p?.mbd ?? null, dealersCur: c.dealers, models: c.models };
  }

  const dupInView = dsDup.filter((o) => orderInView(o) && inWin(o.date, reporting) && isEligible(o, settings));
  const overlap = { orders: dupInView.length, value: dupInView.reduce((a, o) => a + (o.value ?? 0), 0) };
  const dsSpares = (() => {
    const w = data.dsOrders.filter((o) => inWin(o.orderDate, reporting) && inView(o.dealerKey ?? `name:${o.dealerName}`) && (o.value ?? 0) > 0);
    const tot = w.reduce((a, o) => a + (o.value ?? 0), 0);
    return tot > 0 ? w.reduce((a, o) => a + (o.sparesValue ?? 0), 0) / tot : null;
  })();

  // ---- heatmap: combined value per dealer per month, up to the cut-off
  const heatMap = new Map<string, number[]>();
  const monthIdx = new Map(span.months.map((m, i) => [m, i]));
  for (const [k, os] of [...daByDealer.entries(), ...dsByDealer.entries()]) {
    for (const o of os) {
      if (!o.date || o.date > span.cutoff || !isEligible(o, settings)) continue;
      const i = monthIdx.get(o.date.slice(0, 7));
      if (i === undefined) continue;
      let arr = heatMap.get(k);
      if (!arr) heatMap.set(k, (arr = span.months.map(() => 0)));
      arr[i] += o.value ?? 0;
    }
  }
  const heat: HeatRow[] = [...heatMap.entries()]
    .map(([k, arr]) => ({ key: k, name: titleCase((attrs.get(k)?.name ?? k).toLowerCase()), values: arr.map((v) => (v > 0 ? v : null)), total: arr.reduce((a, v) => a + v, 0) }))
    .filter((r) => r.total > 0)
    .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));

  // ---- how much of a window's value sits on its three busiest days
  const peakOf = (w: Win | null): PeakDays | null => {
    if (!w) return null;
    const byDay = new Map<string, number>();
    let total = 0;
    for (const o of [...daView, ...dsView]) {
      if (!inWin(o.date, w) || !isEligible(o, settings)) continue;
      byDay.set(o.date as string, (byDay.get(o.date as string) ?? 0) + (o.value ?? 0));
      total += o.value ?? 0;
    }
    if (total <= 0 || byDay.size < 5) return null;
    const top = [...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { days: top.map(([d]) => d).sort(), share: top.reduce((a, [, v]) => a + v, 0) / total };
  };
  const peaks = { reporting: peakOf(reporting), comparison: peakOf(comparison) };

  // ---- the orders behind the numbers (the duplicate DataSense rows are listed, flagged, and never counted)
  const orders: GrowthOrder[] = [];
  const addOrders = (os: OrderSummary[], system: ChannelId, duplicate: boolean) => {
    for (const o of os) {
      const w = inWin(o.date, reporting) ? 'reporting' : comparison && inWin(o.date, comparison) ? 'comparison' : null;
      if (!w) continue;
      orders.push({ key: `${system}:${o.key}`, system, window: w, orderId: o.orderId, sapOrderId: o.sapOrderId, dealerKey: o.dealerKey, dealerName: titleCase(o.dealerName.toLowerCase()), date: o.date, status: STATUS_LABELS[o.statusGroup], qty: o.qty, value: o.value, eligible: !duplicate && isEligible(o, settings), duplicate });
    }
  };
  addOrders(daView, 'dealer', false);
  addOrders(dsView, 'ds', false);
  if (!sliced) addOrders(dsDup.filter(orderInView), 'ds', true);

  const notes: string[] = [];
  notes.push(`Both channels are compared up to ${new Date(`${span.cutoff}T00:00:00Z`).getUTCDate()} ${monthShort(span.cutoff.slice(0, 7))}, the last day both order files reach. Later orders are not used on this page.`);
  if (span.dealer) notes.push(`The Dealer App's first order is on ${fDate(span.dealer[0])}; days before it are not zero business, the app did not exist yet.`);
  if (comparisonNote) notes.push(comparisonNote);
  if (sliced) notes.push('A model or wheel-size filter is applied. DataSense orders have no model field, so DataSense and the combined figures are left out while it is on.');
  const dayList = (p: PeakDays) => p.days.map((d) => `${+d.slice(8, 10)} ${monthShort(d.slice(0, 7))}`).join(', ');
  for (const [name, p] of [['reporting', peaks.reporting], ['comparison', peaks.comparison]] as const) {
    if (p && p.share >= 0.4) notes.push(`The three busiest days of the ${name} period (${dayList(p)}) hold ${(p.share * 100).toFixed(0)}% of its order value, so the comparison is sensitive to them.`);
  }
  if (overlap.orders > 0 || dsDup.length > 0) notes.push(`${dsDup.length} DataSense order${dsDup.length === 1 ? '' : 's'} carry the SAP number of a Dealer App order of the same dealer and are counted once, as Dealer App.`);

  const model: GrowthModel = {
    span,
    reporting,
    comparison,
    comparisonNote,
    input,
    sliced,
    channels: { dealer: showDealer, ds: showDs && !sliced },
    cur,
    prev,
    kpis,
    months,
    rows,
    classCounts,
    combinedValue: sliced ? null : combinedValue,
    combinedQty: sliced ? null : combinedQty,
    combinedOrders: sliced ? null : combinedOrders,
    benchmark,
    mbd,
    overlap,
    dealerLaunch: span.dealer?.[0] ?? null,
    notes,
    insights: [],
    dealersInView: dealerSet ? dealerSet.size : attrs.size,
    dsSparesShare: dsSpares,
    heat,
    orders,
    peaks,
  };
  model.insights = growthInsights(model);
  return model;
}

/* -------------------------------- insights -------------------------------- */

export const fPctS = (v: number, d = 0): string => `${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(d)}%`;
/** A signed change: +₹1.20 L / −₹3.40 L. */
export const fInrD = (v: number): string => `${v > 0 ? '+' : ''}${fInrS(v)}`;
export const fInrS = (v: number): string => {
  const a = Math.abs(v);
  const t = a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2)} L` : a >= 1e3 ? `₹${(a / 1e3).toFixed(1)} K` : `₹${Math.round(a)}`;
  return `${v < 0 ? '−' : ''}${t}`;
};
const fPctPlain = (v: number | null, d = 1): string => (v === null ? '—' : `${(v * 100).toFixed(d)}%`);

/**
 * Where a dealer stands on the Dealer App in the reporting period, in plain words. "On the app" means at least one Dealer App
 * order of any status exists in the data; "ordering" means an eligible order in the period.
 */
export function adoptionStatusOf(row: Pick<DealerGrowthRow, 'onDealerApp' | 'cur'>): { id: 'both' | 'app-only' | 'lapsed' | 'sfa-only' | 'none'; label: string; detail: string } {
  const da = row.cur.dealerOrders > 0;
  const ds = row.cur.dsOrders > 0;
  if (da && ds) return { id: 'both', label: 'Ordering through both channels', detail: 'Eligible Dealer App and DataSense orders in the period.' };
  if (da) return { id: 'app-only', label: 'Dealer App only', detail: 'Eligible Dealer App orders and no DataSense orders in the period.' };
  if (row.onDealerApp && ds) return { id: 'lapsed', label: 'On the Dealer App, ordering through DataSense', detail: 'Has placed Dealer App orders before but none in the period; the orders came through DataSense.' };
  if (ds) return { id: 'sfa-only', label: 'Not on the Dealer App', detail: 'DataSense orders only; no Dealer App order exists for this dealer in the data.' };
  return { id: 'none', label: 'No orders in the period', detail: 'No eligible order in either channel in the reporting period.' };
}

/** The link that opens the dealer comparison table of the first page with the same windows and a class selected. */
export const growthLink = (input: Pick<GrowthInput, 'rp' | 'cp'>, extra: Record<string, string> = {}): string => {
  const p = new URLSearchParams();
  if (input.rp) p.set('rp', input.rp);
  if (input.cp && input.cp !== 'prev') p.set('cp', input.cp);
  Object.entries(extra).forEach(([k, v]) => p.set(k, v));
  const q = p.toString();
  return q ? `/?${q}` : '/';
};

/**
 * Insights are statements the numbers on this page support, each with the figure, the periods and a link. Nothing is
 * produced when its inputs are missing or too small to mean anything, and none claims cause: "grew" is a measurement,
 * "because of the Dealer App" is not.
 */
export function growthInsights(m: GrowthModel): GrowthInsight[] {
  const out: GrowthInsight[] = [];
  const period = m.comparison ? `${m.reporting.label} vs ${m.comparison.label}` : m.reporting.label;
  const base = { rp: m.input.rp, cp: m.input.cp };
  if (!m.comparison || !m.prev) return out;
  const scope = m.input.dealers.length || m.input.dbs.length ? 'the selected dealers' : m.input.cohort === 'pilot' ? 'the Dealer App dealers' : 'all dealers';
  const cv = m.combinedValue;

  if (!m.sliced && cv && m.prev.combined.orders > 0) {
    const g = cv.pct;
    if (g !== null) {
      const tone: Tone = Math.abs(g) < FLAT_BAND ? 'warn' : g > 0 ? 'good' : 'bad';
      const dA = (m.cur.dealer?.value ?? 0) - (m.prev.dealer?.value ?? 0);
      const dS = (m.cur.ds?.value ?? 0) - (m.prev.ds?.value ?? 0);
      out.push({
        id: 'combined',
        tone,
        title: `Combined order value of ${scope} is ${fPctS(g, 1)} ${g >= 0 ? 'higher' : 'lower'}`,
        detail: `Dealer App ${fInrD(dA)}, DataSense ${fInrD(dS)}. ${m.prev.covered.dealer < (m.comparison?.days ?? 0) ? `The Dealer App was live for ${m.prev.covered.dealer} of the ${m.comparison?.days} days of the comparison period, so its gain is partly the app starting up. ` : ''}This is sales value, not profit, and it does not show the Dealer App caused it.`,
        metric: `${fInrS(m.prev.combined.value)} → ${fInrS(m.cur.combined.value)}`,
        period,
        to: growthLink(base, { show: 'dealers' }),
        toLabel: 'See dealers',
      });
    }
  }

  if (!m.sliced && m.cur.dealer && m.cur.ds && m.prev.dealer && m.prev.ds) {
    const dA = m.cur.dealer.value - m.prev.dealer.value;
    const dS = m.cur.ds.value - m.prev.ds.value;
    if (dA > 0 && dS < 0 && -dS >= 0.5 * dA && m.combinedValue && m.combinedValue.pct !== null && Math.abs(m.combinedValue.pct) < GROWTH_THRESHOLD) {
      out.push({
        id: 'shift',
        tone: 'warn',
        title: 'Orders appear to have moved from DataSense to the Dealer App without growing combined business',
        detail: `Dealer App ${fInrD(dA)} while DataSense ${fInrD(dS)}; combined ${fPctS(m.combinedValue.pct, 1)}.`,
        metric: `Combined ${fPctS(m.combinedValue.pct, 1)}`,
        period,
        to: growthLink(base, { show: 'dealers', cls: 'migration' }),
        toLabel: 'See channel-shift dealers',
      });
    }
  }

  const o = m.combinedOrders;
  const a = m.cur.combined.aov !== null && m.prev.combined.aov !== null ? changeOf(m.prev.combined.aov, m.cur.combined.aov) : null;
  if (o && a && o.pct !== null && a.pct !== null && Math.abs(o.pct) >= 0.05 && Math.abs(a.pct) >= 0.05 && Math.sign(o.pct) !== Math.sign(a.pct)) {
    out.push({
      id: 'orders-aov',
      tone: 'warn',
      title: o.pct > 0 ? 'Order count rose while average order value fell' : 'Order count fell while average order value rose',
      detail: `Orders ${fPctS(o.pct)} (${o.from} → ${o.to}); average order value ${fPctS(a.pct)} (${fInrS(a.from)} → ${fInrS(a.to)}). Value growth depends on which of the two moves more.`,
      metric: `AOV ${fPctS(a.pct)}`,
      period,
      to: growthLink(base, { show: 'trends' }),
      toLabel: 'See the trends',
    });
  }

  const gains = m.rows.filter((r) => (r.changeValue ?? 0) > 0).sort((x, y) => (y.changeValue ?? 0) - (x.changeValue ?? 0));
  const totalGain = gains.reduce((s, r) => s + (r.changeValue ?? 0), 0);
  if (gains.length >= 3 && totalGain > 0) {
    const top = gains.slice(0, Math.min(3, Math.ceil(gains.length / 3)));
    const share = top.reduce((s, r) => s + (r.changeValue ?? 0), 0) / totalGain;
    if (share >= 0.6) {
      out.push({
        id: 'concentration',
        tone: 'neutral',
        title: `${top.length === 1 ? 'One dealer accounts' : `${top.length} of ${gains.length} growing dealers account`} for ${(share * 100).toFixed(0)}% of the increase`,
        detail: top.map((r) => `${r.name} ${fInrD(r.changeValue ?? 0)}`).join(' · '),
        metric: `${(share * 100).toFixed(0)}% of ${fInrS(totalGain)}`,
        period,
        to: growthLink(base, { show: 'dealers', cls: 'incremental' }),
        toLabel: 'See the dealers',
      });
    }
  }

  const ad = m.cur.adoption;
  const adPrev = m.prev.adoption;
  if (ad !== null && adPrev !== null && !m.sliced && m.prev.covered.dealer > 0) {
    const adopted = ad - adPrev;
    if (adopted > 0.05 && cv && cv.pct !== null && cv.pct < FLAT_BAND) {
      out.push({ id: 'adoption-flat', tone: 'warn', title: 'Dealer App adoption is rising but combined business has not grown', detail: `Adoption ${fPctPlain(adPrev, 0)} → ${fPctPlain(ad, 0)} of active dealers; combined order value ${fPctS(cv.pct, 1)}.`, metric: `Adoption ${fPctPlain(ad, 0)}`, period, to: growthLink(base, { show: 'adoption' }), toLabel: 'See adoption' });
    }
  }

  const dR = m.cur.dealer?.rejectionRate ?? null;
  const sR = m.cur.ds?.rejectionRate ?? null;
  if (dR !== null && sR !== null && (m.cur.dealer?.grossOrders ?? 0) >= 10 && (m.cur.ds?.grossOrders ?? 0) >= 10 && Math.abs(dR - sR) >= 0.03) {
    out.push({
      id: 'rejection',
      tone: dR < sR ? 'good' : 'bad',
      title: `Dealer App orders are rejected ${dR < sR ? 'less' : 'more'} often than DataSense orders`,
      detail: `Rejected share of orders placed: Dealer App ${fPctPlain(dR)} (${m.cur.dealer?.rejected} of ${m.cur.dealer?.grossOrders}), DataSense ${fPctPlain(sR)} (${m.cur.ds?.rejected} of ${m.cur.ds?.grossOrders}). Rejections are lost sales in either channel.`,
      metric: `${fPctPlain(dR)} vs ${fPctPlain(sR)}`,
      period: m.reporting.label,
      to: growthLink(base, { show: 'orders', 'f.status': 'Rejected', 'l.status': 'Rejected' }),
      toLabel: 'See rejected orders',
    });
  }

  const b = m.benchmark;
  if (b && b.pilot.pct !== null && b.others.pct !== null && b.pilot.dealers >= 3) {
    const sim = b.similar && b.similar.pct !== null ? ` Against ${b.similar.dealers} other dealers of a similar size: ${fPctS(b.similar.pct, 1)}.` : '';
    out.push({
      id: 'benchmark',
      tone: (b.diffPts ?? 0) >= 2 ? 'good' : (b.diffPts ?? 0) <= -2 ? 'bad' : 'neutral',
      title: `Dealer App dealers grew ${fPctS(b.pilot.pct, 1)} against ${fPctS(b.others.pct, 1)} for all other dealers`,
      detail: `Combined order value, ${b.pilot.dealers} Dealer App dealers vs ${b.others.dealers} others, same two periods.${sim} This is a comparison, not proof: the Dealer App dealers were not chosen at random.`,
      metric: `${(b.diffPts ?? 0) >= 0 ? '+' : '−'}${Math.abs(b.diffPts ?? 0).toFixed(1)} pts`,
      period,
      to: growthLink(base, { show: 'dealers' }),
      toLabel: 'See dealers',
    });
  }

  const mig = m.classCounts.migration;
  const inc = m.classCounts.incremental;
  const dec = m.classCounts.declining;
  if (m.rows.length) {
    out.push({
      id: 'classes',
      tone: dec > inc ? 'bad' : inc > 0 ? 'good' : 'neutral',
      title: `${inc} dealer${inc === 1 ? '' : 's'} show incremental growth, ${mig} a possible channel shift and ${dec} a decline`,
      detail: 'Each dealer is classified on its combined Dealer App + DataSense order value; the rules and the evidence are in the table.',
      metric: `${inc} · ${mig} · ${dec}`,
      period,
      to: growthLink(base, { show: 'dealers' }),
      toLabel: 'See the table',
    });
  }
  return out;
}

/** Unit-free helpers other modules use. */
export { inWin };
export type { Change };


/* ------------------------------- filter choices ------------------------------- */

export interface CatalogueDealer {
  key: string;
  name: string;
  outletId: string | null;
  zone: string | null;
  /** upper-case city, as the filter value */
  city: string | null;
  onDealerApp: boolean;
}

/**
 * Every dealer that appears in either order export, independent of any selection, so a filter list never shrinks
 * to the dealers already chosen. Dealers are keyed by the validated ERP code (or a name key when a record has none).
 */
export function growthCatalogue(data: AppData): CatalogueDealer[] {
  const m = new Map<string, CatalogueDealer>();
  const get = (key: string, name: string) => {
    let a = m.get(key);
    if (!a) m.set(key, (a = { key, name, outletId: null, zone: null, city: null, onDealerApp: false }));
    return a;
  };
  for (const l of data.dealerLines) {
    const a = get(l.dealerKey ?? `name:${l.outletName}`, l.outletName);
    a.name = l.outletName || a.name;
    a.outletId = l.outletId || a.outletId;
    a.zone = l.zone ?? a.zone;
    a.city = (l.city ?? a.city ?? '').trim().toUpperCase() || a.city;
    a.onDealerApp = true;
  }
  for (const o of data.dsOrders) {
    const a = get(o.dealerKey ?? `name:${o.dealerName}`, o.dealerName);
    if (!a.city && o.city) a.city = o.city.trim().toUpperCase();
  }
  return [...m.values()].map((d) => ({ ...d, name: titleCase(d.name.toLowerCase()) }));
}
