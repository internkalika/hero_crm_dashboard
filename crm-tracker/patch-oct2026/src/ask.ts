// "Ask the data": tool calling against the dashboard's own calculations.
// Flow: question -> Vercel function (Groq) -> tool call -> runs HERE on the data in the browser -> result back -> answer.
// Safeguards: max 3 tool calls; every figure in the reply must appear in a tool result; "no data" is explicit;
// any failure falls back to the offline rule-based assistant (returns null).
import { Ctx, buildCtx, buildView, inr, inrFull, int, monthName, monthShort, pct, titleCase } from './model';
import { decodeRows, load } from './usage';

declare const __ASK_API: string;

export const NO_DATA = 'Currently no such data is present in the dashboard.';
const MAX_TOOLS = 3;
const REJ = new Set(['Rejected by ASM', 'Rejected by SAP', 'SAP Order Not Created']);

const apiUrl = (): string => {
  let o = '';
  try { o = localStorage.getItem('askApiUrl') || ''; } catch { /* ignore */ }
  const u = o || (typeof __ASK_API === 'string' ? __ASK_API : '');
  if (!u) return '';
  if (!/^https?:/i.test(u) && typeof location !== 'undefined' && location.protocol === 'file:') return '';
  return u;
};

/* ---------------------------------------------------------------- helpers */

const MN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function normMonth(m: any): string | 'both' | null {
  if (m === undefined || m === null || m === '' || /^(both|all)$/i.test(String(m))) return 'both';
  const s = String(m).trim().toLowerCase();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const i = MN.findIndex((x) => s.startsWith(x));
  return i >= 0 ? `2026-${String(i + 1).padStart(2, '0')}` : null;
}
const noData = (reason: string, extra: any = {}) => ({ status: 'no_data', reason, ...extra });
const money = (n: number | null) => (n === null || n === undefined ? null : { display: inr(n), full: inrFull(n) });

function dealerFrom(ctx: Ctx, text: any): { key: string; name: string } | null {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const byCode = ctx.dealers.find((d) => t.split(/\s+/).includes(d.key));
  if (byCode) return byCode;
  const hits = ctx.dealers.filter((d) => norm(d.name).includes(t) || t.includes(norm(d.name)));
  return hits.length === 1 ? hits[0] : null;
}

const aggOut = (a: any) => ({
  submitted: a.sub, valid: a.valid, rejected: a.rej, rejection_rate_display: pct(a.rejRate),
  order_value: money(a.value), quantity_cycles: a.qty, aov: money(a.aov), value_per_cycle: money(a.vpc), active_dealers: a.active,
});

/* ---------------------------------------------------------------- tools */

