// Dealer App vs DataSense SFA: calculation layer for the landing page.
// Scope: the dealers that are on the Dealer App, September-October only, the same dates for both channels.
// Every figure is computed from the imported records; nothing is estimated or back-filled.

export type Ch = 'app' | 'ds';

export interface Ord {
  ch: Ch;
  id: string;
  dealer: string;
  date: string;
  month: string;
  status: 'valid' | 'rejected' | 'zero';
  raw: string;
  value: number;
  qty: number; // cycles quantity
  cv: number; // cycles value
  lines: any[]; // Dealer App lines of the order (empty for DataSense)
  sap: string | null;
  dup: boolean; // DataSense record that already is a Dealer App order (same SAP number, same dealer)
  sapPending: boolean;
  flags: string[];
}

export interface Agg {
  sub: number;
  valid: number;
  rej: number;
  zero: number;
  rejRate: number | null;
  value: number;
  qty: number;
  cv: number;
  cvQty: number;
  aov: number | null;
  vpc: number | null; // average value per cycle
  active: number; // dealers with at least one valid order
  submitters: number; // dealers with at least one submitted order
  rejValue: number;
  sapPending: number;
}

export interface Win {
  month: string;
  from: string;
  to: string;
  days: number;
  label: string; // "Sep 9–30"
  mlabel: string; // "September"
}

export interface Ctx {
  dealers: { key: string; name: string }[];
  months: string[];
  wins: Record<string, Win>;
  launch: string;
  cutoff: string;
  appLines: any[];
  dsAll: any[];
  appSapByDealer: Set<string>;
  dsOutsideBefore: { orders: number; value: number }; // DataSense orders of these dealers before the Dealer App launched (not compared)
  dsAfterCutoff: { orders: number };
  models: string[];
}

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: string) => MON[+m.slice(5, 7) - 1] ?? m;
export const monthShort = (m: string) => monthName(m).slice(0, 3);
const dayNum = (d: string) => +d.slice(8, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5) + 1;
const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;

