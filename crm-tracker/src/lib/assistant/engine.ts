// The data assistant's engine: a rule-based question answerer that runs entirely in the browser.
//
// It is NOT a generative AI model. A question is matched to one of a fixed list of intents by keyword; the answer is then
// calculated from the same models the pages use (the growth model, the complaint, issue, Bizom and Hero Smiles
// calculations), for the periods and filters currently on screen. Every answer states the period and the dealers it used,
// shows the figures it is built from, and links to the records behind them. A question it cannot match is answered with
// "I could not match that", never with a made-up figure. Nothing is sent anywhere, so there is no key to protect.
import type { AppData, Settings } from '../types';
import type { Period } from '../metrics/period';
import { CLASS_META, CLASS_ORDER, GrowthClass, GrowthInput, GrowthModel, adoptionStatusOf, buildGrowth, fInrD, fInrS, fPctS, growthCatalogue, growthLink, CatalogueDealer } from '../metrics/growth';
import { buildServiceFacts, executiveBrief } from '../metrics/executive';
import { inspectProfitability, PROFIT_REQUIREMENTS } from '../metrics/profitability';
import { complaintKpis, filterComplaints, splitTestComplaints } from '../metrics/complaints';
import { issueKpis } from '../metrics/issues';
import { filterUsage, splitTest, usageKpis, reportRanking } from '../metrics/bizom';
import { loyaltyOverview } from '../metrics/overview';
import { scopeToDealer } from '../metrics/scope';
import { dealerLink, pageLink } from '../nav/links';
import { fDate, fInt } from '../export/format';

/* --------------------------------- types --------------------------------- */

export interface AnswerFigure {
  label: string;
  value: string;
  note?: string;
}

export interface AnswerLink {
  label: string;
  to: string;
}

export interface Answer {
  intent: string;
  /** false = no intent matched; the answer says so and offers things that can be asked */
  matched: boolean;
  title: string;
  paragraphs: string[];
  /** the figures the answer is built from */
  figures: AnswerFigure[];
  /** records the figures come from (dealers, pages) */
  records: AnswerLink[];
  /** where to go next */
  actions: AnswerLink[];
  /** the period the figures are for, in words */
  period: string;
  /** whose figures: "The 11 Dealer App dealers", "Kamala Cycle Mart", filters in force */
  scope: string;
  /** questions that can be asked next (shown when nothing matched) */
  suggestions?: string[];
}

export interface AssistantContext {
  data: AppData;
  settings: Pick<Settings, 'includeRejected' | 'includeTestAccounts' | 'lowUsageThreshold'>;
  asOf: string;
  /** the dashboard's own reporting period (used for complaints and Bizom usage, as their pages do) */
  period: Period;
  /** the two periods, the dealers and the filters on the comparison page */
  input: GrowthInput;
}

export const EXAMPLE_QUESTIONS = [
  'Is the Dealer App helping Hero Cycles grow?',
  'Which dealers show incremental growth?',
  'Which dealers may have moved orders between channels?',
  'How many dealers use the Dealer App?',
  'Is profitability verified?',
  'What are the key risks?',
];

/* ------------------------------- the question ------------------------------- */

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const GENERIC = new Set(['the', 'and', 'of', 'cycle', 'cycles', 'traders', 'trader', 'agencies', 'agency', 'enterprises', 'enterprise', 'store', 'stores', 'mart', 'company', 'co', 'ltd', 'pvt', 'private', 'limited', 'bicycle', 'bicycles', 'sales', 'shop', 'centre', 'center', 'dealer', 'dealers', 'corporation', 'house', 'point', 'hub', 'bikes', 'bike', 'motors', 'automobiles', 'distributors', 'distributor', 'ent', 'brothers', 'bros']);
const wordsOf = (s: string): string[] => norm(s).split(' ').filter((w) => w.length >= 2);

interface Resolved {
  dealer: CatalogueDealer | null;
  /** how it was found: the ERP code, the whole name, or only some words of the name */
  how?: 'code' | 'name' | 'partial';
  /** several dealers fit equally well */
  candidates: CatalogueDealer[];
}

const nameIndex = new WeakMap<AppData, Array<{ d: CatalogueDealer; full: string; distinct: string[] }>>();
function indexOf(data: AppData) {
  let idx = nameIndex.get(data);
  if (!idx) {
    idx = growthCatalogue(data).map((d) => ({ d, full: norm(d.name), distinct: wordsOf(d.name).filter((w) => !GENERIC.has(w)) }));
    nameIndex.set(data, idx);
  }
  return idx;
}

const CUE = /\b(about|how is|how are|how did|how has|tell me|status of|performance of|profile|show me|look up|lookup|details|what about)\b/;