export async function runTool(name: string, args: any, ctx: { data: any; settings: any; asOf: string }): Promise<any> {
  const data = ctx.data;
  args = args && typeof args === 'object' ? args : {};
  const lc = buildCtx(data);
  switch (name) {
    case 'get_data_coverage': {
      const by = new Map<string, any>();
      for (const d of data.datasets ?? []) {
        const e = by.get(d.source) ?? { files: 0, rows: 0, from: null, to: null };
        e.files++; e.rows += d.validCount;
        const a = d.periodStart ?? d.snapshotDate ?? d.period; const b = d.periodEnd ?? d.snapshotDate ?? d.period;
        if (a && (!e.from || a < e.from)) e.from = a; if (b && (!e.to || b > e.to)) e.to = b;
        by.set(d.source, e);
      }
      return {
        status: 'ok', source: 'imported datasets',
        datasets: [...by.entries()].map(([k, v]) => ({ dataset: k, files: v.files, rows: v.rows, from: v.from, to: v.to })),
        also_loaded: 'DataSense Usage Report (App Usage Report), April-October 2026',
        not_available: ['Profit, cost, margin or discount data', 'Dealer App data before September 2026', 'DataSense model or SKU data', 'Billed/fulfilled quantity for DataSense orders', 'Dealer App complaints before 1 October 2026'],
        evidence: [{ label: 'Datasets loaded', value: String((data.datasets ?? []).length) }],
      };
    }
    case 'get_dealer_app_vs_datasense':
    case 'get_dealer_table': {
      if (!lc) return noData('No Dealer App order data is loaded.');
      const mm = normMonth(args.month);
      if (mm === null || (mm !== 'both' && !lc.months.includes(mm))) return noData(`The comparison covers only ${lc.months.map(monthName).join(' and ')} 2026.`);
      let dealers: string[] = [];
      let scope = `all ${lc.dealers.length} Dealer App dealers`;
      if (args.dealer) {
        const d = dealerFrom(lc, args.dealer);
        if (!d) return noData(`"${args.dealer}" is not one of the ${lc.dealers.length} Dealer App dealers: ${lc.dealers.map((x) => x.name).join(', ')}.`);
        dealers = [d.key]; scope = `${d.name} (${d.key})`;
      }
      const v = buildView(lc, { month: mm as any, dealers, channel: 'both', models: [] });
      const period = `${v.months.map((m) => lc.wins[m].label).join(' and ')} 2026 (same dates for both channels)`;
      if (name === 'get_dealer_app_vs_datasense') {
        return {
          status: 'ok', source: 'Dealer App orders + DataSense Order Punched Report', period, scope,
          dealer_app: aggOut(v.app), datasense: aggOut(v.ds),
          mbd_dealer_app: Object.fromEntries(v.months.map((m) => [monthName(m), v.mbd[m].value === null ? null : v.mbd[m].value!.toFixed(1)])),
          datasense_orders_counted_as_dealer_app: v.dsDupCount,
          notes: ['Valid = not rejected and value above zero. Order value is sales, not profit.', 'MBD exists only for the Dealer App.'],
          evidence: [
            { label: 'Dealer App valid orders', value: String(v.app.valid) }, { label: 'DataSense valid orders', value: String(v.ds.valid) },
            { label: 'Dealer App order value', value: inrFull(v.app.value) }, { label: 'DataSense order value', value: inrFull(v.ds.value) },
            { label: 'Dealer App rejection rate', value: pct(v.app.rejRate) }, { label: 'DataSense rejection rate', value: pct(v.ds.rejRate) },
          ],
        };
      }
      const key: Record<string, (r: any) => number> = { app_value: (r) => r.app.value, ds_value: (r) => r.ds.value, app_valid: (r) => r.app.valid, ds_valid: (r) => r.ds.valid };
      const f = key[args.sort_by] ?? key.app_value;
      const rows = [...v.rows].sort((a, b) => f(b) - f(a)).slice(0, Math.min(11, Math.max(1, +args.limit || 11)));
      return {
        status: 'ok', source: 'Dealer App orders + DataSense Order Punched Report', period, scope,
        dealers: rows.map((r) => ({ dealer: r.name, code: r.key, app_valid: r.app.valid, app_submitted: r.app.sub, app_rejected: r.app.rej, app_value: money(r.app.value), ds_valid: r.ds.valid, ds_value: money(r.ds.value), app_share_of_valid_orders: r.appShare === null ? null : pct(r.appShare, 0), signals: r.signals })),
        evidence: rows.slice(0, 5).map((r) => ({ label: `${r.name}: valid orders (app / DataSense)`, value: `${r.app.valid} / ${r.ds.valid}` })),
      };
    }
    case 'get_trends': {
      if (!lc) return noData('No Dealer App order data is loaded.');
      const metric = String(args.metric || '');
      const f: Record<string, [(a: any) => number | null, (n: number | null) => string]> = {
        valid_orders: [(a) => a.valid, int], order_value: [(a) => a.value, (n) => inrFull(n)], quantity: [(a) => a.qty, int],
        aov: [(a) => a.aov, (n) => inrFull(n)], active_dealers: [(a) => a.active, int], rejection_rate: [(a) => a.rejRate, (n) => pct(n)],
      };
      if (!f[metric]) return { status: 'error', message: `metric must be one of ${Object.keys(f).join(', ')}` };
      const v = buildView(lc, { month: 'both', dealers: [], channel: 'both', models: [] });
      const [g, fm] = f[metric];
      const pts = v.trend.map((t) => ({ month: monthShort(t.month), dealer_app: t.app ? fm(g(t.app)) : 'no Dealer App data (launched September)', datasense: t.ds ? fm(g(t.ds)) : null }));
      return {
        status: 'ok', source: 'DataSense Order Punched Report (Apr-Oct) and Dealer App orders (Sep-Oct)', scope: `the ${lc.dealers.length} Dealer App dealers`,
        period: `DataSense April-October; Dealer App from September (Sep ${lc.wins[lc.months[0]].label.split(' ')[1]}, Oct ${lc.wins[lc.months[lc.months.length - 1]].label.split(' ')[1]} use the same dates as the comparison)`,
        metric, by_month: pts, evidence: pts.filter((p) => p.datasense !== null).slice(-4).map((p) => ({ label: `${p.month} DataSense ${metric}`, value: String(p.datasense) })),
      };
    }
    case 'get_models': {
      if (!lc) return noData('No Dealer App order data is loaded.');
      const mm = normMonth(args.month);
      if (mm === null || (mm !== 'both' && !lc.months.includes(mm))) return noData('Model data covers only Sep and Oct 2026.');
      const v = buildView(lc, { month: mm as any, dealers: [], channel: 'both', models: [] });
      const lim = Math.min(10, Math.max(1, +args.limit || 5));
      const by = ({ value: 'value', qty: 'qty', orders: 'orders' } as any)[args.rank_by] ?? 'value';
      const list: any[] = (args.kind === 'sku' ? v.skus : v.models) as any[];
      const rows = [...list].sort((a, b) => (b[by] ?? 0) - (a[by] ?? 0)).slice(0, lim);
      return {
        status: 'ok', source: 'Dealer App orders (valid orders only)', period: v.months.map((m) => lc.wins[m].label).join(' and ') + ' 2026', scope: 'Dealer App only (DataSense orders have no model or SKU)',
        ranked_by: by, items: rows.map((r: any) => ({ name: r.model && !r.sku ? r.model : r.sku, orders: r.orders, quantity_cycles: r.qty, order_value: money(r.value), share_of_app_value: pct(r.share, 1) })),
        mbd: Object.fromEntries(v.months.map((m) => [monthName(m), v.mbd[m].value === null ? null : v.mbd[m].value!.toFixed(1)])),
        evidence: rows.slice(0, 5).map((r: any) => ({ label: r.model && !r.sku ? r.model : r.sku, value: `${inrFull(r.value)} · ${r.qty} cycles` })),
      };
    }
    case 'get_issues': {
      const all: any[] = data.issues ?? [];
      if (!all.length) return noData('The Issue Tracker is not loaded.');
      const asOf = ctx.asOf;
      const open = (i: any) => i.statusGroup !== 'resolved';
      const overdue = (i: any) => open(i) && !!i.targetDate && i.targetDate < asOf;
      let rows = all;
      if (args.platform) { const p = String(args.platform).toLowerCase(); rows = rows.filter((i) => (i.platform ?? '').toLowerCase().includes(p)); if (!rows.length) return noData(`No issues for platform "${args.platform}". Platforms: ${[...new Set(all.map((i) => i.platform))].join(', ')}.`); }
      if (args.status_group) rows = rows.filter((i) => (args.status_group === 'open' ? open(i) : i.statusGroup === args.status_group));
      if (args.priority) rows = rows.filter((i) => i.priority === args.priority);
      if (args.overdue_only) rows = rows.filter(overdue);
      const cnt = (f: (i: any) => string) => { const m = new Map<string, number>(); rows.forEach((i) => m.set(f(i), (m.get(f(i)) ?? 0) + 1)); return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1])); };
      const lim = Math.min(15, Math.max(1, +args.limit || 8));
      return {
        status: 'ok', source: 'Issue Tracker (Bizom_Hero_Tracker + DataSense issues)', period: `as of ${asOf}`, scope: args.platform ? String(args.platform) : 'all platforms',
        total: rows.length, open: rows.filter(open).length, resolved: rows.filter((i) => !open(i)).length, overdue: rows.filter(overdue).length,
        by_status: cnt((i) => i.status), by_platform: cnt((i) => i.platform ?? 'Not specified'), by_priority: cnt((i) => i.priority ?? 'None'),
        issues: rows.slice(0, lim).map((i) => ({ pointer: String(i.pointer).slice(0, 90), platform: i.platform, status: i.status, priority: i.priority, target: i.targetRaw })),
        note: 'Overdue = not resolved and a real target date before today; items without a usable date are never counted overdue.',
        evidence: [{ label: 'Issues in this view', value: String(rows.length) }, { label: 'Open', value: String(rows.filter(open).length) }, { label: 'Overdue', value: String(rows.filter(overdue).length) }],
      };
    }
    case 'get_usage_report':
    case 'get_bizom_vs_datasense': {
      const d = await load();
      const rows = decodeRows(d);
      const mm = normMonth(args.month);
      if (mm === null) return noData('Unrecognised month.');
      const months = [...new Set(rows.map((r) => r.month))].sort();
      if (mm !== 'both' && !months.includes(mm)) return noData(`The Usage Report covers ${months.map((m) => monthName(m)).join(', ')} 2026.`);
      const zones = ['East', 'North', 'South', 'West'];
      const z = args.zone ? zones.find((x) => x.toLowerCase() === String(args.zone).toLowerCase()) : null;
      if (args.zone && !z) return noData(`Zone must be one of ${zones.join(', ')}.`);
      const inZ = (zone: string) => !z || zone.toLowerCase() === z.toLowerCase();
      if (name === 'get_usage_report') {
        const sel = (mm === 'both' ? months : [mm]);
        const sub = rows.filter((r) => sel.includes(r.month) && inZ(r.zone));
        const sfa = sub.filter((r) => r.source === 'SFA');
        const rej = sub.filter((r) => REJ.has(r.status));
        const byM = sel.map((m) => { const x = sub.filter((r) => r.month === m); const s = x.filter((r) => r.source === 'SFA').length; return { month: monthShort(m), orders: x.length, sfa_orders: s, sfa_share: x.length ? pct(s / x.length) : null }; });
        return {
          status: 'ok', source: `Usage Report (${d.file})`, period: `${sel.map(monthName).join(', ')} 2026`, scope: z ? `${z} zone` : 'all zones',
          note: 'Counts are orders recorded by platform, not report accesses.',
          orders_recorded: sub.length, sfa_app_orders: sfa.length, old_app_sap_orders: sub.length - sfa.length, sfa_share: sub.length ? pct(sfa.length / sub.length) : null,
          active_employees: new Set(sub.map((r) => r.emp).filter(Boolean)).size, rejected_or_not_created: rej.length, sfa_rejection_rate: sfa.length ? pct(sfa.filter((r) => REJ.has(r.status)).length / sfa.length) : null, by_month: byM,
          evidence: [{ label: 'Orders recorded', value: int(sub.length) }, { label: 'SFA app orders', value: int(sfa.length) }, { label: 'SFA share', value: sub.length ? pct(sfa.length / sub.length) : '—' }],
        };
      }
      // Bizom vs DataSense
      const bz = (data.usage as any[]).filter((r) => ctx.settings?.includeTestAccounts || !(r.flags ?? []).includes('test_or_service_account'));
      const common = [...new Set(bz.map((r) => r.month))].filter((m) => months.includes(m)).sort();
      const sel = mm === 'both' ? common : [mm];
      if (mm !== 'both' && !common.includes(mm)) return noData(`Bizom usage and the Usage Report overlap only in ${common.map(monthName).join(', ')} 2026.`);
      const zn = (s: string) => zones.find((x) => x.toLowerCase() === (s ?? '').toLowerCase()) ?? 'Other';
      const b = bz.filter((r) => sel.includes(r.month) && inZ(zn(r.zone)));
      const s = rows.filter((r) => sel.includes(r.month) && inZ(zn(r.zone)));
      const bu = new Map<string, string>(); b.forEach((r) => r.accessCount > 0 && bu.set(r.userId, r.name));
      const de = new Set(s.map((r) => r.emp).filter(Boolean));
      const nm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
      const dn = new Set([...de].map(nm));
      const both = [...bu.values()].filter((n) => dn.has(nm(n))).length;
      return {
        status: 'ok', source: 'Bizom MIS report usage + DataSense Usage Report', period: `${sel.map(monthName).join(', ')} 2026 (months both cover)`, scope: z ? `${z} zone` : 'all zones',
        note: 'Report accesses (Bizom) and orders (DataSense) are different measures and are not added or divided.',
        bizom: { active_users: bu.size, report_accesses: b.reduce((t, r) => t + r.accessCount, 0) }, datasense: { active_employees: de.size, orders_recorded: s.length, sfa_orders: s.filter((r) => r.source === 'SFA').length },
        people_in_both_systems: both,
        evidence: [{ label: 'Bizom active users', value: String(bu.size) }, { label: 'DataSense active employees', value: String(de.size) }, { label: 'People in both', value: String(both) }],
      };
    }
    case 'get_datasense_orders': {
      const all: any[] = data.dsOrders ?? [];
      if (!all.length) return noData('DataSense orders are not loaded.');
      const mm = normMonth(args.month);
      if (mm === null) return noData('Unrecognised month.');
      const months = [...new Set(all.map((o) => o.month).filter(Boolean))].sort();
      if (mm !== 'both' && !months.includes(mm)) return noData(`DataSense orders cover ${months.map(monthName).join(', ')} 2026.`);
      const sel = mm === 'both' ? months : [mm];
      const valid = (o: any) => o.statusGroup !== 'rejected' && (o.value ?? 0) > 0;
      const stat = (os: any[]) => { const v = os.filter(valid); const val = v.reduce((t, o) => t + (o.value ?? 0), 0); return { submitted: os.length, valid: v.length, rejected: os.filter((o) => o.statusGroup === 'rejected').length, order_value: money(val), quantity_cycles: v.reduce((t, o) => t + (o.cyclesQty ?? 0), 0), aov: money(v.length ? val / v.length : null), active_dealers: new Set(v.map((o) => o.dealerKey ?? o.dealerName)).size }; };
      const subset = all.filter((o) => sel.includes(o.month));
      const top = Math.min(10, Math.max(0, args.top_dealers ?? 5));
      const dm = new Map<string, { name: string; v: number; n: number }>();
      subset.filter(valid).forEach((o) => { const k = o.dealerKey ?? o.dealerName; const e = dm.get(k) ?? { name: titleCase(o.dealerName), v: 0, n: 0 }; e.v += o.value; e.n++; dm.set(k, e); });
      return {
        status: 'ok', source: 'DataSense Order Punched Report', period: `${sel.map(monthName).join(', ')} 2026`, scope: 'all DataSense dealers',
        total: stat(subset), by_month: sel.map((m) => ({ month: monthShort(m), ...stat(all.filter((o) => o.month === m)) })),
        top_dealers_by_value: [...dm.values()].sort((a, b) => b.v - a.v).slice(0, top).map((e) => ({ dealer: e.name, valid_orders: e.n, order_value: money(e.v) })),
        evidence: [{ label: 'Valid orders', value: int(stat(subset).valid) }, { label: 'Order value', value: inrFull(subset.filter(valid).reduce((t, o) => t + (o.value ?? 0), 0)) }],
      };
    }
    case 'get_complaints': {
      const dsys = args.system === 'dealer_app';
      const all: any[] = (dsys ? data.dealerComplaints : data.dsComplaints) ?? [];
      if (!all.length) return noData(`${dsys ? 'Dealer App' : 'DataSense'} complaints are not loaded.`);
      const mm = normMonth(args.month);
      if (mm === null) return noData('Unrecognised month.');
      const rows = all.filter((c) => !(c.flags ?? []).includes('test_record') && (mm === 'both' || c.month === mm));
      if (!rows.length) return noData(`No ${dsys ? 'Dealer App' : 'DataSense'} complaints in ${monthName(String(mm))}. ${dsys ? 'Dealer App complaints exist only for 1-25 Oct 2026.' : ''}`);
      const cnt = (f: (c: any) => string) => { const m = new Map<string, number>(); rows.forEach((c) => m.set(f(c), (m.get(f(c)) ?? 0) + 1)); return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)); };
      const closed = rows.filter((c) => c.statusGroup === 'closed' || c.statusGroup === 'rejected').length;
      const dates = rows.map((c) => c.raisedDate).filter(Boolean).sort();
      return {
        status: 'ok', source: dsys ? 'Dealer App complaint dump' : 'DataSense complaint dump (YTD)', period: `${dates[0]} to ${dates[dates.length - 1]}`, scope: mm === 'both' ? 'all months in the file' : monthName(String(mm)),
        total: rows.length, closed_or_rejected: closed, not_closed: rows.length - closed, by_status: cnt((c) => c.rawStatus ?? c.statusGroup), top_categories: cnt((c) => c.category ?? 'Not specified'),
        evidence: [{ label: 'Complaints', value: int(rows.length) }, { label: 'Not closed', value: int(rows.length - closed) }],
      };
    }
    default:
      return { status: 'error', message: `unknown tool ${name}` };
  }
}