export const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s.&(/-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
const isCycle = (c: string | null) => !c || /cycle/i.test(c);
export const NO_MODEL = 'Not specified';
export const modelOf = (l: any): string => ((l.brand ?? '') as string).trim() || NO_MODEL;

export function buildCtx(data: any): Ctx | null {
  const appLines: any[] = (data.dealerLines ?? []).filter((l: any) => l.dealerKey && l.orderDate);
  if (!appLines.length) return null;
  const names = new Map<string, string>();
  for (const l of appLines) if (!names.has(l.dealerKey)) names.set(l.dealerKey, titleCase(l.outletName || l.dealerKey));
  const dealers = [...names.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  const dates = appLines.map((l) => l.orderDate as string).sort();
  const launch = dates[0];
  const cutoff = dates[dates.length - 1];
  const months = [...new Set<string>(appLines.map((l) => l.month as string).filter(Boolean))].sort().slice(0, 2);
  const wins: Record<string, Win> = {};
  months.forEach((m, i) => {
    const from = i === 0 ? launch : `${m}-01`;
    const to = i === months.length - 1 ? (cutoff < monthEnd(m) ? cutoff : monthEnd(m)) : monthEnd(m);
    wins[m] = { month: m, from, to, days: daysBetween(from, to), label: `${monthShort(m)} ${dayNum(from)}–${dayNum(to)}`, mlabel: monthName(m) };
  });
  const keys = new Set(dealers.map((d) => d.key));
  const appSap = new Set<string>();
  for (const l of appLines) if (l.sapOrderId) appSap.add(`${l.dealerKey}|${l.sapOrderId}`);
  const dsAll: any[] = (data.dsOrders ?? []).filter((o: any) => o.dealerKey && keys.has(o.dealerKey) && o.orderDate);
  const before = dsAll.filter((o) => o.orderDate < launch && o.month === months[0]);
  const after = dsAll.filter((o) => o.orderDate > cutoff && months.includes(o.month));
  return {
    dealers,
    months,
    wins,
    launch,
    cutoff,
    appLines,
    dsAll,
    appSapByDealer: appSap,
    dsOutsideBefore: { orders: before.length, value: before.reduce((s, o) => s + (o.value ?? 0), 0) },
    dsAfterCutoff: { orders: after.length },
    models: [...new Set<string>(appLines.map(modelOf))].sort(),
  };
}

const inWin = (ctx: Ctx, date: string | null) => !!date && ctx.months.some((m) => date >= ctx.wins[m].from && date <= ctx.wins[m].to);
const monthOf = (ctx: Ctx, date: string) => ctx.months.find((m) => date >= ctx.wins[m].from && date <= ctx.wins[m].to) as string;

/** Dealer App SKU lines -> orders. A model filter keeps only the matching lines (value and quantity follow the lines kept). */
export function appOrders(ctx: Ctx, models: string[] | null): Ord[] {
  const set = models && models.length ? new Set(models) : null;
  const by = new Map<string, any[]>();
  for (const l of ctx.appLines) {
    if (!inWin(ctx, l.orderDate)) continue;
    if (set && !set.has(modelOf(l))) continue;
    const a = by.get(l.orderId);
    if (a) a.push(l);
    else by.set(l.orderId, [l]);
  }
  const out: Ord[] = [];
  by.forEach((ls, id) => {
    const first = ls[0];
    const cnt = new Map<string, number>();
    ls.forEach((l) => cnt.set(l.status, (cnt.get(l.status) ?? 0) + 1));
    const st = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let value = 0;
    let qty = 0;
    let cv = 0;
    for (const l of ls) {
      value += l.amount ?? 0;
      if (isCycle(l.category)) {
        qty += l.qty ?? 0;
        cv += l.amount ?? 0;
      }
    }
    out.push({
      ch: 'app', id, dealer: first.dealerKey, date: first.orderDate, month: monthOf(ctx, first.orderDate),
      status: st === 'rejected' ? 'rejected' : value > 0 ? 'valid' : 'zero', raw: first.rawStatus, value, qty, cv, lines: ls,
      sap: first.sapOrderId ?? null, dup: false, sapPending: false, flags: [],
    });
  });
  return out;
}

export function dsOrders(ctx: Ctx): Ord[] {
  const out: Ord[] = [];
  for (const o of ctx.dsAll) {
    if (!inWin(ctx, o.orderDate)) continue;
    const dup = ctx.appSapByDealer.has(`${o.dealerKey}|${o.orderNo}`) || (!!o.invoiceNo && ctx.appSapByDealer.has(`${o.dealerKey}|${o.invoiceNo}`));
    const v = o.value ?? 0;
    out.push({
      ch: 'ds', id: o.orderNo, dealer: o.dealerKey, date: o.orderDate, month: monthOf(ctx, o.orderDate),
      status: o.statusGroup === 'rejected' ? 'rejected' : v > 0 ? 'valid' : 'zero', raw: o.rawStatus, value: v, qty: o.cyclesQty ?? 0, cv: o.cyclesValue ?? 0,
      lines: [], sap: o.orderNo, dup, sapPending: o.statusGroup === 'sap_pending', flags: o.flags ?? [],
    });
  }
  return out;
}

export function agg(os: Ord[]): Agg {
  const valid = os.filter((o) => o.status === 'valid');
  const rej = os.filter((o) => o.status === 'rejected');
  const value = valid.reduce((s, o) => s + o.value, 0);
  const qty = valid.reduce((s, o) => s + o.qty, 0);
  const withQty = valid.filter((o) => o.qty > 0);
  const cvQty = withQty.reduce((s, o) => s + o.qty, 0);
  const cv = withQty.reduce((s, o) => s + o.cv, 0);
  return {
    sub: os.length, valid: valid.length, rej: rej.length, zero: os.filter((o) => o.status === 'zero').length,
    rejRate: os.length ? rej.length / os.length : null,
    value, qty, cv, cvQty, aov: valid.length ? value / valid.length : null, vpc: cvQty > 0 ? cv / cvQty : null,
    active: new Set(valid.map((o) => o.dealer)).size, submitters: new Set(os.map((o) => o.dealer)).size,
    rejValue: rej.reduce((s, o) => s + o.value, 0), sapPending: valid.filter((o) => o.sapPending).length,
  };
}

export interface Filters {
  month: 'both' | string;
  dealers: string[]; // empty = all
  channel: 'both' | Ch;
  models: string[]; // empty = all
}

export const pctChange = (from: number | null, to: number | null): number | null => (from === null || to === null || from <= 0 ? null : (to - from) / from);

export interface ModelRow {
  model: string;
  byMonth: Record<string, { orders: number; qty: number; value: number }>;
  orders: number;
  qty: number;
  value: number;
  share: number;
  rejOrders: number;
  rejValue: number;
  billedQty: number;
  billedDealers: number;
  dealers: number;
}
export interface SkuRow {
  sku: string;
  model: string;
  byMonth: Record<string, { qty: number; value: number }>;
  qty: number;
  value: number;
  share: number;
  orders: number;
}

export interface DealerRow {
  key: string;
  name: string;
  app: Agg;
  ds: Agg;
  appM: Record<string, Agg>;
  dsM: Record<string, Agg>;
  appShare: number | null;
  appShareValue: number | null;
  appChange: number | null; // valid orders, last month - first month
  appChangePct: number | null;
  topModel: string | null;
  signals: string[];
  mig: Mig;
}

export interface Mig {
  cls: 'incremental' | 'migration' | 'declining' | 'stable' | 'insufficient';
  evidence: string;
  appDv: number;
  dsDv: number;
  combo: Record<string, { orders: number; value: number }>;
  combPct: number | null;
  appUpDsDown: boolean;
  poorConversion: boolean;
}

export const SIG = {
  high_adoption: { label: 'High app adoption', tone: 'good' },
  increasing: { label: 'App usage rising', tone: 'good' },
  low_none: { label: 'Low / no valid app orders', tone: 'bad' },
  high_rej: { label: 'High app rejection', tone: 'bad' },
  ds_reliant: { label: 'Still mostly DataSense', tone: 'warn' },
} as const;
export type SigKey = keyof typeof SIG;

export const T = { highAdoptShare: 0.7, highAdoptMin: 2, rejRate: 0.2, rejMin: 3, combChange: 0.1, baseMin: 3, convMin: 0.5 };

export interface TrendPoint {
  month: string;
  label: string;
  app: Agg | null; // null before the Dealer App launched (not zero)
  ds: Agg | null;
}

/** DataSense April-to-latest month for the dealers in view; the Dealer App only for its own months. */
export function buildTrend(ctx: Ctx, dealerKeys: string[], appAll: Ord[]): TrendPoint[] {
  const dset = new Set(dealerKeys);
  const first = ctx.dsAll.map((o: any) => o.month as string).filter(Boolean).sort()[0] ?? ctx.months[0];
  const last = ctx.months[ctx.months.length - 1];
  const list: string[] = [];
  for (let m = first; m <= last; ) {
    list.push(m);
    const y = +m.slice(0, 4);
    const mo = +m.slice(5, 7);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return list.map((m) => {
    const win = ctx.wins[m];
    const from = win ? win.from : `${m}-01`;
    const to = win ? win.to : monthEnd(m);
    const dsO: Ord[] = [];
    for (const o of ctx.dsAll) {
      if (!dset.has(o.dealerKey) || o.orderDate < from || o.orderDate > to) continue;
      const dup = ctx.appSapByDealer.has(`${o.dealerKey}|${o.orderNo}`) || (!!o.invoiceNo && ctx.appSapByDealer.has(`${o.dealerKey}|${o.invoiceNo}`));
      if (dup) continue;
      const v = o.value ?? 0;
      dsO.push({ ch: 'ds', id: o.orderNo, dealer: o.dealerKey, date: o.orderDate, month: m, status: o.statusGroup === 'rejected' ? 'rejected' : v > 0 ? 'valid' : 'zero', raw: o.rawStatus, value: v, qty: o.cyclesQty ?? 0, cv: o.cyclesValue ?? 0, lines: [], sap: o.orderNo, dup: false, sapPending: false, flags: [] });
    }
    return { month: m, label: monthShort(m), app: win ? agg(appAll.filter((o) => o.month === m)) : null, ds: agg(dsO) };
  });
}

export interface View {
  ctx: Ctx;
  f: Filters;
  months: string[]; // months shown
  both: boolean;
  dealerKeys: string[];
  show: { app: boolean; ds: boolean };
  dsAvailable: boolean; // false while a model filter is on (DataSense orders carry no model)
  app: Agg;
  ds: Agg;
  appM: Record<string, Agg>;
  dsM: Record<string, Agg>;
  dsDupCount: number;
  rows: DealerRow[];
  models: ModelRow[];
  skus: SkuRow[];
  mbd: Record<string, { value: number | null; dealers: number; models: number }>;
  mbdDealer: Record<string, Record<string, number>>;
  trend: TrendPoint[];
  appRejByModel: { model: string; orders: number; value: number }[];
  appOrders: Ord[];
  dsOrders: Ord[];
  dsPossibleDup: number;
  daysLabel: string;
  periodLabel: string;
}

export function buildView(ctx: Ctx, f: Filters): View {
  const months = f.month === 'both' ? ctx.months : ctx.months.filter((m) => m === f.month);
  const dealerKeys = f.dealers.length ? ctx.dealers.filter((d) => f.dealers.includes(d.key)).map((d) => d.key) : ctx.dealers.map((d) => d.key);
  const dset = new Set(dealerKeys);
  const modelsOn = f.models.length > 0;
  const aAll = appOrders(ctx, modelsOn ? f.models : null).filter((o) => dset.has(o.dealer));
  const dAll = dsOrders(ctx).filter((o) => dset.has(o.dealer));
  const dDup = dAll.filter((o) => o.dup);
  const dKeep = dAll.filter((o) => !o.dup);
  const inM = (o: Ord) => months.includes(o.month);
  const aSel = aAll.filter(inM);
  const dSel = dKeep.filter(inM);
  const byMonth = (os: Ord[]) => Object.fromEntries(ctx.months.map((m) => [m, agg(os.filter((o) => o.month === m))])) as Record<string, Agg>;
  const appM = byMonth(aAll);
  const dsM = byMonth(dKeep);

  const rows: DealerRow[] = ctx.dealers.filter((d) => dset.has(d.key)).map((d) => {
    const ao = aSel.filter((o) => o.dealer === d.key);
    const dso = dSel.filter((o) => o.dealer === d.key);
    const aMo = Object.fromEntries(ctx.months.map((m) => [m, agg(aAll.filter((o) => o.dealer === d.key && o.month === m))])) as Record<string, Agg>;
    const dMo = Object.fromEntries(ctx.months.map((m) => [m, agg(dKeep.filter((o) => o.dealer === d.key && o.month === m))])) as Record<string, Agg>;
    const app = agg(ao);
    const ds = agg(dso);
    const m1 = ctx.months[0];
    const m2 = ctx.months[ctx.months.length - 1];
    const both = ctx.months.length > 1;
    const appChange = both ? aMo[m2].valid - aMo[m1].valid : null;
    const mTop = new Map<string, number>();
    ao.filter((o) => o.status === 'valid').forEach((o) => o.lines.forEach((l) => mTop.set(modelOf(l), (mTop.get(modelOf(l)) ?? 0) + (l.amount ?? 0))));
    const top = [...mTop.entries()].sort((a, b) => b[1] - a[1])[0];
    const combo = Object.fromEntries(ctx.months.map((m) => [m, { orders: aMo[m].valid + dMo[m].valid, value: aMo[m].value + dMo[m].value }]));
    const appDv = both ? aMo[m2].value - aMo[m1].value : 0;
    const dsDv = both ? dMo[m2].value - dMo[m1].value : 0;
    const base = both ? combo[m1] : { orders: 0, value: 0 };
    const cur = both ? combo[m2] : { orders: 0, value: 0 };
    const combPct = both && base.value > 0 ? (cur.value - base.value) / base.value : null;
    const appUpDsDown = both && aMo[m2].valid > aMo[m1].valid && dMo[m2].valid < dMo[m1].valid;
    const poorConversion = both && aMo[m2].sub > aMo[m1].sub && (aMo[m2].sub > 0 ? aMo[m2].valid / aMo[m2].sub : 1) < T.convMin;
    let cls: Mig['cls'] = 'stable';
    let evidence = '';
    const fm = (n: number) => `${n < 0 ? '−' : '+'}₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
    if (!both) {
      cls = 'insufficient';
      evidence = 'Needs both months.';
    } else if (cur.orders + base.orders === 0) {
      cls = 'insufficient';
      evidence = 'No valid order in either channel in either month.';
    } else if (base.orders === 0) {
      cls = 'insufficient';
      evidence = `No valid order in ${monthName(m1)}, so there is no baseline.`;
    } else if (base.orders < T.baseMin) {
      cls = 'insufficient';
      evidence = `Only ${base.orders} valid order${base.orders === 1 ? '' : 's'} in ${monthName(m1)} (fewer than ${T.baseMin}).`;
    } else if (combPct !== null && combPct >= T.combChange) {
      cls = 'incremental';
      evidence = `Combined value ${fm(cur.value - base.value)} (${(combPct * 100).toFixed(0)}%).`;
    } else if (combPct !== null && combPct <= -T.combChange) {
      cls = 'declining';
      evidence = `Combined value ${fm(cur.value - base.value)} (${(combPct * 100).toFixed(0)}%).`;
    } else if (appDv > 0 && dsDv < 0 && -dsDv / appDv >= 0.5 && -dsDv / appDv <= 2) {
      cls = 'migration';
      evidence = `Dealer App ${fm(appDv)}, DataSense ${fm(dsDv)}; combined within ±${T.combChange * 100}%.`;
    } else {
      evidence = `Combined value ${combPct === null ? 'unchanged' : `${combPct >= 0 ? '+' : '−'}${Math.abs(combPct * 100).toFixed(0)}%`}.`;
    }
    const mig: Mig = { cls, evidence, appDv, dsDv, combo, combPct, appUpDsDown, poorConversion };
    const tot = app.valid + ds.valid;
    const share = tot > 0 ? app.valid / tot : null;
    const sig: SigKey[] = [];
    if (app.valid >= T.highAdoptMin && share !== null && share >= T.highAdoptShare) sig.push('high_adoption');
    if (both && aMo[m2].valid > aMo[m1].valid && aMo[m2].valid >= 2) sig.push('increasing');
    if (app.valid <= 1) sig.push('low_none');
    if (app.sub >= T.rejMin && (app.rejRate ?? 0) >= T.rejRate) sig.push('high_rej');
    if (ds.valid > app.valid) sig.push('ds_reliant');
    const tv = app.value + ds.value;
    return {
      key: d.key, name: d.name, app, ds, appM: aMo, dsM: dMo, appShare: share, appShareValue: tv > 0 ? app.value / tv : null,
      appChange, appChangePct: both ? pctChange(aMo[m1].valid, aMo[m2].valid) : null, topModel: top ? top[0] : null, signals: sig, mig,
    };
  });

  // models / SKUs: Dealer App only (DataSense orders have no model or SKU)
  const mMap = new Map<string, any>();
  const sMap = new Map<string, any>();
  const rejMap = new Map<string, { orders: number; value: number }>();
  const billedSets = new Map<string, Set<string>>();
  const mbdBy: Record<string, Map<string, Set<string>>> = Object.fromEntries(ctx.months.map((m) => [m, new Map<string, Set<string>>()]));
  const validDealersBy: Record<string, Set<string>> = Object.fromEntries(ctx.months.map((m) => [m, new Set<string>()]));
  for (const o of aAll) {
    if (o.status === 'rejected') {
      if (!months.includes(o.month)) continue;
      const ms = new Map<string, number>();
      o.lines.forEach((l) => ms.set(modelOf(l), (ms.get(modelOf(l)) ?? 0) + (l.amount ?? 0)));
      ms.forEach((v, k) => {
        const r = rejMap.get(k) ?? { orders: 0, value: 0 };
        r.orders += 1;
        r.value += v;
        rejMap.set(k, r);
      });
      continue;
    }
    if (o.status !== 'valid') continue;
    validDealersBy[o.month].add(o.dealer);
    for (const l of o.lines) {
      const billed = !!l.invoiceId && (l.fulfilledQty ?? 0) > 0;
      if (billed) {
        const s = mbdBy[o.month].get(o.dealer) ?? new Set<string>();
        s.add(modelOf(l));
        mbdBy[o.month].set(o.dealer, s);
      }
      if (!months.includes(o.month)) continue;
      const mk = modelOf(l);
      const m = mMap.get(mk) ?? { model: mk, byMonth: {}, orderIds: new Set<string>(), qty: 0, value: 0, billedQty: 0, billedDealers: new Set<string>(), dealers: new Set<string>() };
      const bm = (m.byMonth[o.month] ??= { orders: new Set<string>(), qty: 0, value: 0 });
      bm.orders.add(o.id);
      m.orderIds.add(o.id);
      m.dealers.add(o.dealer);
      const q = isCycle(l.category) ? l.qty ?? 0 : 0;
      bm.qty += q;
      bm.value += l.amount ?? 0;
      m.qty += q;
      m.value += l.amount ?? 0;
      if (billed) {
        m.billedQty += l.fulfilledQty ?? 0;
        m.billedDealers.add(o.dealer);
      }
      mMap.set(mk, m);
      const sk = (l.sku ?? l.skuCode ?? 'Not specified') as string;
      const s = sMap.get(sk) ?? { sku: sk, model: mk, byMonth: {}, qty: 0, value: 0, orderIds: new Set<string>() };
      const sm = (s.byMonth[o.month] ??= { qty: 0, value: 0 });
      sm.qty += q;
      sm.value += l.amount ?? 0;
      s.qty += q;
      s.value += l.amount ?? 0;
      s.orderIds.add(o.id);
      sMap.set(sk, s);
    }
  }
  void billedSets;
  const totVal = [...mMap.values()].reduce((s, m) => s + m.value, 0);
  const models: ModelRow[] = [...mMap.values()].map((m) => ({
    model: m.model,
    byMonth: Object.fromEntries(Object.entries(m.byMonth).map(([k, v]: any) => [k, { orders: v.orders.size, qty: v.qty, value: v.value }])),
    orders: m.orderIds.size, qty: m.qty, value: m.value, share: totVal > 0 ? m.value / totVal : 0,
    rejOrders: rejMap.get(m.model)?.orders ?? 0, rejValue: rejMap.get(m.model)?.value ?? 0,
    billedQty: m.billedQty, billedDealers: m.billedDealers.size, dealers: m.dealers.size,
  })).sort((a, b) => b.value - a.value);
  for (const [k, r] of rejMap) if (!mMap.has(k)) models.push({ model: k, byMonth: {}, orders: 0, qty: 0, value: 0, share: 0, rejOrders: r.orders, rejValue: r.value, billedQty: 0, billedDealers: 0, dealers: 0 });
  const skuTot = [...sMap.values()].reduce((s, m) => s + m.value, 0);
  const skus: SkuRow[] = [...sMap.values()].map((s) => ({ sku: s.sku, model: s.model, byMonth: s.byMonth, qty: s.qty, value: s.value, share: skuTot > 0 ? s.value / skuTot : 0, orders: s.orderIds.size })).sort((a, b) => b.value - a.value);
  const mbd = Object.fromEntries(ctx.months.map((m) => {
    const dealers = validDealersBy[m].size;
    const pairs = [...mbdBy[m].values()].reduce((s, x) => s + x.size, 0);
    const allModels = new Set<string>();
    mbdBy[m].forEach((x) => x.forEach((k) => allModels.add(k)));
    return [m, { value: dealers ? pairs / dealers : null, dealers, models: allModels.size }];
  })) as View['mbd'];
  const mbdDealer: Record<string, Record<string, number>> = {};
  for (const d of dealerKeys) mbdDealer[d] = Object.fromEntries(ctx.months.map((mm) => [mm, mbdBy[mm].get(d)?.size ?? 0]));
  const appRejByModel = [...rejMap.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.orders - a.orders);

  const wl = months.map((m) => ctx.wins[m]);
  const daysLabel = wl.map((w) => `${w.label}${''}`).join(' and ');
  const periodLabel = f.month === 'both' ? `${monthName(ctx.months[0])}–${monthName(ctx.months[ctx.months.length - 1])} 2026` : `${monthName(f.month)} 2026`;
  return {
    ctx, f, months, both: months.length > 1, dealerKeys, show: { app: f.channel !== 'ds', ds: f.channel !== 'app' }, dsAvailable: !modelsOn,
    app: agg(aSel), ds: agg(dSel), appM, dsM, dsDupCount: dDup.filter(inM).length, rows, models, skus, mbd, mbdDealer, trend: buildTrend(ctx, dealerKeys, aAll), appRejByModel,
    appOrders: aSel, dsOrders: dSel, dsPossibleDup: dSel.filter((o) => o.flags.includes('possible_duplicate')).length, daysLabel, periodLabel,
  };
}

// ---------------------------------------------------------------- formatting

export const inr = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)} L` : a >= 1e3 ? `${s}₹${(a / 1e3).toFixed(1)} K` : `${s}₹${Math.round(a)}`;
};
export const inrFull = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`);
export const int = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-IN'));
export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(d)}%`);
export const spct = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : '+'}${Math.abs(n * 100).toFixed(d)}%`);
export const sint = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(Math.round(n)).toLocaleString('en-IN')}`);
export const sinr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n < 0 ? '−' : '+'}${inr(Math.abs(n))}`);

// ---------------------------------------------------------------- key takeaways

export interface Takeaway {
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  title: string;
  detail: string;
  period: string;
}

export function takeaways(v: View): Takeaway[] {
  const out: Takeaway[] = [];
  const { app, ds, ctx } = v;
  const N = v.dealerKeys.length;
  const per = `${v.periodLabel} · ${v.months.map((m) => ctx.wins[m].label).join(', ')}`;
  const m1 = ctx.months[0];
  const m2 = ctx.months[ctx.months.length - 1];
  if (v.f.channel !== 'both') {
    out.push({ tone: 'neutral', title: `Showing one channel only (${v.f.channel === 'app' ? 'Dealer App' : 'DataSense SFA'})`, detail: 'Set Channel to “Both channels” to compare the two channels and to see the comparative findings.', period: per });
  }
  if (!v.dsAvailable) {
    out.push({ tone: 'warn', title: 'A model filter is on, so DataSense is left out', detail: 'DataSense orders carry no model or SKU, so the two channels cannot be compared by model. Clear the model filter to compare them.', period: per });
  }
  const cmp = v.show.app && v.show.ds && v.dsAvailable;
  if (cmp) {
    const lead = app.valid === ds.valid ? 'the same number of' : app.valid > ds.valid ? 'more' : 'fewer';
    const vl = app.value === ds.value ? 'the same' : app.value > ds.value ? 'higher' : 'lower';
    out.push({
      tone: 'neutral',
      title: `Dealer App has ${lead} valid orders and ${vl} order value than DataSense`,
      detail: `${N} dealers placed ${int(app.valid)} valid Dealer App orders (${inrFull(app.value)}) and ${int(ds.valid)} valid DataSense orders (${inrFull(ds.value)}). Order value is sales value, not profit.`,
      period: per,
    });
    if (app.aov !== null && ds.aov !== null) {
      const d = pctChange(ds.aov, app.aov);
      out.push({
        tone: 'neutral',
        title: `Average order value is ${app.aov >= ds.aov ? 'higher' : 'lower'} on the Dealer App`,
        detail: `Dealer App ${inrFull(app.aov)} vs DataSense ${inrFull(ds.aov)}${d !== null ? ` (${spct(d)})` : ''}. ${app.vpc !== null && ds.vpc !== null ? `Average value per cycle: ${inrFull(app.vpc)} vs ${inrFull(ds.vpc)}.` : ''}`,
        period: per,
      });
    }
  }
  if (v.show.app) {
    const act1 = v.appM[m1].active;
    const act2 = v.appM[m2].active;
    const onlyApp = v.rows.filter((r) => r.app.valid > 0 && r.ds.sub === 0).length;
    const zero = v.rows.filter((r) => r.app.valid === 0).map((r) => r.name);
    out.push({
      tone: app.active >= N * 0.7 ? 'good' : app.active >= N * 0.4 ? 'warn' : 'bad',
      title: `${app.active} of ${N} dealers placed at least one valid Dealer App order`,
      detail: `${ctx.months.length > 1 ? `${monthName(m1)}: ${act1}, ${monthName(m2)}: ${act2}. ` : ''}${onlyApp ? `${onlyApp} of them placed no DataSense order at all in the period. ` : ''}${zero.length ? `No valid app order yet: ${zero.join(', ')}.` : 'Every dealer in view has a valid app order.'} A dealer with only rejected submissions is not counted as active.`,
      period: per,
    });
    if (v.both) {
      const a1 = v.appM[m1];
      const a2 = v.appM[m2];
      const d = pctChange(a1.valid, a2.valid);
      const dv = pctChange(a1.value, a2.value);
      out.push({
        tone: a2.valid > a1.valid ? 'good' : a2.valid < a1.valid ? 'bad' : 'warn',
        title: `Dealer App valid orders ${a2.valid > a1.valid ? 'rose' : a2.valid < a1.valid ? 'fell' : 'were flat'} from ${monthName(m1)} to ${monthName(m2)}`,
        detail: `${int(a1.valid)} (${ctx.wins[m1].label}) → ${int(a2.valid)} (${ctx.wins[m2].label}), ${d === null ? 'no baseline' : spct(d)}; order value ${inr(a1.value)} → ${inr(a2.value)}${dv === null ? '' : ` (${spct(dv)})`}. The windows are ${ctx.wins[m1].days} and ${ctx.wins[m2].days} days long. ${monthName(m1)} was the launch month (first order ${+ctx.launch.slice(8)} ${monthShort(m1)}), so the base is small.`,
        period: per,
      });
    }
  }
  if (cmp && app.rejRate !== null && ds.rejRate !== null) {
    const lower = app.rejRate < ds.rejRate;
    out.push({
      tone: Math.abs(app.rejRate - ds.rejRate) < 0.02 ? 'neutral' : lower ? 'good' : 'bad',
      title: `Dealer App rejection rate is ${Math.abs(app.rejRate - ds.rejRate) < 0.02 ? 'similar to' : lower ? 'lower than' : 'higher than'} DataSense`,
      detail: `Dealer App ${pct(app.rejRate)} (${app.rej} of ${app.sub} submitted, ${inr(app.rejValue)}) vs DataSense ${pct(ds.rejRate)} (${ds.rej} of ${ds.sub}, ${inr(ds.rejValue)}). ${Math.min(app.sub, ds.sub) < 20 ? 'Small base: read as indicative.' : ''}`,
      period: per,
    });
  }
  if (v.show.app) {
    const top = [...v.rows].sort((a, b) => b.app.value - a.app.value).filter((r) => r.app.value > 0).slice(0, 3);
    if (top.length && app.value > 0) {
      const share = top.reduce((s, r) => s + r.app.value, 0) / app.value;
      out.push({
        tone: share >= 0.7 ? 'warn' : 'neutral',
        title: `${top.length === 1 ? 'One dealer drives' : `Top ${top.length} dealers drive`} ${pct(share, 0)} of Dealer App order value`,
        detail: top.map((r) => `${r.name} ${inr(r.app.value)}`).join(' · ') + (share >= 0.7 ? '. App value is concentrated in a few dealers.' : '.'),
        period: per,
      });
    }
  }
  if (cmp) {
    const reliant = v.rows.filter((r) => r.ds.valid > r.app.valid).sort((a, b) => b.ds.value - a.ds.value);
    out.push({
      tone: reliant.length ? 'warn' : 'good',
      title: reliant.length ? `${reliant.length} of ${N} dealers still order mostly through DataSense` : 'No dealer orders mostly through DataSense',
      detail: reliant.length ? reliant.slice(0, 4).map((r) => `${r.name} (DataSense ${r.ds.valid} vs app ${r.app.valid} valid orders)`).join(' · ') + '.' : 'Every dealer in view has at least as many valid Dealer App orders as DataSense orders.',
      period: per,
    });
  }
  if (v.show.app && v.models.length) {
    const byV = v.models.find((m) => m.value > 0);
    const bySku = v.skus[0];
    if (byV) {
      out.push({
        tone: 'neutral',
        title: `Best-selling model on the Dealer App: ${byV.model}`,
        detail: `${inrFull(byV.value)} (${pct(byV.share, 0)} of app value), ${int(byV.qty)} cycles, ${byV.orders} orders${bySku ? `; best SKU ${bySku.sku} (${int(bySku.qty)} cycles)` : ''}. DataSense orders have no model or SKU, so a DataSense comparison by product is not possible from the Order Punched Report.`,
        period: per,
      });
    }
  }
  if (cmp) {
    const mig = v.rows.filter((r) => r.mig.cls === 'migration');
    const inc = v.rows.filter((r) => r.mig.cls === 'incremental');
    const conv = v.rows.filter((r) => r.mig.poorConversion);
    const lowN = v.rows.filter((r) => r.app.valid === 0).length;
    const bits: string[] = [];
    if (v.both) {
      bits.push(`${inc.length} dealer${inc.length === 1 ? '' : 's'} show combined growth, ${mig.length} a possible channel shift`);
      if (conv.length) bits.push(`${conv.length} submitted more app orders but converted under ${T.convMin * 100}% to valid`);
    }
    if (lowN) bits.push(`${lowN} of ${N} have no valid app order`);
    out.push({
      tone: mig.length || conv.length || lowN ? 'warn' : 'neutral',
      title: 'Concerns and opportunities',
      detail: `${bits.length ? bits.join('; ') + '.' : 'No pattern stands out.'} These are observed patterns, not proof that the Dealer App caused them.`,
      period: per,
    });
  }
  return out;
}
