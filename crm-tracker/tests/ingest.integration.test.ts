// Integration tests: the real, supplied CRM MIS files go through the full ingest pipeline.
// They run when the files are present in ./data/CRM MIS (or $CRM_MIS_DIR) and are skipped otherwise.
import { describe, expect, it } from 'vitest';
import { HAS_DATA, ingest, listFiles, loadInput, NOW } from './helpers';
import { analyzeInput } from '../src/lib/ingest/pipeline';
import type { DealerOrderLine, DsOrder, ComplaintRec, UsageRec, EmployeeActivityRec, LoyaltyRec, IssueRec } from '../src/lib/types';

const d = describe.skipIf(!HAS_DATA);

d('identification of the supplied files', () => {
  const expected: Record<string, string> = {
    'DealerAppOrders-SEPT.csv': 'dealer_orders',
    'DealerAppOrders-oct.csv': 'dealer_orders',
    'MIS_usage_report_bizom-aug.csv': 'bizom_usage',
    'MISUsagereport-Bizom-sept.csv': 'bizom_usage',
    'MISUsagereport-Bizom-Oct.csv': 'bizom_usage',
    'CAPILLARY_HERO_EARNING_28 sept.csv': 'loyalty_snapshot',
    'CAPILLARY_HERO_EARNING_05Oct.csv': 'loyalty_snapshot',
    'CAPILLARY_HERO_EARNING_13oct.csv': 'loyalty_snapshot',
    'CAPILLARY_HERO_EARNING_19Oct.csv': 'loyalty_snapshot',
    'CAPILLARY_HERO_EARNING_26Oct.csv': 'loyalty_snapshot',
    'Order Punched Report- Datasense - aug to oct.xls': 'ds_orders',
    'Complaint Module Dump- Dealer App - 26 Oct.xlsx': 'dealer_complaints',
    'Complaint Module Dump- Datasense - 26 Oct.xlsx': 'ds_complaints',
    'Issue_Tracker.xlsx': 'issue_tracker',
    'Employee-daily-activities-datasense-sept.csv': 'ds_employee_activity',
    'Employee-daily-activities- Datasense-oct.csv': 'ds_employee_activity',
    'Focus & Liquidation - datasense.xlsx': 'focus_liquidation',
  };
  it('recognises all 17 files', () => {
    expect(listFiles().sort()).toEqual(Object.keys(expected).sort());
    for (const [name, src] of Object.entries(expected)) {
      const { analysis } = analyzeInput(loadInput(name), name);
      expect(analysis.error, name).toBeUndefined();
      expect(analysis.identification.source, name).toBe(src);
      expect(analysis.identification.ambiguous, `${name}: ${analysis.identification.note}`).toBe(false);
    }
  });
  it('reads the legacy "xls" that is really an HTML table', () => {
    const { analysis } = analyzeInput(loadInput('Order Punched Report- Datasense - aug to oct.xls'), 'x');
    expect(analysis.kind).toBe('html-xls');
    expect(analysis.sheets[0].columns[0]).toBe('Order NO');
    expect(analysis.sheets[0].preamble[0]).toMatch(/Order Punched Report 01-08-2026 to 26-10-2026/);
  });
});

d('Dealer App orders', () => {
  it('keeps SKU lines but counts distinct orders; handles two different date formats', () => {
    const sep = ingest('DealerAppOrders-SEPT.csv').payload;
    const oct = ingest('DealerAppOrders-oct.csv').payload;
    expect(sep.meta.scope).toBe('2026-09');
    expect(oct.meta.scope).toBe('2026-10');
    const sl = sep.records as DealerOrderLine[];
    const ol = oct.records as DealerOrderLine[];
    expect(sl.length).toBe(232);
    expect(ol.length).toBe(375);
    expect(new Set(sl.map((l) => l.orderId)).size).toBe(14);
    expect(new Set(ol.map((l) => l.orderId)).size).toBe(20);
    expect(sl.every((l) => l.orderDate?.startsWith('2026-09'))).toBe(true);
    expect(ol.every((l) => l.orderDate?.startsWith('2026-10'))).toBe(true);
    const total = (ls: DealerOrderLine[]) => ls.reduce((a, l) => a + (l.amount ?? 0), 0);
    expect(total(sl)).toBeCloseTo(2011013, 2);
    expect(total(ol)).toBeCloseTo(3122573.7, 2);
    expect(sl.find((l) => l.orderId === '40113')!.dealerKey).toBe('10061');
  });
  it('flags the corrupted invoice id instead of dropping the row', () => {
    const sep = ingest('DealerAppOrders-SEPT.csv').payload;
    const oct = ingest('DealerAppOrders-oct.csv').payload;
    const codes = [...sep.issues, ...oct.issues].map((i) => i.code);
    expect(codes).toContain('SUSPICIOUS_ID');
  });
});

