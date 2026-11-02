// Data quality, reconciliation and data-availability analytics.
import type { AppData, DatasetMeta, SourceType, TaggedIssue } from '../types';
import { SOURCES, SOURCE_TYPES } from '../ingest/sources';
import { buildDealerOrders } from './orders';
import { snapshotsOf, isValidSnapshot } from './loyalty';
import { normName } from '../util/parse';

export interface DqCodeRow {
  code: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  excluded: number;
  sources: SourceType[];
  files: string[];
  sample: TaggedIssue[];
  message: string;
}

const SEV_RANK = { error: 0, warning: 1, info: 2 } as const;

export function dqByCode(dq: TaggedIssue[]): DqCodeRow[] {
  const by = new Map<string, TaggedIssue[]>();
  for (const i of dq) {
    const a = by.get(i.code);
    if (a) a.push(i);
    else by.set(i.code, [i]);
  }
  return [...by.entries()]
    .map(([code, rs]) => {
      const sev = rs.reduce((s, r) => (SEV_RANK[r.severity] < SEV_RANK[s] ? r.severity : s), 'info' as TaggedIssue['severity']);
      return {
        code,
        severity: sev,
        count: rs.length,
        excluded: rs.filter((r) => r.excluded).length,
        sources: [...new Set(rs.map((r) => r.source))],
        files: [...new Set(rs.map((r) => r.fileName))],
        sample: rs.slice(0, 5),
        message: rs[0].message,
      };
    })
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count);
}

export const DQ_CODE_HELP: Record<string, string> = {
  MISSING_ORDER_ID: 'Row has no order id and cannot be counted as an order.',
  DUPLICATE_ROW: 'An identical row appears more than once; extra copies are excluded so values are not double counted.',
  INVALID_DATE: 'A date could not be read; the row is kept but excluded from period calculations.',
  INVALID_NUMBER: 'A numeric field could not be read; it is treated as unknown, not zero.',
  NEGATIVE_VALUE: 'A negative amount or quantity was found.',
  UNMAPPED_STATUS: 'A status text is not in the status map; shown as “Other/Unmapped” rather than guessed.',
  MISSING_SAP_ORDER_ID: 'Order has no SAP order id (usually rejected or not yet created in SAP).',
  FULFILLED_EXCEEDS_ORDERED: 'Fulfilled quantity is larger than ordered quantity.',
  AMOUNT_DIFFERS_FROM_QTY_X_PRICE: 'Line Amount does not equal quantity × unit price.',
  INCONSISTENT_ORDER_STATUS: 'Lines of the same order carry different order statuses.',
  ORDER_MULTIPLE_DEALERS: 'The same order id appears under more than one dealer.',
  TOTAL_MISMATCH: 'Computed totals differ from the totals printed in the source file.',
  TOTAL_RECONCILED: 'Computed totals match the source file’s total row.',
  TOTAL_ROW_EXCLUDED: 'The report footer total row was excluded from records and used only for reconciliation.',
  ZERO_VALUE_ORDER: 'Order value is zero; excluded from order-value KPIs (blank is not treated as zero).',
  POSSIBLE_DUPLICATE_ORDER: 'Two orders have the same dealer, date and value.',
  TEST_ACCOUNT: 'Account or record looks like a test/service entry; excluded from KPIs by default.',
  DASHBOARD_MISMATCH: 'The Dashboard sheet in the issue tracker disagrees with its own Tracker sheet.',
  BALANCE_MISMATCH: 'Loyalty balance does not equal opening + issued − expired + adjustment.',
  FIELD_NOT_POPULATED: 'A column exists but holds no real values.',
  FIELD_NOT_IN_SOURCE: 'A metric requested in the brief is not present in this file and is shown as unavailable.',
};

export interface DatasetHealth {
  meta: DatasetMeta;
  retained: number;
  warnings: number;
  errors: number;
  readPct: number | null;
}

