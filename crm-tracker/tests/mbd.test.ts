// Models billed per dealer (MBD): the definition on small hand-made orders, then the invariants on the real Dealer App files.
import { describe, expect, it } from 'vitest';
import type { DealerOrderLine } from '../src/lib/types';
import { defaultSettings } from '../src/lib/types';
import { buildDealerOrders, isEligible } from '../src/lib/metrics/orders';
import { eligibleLines, inSlice, isBilledLine, mbdOfOrders, modelRows, modelsBilledPerDealer, sliceOptions, wheelSizeLabel, wheelSizeOf, wheelSizeOrder, modelOf } from '../src/lib/metrics/models';
import { HAS_DATA, buildAppData } from './helpers';

let n = 0;
const line = (o: Partial<DealerOrderLine>): DealerOrderLine => ({
  key: `k${++n}`, datasetId: 'd', rowNo: n, period: '2026-09', zone: 'East', city: 'Kolkata', warehouse: null, outletId: '1', outletName: 'Dealer One', dealerKey: '10061', beat: null,
  sku: 'NEXT 24T IC RS VB RD GY CKD T25', skuCode: `S${n}`, brand: 'NEXT', category: 'Cycles', orderId: '1', sapOrderId: null, orderDate: '2026-09-09', month: '2026-09',
  status: 'fulfilled', rawStatus: 'fulfilled', qty: 2, unitPrice: 100, amount: 200, invoiceId: 'INV1', invoiceDate: '2026-09-10', fulfilledAmount: 200, fulfilledDate: '2026-09-10', fulfilledQty: 2, lineStatus: 'fulfilled',
  ...o,
});
const unbilled = { invoiceId: null, invoiceDate: null, fulfilledAmount: null, fulfilledDate: null, fulfilledQty: null, lineStatus: 'not_fulfilled' as const };

// dealer A (order 1): NEXT billed, STING billed, FAIRY ordered but not billed; a second NEXT colour is billed too
// dealer B (order 2): NEXT billed twice (two colours)
// dealer C (order 3): STING, but the order was rejected
const LINES: DealerOrderLine[] = [
  line({ orderId: '1', dealerKey: 'A', outletName: 'Dealer A', brand: 'NEXT' }),
  line({ orderId: '1', dealerKey: 'A', outletName: 'Dealer A', brand: 'NEXT', sku: 'NEXT 26T IC RS VB BK BL CKD T25' }),
  line({ orderId: '1', dealerKey: 'A', outletName: 'Dealer A', brand: 'STING', sku: 'HERO STING 20T IC C/BRK BK YL CKD T24' }),
  line({ orderId: '1', dealerKey: 'A', outletName: 'Dealer A', brand: 'FAIRY', sku: 'HERO FAIRY 16T IC HR PK WH SKD - 22', ...unbilled }),
  line({ orderId: '2', dealerKey: 'B', outletName: 'Dealer B', brand: 'NEXT' }),
  line({ orderId: '2', dealerKey: 'B', outletName: 'Dealer B', brand: 'NEXT', sku: 'NEXT 26T IC RS VB GY RD CKD T25' }),
  line({ orderId: '3', dealerKey: 'C', outletName: 'Dealer C', brand: 'STING', status: 'rejected', rawStatus: 'rejected', ...unbilled }),
];

describe('MBD: what is billed and what is a model', () => {
  it('a line is billed only with an invoice AND a fulfilled quantity above zero', () => {
    expect(isBilledLine(line({}))).toBe(true);
    expect(isBilledLine(line({ invoiceId: null }))).toBe(false);
    expect(isBilledLine(line({ fulfilledQty: 0 }))).toBe(false);
    expect(isBilledLine(line({ fulfilledQty: null }))).toBe(false);
  });

  it('the model is the Sku_Brand as recorded; a blank brand is “Not specified”; variants are not merged', () => {
    expect(modelOf(line({ brand: 'NEXT SPORTS' }))).toBe('NEXT SPORTS');
    expect(modelOf(line({ brand: ' NEXT T25 ' }))).toBe('NEXT T25');
    expect(modelOf(line({ brand: null }))).toBe('Not specified');
    expect(modelOf(line({ brand: '  ' }))).toBe('Not specified');
  });

  it('reads the wheel or frame size from the SKU name and never from the other numbers in it', () => {
    const size = (sku: string | null) => wheelSizeOf(line({ sku }));
    expect(size('NEXT 24T IC RS VB RD GY CKD T25')).toBe('24');
    expect(size('NEXT 27.5T IC RS VB GY RD CKD T25')).toBe('27.5');
    expect(size('RIDE ON 20T BL GY 2.40 TYRE SKD 50% IH')).toBe('20');
    expect(size('SPRINT BLUNT(GEM) 29ER 21S DD RD GY SKD')).toBe('29');
    expect(size('SPRINT FLANKER(GEM)29ER 21S DD BK/YL SKD')).toBe('29');
    expect(size('JET GOLD 55CM S/B GN CTR QCC NRL')).toBe('55cm');
    expect(size('PRINCE 50CM S/B RB CP3 FUL NR7')).toBe('50cm');
    expect(size('SOMETHING WITHOUT A SIZE')).toBe('none');
    expect(size(null)).toBe('none');
    expect(wheelSizeLabel('24')).toBe('24 inch');
    expect(wheelSizeLabel('55cm')).toBe('55 cm frame');
    expect(wheelSizeLabel('none')).toBe('Not stated');
    expect(wheelSizeOrder(['none', '55cm', '26', '12', '27.5', '50cm'])).toEqual(['12', '26', '27.5', '50cm', '55cm', 'none']);
  });
});

