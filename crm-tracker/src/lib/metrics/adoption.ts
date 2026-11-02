// How the Dealer App is being taken up, week by week, and the order list behind the Dealer App vs DataSense page.
//
// Weeks start on Monday and begin with the week of the first Dealer App order in the selected period. A week is shown
// only once it is complete in the data (its last day is on or before the latest DataSense order date), so the current,
// part-filled week never looks like a drop. Orders and values count eligible orders only (rejected orders are left out,
// as on every other page); "dealers that have placed an order" counts a dealer from its first order of any status, so a
// dealer whose first orders were rejected still counts as having started to use the app.
//
// Dealer App and DataSense are never added together: each system keeps its own column, and DataSense figures are for
// the same dealers that use the Dealer App.
import type { AppData, OrderSummary, Settings } from '../types';
import { buildDealerOrders, dsOrderSummaries, orderKpis, STATUS_LABELS } from './orders';
import { Period, dateInPeriod, monthInPeriod } from './period';
import type { Crosswalk } from './comparison';

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday of the week that contains the date. */
export const weekStartOf = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -back);
};

export const shortDayMonth = (iso: string): string => `${Number(iso.slice(8, 10))} ${SHORT_MONTH[Number(iso.slice(5, 7)) - 1]}`;

export interface AdoptionWeek {
  /** Monday of the week, ISO date (also the key a chart click carries) */
  key: string;
  label: string;
  from: string;
  to: string;
  appOrders: number;
  appValue: number;
  /** Dealer App dealers with an eligible order in the week */
  appDealers: number;
  /** Dealer App dealers that have placed their first order by the end of the week */
  onboarded: number;
  dsOrders: number;
  dsValue: number;
}

export interface Adoption {
  weeks: AdoptionWeek[];
  /** dealers that have placed a Dealer App order in the period */
  dealers: number;
  firstOrder: string;
  dataEnd: string;
}

export function dealerAppAdoption(data: AppData, period: Period, settings: Pick<Settings, 'includeRejected'>, crosswalk: Crosswalk = {}): Adoption | null {
  const app = buildDealerOrders(data.dealerLines).filter((o) => o.date && o.month && monthInPeriod(o.month, period) && dateInPeriod(o.date, period));
  if (!app.length) return null;
  const alias = new Map<string, string>();
  for (const [appKey, decisions] of Object.entries(crosswalk)) for (const d of decisions) if (d.decision === 'accepted') alias.set(d.dsKey, appKey);
  const appKeys = new Set(app.map((o) => o.dealerKey).filter((k): k is string => !!k));
  const dsFull = dsOrderSummaries(data.dsOrders);
  const ds = dsFull.filter((o) => o.date && o.dealerKey && appKeys.has(alias.get(o.dealerKey) ?? o.dealerKey) && dateInPeriod(o.date, period));

  const firstOrder = app.map((o) => o.date as string).sort()[0];
  const dates = [...ds.map((o) => o.date as string), ...app.map((o) => o.date as string)].sort();
  const dsAll = dsFull.map((o) => o.date).filter((d): d is string => !!d).sort();
  const dataEnd = dsAll.length ? dsAll[dsAll.length - 1] : dates[dates.length - 1];

  // first order (any status) per dealer
  const firstBy = new Map<string, string>();
  for (const o of app) {
    if (!o.dealerKey) continue;
    const cur = firstBy.get(o.dealerKey);
    if (!cur || (o.date as string) < cur) firstBy.set(o.dealerKey, o.date as string);
  }

  const weeks: AdoptionWeek[] = [];
  for (let start = weekStartOf(firstOrder); addDays(start, 6) <= dataEnd; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    const inWeek = (o: OrderSummary) => (o.date as string) >= start && (o.date as string) <= end;
    const a = app.filter(inWeek);
    const s = ds.filter(inWeek);
    const ak = orderKpis(a, settings, 'dealer');
    const sk = orderKpis(s, settings, 'ds');
    weeks.push({
      key: start,
      label: shortDayMonth(start),
      from: start,
      to: end,
      appOrders: ak.eligible,
      appValue: ak.eligibleValue,
      appDealers: ak.activeDealers,
      onboarded: [...firstBy.values()].filter((d) => d <= end).length,
      dsOrders: sk.eligible,
      dsValue: sk.eligibleValue,
    });
  }
  return { weeks, dealers: appKeys.size, firstOrder, dataEnd };
}

export interface ComparisonOrder {
  key: string;
  system: 'dealer' | 'ds';
  systemLabel: 'Dealer App' | 'DataSense';
  orderId: string;
  sapOrderId: string | null;
  dealerKey: string;
  dealerName: string;
  date: string | null;
  week: string | null;
  statusGroup: string;
  status: string;
  value: number | null;
  qty: number | null;
}

/**
 * The simple order list behind the comparison: every order of the Dealer App dealers, from both systems, in the months
 * that are compared.
 */
export function comparisonOrders(data: AppData, period: Period, months: string[], crosswalk: Crosswalk = {}): ComparisonOrder[] {
  const monthSet = new Set(months);
  const alias = new Map<string, string>();
  for (const [appKey, decisions] of Object.entries(crosswalk)) for (const d of decisions) if (d.decision === 'accepted') alias.set(d.dsKey, appKey);
  const inRange = (o: OrderSummary) => !!o.month && monthSet.has(o.month) && dateInPeriod(o.date, period);
  const app = buildDealerOrders(data.dealerLines).filter(inRange);
  const appKeys = new Set(app.map((o) => o.dealerKey).filter((k): k is string => !!k));
  const ds = dsOrderSummaries(data.dsOrders).filter((o) => inRange(o) && o.dealerKey && appKeys.has(alias.get(o.dealerKey) ?? o.dealerKey));
  const toRow = (o: OrderSummary): ComparisonOrder => {
    const dealerKey = o.dealerKey ? alias.get(o.dealerKey) ?? o.dealerKey : '';
    return {
      key: `${o.system}-${o.orderId}`,
      system: o.system,
      systemLabel: o.system === 'dealer' ? 'Dealer App' : 'DataSense',
      orderId: o.orderId,
      sapOrderId: o.sapOrderId,
      dealerKey,
      dealerName: o.dealerName,
      date: o.date,
      week: o.date ? weekStartOf(o.date) : null,
      statusGroup: o.statusGroup,
      status: STATUS_LABELS[o.statusGroup],
      value: o.value,
      qty: o.qty,
    };
  };
  return [...app, ...ds].map(toRow).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.orderId.localeCompare(b.orderId));
}