/* ---------------------------------------------------------------- guard: every figure must come from a tool result */

const numTokens = (s: string): string[] => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => t.replace(/,/g, ''));
export function unsupportedNumbers(text: string, results: any[]): string[] {
  const allowed = new Set<string>();
  const hay = JSON.stringify(results);
  numTokens(hay).forEach((t) => { allowed.add(t); if (t.includes('.')) allowed.add(String(parseFloat(t))); });
  const bad: string[] = [];
  for (const t of numTokens(text)) {
    if (t === '2026' || allowed.has(t) || allowed.has(String(parseFloat(t)))) continue;
    // lakh / crore forms of an allowed rupee figure
    const x = parseFloat(t);
    if ([...allowed].some((a) => { const y = parseFloat(a); return y > 0 && (Math.abs(x - y / 1e5) < 0.006 || Math.abs(x - y / 1e7) < 0.006 || Math.abs(x - Math.round(y)) < 0.51 && Math.abs(y) < 1e4); })) continue;
    bad.push(t);
  }
  return bad;
}

/* ---------------------------------------------------------------- Answer objects (same shape as the rule-based assistant) */

const mkAnswer = (title: string, paragraphs: string[], figures: any[] = [], period = '—', scope = '—') => ({
  intent: 'ai', matched: true, title, paragraphs, figures, records: [], actions: [], period, scope,
});
export const noDataAnswer = (reasons: string[] = []) => mkAnswer('No data for that', [NO_DATA, ...reasons.slice(0, 2)]);

