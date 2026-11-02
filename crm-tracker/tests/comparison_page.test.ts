// The Dealer App vs DataSense comparison page (adoption by week, the simple order list), the Dealer SFA
// source for the Bizom comparison, and the Issue Tracker's place in the menu. Anchors come from the supplied MIS files.
import { describe, expect, it } from 'vitest';
import { HAS_DATA, buildAppData } from './helpers';
import { ALL_PERIOD } from '../src/lib/metrics/period';
import { buildComparison } from '../src/lib/metrics/comparison';
import { comparisonRows } from '../src/lib/metrics/comparisonTable';
import { comparisonOrders, dealerAppAdoption, weekStartOf } from '../src/lib/metrics/adoption';
import { sfaSource } from '../src/lib/metrics/employees';
import { keyInsights } from '../src/lib/metrics/keyInsights';
import { NAV, crumbsFor } from '../src/components/nav';
import { dataRangeLabel } from '../src/lib/util/parse';
import { defaultSettings, emptyAppData } from '../src/lib/types';

describe('week boundaries', () => {
  it('weeks start on Monday', () => {
    expect(weekStartOf('2026-09-09')).toBe('2026-09-07'); // a Wednesday
    expect(weekStartOf('2026-09-07')).toBe('2026-09-07');
    expect(weekStartOf('2026-09-13')).toBe('2026-09-07'); // the Sunday closing that week
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26');
  });
});

describe('menu', () => {
  it('opens on Dealer App vs DataSense SFA, keeps Overall Summary directly above Data Import, and makes Issue Tracker its own entry', () => {
    expect(NAV.map((g) => g.label)).toEqual([
      'Dealer App vs DataSense SFA',
      'Dealer App Performance',
      'DataSense SFA Performance',
      'Bizom SFA Usage',
      'Bizom SFA vs DataSense SFA Usage',
      'Issue Tracker',
      'Overall Summary',
      'Data Import',
    ]);
    expect(NAV[0].to).toBe('/');
    expect(NAV.find((g) => g.label === 'Overall Summary')?.to).toBe('/overview');
    expect(NAV.map((g) => g.id).slice(-2)).toEqual(['overview', 'import']);
    expect(crumbsFor('/').map((c) => c.label)).toEqual(['Home', 'Dealer App vs DataSense SFA']);
  });

  it('there is a single Dealer App vs DataSense comparison: no second page and no "complaints and issues" group', () => {
    expect(NAV.filter((g) => /dealer app vs/i.test(g.label))).toHaveLength(1);
    expect(NAV.find((g) => g.id === 'cases')).toBeUndefined();
    expect(NAV.flatMap((g) => [g.to, ...(g.items ?? []).map((i) => i.to)]).filter((t) => t === '/compare/dealer-vs-datasense')).toHaveLength(0);
  });

  it('Issue Tracker is a top-level entry and Bizom SFA Usage has no children', () => {
    expect(NAV.find((g) => g.id === 'issues')).toMatchObject({ label: 'Issue Tracker', to: '/issues' });
    const bizom = NAV.find((g) => g.id === 'bizom');
    expect(bizom?.to).toBe('/bizom/usage');
    expect(bizom?.items).toBeUndefined();
  });

  it('each complaints page sits inside its own system group', () => {
    expect(NAV.find((g) => g.id === 'dealer')?.items?.map((i) => [i.label, i.to])).toEqual([
      ['Orders & Performance', '/dealer/orders'],
      ['Complaints', '/dealer/complaints'],
      ['Hero Smiles', '/hero-smiles'],
    ]);
    expect(NAV.find((g) => g.id === 'datasense')?.items?.map((i) => [i.label, i.to])).toEqual([
      ['Orders & Performance', '/datasense/orders'],
      ['Complaints', '/datasense/complaints'],
      ['Usage Report', '/datasense/employees'],
    ]);
    expect(crumbsFor('/dealer/complaints').map((c) => c.label)).toEqual(['Home', 'Dealer App Performance', 'Complaints']);
    expect(crumbsFor('/datasense/complaints').map((c) => c.label)).toEqual(['Home', 'DataSense SFA Performance', 'Complaints']);
  });

  it('Hero Smiles sits inside the Dealer App group, not as a top-level entry', () => {
    expect(NAV.find((g) => g.id === 'hero-smiles')).toBeUndefined();
    expect(crumbsFor('/hero-smiles').map((c) => c.label)).toEqual(['Home', 'Dealer App Performance', 'Hero Smiles']);
  });

  it('the import page is called Data Import', () => {
    expect(NAV.find((g) => g.id === 'import')?.label).toBe('Data Import');
  });
});

