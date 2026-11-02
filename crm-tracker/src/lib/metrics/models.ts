// Models billed per dealer (MBD) and the model view of the Dealer App order lines.
//
// WHAT THE FILE CONTAINS. The Dealer App order export has one row per SKU line, with the dealer (Outlet_ERP_ID), the SKU
// (SKU, SKU_Code), the model name (Sku_Brand: NEXT, STING, FAIRY ...), a Category column that says "Cycles" on every
// line, the ordered quantity and amount, and, for lines that were billed, an Invoice_Id, Fulfilled_Quantity and
// Fulfilled_Amount.
//
// MODEL. The model of a line is its Sku_Brand exactly as the Dealer App records it. Names are not merged ("NEXT",
// "NEXT SPORTS" and "NEXT T25" are three models, as they are in the file). A blank model is shown as "Not specified".
//
// WHEEL SIZE. The file has no model category (Category is "Cycles" everywhere), so the only grouping that can be read
// from the data is the size written in the SKU name: 24T / 27.5T (wheel, inch), 29ER (inch) or 55CM (frame, cm).
// Nothing is guessed: a SKU that states no size is grouped as "Not stated".
//
// BILLED. A line is billed when it carries an Invoice_Id and a fulfilled quantity above zero. In the real files these two
// always go together (386 of 607 lines) and no rejected order has an invoice.
//
// MBD (models billed per dealer). For one dealer: the number of distinct models with at least one billed line. For a view
// (all dealers, a month, a zone ...): the sum of the dealers' MBD ÷ the dealers with at least one eligible order in that
// view, so a dealer that ordered but was billed nothing counts as 0 and pulls the average down. Lines are always the
// lines of eligible orders (value above zero, not rejected unless the setting says so), and the same slice (model, wheel
// size) applies to numerator and denominator.
import type { DealerOrderLine, OrderSummary, Settings } from '../types';
import { isEligible, modelOf, NO_MODEL } from './orders';
import { titleCase } from '../util/parse';

export { modelOf, NO_MODEL };
export const NO_SIZE = 'none';

export const dealerKeyOfLine = (l: DealerOrderLine): string => l.dealerKey ?? `name:${l.outletName}`;
export const isBilledLine = (l: DealerOrderLine): boolean => !!l.invoiceId && (l.fulfilledQty ?? 0) > 0;

/** The wheel or frame size written in the SKU name, as a key: "24", "27.5", "55cm", or "none". */
export function wheelSizeOf(l: DealerOrderLine): string {
  const name = l.sku ?? '';
  const inch = /(?<![\d.])(\d{2}(?:\.\d)?)\s?T\b/i.exec(name) ?? /(?<![\d.])(\d{2})ER\b/i.exec(name);
  if (inch) return inch[1];
  const cm = /(?<![\d.])(\d{2})\s?CM\b/i.exec(name);
  if (cm) return `${cm[1]}cm`;
  return NO_SIZE;
}

export const wheelSizeLabel = (key: string): string => (key === NO_SIZE ? 'Not stated' : key.endsWith('cm') ? `${key.slice(0, -2)} cm frame` : `${key} inch`);

/** Inch sizes from small to large, then frame sizes in cm, then "not stated". */
export const wheelSizeOrder = (keys: string[]): string[] => {
  const rank = (k: string) => (k === NO_SIZE ? 3e6 : k.endsWith('cm') ? 2e6 + parseFloat(k) : parseFloat(k));
  return [...keys].sort((a, b) => rank(a) - rank(b));
};

/** The slice a page applies to the order lines: some models and/or some wheel sizes. Blank = no restriction. */
export interface LineSlice {
  model?: string | string[];
  size?: string | string[];
}
const among = (want: string | string[] | undefined, v: string): boolean => (Array.isArray(want) ? want.length === 0 || want.includes(v) : !want || want === v);
export const inSlice = (l: DealerOrderLine, s: LineSlice): boolean => among(s.model, modelOf(l)) && among(s.size, wheelSizeOf(l));

/* ------------------------------------ MBD ------------------------------------ */

export interface MbdDealer {
  key: string;
  label: string;
  /** distinct models on the dealer's eligible orders */
  modelsOrdered: number;
  /** distinct models with at least one billed line: the dealer's MBD */
  modelsBilled: number;
  /** names of the billed models, A–Z */
  models: string[];
  billedQty: number;
}

export interface Mbd {
  /** dealers with at least one eligible order line in the view: the denominator */
  dealers: number;
  /** of those, the dealers with at least one billed line */
  billedDealers: number;
  /** dealer–model pairs: the numerator (each dealer's MBD added up) */
  pairs: number;
  /** distinct models billed to any dealer in the view */
  models: number;
  /** pairs ÷ dealers; null when there is no dealer */
  mbd: number | null;
  perDealer: Map<string, MbdDealer>;
}