export function datasetHealth(data: AppData): DatasetHealth[] {
  return data.datasets
    .map((m) => {
      const mine = data.dq.filter((i) => i.datasetId === m.id);
      return { meta: m, retained: m.validCount, warnings: mine.filter((i) => i.severity === 'warning').length, errors: mine.filter((i) => i.severity === 'error').length, readPct: m.rawCount ? m.validCount / m.rawCount : null };
    })
    .sort((a, b) => a.meta.source.localeCompare(b.meta.source) || a.meta.scope.localeCompare(b.meta.scope));
}

export interface ReconRow {
  source: SourceType;
  fileName: string;
  check: string;
  reported: number | null;
  computed: number | null;
  diff: number | null;
  ok: boolean;
  note?: string;
}

export function reconciliations(data: AppData): ReconRow[] {
  const out: ReconRow[] = [];
  for (const m of data.datasets) {
    const x = (m.extra ?? {}) as Record<string, unknown>;
    const rec = x.reconciliation as Array<{ field: string; reported: number; computed: number; diff: number }> | undefined;
    if (Array.isArray(rec)) rec.forEach((r) => out.push({ source: m.source, fileName: m.fileName, check: `${SOURCES[m.source].label}: ${r.field}`, reported: r.reported, computed: r.computed, diff: r.diff, ok: Math.abs(r.diff) <= 1 }));
    const dc = x.dashboardCheck as { headlineTotal: number | null; headlineCompleted: number | null; platformTableTotal: number | null; trackerTotal: number; trackerCompleted: number } | null | undefined;
    if (dc) {
      if (dc.headlineTotal !== null) out.push({ source: m.source, fileName: m.fileName, check: 'Issue tracker: pointers, Dashboard sheet vs Tracker sheet', reported: dc.headlineTotal, computed: dc.trackerTotal, diff: dc.trackerTotal - dc.headlineTotal, ok: dc.headlineTotal === dc.trackerTotal, note: 'CRM Tracker uses the Tracker rows.' });
      if (dc.headlineCompleted !== null) out.push({ source: m.source, fileName: m.fileName, check: 'Issue tracker: completed, Dashboard sheet vs Tracker sheet', reported: dc.headlineCompleted, computed: dc.trackerCompleted, diff: dc.trackerCompleted - dc.headlineCompleted, ok: dc.headlineCompleted === dc.trackerCompleted });
    }
  }
  return out;
}

export interface FileExpectation {
  source: SourceType;
  label: string;
  expected: string[];
  imported: string[];
  missing: string[];
  unexpected: string[];
}

const fileKey = (n: string) => n.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '');

export function missingExpectedFiles(data: AppData): FileExpectation[] {
  return SOURCE_TYPES.filter((s) => !SOURCES[s].rawOnly || SOURCES[s].expectedFiles.length)
    .map((s) => {
      const def = SOURCES[s];
      const imported = data.datasets.filter((d) => d.source === s).map((d) => d.fileName);
      const impKeys = new Set(imported.map(fileKey));
      const expKeys = new Set(def.expectedFiles.map(fileKey));
      return {
        source: s,
        label: def.label,
        expected: def.expectedFiles,
        imported,
        missing: def.expectedFiles.filter((f) => !impKeys.has(fileKey(f))),
        unexpected: imported.filter((f) => !expKeys.has(fileKey(f))),
      };
    })
    .filter((e) => e.expected.length || e.imported.length);
}

export interface SchemaChange {
  source: SourceType;
  baseline: string;
  file: string;
  added: string[];
  removed: string[];
}

/** Column differences between files of the same source (e.g. Sept vs Oct export). */
export function schemaChanges(data: AppData): SchemaChange[] {
  const out: SchemaChange[] = [];
  for (const s of SOURCE_TYPES) {
    const ds = data.datasets.filter((d) => d.source === s).sort((a, b) => a.scope.localeCompare(b.scope));
    if (ds.length < 2) continue;
    const base = ds[0];
    for (const d of ds.slice(1)) {
      const a = new Set(base.columns);
      const b = new Set(d.columns);
      const added = d.columns.filter((c) => !a.has(c));
      const removed = base.columns.filter((c) => !b.has(c));
      if (added.length || removed.length) out.push({ source: s, baseline: base.fileName, file: d.fileName, added, removed });
    }
  }
  return out;
}