describe('Dealer SFA source', () => {
  it('is the DataSense employee-activity report when it is imported, and nothing otherwise', () => {
    expect(sfaSource(emptyAppData()).kind).toBe('none');
  });
});

describe.skipIf(!HAS_DATA)('Dealer App vs DataSense on the supplied files', () => {
  const { data } = buildAppData();
  const res = buildComparison(data, ALL_PERIOD, defaultSettings);
  const rows = comparisonRows(res);

  it('the Dealer App has 11 dealers, all known to DataSense: 8 placed orders through both systems, 3 only through the Dealer App', () => {
    const app = rows.filter((r) => r.match !== 'ds_only');
    expect(app).toHaveLength(11);
    expect(res.rows.filter((r) => r.onDealerApp)).toHaveLength(11);
    expect(app.filter((r) => r.match === 'matched')).toHaveLength(8);
    expect(res.counts).toMatchObject({ common: 8, dealerOnly: 3 });
    const dealerAppOnly = app.filter((r) => r.match === 'dealer_only');
    // Upper Assam, Nanaksar and Just Bicycle placed no DataSense order in Sep or Oct
    expect(dealerAppOnly.map((r) => r.key).sort()).toEqual(['12186', '3117', '3167']);
    for (const r of dealerAppOnly) {
      // a recorded zero, not a dash
      expect([r.salesOrders, r.salesQty, r.salesValue, r.salesAov]).toEqual([0, 0, 0, 0]);
      expect(r.appOrders).toBeGreaterThan(0);
      expect(r.note).toBe('Orders only placed through Dealer App');
      // the Capillary export has no quiz points field: still unavailable
      expect(r.quizPoints).toBeNull();
    }
  });

  it('every DataSense order of the 8 dealers ordering in both systems is counted, none of the other 3 has any', () => {
    for (const r of rows.filter((x) => x.match === 'matched')) expect(r.salesOrders).toBeGreaterThan(0);
    const dsOnly = rows.filter((r) => r.match === 'ds_only');
    expect(dsOnly.length).toBe(res.counts.dsOnly);
    // dealers that are not on the Dealer App have no Dealer App figures at all (dashes, not zeros)
    for (const r of dsOnly) {
      expect(r.appOrders).toBeNull();
      expect(r.appAov).toBeNull();
      expect(r.note).toBe('Not in the Dealer App');
    }
  });

  it('a Dealer App dealer whose orders were all rejected shows 0 orders, a blank AOV and says why', () => {
    const rejected = rows.find((r) => r.key === '19601');
    expect(rejected?.match).toBe('matched');
    expect(rejected?.appOrders).toBe(0);
    expect(rejected?.appAov).toBeNull();
    expect(rejected?.note).toMatch(/rejected/);
  });

  it('the comparison says which months it covers: "Data from Sept to Oct"', () => {
    expect(res.months).toEqual(['2026-09', '2026-10']);
    expect(dataRangeLabel(res.months)).toBe('Data from Sept to Oct');
    expect(dataRangeLabel(['2026-10'])).toBe('Data for Oct');
    expect(dataRangeLabel([])).toBe('');
  });

  it('adoption: weeks run Monday to Sunday from the first Dealer App order, all 11 dealers are on board by the end of September', () => {
    const a = dealerAppAdoption(data, ALL_PERIOD, defaultSettings);
    expect(a?.dealers).toBe(11);
    expect(a?.firstOrder).toBe('2026-09-09');
    expect(a?.weeks.map((w) => w.key)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    for (const w of a?.weeks ?? []) {
      expect(w.from).toBe(w.key);
      expect(new Date(`${w.to}T00:00:00Z`).getTime() - new Date(`${w.from}T00:00:00Z`).getTime()).toBe(6 * 86400000);
    }
    const onboarded = (a?.weeks ?? []).map((w) => w.onboarded);
    expect([...onboarded].sort((x, y) => x - y)).toEqual(onboarded); // never goes down
    expect(onboarded[onboarded.length - 1]).toBe(11);
    // a part-filled week is never shown
    expect(a?.weeks.every((w) => w.to <= (a?.dataEnd ?? ''))).toBe(true);
  });

  it('adoption: order counts are eligible orders, and the two systems are never added together', () => {
    const a = dealerAppAdoption(data, ALL_PERIOD, defaultSettings);
    const weeks = a?.weeks ?? [];
    expect(weeks.map((w) => w.appOrders)).toEqual([1, 2, 2, 6, 8, 7, 3]);
    expect(weeks.every((w) => 'dsOrders' in w && !('totalOrders' in w))).toBe(true);
  });

  it('adoption: nothing to show without Dealer App orders', () => {
    expect(dealerAppAdoption(emptyAppData(), ALL_PERIOD, defaultSettings)).toBeNull();
  });

  it('the order list holds both systems’ orders for the Dealer App dealers, with the SAP order number of each', () => {
    const list = comparisonOrders(data, ALL_PERIOD, res.months);
    expect(list.filter((o) => o.system === 'dealer')).toHaveLength(34);
    expect(list.filter((o) => o.system === 'ds')).toHaveLength(57);
    // no “SAP order in both systems” flag or card is built any more
    expect(list.every((o) => !('inBoth' in o))).toBe(true);
    expect('sapOverlap' in res).toBe(false);
    // every order of a dealer that is not on the Dealer App is left out
    const appKeys = new Set(rows.filter((r) => r.match !== 'ds_only').map((r) => r.key));
    expect(list.every((o) => appKeys.has(o.dealerKey))).toBe(true);
  });
});

describe.skipIf(!HAS_DATA)('key insights on the Overview', () => {
  const { data } = buildAppData();
  const ins = keyInsights(data, ALL_PERIOD, defaultSettings, {}, '2026-10-26');

  it('every share is between 0 and 1 and every change figure has a direction', () => {
    for (const i of ins) {
      for (const r of i.rows) {
        if (r.share !== undefined) {
          expect(r.share).toBeGreaterThanOrEqual(0);
          expect(r.share).toBeLessThanOrEqual(1);
          expect(r.shareLabel).toBeTruthy();
        }
        expect(`${r.stat ?? ''} ${r.unit ?? ''}`).not.toMatch(/NaN|undefined|null|Infinity/);
      }
    }
    const change = ins.find((i) => i.id === 'change');
    for (const r of change?.rows ?? []) expect(r.dir).toBeDefined();
  });

  it('the dealer coverage insight says 8 of 11 order in both systems, 3 only through the Dealer App, and links to the scopes that exist', () => {
    const cov = ins.find((i) => i.id === 'coverage');
    expect(cov?.title).toBe('Which system dealers order through');
    expect(cov?.rows[0].stat).toBe('8');
    expect(cov?.rows[0].shareLabel).toBe('8 of 11 Dealer App dealers');
    expect(cov?.rows[0].sub).toMatch(/Data from Sept to Oct/);
    expect(cov?.rows[1].stat).toBe('3');
    expect(cov?.rows[1].text).toMatch(/only through the Dealer App/);
    for (const r of cov?.rows ?? []) expect(r.to).toMatch(/scope=(common|dealer_only|ds_only)/);
  });

  it('the Issue Tracker row is labelled as the Issue Tracker, not Bizom', () => {
    const b = ins.find((i) => i.id === 'backlog');
    expect(b?.rows.some((r) => r.tag === 'Issue Tracker' && r.to.startsWith('/issues'))).toBe(true);
    expect(JSON.stringify(ins)).not.toMatch(/Bizom issues/);
  });
});

describe('links into the merged comparison page', () => {
  it('every section a link can ask for exists on the page, and older ids still land somewhere', async () => {
    const { SECTIONS, sectionId } = await import('../src/pages/growth/shared');
    const ids = SECTIONS.map(([id]) => id);
    for (const id of ['kpis', 'drivers', 'trends', 'adoption', 'dealers', 'table', 'profit', 'mbd', 'orders']) expect(ids, id).toContain(id);
    expect(sectionId('charts')).toBe('trends');
    expect(sectionId('summary')).toBe('kpis');
    expect(sectionId('nonsense')).toBeNull();
  });

  it('the old comparison route is gone from the menu and every in-app link to it points at the merged page', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const offenders = walk(path.resolve(__dirname, '../src')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('App.tsx') && fs.readFileSync(f, 'utf8').includes('compare/dealer-vs-datasense'));
    expect(offenders).toEqual([]);
  });
});
