// The per-page filter bars: options come from each page's own records, and the Executive Overview's dealer filter
// narrows every dealer-level figure to one validated ERP code without touching the figures that are not per dealer.
import { describe, expect, it } from 'vitest';
import { HAS_DATA, buildAppData } from './helpers';
import { buildOptions } from '../src/components/FilterBar';
import { dealerChoices, scopeToDealer } from '../src/lib/metrics/scope';
import { buildDealerOrders, dsOrderSummaries, orderKpis } from '../src/lib/metrics/orders';
import { bizomVsSfa } from '../src/lib/metrics/employees';
import { ALL_PERIOD } from '../src/lib/metrics/period';
import { isValidatedDealerKey } from '../src/lib/nav/links';
import { defaultSettings, emptyAppData } from '../src/lib/types';

describe('buildOptions', () => {
  const rows = [
    { z: 'West', m: '2026-10', n: 'a' },
    { z: 'North', m: '2026-09', n: 'b' },
    { z: 'West', m: '2026-09', n: 'c' },
    { z: '', m: '2026-10', n: 'd' },
    { z: null as string | null, m: '2026-10', n: 'e' },
  ];

  it('counts each distinct value, leaves blanks out and puts the most frequent first', () => {
    const o = buildOptions(rows, (r) => r.z);
    expect(o.map((x) => [x.value, x.count])).toEqual([
      ['West', 2],
      ['North', 1],
    ]);
  });

  it('sorts by key, by label or in an explicit order, and can leave the counts off', () => {
    expect(buildOptions(rows, (r) => r.m, { sort: 'value' }).map((x) => x.value)).toEqual(['2026-09', '2026-10']);
    expect(buildOptions(rows, (r) => r.z, { sort: 'label', label: (k) => k.toUpperCase() }).map((x) => x.label)).toEqual(['NORTH', 'WEST']);
    expect(buildOptions(rows, (r) => r.z, { sort: ['West', 'North'] }).map((x) => x.value)).toEqual(['West', 'North']);
    expect(buildOptions(rows, (r) => r.z, { noCounts: true }).every((x) => x.count === undefined)).toBe(true);
  });

  it('labels an option from the first record that carries it', () => {
    const o = buildOptions(rows, (r) => r.z, { label: (_k, s) => `${s.n}!` });
    expect(o.find((x) => x.value === 'West')?.label).toBe('a!');
  });

  it('an empty page offers no options', () => {
    expect(buildOptions([] as typeof rows, (r) => r.z)).toEqual([]);
  });
});

describe('scopeToDealer on nothing', () => {
  it('returns the same data when no dealer is chosen', () => {
    const d = emptyAppData();
    expect(scopeToDealer(d, null)).toBe(d);
    expect(scopeToDealer(d, '')).toBe(d);
    expect(dealerChoices(d)).toEqual([]);
  });
});

