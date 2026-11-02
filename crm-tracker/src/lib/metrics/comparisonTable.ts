// The Dealer App vs DataSense comparison table: one row per dealer, 15 columns in a fixed order and three groups.
//
//   Identity            Outlet ID | DB Code | DB Name
//   Sales App Data      (DataSense SFA)  complaints, orders, qty, value, average order value
//   Bizom App Data      (Dealer App)     complaints, orders, qty, value, average order value
//                       + Capillary (Hero Smiles): Smile Quiz Points, Current Total Points
//
// Mapping, checked against the files: "Sales App" is the DataSense SFA order report and complaint module; "Bizom App"
// is the Dealer App (built on Bizom) order export and complaint module. Rows are joined on the validated ERP dealer code
// only. Orders are distinct orders (Dealer App SKU lines are rolled up by Order ID first), value is the sum of eligible
// order values, AOV is eligible value ÷ eligible orders, complaints are distinct ticket identifiers, and Capillary points
// come from the latest valid snapshot (never added across snapshots). A figure the sources cannot supply is null and is
// shown as a dash, never as zero. The one deliberate exception: a Dealer App dealer that placed no DataSense order in the
// compared months (it orders only through the Dealer App) shows 0 for its DataSense orders, quantity, value and average
// order value, because it did record zero orders there; it is not a missing figure.
import type { CellValue, ColFormat } from '../export/format';
import type { CompareResult, CompareRow, CompareSide } from './comparison';

export type CmpGroup = 'identity' | 'sales' | 'app' | 'capillary';

export interface ComparisonRow {
  key: string;
  outletId: string | null;
  dbCode: string;
  dbName: string;
  match: CompareRow['match'];
  salesComplaints: number | null;
  salesOrders: number | null;
  salesQty: number | null;
  salesValue: number | null;
  salesAov: number | null;
  appComplaints: number | null;
  appOrders: number | null;
  appQty: number | null;
  appValue: number | null;
  appAov: number | null;
  /** The Capillary export has no quiz-points field, so this is always unavailable. */
  quizPoints: number | null;
  currentPoints: number | null;
  /** a short reason shown under the dealer name when a side has no figures (orders only through the Dealer App, orders all rejected ...) */
  note: string | null;
}

export interface CmpColumn {
  id: keyof ComparisonRow;
  header: string;
  group: CmpGroup;
  format: ColFormat;
  help: string;
}

/** Exact column order and header text of the comparison table (also used for the Excel/CSV export). */
export const COMPARISON_COLUMNS: CmpColumn[] = [
  { id: 'outletId', header: 'Outlet ID', group: 'identity', format: 'text', help: 'Dealer App outlet id (Outlet_ID).' },
  { id: 'dbCode', header: 'DB Code', group: 'identity', format: 'text', help: 'Validated ERP dealer code: Dealer App Outlet_ERP_ID = the [code] in the DataSense dealer name = Hero Smiles customer_external_ID.' },
  { id: 'dbName', header: 'DB Name', group: 'identity', format: 'text', help: 'Dealer name as recorded in the Dealer App (DataSense name when the dealer is not in the Dealer App). Names are labels only, never a join key.' },
  { id: 'salesComplaints', header: 'Sales App Complaint Count', group: 'sales', format: 'int', help: 'Distinct complaint ticket ids raised for the dealer in the DataSense complaint module, in the compared months.' },
  { id: 'salesOrders', header: 'Sales App Order Count', group: 'sales', format: 'int', help: 'Distinct eligible DataSense orders (value > 0, not rejected) in the compared months.' },
  { id: 'salesQty', header: 'Sales App Total Qty', group: 'sales', format: 'int', help: 'Cycles quantity of eligible DataSense orders. Spares are not counted, so it lines up with the Dealer App, which only has cycles.' },
  { id: 'salesValue', header: 'Sales App Total Value', group: 'sales', format: 'inr', help: 'Sum of “value of Order” over eligible DataSense orders.' },
  { id: 'salesAov', header: 'Avrg Order Value', group: 'sales', format: 'inr', help: 'Sales App Total Value ÷ Sales App Order Count (eligible orders only).' },
  { id: 'appComplaints', header: 'Dealer App Complaint Count', group: 'app', format: 'int', help: 'Distinct complaint ticket ids raised for the dealer in the Dealer App complaint module, in the compared months.' },
  { id: 'appOrders', header: 'Dealer App Order Count', group: 'app', format: 'int', help: 'Distinct eligible Dealer App orders (one per Order ID, however many SKU lines) in the compared months.' },
  { id: 'appQty', header: 'Dealer App Total Qty', group: 'app', format: 'int', help: 'Σ Order_Quantity over the lines of eligible Dealer App orders (all lines are cycles).' },
  { id: 'appValue', header: 'Dealer App Total Value', group: 'app', format: 'inr', help: 'Σ line Amount over eligible Dealer App orders.' },
  { id: 'appAov', header: 'Avrg Order Value', group: 'app', format: 'inr', help: 'Dealer App Total Value ÷ Dealer App Order Count (eligible orders only).' },
  { id: 'quizPoints', header: 'Capillary Smile Quiz Points', group: 'capillary', format: 'int', help: 'Not available: the Capillary (Hero Smiles) export has no quiz-points field. Its columns are lifetime_points, opening_balance, Points_issued, Points_expired, Points_manual_adjustment and Current_Points; none of them is quiz points, and Current_Points is never substituted for it.' },
  { id: 'currentPoints', header: 'Capillary Current Total Points', group: 'capillary', format: 'int', help: 'Current_Points of the dealer in the latest valid Hero Smiles snapshot (a point-in-time balance).' },
];

