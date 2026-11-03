// A workbook can contain several reporting months. Month-keyed sources (the Dealer App orders) are stored one dataset per month,
// so each month can be replaced or skipped on its own and re-uploading a month can never count its records twice.
import type { DatasetPayload, DealerOrderLine } from '../types';

const MULTI_SCOPE = /^\d{4}-\d{2}_\d{4}-\d{2}$/;

/** Does this payload hold more than one month of a month-keyed source? */
export const isMultiMonth = (p: DatasetPayload): boolean => p.meta.source === 'dealer_orders' && MULTI_SCOPE.test(p.meta.scope);

/** The months (YYYY-MM, ascending) present in the order dates of a Dealer App payload. */
export function monthsOf(p: DatasetPayload<DealerOrderLine>): string[] {
  return [...new Set(p.records.map((l) => l.orderDate?.slice(0, 7)).filter((m): m is string => !!m && /^\d{4}-\d{2}$/.test(m)))].sort();
}

/** One payload per month. Counts, period and ids are recomputed from the lines kept; nothing is estimated. */
export function splitByMonth(p: DatasetPayload<DealerOrderLine>): Array<DatasetPayload<DealerOrderLine>> {
  const months = monthsOf(p);
  const undated = p.records.filter((l) => !l.orderDate).length;
  return months.map((m) => {
    const id = `${p.meta.source}:${m}`;
    const records = p.records.filter((l) => l.orderDate?.slice(0, 7) === m).map((l) => ({ ...l, datasetId: id, period: m }));
    const dates = records.map((l) => l.orderDate as string).sort();
    const orders = new Set(records.map((l) => l.orderId)).size;
    return {
      meta: {
        ...p.meta,
        id,
        scope: m,
        period: m,
        periodStart: dates[0] ?? null,
        periodEnd: dates[dates.length - 1] ?? null,
        asOfDate: dates[dates.length - 1] ?? null,
        validCount: records.length,
        rawCount: records.length,
        flaggedCount: 0,
        inference: [...(p.meta.inference ?? []), `The file holds ${months.length} months; ${m} is stored as its own dataset (${records.length} lines, ${orders} orders).`],
        extra: { ...(p.meta.extra ?? {}), uniqueOrders: orders, splitFrom: p.meta.scope, undatedLinesIgnored: undated },
      },
      raw: [],
      records,
      issues: p.issues,
    };
  });
}
