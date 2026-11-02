import { Fragment, createElement, useEffect, useMemo, useRef, useState } from 'react';
import { BarsChart, ChartCard, DonutChart, GroupedBarsChart, GroupedColumnsChart, StackedBarsChart, TrendChart } from '@/components/charts';
import { useData } from '@/state/DataContext';
import { useDealerProfile } from '@/components/filters';
import { DataTable } from '@/components/DataTable';
import { PageHeader, InfoTip, Segmented } from '@/components/ui';
import { DataGate } from '@/components/States';
import { USAGE_REPORT } from '@usageReport';
// DataSense SFA: Usage Report (App Usage Report, April-October). Orders recorded per platform, NOT report accesses.
import { Pick, Section, Seg, Tile } from './Landing';
import { inr, int, pct } from '@/lib/metrics/landing';

// The patch pages are written with plain createElement calls; props are checked at run time by the host components.
const h: (...a: any[]) => any = createElement;


const RED = '#C8202F', BLUE = '#2a78d6', GREY = '#8b8a85', TEAL = '#0E8F9B';
const REJ = new Set(['Rejected by ASM', 'Rejected by SAP', 'SAP Order Not Created']);
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mlab = (m: string) => `${MN[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

let cache: any = null;
export async function load() {
  if (cache) return cache;
  if (!USAGE_REPORT) throw new Error('No Usage Report is embedded in this build.');
  const bin = atob(USAGE_REPORT);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const txt = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  cache = JSON.parse(txt);
  return cache;
}

export interface Row { date: string; month: string; zone: string; asm: string; emp: string; role: string; dealer: string; platform: string; source: string; status: string; reason: string; items: number | null; total: number | null }

export function decodeRows(d: any): Row[] {
  return d.rows.map((a: any[]) => {
    const g = (c: string, i: number) => (i < 0 ? '' : d.dict[c][i]);
    return { date: a[0], month: a[0].slice(0, 7), zone: g('Zone', a[1]) || 'Not recorded', asm: g('ASM', a[2]), emp: g('Employee', a[3]), role: g('Punched By', a[4]) || 'Unknown', dealer: g('Dealer', a[5]), platform: g('Platform', a[6]), source: g('Source', a[7]), status: g('Status', a[8]), reason: g('Reject Reason', a[9]), items: a[10], total: a[11] } as Row;
  });
}

function K(rows: Row[]) {
  const sfa = rows.filter((r) => r.source === 'SFA');
  const rej = rows.filter((r) => REJ.has(r.status));
  const arc = rows.filter((r) => r.status === 'Archived');
  const sfaRej = sfa.filter((r) => REJ.has(r.status)).length;
  const sfaArc = sfa.filter((r) => r.status === 'Archived').length;
  return {
    total: rows.length, sfa: sfa.length, sap: rows.length - sfa.length, adoption: rows.length ? sfa.length / rows.length : null,
    rej: rej.length, arc: arc.length, net: rows.length - rej.length - arc.length, validSfa: sfa.length - sfaRej - sfaArc,
    sfaRej, sfaRejRate: sfa.length ? sfaRej / sfa.length : null, emps: new Set(rows.map((r) => r.emp).filter(Boolean)).size,
    value: rows.filter((r) => !REJ.has(r.status) && r.total !== null).reduce((s, r) => s + (r.total as number), 0),
    noValue: rows.filter((r) => r.total === null).length,
  };
}

function Body({ d }: { d: any }) {
  const rows: Row[] = useMemo(() => decodeRows(d), [d]);
  const months: string[] = useMemo(() => [...new Set<string>(rows.map((r) => r.month))].sort(), [rows]);
  const [f, setF] = useState({ month: 'all', zones: [] as string[], platforms: [] as string[], roles: [] as string[] });
  const sub = useMemo(() => rows.filter((r) => (f.month === 'all' || r.month === f.month) && (!f.zones.length || f.zones.includes(r.zone)) && (!f.platforms.length || f.platforms.includes(r.platform)) && (!f.roles.length || f.roles.includes(r.role))), [rows, f]);
  const k = K(sub);
  const kAll = K(rows);
  const opts = (key: keyof Row) => [...new Set<string>(rows.map((r) => String(r[key])))].sort().map((v) => ({ value: v, label: v }));
  const trendRows = rows.filter((r) => (!f.zones.length || f.zones.includes(r.zone)) && (!f.platforms.length || f.platforms.includes(r.platform)) && (!f.roles.length || f.roles.includes(r.role)));
  const plats = ['Mobile', 'Web', 'Old App'];
  const monthly = months.map((m) => { const rs = trendRows.filter((r) => r.month === m); const o: any = { key: m, label: mlab(m).slice(0, 3) }; plats.forEach((p) => (o[p] = rs.filter((r) => r.platform === p).length)); o.adoption = rs.length ? rs.filter((r) => r.source === 'SFA').length / rs.length : null; o.total = rs.length; return o; });
  const zones = [...new Set(sub.map((r) => r.zone))].sort().map((z) => { const rs = sub.filter((r) => r.zone === z); return { key: z, label: z, sfa: rs.filter((r) => r.source === 'SFA').length, sap: rs.filter((r) => r.source !== 'SFA').length }; });
  const statuses = Object.entries(sub.reduce((a: any, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})).sort((a: any, b: any) => b[1] - a[1]).map(([s, n]: any) => ({ key: s, label: s, value: n, color: REJ.has(s) ? RED : s === 'Archived' ? GREY : BLUE }));
  const emap = new Map<string, any>();
  for (const r of sub) { if (!r.emp) continue; const e = emap.get(r.emp) ?? { emp: r.emp, role: r.role, zone: r.zone, asm: r.asm, total: 0, sfa: 0, sap: 0, rej: 0, arc: 0, value: 0 }; e.total++; r.source === 'SFA' ? e.sfa++ : e.sap++; if (REJ.has(r.status)) e.rej++; else if (r.total !== null) e.value += r.total; if (r.status === 'Archived') e.arc++; emap.set(r.emp, e); }
  const emps = [...emap.values()];
  const topEmp = [...emps].sort((a, b) => b.sfa - a.sfa).slice(0, 12).map((e) => ({ key: e.emp, label: e.emp, value: e.sfa }));
  const reasons = Object.entries(sub.filter((r) => r.reason && r.reason !== '---').reduce((a: any, r) => { const x = r.reason.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60); a[x] = (a[x] ?? 0) + 1; return a; }, {})).sort((a: any, b: any) => b[1] - a[1]).slice(0, 10).map(([s, n]: any) => ({ key: s, label: s, value: n }));
  const ecols = [
    { id: 'emp', header: 'Employee', value: (e: any) => e.emp, width: 180 }, { id: 'role', header: 'Punched by', value: (e: any) => e.role, width: 90 },
    { id: 'zone', header: 'Zone', value: (e: any) => e.zone, width: 80 }, { id: 'asm', header: 'ASM', value: (e: any) => e.asm, width: 160 },
    { id: 'total', header: 'Orders recorded', value: (e: any) => e.total, format: 'int' }, { id: 'sfa', header: 'SFA app orders', value: (e: any) => e.sfa, format: 'int' },
    { id: 'sap', header: 'Old App (SAP) orders', value: (e: any) => e.sap, format: 'int' }, { id: 'ad', header: 'SFA share', value: (e: any) => (e.total ? e.sfa / e.total : null), format: 'pct' },
    { id: 'rej', header: 'Rejected / not created', value: (e: any) => e.rej, format: 'int' }, { id: 'arc', header: 'Archived', value: (e: any) => e.arc, format: 'int' }, { id: 'val', header: 'Recorded value (excl. rejected)', value: (e: any) => e.value, format: 'inr' },
  ];
  const rcols = [
    { id: 'zone', header: 'Zone', value: (e: any) => e.zone }, { id: 'name', header: 'ASM team / employee (as reported)', value: (e: any) => e.name, width: 230 }, { id: 'level', header: 'Level', value: (e: any) => e.level },
    { id: 'sfa', header: 'SFA orders', value: (e: any) => e.sfa, format: 'int' }, { id: 'sap', header: 'SAP orders', value: (e: any) => e.sap, format: 'int' }, { id: 'arc', header: 'Archived', value: (e: any) => e.archived, format: 'int' },
    { id: 'rej', header: 'Rejected', value: (e: any) => e.rejected, format: 'int' }, { id: 'val', header: 'Valid order value', value: (e: any) => e.value, format: 'inr' }, { id: 'ad', header: 'SFA adoption', value: (e: any) => e.adoption, format: 'pct' },
  ];
  const S = d.summary;
  const rec = [
    ['Total orders', S['Total orders'], kAll.total, 'int'], ['SFA app orders', S['SFA app orders'], kAll.sfa, 'int'], ['Manual SAP orders', S['Manual SAP orders'], kAll.sap, 'int'],
    ['SFA adoption %', S['SFA adoption %'], kAll.adoption, 'pct'], ['Net valid orders', S['Net valid orders'], kAll.net, 'int'], ['Valid SFA orders', S['Valid SFA orders'], kAll.validSfa, 'int'],
    ['Archived orders', S['Archived orders'], kAll.arc, 'int'], ['Rejected (ASM / SAP / not created)', S['Rejected orders (ASM / SAP / Not created)'], kAll.rej, 'int'],
    ['Rejection rate (SFA)', S['Rejection rate % (SFA)'], kAll.sfaRejRate, 'pct'],
  ];
  const fmt = (v: any, t: string) => (v === null || v === undefined ? '—' : t === 'pct' ? pct(v, 2) : int(v));
  const note = (i: number) => (i === 8 ? 'The file divides all rejections (incl. Old App) by SFA orders; this page uses SFA rejections ÷ SFA orders.' : Math.abs((rec[i][1] as number) - (rec[i][2] as number)) < 1e-6 ? 'Matches' : 'Differs');
  return h('div', { className: 'lp' },
    h(PageHeader, { title: 'DataSense SFA: Usage Report' }),
    h('div', { className: 'lp-scope' },
      h('span', { className: 'lp-chip red' }, 'April–October 2026'), h('span', { className: 'lp-chip' }, `Source: ${d.file}`), h('span', { className: 'lp-chip' }, `Generated ${d.meta['Generated on']}`),
      h('span', { className: 'lp-chip' }, 'Counts are orders recorded per platform, not report accesses, downloads or successful transactions')),
    h('div', { className: 'lp-filters' },
      h(Seg, { label: 'Month', value: f.month, onChange: (x: string) => setF({ ...f, month: x }), options: [{ value: 'all', label: 'All' }, ...months.map((m) => ({ value: m, label: mlab(m).slice(0, 3) }))] }),
      h(Pick, { label: 'Zone', all: 'All zones', value: f.zones, onChange: (x: string[]) => setF({ ...f, zones: x }), options: opts('zone') }),
      h(Pick, { label: 'Platform', all: 'All platforms', value: f.platforms, onChange: (x: string[]) => setF({ ...f, platforms: x }), options: opts('platform') }),
      h(Pick, { label: 'Punched by', all: 'All roles', value: f.roles, onChange: (x: string[]) => setF({ ...f, roles: x }), options: opts('role') }),
      (f.month !== 'all' || f.zones.length > 0 || f.platforms.length > 0 || f.roles.length > 0) && h('button', { type: 'button', className: 'lp-reset', onClick: () => setF({ month: 'all', zones: [], platforms: [], roles: [] }) }, 'Reset filters')),
    h(Section, { id: 'us-k', title: 'Usage summary', sub: f.month === 'all' ? 'April–October 2026' : mlab(f.month) },
      h('div', { className: 'lp-tiles4' },
        h(Tile, { l: 'Orders recorded', v: int(k.total), s: 'One row per order in the report' }),
        h(Tile, { l: 'SFA app orders', v: int(k.sfa), s: `${pct(k.adoption)} of orders · Mobile + Web` }),
        h(Tile, { l: 'Old App (manual SAP) orders', v: int(k.sap), s: `${pct(k.total ? k.sap / k.total : null)} of orders` }),
        h(Tile, { l: 'Active employees', v: int(k.emps), s: 'Distinct employees with at least one order' }),
        h(Tile, { l: 'Net valid orders', v: int(k.net), s: 'Not archived, not rejected' }),
        h(Tile, { l: 'Valid SFA orders', v: int(k.validSfa), s: `${pct(k.net ? k.validSfa / k.net : null)} of net valid orders` }),
        h(Tile, { l: 'SFA rejection rate', v: pct(k.sfaRejRate), s: `${int(k.sfaRej)} of ${int(k.sfa)} SFA orders (rejected by ASM / SAP or SAP order not created)`, tone: 'bad' }),
        h(Tile, { l: 'Orders without a value', v: int(k.noValue), s: 'The file gives no value for these (mostly archived); they are not treated as zero' }))),
    h(Section, { id: 'us-t', title: 'April–October trend', sub: 'Month filter does not apply here; zone, platform and role filters do.' },
      h('div', { className: 'lp-grid2' },
        h(ChartCard, { title: 'Orders by platform and month', table: { columns: [{ header: 'Month' }, ...plats.map((p) => ({ header: p, format: 'int' }))], rows: monthly.map((m: any) => [m.label, ...plats.map((p) => m[p])]) } },
          h(StackedBarsChart, { data: monthly, series: [{ key: 'Mobile', label: 'Mobile (SFA)', color: RED }, { key: 'Web', label: 'Web (SFA)', color: BLUE }, { key: 'Old App', label: 'Old App (SAP)', color: GREY }], format: 'int', height: 260 })),
        h(ChartCard, { title: 'SFA share of orders by month', subtitle: 'SFA (Mobile + Web) orders ÷ all orders recorded.', table: { columns: [{ header: 'Month' }, { header: 'SFA share', format: 'pct' }, { header: 'Orders', format: 'int' }], rows: monthly.map((m: any) => [m.label, m.adoption, m.total]) } },
          h(TrendChart, { data: monthly, series: [{ key: 'adoption', label: 'SFA share', color: TEAL }], format: 'pct', height: 260 })))),
    h(Section, { id: 'us-b', title: 'By zone, status and employee' },
      h('div', { className: 'lp-grid3' },
        h(ChartCard, { title: 'Orders by zone', table: { columns: [{ header: 'Zone' }, { header: 'SFA', format: 'int' }, { header: 'Old App', format: 'int' }], rows: zones.map((z: any) => [z.label, z.sfa, z.sap]) } },
          h(StackedBarsChart, { data: zones, series: [{ key: 'sfa', label: 'SFA app', color: RED }, { key: 'sap', label: 'Old App (SAP)', color: GREY }], format: 'int', layout: 'horizontal', height: 240 })),
        h(ChartCard, { title: 'Orders by status', table: { columns: [{ header: 'Status' }, { header: 'Orders', format: 'int' }], rows: statuses.map((s: any) => [s.label, s.value]) } }, h(BarsChart, { data: statuses, format: 'int', seriesName: 'Orders' })),
        h(ChartCard, { title: 'Top employees by SFA orders', table: { columns: [{ header: 'Employee' }, { header: 'SFA orders', format: 'int' }], rows: topEmp.map((s: any) => [s.label, s.value]) } }, h(BarsChart, { data: topEmp, format: 'int', color: RED, seriesName: 'SFA orders' }))),
      reasons.length > 0 && h('div', { style: { marginTop: '1rem' } }, h(ChartCard, { title: 'Most common rejection reasons', subtitle: 'Free text typed by approvers, lower-cased and trimmed; similar wordings are not merged.', table: { columns: [{ header: 'Reason' }, { header: 'Orders', format: 'int' }], rows: reasons.map((s: any) => [s.label, s.value]) } }, h(BarsChart, { data: reasons, format: 'int', seriesName: 'Orders' })))),
    h(Section, { id: 'us-e', title: 'Employees' }, h(DataTable, { title: 'Orders by employee (follows the filters)', rows: emps, columns: ecols, getRowId: (e: any) => e.emp, exportName: 'datasense_usage_by_employee', initialSort: { id: 'total', desc: true }, pageSize: 10, searchPlaceholder: 'Search employees…' })),
    h(Section, { id: 'us-r', title: 'Report as supplied', sub: 'The ASM-Employee-wise sheet exactly as reported (team totals and own-order rows overlap, so do not add them), and the Summary sheet reconciled with the order rows.' },
      h(DataTable, { title: 'ASM-Employee-wise (as reported)', rows: d.employees, columns: rcols, getRowId: (_e: any, i: number) => String(i), exportName: 'datasense_usage_asm_employee_wise', pageSize: 10, searchPlaceholder: 'Search…' }),
      h('div', { className: 'lp-card', style: { marginTop: '1rem', overflowX: 'auto' } }, h('table', { className: 'lp-mt' }, h('thead', null, h('tr', null, h('th', null, 'Summary sheet metric'), h('th', null, 'As reported'), h('th', null, 'Recomputed from the order rows'), h('th', null, 'Check'))),
        h('tbody', null, rec.map((r: any, i: number) => h('tr', { key: r[0] }, h('th', null, r[0]), h('td', null, fmt(r[1], r[3])), h('td', null, fmt(r[2], r[3])), h('td', null, note(i)))))),
        h('p', { className: 'lp-foot' }, '3 order numbers appear on two rows each with different dealers; every row is kept as its own order. Archived orders mostly carry no value in the file, so order value is a lower bound.'))));
}

export function UsagePage() {
  const [d, setD] = useState<any>(cache);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!d) load().then(setD).catch((e: any) => setErr(String(e?.message ?? e))); }, []);
  if (err) return h('div', { className: 'lp-note' }, `The usage data could not be read: ${err}`);
  if (!d) return h('div', { className: 'p-8' }, 'Loading usage report…');
  return h(Body, { d });
}
