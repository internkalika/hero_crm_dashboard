// Key Insights for the Executive Overview.
//
// Every row is computed from the imported files and carries the address of the dashboard that supports it, already
// filtered (a dealer, a month, a report, a status). When the data behind an insight does not exist, the insight does not
// exist: nothing is estimated and no placeholder is shown.
import type { AppData, OrderSummary, Settings } from '../types';
import { fDate, fInrCompact, fInt, fPct } from '../export/format';
import { isValidatedDealerKey, pageLink } from '../nav/links';
import { titleCase, monthLabel, dataRangeLabel } from '../util/parse';
import { Period, dateInPeriod, monthInPeriod } from './period';
import { buildDealerOrders, dsOrderSummaries, groupOrders } from './orders';
import { buildComparison, Crosswalk } from './comparison';
import { countBy, filterComplaints, splitTestComplaints, CountRow } from './complaints';
import { filterUsage, reportRanking, splitTest, usageByMonth, usageKpis } from './bizom';
import { isOpen, issuesBy } from './issues';
import { dealerKeyOfOrder, loyaltyOverview } from './overview';
import { changeOf, lastTwoCompleteMonths, monthCompleteFn } from './windows';

export type InsightIcon = 'trophy' | 'orders' | 'change' | 'report' | 'backlog' | 'complaint' | 'dealers' | 'points';

export interface InsightRow {
  /** the finding, e.g. a dealer name or a report name */
  text: string;
  /** the supporting figures */
  sub: string;
  /** tag shown before the text: which system the row is about */
  tag: string;
  to: string;
  /** the headline figure, drawn large on the right of the row (e.g. "₹4.2L", "12.3%") */
  stat?: string;
  /** what the headline figure counts, drawn small under it (e.g. "orders") */
  unit?: string;
  /** direction of a change figure: drawn as a green ▲ or a red ▼ */
  dir?: 'up' | 'down';
  /** a share between 0 and 1, drawn as a bar under the row */
  share?: number;
  /** what the bar is a share of, e.g. "42% of Dealer App total" */
  shareLabel?: string;
}

export interface KeyInsight {
  id: string;
  icon: InsightIcon;
  title: string;
  rows: InsightRow[];
}

const nice = (s: string) => titleCase(s.toLowerCase());
/** The size of a change without its direction (the row draws the arrow): a percentage, or the amount when there is no base. */
const changeStat = (c: { abs: number; pct: number | null }, money: boolean) => (c.pct !== null ? fPct(Math.abs(c.pct)) : money ? fInrCompact(Math.abs(c.abs)) : fInt(Math.abs(c.abs)));
const dirOf = (abs: number): 'up' | 'down' | undefined => (abs > 0 ? 'up' : abs < 0 ? 'down' : undefined);

/** A page filtered to one dealer; the dealer profile opens on top when the dealer has a validated ERP code. */
function dealerOnPage(path: string, key: string, label: string): string {
  return pageLink(path, { dealer: [key, label] }, isValidatedDealerKey(key) ? { dealer: key } : {});
}

