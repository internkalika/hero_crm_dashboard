// The Executive Overview's management brief: three to five takeaways, the key risks and the recommended actions.
//
// Everything here is derived from the same growth model the Dealer App vs SFA Comparison page shows (so the two pages
// can never disagree) plus a few service facts the Overview already computes (complaints, issues, Bizom usage). Each
// statement carries its figure, its period and a link to the records behind it. Nothing claims cause: "grew" is a
// measurement, "because of the Dealer App" is not. Order value is sales, never profit.
import { FLAT_BAND, GROWTH_THRESHOLD, GrowthInsight, GrowthModel, Tone, fInrD, fInrS, fPctS, growthLink } from './growth';
import type { Change } from './windows';
import type { AppData, ComplaintRec, Settings } from '../types';
import type { Period } from './period';
import { complaintKpis, splitTestComplaints } from './complaints';
import { issueKpis } from './issues';
import { splitTest, usageKpis, filterUsage } from './bizom';
import { usageTrend } from './overview';
import { pageLink } from '../nav/links';

export interface ServiceFacts {
  /** one entry per complaint export that is imported */
  complaints: Array<{ channel: string; total: number; open: number; over30: number; to: string }>;
  /** the Issue Tracker is not per dealer, so this is null while a dealer filter is on */
  issues: { total: number; open: number; overdue: number; p1Open: number } | null;
  bizom: { accesses: number; users: number; change: Change | null } | null;
}

export interface BriefAction {
  id: string;
  /** 1 = do first */
  priority: 1 | 2 | 3;
  title: string;
  why: string;
  to: string;
  toLabel: string;
}

export interface ExecutiveBrief {
  /** "1–21 Oct 2026 vs 1–21 Sep 2026" */
  period: string;
  takeaways: GrowthInsight[];
  risks: GrowthInsight[];
  actions: BriefAction[];
}

export interface BriefInput {
  /** the Dealer App dealers (or the selected dealers) */
  pilot: GrowthModel;
  /** every dealer; null while a dealer filter is on */
  all: GrowthModel | null;
  service: ServiceFacts;
  profit: { verified: boolean; statement: string };
}