describe('MBD: models billed per dealer', () => {
  const orders = buildDealerOrders(LINES);

  it('counts distinct billed models per dealer, however many lines or colours each model has', () => {
    const m = mbdOfOrders(LINES, orders, defaultSettings);
    expect(m.perDealer.get('A')!.modelsBilled).toBe(2); // NEXT (two lines) and STING; FAIRY was not billed
    expect(m.perDealer.get('A')!.modelsOrdered).toBe(3);
    expect(m.perDealer.get('A')!.models).toEqual(['NEXT', 'STING']);
    expect(m.perDealer.get('B')!.modelsBilled).toBe(1);
    expect(m.perDealer.get('B')!.billedQty).toBe(4);
  });

  it('the headline is the dealers’ counts added up ÷ dealers with an eligible order; a rejected order is left out', () => {
    const m = mbdOfOrders(LINES, orders, defaultSettings);
    expect(isEligible(orders.find((o) => o.orderId === '3')!, defaultSettings)).toBe(false);
    expect(m.dealers).toBe(2);
    expect(m.billedDealers).toBe(2);
    expect(m.pairs).toBe(3);
    expect(m.models).toBe(2); // NEXT and STING were billed to somebody
    expect(m.mbd).toBeCloseTo(1.5, 10);
  });

  it('a dealer with an eligible order but nothing billed counts as 0 in the average', () => {
    const m = mbdOfOrders(LINES, orders, { ...defaultSettings, includeRejected: true });
    expect(m.dealers).toBe(3);
    expect(m.billedDealers).toBe(2);
    expect(m.perDealer.get('C')!.modelsBilled).toBe(0);
    expect(m.mbd).toBeCloseTo(3 / 3, 10);
  });

  it('an empty view has no MBD rather than 0', () => {
    expect(modelsBilledPerDealer([]).mbd).toBeNull();
  });

  it('the model / wheel size slice narrows numerator and denominator together', () => {
    const next = mbdOfOrders(LINES, orders, defaultSettings, { model: 'NEXT' });
    expect(next.dealers).toBe(2);
    expect(next.mbd).toBe(1);
    const sting = mbdOfOrders(LINES, orders, defaultSettings, { model: 'STING' });
    expect(sting.dealers).toBe(1); // dealer B never ordered STING
    expect(sting.mbd).toBe(1);
    const fairy = mbdOfOrders(LINES, orders, defaultSettings, { model: 'FAIRY' });
    expect(fairy.dealers).toBe(1);
    expect(fairy.billedDealers).toBe(0);
    expect(fairy.mbd).toBe(0);
    const s26 = eligibleLines(LINES, orders, defaultSettings, { size: '26' });
    expect(s26).toHaveLength(2);
    expect(s26.every((l) => inSlice(l, { size: '26' }))).toBe(true);
  });

  it('rebuilding orders from only a model’s lines gives that model’s orders, value and quantity', () => {
    const nextOrders = buildDealerOrders(LINES.filter((l) => inSlice(l, { model: 'NEXT' })));
    expect(nextOrders.map((o) => [o.orderId, o.value, o.qty, o.models])).toEqual([
      ['1', 400, 4, ['NEXT']],
      ['2', 400, 4, ['NEXT']],
    ]);
    expect(buildDealerOrders(LINES).find((o) => o.orderId === '1')!.models).toEqual(['FAIRY', 'NEXT', 'STING']);
  });

  it('the model table adds up to the lines it was built from', () => {
    const rows = modelRows(eligibleLines(LINES, orders, defaultSettings));
    const next = rows.find((r) => r.model === 'NEXT')!;
    expect(next.orders).toBe(2);
    expect(next.dealers).toBe(2);
    expect(next.billedDealers).toBe(2);
    expect(next.qty).toBe(8);
    expect(next.billedQty).toBe(8);
    expect(next.sizes).toEqual(['24', '26']);
    const fairy = rows.find((r) => r.model === 'FAIRY')!;
    expect(fairy.billedDealers).toBe(0);
    expect(fairy.billedQty).toBe(0);
    expect(fairy.qty).toBe(2);
    expect(sliceOptions(LINES, modelOf).find((o) => o.value === 'NEXT')!.count).toBe(2); // orders, not lines
  });
});

