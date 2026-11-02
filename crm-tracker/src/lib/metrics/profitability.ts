// Profitability: what the imported files can and cannot say.
//
// Profit needs cost. This module looks through the column headers of EVERY imported file for anything that measures cost,
// margin, discount, return, freight, incentive or contribution, and reports what it found. When nothing is found (the
// case for every export supplied so far) the dashboard says profitability is NOT verified and shows only the proxies that
// ARE in the data (sales value, quantity, order frequency, order value, selling price, fulfilment and rejection).
// A revenue figure is never relabelled as profit, and no margin is estimated from a guess.
import type { AppData } from '../types';

export type ProfitFieldKind = 'cost' | 'margin' | 'discount' | 'return' | 'freight' | 'incentive' | 'contribution';

export interface ProfitField {
  kind: ProfitFieldKind;
  /** the column header as exported */
  column: string;
  file: string;
}

/** Header fragments that would indicate each kind of field. Matched on normalised (lower-case, letters and digits only) headers. */
const PATTERNS: Array<{ kind: ProfitFieldKind; test: RegExp }> = [
  { kind: 'cost', test: /(cogs|costofgoods|costprice|unitcost|landedcost|purchaseprice|basiccost|standardcost|productcost|^cost$|totalcost)/ },
  { kind: 'margin', test: /(margin|profit|markup|gp$|gpvalue|grossprofit)/ },
  { kind: 'discount', test: /(discount|rebate|cashdisc|tradedisc|schemedisc|scheme(?!.*(id|code)))/ },
  { kind: 'return', test: /(return|creditnote|salesreturn|cancelledvalue)/ },
  { kind: 'freight', test: /(freight|transport|logistic|delivery(charge|cost)|shipping)/ },
  { kind: 'incentive', test: /(incentive|commission|bonus|payout|reward(?!points))/ },
  { kind: 'contribution', test: /(contribution|netsales|netrevenue|netamount|netvalue)/ },
];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface ProfitRequirement {
  item: string;
  why: string;
  /** the column that would provide it in a Dealer App / DataSense export */
  suggested: string;
}

export const PROFIT_REQUIREMENTS: ProfitRequirement[] = [
  { item: 'Cost of goods sold per SKU (or per order line)', why: 'Margin = selling value − cost. Without cost, a higher order value cannot be called more profit.', suggested: 'Cost / landed cost per SKU, by month' },
  { item: 'Discounts, schemes and rebates given per order', why: 'A channel can sell more at a lower realised price; the ASP in the data is before any scheme given outside the order.', suggested: 'Discount / scheme amount per order line' },
  { item: 'Returns and credit notes', why: 'Returned or cancelled-after-billing value overstates sales.', suggested: 'Sales-return / credit-note value linked to Order ID' },
  { item: 'Freight and logistics cost per order or per dealer', why: 'Smaller, more frequent orders can raise delivery cost per cycle.', suggested: 'Freight cost per invoice / lane' },
  { item: 'Incentives and commissions paid per channel', why: 'Dealer and field-force incentives differ by channel and reduce contribution.', suggested: 'Incentive / commission per order or per dealer' },
  { item: 'Channel cost to serve (field-force and platform cost)', why: 'Needed to compare the Dealer App with the field-sales (SFA) cost of obtaining the same order.', suggested: 'Cost per channel per month' },
];

export interface ProfitabilityCheck {
  /** true only if a cost AND a margin-or-contribution field exist; none have in any file supplied */
  verified: boolean;
  found: ProfitField[];
  /** files and header counts that were inspected, so the "nothing found" statement can be checked */
  inspected: Array<{ file: string; source: string; columns: number }>;
  columnsChecked: number;
  requirements: ProfitRequirement[];
  /** one-sentence status for the page */
  statement: string;
}

/** Looks through the headers of every imported file. */
export function inspectProfitability(data: Pick<AppData, 'datasets'>): ProfitabilityCheck {
  const found: ProfitField[] = [];
  const inspected = new Map<string, { file: string; source: string; columns: number }>();
  let columnsChecked = 0;
  for (const d of data.datasets) {
    const key = `${d.source}|${d.fileName}`;
    if (!inspected.has(key)) {
      inspected.set(key, { file: d.fileName, source: d.source, columns: d.columns.length });
      columnsChecked += d.columns.length;
    }
    for (const c of d.columns) {
      const n = norm(c);
      if (!n) continue;
      for (const p of PATTERNS) if (p.test.test(n)) found.push({ kind: p.kind, column: c, file: d.fileName });
    }
  }
  const hasCost = found.some((f) => f.kind === 'cost');
  const hasMargin = found.some((f) => f.kind === 'margin' || f.kind === 'contribution');
  const verified = hasCost && hasMargin;
  const statement = verified
    ? 'Cost and margin columns were found, but no margin is calculated here yet: the fields still have to be mapped and validated before profit is shown.'
    : found.length
      ? 'Profitability is NOT verified: the files contain some related columns but not the cost and margin fields profit needs.'
      : `Profitability is NOT verified: none of the ${columnsChecked} columns in the ${inspected.size} imported files hold cost, margin, discount, return, freight, incentive or contribution data.`;
  return { verified, found, inspected: [...inspected.values()], columnsChecked, requirements: PROFIT_REQUIREMENTS, statement };
}
