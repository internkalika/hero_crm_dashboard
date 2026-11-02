// Hero Smiles (Capillary) snapshot analytics.
// Balances are point-in-time values: they are NEVER added across snapshots. Trends are computed as
// per-dealer changes between consecutive snapshots, joined on the stable external customer ID.
import type { AppData, LoyaltyRec } from '../types';

export interface Snapshot {
  date: string;
  datasetId: string;
  fileName: string;
  rows: LoyaltyRec[];
}

export function snapshotsOf(data: AppData): Snapshot[] {
  const by = new Map<string, Snapshot>();
  for (const r of data.loyalty) {
    let s = by.get(r.snapshotDate);
    if (!s) {
      const meta = data.datasets.find((d) => d.id === r.datasetId);
      s = { date: r.snapshotDate, datasetId: r.datasetId, fileName: meta?.fileName ?? '', rows: [] };
      by.set(r.snapshotDate, s);
    }
    s.rows.push(r);
  }
  return [...by.values()].filter((s) => s.date !== 'unknown').sort((a, b) => a.date.localeCompare(b.date));
}

/** A snapshot is valid when it has at least one verified customer with a numeric current balance. */
export function isValidSnapshot(s: Snapshot): boolean {
  return s.rows.some((r) => r.idKind === 'verified' && r.current !== null);
}

export function latestValidSnapshot(snaps: Snapshot[]): Snapshot | null {
  for (let i = snaps.length - 1; i >= 0; i--) if (isValidSnapshot(snaps[i])) return snaps[i];
  return null;
}

export interface SnapshotTotals {
  date: string;
  fileName: string;
  rows: number;
  verified: number;
  unverified: number;
  positiveBalances: number;
  lifetime: number;
  current: number;
  issued: number;
  expired: number;
  adjustment: number;
  /** lifetime - current: points that left the balance (redeemed/expired/other); not a recorded field */
  leftBalance: number;
}

export function snapshotTotals(s: Snapshot): SnapshotTotals {
  const sum = (f: (r: LoyaltyRec) => number | null) => s.rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  const lifetime = sum((r) => r.lifetime);
  const current = sum((r) => r.current);
  return {
    date: s.date,
    fileName: s.fileName,
    rows: s.rows.length,
    verified: s.rows.filter((r) => r.idKind === 'verified').length,
    unverified: s.rows.filter((r) => r.idKind === 'unverified').length,
    positiveBalances: s.rows.filter((r) => (r.current ?? 0) > 0).length,
    lifetime,
    current,
    issued: sum((r) => r.issued),
    expired: sum((r) => r.expired),
    adjustment: sum((r) => r.adjustment),
    leftBalance: lifetime - current,
  };
}

export interface DealerChange {
  entityKey: string;
  firmName: string;
  fromDate: string;
  toDate: string;
  currentFrom: number | null;
  currentTo: number | null;
  deltaCurrent: number | null;
  lifetimeFrom: number | null;
  lifetimeTo: number | null;
  deltaLifetime: number | null;
  issuedTo: number | null;
  openingTo: number | null;
  flags: string[];
}

/** Changes between two consecutive snapshots for customers present in both (verified IDs only). */
export function changesBetween(a: Snapshot, b: Snapshot): DealerChange[] {
  const prev = new Map(a.rows.filter((r) => r.idKind === 'verified').map((r) => [r.entityKey, r]));
  const out: DealerChange[] = [];
  for (const r of b.rows) {
    if (r.idKind !== 'verified') continue;
    const p = prev.get(r.entityKey);
    if (!p) continue;
    const flags: string[] = [];
    const dl = p.lifetime !== null && r.lifetime !== null ? r.lifetime - p.lifetime : null;
    if (dl !== null && dl < 0) flags.push('lifetime_decreased');
    if (p.current !== null && r.opening !== null && Math.abs(p.current - r.opening) > 0.5) flags.push('opening_not_equal_previous_closing');
    out.push({
      entityKey: r.entityKey,
      firmName: r.firmName || p.firmName,
      fromDate: a.date,
      toDate: b.date,
      currentFrom: p.current,
      currentTo: r.current,
      deltaCurrent: p.current !== null && r.current !== null ? r.current - p.current : null,
      lifetimeFrom: p.lifetime,
      lifetimeTo: r.lifetime,
      deltaLifetime: dl,
      issuedTo: r.issued,
      openingTo: r.opening,
      flags,
    });
  }
  return out;
}

export interface SnapshotAnomaly {
  date: string;
  entityKey: string;
  firmName: string;
  kind: string;
  detail: string;
}

export function loyaltyAnomalies(snaps: Snapshot[]): SnapshotAnomaly[] {
  const out: SnapshotAnomaly[] = [];
  for (const s of snaps) {
    for (const r of s.rows) {
      if (r.idKind === 'unverified') out.push({ date: s.date, entityKey: r.customerId, firmName: r.firmName, kind: 'Unverified customer ID', detail: `"${r.customerId}" is not a stable dealer code; excluded from joins and dealer rankings.` });
      if (r.flags.includes('balance_mismatch')) out.push({ date: s.date, entityKey: r.customerId, firmName: r.firmName, kind: 'Balance does not reconcile', detail: `Current ${r.current} ≠ opening ${r.opening} + issued ${r.issued} − expired ${r.expired} + adjustment ${r.adjustment}.` });
    }
  }
  for (let i = 1; i < snaps.length; i++) {
    for (const c of changesBetween(snaps[i - 1], snaps[i])) {
      if (c.flags.includes('lifetime_decreased')) out.push({ date: c.toDate, entityKey: c.entityKey, firmName: c.firmName, kind: 'Lifetime points decreased', detail: `${c.lifetimeFrom} → ${c.lifetimeTo} between ${c.fromDate} and ${c.toDate}. Lifetime points should not fall; the earlier value may be a load/test artefact.` });
      if (c.flags.includes('opening_not_equal_previous_closing')) out.push({ date: c.toDate, entityKey: c.entityKey, firmName: c.firmName, kind: 'Opening balance ≠ previous closing', detail: `Opening ${c.openingTo} vs previous snapshot current ${c.currentFrom} (${c.fromDate}).` });
    }
  }
  return out;
}

/** Per-dealer series for charts: one value per snapshot (point-in-time, not additive). */
export function dealerSeries(snaps: Snapshot[], entityKey: string) {
  return snaps.map((s) => {
    const r = s.rows.find((x) => x.entityKey === entityKey);
    return { date: s.date, current: r?.current ?? null, lifetime: r?.lifetime ?? null, issued: r?.issued ?? null };
  });
}

export function latestPointsByDealer(data: AppData): Map<string, number> {
  const latest = latestValidSnapshot(snapshotsOf(data));
  const m = new Map<string, number>();
  if (!latest) return m;
  for (const r of latest.rows) if (r.idKind === 'verified' && r.current !== null) m.set(r.entityKey, r.current);
  return m;
}
