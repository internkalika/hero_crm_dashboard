// The business-growth upgrade: the classification rules on hand-made figures, then the growth model, the executive brief,
// the data assistant and the profitability inspector on the supplied MIS files. Anchors were taken from those files.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAS_DATA, buildAppData } from './helpers';
import { ALL_PERIOD } from '../src/lib/metrics/period';
import { defaultSettings, emptyAppData } from '../src/lib/types';
import { CLASS_META, DealerPeriodFigures, adoptionStatusOf, buildGrowth, classify, defaultGrowthInput, growthCatalogue, growthLink, toneOfChange } from '../src/lib/metrics/growth';
import { changeOf } from '../src/lib/metrics/windows';
import { dataSpan, resolveWindows } from '../src/lib/metrics/growthWindows';
import { buildServiceFacts, executiveBrief } from '../src/lib/metrics/executive';
import { PROFIT_REQUIREMENTS, inspectProfitability } from '../src/lib/metrics/profitability';
import { ask, resolveDealer } from '../src/lib/assistant/engine';
import { briefSheets } from '../src/lib/export/executive';
import { dealerGrowthSheet, growthNotes, kpiSheet, monthlySheet } from '../src/lib/export/growth';

const fig = (dealer: [number, number], ds: [number, number], qty = 0): DealerPeriodFigures => ({
  dealerValue: dealer[0],
  dsValue: ds[0],
  combinedValue: dealer[0] + ds[0],
  dealerOrders: dealer[1],
  dsOrders: ds[1],
  combinedOrders: dealer[1] + ds[1],
  dealerQty: qty,
  dsQty: 0,
  combinedQty: qty,
});
const CTX = { hasBaseline: true, windowDays: 21, dealerPartialBaseline: false };