describe.skipIf(!HAS_DATA)('MBD on the real Dealer App files', () => {
  const { data } = buildAppData();
  const lines = data.dealerLines;
  const orders = buildDealerOrders(lines);

  it('billed lines are exactly the lines with an invoice, and no rejected order is billed', () => {
    expect(lines).toHaveLength(607);
    const billed = lines.filter(isBilledLine);
    expect(billed).toHaveLength(386);
    expect(lines.filter((l) => !!l.invoiceId)).toHaveLength(386);
    expect(lines.filter((l) => (l.fulfilledQty ?? 0) > 0)).toHaveLength(386);
    expect(billed.every((l) => l.status !== 'rejected')).toBe(true);
  });

  it('gives the figures quoted in the delivery report', () => {
    const m = mbdOfOrders(lines, orders, defaultSettings);
    expect(m.dealers).toBe(10); // the eleventh dealer's orders were all rejected
    expect(m.billedDealers).toBe(10);
    expect(m.pairs).toBe(141);
    expect(m.models).toBe(56);
    expect(m.mbd).toBeCloseTo(14.1, 10);
    expect(mbdOfOrders(lines, orders, { ...defaultSettings, includeRejected: true }).mbd).toBeCloseTo(141 / 11, 10);
    const sep = mbdOfOrders(lines, orders.filter((o) => o.month === '2026-09'), defaultSettings);
    const oct = mbdOfOrders(lines, orders.filter((o) => o.month === '2026-10'), defaultSettings);
    expect([sep.dealers, sep.pairs]).toEqual([9, 67]);
    expect([oct.dealers, oct.pairs]).toEqual([7, 81]);
  });

  it('every dealer’s MBD is within the models it ordered, and the dealers add up to the pairs', () => {
    const m = mbdOfOrders(lines, orders, defaultSettings);
    let pairs = 0;
    m.perDealer.forEach((d) => {
      expect(d.modelsBilled).toBeLessThanOrEqual(d.modelsOrdered);
      pairs += d.modelsBilled;
    });
    expect(pairs).toBe(m.pairs);
  });

  it('slicing by model partitions the lines: nothing lost, nothing counted twice', () => {
    const all = eligibleLines(lines, orders, defaultSettings);
    const models = [...new Set(all.map(modelOf))];
    expect(models.length).toBeGreaterThan(40);
    const parts = models.map((model) => eligibleLines(lines, orders, defaultSettings, { model }));
    expect(parts.reduce((a, p) => a + p.length, 0)).toBe(all.length);
    const rows = modelRows(all);
    expect(rows.reduce((a, r) => a + r.billedQty, 0)).toBe(all.filter(isBilledLine).reduce((a, l) => a + (l.fulfilledQty ?? 0), 0));
    expect(rows.reduce((a, r) => a + r.billedValue, 0)).toBeCloseTo(all.filter(isBilledLine).reduce((a, l) => a + (l.fulfilledAmount ?? 0), 0), 2);
    // every dealer–model pair is seen once in the model table and once in the dealer view
    expect(rows.reduce((a, r) => a + r.billedDealers, 0)).toBe(mbdOfOrders(lines, orders, defaultSettings).pairs);
  });

  it('slicing by wheel size partitions the lines too, and every SKU gets a size or “not stated”', () => {
    const all = eligibleLines(lines, orders, defaultSettings);
    const sizes = [...new Set(all.map(wheelSizeOf))];
    const parts = sizes.map((size) => eligibleLines(lines, orders, defaultSettings, { size }));
    expect(parts.reduce((a, p) => a + p.length, 0)).toBe(all.length);
    expect(sizes).toContain('24');
    expect(sizes).not.toContain('none'); // every SKU in the supplied files states a size
  });

  it('with one model chosen, an order is rebuilt from that model’s lines only', () => {
    const model = 'NEXT';
    const sliced = buildDealerOrders(lines.filter((l) => inSlice(l, { model })));
    const full = new Map(orders.map((o) => [o.orderId, o]));
    for (const o of sliced) {
      expect(o.models).toEqual([model]);
      expect(o.value!).toBeLessThanOrEqual(full.get(o.orderId)!.value! + 1e-6);
    }
    expect(sliced.length).toBe(orders.filter((o) => o.models?.includes(model)).length);
  });
});