const ISSUES_OVERDUE = pageLink('/issues', { kpi: ['overdue', 'Overdue'] });
const SEVERITY: Record<Tone, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };
const n = (v: number): string => v.toLocaleString('en-IN');
const pct0 = (v: number): string => `${(v * 100).toFixed(0)}%`;
const pct1 = (v: number): string => `${(v * 100).toFixed(1)}%`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function executiveBrief({ pilot, all, service, profit }: BriefInput): ExecutiveBrief {
  const m = pilot;
  const period = m.comparison ? `${m.reporting.label} vs ${m.comparison.label}` : m.reporting.label;
  const base = { rp: m.input.rp, cp: m.input.cp };
  const scoped = !all; // a dealer filter is on
  const scope = scoped ? 'The selected dealers' : `The ${plural(m.dealersInView, 'Dealer App dealer')}`;
  const cpLabel = m.comparison?.label ?? 'the comparison period';
  const takeaways: GrowthInsight[] = [];
  const risks: GrowthInsight[] = [];
  const actions: BriefAction[] = [];

  const dealerLive = !!m.prev && m.prev.covered.dealer > 0;
  const partialBase = !!m.comparison && !!m.prev && m.prev.covered.dealer < m.comparison.days;

  /* ------------------------------ takeaways ------------------------------ */

  // 1. growth of the dealers the Dealer App reaches
  const cv = m.combinedValue;
  if (!m.sliced && m.comparison && m.prev && cv && cv.pct !== null) {
    const g = cv.pct;
    const dA = (m.cur.dealer?.value ?? 0) - (m.prev.dealer?.value ?? 0);
    const dS = (m.cur.ds?.value ?? 0) - (m.prev.ds?.value ?? 0);
    const b = m.benchmark;
    const others = !scoped && b && b.others.pct !== null ? ` Over the same two periods all other dealers moved ${fPctS(b.others.pct, 1)}.` : '';
    const start = partialBase ? ` The Dealer App was live for ${m.prev.covered.dealer} of the ${m.comparison.days} days of ${cpLabel}, so part of its gain is the app starting up.` : '';
    takeaways.push({
      id: 'dealers-growth',
      tone: Math.abs(g) < FLAT_BAND ? 'warn' : g > 0 ? 'good' : 'bad',
      title: `${scope} ordered ${fPctS(g, 1)} ${g >= 0 ? 'more' : 'less'} in total across both channels`,
      detail: `Dealer App ${fInrD(dA)}, DataSense ${fInrD(dS)}.${start}${others} These dealers were not chosen at random, so this compares; it does not show the Dealer App caused the change.`,
      metric: `${fInrS(m.prev.combined.value)} → ${fInrS(m.cur.combined.value)}`,
      period,
      to: growthLink(base, { show: 'dealers' }),
      toLabel: 'See the dealers',
    });
  }

  // 2. the whole network, which the Dealer App dealers are too few to move
  const av = all?.combinedValue;
  if (all && all.comparison && all.prev && av && av.pct !== null && !all.sliced) {
    const g = av.pct;
    const share = all.cur.combined.value > 0 ? m.cur.combined.value / all.cur.combined.value : null;
    const dAall = (all.cur.dealer?.value ?? 0) - (all.prev.dealer?.value ?? 0);
    const dSall = (all.cur.ds?.value ?? 0) - (all.prev.ds?.value ?? 0);
    takeaways.push({
      id: 'network',
      tone: g <= -FLAT_BAND ? 'bad' : g >= FLAT_BAND ? 'good' : 'warn',
      title: `Across all dealers, combined order value is ${fPctS(g, 1)}`,
      detail: `${n(all.cur.activeEither)} dealers ordered in ${all.reporting.label}. Dealer App ${fInrD(dAall)}, DataSense ${fInrD(dSall)}.${share !== null ? ` The Dealer App dealers are ${pct1(share)} of the order value in ${all.reporting.label}, so their growth cannot by itself move the network total.` : ''} The files show what moved, not why: month-to-date periods are also sensitive to a few large days.`,
      metric: `${fInrS(all.prev.combined.value)} → ${fInrS(all.cur.combined.value)}`,
      period,
      to: growthLink(base, { cohort: 'all', show: 'dealers' }),
      toLabel: 'See all dealers',
    });
  }

  // 3. new business or moved business
  if (m.rows.length > 0 && m.comparison) {
    const c = m.classCounts;
    const gains = m.rows.filter((r) => (r.changeValue ?? 0) > 0).sort((x, y) => (y.changeValue ?? 0) - (x.changeValue ?? 0));
    const totalGain = gains.reduce((s, r) => s + (r.changeValue ?? 0), 0);
    const top = gains.slice(0, Math.min(3, Math.ceil(gains.length / 3)));
    const topShare = totalGain > 0 ? top.reduce((s, r) => s + (r.changeValue ?? 0), 0) / totalGain : 0;
    const conc = gains.length >= 3 && topShare >= 0.6 ? ` ${plural(top.length, 'dealer')} account${top.length === 1 ? 's' : ''} for ${pct0(topShare)} of the increase.` : '';
    takeaways.push({
      id: 'dealer-classes',
      tone: c.declining > c.incremental ? 'bad' : c.incremental > 0 ? 'good' : 'neutral',
      title: `${c.incremental} of ${plural(m.rows.length, 'dealer')} grew by ${GROWTH_THRESHOLD * 100}% or more, ${c.migration} may have moved channel, ${c.declining} declined`,
      detail: `${c.insufficient > 0 ? `${plural(c.insufficient, 'dealer')} ${c.insufficient === 1 ? 'has' : 'have'} no baseline to classify against. ` : ''}A dealer is incremental only when Dealer App and DataSense together grew; a rise in the Dealer App with a similar fall in DataSense is a channel shift.${conc} The classes are estimates from order values.`,
      metric: `${c.incremental} · ${c.migration} · ${c.declining}`,
      period,
      to: growthLink(base, { show: 'dealers' }),
      toLabel: 'See the table',
    });
  }

  // 4. adoption across the whole network
  if (all && all.cur.adoption !== null && all.cur.activeEither > 0) {
    const a = all.cur;
    const ad: number = all.cur.adoption;
    const dealerActive = a.dealer?.activeDealers ?? 0;
    const was = all.prev && all.prev.covered.dealer > 0 && all.prev.adoption !== null ? ` It was ${pct1(all.prev.adoption)} in ${cpLabel}${partialBase ? ' (the app had only just launched)' : ''}.` : '';
    takeaways.push({
      id: 'adoption',
      tone: 'warn',
      title: `${dealerActive} of ${a.activeEither.toLocaleString('en-IN')} active dealers ordered through the Dealer App (${pct1(ad)})`,
      detail: `${plural(a.commonActive, 'dealer')} also ordered through DataSense in the same period.${was} The other ${(a.activeEither - dealerActive).toLocaleString('en-IN')} active dealers ordered only through DataSense, so most active dealers have not yet ordered through the app.`,
      metric: `${pct1(ad)} adoption`,
      period: all.reporting.label,
      to: growthLink(base, { cohort: 'all', show: 'trends' }),
      toLabel: 'See adoption',
    });
  }

  // 5. profit
  if (!profit.verified) {
    takeaways.push({
      id: 'profit',
      tone: 'warn',
      title: 'Profitability cannot be judged from the imported files',
      detail: `${profit.statement} Order value on this dashboard is sales; a rise in it is not a rise in profit, and nothing here says the Dealer App improved margin.`,
      metric: 'Not verified',
      period,
      to: growthLink(base, { show: 'profit' }),
      toLabel: 'See what is missing',
    });
  }

  /* -------------------------------- risks -------------------------------- */

  if (!profit.verified) {
    risks.push({ id: 'r-profit', tone: 'bad', title: 'Profit impact of the Dealer App is unknown', detail: 'No cost of goods, discount, return, freight or incentive data was supplied for either channel, so a growth in sales cannot be turned into a growth in profit.', metric: 'No cost data', period, to: growthLink(base, { show: 'profit' }), toLabel: 'See data needed' });
  }
  if (all && all.comparison && all.prev && av && av.pct !== null && av.pct <= -FLAT_BAND) {
    risks.push({ id: 'r-network', tone: 'bad', title: `Network order value is down ${pct1(Math.abs(av.pct))}`, detail: `All dealers, both channels, ${all.reporting.label} against ${all.comparison.label}. ${all.classCounts.declining.toLocaleString('en-IN')} dealers are classified as declining.`, metric: `${fInrS(all.prev.combined.value)} → ${fInrS(all.cur.combined.value)}`, period, to: growthLink(base, { cohort: 'all', show: 'dealers', cls: 'declining' }), toLabel: 'See declining dealers' });
  }
  const declining = m.rows.filter((r) => r.cls === 'declining').sort((a, b) => (a.changeValue ?? 0) - (b.changeValue ?? 0));
  if (declining.length) {
    risks.push({ id: 'r-declining', tone: 'bad', title: `${plural(declining.length, 'Dealer App dealer')} declined`, detail: declining.slice(0, 3).map((r) => `${r.name} ${fInrD(r.changeValue ?? 0)}`).join(' · '), metric: `${declining.length} declining`, period, to: growthLink(base, { show: 'dealers', cls: 'declining' }), toLabel: 'See them' });
  }
  if (m.classCounts.migration > 0) {
    const mig = m.rows.filter((r) => r.cls === 'migration');
    risks.push({ id: 'r-shift', tone: 'warn', title: `${plural(m.classCounts.migration, 'dealer')} may have moved orders between channels without growing`, detail: mig.slice(0, 3).map((r) => `${r.name}: Dealer App ${fInrD(r.changeDealerValue ?? 0)}, DataSense ${fInrD(r.changeDsValue ?? 0)}`).join(' · '), metric: `${m.classCounts.migration} channel shift`, period, to: growthLink(base, { show: 'dealers', cls: 'migration' }), toLabel: 'See them' });
  }
  const conc = m.insights.find((i) => i.id === 'concentration');
  if (conc) risks.push({ ...conc, id: 'r-concentration', tone: 'warn', toLabel: 'See the dealers' });
  if (partialBase && m.comparison && m.prev) {
    risks.push({ id: 'r-baseline', tone: 'warn', title: 'Dealer App history is short', detail: `The Dealer App was live for ${m.prev.covered.dealer} of the ${m.comparison.days} days of ${m.comparison.label}, and October is not yet a complete month. Growth figures are indicative until two complete months can be compared.`, metric: `${m.prev.covered.dealer} of ${m.comparison.days} days`, period, to: growthLink(base, { show: 'trends' }), toLabel: 'See the trend' });
  }
  const dR = m.cur.dealer?.rejectionRate ?? null;
  const sR = m.cur.ds?.rejectionRate ?? null;
  if (dR !== null && sR !== null && (m.cur.dealer?.grossOrders ?? 0) >= 10 && dR >= sR + 0.02) {
    risks.push({ id: 'r-rejection', tone: 'warn', title: `Dealer App orders are rejected more often than DataSense orders (${pct1(dR)} vs ${pct1(sR)})`, detail: `${m.cur.dealer?.rejected} of ${m.cur.dealer?.grossOrders} Dealer App orders placed in ${m.reporting.label} were rejected. A rejected order is lost business; the export gives no reason.`, metric: `${pct1(dR)} vs ${pct1(sR)}`, period: m.reporting.label, to: growthLink(base, { show: 'orders', 'f.status': 'Rejected', 'l.status': 'Rejected' }), toLabel: 'See rejected orders' });
  }
  for (const c of service.complaints) {
    if (c.over30 > 0) risks.push({ id: `r-complaints-${c.channel}`, tone: 'bad', title: `${n(c.over30)} ${c.channel} ${c.over30 === 1 ? 'complaint' : 'complaints'} open for more than 30 days`, detail: `${n(c.open)} of ${n(c.total)} raised ${c.channel} complaints are not closed.`, metric: `${c.over30} over 30 days`, period: 'Complaints raised to date', to: c.to, toLabel: 'See the complaints' });
  }
  if (service.issues && service.issues.overdue > 0) {
    const i = service.issues;
    risks.push({ id: 'r-issues', tone: 'bad', title: `${plural(i.overdue, 'tracked issue')} past ${i.overdue === 1 ? 'its' : 'their'} target date`, detail: `${i.open} of ${i.total} issues are open, ${i.p1Open} of them P1. Items without a usable target date are not counted as overdue.`, metric: `${i.overdue} overdue`, period: 'Issue Tracker, as of today', to: ISSUES_OVERDUE, toLabel: 'See the issues' });
  }
  const bz = service.bizom;
  if (bz && bz.change && bz.change.pct !== null && bz.change.pct <= -0.1) {
    risks.push({ id: 'r-bizom', tone: 'warn', title: `Bizom SFA report use is down ${pct0(Math.abs(bz.change.pct))}`, detail: `${bz.accesses.toLocaleString('en-IN')} recorded report accesses by ${bz.users.toLocaleString('en-IN')} users in the selected period. Accesses are views, not downloads.`, metric: fPctS(bz.change.pct, 0), period: 'Selected period vs the months before', to: '/bizom/usage', toLabel: 'See Bizom usage' });
  }
  if (service.complaints.some((c) => c.channel === 'Dealer App')) {
    risks.push({ id: 'r-coverage', tone: 'neutral', title: 'Dealer App complaints cannot be compared with September', detail: 'The Dealer App complaint export starts on 1 October. Complaints per 100 orders is blank for earlier periods, not zero.', metric: 'From 1 Oct', period: 'Data coverage', to: growthLink(base, { show: 'trends' }), toLabel: 'See the chart' });
  }
  risks.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);

  /* ------------------------------- actions ------------------------------- */

  const decNames = declining.slice(0, 3).map((r) => r.name).join(', ');
  if (declining.length) actions.push({ id: 'a-declining', priority: 1, title: `Speak to the ${plural(declining.length, 'declining Dealer App dealer')}${decNames ? `: ${decNames}` : ''}`, why: 'Find out whether the fall is seasonal, a stock problem or a move to another channel.', to: growthLink(base, { show: 'dealers', cls: 'declining' }), toLabel: 'Open the dealers' });
  if (m.classCounts.migration > 0) actions.push({ id: 'a-shift', priority: 2, title: `Check whether ${plural(m.classCounts.migration, 'dealer')} only moved orders from DataSense to the Dealer App`, why: 'A shift adds no business and may only change who records the order.', to: growthLink(base, { show: 'dealers', cls: 'migration' }), toLabel: 'Open the dealers' });
  if (!profit.verified) actions.push({ id: 'a-profit', priority: 1, title: 'Obtain cost, discount, return, freight and incentive data by channel', why: 'Without it the Dealer App can be shown to grow sales but not profit.', to: growthLink(base, { show: 'profit' }), toLabel: 'See the data needed' });
  for (const c of service.complaints) {
    if (c.over30 > 0) actions.push({ id: `a-complaints-${c.channel}`, priority: 1, title: `Close or escalate the ${n(c.over30)} ${c.channel} ${c.over30 === 1 ? 'complaint' : 'complaints'} open for more than 30 days`, why: 'Old open complaints are the clearest service risk in the files.', to: c.to, toLabel: 'Open the complaints' });
  }
  if (service.issues && service.issues.overdue > 0) actions.push({ id: 'a-issues', priority: 2, title: `Review the ${plural(service.issues.overdue, 'overdue issue')}${service.issues.p1Open ? `, starting with the ${service.issues.p1Open} open P1` : ''}`, why: 'Agree new target dates or close them.', to: ISSUES_OVERDUE, toLabel: 'Open the issues' });
  if (all && all.cur.adoption !== null && all.cur.activeEither > 0) {
    const dsOnly = all.cur.activeEither - (all.cur.dealer?.activeDealers ?? 0);
    actions.push({ id: 'a-rollout', priority: 2, title: `Choose which of the ${dsOnly.toLocaleString('en-IN')} DataSense-only dealers to bring onto the Dealer App first`, why: 'Adoption is the lever the app has; rank the dealers by order value and track whether their combined business grows.', to: growthLink(base, { cohort: 'all', show: 'dealers' }), toLabel: 'Open all dealers' });
  }
  if (dR !== null && sR !== null && dR >= sR + 0.02) actions.push({ id: 'a-rejection', priority: 3, title: 'Find out why Dealer App orders are rejected', why: 'The export has no rejection reason; ask the order desk.', to: growthLink(base, { show: 'orders', 'f.status': 'Rejected', 'l.status': 'Rejected' }), toLabel: 'Open rejected orders' });
  actions.push({ id: 'a-recheck', priority: 3, title: 'Repeat this comparison once October is complete', why: 'Two complete months of Dealer App history make the growth figures firm instead of indicative.', to: growthLink(base, {}), toLabel: 'Open the comparison' });
  actions.sort((a, b) => a.priority - b.priority);

  return { period, takeaways: takeaways.slice(0, 5), risks, actions };
}