export const CMP_GROUP_LABEL: Record<CmpGroup, string> = {
  identity: 'Dealer',
  sales: 'Sales App Data · DataSense SFA',
  app: 'Bizom App Data · Dealer App',
  capillary: 'Capillary · Hero Smiles',
};

/** Shown under the dealer name of a Dealer App dealer that placed no DataSense order in the compared months. */
export const ONLY_DEALER_APP_NOTE = 'Orders only placed through Dealer App';
export const ONLY_DATASENSE_NOTE = 'Orders only placed through DataSense';

export const CAPILLARY_QUIZ_NOTE = 'The Hero Smiles (Capillary) export has no Smile Quiz Points field, so that column is shown as unavailable. Current Total Points is the Current_Points balance from the latest valid snapshot.';

/**
 * One side of a row. A side that is not part of the comparison at all (the dealer is not in that system) is null;
 * a side whose dealer placed no order in the compared months shows zero, with an average order value of 0 rather
 * than a dash when `zeroIfNone` says the zero is a real, recorded zero.
 */
function pick(side: CompareSide, present: boolean, complaintsKnown: boolean, zeroIfNone: boolean): { complaints: number | null; orders: number | null; qty: number | null; value: number | null; aov: number | null } {
  return {
    complaints: complaintsKnown ? side.complaints : null,
    orders: present ? side.orders : null,
    qty: present ? side.qty : null,
    value: present ? side.value : null,
    aov: present ? (side.aov ?? (zeroIfNone && side.grossOrders === 0 ? 0 : null)) : null,
  };
}

export function comparisonRows(res: CompareResult): ComparisonRow[] {
  return res.rows.map((r) => {
    // A Dealer App dealer is also a DataSense dealer, so when it placed no DataSense order its DataSense side is a real
    // zero, not a blank. A DataSense dealer that is not on the Dealer App has no Dealer App side at all (dashes).
    const s = pick(r.ds, true, res.complaintData.ds, r.match === 'dealer_only');
    const a = pick(r.dealer, r.match !== 'ds_only' || r.onDealerApp, res.complaintData.dealer, r.match === 'ds_only');
    return {
      key: r.key,
      outletId: r.outletId,
      dbCode: r.erpCode,
      dbName: r.name,
      match: r.match,
      salesComplaints: s.complaints,
      salesOrders: s.orders,
      salesQty: s.qty,
      salesValue: s.value,
      salesAov: s.aov,
      appComplaints: a.complaints,
      appOrders: a.orders,
      appQty: a.qty,
      appValue: a.value,
      appAov: a.aov,
      quizPoints: null,
      currentPoints: res.loyaltyData ? r.loyaltyPoints : null,
      note: rowNote(r),
    };
  });
}

function rowNote(r: CompareRow): string | null {
  if (r.match === 'dealer_only') return r.dealer.grossOrders > 0 ? ONLY_DEALER_APP_NOTE : 'No orders in the compared months';
  if (r.match === 'ds_only') return r.onDealerApp ? ONLY_DATASENSE_NOTE : 'Not in the Dealer App';
  if (r.ds.orders === 0) return r.ds.grossOrders > 0 ? 'DataSense orders were all rejected' : 'No DataSense orders in the compared months';
  if (r.dealer.orders === 0) return r.dealer.grossOrders > 0 ? 'Dealer App orders were all rejected' : 'No Dealer App orders in the compared months';
  return null;
}

const sum = (xs: Array<number | null>): number | null => {
  const k = xs.filter((x): x is number => x !== null);
  return k.length ? k.reduce((a, b) => a + b, 0) : null;
};

/**
 * Totals over the rows given. Counts, quantities and values add up; the average order value is recomputed as
 * total value ÷ total orders (never an average of averages); Capillary points add up across dealers because they all
 * come from the same snapshot; quiz points stay unavailable.
 */
export function comparisonTotals(rows: ComparisonRow[]): ComparisonRow {
  const sOrders = sum(rows.map((r) => r.salesOrders));
  const sValue = sum(rows.map((r) => r.salesValue));
  const aOrders = sum(rows.map((r) => r.appOrders));
  const aValue = sum(rows.map((r) => r.appValue));
  return {
    key: '__total',
    outletId: null,
    dbCode: '',
    dbName: 'Total',
    match: 'matched',
    salesComplaints: sum(rows.map((r) => r.salesComplaints)),
    salesOrders: sOrders,
    salesQty: sum(rows.map((r) => r.salesQty)),
    salesValue: sValue,
    salesAov: sOrders === null || sValue === null ? null : sOrders ? sValue / sOrders : 0,
    appComplaints: sum(rows.map((r) => r.appComplaints)),
    appOrders: aOrders,
    appQty: sum(rows.map((r) => r.appQty)),
    appValue: aValue,
    appAov: aOrders === null || aValue === null ? null : aOrders ? aValue / aOrders : 0,
    quizPoints: null,
    currentPoints: sum(rows.map((r) => r.currentPoints)),
    note: null,
  };
}

export const comparisonCell = (r: ComparisonRow, id: keyof ComparisonRow): CellValue => (id === 'match' ? r.match : (r[id] as CellValue));