describe('dealer classification rules (hand-made figures)', () => {
  it('+20% across both channels is an incremental growth candidate', () => {
    const r = classify(fig([0, 0], [100000, 5]), fig([50000, 3], [70000, 4]), CTX);
    expect(r.cls).toBe('incremental');
    expect(r.confidence).toBe('indicative');
    expect(r.evidence).toMatch(/combined \+₹20,000 \(\+20%\)/);
  });

  it('the Dealer App rising while DataSense falls by a similar amount is a channel shift, not growth', () => {
    const r = classify(fig([0, 0], [100000, 5]), fig([95000, 4], [8000, 1]), CTX);
    expect(r.cls).toBe('migration');
    expect(r.evidence).toMatch(/offsets/);
  });

  it('a fall of 10% or more is declining, and a dealer that stopped ordering is declining', () => {
    expect(classify(fig([0, 0], [100000, 5]), fig([0, 0], [70000, 4]), CTX).cls).toBe('declining');
    const stopped = classify(fig([0, 0], [100000, 5]), fig([0, 0], [0, 0]), CTX);
    expect(stopped.cls).toBe('declining');
    expect(stopped.evidence).toMatch(/No orders in the reporting period/);
  });

  it('within ±10% with no offsetting channel move is stable', () => {
    expect(classify(fig([0, 0], [100000, 5]), fig([0, 0], [104000, 5]), CTX).cls).toBe('stable');
  });

  it('no baseline is "new or insufficient history", never a growth rate', () => {
    expect(classify(null, fig([0, 0], [1000, 1]), { ...CTX, hasBaseline: false }).cls).toBe('insufficient');
    expect(classify(fig([0, 0], [0, 0]), fig([5000, 1], [0, 0]), CTX).cls).toBe('insufficient');
  });

  it('a small base, a short window, or a Dealer App that was not live for the whole baseline makes it inconclusive', () => {
    expect(classify(fig([0, 0], [100000, 2]), fig([0, 0], [200000, 3]), CTX).confidence).toBe('inconclusive');
    expect(classify(fig([0, 0], [100000, 5]), fig([0, 0], [200000, 5]), { ...CTX, windowDays: 10 }).confidence).toBe('inconclusive');
    const partial = classify(fig([0, 0], [100000, 5]), fig([40000, 2], [100000, 5]), { ...CTX, dealerPartialBaseline: true });
    expect(partial.confidence).toBe('inconclusive');
    expect(partial.evidence).toMatch(/not live for the whole comparison period/);
  });

  it('every class has a label, a plain-words rule and a colour', () => {
    for (const meta of Object.values(CLASS_META)) {
      expect(meta.label.length).toBeGreaterThan(5);
      expect(meta.help.length).toBeGreaterThan(20);
      expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('polarity-aware colour', () => {
  it('a rise is good where up is good and bad where up is bad (rejections, complaints)', () => {
    const up = changeOf(100, 130);
    expect(toneOfChange(up, 'up')).toBe('good');
    expect(toneOfChange(up, 'down')).toBe('bad');
    const down = changeOf(100, 70);
    expect(toneOfChange(down, 'up')).toBe('bad');
    expect(toneOfChange(down, 'down')).toBe('good');
  });

  it('a change inside ±2%, or a missing comparison, is neither good nor bad', () => {
    expect(toneOfChange(changeOf(100, 101), 'up')).toBe('warn');
    expect(toneOfChange(null, 'up')).toBe('neutral');
  });
});

describe('adoption status in words', () => {
  const row = (daOrders: number, dsOrders: number, onApp: boolean) => ({ onDealerApp: onApp, cur: fig([daOrders * 1000, daOrders], [dsOrders * 1000, dsOrders]) });
  it('names where a dealer stands', () => {
    expect(adoptionStatusOf(row(2, 2, true)).id).toBe('both');
    expect(adoptionStatusOf(row(2, 0, true)).id).toBe('app-only');
    expect(adoptionStatusOf(row(0, 2, true)).id).toBe('lapsed');
    expect(adoptionStatusOf(row(0, 2, false)).id).toBe('sfa-only');
    expect(adoptionStatusOf(row(0, 0, false)).id).toBe('none');
  });
});

describe('with nothing imported', () => {
  it('there is no growth model and no data span', () => {
    expect(buildGrowth(emptyAppData(), defaultSettings)).toBeNull();
    expect(dataSpan(emptyAppData())).toBeNull();
  });
  it('the profitability inspector says not verified and lists what is needed', () => {
    const p = inspectProfitability(emptyAppData());
    expect(p.verified).toBe(false);
    expect(p.statement).toMatch(/NOT verified/);
    expect(p.requirements).toBe(PROFIT_REQUIREMENTS);
  });
});

describe.skipIf(!HAS_DATA)('growth model on the supplied files', () => {
  const { data } = buildAppData();
  const settings = { includeRejected: false, includeTestAccounts: false };
  const pilot = buildGrowth(data, settings)!;
  const network = buildGrowth(data, settings, { cohort: 'all' })!;

  it('compares the first 21 days of October with the first 21 days of September (the last day both exports reach is 21 October)', () => {
    const span = dataSpan(data)!;
    expect(span.cutoff).toBe('2026-10-21');
    const w = resolveWindows(span, '', 'prev');
    expect(w.reporting.label).toBe('1–21 Oct 2026');
    expect(w.reporting.partialMonth).toBe(true);
    expect(w.comparison?.label).toBe('1–21 Sep 2026');
    expect(w.comparison?.days).toBe(w.reporting.days);
  });

  it('Dealer App dealers: combined order value moved from ₹36.33 L to ₹46.03 L (+26.7%)', () => {
    expect(pilot.dealersInView).toBe(11);
    expect(pilot.prev!.combined.value).toBeCloseTo(3633480, 0);
    expect(pilot.cur.combined.value).toBeCloseTo(4602948.7, 0);
    expect(pilot.combinedValue!.pct!).toBeCloseTo(0.2668, 3);
  });

  it('each order is counted once: the two DataSense orders that are Dealer App orders are shown but not counted', () => {
    const dup = pilot.orders.filter((o) => o.duplicate);
    expect(dup).toHaveLength(2);
    expect(dup.every((o) => o.system === 'ds')).toBe(true);
    expect(pilot.notes.join(' ')).toMatch(/2 DataSense orders carry the SAP number/);
    const counted = pilot.orders.filter((o) => o.window === 'reporting' && o.eligible && !o.duplicate);
    const da = counted.filter((o) => o.system === 'dealer').length;
    const ds = counted.filter((o) => o.system === 'ds').length;
    expect(da).toBe(pilot.cur.dealer!.orders);
    expect(ds).toBe(pilot.cur.ds!.orders);
  });

  it('dealer classes: 7 incremental, 1 channel shift, 2 declining, 0 stable, 1 without a baseline', () => {
    expect(pilot.classCounts).toEqual({ incremental: 7, migration: 1, declining: 2, stable: 0, insufficient: 1 });
    expect(Object.values(pilot.classCounts).reduce((a, b) => a + b, 0)).toBe(pilot.rows.length);
    for (const r of pilot.rows) expect(r.evidence.length).toBeGreaterThan(10);
  });

  it('Dealer App dealers grew +26.7% while all other dealers moved −31.6%; all dealers together −31.0%', () => {
    expect(pilot.benchmark!.pilot.pct!).toBeCloseTo(0.2668, 3);
    expect(pilot.benchmark!.others.pct!).toBeCloseTo(-0.316, 3);
    expect(network.combinedValue!.pct!).toBeCloseTo(-0.3098, 3);
    expect(network.dealersInView).toBe(1551);
  });

  it('adoption: 7 of 691 active dealers used the app (1.0%), 3 in both channels', () => {
    expect(network.cur.activeEither).toBe(691);
    expect(network.cur.dealer!.activeDealers).toBe(7);
    expect(network.cur.commonActive).toBe(3);
    expect(network.cur.adoption!).toBeCloseTo(7 / 691, 6);
  });

  it('complaints per 100 orders is blank (not zero) where the complaint export does not cover the window', () => {
    // the Dealer App complaint export starts on 1 October, so the September window has no figure
    expect(pilot.prev!.dealer!.complaints).toBeNull();
    expect(pilot.prev!.dealer!.complaintRate).toBeNull();
    expect(pilot.cur.dealer!.complaintRate!).toBeGreaterThan(0);
    const k = pilot.kpis.find((x) => x.id === 'complaint')!;
    expect(k.dealerPrev).toBeNull();
    expect(k.polarity).toBe('down');
  });

  it('models billed per dealer is Dealer App only: 11.6 now, 11.3 before', () => {
    expect(pilot.mbd!.cur!).toBeCloseTo(11.6, 1);
    expect(pilot.mbd!.prev!).toBeCloseTo(11.3, 1);
  });

  it('a model filter leaves DataSense out (it has no model) and says so', () => {
    const sliced = buildGrowth(data, settings, { models: [pilot.rows.length ? 'NEXT' : 'X'] })!;
    expect(sliced.sliced).toBe(true);
    expect(sliced.cur.ds).toBeNull();
    expect(sliced.combinedValue).toBeNull();
    expect(sliced.notes.join(' ')).toMatch(/no model field/);
  });

  it('a dealer, channel or several-dealer filter narrows every figure', () => {
    const one = buildGrowth(data, settings, { dealers: ['17421'] })!;
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0].key).toBe('17421');
    const two = buildGrowth(data, settings, { dealers: ['17421', '14554'] })!;
    expect(two.rows.map((r) => r.key).sort()).toEqual(['14554', '17421']);
    const appOnly = buildGrowth(data, settings, { channels: ['dealer'] })!;
    expect(appOnly.cur.ds).toBeNull();
    expect(appOnly.cur.dealer!.value).toBeCloseTo(pilot.cur.dealer!.value, 2);
    // choosing every value of a list is the same as choosing none
    const everyone = buildGrowth(data, settings, { channels: ['dealer', 'ds'] })!;
    expect(everyone.cur.combined.value).toBeCloseTo(pilot.cur.combined.value, 2);
  });

  it('a custom period and an explicit comparison give the same answer as the equivalent ids', () => {
    const custom = buildGrowth(data, settings, { rp: 'c:2026-10-01..2026-10-21', cp: 'c:2026-09-01..2026-09-21' })!;
    expect(custom.cur.combined.value).toBeCloseTo(pilot.cur.combined.value, 2);
    expect(custom.prev!.combined.value).toBeCloseTo(pilot.prev!.combined.value, 2);
    const none = buildGrowth(data, settings, { cp: 'none' })!;
    expect(none.comparison).toBeNull();
    expect(none.combinedValue).toBeNull();
    expect(none.rows.every((r) => r.cls === 'insufficient')).toBe(true);
  });

  it('insights state the figure, the periods and a link, and never claim cause', () => {
    expect(pilot.insights.length).toBeGreaterThan(2);
    for (const i of pilot.insights) {
      expect(i.metric.length).toBeGreaterThan(0);
      expect(i.period).toMatch(/Oct 2026/);
      expect(i.to.startsWith('/')).toBe(true);
      expect(`${i.title} ${i.detail}`).not.toMatch(/\bbecause of the dealer app\b|\bcaused by the dealer app\b|\bdue to the dealer app\b/i);
    }
    expect(growthLink({ rp: '', cp: 'prev' }, { show: 'dealers' })).toBe('/?show=dealers');
  });

  it('the dealer catalogue lists every dealer from both order files once', () => {
    const cat = growthCatalogue(data);
    expect(cat.length).toBe(1551);
    expect(new Set(cat.map((c) => c.key)).size).toBe(cat.length);
  });
});

describe.skipIf(!HAS_DATA)('profitability on the supplied files', () => {
  const { data } = buildAppData();
  it('finds no cost, margin, discount, return, freight or incentive column in any of the 17 files, and says so', () => {
    const p = inspectProfitability(data);
    expect(p.verified).toBe(false);
    expect(p.found).toEqual([]);
    expect(p.inspected).toHaveLength(17);
    expect(p.columnsChecked).toBe(230);
    expect(p.statement).toBe('Profitability is NOT verified: none of the 230 columns in the 17 imported files hold cost, margin, discount, return, freight, incentive or contribution data.');
  });
});

describe.skipIf(!HAS_DATA)('executive brief on the supplied files', () => {
  const { data } = buildAppData();
  const settings = { includeRejected: false, includeTestAccounts: false, lowUsageThreshold: 5 };
  const asOf = '2026-10-28';
  const pilot = buildGrowth(data, settings)!;
  const all = buildGrowth(data, settings, { cohort: 'all' })!;
  const service = buildServiceFacts({ data, settings, period: ALL_PERIOD, asOf, scoped: false });
  // the suite is skipped without the files, but its body is still collected
  const brief = HAS_DATA ? executiveBrief({ pilot, all, service, profit: inspectProfitability(data) }) : (undefined as never);

  it('has three to five takeaways, the first being growth of the Dealer App dealers and the last that profit is not verified', () => {
    expect(brief.takeaways.length).toBeGreaterThanOrEqual(3);
    expect(brief.takeaways.length).toBeLessThanOrEqual(5);
    expect(brief.takeaways[0].id).toBe('dealers-growth');
    expect(brief.takeaways[0].title).toMatch(/\+26\.7%/);
    expect(brief.takeaways.map((t) => t.id)).toContain('network');
    expect(brief.takeaways.at(-1)!.id).toBe('profit');
    expect(brief.takeaways.at(-1)!.metric).toBe('Not verified');
  });

  it('reports the network decline next to the Dealer App dealers’ growth, so the growth is not read as the whole business', () => {
    const t = brief.takeaways.find((x) => x.id === 'network')!;
    expect(t.title).toMatch(/−31\.0%/);
    expect(t.detail).toMatch(/cannot by itself move the network total/);
    expect(t.tone).toBe('bad');
  });

  it('every statement has a figure, a period and a link inside the app, and none claims cause', () => {
    for (const i of [...brief.takeaways, ...brief.risks]) {
      expect(i.metric).toBeTruthy();
      expect(i.period).toBeTruthy();
      expect(i.to.startsWith('/')).toBe(true);
      expect(`${i.title} ${i.detail}`).not.toMatch(/\bbecause of the dealer app\b|\bcaused by the dealer app\b/i);
    }
    for (const a of brief.actions) expect(a.to.startsWith('/')).toBe(true);
  });

  it('risks are ordered most serious first and actions do-first before later', () => {
    const rank = { bad: 0, warn: 1, neutral: 2, good: 3 } as const;
    const r = brief.risks.map((x) => rank[x.tone]);
    expect(r).toEqual([...r].sort((a, b) => a - b));
    const p = brief.actions.map((a) => a.priority);
    expect(p).toEqual([...p].sort((a, b) => a - b));
    expect(brief.risks.some((x) => x.id === 'r-profit')).toBe(true);
    expect(brief.actions.some((x) => x.id === 'a-profit')).toBe(true);
  });

  it('with a dealer selected the network and adoption statements are left out', () => {
    const one = buildGrowth(data, settings, { dealers: ['17421'], cohort: 'all' })!;
    const b = executiveBrief({ pilot: one, all: null, service: buildServiceFacts({ data, settings, period: ALL_PERIOD, asOf, scoped: true }), profit: inspectProfitability(data) });
    expect(b.takeaways.map((t) => t.id)).not.toContain('network');
    expect(b.takeaways.map((t) => t.id)).not.toContain('adoption');
    expect(buildServiceFacts({ data, settings, period: ALL_PERIOD, asOf, scoped: true }).issues).toBeNull();
  });

  it('exports the takeaways, risks and actions as sheets', () => {
    const sheets = briefSheets(brief);
    expect(sheets.map((s) => s.name)).toEqual(['Management takeaways', 'Key risks', 'Recommended actions']);
    expect(sheets[0].rows).toHaveLength(brief.takeaways.length);
  });
});

describe.skipIf(!HAS_DATA)('exports carry the columns the review asked for', () => {
  const { data } = buildAppData();
  const m = buildGrowth(data, { includeRejected: false, includeTestAccounts: false })!;
  it('the dealer comparison has name, outlet ID, DB code, before and now, change, shares, order and quantity change, class and evidence', () => {
    const headers = dealerGrowthSheet(m).columns.map((c) => c.header).join(' | ');
    for (const h of ['Dealer name', 'Outlet ID', 'DB code (ERP)', 'Combined value – 1–21 Sep 2026', 'Combined value – 1–21 Oct 2026', 'Absolute change', '% change', 'Dealer App share', 'DataSense (SFA) share', 'Order count change', 'Quantity change', 'Classification', 'Evidence']) expect(headers).toContain(h);
    const s = dealerGrowthSheet(m);
    expect(s.rows).toHaveLength(m.rows.length);
    expect(s.rows.every((r) => r.length === s.columns.length)).toBe(true);
  });
  it('monthly and KPI sheets are built from the same model and the notes name both periods', () => {
    expect(monthlySheet(m).rows).toHaveLength(m.months.length);
    expect(kpiSheet(m).rows.length).toBeGreaterThanOrEqual(m.kpis.length);
    const notes = growthNotes(m).join('\n');
    expect(notes).toMatch(/Reporting period: 1–21 Oct 2026/);
    expect(notes).toMatch(/Comparison period: 1–21 Sep 2026/);
    expect(notes).toMatch(/not profit or margin/);
  });
});

describe.skipIf(!HAS_DATA)('the data assistant', () => {
  const { data } = buildAppData();
  const ctx = { data, settings: { includeRejected: false, includeTestAccounts: false, lowUsageThreshold: 5 }, asOf: '2026-10-28', period: ALL_PERIOD, input: defaultGrowthInput() };
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  afterEach(() => fetchSpy.mockClear());

  it('answers the headline question with the figures, the periods and the dealers it used, and says it is not profit', () => {
    const a = ask('Is the Dealer App helping Hero Cycles grow?', ctx);
    expect(a.intent).toBe('growth');
    expect(a.matched).toBe(true);
    expect(a.period).toBe('1–21 Oct 2026 vs 1–21 Sep 2026');
    expect(a.scope).toMatch(/11 Dealer App dealers/);
    expect(a.paragraphs.join(' ')).toMatch(/\+26\.7%/);
    expect(a.paragraphs.join(' ')).toMatch(/not profit/);
    expect(a.figures.length).toBeGreaterThan(3);
    expect(a.actions.length).toBeGreaterThan(0);
  });

  it('lists dealers by class with their evidence and a profile link for each', () => {
    const a = ask('Which dealers show incremental growth?', ctx);
    expect(a.intent).toBe('incremental');
    expect(a.figures.length).toBeGreaterThan(0);
    expect(a.records.every((r) => r.to.includes('dealer='))).toBe(true);
    expect(ask('which dealers moved orders between channels', ctx).intent).toBe('migration');
    expect(ask('which dealers are declining', ctx).intent).toBe('declining');
  });

  it('says profitability is not verified and what data is needed', () => {
    const a = ask('Is profitability verified?', ctx);
    expect(a.intent).toBe('profit');
    expect(a.title).toBe('Profitability is not verified');
    expect(a.figures.map((f) => f.label).join(' ')).toMatch(/Cost of goods/);
  });

  it('adoption counts all active dealers, not only the Dealer App dealers', () => {
    const a = ask('How many dealers use the Dealer App?', ctx);
    expect(a.intent).toBe('adoption');
    expect(a.paragraphs[0]).toMatch(/7 of 691 dealers/);
  });

  it('finds a dealer by name or by ERP code and answers for that dealer only', () => {
    const byName = ask('Tell me about Jitesh Traders', ctx);
    expect(byName.intent).toBe('dealer');
    expect(byName.scope).toBe('Jitesh Traders');
    const byCode = ask('17421', ctx);
    expect(byCode.title).toBe('Lucky Cycles');
    expect(resolveDealer('Jitesh Traders', data).dealer?.name).toBe('Jitesh Traders');
  });

  it('does not take a stray word for a dealer', () => {
    expect(resolveDealer('what is the weather in delhi', data).dealer).toBeNull();
    expect(resolveDealer('which dealers have the highest sales', data).dealer).toBeNull();
  });

  it('follows the dealers selected on screen', () => {
    const a = ask('Is the Dealer App helping grow?', { ...ctx, input: { ...ctx.input, dealers: ['17421'] } });
    expect(a.scope).toMatch(/1 selected dealer/);
  });

  it('a question it cannot match is answered as unmatched, with no figures and no invented number', () => {
    const a = ask('what is the capital of France', ctx);
    expect(a.matched).toBe(false);
    expect(a.figures).toEqual([]);
    expect(a.title).toBe('I could not match that');
    expect(a.suggestions!.length).toBeGreaterThan(2);
  });

  it('is rule-based and local: it never calls the network', () => {
    ['growth', 'which dealers declined', 'complaints', 'what data is loaded', 'summary', 'hero smiles', 'bizom usage', 'issues', 'MBD'].forEach((q) => ask(q, ctx));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('every answer to the example questions links only to pages that exist', () => {
    const routes = /^\/(overview|dealer\/(orders|complaints)|datasense\/(orders|complaints|employees)|bizom\/usage|issues|hero-smiles|compare\/bizom-vs-sfa|import)?(\?|$)/;
    for (const q of ['growth', 'incremental dealers', 'adoption', 'profit', 'risks', 'actions', 'complaints', 'issues', 'hero smiles', 'bizom usage', 'MBD', 'what data is loaded']) {
      const a = ask(q, ctx);
      for (const l of [...a.records, ...a.actions]) expect(l.to, `${q}: ${l.label}`).toMatch(routes);
    }
  });
});