d('DataSense orders (HTML-table xls)', () => {
  it('parses every order and reconciles to the report Total row', () => {
    const { payload } = ingest('Order Punched Report- Datasense - aug to oct.xls');
    const recs = payload.records as DsOrder[];
    expect(recs.length).toBe(5907);
    expect(payload.meta.invalidCount).toBe(0);
    expect(payload.meta.totalRowCount).toBe(1); // footer row is set aside, not invalid
    const sum = recs.reduce((a, r) => a + (r.value ?? 0), 0);
    expect(sum).toBeCloseTo(1172338876.11, 1);
    const recon = (payload.meta.extra as { reconciliation: { diff: number }[] }).reconciliation;
    expect(recon.length).toBe(5);
    recon.forEach((r) => expect(Math.abs(r.diff)).toBeLessThan(1));
    expect(payload.meta.periodStart).toBe('2026-08-01');
    expect(payload.meta.periodEnd).toBe('2026-10-26');
    expect(recs.filter((r) => r.statusGroup === 'rejected').length).toBe(207);
    expect(recs.find((r) => r.orderNo === '0030568155')!.dealerKey).toBe('17421');
  });
});

d('Complaints', () => {
  it('Dealer App complaints', () => {
    const { payload } = ingest('Complaint Module Dump- Dealer App - 26 Oct.xlsx');
    const recs = payload.records as ComplaintRec[];
    expect(recs.length).toBe(7);
    expect(payload.meta.asOfDate).toBe('2026-10-26');
    expect(recs.filter((r) => r.statusGroup === 'closed').length).toBe(2);
    expect(recs.filter((r) => !r.dealerKey).length).toBe(2); // dealer code 0 and MUM-DIST-2847
    expect(recs.every((r) => r.closedAt === null)).toBe(true); // no resolution timestamp in source
  });
  it('DataSense complaints: real range only, no silent drops', () => {
    const { payload } = ingest('Complaint Module Dump- Datasense - 26 Oct.xlsx');
    const recs = payload.records as ComplaintRec[];
    expect(payload.meta.rawCount).toBe(1776);
    expect(recs.length).toBe(1776);
    expect(payload.meta.duplicateCount).toBe(0);
    expect(payload.meta.extra!.declaredDimension).toBe('A1:O1043711');
    expect(payload.issues.some((i) => i.code === 'DUPLICATE_KEY')).toBe(true); // the one case ref reused
    expect(recs.filter((r) => r.statusGroup === 'closed').length).toBe(258);
    expect(recs.filter((r) => r.statusGroup === 'rejected').length).toBe(22);
    expect(new Set(recs.map((r) => r.key)).size).toBe(1776);
    const closed = recs.filter((r) => r.statusGroup === 'closed' && r.tatMinutes !== null);
    expect(closed.length).toBeGreaterThan(250);
  });
});