/** MBD over lines that are already limited to the eligible orders (and the model / size slice) of the view. */
export function modelsBilledPerDealer(lines: DealerOrderLine[]): Mbd {
  const per = new Map<string, { label: string; ordered: Set<string>; billed: Set<string>; billedQty: number }>();
  const allBilled = new Set<string>();
  for (const l of lines) {
    const k = dealerKeyOfLine(l);
    let e = per.get(k);
    if (!e) per.set(k, (e = { label: l.outletName || k, ordered: new Set(), billed: new Set(), billedQty: 0 }));
    const m = modelOf(l);
    e.ordered.add(m);
    if (isBilledLine(l)) {
      e.billed.add(m);
      e.billedQty += l.fulfilledQty ?? 0;
      allBilled.add(m);
    }
  }
  const perDealer = new Map<string, MbdDealer>();
  let pairs = 0;
  let billedDealers = 0;
  per.forEach((e, key) => {
    pairs += e.billed.size;
    if (e.billed.size) billedDealers += 1;
    perDealer.set(key, { key, label: titleCase(e.label.toLowerCase()), modelsOrdered: e.ordered.size, modelsBilled: e.billed.size, models: [...e.billed].sort(), billedQty: e.billedQty });
  });
  return { dealers: per.size, billedDealers, pairs, models: allBilled.size, mbd: per.size ? pairs / per.size : null, perDealer };
}

/** The lines of the eligible orders among `orders`, narrowed to the slice. */
export function eligibleLines(lines: DealerOrderLine[], orders: OrderSummary[], settings: Pick<Settings, 'includeRejected'>, slice: LineSlice = {}): DealerOrderLine[] {
  const ids = new Set(orders.filter((o) => isEligible(o, settings)).map((o) => o.orderId));
  return lines.filter((l) => ids.has(l.orderId) && inSlice(l, slice));
}

/** MBD of a set of orders (the figure on the Orders & Performance page and the Executive Overview). */
export function mbdOfOrders(lines: DealerOrderLine[], orders: OrderSummary[], settings: Pick<Settings, 'includeRejected'>, slice: LineSlice = {}): Mbd {
  return modelsBilledPerDealer(eligibleLines(lines, orders, settings, slice));
}

/* ----------------------------------- per model ----------------------------------- */

export interface ModelRow {
  model: string;
  /** distinct eligible orders that contain the model */
  orders: number;
  /** dealers that ordered it / dealers that were billed for it */
  dealers: number;
  billedDealers: number;
  qty: number;
  billedQty: number;
  value: number;
  billedValue: number;
  /** wheel sizes written in the model's SKU names, small to large */
  sizes: string[];
}

export function modelRows(lines: DealerOrderLine[]): ModelRow[] {
  const by = new Map<string, { orders: Set<string>; dealers: Set<string>; billedDealers: Set<string>; qty: number; billedQty: number; value: number; billedValue: number; sizes: Set<string> }>();
  for (const l of lines) {
    const m = modelOf(l);
    let e = by.get(m);
    if (!e) by.set(m, (e = { orders: new Set(), dealers: new Set(), billedDealers: new Set(), qty: 0, billedQty: 0, value: 0, billedValue: 0, sizes: new Set() }));
    e.orders.add(l.orderId);
    e.dealers.add(dealerKeyOfLine(l));
    e.qty += l.qty ?? 0;
    e.value += l.amount ?? 0;
    e.sizes.add(wheelSizeOf(l));
    if (isBilledLine(l)) {
      e.billedDealers.add(dealerKeyOfLine(l));
      e.billedQty += l.fulfilledQty ?? 0;
      e.billedValue += l.fulfilledAmount ?? 0;
    }
  }
  return [...by.entries()]
    .map(([model, e]) => ({ model, orders: e.orders.size, dealers: e.dealers.size, billedDealers: e.billedDealers.size, qty: e.qty, billedQty: e.billedQty, value: e.value, billedValue: e.billedValue, sizes: wheelSizeOrder([...e.sizes]) }))
    .sort((a, b) => b.billedQty - a.billedQty || b.qty - a.qty || a.model.localeCompare(b.model));
}

/** Filter-bar choices for the model and wheel size of the lines: each with the number of orders that contain it. */
export function sliceOptions(lines: DealerOrderLine[], pick: (l: DealerOrderLine) => string): Array<{ value: string; count: number }> {
  const orders = new Map<string, Set<string>>();
  for (const l of lines) {
    const k = pick(l);
    const s = orders.get(k);
    if (s) s.add(l.orderId);
    else orders.set(k, new Set([l.orderId]));
  }
  return [...orders.entries()].map(([value, s]) => ({ value, count: s.size }));
}
