// Executive-level insights. Every statement is a descriptive observation computed from the imported data,
// worded cautiously ("may", "recorded") because the exports cannot explain causes.
import type { AppData, Insight, Settings } from '../types';
import { Period, dateInPeriod } from './period';
import { buildDealerOrders, dsOrderSummaries, groupOrders, orderKpis } from './orders';
import { buildComparison, Crosswalk } from './comparison';
import { dataRangeLabel } from '../util/parse';
import { complaintKpis, filterComplaints, splitTestComplaints } from './complaints';
import { filterUsage, splitTest, usageInsights } from './bizom';
import { issueInsights, asOfOf } from './issues';
import { snapshotsOf, latestValidSnapshot, snapshotTotals, loyaltyAnomalies } from './loyalty';
import { employeeInsights, filterEmployees } from './employees';

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const inr = (x: number) => `₹${Math.round(x).toLocaleString('en-IN')}`;

export function executiveInsights(data: AppData, period: Period, settings: Settings, crosswalk: Crosswalk = {}): Insight[] {
  const out: Insight[] = [];
  const asOf = asOfOf(settings.asOfDate);

  // ---- orders
  const dealerOrders = buildDealerOrders(data.dealerLines).filter((o) => dateInPeriod(o.date, period));
  const dsOrders = dsOrderSummaries(data.dsOrders).filter((o) => dateInPeriod(o.date, period));
  const dk = orderKpis(dealerOrders, settings, 'dealer');
  const sk = orderKpis(dsOrders, settings, 'ds');
  if (dealerOrders.length && dk.rejectionRate !== null) {
    out.push({
      id: 'dealer-rejection',
      level: dk.rejectionRate > 0.1 ? 'watch' : 'info',
      title: `${pct(dk.rejectionRate, 1)} of Dealer App orders were rejected`,
      detail: `${dk.rejected.toLocaleString('en-IN')} of ${dk.gross.toLocaleString('en-IN')} orders. The export does not record a rejection reason, so causes cannot be analysed.`,
      to: '/dealer/orders',
    });
  }
  if (dsOrders.length && sk.rejectionRate !== null) {
    out.push({ id: 'ds-rejection', level: sk.rejectionRate > 0.1 ? 'watch' : 'info', title: `${pct(sk.rejectionRate, 1)} of DataSense orders carry a rejected status`, detail: `${sk.rejected.toLocaleString('en-IN')} of ${sk.gross.toLocaleString('en-IN')} orders (${inr(sk.rejectedValue)} of value).`, to: '/datasense/orders' });
  }
  if (dsOrders.length) {
    const rows = groupOrders(dsOrders, settings, (o) => o.dealerKey ?? null).sort((a, b) => b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0);
    if (rows.length >= 10 && total > 0) {
      const top10 = rows.slice(0, 10).reduce((a, r) => a + r.value, 0) / total;
      out.push({ id: 'ds-concentration', level: top10 > 0.5 ? 'watch' : 'info', title: `The top 10 DataSense dealers account for ${pct(top10)} of order value`, detail: `Across ${rows.length.toLocaleString('en-IN')} dealers with a validated dealer code.`, to: '/datasense/orders' });
    }
  }

  // ---- comparison
  if (data.dealerLines.length && data.dsOrders.length) {
    const c = buildComparison(data, period, settings, crosswalk);
    if (c.months.length) {
      out.push({ id: 'cmp-common', level: 'info', title: `${c.counts.common} dealers placed orders through both order systems`, detail: `${c.counts.dealerOnly} Dealer App dealers placed orders only through the Dealer App, and ${c.counts.dsOnly} dealers only through DataSense. ${dataRangeLabel(c.months)} (${c.months.join(', ')}). Matching uses the ERP dealer code, never the name.`, to: '/?show=table' });
    }
    if (c.candidates.some((x) => !x.decision)) {
      out.push({ id: 'cmp-candidates', level: 'watch', title: `${c.candidates.filter((x) => !x.decision).length} possible dealer matches need review`, detail: 'Names are identical but ERP codes differ. They are not merged until you confirm.', to: '/?show=table' });
    }
  }

  // ---- complaints
  for (const [label, recs, to] of [['Dealer App', data.dealerComplaints, '/dealer/complaints'], ['DataSense', data.dsComplaints, '/datasense/complaints']] as const) {
    if (!recs.length) continue;
    const sp = splitTestComplaints(filterComplaints(recs, period), settings.includeTestAccounts);
    const k = complaintKpis(sp.kept, asOf, sp.excluded.length);
    if (k.total) {
      out.push({
        id: `compl-${label}`,
        level: k.over30 > 0 ? 'watch' : 'info',
        title: `${label}: ${k.backlog.toLocaleString('en-IN')} of ${k.total.toLocaleString('en-IN')} complaints are not yet closed`,
        detail: `${k.over30} have been open for more than 30 days as of ${asOf}.${k.tatAvailable ? '' : ' The export has no closure date, so turnaround time is unavailable.'}`,
        to,
      });
    }
  }

  // ---- Bizom
  if (data.usage.length) {
    const { kept } = splitTest(filterUsage(data.usage, period), settings.includeTestAccounts);
    out.push(...usageInsights(kept, settings.lowUsageThreshold).slice(0, 3));
  }
  out.push(...issueInsights(data.issues, asOf).slice(0, 3));

  // ---- DataSense employees
  if (data.dsEmployees.length) {
    const { kept, excluded } = filterEmployees(data.dsEmployees, period, settings.includeTestAccounts);
    out.push(...employeeInsights(kept, excluded).slice(0, 2));
  }

  // ---- Hero Smiles
  const snaps = snapshotsOf(data);
  const latest = latestValidSnapshot(snaps);
  if (latest) {
    const t = snapshotTotals(latest);
    out.push({ id: 'hs-latest', level: 'info', title: `Hero Smiles: ${t.positiveBalances.toLocaleString('en-IN')} members hold a points balance as of ${latest.date}`, detail: `Latest snapshot is a point-in-time position (${t.verified.toLocaleString('en-IN')} verified dealer IDs). Snapshots are never added together.`, to: '/hero-smiles' });
    const an = loyaltyAnomalies(snaps).filter((a) => a.kind !== 'Unverified customer ID');
    if (an.length) out.push({ id: 'hs-anom', level: 'watch', title: `${an.length} Hero Smiles balance anomalies need attention`, detail: 'For example lifetime points that decreased between snapshots or balances that do not reconcile.', to: '/hero-smiles' });
  }

  const rank = { concern: 0, watch: 1, good: 2, info: 3 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