/**
 * The complaint, issue-tracker and Bizom facts the brief draws on. Complaints count everything raised to date (a backlog is
 * not a period figure); Bizom usage follows the selected reporting period; the Issue Tracker and Bizom usage are not recorded
 * per dealer, so they are left out while `scoped` (a dealer filter is on).
 */
export function buildServiceFacts({ data, settings, period, asOf, scoped }: { data: AppData; settings: Pick<Settings, 'includeTestAccounts' | 'lowUsageThreshold'>; period: Period; asOf: string; scoped: boolean }): ServiceFacts {
  const has = (source: string) => data.datasets.some((d) => d.source === source);
  const channel = (name: string, recs: ComplaintRec[], to: string) => {
    const k = complaintKpis(splitTestComplaints(recs, settings.includeTestAccounts).kept, asOf);
    return k.total ? [{ channel: name, total: k.total, open: k.backlog, over30: k.over30, to }] : [];
  };
  const complaints = [
    ...(has('dealer_complaints') ? channel('Dealer App', data.dealerComplaints, pageLink('/dealer/complaints', { kpi: ['backlog', 'Not yet closed'] })) : []),
    ...(has('ds_complaints') ? channel('DataSense', data.dsComplaints, pageLink('/datasense/complaints', { kpi: ['backlog', 'Not yet closed'] })) : []),
  ];
  let issues: ServiceFacts['issues'] = null;
  if (has('issue_tracker') && !scoped) {
    const k = issueKpis(data.issues, asOf);
    issues = { total: k.total, open: k.open, overdue: k.overdue, p1Open: k.p1Open };
  }
  let bizom: ServiceFacts['bizom'] = null;
  if (has('bizom_usage') && !scoped) {
    const all = splitTest(data.usage, settings.includeTestAccounts).kept;
    const k = usageKpis(splitTest(filterUsage(data.usage, period), settings.includeTestAccounts).kept, settings.lowUsageThreshold);
    bizom = { accesses: k.accesses, users: k.users, change: usageTrend(all, period, data, asOf)?.accesses ?? null };
  }
  return { complaints, issues, bizom };
}