describe.skipIf(!HAS_DATA)('Executive Overview dealer filter on the supplied files', () => {
  const { data } = buildAppData();
  const choices = dealerChoices(data);

  it('offers validated ERP codes only, each with a name, sorted A to Z', () => {
    expect(choices.length).toBeGreaterThan(11);
    expect(choices.every((c) => isValidatedDealerKey(c.key) && !c.key.startsWith('name:'))).toBe(true);
    expect(choices.map((c) => c.label)).toEqual([...choices.map((c) => c.label)].sort((a, b) => a.localeCompare(b)));
    expect(new Set(choices.map((c) => c.key)).size).toBe(choices.length);
    const d = choices.find((c) => c.key === '12186');
    expect(d?.label).toMatch(/·\s*12186$/);
  });

  it('every dealer the Dealer App has is in the list', () => {
    const appKeys = new Set(data.dealerLines.map((l) => l.dealerKey).filter(isValidatedDealerKey));
    expect(appKeys.size).toBe(11);
    const have = new Set(choices.map((c) => c.key));
    appKeys.forEach((k) => expect(have.has(k)).toBe(true));
  });

  it('keeps only that dealer’s records and empties the datasets that are not recorded per dealer', () => {
    const s = scopeToDealer(data, '12186');
    expect(s.dealerLines.length).toBeGreaterThan(0);
    expect(s.dealerLines.every((l) => l.dealerKey === '12186')).toBe(true);
    expect(s.dsOrders.every((o) => o.dealerKey === '12186')).toBe(true);
    expect(s.dealerComplaints.every((c) => c.dealerKey === '12186')).toBe(true);
    expect(s.dsComplaints.every((c) => c.dealerKey === '12186')).toBe(true);
    expect(s.loyalty.every((r) => r.idKind === 'verified' && r.entityKey === '12186')).toBe(true);
    expect(s.usage).toHaveLength(0);
    expect(s.issues).toHaveLength(0);
    expect(s.dsEmployees).toHaveLength(0);
    // the files themselves are still "imported"
    expect(s.datasets).toBe(data.datasets);
  });

  it('the dealers partition the validated-code orders: nothing is dropped or counted twice', () => {
    for (const [sys, build, count] of [
      ['dealer', () => buildDealerOrders(data.dealerLines), (d: typeof data) => buildDealerOrders(d.dealerLines)],
      ['ds', () => dsOrderSummaries(data.dsOrders), (d: typeof data) => dsOrderSummaries(d.dsOrders)],
    ] as const) {
      const all = build().filter((o) => isValidatedDealerKey(o.dealerKey));
      const keys = [...new Set(all.map((o) => o.dealerKey as string))];
      const total = orderKpis(all, defaultSettings, sys);
      let eligible = 0;
      let value = 0;
      for (const k of keys) {
        const k1 = orderKpis(count(scopeToDealer(data, k)).filter((o) => isValidatedDealerKey(o.dealerKey)), defaultSettings, sys);
        eligible += k1.eligible;
        value += k1.eligibleValue;
      }
      expect(eligible).toBe(total.eligible);
      expect(value).toBeCloseTo(total.eligibleValue, 2);
    }
  });

  it('an unknown code gives an empty, not a wrong, view', () => {
    const s = scopeToDealer(data, 'no-such-dealer');
    expect(s.dealerLines).toHaveLength(0);
    expect(s.dsOrders).toHaveLength(0);
    expect(s.loyalty).toHaveLength(0);
  });
});

describe.skipIf(!HAS_DATA)('Bizom vs Dealer SFA role filter', () => {
  const { data } = buildAppData();
  const usage = data.usage;
  const roles = [...new Set(data.dsEmployees.map((r) => r.role || 'Not specified'))];

  it('cutting the Dealer SFA side by role splits it without losing or doubling any visit', () => {
    const all = bizomVsSfa(data, usage, ALL_PERIOD, defaultSettings);
    expect(roles.length).toBeGreaterThan(1);
    const sum = (f: (m: (typeof all.monthly)[number]) => number | null) => all.monthly.reduce((a, m) => a + (f(m) ?? 0), 0);
    let visits = 0;
    let orders = 0;
    for (const role of roles) {
      const part = bizomVsSfa(data, usage, ALL_PERIOD, defaultSettings, (r) => (r.role || 'Not specified') === role);
      visits += part.monthly.reduce((a, m) => a + (m.sfaVisits ?? 0), 0);
      orders += part.monthly.reduce((a, m) => a + (m.sfaOrders ?? 0), 0);
    }
    expect(visits).toBe(sum((m) => m.sfaVisits));
    expect(orders).toBe(sum((m) => m.sfaOrders));
  });

  it('the Bizom side is not changed by a Dealer SFA role filter', () => {
    const all = bizomVsSfa(data, usage, ALL_PERIOD, defaultSettings);
    const one = bizomVsSfa(data, usage, ALL_PERIOD, defaultSettings, (r) => (r.role || 'Not specified') === roles[0]);
    expect(one.monthly.map((m) => [m.month, m.bizomUsers, m.bizomAccesses])).toEqual(all.monthly.map((m) => [m.month, m.bizomUsers, m.bizomAccesses]));
  });
});