export function keyInsights(data: AppData, period: Period, settings: Settings, crosswalk: Crosswalk, asOf: string): KeyInsight[] {
  const out: KeyInsight[] = [];
  const dealerAll = buildDealerOrders(data.dealerLines);
  const dsAll = dsOrderSummaries(data.dsOrders);
  const dealerIn = dealerAll.filter((o) => dateInPeriod(o.date, period));
  const dsIn = dsAll.filter((o) => dateInPeriod(o.date, period));
  const systems = [
    { id: 'dealer' as const, tag: 'Dealer App', path: '/dealer/orders', all: dealerAll, orders: dealerIn },
    { id: 'ds' as const, tag: 'DataSense', path: '/datasense/orders', all: dsAll, orders: dsIn },
  ].filter((s) => s.orders.length > 0);

  // 1 + 2: leading dealers
  const leaders = (by: 'value' | 'orders') =>
    systems.flatMap((s): InsightRow[] => {
      const rows = groupOrders(s.orders, settings, dealerKeyOfOrder, (_k, rs) => rs[0].dealerName || rs[0].dealerKey || 'Unnamed dealer').filter((r) => r.orders > 0);
      if (!rows.length) return [];
      const top = [...rows].sort((a, b) => (by === 'value' ? b.value - a.value || b.orders - a.orders : b.orders - a.orders || b.value - a.value))[0];
      const total = rows.reduce((a, r) => a + (by === 'value' ? r.value : r.orders), 0);
      const mine = by === 'value' ? top.value : top.orders;
      return [
        {
          tag: s.tag,
          text: nice(top.label),
          stat: by === 'value' ? fInrCompact(top.value) : fInt(top.orders),
          unit: by === 'value' ? 'order value' : 'orders',
          sub: by === 'value' ? `${fInt(top.orders)} orders` : `${fInrCompact(top.value)} order value`,
          ...(total ? { share: mine / total, shareLabel: `${fPct(mine / total, 0)} of ${s.tag} total` } : {}),
          to: dealerOnPage(s.path, top.key, nice(top.label)),
        },
      ];
    });
  const byValue = leaders('value');
  if (byValue.length) out.push({ id: 'top-value', icon: 'trophy', title: 'Highest order value', rows: byValue });
  const byOrders = leaders('orders');
  if (byOrders.length) out.push({ id: 'top-orders', icon: 'orders', title: 'Most orders', rows: byOrders });

  // 3: latest change between two complete months in view
  const changeRows: InsightRow[] = [];
  for (const s of systems) {
    const present = new Set(s.all.map((o) => o.month).filter(Boolean) as string[]);
    const inView = [...present].filter((m) => monthInPeriod(m, period));
    const pair = lastTwoCompleteMonths(inView, (m) => present.has(m), monthCompleteFn(data, [s.id === 'dealer' ? 'dealer_orders' : 'ds_orders'], asOf));
    if (!pair) continue;
    const [a, b] = pair;
    const monthOrders = (m: string): OrderSummary[] => s.all.filter((o) => o.month === m);
    const valueOf = (m: string) => groupOrders(monthOrders(m), settings, () => 'all')[0]?.value ?? 0;
    const c = changeOf(valueOf(a), valueOf(b));
    if (c) changeRows.push({ tag: s.tag, text: 'Order value', stat: changeStat(c, true), dir: dirOf(c.abs), sub: `${monthLabel(b)} vs ${monthLabel(a)} · ${fInrCompact(c.from)} → ${fInrCompact(c.to)}`, to: pageLink(s.path, { month: [b, monthLabel(b)] }) });
    // biggest single-dealer movement over the same two months
    const perDealer = (m: string) => new Map(groupOrders(monthOrders(m), settings, dealerKeyOfOrder, (_k, rs) => rs[0].dealerName || '').map((r) => [r.key, r]));
    const from = perDealer(a);
    const to = perDealer(b);
    let best: { key: string; label: string; abs: number } | null = null;
    for (const k of new Set([...from.keys(), ...to.keys()])) {
      const abs = (to.get(k)?.value ?? 0) - (from.get(k)?.value ?? 0);
      if (!best || Math.abs(abs) > Math.abs(best.abs)) best = { key: k, label: to.get(k)?.label || from.get(k)?.label || k, abs };
    }
    if (best && best.abs !== 0) changeRows.push({ tag: s.tag, text: nice(best.label), stat: `${best.abs > 0 ? '+' : '−'}${fInrCompact(Math.abs(best.abs))}`, dir: dirOf(best.abs), sub: `Largest dealer movement, ${monthLabel(b)} vs ${monthLabel(a)}`, to: dealerOnPage(s.path, best.key, nice(best.label)) });
  }
  const usageIn = splitTest(filterUsage(data.usage, period), settings.includeTestAccounts).kept;
  if (data.usage.length) {
    const present = new Set(data.usage.map((u) => u.month));
    const inView = [...present].filter((m) => monthInPeriod(m, period));
    const pair = lastTwoCompleteMonths(inView, (m) => present.has(m), monthCompleteFn(data, ['bizom_usage'], asOf));
    if (pair) {
      const all = splitTest(data.usage, settings.includeTestAccounts).kept;
      const rows = usageByMonth(all);
      const a = rows.find((r) => r.month === pair[0]);
      const b = rows.find((r) => r.month === pair[1]);
      const c = a && b ? changeOf(a.accesses, b.accesses) : null;
      if (c && b && a) changeRows.push({ tag: 'Bizom SFA', text: 'Report accesses', stat: changeStat(c, false), dir: dirOf(c.abs), sub: `${b.label} vs ${a.label} · ${fInt(c.from)} → ${fInt(c.to)}`, to: pageLink('/bizom/usage', { month: [b.month, b.label] }) });
    }
  }
  if (changeRows.length) out.push({ id: 'change', icon: 'change', title: 'Latest change between complete months', rows: changeRows });

  // 4: most-accessed Bizom report
  if (usageIn.length) {
    const top = reportRanking(usageIn)[0];
    const k = usageKpis(usageIn, settings.lowUsageThreshold);
    if (top && top.accesses > 0) out.push({ id: 'report', icon: 'report', title: 'Most-accessed Bizom report', rows: [{ tag: 'Bizom SFA', text: top.reportName.replace(/\s+/g, ' '), stat: fInt(top.accesses), unit: 'accesses', share: top.share, shareLabel: `${fPct(top.share, 0)} of all report accesses`, sub: `Used by ${fInt(top.users)} of ${fInt(k.users)} users`, to: pageLink('/bizom/usage', { report: top.reportName }) }] });
  }

  // 5: biggest backlog
  const backlogRows: InsightRow[] = [];
  const worst = (rows: CountRow[]) => rows.filter((r) => r.label !== 'Not specified' && r.backlog > 0).sort((a, b) => b.backlog - a.backlog || b.count - a.count)[0];
  const dealerC = splitTestComplaints(filterComplaints(data.dealerComplaints, period), settings.includeTestAccounts).kept;
  const dsC = splitTestComplaints(filterComplaints(data.dsComplaints, period), settings.includeTestAccounts).kept;
  if (dealerC.length) {
    const w = worst(countBy(dealerC, (c) => c.department ?? 'Not specified'));
    if (w) backlogRows.push({ tag: 'Dealer App', text: `${w.label} department`, stat: fInt(w.backlog), unit: 'not closed', share: w.count ? w.backlog / w.count : undefined, shareLabel: `${fInt(w.backlog)} of ${fInt(w.count)} complaints`, sub: 'Department with the most complaints not closed', to: pageLink('/dealer/complaints', { func: w.key, kpi: ['backlog', 'Not yet closed'] }) });
  }
  if (dsC.length) {
    const w = worst(countBy(dsC, (c) => c.owner ?? 'Not specified'));
    if (w) backlogRows.push({ tag: 'DataSense', text: w.label, stat: fInt(w.backlog), unit: 'not closed', share: w.count ? w.backlog / w.count : undefined, shareLabel: `${fInt(w.backlog)} of ${fInt(w.count)} complaints`, sub: 'Owner with the most complaints not closed', to: pageLink('/datasense/complaints', { func: w.key, kpi: ['backlog', 'Not yet closed'] }) });
  }
  if (data.issues.length) {
    const openIssues = data.issues.filter(isOpen);
    const g = issuesBy(openIssues, (i) => i.platform, asOf).filter((r) => r.label !== 'Not specified').sort((a, b) => b.open - a.open)[0];
    if (g && g.open > 0) backlogRows.push({ tag: 'Issue Tracker', text: `${g.label} platform`, stat: fInt(g.open), unit: 'open', share: openIssues.length ? g.open / openIssues.length : undefined, shareLabel: `${fInt(g.open)} of ${fInt(openIssues.length)} open issues`, sub: `${g.overdue ? `${fInt(g.overdue)} overdue · ` : ''}The tracker has no department column, so issues are grouped by platform`, to: pageLink('/issues', { platform: g.key, kpi: ['open', 'Open'] }) });
  }
  if (backlogRows.length) out.push({ id: 'backlog', icon: 'backlog', title: 'Largest unresolved backlog', rows: backlogRows });

  // 6: most frequent complaint category
  const categoryRows: InsightRow[] = [];
  for (const [tag, recs, path] of [['Dealer App', dealerC, '/dealer/complaints'], ['DataSense', dsC, '/datasense/complaints']] as const) {
    if (!recs.length) continue;
    const top = countBy(recs, (c) => c.category).sort((a, b) => b.count - a.count)[0];
    if (top && top.label !== 'Not specified') categoryRows.push({ tag, text: top.label, stat: fInt(top.count), unit: 'complaints', share: top.share, shareLabel: `${fPct(top.share, 0)} of ${fInt(recs.length)} complaints`, sub: `${fInt(top.backlog)} not closed`, to: pageLink(path, { category: top.key }) });
  }
  if (categoryRows.length) out.push({ id: 'category', icon: 'complaint', title: 'Most frequent complaint category', rows: categoryRows });

  // 7: dealers active in one system but not the other
  if (dealerAll.length && dsAll.length) {
    const c = buildComparison(data, period, settings, crosswalk);
    if (c.months.length) {
      const link = (scope: string) => pageLink('/', {}, { scope, show: 'table' });
      const onApp = c.rows.filter((r) => r.onDealerApp).length;
      out.push({
        id: 'coverage',
        icon: 'dealers',
        title: 'Which system dealers order through',
        rows: [
          { tag: 'Both', text: 'Dealer App dealers ordering in both systems', stat: fInt(c.counts.common), unit: 'dealers', share: onApp ? c.counts.common / onApp : undefined, shareLabel: `${fInt(c.counts.common)} of ${fInt(onApp)} Dealer App dealers`, sub: `Orders through the Dealer App and DataSense · ${dataRangeLabel(c.months)}`, to: link('common') },
          { tag: 'Dealer App', text: 'Dealer App dealers ordering only through the Dealer App', stat: fInt(c.counts.dealerOnly), unit: 'dealers', share: onApp ? c.counts.dealerOnly / onApp : undefined, shareLabel: `${fInt(c.counts.dealerOnly)} of ${fInt(onApp)} Dealer App dealers`, sub: `No DataSense order · ${dataRangeLabel(c.months)}`, to: link('dealer_only') },
          { tag: 'DataSense', text: 'DataSense dealers not on the Dealer App', stat: fInt(c.counts.dsOnly), unit: 'dealers', sub: `No Dealer App order · ${dataRangeLabel(c.months)}`, to: link('ds_only') },
        ],
      });
    }
  }

  // 8: Hero Smiles movement between the two latest snapshots
  const loy = loyaltyOverview(data);
  if (loy && loy.previous && loy.points) {
    const rows: InsightRow[] = [{ tag: 'Hero Smiles', text: 'Current points', stat: changeStat(loy.points, false), dir: dirOf(loy.points.abs), sub: `${fDate(loy.previous.date)} → ${fDate(loy.latest.date)} · ${fInt(loy.points.from)} → ${fInt(loy.points.to)} (two point-in-time totals)`, to: '/hero-smiles' }];
    const named = loy.movers.filter((m) => isValidatedDealerKey(m.entityKey));
    const up = [...named].sort((a, b) => (b.deltaCurrent ?? 0) - (a.deltaCurrent ?? 0))[0];
    const down = [...named].sort((a, b) => (a.deltaCurrent ?? 0) - (b.deltaCurrent ?? 0))[0];
    const mover = (m: typeof up, sign: string) => ({ tag: 'Hero Smiles', text: nice(m.firmName), stat: `${sign}${fInt(Math.abs(m.deltaCurrent ?? 0))}`, unit: 'points', dir: (m.deltaCurrent ?? 0) > 0 ? ('up' as const) : ('down' as const), sub: `${fInt(m.currentFrom)} → ${fInt(m.currentTo)} since ${fDate(m.fromDate)}`, to: pageLink('/hero-smiles', {}, { dealer: m.entityKey, dtab: 'loyalty' }) });
    if (up && (up.deltaCurrent ?? 0) > 0) rows.push(mover(up, '+'));
    if (down && (down.deltaCurrent ?? 0) < 0) rows.push(mover(down, '−'));
    out.push({ id: 'points', icon: 'points', title: 'Hero Smiles points movement', rows });
  }
  return out;
}
