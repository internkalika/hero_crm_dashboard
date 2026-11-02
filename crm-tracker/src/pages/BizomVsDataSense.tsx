import { Fragment, createElement, useEffect, useMemo, useRef, useState } from 'react';
import { BarsChart, ChartCard, DonutChart, GroupedBarsChart, GroupedColumnsChart, StackedBarsChart, TrendChart } from '@/components/charts';
import { useData } from '@/state/DataContext';
import { useDealerProfile } from '@/components/filters';
import { DataTable } from '@/components/DataTable';
import { PageHeader, InfoTip, Segmented } from '@/components/ui';
import { DataGate } from '@/components/States';
import { monthInPeriod } from '@/lib/metrics/period';
// Bizom SFA vs DataSense SFA usage: Bizom MIS report usage (accesses) against the DataSense Usage Report (orders recorded).
// The two measure different things (report accesses vs orders), so they are never added or divided by each other;
// they are compared on people, zones and months both cover.
import { Modal, Pick, Section, Seg, Tile, clk } from './Landing';
import { Row, useUsageView } from './UsageReport';
import { int, pct } from '@/lib/metrics/landing';

// The patch pages are written with plain createElement calls; props are checked at run time by the host components.
const h: (...a: any[]) => any = createElement;


const BIZ = '#0E8F9B';
const DSC = '#2a78d6';
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mlab = (m: string) => MN[+m.slice(5, 7) - 1];
const nm = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const ZONES = ['East', 'North', 'South', 'West'];
const zn = (z: string | null | undefined) => {
  const t = (z ?? '').trim().toLowerCase();
  const f = ZONES.find((x) => x.toLowerCase() === t);
  return f ?? 'Other';
};