d('Bizom usage, issues, employees, loyalty, focus', () => {
  it('Bizom usage monthly files carry their period and keep totals', () => {
    const totals: Record<string, number> = { 'MIS_usage_report_bizom-aug.csv': 2497, 'MISUsagereport-Bizom-sept.csv': 3271, 'MISUsagereport-Bizom-Oct.csv': 2515 };
    const scopes: Record<string, string> = { 'MIS_usage_report_bizom-aug.csv': '2026-08', 'MISUsagereport-Bizom-sept.csv': '2026-09', 'MISUsagereport-Bizom-Oct.csv': '2026-10' };
    for (const f of Object.keys(totals)) {
      const { payload } = ingest(f);
      expect(payload.meta.scope).toBe(scopes[f]);
      expect((payload.records as UsageRec[]).reduce((a, r) => a + r.accessCount, 0)).toBe(totals[f]);
    }
  });
  it('Issue tracker finds the header on row 2 and swaps Type/priority where needed', () => {
    const { payload } = ingest('Issue_Tracker.xlsx');
    const recs = payload.records as IssueRec[];
    expect(payload.meta.columns.slice(0, 6)).toEqual(['Pointer', 'Type', 'Column C', 'Platform', 'Status', 'Target Date']);
    expect(recs.length).toBe(57);
    expect(recs.filter((r) => r.statusGroup === 'resolved').length).toBe(32);
    expect(recs.filter((r) => r.priority === 'P1').length).toBe(18 + 6);
    expect(recs.every((r) => r.statusGroup !== 'unmapped')).toBe(true);
    expect(recs.filter((r) => r.targetKind === 'non-date').length).toBe(4);
    const dc = (payload.meta.extra as { dashboardCheck: { headlineTotal: number; platformTableTotal: number } }).dashboardCheck;
    expect(dc.headlineTotal).toBe(57);
    expect(dc.platformTableTotal).toBe(41);
    expect(payload.issues.some((i) => i.code === 'DASHBOARD_MISMATCH')).toBe(true);
  });
  it('Employee activity excludes the TOTAL row and reconciles to it', () => {
    for (const [f, scope] of [['Employee-daily-activities-datasense-sept.csv', '2026-09'], ['Employee-daily-activities- Datasense-oct.csv', '2026-10']] as const) {
      const { payload, source } = ingest(f);
      expect(source).toBe('ds_employee_activity');
      expect(payload.meta.scope).toBe(scope);
      const recs = payload.records as EmployeeActivityRec[];
      expect(recs.length).toBe(72);
      const recon = (payload.meta.extra as { reconciliation: { diff: number }[] }).reconciliation;
      expect(recon.length).toBeGreaterThan(4);
      recon.forEach((r) => expect(r.diff).toBe(0));
      expect(recs.filter((r) => r.isTest).length).toBe(2);
    }
  });
  it('Loyalty snapshots get dates from file names and treat NOT-CAPTURED as unverified', () => {
    const dates: Record<string, string> = {
      'CAPILLARY_HERO_EARNING_28 sept.csv': '2026-09-28',
      'CAPILLARY_HERO_EARNING_05Oct.csv': '2026-10-05',
      'CAPILLARY_HERO_EARNING_13oct.csv': '2026-10-13',
      'CAPILLARY_HERO_EARNING_19Oct.csv': '2026-10-19',
      'CAPILLARY_HERO_EARNING_26Oct.csv': '2026-10-26',
    };
    for (const [f, date] of Object.entries(dates)) {
      const { payload } = ingest(f);
      expect(payload.meta.snapshotDate).toBe(date);
      const recs = payload.records as LoyaltyRec[];
      expect(recs.filter((r) => r.idKind === 'unverified').length).toBeGreaterThan(0);
      expect(recs.every((r) => !r.mobileMasked || r.mobileMasked.includes('•'))).toBe(true);
    }
    const latest = ingest('CAPILLARY_HERO_EARNING_26Oct.csv').payload.records as LoyaltyRec[];
    expect(latest.length).toBe(24);
  });
  it('Focus & Liquidation is registered with all six plant sheets', () => {
    const { payload } = ingest('Focus & Liquidation - datasense.xlsx');
    expect((payload.meta.extra as { sheets: unknown[] }).sheets.length).toBe(6);
    expect(payload.raw.length).toBe(2423 + 2197 + 2281 + 1841 + 1847 + 1073);
  });
});

d('period inference is anchored on the reference date', () => {
  it('uses NOW for year inference', () => {
    expect(NOW.getFullYear()).toBe(2026);
  });
});