/** Finds the dealer a question names: by ERP code, by full name, or (when the question is clearly about a dealer) by its distinctive words. */
export function resolveDealer(question: string, data: AppData): Resolved {
  const q = norm(question);
  const idx = indexOf(data);
  const code = /\b\d{4,9}\b/.exec(q)?.[0];
  if (code) {
    const hit = idx.find((e) => e.d.key === code || e.d.outletId === code);
    if (hit) return { dealer: hit.d, how: 'code', candidates: [] };
  }
  const full = idx.filter((e) => e.full.length >= 5 && q.includes(e.full));
  if (full.length) {
    const longest = Math.max(...full.map((e) => e.full.length));
    const best = full.filter((e) => e.full.length === longest);
    return best.length === 1 ? { dealer: best[0].d, how: 'name', candidates: [] } : { dealer: null, candidates: best.slice(0, 5).map((e) => e.d) };
  }
  const qWords = new Set(wordsOf(q));
  const cue = CUE.test(q);
  const scored = idx
    .map((e) => {
      if (!e.distinct.length) return { e, score: 0 };
      const hit = e.distinct.filter((w) => qWords.has(w));
      const frac = hit.length / e.distinct.length;
      const long = hit.some((w) => w.length >= 5);
      if (!(hit.length && frac >= 0.5 && (hit.length >= 2 || long))) return { e, score: 0 };
      // without a cue word ("about", "how is" ...) the question must be little more than the dealer's name
      const nameWords = new Set(wordsOf(e.d.name));
      const rest = [...qWords].filter((w) => !nameWords.has(w) && !GENERIC.has(w));
      if (!cue && rest.length > 0) return { e, score: 0 };
      return { e, score: frac * 50 + hit.length * 5 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { dealer: null, candidates: [] };
  const top = scored.filter((x) => x.score === scored[0].score);
  return top.length === 1 ? { dealer: top[0].e.d, how: 'partial', candidates: [] } : { dealer: null, candidates: top.slice(0, 5).map((x) => x.e.d) };
}

/* -------------------------------- context -------------------------------- */

interface Ctx extends AssistantContext {
  q: string;
  growth: () => GrowthModel | null;
  network: () => GrowthModel | null;
}

const money = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : fInrS(v));
const pct1 = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
const plural = (n: number, one: string, many = `${one}s`): string => `${fInt(n)} ${n === 1 ? one : many}`;

function windows(m: GrowthModel): string {
  return m.comparison ? `${m.reporting.label} vs ${m.comparison.label}` : m.reporting.label;
}

function scopeOf(c: Ctx, m: GrowthModel | null): string {
  const i = c.input;
  const bits: string[] = [];
  if (i.dealers.length) bits.push(`${plural(i.dealers.length, 'selected dealer')}`);
  else if (m) bits.push(i.cohort === 'pilot' ? `the ${plural(m.dealersInView, 'Dealer App dealer')}` : `all ${fInt(m.dealersInView)} dealers`);
  const f: string[] = [];
  if (i.dbs.length) f.push(`DB code ×${i.dbs.length}`);
  if (i.outlets.length) f.push(`outlet ×${i.outlets.length}`);
  if (i.zones.length) f.push(`zone: ${i.zones.join(', ')}`);
  if (i.cities.length) f.push(`city: ${i.cities.join(', ')}`);
  if (i.channels.length) f.push(`channel: ${i.channels.map((x) => (x === 'dealer' ? 'Dealer App' : 'DataSense')).join(', ')}`);
  if (i.models.length) f.push(`model: ${i.models.join(', ')}`);
  if (i.sizes.length) f.push(`wheel size: ${i.sizes.join(', ')}`);
  return [...bits, ...(f.length ? [`filters: ${f.join('; ')}`] : [])].join(' · ');
}

/** The dealers part of the scope, capitalised for the start of a sentence. */
const scopeHead = (c: Ctx, m: GrowthModel | null): string => {
  const h = scopeOf(c, m).split(' · ')[0];
  return h ? `${h[0].toUpperCase()}${h.slice(1)}` : 'The dealers in view';
};

const base = (c: Ctx, m: GrowthModel | null) => ({ rp: m?.input.rp ?? c.input.rp, cp: m?.input.cp ?? c.input.cp });

const empty = (intent: string, title: string, text: string, to?: AnswerLink): Answer => ({ intent, matched: true, title, paragraphs: [text], figures: [], records: [], actions: to ? [to] : [], period: '—', scope: '—' });
const NO_ORDERS = (intent: string) => empty(intent, 'No order data', 'No Dealer App or DataSense order file has been imported yet, so there is nothing to calculate this from.', { label: 'Open Data Import', to: '/import' });

/* -------------------------------- handlers -------------------------------- */

function growthAnswer(c: Ctx): Answer {
  const m = c.growth();
  if (!m) return NO_ORDERS('growth');
  const ps: string[] = [];
  const figs: AnswerFigure[] = [];
  const cv = m.combinedValue;
  if (m.sliced) ps.push('A model or wheel-size filter is on, and DataSense orders have no model, so only the Dealer App can be shown. Clear the filter for the combined view.');
  else if (m.comparison && m.prev && cv && cv.pct !== null) {
    const dA = (m.cur.dealer?.value ?? 0) - (m.prev.dealer?.value ?? 0);
    const dS = (m.cur.ds?.value ?? 0) - (m.prev.ds?.value ?? 0);
    ps.push(`${scopeHead(c, m)} placed ${money(m.cur.combined.value)} of orders through both channels in ${m.reporting.label}, ${fPctS(cv.pct, 1)} against ${m.comparison.label} (${money(m.prev.combined.value)}). Dealer App ${fInrD(dA)}, DataSense ${fInrD(dS)}.`);
    figs.push({ label: `Combined order value, ${m.reporting.label}`, value: money(m.cur.combined.value) }, { label: `Combined order value, ${m.comparison.label}`, value: money(m.prev.combined.value) }, { label: 'Change', value: fPctS(cv.pct, 1), note: fInrD(cv.abs) }, { label: 'Dealer App change', value: fInrD(dA) }, { label: 'DataSense change', value: fInrD(dS) });
    const b = m.benchmark;
    if (b && b.pilot.pct !== null && b.others.pct !== null) ps.push(`Over the same two periods the other dealers moved ${fPctS(b.others.pct, 1)}. The Dealer App dealers were not chosen at random, so this is a comparison, not proof that the app caused the difference.`);
    if (m.prev.covered.dealer < m.comparison.days) ps.push(`The Dealer App was live for ${m.prev.covered.dealer} of the ${m.comparison.days} days of ${m.comparison.label}, so part of its gain is the app starting up.`);
  } else ps.push(m.comparisonNote ?? 'There is no comparison period, so growth cannot be calculated. Choose one on the comparison page.');
  const k = m.classCounts;
  figs.push({ label: 'Incremental · channel shift · declining', value: `${k.incremental} · ${k.migration} · ${k.declining}`, note: 'dealers, by combined value' });
  ps.push('This is sales value, not profit: no cost data has been supplied, so the dashboard cannot say whether the Dealer App improved profitability.');
  return { intent: 'growth', matched: true, title: 'Is the Dealer App helping business grow?', paragraphs: ps, figures: figs, records: [{ label: 'Dealer-by-dealer table', to: growthLink(base(c, m), { show: 'dealers' }) }], actions: [{ label: 'Open the comparison page', to: growthLink(base(c, m)) }, { label: 'See what is driving growth', to: growthLink(base(c, m), { show: 'drivers' }) }], period: windows(m), scope: scopeOf(c, m) };
}

function classAnswer(c: Ctx, cls: GrowthClass): Answer {
  const m = c.growth();
  if (!m) return NO_ORDERS(cls);
  const meta = CLASS_META[cls];
  const rows = m.rows.filter((r) => r.cls === cls).sort((a, b) => Math.abs(b.changeValue ?? 0) - Math.abs(a.changeValue ?? 0));
  const ps = [`${plural(rows.length, 'dealer')} ${rows.length === 1 ? 'is' : 'are'} classed as "${meta.label}". ${meta.help}`];
  if (cls === 'incremental' || cls === 'migration') ps.push('The class is an estimate from order values, not proof of cause. A channel shift adds no business; an incremental candidate grew across both channels together.');
  if (!rows.length) ps.push(m.comparison ? 'No dealer meets that rule in these two periods.' : 'There is no comparison period, so dealers cannot be classified.');
  return {
    intent: cls,
    matched: true,
    title: meta.label,
    paragraphs: ps,
    figures: rows.slice(0, 6).map((r) => ({ label: r.name, value: r.changePct !== null ? `${fInrD(r.changeValue ?? 0)} (${fPctS(r.changePct, 0)})` : fInrD(r.changeValue ?? 0), note: r.evidence })),
    records: rows.slice(0, 6).map((r) => ({ label: r.name, to: dealerLink('/', r.key) })).filter((l) => !l.to.includes('name:')),
    actions: [{ label: `Open these dealers in the table`, to: growthLink(base(c, m), { show: 'dealers', cls }) }],
    period: windows(m),
    scope: scopeOf(c, m),
  };
}

function adoptionAnswer(c: Ctx): Answer {
  const net = c.network();
  const m = c.growth();
  if (!net || !m) return NO_ORDERS('adoption');
  const a = net.cur;
  const dealerActive = a.dealer?.activeDealers ?? 0;
  const ps = [`${fInt(dealerActive)} of ${fInt(a.activeEither)} dealers that placed an eligible order in ${net.reporting.label} ordered through the Dealer App (${pct1(a.adoption)}). ${fInt(a.commonActive)} of them also ordered through DataSense.`];
  if (net.prev && net.prev.covered.dealer > 0 && net.prev.adoption !== null) ps.push(`In ${net.comparison?.label} it was ${pct1(net.prev.adoption)}${net.prev.covered.dealer < (net.comparison?.days ?? 0) ? ', when the app had only just launched' : ''}.`);
  ps.push(`Among the ${fInt(m.dealersInView)} dealers in view, ${pct1(m.cur.adoption)} ordered through the app.`);
  return {
    intent: 'adoption',
    matched: true,
    title: 'Dealer App adoption',
    paragraphs: ps,
    figures: [
      { label: 'Active dealers, either channel', value: fInt(a.activeEither) },
      { label: 'Ordered through the Dealer App', value: fInt(dealerActive) },
      { label: 'Ordered through both channels', value: fInt(a.commonActive) },
      { label: 'Adoption, all dealers', value: pct1(a.adoption) },
      { label: 'Adoption, dealers in view', value: pct1(m.cur.adoption) },
    ],
    records: [{ label: 'Adoption trend', to: growthLink(base(c, net), { show: 'trends' }) }],
    actions: [{ label: 'See all dealers', to: growthLink(base(c, net), { cohort: 'all', show: 'dealers' }) }],
    period: windows(net),
    scope: 'All dealers (adoption); the dealers in view where stated',
  };
}

function topAnswer(c: Ctx): Answer {
  const m = c.growth();
  if (!m) return NO_ORDERS('top');
  const rows = [...m.rows].sort((a, b) => b.cur.combinedValue - a.cur.combinedValue).slice(0, 5);
  return {
    intent: 'top',
    matched: true,
    title: 'Top dealers by order value',
    paragraphs: [`The five dealers with the highest combined Dealer App + DataSense order value in ${m.reporting.label}${m.comparison ? `, with the change against ${m.comparison.label}` : ''}.`],
    figures: rows.map((r) => ({ label: r.name, value: money(r.cur.combinedValue), note: `${fInt(r.cur.combinedOrders)} orders${r.changePct !== null ? ` · ${fPctS(r.changePct, 0)}` : ''}` })),
    records: rows.map((r) => ({ label: r.name, to: dealerLink('/', r.key) })),
    actions: [{ label: 'Open the dealer table', to: growthLink(base(c, m), { show: 'dealers' }) }],
    period: windows(m),
    scope: scopeOf(c, m),
  };
}

function kpiAnswer(c: Ctx, ids: string[], title: string, intent: string): Answer {
  const m = c.growth();
  if (!m) return NO_ORDERS(intent);
  const ks = m.kpis.filter((k) => ids.includes(k.id));
  const fmt = (v: number | null, u: string): string => {
    if (v === null) return '—';
    if (u === 'inr') return fInrS(v);
    if (u === 'pct') return pct1(v);
    if (u === 'per100') return v.toFixed(1);
    return fInt(v);
  };
  const figures: AnswerFigure[] = ks.flatMap((k) => [
    { label: `${k.label}, Dealer App`, value: fmt(k.dealer, k.unit), note: k.dealerChange ? `${k.dealerChange.pct !== null ? fPctS(k.dealerChange.pct, 0) : 'new'} vs ${fmt(k.dealerPrev, k.unit)}${k.dealerIndicative ? ' · indicative' : ''}` : undefined },
    { label: `${k.label}, DataSense`, value: fmt(k.ds, k.unit), note: k.dsChange ? `${k.dsChange.pct !== null ? fPctS(k.dsChange.pct, 0) : 'new'} vs ${fmt(k.dsPrev, k.unit)}` : undefined },
  ]);
  const ps = ks.map((k) => `${k.label}: Dealer App ${fmt(k.dealer, k.unit)}, DataSense ${fmt(k.ds, k.unit)}${k.gapAbs !== null && k.unit !== 'pct' ? ` (gap ${k.gapAbs >= 0 ? '+' : '−'}${fmt(Math.abs(k.gapAbs), k.unit)})` : ''}.`);
  if (ids.includes('complaint')) ps.push('Complaints per 100 orders is blank for a period the complaint export does not cover; blank is not zero.');
  if (ks.some((k) => k.dealerIndicative)) ps.push('The Dealer App figures are indicative: the app was not live for the whole comparison period, or there are fewer than 10 orders.');
  return { intent, matched: true, title, paragraphs: ps, figures, records: [{ label: 'Orders behind these figures', to: growthLink(base(c, m), { show: 'orders' }) }], actions: [{ label: 'Open the comparison page', to: growthLink(base(c, m), { show: 'kpis' }) }], period: windows(m), scope: scopeOf(c, m) };
}

function profitAnswer(c: Ctx): Answer {
  const p = inspectProfitability(c.data);
  return {
    intent: 'profit',
    matched: true,
    title: p.verified ? 'Profitability data found' : 'Profitability is not verified',
    paragraphs: [p.statement, p.verified ? 'Check the fields found before relying on any margin.' : 'What the dashboard shows instead are proxies: order value, quantity, order frequency, average order value and selling price, fulfilment and rejection. A rise in sales value is never presented as a rise in profit.'],
    figures: p.verified ? p.found.slice(0, 6).map((f) => ({ label: f.kind, value: f.column, note: f.file })) : PROFIT_REQUIREMENTS.map((r) => ({ label: r.item, value: 'needed', note: r.suggested })),
    records: [],
    actions: [{ label: 'See the proxies and the data needed', to: growthLink({ rp: c.input.rp, cp: c.input.cp }, { show: 'profit' }) }],
    period: 'All imported files',
    scope: `${fInt(p.inspected.length)} files, ${fInt(p.columnsChecked)} columns inspected`,
  };
}

function complaintsAnswer(c: Ctx): Answer {
  const data = c.input.dealers.length ? scopeToDealer(c.data, c.input.dealers) : c.data;
  const part = (name: string, recs: typeof data.dealerComplaints, to: string) => {
    const k = complaintKpis(splitTestComplaints(filterComplaints(recs, c.period), c.settings.includeTestAccounts).kept, c.asOf);
    return { name, k, to };
  };
  const has = (s: string) => data.datasets.some((d) => d.source === s);
  const parts = [...(has('dealer_complaints') ? [part('Dealer App', data.dealerComplaints, '/dealer/complaints')] : []), ...(has('ds_complaints') ? [part('DataSense', data.dsComplaints, '/datasense/complaints')] : [])];
  if (!parts.length) return empty('complaints', 'No complaint data', 'No complaint export has been imported.', { label: 'Open Data Import', to: '/import' });
  const m = c.growth();
  const rate = m?.kpis.find((k) => k.id === 'complaint');
  const ps = parts.map((p) => `${p.name}: ${fInt(p.k.total)} complaints raised, ${fInt(p.k.backlog)} not closed, ${fInt(p.k.over30)} of those open for more than 30 days.`);
  if (rate && (rate.dealer !== null || rate.ds !== null)) ps.push(`Complaints per 100 orders in ${m?.reporting.label}: Dealer App ${rate.dealer === null ? '—' : rate.dealer.toFixed(1)}, DataSense ${rate.ds === null ? '—' : rate.ds.toFixed(1)}.`);
  ps.push('The Dealer App complaint export starts on 1 October; an earlier period is blank, not zero.');
  return {
    intent: 'complaints',
    matched: true,
    title: 'Complaints',
    paragraphs: ps,
    figures: parts.flatMap((p) => [
      { label: `${p.name}: raised`, value: fInt(p.k.total) },
      { label: `${p.name}: not closed`, value: fInt(p.k.backlog) },
      { label: `${p.name}: open over 30 days`, value: fInt(p.k.over30) },
    ]),
    records: parts.map((p) => ({ label: `${p.name} complaints`, to: pageLink(p.to, { kpi: ['backlog', 'Not yet closed'] }) })),
    actions: [],
    period: c.period.label,
    scope: c.input.dealers.length ? plural(c.input.dealers.length, 'selected dealer') : 'All dealers',
  };
}

function issuesAnswer(c: Ctx): Answer {
  if (!c.data.datasets.some((d) => d.source === 'issue_tracker')) return empty('issues', 'No issue tracker', 'The Issue Tracker has not been imported.', { label: 'Open Data Import', to: '/import' });
  const k = issueKpis(c.data.issues, c.asOf);
  return {
    intent: 'issues',
    matched: true,
    title: 'Issue Tracker',
    paragraphs: [`${fInt(k.open)} of ${fInt(k.total)} tracked issues are open; ${fInt(k.overdue)} are past a real target date and ${fInt(k.p1Open)} open issues are P1. Items without a usable target date are never counted as overdue (${fInt(k.targetUnknownOpen)} open items have none).`],
    figures: [
      { label: 'Tracked', value: fInt(k.total) },
      { label: 'Open', value: fInt(k.open) },
      { label: 'Overdue', value: fInt(k.overdue) },
      { label: 'P1 and open', value: fInt(k.p1Open) },
      { label: 'Resolution rate', value: pct1(k.resolutionRate) },
    ],
    records: [{ label: 'Overdue issues', to: pageLink('/issues', { kpi: ['overdue', 'Overdue'] }) }, { label: 'Open issues', to: pageLink('/issues', { kpi: ['open', 'Open'] }) }],
    actions: [],
    period: `As of ${fDate(c.asOf)} (the tracker is a point-in-time list)`,
    scope: 'All tracked issues (not recorded per dealer)',
  };
}

function bizomAnswer(c: Ctx): Answer {
  if (!c.data.datasets.some((d) => d.source === 'bizom_usage')) return empty('bizom', 'No Bizom data', 'Bizom usage has not been imported.', { label: 'Open Data Import', to: '/import' });
  const usage = splitTest(filterUsage(c.data.usage, c.period), c.settings.includeTestAccounts).kept;
  const k = usageKpis(usage, c.settings.lowUsageThreshold);
  const top = reportRanking(usage).slice(0, 3);
  return {
    intent: 'bizom',
    matched: true,
    title: 'Bizom SFA usage',
    paragraphs: [`${fInt(k.accesses)} recorded report accesses by ${fInt(k.users)} users across ${fInt(k.reports)} reports. The five most-used reports are ${k.top5Share === null ? '—' : `${(k.top5Share * 100).toFixed(0)}%`} of all accesses, and ${fInt(k.lowUsageReports)} reports were opened ${fInt(c.settings.lowUsageThreshold)} times or fewer. Accesses are views, not downloads, and Bizom usage is not recorded per dealer.`],
    figures: [{ label: 'Report accesses', value: fInt(k.accesses) }, { label: 'Active users', value: fInt(k.users) }, { label: 'Reports used', value: fInt(k.reports) }, ...top.map((r) => ({ label: r.reportName.replace(/\s+/g, ' '), value: `${fInt(r.accesses)} accesses`, note: `${fInt(r.users)} users` }))],
    records: [{ label: 'Bizom usage', to: '/bizom/usage' }],
    actions: [],
    period: c.period.label,
    scope: 'All Bizom users (test and service accounts left out unless included in settings)',
  };
}

function loyaltyAnswer(c: Ctx): Answer {
  const l = loyaltyOverview(c.data);
  if (!l) return empty('loyalty', 'No Hero Smiles data', 'No valid Hero Smiles snapshot has been imported.', { label: 'Open Data Import', to: '/import' });
  const ps = [`On ${fDate(l.latest.date)} dealers held ${fInt(l.latestTotals.current)} current points; ${fInt(l.latestTotals.positiveBalances)} dealers had a balance.`];
  if (l.points && l.previous) ps.push(`Against the snapshot of ${fDate(l.previous.date)} the total moved ${l.points.abs >= 0 ? '+' : '−'}${fInt(Math.abs(l.points.abs))}${l.points.pct !== null ? ` (${fPctS(l.points.pct, 1)})` : ''}. Each snapshot is a balance on one day; snapshots are never added together.`);
  return {
    intent: 'loyalty',
    matched: true,
    title: 'Hero Smiles points',
    paragraphs: ps,
    figures: [{ label: 'Current points, latest snapshot', value: fInt(l.latestTotals.current), note: fDate(l.latest.date) }, { label: 'Dealers with a balance', value: fInt(l.latestTotals.positiveBalances) }, ...l.top.slice(0, 3).map((t) => ({ label: t.label, value: fInt(t.value), note: 'current points' }))],
    records: l.top.slice(0, 3).map((t) => ({ label: t.label, to: dealerLink('/hero-smiles', t.key, 'loyalty') })),
    actions: [{ label: 'Open Hero Smiles', to: '/hero-smiles' }],
    period: `Snapshot of ${fDate(l.latest.date)}`,
    scope: 'All Hero Smiles members',
  };
}

function mbdAnswer(c: Ctx): Answer {
  const m = c.growth();
  if (!m) return NO_ORDERS('mbd');
  if (!m.mbd || m.mbd.cur === null) return { ...empty('mbd', 'Models billed per dealer', 'There is no Dealer App order in this period and these dealers, so MBD cannot be calculated.'), period: windows(m), scope: scopeOf(c, m) };
  const ps = [`Dealer App dealers were billed for ${m.mbd.cur.toFixed(1)} different models each on average in ${m.reporting.label}${m.mbd.prev !== null && m.comparison ? ` (${m.mbd.prev.toFixed(1)} in ${m.comparison.label})` : ''}, across ${fInt(m.mbd.models)} models and ${fInt(m.mbd.dealersCur)} billed dealers.`, 'MBD uses Dealer App orders only: DataSense orders carry no model, so it cannot be compared with the SFA channel. Billed means an invoice exists and the fulfilled quantity is above zero.'];
  return {
    intent: 'mbd',
    matched: true,
    title: 'Models billed per dealer (MBD)',
    paragraphs: ps,
    figures: [{ label: `MBD, ${m.reporting.label}`, value: m.mbd.cur.toFixed(1) }, ...(m.mbd.prev !== null ? [{ label: `MBD, ${m.comparison?.label}`, value: m.mbd.prev.toFixed(1) }] : []), { label: 'Models billed', value: fInt(m.mbd.models) }, { label: 'Dealers billed', value: fInt(m.mbd.dealersCur) }],
    records: [{ label: 'Models and dealers', to: pageLink('/dealer/orders', {}, { tab: 'models' }) }],
    actions: [{ label: 'See MBD on the comparison page', to: growthLink(base(c, m), { show: 'mbd' }) }],
    period: windows(m),
    scope: scopeOf(c, m),
  };
}

function coverageAnswer(c: Ctx): Answer {
  const bySource = new Map<string, { files: number; from: string | null; to: string | null; rows: number }>();
  for (const d of c.data.datasets) {
    const e = bySource.get(d.source) ?? { files: 0, from: null, to: null, rows: 0 };
    e.files++;
    e.rows += d.validCount;
    const lo = d.periodStart ?? d.snapshotDate ?? d.period;
    const hi = d.periodEnd ?? d.snapshotDate ?? d.period;
    if (lo && (!e.from || lo < e.from)) e.from = lo;
    if (hi && (!e.to || hi > e.to)) e.to = hi;
    bySource.set(d.source, e);
  }
  const m = c.growth();
  const NAMES: Record<string, string> = { dealer_orders: 'Dealer App orders', ds_orders: 'DataSense orders', dealer_complaints: 'Dealer App complaints', ds_complaints: 'DataSense complaints', bizom_usage: 'Bizom usage', issue_tracker: 'Issue Tracker', ds_employee_activity: 'DataSense employee activity', dealer_sfa_activity: 'Dealer SFA activity', loyalty_snapshot: 'Hero Smiles', focus_liquidation: 'Focus liquidation' };
  return {
    intent: 'coverage',
    matched: true,
    title: 'What data is loaded',
    paragraphs: [`${fInt(c.data.datasets.length)} files are imported in this browser${m ? `. Both order files are compared up to ${fDate(m.span.cutoff)}, the last day both reach` : ''}. Imported data stays in this browser's storage; nothing is uploaded.`],
    figures: [...bySource.entries()].map(([s, e]) => ({ label: NAMES[s] ?? s, value: `${fInt(e.rows)} rows`, note: `${e.from ? fDate(e.from) : '—'} to ${e.to ? fDate(e.to) : '—'} · ${plural(e.files, 'file')}` })),
    records: [],
    actions: [{ label: 'Open Data Import', to: '/import' }],
    period: 'All imported data',
    scope: 'All files',
  };
}

function briefAnswer(c: Ctx, part: 'summary' | 'risks' | 'actions'): Answer {
  const m = c.input.dealers.length ? buildGrowth(c.data, c.settings, { ...c.input, cohort: 'all' }) : c.growth();
  if (!m) return NO_ORDERS(part);
  const scoped = c.input.dealers.length > 0;
  const brief = executiveBrief({
    pilot: m,
    all: scoped ? null : c.network(),
    profit: inspectProfitability(c.data),
    service: buildServiceFacts({ data: scoped ? scopeToDealer(c.data, c.input.dealers) : c.data, settings: c.settings, period: c.period, asOf: c.asOf, scoped }),
  });
  const items = part === 'summary' ? brief.takeaways : part === 'risks' ? brief.risks.slice(0, 5) : [];
  return {
    intent: part,
    matched: true,
    title: part === 'summary' ? 'Management takeaways' : part === 'risks' ? 'Key risks' : 'Recommended actions',
    paragraphs: part === 'actions' ? ['In the order to do them. Each is drawn from a risk or finding in the data.'] : ['Each is a measurement for the periods shown; none says what caused it, and order value is sales, not profit.'],
    figures: part === 'actions' ? brief.actions.slice(0, 6).map((a) => ({ label: a.title, value: a.priority === 1 ? 'Do first' : a.priority === 2 ? 'Next' : 'Then', note: a.why })) : items.map((i) => ({ label: i.title, value: i.metric, note: i.detail })),
    records: part === 'actions' ? brief.actions.slice(0, 4).map((a) => ({ label: a.toLabel, to: a.to })) : items.slice(0, 4).map((i) => ({ label: i.toLabel, to: i.to })),
    actions: [{ label: 'Open the Executive Overview', to: '/overview' }],
    period: brief.period,
    scope: scopeOf(c, m),
  };
}

function dealerAnswer(c: Ctx, d: CatalogueDealer, how: Resolved['how']): Answer {
  const input: GrowthInput = { ...c.input, dealers: [d.key], dbs: [], outlets: [], cohort: 'all' };
  const m = buildGrowth(c.data, c.settings, input);
  const row = m?.rows.find((r) => r.key === d.key);
  const link = d.key.startsWith('name:') ? [] : [{ label: `${d.name}: profile`, to: dealerLink('/', d.key) }];
  if (!m || !row) {
    return { intent: 'dealer', matched: true, title: d.name, paragraphs: [`${d.name} has no eligible order in either period, so there is no growth to report.`], figures: [], records: link, actions: [], period: m ? windows(m) : '—', scope: d.name };
  }
  const meta = CLASS_META[row.cls];
  const st = adoptionStatusOf(row);
  const ps = [`${d.name} ordered ${money(row.cur.combinedValue)} through both channels in ${m.reporting.label}${row.prev ? `, ${row.changePct !== null ? fPctS(row.changePct, 0) : fInrD(row.changeValue ?? 0)} against ${m.comparison?.label} (${money(row.prev.combinedValue)})` : ''}. ${meta.label}${row.confidence === 'inconclusive' ? ' (inconclusive)' : ''}: ${row.evidence}`, `${st.label}. ${st.detail}`, ...(how === 'partial' ? [`I matched "${d.name}" from part of its name. If you meant another dealer, ask again with its ERP code.`] : [])];
  const figs: AnswerFigure[] = [
    { label: 'Combined order value', value: money(row.cur.combinedValue), note: row.prev ? `was ${money(row.prev.combinedValue)}` : undefined },
    { label: 'Dealer App', value: money(row.cur.dealerValue), note: `${plural(row.cur.dealerOrders, 'order')}${row.dealerShare !== null ? ` · ${(row.dealerShare * 100).toFixed(0)}% of value` : ''}` },
    { label: 'DataSense', value: money(row.cur.dsValue), note: `${plural(row.cur.dsOrders, 'order')}${row.dsShare !== null ? ` · ${(row.dsShare * 100).toFixed(0)}% of value` : ''}` },
    { label: 'Class', value: meta.short },
  ];
  if (row.mbd !== null) figs.push({ label: 'Models billed (Dealer App)', value: String(row.mbd) });
  const data = scopeToDealer(c.data, [d.key]);
  const cmp = (['dealerComplaints', 'dsComplaints'] as const).flatMap((k) => data[k]);
  if (cmp.length) {
    const k = complaintKpis(splitTestComplaints(cmp, c.settings.includeTestAccounts).kept, c.asOf);
    figs.push({ label: 'Complaints raised / not closed', value: `${fInt(k.total)} / ${fInt(k.backlog)}`, note: 'both channels, to date' });
  }
  const l = loyaltyOverview(c.data);
  const pts = l?.latest.rows.find((r) => r.entityKey === d.key)?.current ?? null;
  if (pts !== null && pts !== undefined) figs.push({ label: 'Hero Smiles points', value: fInt(pts), note: l ? `snapshot of ${fDate(l.latest.date)}` : undefined });
  return {
    intent: 'dealer',
    matched: true,
    title: d.name,
    paragraphs: ps,
    figures: figs,
    records: [...link, ...(d.key.startsWith('name:') ? [] : [{ label: 'Dealer App orders', to: pageLink('/dealer/orders', { dealer: [d.key, d.name] }) }, { label: 'DataSense orders', to: pageLink('/datasense/orders', { dealer: [d.key, d.name] }) }])],
    actions: [{ label: 'Open on the comparison page', to: growthLink(base(c, m), { 'f.dealer': d.key, 'l.dealer': d.name, cohort: 'all', show: 'dealers' }) }],
    period: windows(m),
    scope: d.name,
  };
}

function helpAnswer(): Answer {
  return {
    intent: 'help',
    matched: true,
    title: 'What I can answer',
    paragraphs: ['I answer from the data imported in this browser, for the periods and filters on screen, by fixed rules. I am not a generative AI model, I do not guess, and nothing leaves your computer. If I cannot match a question I say so.', 'Ask about: business growth, incremental and declining dealers, channel shifts, adoption, a dealer by name or ERP code, order value, order count, quantity, average order value and selling price, rejections, complaints, issues, Bizom usage, Hero Smiles, models billed per dealer, profitability, key risks and actions, or what data is loaded.'],
    figures: [],
    records: [],
    actions: [],
    period: '—',
    scope: '—',
    suggestions: EXAMPLE_QUESTIONS,
  };
}

/* --------------------------------- intents --------------------------------- */

interface Intent {
  id: string;
  patterns: Array<[RegExp, number]>;
  run: (c: Ctx) => Answer;
}

const INTENTS: Intent[] = [
  { id: 'help', patterns: [[/\b(help|what can you|what do you|how do i use|what questions|what can i ask)\b/, 8]], run: () => helpAnswer() },
  { id: 'profit', patterns: [[/\b(profit|profitab|margin|cogs|cost of goods|contribution|freight|incentive)/, 9]], run: profitAnswer },
  { id: 'summary', patterns: [[/\b(summary|summari[sz]e|overview|takeaway|management|brief|executive|in short|tl dr)\b/, 7]], run: (c) => briefAnswer(c, 'summary') },
  { id: 'risks', patterns: [[/\b(risk|risks|concern|concerns|worry|worries|red flag|watch out)\b/, 8]], run: (c) => briefAnswer(c, 'risks') },
  { id: 'actions', patterns: [[/\b(action|actions|recommend|recommendation|what should|next step|next steps|priorit)/, 8]], run: (c) => briefAnswer(c, 'actions') },
  { id: 'incremental', patterns: [[/\b(incremental|new business|real growth|genuine growth|truly new)/, 9], [/which dealers (grew|are growing|improved|increased)/, 8]], run: (c) => classAnswer(c, 'incremental') },
  { id: 'migration', patterns: [[/\b(migrat|channel shift|shifted|moved orders|moving orders|cannibali[sz]|switched)/, 9], [/\bmoved\b.*\b(channel|datasense|sfa|dealer app)/, 6]], run: (c) => classAnswer(c, 'migration') },
  { id: 'declining', patterns: [[/\b(declin|dropped|falling|losing|lost business|decreas)/, 8], [/which dealers (fell|are down|lost)/, 8]], run: (c) => classAnswer(c, 'declining') },
  { id: 'adoption', patterns: [[/\b(adoption|adopt|penetration|onboard|popular|uptake)/, 9], [/\b(using|use|uses|used)\b.*\b(dealer app|the app)\b/, 7], [/how many dealers.*(app|using)/, 8]], run: adoptionAnswer },
  { id: 'top', patterns: [[/\b(top|best|biggest|largest|highest|leading)\b.*\b(dealer|dealers|customer|customers)\b/, 9], [/\b(rank|ranking)\b/, 5]], run: topAnswer },
  { id: 'aov', patterns: [[/\b(average order|aov|order size|basket)\b/, 9], [/\b(asp|selling price|price per cycle)\b/, 9]], run: (c) => kpiAnswer(c, ['aov', 'asp'], 'Average order value and selling price', 'aov') },
  { id: 'rejection', patterns: [[/\b(reject|rejected|rejection|cancel)/, 9]], run: (c) => kpiAnswer(c, ['rejection'], 'Rejection rate', 'rejection') },
  { id: 'complaints', patterns: [[/\b(complaint|complaints|grievance|escalat|ticket|tickets)\b/, 9]], run: complaintsAnswer },
  { id: 'issues', patterns: [[/\b(issue|issues|overdue|p1|tracker)\b/, 8]], run: issuesAnswer },
  { id: 'bizom', patterns: [[/\b(bizom|report access|report usage|reports used|report use)\b/, 9]], run: bizomAnswer },
  { id: 'loyalty', patterns: [[/\b(hero smiles|loyalty|points|smiles)\b/, 9]], run: loyaltyAnswer },
  { id: 'mbd', patterns: [[/\b(mbd|models billed|model mix|models per dealer|which models)\b/, 9]], run: mbdAnswer },
  { id: 'value', patterns: [[/\b(order value|sales value|sales|revenue|turnover|how much)\b/, 5], [/\b(how many orders|order count|number of orders|orders)\b/, 4], [/\b(quantity|units|volume|how many cycles)\b/, 5]], run: (c) => kpiAnswer(c, ['value', 'orders', 'qty'], 'Order value, orders and quantity', 'value') },
  { id: 'coverage', patterns: [[/\b(what data|data covers|date range|last updated|up to date|which files|imported|cut ?off|how recent|coverage)\b/, 8]], run: coverageAnswer },
  { id: 'growth', patterns: [[/\b(grow|growth|growing|helping|helped|improv|business impact|working|success|benefit|performance)\b/, 6], [/\bdealer app\b.*\b(vs|versus|compared|against)\b/, 6], [/\b(is|has|does) the (new )?(dealer )?app\b/, 4]], run: growthAnswer },
];

/** Builds the context the engine needs; the heavy models are built only when an answer asks for them, once. */
export function createContext(base: AssistantContext): Omit<Ctx, 'q'> {
  let g: GrowthModel | null | undefined;
  let n: GrowthModel | null | undefined;
  return {
    ...base,
    growth: () => (g === undefined ? (g = buildGrowth(base.data, base.settings, base.input)) : g),
    network: () => (n === undefined ? (n = base.input.dealers.length ? null : buildGrowth(base.data, base.settings, { ...base.input, cohort: 'all' })) : n),
  };
}

/** Answers one question. Never throws for an unrecognised question; a calculation error is thrown to the caller to display. */
export function ask(question: string, base: AssistantContext): Answer {
  const q = norm(question);
  const c: Ctx = { ...createContext(base), q };
  if (!q) return helpAnswer();
  // a named dealer is the subject of the question unless it is about something that is not per dealer
  const r = resolveDealer(question, base.data);
  if (r.dealer) return dealerAnswer(c, r.dealer, r.how);
  if (r.candidates.length) {
    return { intent: 'dealer', matched: true, title: 'Which dealer?', paragraphs: ['More than one dealer fits that name. Pick one and ask again, or use its ERP code.'], figures: r.candidates.map((d) => ({ label: d.name, value: d.key.startsWith('name:') ? 'no ERP code' : d.key, note: [d.city, d.zone].filter(Boolean).join(' · ') || undefined })), records: r.candidates.filter((d) => !d.key.startsWith('name:')).map((d) => ({ label: d.name, to: dealerLink('/', d.key) })), actions: [], period: '—', scope: '—' };
  }
  let best: { i: Intent; score: number } | null = null;
  for (const i of INTENTS) {
    const score = i.patterns.reduce((s, [re, w]) => s + (re.test(q) ? w : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { i, score };
  }
  if (!best) {
    return { intent: 'none', matched: false, title: 'I could not match that', paragraphs: ['I answer a fixed set of questions about this data and I do not guess. I could not match yours to one of them, so I have not calculated anything. Try one of these, or ask for help.'], figures: [], records: [], actions: [], period: '—', scope: '—', suggestions: EXAMPLE_QUESTIONS };
  }
  return best.i.run(c);
}

export { CLASS_ORDER };