function Body({ data, settings, ds }: { data: any; settings: any; ds: Row[] }) {
  const bz: any[] = useMemo(() => (data.usage as any[]).filter((r) => settings.includeTestAccounts || !(r.flags ?? []).includes('test_or_service_account')), [data.usage, settings.includeTestAccounts]);
  const months: string[] = useMemo(() => {
    const a = new Set(bz.map((r) => r.month));
    return [...new Set(ds.map((r) => r.month))].filter((m) => a.has(m)).sort();
  }, [bz, ds]);
  const [f, setF] = useState({ zones: [] as string[], kinds: [] as string[] });
  const [modal, setModal] = useState('');
  const kinds = useMemo(() => [...new Set<string>(bz.map((r) => r.accountKind))].sort(), [bz]);
  const { period } = useData();
  // both sources are monthly figures: a month is in view when it overlaps the reporting range
  const sel = useMemo(() => months.filter((m) => monthInPeriod(m, period)), [months, period]);
  const okZ = (z: string) => !f.zones.length || f.zones.includes(z);
  const bzF = (m: string[]) => bz.filter((r) => m.includes(r.month) && okZ(zn(r.zone)) && (!f.kinds.length || f.kinds.includes(r.accountKind)));
  const dsF = (m: string[]) => ds.filter((r) => m.includes(r.month) && okZ(zn(r.zone)));
  const stat = (m: string[]) => {
    const b = bzF(m);
    const d = dsF(m);
    const bu = new Map<string, any>();
    b.forEach((r) => { if (r.accessCount > 0) { const e = bu.get(r.userId) ?? { name: r.name, zone: zn(r.zone), designation: r.designation, kind: r.accountKind, acc: 0, reports: new Set<string>() }; e.acc += r.accessCount; e.reports.add(r.reportName || r.reportId); bu.set(r.userId, e); } });
    const de = new Map<string, any>();
    d.forEach((r) => { if (!r.emp) return; const e = de.get(r.emp) ?? { name: r.emp, zone: zn(r.zone), role: r.role, orders: 0, sfa: 0 }; e.orders++; if (r.source === 'SFA') e.sfa++; de.set(r.emp, e); });
    const acc = b.reduce((s, r) => s + r.accessCount, 0);
    const reports = new Set(b.filter((r) => r.accessCount > 0).map((r) => r.reportName || r.reportId)).size;
    const orders = d.length;
    const sfa = d.filter((r) => r.source === 'SFA').length;
    return { bu, de, acc, reports, orders, sfa, bUsers: bu.size, dEmps: de.size };
  };
  const tot = useMemo(() => stat(sel), [bz, ds, f, sel]);
  const byM = useMemo(() => months.map((m) => ({ m, ...stat([m]) })), [bz, ds, f]);
  // people in both systems (matched on the person's name)
  const dsByName = new Map<string, any>();
  tot.de.forEach((e: any) => dsByName.set(nm(e.name), e));
  const both: any[] = [];
  tot.bu.forEach((e: any) => { const d = dsByName.get(nm(e.name)); if (d && nm(e.name)) both.push({ name: e.name, designation: e.designation, bzone: e.zone, acc: e.acc, reports: e.reports.size, role: d.role, dzone: d.zone, orders: d.orders, sfa: d.sfa }); });
  const bothN = both.length;
  const bOnly = tot.bUsers - bothN;
  const dOnly = tot.dEmps - bothN;
  const zrows = [...ZONES, 'Other'].map((z) => {
    const bb = [...tot.bu.values()].filter((e: any) => e.zone === z).length;
    const dd = [...tot.de.values()].filter((e: any) => e.zone === z).length;
    return { key: z, label: z, bizom: bb, ds: dd };
  }).filter((r) => r.bizom + r.ds > 0);
  const mdata = (fn: (x: any) => number) => byM.map((x) => ({ key: x.m, label: mlab(x.m), v: fn(x) }));
  const people = byM.map((x) => ({ key: x.m, label: mlab(x.m), bizom: x.bUsers, ds: x.dEmps }));
  const per = (a: number, b: number) => (b > 0 ? (a / b).toFixed(1) : '—');
  const filtered = f.zones.length > 0 || f.kinds.length > 0;
  const kpi = (title: string, bv: any, dv: any, sub: string, open?: () => void) => h('div', { className: `lp-pair${open ? ' lp-click' : ''}`, ...clk(open, title) },
    open && h('span', { className: 'lp-open', 'aria-hidden': true }, '↗'),
    h('div', { className: 'lp-pair-h' }, h('span', null, title)),
    h('div', { className: 'lp-pair-v' },
      h('div', { style: { '--c': BIZ } }, h('small', null, 'Bizom SFA'), h('b', null, bv)),
      h('div', { style: { '--c': DSC } }, h('small', null, 'DataSense SFA'), h('b', null, dv))),
    h('div', { className: 'lp-pair-f' }, sub));
  const bothCols = [
    { id: 'name', header: 'Person', value: (r: any) => r.name, width: 190 }, { id: 'des', header: 'Bizom designation', value: (r: any) => r.designation, width: 140 }, { id: 'bz', header: 'Bizom zone', value: (r: any) => r.bzone },
    { id: 'acc', header: 'Bizom report accesses', value: (r: any) => r.acc, format: 'int' }, { id: 'rep', header: 'Bizom reports used', value: (r: any) => r.reports, format: 'int' },
    { id: 'role', header: 'DataSense punched by', value: (r: any) => r.role }, { id: 'dz', header: 'DataSense zone', value: (r: any) => r.dzone },
    { id: 'ord', header: 'DataSense orders', value: (r: any) => r.orders, format: 'int' }, { id: 'sfa', header: 'DataSense SFA orders', value: (r: any) => r.sfa, format: 'int' },
  ];
  const zm: any[] = [];
  [...ZONES, 'Other'].forEach((z) => months.forEach((m) => {
    const sv = (mm: string[]) => { const save = f.zones; return save; };
    void sv;
    const b = bz.filter((r) => r.month === m && zn(r.zone) === z && (!f.kinds.length || f.kinds.includes(r.accountKind)));
    const d = ds.filter((r) => r.month === m && zn(r.zone) === z);
    const bu = new Set(b.filter((r) => r.accessCount > 0).map((r) => r.userId)).size;
    const de = new Set(d.map((r) => r.emp).filter(Boolean)).size;
    if (bu + de + d.length > 0) zm.push({ key: `${z}${m}`, zone: z, month: mlab(m), bu, acc: b.reduce((s, r) => s + r.accessCount, 0), de, orders: d.length, sfa: d.filter((r) => r.source === 'SFA').length });
  }));
  const zcols = [
    { id: 'zone', header: 'Zone', value: (r: any) => r.zone }, { id: 'month', header: 'Month', value: (r: any) => r.month },
    { id: 'bu', header: 'Bizom active users', value: (r: any) => r.bu, format: 'int' }, { id: 'acc', header: 'Bizom report accesses', value: (r: any) => r.acc, format: 'int' },
    { id: 'de', header: 'DataSense active employees', value: (r: any) => r.de, format: 'int' }, { id: 'or', header: 'DataSense orders recorded', value: (r: any) => r.orders, format: 'int' }, { id: 'sf', header: 'DataSense SFA orders', value: (r: any) => r.sfa, format: 'int' },
  ];
  return h('div', { className: 'lp' },
    h(PageHeader, { title: 'Bizom SFA vs DataSense SFA Usage' }),
    h('div', { className: 'lp-scope' },
      h('span', { className: 'lp-chip red' }, `Months in both: ${months.map((m) => `${mlab(m)} ${m.slice(0, 4)}`).join(', ')}`),
      h('span', { className: 'lp-chip' }, 'Bizom SFA: MIS report usage (accesses)'),
      h('span', { className: 'lp-chip' }, 'DataSense SFA: Usage Report (orders recorded)')),
    sel.length === 0 && h('div', { className: 'lp-note' }, 'No month covered by both Bizom SFA and DataSense SFA falls inside the chosen date range, so there is nothing to compare. Widen the range or reset it.'),
    h('div', { className: 'lp-filters' },
      h(Pick, { label: 'Zone', all: 'All zones', value: f.zones, onChange: (x: string[]) => setF({ ...f, zones: x }), options: [...ZONES, 'Other'].map((z) => ({ value: z, label: z })) }),
      h(Pick, { label: 'Bizom account type', all: 'All account types', value: f.kinds, onChange: (x: string[]) => setF({ ...f, kinds: x }), options: kinds.map((k) => ({ value: k, label: k })) }),
      filtered && h('button', { type: 'button', className: 'lp-reset', onClick: () => setF({ zones: [], kinds: [] }) }, 'Reset filters')),
    h(Section, { id: 'bz-k', title: 'Side by side', sub: 'Report accesses and orders are different measures: they are shown next to each other, never added or divided.' },
      h('div', { className: 'lp-grid4' },
        kpi('Active people', int(tot.bUsers), int(tot.dEmps), 'Bizom: users with a report access · DataSense: employees who punched an order', () => setModal('zones')),
        kpi('Activity recorded', `${int(tot.acc)} accesses`, `${int(tot.orders)} orders`, 'Report accesses vs orders recorded (different units)'),
        kpi('Per active person', `${per(tot.acc, tot.bUsers)} accesses`, `${per(tot.orders, tot.dEmps)} orders`, 'Average per active user / employee'),
        kpi('Breadth', `${int(tot.reports)} reports`, `${pct(tot.orders ? tot.sfa / tot.orders : null, 0)} SFA`, 'Distinct Bizom reports used · share of DataSense orders punched on the SFA app', undefined),
        kpi('People in both systems', `${bothN} of ${tot.bUsers}`, `${bothN} of ${tot.dEmps}`, `Matched on name · ${bOnly} only in Bizom · ${dOnly} only in DataSense`, () => setModal('both')))),
    h(Section, { id: 'bz-c', title: 'Charts' },
      h('div', { className: 'lp-grid3' },
        h(ChartCard, { title: 'Active people by month', subtitle: 'Bizom users with an access vs DataSense employees with an order.', table: { columns: [{ header: 'Month' }, { header: 'Bizom SFA', format: 'int' }, { header: 'DataSense SFA', format: 'int' }], rows: people.map((p) => [p.label, p.bizom, p.ds]) } },
          h(GroupedColumnsChart, { data: people, series: [{ key: 'bizom', label: 'Bizom SFA', color: BIZ }, { key: 'ds', label: 'DataSense SFA', color: DSC }], format: 'int', height: 230 })),
        h('div', { className: 'lp-click', ...clk(() => setModal('zones'), 'Active people by zone') }, h('span', { className: 'lp-open', 'aria-hidden': true }, '↗'),
          h(ChartCard, { title: 'Active people by zone', subtitle: 'Distinct people in the selected months.', table: { columns: [{ header: 'Zone' }, { header: 'Bizom SFA', format: 'int' }, { header: 'DataSense SFA', format: 'int' }], rows: zrows.map((z) => [z.label, z.bizom, z.ds]) } },
            h(GroupedColumnsChart, { data: zrows, series: [{ key: 'bizom', label: 'Bizom SFA', color: BIZ }, { key: 'ds', label: 'DataSense SFA', color: DSC }], format: 'int', height: 230 }))),
        h('div', { className: 'lp-click', ...clk(() => setModal('both'), 'People in both systems') }, h('span', { className: 'lp-open', 'aria-hidden': true }, '↗'),
          h(ChartCard, { title: 'People in both systems', subtitle: 'Same name in Bizom and DataSense.' },
            h(DonutChart, { stack: true, height: 150, centerValue: String(bothN), centerLabel: 'in both', data: [{ key: 'b', label: 'In both', value: bothN, color: '#52514E' }, { key: 'z', label: 'Bizom only', value: bOnly, color: BIZ }, { key: 'd', label: 'DataSense only', value: dOnly, color: DSC }] })))),
      h('div', { className: 'lp-grid2', style: { marginTop: '1rem' } },
        h(ChartCard, { title: 'Bizom SFA: report accesses by month', subtitle: `Per active user: ${byM.map((x) => `${mlab(x.m)} ${per(x.acc, x.bUsers)}`).join(' · ')}`, table: { columns: [{ header: 'Month' }, { header: 'Accesses', format: 'int' }, { header: 'Reports used', format: 'int' }], rows: byM.map((x) => [mlab(x.m), x.acc, x.reports]) } },
          h(GroupedColumnsChart, { data: mdata((x) => x.acc).map((d) => ({ ...d, bizom: d.v })), series: [{ key: 'bizom', label: 'Report accesses', color: BIZ }], format: 'int', height: 230 })),
        h(ChartCard, { title: 'DataSense SFA: orders recorded by month', subtitle: `Per active employee: ${byM.map((x) => `${mlab(x.m)} ${per(x.orders, x.dEmps)}`).join(' · ')}`, table: { columns: [{ header: 'Month' }, { header: 'Orders', format: 'int' }, { header: 'SFA app', format: 'int' }], rows: byM.map((x) => [mlab(x.m), x.orders, x.sfa]) } },
          h(StackedBarsChart, { data: byM.map((x) => ({ key: x.m, label: mlab(x.m), sfa: x.sfa, sap: x.orders - x.sfa })), series: [{ key: 'sfa', label: 'SFA app', color: DSC }, { key: 'sap', label: 'Old App (SAP)', color: '#8b8a85' }], format: 'int', height: 230 })))),
    modal === 'both' && h(Modal, { title: 'People in both systems', onClose: () => setModal('') }, h(DataTable, { title: `${bothN} people active in both (follows the filters)`, rows: both, columns: bothCols, getRowId: (r: any) => r.name, exportName: 'bizom_vs_datasense_people_in_both', initialSort: { id: 'acc', desc: true }, pageSize: 15, searchPlaceholder: 'Search people…' })),
    modal === 'zones' && h(Modal, { title: 'By zone and month', onClose: () => setModal('') }, h(DataTable, { title: 'Bizom SFA vs DataSense SFA by zone and month', rows: zm, columns: zcols, getRowId: (r: any) => r.key, exportName: 'bizom_vs_datasense_zone_month', pageSize: 25, searchPlaceholder: 'Search…' })));
}

export function BizomVsDataSensePage() {
  const { data, settings } = useData();
  const usage = useUsageView();
  return h(DataGate, { need: ['bizom_usage', 'ds_usage'], what: 'the Bizom SFA vs DataSense SFA usage comparison' }, usage ? h(Body, { data, settings, ds: usage.rows }) : null);
}