export interface UnmatchedDealerSummary {
  dealerAppDealers: number;
  dsDealers: number;
  inBoth: number;
  dealerAppOnly: number;
  dsOnly: number;
  ordersWithoutDealerKey: { dealer: number; ds: number };
  complaintDealersWithoutOrders: { dealerApp: number; ds: number };
  complaintsWithoutDealer: { dealerApp: number; ds: number };
  loyaltyVerifiedNoOrders: number;
  loyaltyUnverified: number;
  /** a DataSense name used by several codes; names are not a safe join key */
  duplicateNames: number;
  examples: { dealerAppOnly: Array<{ key: string; name: string }>; dsOnly: Array<{ key: string; name: string }> };
}

export function unmatchedDealers(data: AppData): UnmatchedDealerSummary {
  const dealer = new Map<string, string>();
  data.dealerLines.forEach((l) => l.dealerKey && dealer.set(l.dealerKey, l.outletName));
  const ds = new Map<string, string>();
  data.dsOrders.forEach((o) => o.dealerKey && ds.set(o.dealerKey, o.dealerName));
  const both = [...dealer.keys()].filter((k) => ds.has(k));
  const orderKeys = new Set([...dealer.keys(), ...ds.keys()]);
  const latest = [...snapshotsOf(data)].reverse().find(isValidSnapshot);
  const dsNames = new Map<string, Set<string>>();
  ds.forEach((n, k) => dsNames.set(normName(n), (dsNames.get(normName(n)) ?? new Set()).add(k)));
  return {
    dealerAppDealers: dealer.size,
    dsDealers: ds.size,
    inBoth: both.length,
    dealerAppOnly: dealer.size - both.length,
    dsOnly: ds.size - both.length,
    ordersWithoutDealerKey: { dealer: buildDealerOrders(data.dealerLines).filter((o) => !o.dealerKey).length, ds: data.dsOrders.filter((o) => !o.dealerKey).length },
    complaintDealersWithoutOrders: {
      dealerApp: new Set(data.dealerComplaints.filter((c) => c.dealerKey && !dealer.has(c.dealerKey)).map((c) => c.dealerKey)).size,
      ds: new Set(data.dsComplaints.filter((c) => c.dealerKey && !ds.has(c.dealerKey)).map((c) => c.dealerKey)).size,
    },
    complaintsWithoutDealer: { dealerApp: data.dealerComplaints.filter((c) => !c.dealerKey).length, ds: data.dsComplaints.filter((c) => !c.dealerKey).length },
    loyaltyVerifiedNoOrders: latest ? latest.rows.filter((r) => r.idKind === 'verified' && !orderKeys.has(r.entityKey)).length : 0,
    loyaltyUnverified: latest ? latest.rows.filter((r) => r.idKind === 'unverified').length : 0,
    duplicateNames: [...dsNames.values()].filter((s) => s.size > 1).length,
    examples: {
      dealerAppOnly: [...dealer].filter(([k]) => !ds.has(k)).slice(0, 25).map(([key, name]) => ({ key, name })),
      dsOnly: [...ds].filter(([k]) => !dealer.has(k)).slice(0, 25).map(([key, name]) => ({ key, name })),
    },
  };
}

export interface AvailabilityRow {
  source: SourceType;
  label: string;
  system: string;
  present: boolean;
  files: number;
  records: number;
  coverage: string;
  note: string;
}

export function dataAvailability(data: AppData): AvailabilityRow[] {
  return SOURCE_TYPES.map((s) => {
    const ds = data.datasets.filter((d) => d.source === s);
    const def = SOURCES[s];
    const periods = ds.map((d) => d.period).filter(Boolean) as string[];
    return {
      source: s,
      label: def.label,
      system: def.system,
      present: ds.length > 0,
      files: ds.length,
      records: ds.reduce((a, d) => a + d.validCount, 0),
      coverage: periods.length ? [...new Set(periods)].sort().join(', ') : '—',
      note: ds.length ? '' : s === 'dealer_sfa_activity' ? 'Optional: needed only for Bizom vs Dealer SFA employee-level comparison.' : 'Not imported yet.',
    };
  });
}