/* ---------------------------------------------------------------- the loop */

export async function askAI(question: string, ctx: any): Promise<any | null> {
  const url = apiUrl();
  if (!url) return null;
  const messages: any[] = [{ role: 'user', content: question }];
  const results: any[] = [];
  let calls = 0;
  let final: string | null = null;
  const dbg: any = ((window as any).__askDebug = { question, calls: [], results: [] });
  for (let round = 0; round < MAX_TOOLS + 2; round++) {
    let r: Response;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 28000);
      r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }), signal: ac.signal });
      clearTimeout(timer);
    } catch { return null; }
    if (r.status === 429) return mkAnswer('The AI service is busy', ['The free AI quota is used up for the moment. Try again in a minute. (The offline assistant can still answer standard questions.)']);
    if (!r.ok) return null;
    let msg: any;
    try { msg = (await r.json()).message; } catch { return null; }
    if (!msg) return null;
    const tcs: any[] = msg.tool_calls ?? [];
    if (tcs.length) {
      if (calls >= MAX_TOOLS) break;
      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: tcs.slice(0, 1) });
      for (const tc of tcs.slice(0, 1)) {
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
        let res: any;
        try { res = await runTool(tc.function?.name, args, ctx); } catch (e: any) { res = { status: 'error', message: String(e?.message ?? e) }; }
        calls++;
        results.push(res);
        dbg.calls.push({ name: tc.function?.name, args }); dbg.results.push(res);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res).slice(0, 7000) });
      }
      continue;
    }
    final = (msg.content ?? '').trim();
    // one retry if the reply quotes figures that are not in the tool results
    const bad = final ? unsupportedNumbers(final, results) : [];
    if (final && bad.length && round < MAX_TOOLS + 1 && results.length) {
      messages.push({ role: 'assistant', content: final });
      messages.push({ role: 'user', content: `Your answer contains figures that are not in the tool results (${bad.slice(0, 4).join(', ')}). Rewrite it using only values exactly as they appear in the tool results, or reply: ${NO_DATA}` });
      final = null;
      continue;
    }
    if (bad.length) { final = null; }
    break;
  }
  const okRes = results.filter((x) => x && x.status === 'ok');
  if (!results.length) return noDataAnswer(['No dashboard calculation matches this question.']);
  if (!okRes.length) return noDataAnswer(results.map((x) => x.reason || x.message).filter(Boolean));
  if (!final) return noDataAnswer(['The reply could not be checked against the dashboard figures, so it was not shown.']);
  if (final.includes(NO_DATA)) return noDataAnswer([final.replace(NO_DATA, '').trim()].filter(Boolean));
  const figs = okRes.flatMap((x) => (x.evidence ?? []).map((e: any) => ({ label: e.label, value: e.value }))).slice(0, 10);
  const period = [...new Set(okRes.map((x) => x.period).filter(Boolean))].join(' · ') || '—';
  const scope = [...new Set(okRes.map((x) => x.scope).filter(Boolean))].join(' · ') || '—';
  return mkAnswer('Answer from the dashboard data', final.split(/\n+/).filter(Boolean), figs, period, `${scope} · source: ${[...new Set(okRes.map((x) => x.source))].join('; ')}`);
}
