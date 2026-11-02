import { Fragment, createElement, useEffect, useMemo, useRef, useState } from 'react';
import { BarsChart, ChartCard, DonutChart, GroupedBarsChart, GroupedColumnsChart, StackedBarsChart, TrendChart } from '@/components/charts';
import { useData } from '@/state/DataContext';
import { useDealerProfile } from '@/components/filters';
import { DataTable } from '@/components/DataTable';
import { PageHeader, InfoTip, Segmented } from '@/components/ui';
import { DataGate } from '@/components/States';
// Dealer App vs DataSense SFA: the landing page. All primitives (cards, charts, tables) come from the host app via __B().
import {
  Ctx, DealerRow, Filters, SIG, SigKey, T, View, agg, buildCtx, buildView, inr, inrFull, int, monthName, monthShort, pct, pctChange, sinr, sint, spct, takeaways,
} from '@/lib/metrics/landing';

// The patch pages are written with plain createElement calls; props are checked at run time by the host components.
const h: (...a: any[]) => any = createElement;


const RED = '#C8202F';
const BLUE = '#2a78d6';
const CH = { app: { label: 'Dealer App', color: RED }, ds: { label: 'DataSense SFA', color: BLUE } };

export const clk = (onOpen: (() => void) | undefined, label: string) => onOpen ? ({
  role: 'button', tabIndex: 0, 'aria-label': `${label}: open details`,
  onClick: (e: any) => { if (e.target.closest('button,a,input,select,label')) return; onOpen(); },
  onKeyDown: (e: any) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); },
}) : {};
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/* ------------------------------------------------------------------ small parts */

function Info({ title, lines }: { title: string; lines: { label: string; text: string }[] }) {
  return h('span', { onClick: (e: any) => e.stopPropagation(), onKeyDown: (e: any) => e.stopPropagation() }, h(InfoTip, { title, lines }));
}

export function Pill({ tone, children, title }: { tone: string; children: any; title?: string }) {
  return h('span', { className: `lp-pill lp-${tone}`, title }, children);
}

export function Section({ id, title, sub, children, right }: { id: string; title: string; sub?: string; children: any; right?: any }) {
  return h('section', { id, className: 'lp-sec', 'aria-label': title },
    h('div', { className: 'lp-sec-h' }, h('div', null, h('h2', null, title), sub && h('p', null, sub)), right),
    children);
}

export function Pick({ label, options, value, onChange, all }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; all: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<any>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: any) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const k = (e: any) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', f);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', f);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  const txt = value.length === 0 ? all : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : `${value.length} selected`;
  return h('div', { className: 'lp-pick', ref },
    h('span', { className: 'lp-lab' }, label),
    h('button', { type: 'button', className: `lp-btn${value.length ? ' on' : ''}`, onClick: () => setOpen(!open), 'aria-haspopup': 'listbox', 'aria-expanded': open }, txt, ' ▾'),
    open && h('div', { className: 'lp-pop', role: 'listbox' },
      h('button', { type: 'button', className: 'lp-clear', onClick: () => onChange([]) }, all),
      options.map((o) => h('label', { key: o.value, className: 'lp-opt' },
        h('input', { type: 'checkbox', checked: value.includes(o.value), onChange: () => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value]) }),
        h('span', null, o.label)))));
}

export function Seg({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return h('div', { className: 'lp-pick' },
    h('span', { className: 'lp-lab' }, label),
    h('div', { className: 'lp-seg', role: 'radiogroup', 'aria-label': label },
      options.map((o) => h('button', { key: o.value, type: 'button', role: 'radio', 'aria-checked': value === o.value, className: value === o.value ? 'on' : '', onClick: () => onChange(o.value) }, o.label))));
}

function DealerCell({ r }: { r: { key: string; name: string } }) {
  const { open } = useDealerProfile();
  return h('button', { type: 'button', className: 'lp-dl', onClick: (e: any) => { e.stopPropagation(); open(r.key); }, title: 'Open the dealer profile' },
    h('span', null, r.name), h('small', null, r.key));
}

export function Tile({ l, v, s, tone }: { l: string; v: any; s?: any; tone?: string }) {
  return h('div', { className: 'lp-tile' }, h('div', { className: 'l' }, l), h('div', { className: `v${tone ? ` t-${tone}` : ''}` }, v), s !== undefined && s !== null && h('div', { className: 's' }, s));
}

/* ------------------------------------------------------------------ section 3: KPI pairs */

function Pair({ title, a, d, fmt, kind = 'num', foot, show, info, dfmt, onOpen }: { title: string; a: number | null; d: number | null; fmt: (n: number | null) => string; kind?: 'num' | 'rate'; foot?: any; show: { app: boolean; ds: boolean }; info?: string; dfmt?: (n: number | null) => string; onOpen?: () => void }) {
  const both = show.app && show.ds && a !== null && d !== null;
  let diff: any = null;
  if (both) {
    if (kind === 'rate') {
      const pts = (a as number) - (d as number);
      diff = `${pts >= 0 ? '+' : '−'}${Math.abs(pts * 100).toFixed(1)} pts`;
    } else {
      const abs = (a as number) - (d as number);
      const p = pctChange(d, a);
      diff = `${fmtDiff(abs, dfmt ?? fmt)}${p === null ? ' · % n/a (DataSense is 0)' : ` · ${spct(p, 1)}`}`;
    }
  }
  return h('div', { className: 'lp-pair lp-click', ...clk(onOpen, title) },
    onOpen && h('span', { className: 'lp-open', 'aria-hidden': true }, '↗'),
    h('div', { className: 'lp-pair-h' }, h('span', null, title), info && h(Info, { title, lines: [{ label: 'Definition', text: info }] })),
    h('div', { className: 'lp-pair-v' },
      h('div', { className: show.app ? '' : 'off', style: { '--c': RED } }, h('small', null, 'Dealer App'), h('b', null, show.app ? fmt(a) : '—')),
      h('div', { className: show.ds ? '' : 'off', style: { '--c': BLUE } }, h('small', null, 'DataSense'), h('b', null, show.ds ? fmt(d) : '—'))),
    both && h('div', { className: 'lp-pbars' },
      h('i', { style: { width: `${barW(a as number, d as number)[0]}%`, background: RED } }),
      h('i', { style: { width: `${barW(a as number, d as number)[1]}%`, background: BLUE } })),
    h('div', { className: 'lp-pair-d' }, diff ? h(Fragment, null, h('span', null, kind === 'rate' ? 'App − DS' : 'App − DS'), ' ', diff) : h('span', { className: 'mut' }, show.app && show.ds ? 'Difference unavailable' : 'Select both channels to compare')),
    foot && h('div', { className: 'lp-pair-f' }, foot));
}
const fm1 = (n: number | null) => (n === null ? '—' : n.toFixed(1));
function barW(a: number, d: number): [number, number] {
  const m = Math.max(Math.abs(a), Math.abs(d), 1e-9);
  return [Math.max(2, (Math.abs(a) / m) * 100), Math.max(2, (Math.abs(d) / m) * 100)];
}
function fmtDiff(abs: number, fmt: (n: number | null) => string) {
  return `${abs < 0 ? '−' : '+'}${fmt(Math.abs(abs))}`;
}

function KpiGrid({ v, onOpen }: { v: View; onOpen: (k: string) => void }) {
  const { app, ds, show } = v;
  const sh = { app: show.app, ds: show.ds && v.dsAvailable };
  const N = v.dealerKeys.length;
  const compShare = app.valid + ds.valid > 0 ? app.valid / (app.valid + ds.valid) : null;
  const valShare = app.value + ds.value > 0 ? app.value / (app.value + ds.value) : null;
  const onBoth = v.rows.filter((r) => r.app.valid > 0 && r.ds.valid > 0).length;
  const onlyApp = v.rows.filter((r) => r.app.valid > 0 && r.ds.valid === 0).length;
  const onlyDs = v.rows.filter((r) => r.app.valid === 0 && r.ds.valid > 0).length;
  const none = v.rows.length - onBoth - onlyApp - onlyDs;
  const m1 = v.ctx.months[0];
  const m2 = v.ctx.months[v.ctx.months.length - 1];
  const chg = (f: (x: any) => number, ch: 'app' | 'ds') => {
    const src = ch === 'app' ? v.appM : v.dsM;
    return { from: f(src[m1]), to: f(src[m2]) };
  };
  const rowChg = (label: string, f: (x: any) => number, fmt: (n: number | null) => string) => {
    const A = chg(f, 'app');
    const D = chg(f, 'ds');
    const cell = (c: { from: number; to: number }, on: boolean) => (!on ? '—' : c.from <= 0 ? `${fmt(c.from)} → ${fmt(c.to)} · ${c.to > 0 ? 'new' : 'no baseline'}` : `${fmt(c.from)} → ${fmt(c.to)} · ${spct((c.to - c.from) / c.from)}`);
    return h('tr', { key: label }, h('th', null, label), h('td', null, cell(A, sh.app)), h('td', null, cell(D, sh.ds)));
  };
  const rank = [...v.rows].map((r) => ({ key: r.key, label: r.name, app: show.app ? r.app.value : 0, ds: show.ds && v.dsAvailable ? r.ds.value : 0 })).sort((a, b) => b.app + b.ds - (a.app + a.ds)).slice(0, 6);
  const series = [
    ...(show.app ? [{ key: 'app', label: 'Dealer App', color: RED }] : []),
    ...(show.ds && v.dsAvailable ? [{ key: 'ds', label: 'DataSense SFA', color: BLUE }] : []),
  ];
  return h('div', { className: 'lp-grid4' },
    h(Pair, { onOpen: () => onOpen('m:sub'), title: 'Submitted orders', a: app.sub, d: ds.sub, fmt: int, show: sh, info: 'Distinct orders of any status placed in the period. Dealer App: Order ID (SKU lines rolled up). DataSense: Order NO.' }),
    h(Pair, { onOpen: () => onOpen('m:valid'), title: 'Net valid orders', a: app.valid, d: ds.valid, fmt: int, show: sh, info: 'Submitted orders that are not rejected and have a value above zero.' }),
    h(Pair, { onOpen: () => onOpen('m:rej'), title: 'Rejected orders and rate', a: app.rej, d: ds.rej, fmt: int, show: sh, foot: sh.app || sh.ds ? `Rate: ${sh.app ? `App ${pct(app.rejRate)}` : ''}${sh.app && sh.ds ? ' · ' : ''}${sh.ds ? `DS ${pct(ds.rejRate)}` : ''}${sh.app && sh.ds && app.rejRate !== null && ds.rejRate !== null ? ` (${(app.rejRate - ds.rejRate) >= 0 ? '+' : '−'}${Math.abs((app.rejRate - ds.rejRate) * 100).toFixed(1)} pts)` : ''}` : null, info: 'Orders with a rejected status; rate = rejected ÷ submitted (lower is better). Rejected value is never counted in order value, quantity or AOV.' }),
    h(Pair, { onOpen: () => onOpen('m:value'), title: 'Total order value', a: app.value, d: ds.value, fmt: (n: number | null) => inr(n), show: sh, info: 'Value of valid orders. Dealer App: sum of line amounts. DataSense: “value of Order”. Sales value, not profit.' }),
    h(Pair, { onOpen: () => onOpen('m:qty'), title: 'Total quantity (cycles)', a: app.qty, d: ds.qty, fmt: int, show: sh, info: 'Cycles on valid orders. Spares are not counted.' }),
    h(Pair, { onOpen: () => onOpen('m:aov'), title: 'Average order value', a: app.aov, d: ds.aov, dfmt: (n: number | null) => inrFull(n), fmt: (n: number | null) => inr(n), show: sh, info: 'Order value ÷ valid orders.' }),
    h(Pair, { onOpen: () => onOpen('m:vpc'), title: 'Average value per cycle', a: app.vpc, d: ds.vpc, fmt: (n: number | null) => inrFull(n), show: sh, info: 'Cycles value ÷ cycles quantity on valid orders that carry a quantity. Both channels record a value and a quantity, so they are comparable; they may still differ in model mix.' }),
    h(Pair, { onOpen: () => onOpen('adoption'), title: 'Active dealers', a: app.active, d: ds.active, fmt: (n: number | null) => (n === null ? '—' : `${n} of ${N}`), dfmt: int, show: sh, info: 'Dealers with at least one valid order in the period.' }),
    h('div', { className: 'lp-pair lp-click', ...clk(() => onOpen('mbd'), 'Models billed per dealer') },
      h('span', { className: 'lp-open', 'aria-hidden': true }, '↗'),
      h('div', { className: 'lp-pair-h' }, h('span', null, 'Models billed per dealer (MBD)'), h(Info, { title: 'MBD', lines: [{ label: 'Definition', text: 'Distinct models billed (invoice exists, fulfilled quantity above zero) ÷ dealers with a valid order in the month. Dealer App only: DataSense orders carry no model.' }] })),
      h('div', { className: 'lp-pair-v' },
        h('div', { className: show.app ? '' : 'off', style: { '--c': RED } }, h('small', null, 'Dealer App'), h('b', { style: { fontSize: '1.02rem' } }, show.app ? (v.both ? `${fm1(v.mbd[m1].value)} → ${fm1(v.mbd[m2].value)}` : fm1(v.mbd[v.months[0]].value)) : '—')),
        h('div', { className: 'off', style: { '--c': BLUE } }, h('small', null, 'DataSense'), h('b', null, 'n/a'))),
      show.app && v.both && h('div', { className: 'lp-pbars' }, h('i', { style: { width: `${barW(v.mbd[m1].value ?? 0, v.mbd[m2].value ?? 0)[0]}%`, background: '#e9a3aa' } }), h('i', { style: { width: `${barW(v.mbd[m1].value ?? 0, v.mbd[m2].value ?? 0)[1]}%`, background: RED } })),
      h('div', { className: 'lp-pair-f' }, show.app ? `${monthShort(m1)} → ${monthShort(m2)} · ${v.mbd[m2].models} models billed in ${monthShort(m2)}` : 'Hidden by the Channel filter')),
    h('div', { className: 'lp-pair wide3 lp-click', ...clk(() => onOpen('adoption'), 'Dealer ranking') },
      h('span', { className: 'lp-open', 'aria-hidden': true }, '↗'),
      h('div', { className: 'lp-pair-h' }, h('span', null, 'Dealer ranking by valid order value')),
      series.length ? h(StackedBarsChart, { data: rank, series, format: 'inr', layout: 'horizontal', height: 220 }) : h('p', { className: 'mut' }, 'No channel selected.')));
}

/* ------------------------------------------------------------------ section 4: dealer table */

const SIGTONE: Record<string, string> = { good: 'good', warn: 'warn', bad: 'bad' };

function DealerTable({ v }: { v: View }) {
  const [sig, setSig] = useState<SigKey | ''>('');
  const m1 = v.ctx.months[0];
  const m2 = v.ctx.months[v.ctx.months.length - 1];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    v.rows.forEach((r) => r.signals.forEach((s) => (c[s] = (c[s] ?? 0) + 1)));
    return c;
  }, [v.rows]);
  const rows = sig ? v.rows.filter((r) => r.signals.includes(sig)) : v.rows;
  const dsOn = v.dsAvailable;
  const num = (id: string, header: string, value: (r: DealerRow) => number | null, format: string, width = 92) => ({ id, header, value, format, width });
  const mv = (r: DealerRow, ch: 'app' | 'ds', m: string) => (ch === 'app' ? r.appM[m].valid : dsOn ? r.dsM[m].valid : null);
  const cols = [
    { id: 'dealer', header: 'Dealer', value: (r: DealerRow) => r.name, render: (r: DealerRow) => h(DealerCell, { r }), width: 210 },
    { id: 'a_sub', header: 'App: submitted', value: (r: DealerRow) => r.app.sub, format: 'int', width: 92 },
    { id: 'a_valid', header: 'App: valid', value: (r: DealerRow) => r.app.valid, format: 'int', width: 80 },
    { id: 'a_rej', header: 'App: rejected', value: (r: DealerRow) => r.app.rej, format: 'int', width: 86 },
    { id: 'a_rr', header: 'App: rejection %', value: (r: DealerRow) => r.app.rejRate, format: 'pct', width: 100 },
    num('d_sub', 'DS: submitted', (r) => (dsOn ? r.ds.sub : null), 'int'),
    num('d_valid', 'DS: valid', (r) => (dsOn ? r.ds.valid : null), 'int', 80),
    num('d_rej', 'DS: rejected', (r) => (dsOn ? r.ds.rej : null), 'int', 86),
    num('d_rr', 'DS: rejection %', (r) => (dsOn ? r.ds.rejRate : null), 'pct', 100),
    num('a_val', 'App: order value', (r) => r.app.value, 'inr', 110),
    num('d_val', 'DS: order value', (r) => (dsOn ? r.ds.value : null), 'inr', 110),
    num('a_qty', 'App: quantity', (r) => r.app.qty, 'int'),
    num('d_qty', 'DS: quantity', (r) => (dsOn ? r.ds.qty : null), 'int'),
    num('a_aov', 'App: AOV', (r) => r.app.aov, 'inr', 100),
    num('d_aov', 'DS: AOV', (r) => (dsOn ? r.ds.aov : null), 'inr', 100),
    ...v.ctx.months.flatMap((m) => [
      num(`a_${m}`, `App valid · ${monthShort(m)}`, (r) => mv(r, 'app', m), 'int', 100),
      num(`d_${m}`, `DS valid · ${monthShort(m)}`, (r) => mv(r, 'ds', m), 'int', 100),
    ]),
    num('share', 'App share of valid orders', (r) => (dsOn ? r.appShare : null), 'pct', 120),
    { id: 'chg', header: `App change ${monthShort(m1)} → ${monthShort(m2)} (valid orders)`, value: (r: DealerRow) => r.appChange, render: (r: DealerRow) => (r.appChange === null ? '—' : `${sint(r.appChange)}${r.appChangePct === null ? (r.appM[m2].valid > 0 ? ' · new' : '') : ` · ${spct(r.appChangePct)}`}`), align: 'right', width: 150 },
    { id: 'top', header: 'Top model (app value)', value: (r: DealerRow) => r.topModel, width: 150 },
    { id: 'sig', header: 'Signals', value: (r: DealerRow) => r.signals.length, align: 'left', width: 330,
      render: (r: DealerRow) => (r.signals.length ? h('span', { className: 'lp-sigs' }, r.signals.map((s) => h(Pill, { key: s, tone: SIGTONE[SIG[s as SigKey].tone] }, SIG[s as SigKey].label))) : h('span', { className: 'mut' }, 'No signal')) },
  ];
  return h('div', null,
    h('div', { className: 'lp-chips' },
      h('button', { type: 'button', className: sig === '' ? 'on' : '', onClick: () => setSig('') }, `All dealers (${v.rows.length})`),
      (Object.keys(SIG) as SigKey[]).map((k) => h('button', { key: k, type: 'button', className: `${sig === k ? 'on ' : ''}${SIGTONE[SIG[k].tone]}`, disabled: !counts[k], onClick: () => setSig(sig === k ? '' : k) }, `${SIG[k].label} (${counts[k] ?? 0})`))),
    h(DataTable, { title: 'All dealers in view', rows, columns: cols, getRowId: (r: DealerRow) => r.key, exportName: 'dealer_app_vs_datasense_dealers', exportNotes: [`Period: ${v.periodLabel}`], initialSort: { id: 'a_val', desc: true }, pageSize: 25, stickyFirst: true, searchPlaceholder: 'Search dealers…', emptyText: 'No dealer matches this signal.' }),
    h('p', { className: 'lp-foot' }, `Signals: high app adoption = at least ${T.highAdoptMin} valid app orders and ${T.highAdoptShare * 100}% or more of the dealer’s valid orders; rising = valid app orders higher in ${monthShort(m2)} than ${monthShort(m1)} (2 or more); low/no = 1 or no valid app order; high rejection = ${T.rejRate * 100}% or more of at least ${T.rejMin} app submissions; mostly DataSense = more valid DataSense than app orders.`));
}

/* ------------------------------------------------------------------ section 5: trends */

function Trends({ v, onOpen }: { v: View; onOpen: (k: string) => void }) {
  const sh = { app: v.show.app, ds: v.show.ds && v.dsAvailable };
  const series = [...(sh.app ? [{ key: 'app', label: 'Dealer App', color: RED }] : []), ...(sh.ds ? [{ key: 'ds', label: 'DataSense SFA', color: BLUE }] : [])];
  const mk = (f: (a: any) => number | null) => v.trend.map((t) => ({ key: t.month, label: t.label, app: t.app ? f(t.app) : null, ds: t.ds ? f(t.ds) : null }));
  const caption = (f: (a: any) => number | null, rate = false) => {
    const m1 = v.ctx.months[0];
    const m2 = v.ctx.months[v.ctx.months.length - 1];
    const p1 = v.trend.find((t) => t.month === m1);
    const p2 = v.trend.find((t) => t.month === m2);
    if (!p1 || !p2 || m1 === m2) return null;
    const one = (ch: 'app' | 'ds') => {
      const a = p1[ch] ? f(p1[ch]) : null;
      const b = p2[ch] ? f(p2[ch]) : null;
      if (a === null || b === null) return 'n/a';
      if (rate) return `${b - a >= 0 ? '+' : '−'}${Math.abs((b - a) * 100).toFixed(1)} pts`;
      if (a <= 0) return b > 0 ? 'new' : '—';
      return spct((b - a) / a);
    };
    return h('p', { className: 'lp-cap' }, h('span', { className: 'mut' }, `${monthShort(m1)} → ${monthShort(m2)}: `), sh.app && h('span', { style: { color: RED } }, `Dealer App ${one('app')}`), sh.app && sh.ds && ' · ', sh.ds && h('span', { style: { color: BLUE } }, `DataSense ${one('ds')}`));
  };
  const chart = (id: string, title: string, sub: string, f: (a: any) => number | null, fmt: string, rate = false) => {
    const data = mk(f);
    return h('div', { className: 'lp-click', ...clk(() => onOpen(id), title) }, h('span', { className: 'lp-open', 'aria-hidden': true }, '↗'),
      h(ChartCard, { title, subtitle: sub, table: { columns: [{ header: 'Month' }, ...series.map((s) => ({ header: s.label, format: fmt }))], rows: data.map((d: any) => [d.label, ...series.map((s) => d[s.key])]) } },
        h(GroupedColumnsChart, { data, series, format: fmt, height: 190 }), caption(f, rate)));
  };
  return h('div', { className: 'lp-grid3' },
    chart('m:valid', 'Valid orders', 'Distinct valid orders by month.', (a) => a.valid, 'int'),
    chart('m:value', 'Order value', 'Value of valid orders by month.', (a) => a.value, 'inr'),
    chart('m:qty', 'Quantity (cycles)', 'Cycles on valid orders by month.', (a) => a.qty, 'int'),
    chart('m:aov', 'Average order value', 'Order value ÷ valid orders.', (a) => a.aov, 'inr'),
    chart('adoption', 'Active dealers', `Dealers with a valid order (of ${v.dealerKeys.length}).`, (a) => a.active, 'int'),
    chart('m:rejRate', 'Rejection rate', 'Rejected ÷ submitted orders. Lower is better.', (a) => a.rejRate, 'pct', true));
}

/* ------------------------------------------------------------------ section 6: products */

function Products({ v, part }: { v: View; part: 'visual' | 'tables' }) {
  const [mm, setMm] = useState('value');
  const [sm, setSm] = useState('qty');
  const m1 = v.ctx.months[0];
  const m2 = v.ctx.months[v.ctx.months.length - 1];
  const topModels = [...v.models].filter((m) => m.orders > 0).sort((a, b) => (b as any)[mm === 'orders' ? 'orders' : mm] - (a as any)[mm === 'orders' ? 'orders' : mm]).slice(0, 8).map((m) => ({ key: m.model, label: m.model, value: mm === 'orders' ? m.orders : mm === 'qty' ? m.qty : m.value }));
  const topSkus = [...v.skus].sort((a, b) => (b as any)[sm] - (a as any)[sm]).slice(0, 10).map((s) => ({ key: s.sku, label: s.sku, value: sm === 'qty' ? s.qty : s.value }));
  const dm = (x: any, m: string, k: string) => x.byMonth[m]?.[k] ?? 0;
  const mc = (id: string, header: string, value: (m: any) => any, format?: string, w = 96) => ({ id, header, value, format, width: w });
  const movement = (m: any, k: string) => (v.both ? dm(m, m2, k) - dm(m, m1, k) : null);
  const modelCols = [
    { id: 'model', header: 'Model (MBD)', value: (m: any) => m.model, width: 170 },
    mc('orders', 'App orders', (m) => m.orders, 'int', 90),
    mc('qty', 'Quantity', (m) => m.qty, 'int', 90),
    mc('value', 'Order value', (m) => m.value, 'inr', 110),
    mc('share', 'Share of app value', (m) => m.share, 'pct', 110),
    ...v.ctx.months.map((m) => mc(`q_${m}`, `Qty · ${monthShort(m)}`, (r) => dm(r, m, 'qty'), 'int', 90)),
    mc('mq', `Qty change ${monthShort(m1)}→${monthShort(m2)}`, (m) => movement(m, 'qty'), 'int', 120),
    mc('mv', `Value change`, (m) => movement(m, 'value'), 'inr', 110),
    mc('rej', 'Rejected orders', (m) => m.rejOrders, 'int', 100),
    mc('rejv', 'Rejected value', (m) => m.rejValue, 'inr', 100),
    mc('bq', 'Billed qty', (m) => m.billedQty, 'int', 90),
    mc('bd', 'Dealers billed', (m) => m.billedDealers, 'int', 100),
  ];
  const skuCols = [
    { id: 'sku', header: 'SKU', value: (s: any) => s.sku, width: 260 },
    { id: 'model', header: 'Model', value: (s: any) => s.model, width: 110 },
    mc('qty', 'Quantity', (s) => s.qty, 'int', 90),
    mc('value', 'Order value', (s) => s.value, 'inr', 110),
    mc('share', 'Share of app value', (s) => s.share, 'pct', 110),
    ...v.ctx.months.map((m) => mc(`q_${m}`, `Qty · ${monthShort(m)}`, (r) => r.byMonth[m]?.qty ?? 0, 'int', 90)),
    mc('mq', 'Qty change', (s) => (v.both ? (s.byMonth[m2]?.qty ?? 0) - (s.byMonth[m1]?.qty ?? 0) : null), 'int', 100),
  ];
  const mbdCards = v.ctx.months.filter((m) => v.months.includes(m));
  if (part === 'tables') return h('div', null,
    h(DataTable, { title: 'Models: Dealer App performance, movement, rejections and billing', rows: v.models, columns: modelCols, getRowId: (m: any) => m.model, exportName: 'dealer_app_models', initialSort: { id: 'value', desc: true }, pageSize: 10, searchPlaceholder: 'Search models…' }),
    h(DataTable, { title: 'SKUs: Dealer App quantity, value and movement', rows: v.skus, columns: skuCols, getRowId: (s: any) => s.sku, exportName: 'dealer_app_skus', initialSort: { id: 'value', desc: true }, pageSize: 10, searchPlaceholder: 'Search SKUs…' }));
  return h('div', null,
    h('p', { className: 'lp-cap mut', style: { textAlign: 'left', marginBottom: '.5rem' } }, 'Dealer App only: DataSense orders carry no model or SKU.'),
    h('div', { className: 'lp-grid2' },
      h(ChartCard, { title: 'Top models on the Dealer App', subtitle: 'Valid orders. Choose the ranking measure.', table: { columns: [{ header: 'Model' }, { header: mm === 'orders' ? 'Orders' : mm === 'qty' ? 'Quantity' : 'Value', format: mm === 'value' ? 'inr' : 'int' }], rows: topModels.map((m: any) => [m.label, m.value]) } },
        h('div', { className: 'lp-tabs' }, h(Segmented, { label: 'Rank models by', value: mm, onChange: setMm, options: [{ value: 'orders', label: 'Order count' }, { value: 'qty', label: 'Quantity' }, { value: 'value', label: 'Order value' }] })),
        h(BarsChart, { data: topModels, format: mm === 'value' ? 'inr' : 'int', color: RED, seriesName: mm })),
      h(ChartCard, { title: 'Top SKUs on the Dealer App', subtitle: 'Valid orders. Top 10.', table: { columns: [{ header: 'SKU' }, { header: sm === 'qty' ? 'Quantity' : 'Value', format: sm === 'qty' ? 'int' : 'inr' }], rows: topSkus.map((m: any) => [m.label, m.value]) } },
        h('div', { className: 'lp-tabs' }, h(Segmented, { label: 'Rank SKUs by', value: sm, onChange: setSm, options: [{ value: 'qty', label: 'Quantity' }, { value: 'value', label: 'Order value' }] })),
        h(BarsChart, { data: topSkus, format: sm === 'qty' ? 'int' : 'inr', color: RED, seriesName: sm }))),
    h(ChartCard, { title: 'MBD by dealer', subtitle: 'Distinct models billed per dealer, by month.', table: { columns: [{ header: 'Dealer' }, ...v.ctx.months.map((m) => ({ header: monthShort(m), format: 'int' }))], rows: v.rows.map((r) => [r.name, ...v.ctx.months.map((m) => v.mbdDealer[r.key][m])]) } },
      h(GroupedBarsChart, { data: v.rows.map((r) => ({ key: r.key, label: r.name, ...Object.fromEntries(v.ctx.months.map((m) => [m, v.mbdDealer[r.key][m]])) })), series: v.ctx.months.filter((m) => v.months.includes(m)).map((m, i) => ({ key: m, label: monthName(m), color: i === 0 ? '#e9a3aa' : RED })), format: 'int' }))
);
}

/* ------------------------------------------------------------------ definitions */

function Definitions({ v }: { v: View }) {
  const c = v.ctx;
  const m1 = c.months[0];
  const m2 = c.months[c.months.length - 1];
  const li = (a: string, b: string) => h('li', { key: a }, h('b', null, a + ': '), b);
  return h('div', { className: 'lp-def-b' },
      h('ul', null,
        li('Dealers', `The ${c.dealers.length} dealers that have Dealer App orders, matched to DataSense on the ERP dealer code (Dealer App Outlet ERP ID = the code in square brackets in the DataSense dealer name). Dealers that placed no order on a channel show 0, not a dash.`),
        li('Dates', `Both channels use the same dates: ${c.wins[m1].label} (the Dealer App launched on ${+c.launch.slice(8)} ${monthShort(m1)}, so earlier days are not compared) and ${c.wins[m2].label} (the last day the Dealer App export reaches). No Dealer App figure exists or is shown before the launch.`),
        li('Submitted orders', 'Distinct orders of any status: Dealer App by Order ID (SKU lines rolled up), DataSense by Order NO. Footer total rows and exact duplicates are removed on import.'),
        li('Rejected orders', 'Dealer App status “Rejected”; DataSense “Rejected by ASM” and “Rejected by SAP”. Rejection rate = rejected ÷ submitted.'),
        li('Net valid orders', 'Submitted orders that are not rejected and have a value above zero. DataSense “SAP Order Not Created” orders are counted as valid, as on the DataSense Orders page, and noted on the card.'),
        li('Order value', 'Valid orders only. Dealer App: sum of line amounts. DataSense: “value of Order”. This is sales value; the files contain no cost or margin data, so profit cannot be shown.'),
        li('Quantity and value per cycle', 'Cycles only (spares excluded). Value per cycle = cycles value ÷ cycles quantity on valid orders that carry a quantity.'),
        li('Active dealer / adoption', 'A dealer with at least one valid order on the channel in the period. A dealer whose app submissions were all rejected is not active.'),
        li('Models and SKUs', 'Dealer App only: Sku_Brand is the model (MBD) and Sku the SKU. DataSense orders have no model or SKU. Billed = an invoice exists and the fulfilled quantity is above zero; an order alone is never read as billed.'),
        li('MBD', 'Models billed per dealer = distinct billed models ÷ dealers with a valid order in the month.'),
        li('Channel migration', 'An observed pattern on order value: Dealer App value up, DataSense value down by 0.5–2 times as much, combined within ±10%. It is not proof of causation.'),
        li('Missing', 'DataSense has no model, SKU, fulfilled or billed quantity in the Order Punched Report. Dealer App complaints cover only 1–25 Oct. No cost data.')));
}


/* ------------------------------------------------------------------ visual key takeaways */

const GOOD = '#1b8a63';
const BAD = '#C8202F';
const FLAT = '#8b8a85';

function Spark({ a, b, color }: { a: number; b: number; color: string }) {
  const w = 84;
  const hh = 30;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const y = (n: number) => (hi === lo ? hh / 2 : hh - 4 - ((n - lo) / (hi - lo)) * (hh - 8));
  return h('svg', { width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, 'aria-hidden': true },
    h('path', { d: `M4 ${y(a)} L${w - 4} ${y(b)} L${w - 4} ${hh} L4 ${hh} Z`, fill: color, opacity: 0.12 }),
    h('path', { d: `M4 ${y(a)} L${w - 4} ${y(b)}`, stroke: color, strokeWidth: 2.2, fill: 'none', strokeLinecap: 'round' }),
    h('circle', { cx: 4, cy: y(a), r: 2.5, fill: '#fff', stroke: color, strokeWidth: 1.5 }),
    h('circle', { cx: w - 4, cy: y(b), r: 3.2, fill: color }));
}

function Movement({ v, onOpen }: { v: View; onOpen: (k: string) => void }) {
  const m1 = v.ctx.months[0];
  const m2 = v.ctx.months[v.ctx.months.length - 1];
  const sh = { app: v.show.app, ds: v.show.ds && v.dsAvailable };
  const defs: { id: string; l: string; f: (a: any) => number | null; fmt: (n: number | null) => string; low?: boolean; rate?: boolean }[] = [
    { id: 'm:valid', l: 'Valid orders', f: (a) => a.valid, fmt: int },
    { id: 'm:value', l: 'Order value', f: (a) => a.value, fmt: (n) => inr(n) },
    { id: 'm:qty', l: 'Quantity (cycles)', f: (a) => a.qty, fmt: int },
    { id: 'm:aov', l: 'Average order value', f: (a) => a.aov, fmt: (n) => inr(n) },
    { id: 'adoption', l: 'Active dealers', f: (a) => a.active, fmt: int },
    { id: 'm:rejRate', l: 'Rejection rate', f: (a) => a.rejRate, fmt: (n) => pct(n), low: true, rate: true },
  ];
  const line = (ch: 'app' | 'ds', d: (typeof defs)[0]) => {
    const src = ch === 'app' ? v.appM : v.dsM;
    const a = d.f(src[m1]);
    const b = d.f(src[m2]);
    const col = ch === 'app' ? RED : BLUE;
    if (a === null || b === null) return h('div', { key: ch, className: 'lp-tk-row' }, h('i', { style: { background: col } }), h('span', { className: 'n' }, CH[ch].label), h('span', { className: 'mut' }, 'n/a'));
    const up = b > a;
    const flat = d.rate ? Math.abs(b - a) < 0.0005 : a > 0 ? Math.abs((b - a) / a) < 0.005 : b === a;
    const ch$ = d.rate ? b - a : a > 0 ? (b - a) / a : null;
    const good = flat ? null : d.low ? !up : up;
    const tone = good === null ? FLAT : good ? GOOD : BAD;
    const txt = d.rate ? `${b - a >= 0 ? '+' : '−'}${Math.abs((b - a) * 100).toFixed(1)} pts` : ch$ === null ? (b > 0 ? 'new' : '—') : spct(ch$ as number);
    return h('div', { key: ch, className: 'lp-tk-row' }, h('i', { style: { background: col } }),
      h('div', { className: 'm' },
        h('div', { className: 'top' }, h('span', { className: 'n' }, CH[ch].label), h('span', { className: 'val' }, d.fmt(b))),
        h('div', { className: 'bot' }, h(Spark, { a, b, color: tone }), h('span', { className: 'chg', style: { color: tone } }, flat ? '■ flat' : `${up ? '▲' : '▼'} ${txt}`))));
  };
  if (!v.both) return h('div', { className: 'lp-note' }, 'Set Month to “Both” to see the September → October movement.');
  return h('div', { className: 'lp-grid3' }, defs.map((d) => h('div', { key: d.l, className: 'lp-tk lp-click', ...clk(() => onOpen(d.id), d.l) },
    h('span', { className: 'lp-open', 'aria-hidden': true }, '↗'),
    h('div', { className: 'lp-tk-h' }, d.l, h('small', null, `${monthShort(m1)} → ${monthShort(m2)}`)),
    sh.app && line('app', d), sh.ds && line('ds', d))));
}

/* ------------------------------------------------------------------ popups */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: any }) {
  useEffect(() => {
    const k = (e: any) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  return h('div', { className: 'lp-modal', onMouseDown: onClose },
    h('div', { className: 'lp-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': title, onMouseDown: (e: any) => e.stopPropagation() },
      h('header', null, h('h3', null, title), h('button', { type: 'button', onClick: onClose, 'aria-label': 'Close' }, '✕')),
      h('div', { className: 'lp-dialog-b' }, children)));
}

/* ------------------------------------------------------------------ page */


/* ------------------------------------------------------------------ popup contents */

const MEASURES: Record<string, { title: string; f: (a: any) => number | null; fk: 'int' | 'inr' | 'pct'; fmt: (n: number | null) => string; def: string; extra?: boolean }> = {
  sub: { title: 'Submitted orders', f: (a) => a.sub, fk: 'int', fmt: int, def: 'Distinct orders of any status placed in the period. Dealer App: Order ID (SKU lines rolled up). DataSense: Order NO.' },
  valid: { title: 'Net valid orders', f: (a) => a.valid, fk: 'int', fmt: int, def: 'Submitted orders that are not rejected and have a value above zero.' },
  rej: { title: 'Rejected orders and rate', f: (a) => a.rej, fk: 'int', fmt: int, extra: true, def: 'Orders with a rejected status (Dealer App: Rejected; DataSense: Rejected by ASM or SAP). Rate = rejected ÷ submitted. Rejected value is never counted in order value, quantity or AOV.' },
  rejRate: { title: 'Rejection rate', f: (a) => a.rejRate, fk: 'pct', fmt: (n) => pct(n), def: 'Rejected ÷ submitted orders. Lower is better.' },
  value: { title: 'Total order value', f: (a) => a.value, fk: 'inr', fmt: (n) => inr(n), def: 'Value of valid orders. Dealer App: sum of line amounts. DataSense: “value of Order”. Sales value, not profit.' },
  qty: { title: 'Total quantity (cycles)', f: (a) => a.qty, fk: 'int', fmt: int, def: 'Cycles on valid orders. Spares are not counted.' },
  aov: { title: 'Average order value', f: (a) => a.aov, fk: 'inr', fmt: (n) => inrFull(n), def: 'Order value ÷ valid orders.' },
  vpc: { title: 'Average value per cycle', f: (a) => a.vpc, fk: 'inr', fmt: (n) => inrFull(n), def: 'Cycles value ÷ cycles quantity on valid orders that carry a quantity.' },
};

function MeasurePopup({ v, id }: { v: View; id: string }) {
  const m = MEASURES[id];
  const sh = { app: v.show.app, ds: v.show.ds && v.dsAvailable };
  const series = [...(sh.app ? [{ key: 'app', label: 'Dealer App', color: RED }] : []), ...(sh.ds ? [{ key: 'ds', label: 'DataSense SFA', color: BLUE }] : [])];
  const data = v.months.map((mo) => ({ key: mo, label: `${monthShort(mo)} ${v.ctx.wins[mo].label.split(' ')[1]}`, app: m.f(v.appM[mo]), ds: m.f(v.dsM[mo]) }));
  const cols: any[] = [{ id: 'dealer', header: 'Dealer', value: (r: DealerRow) => r.name, render: (r: DealerRow) => h(DealerCell, { r }), width: 210 }];
  const add = (ch: 'app' | 'ds') => {
    if (!(ch === 'app' ? sh.app : sh.ds)) return;
    const L = ch === 'app' ? 'Dealer App' : 'DataSense';
    v.months.forEach((mo) => cols.push({ id: `${ch}${mo}`, header: `${L} · ${monthShort(mo)}`, value: (r: DealerRow) => m.f((ch === 'app' ? r.appM : r.dsM)[mo]), format: m.fk, width: 110 }));
    if (v.months.length > 1) cols.push({ id: `${ch}t`, header: `${L} · total`, value: (r: DealerRow) => m.f(ch === 'app' ? r.app : r.ds), format: m.fk, width: 110 });
    if (m.extra) cols.push({ id: `${ch}r`, header: `${L} · rejection %`, value: (r: DealerRow) => (ch === 'app' ? r.app : r.ds).rejRate, format: 'pct', width: 120 });
  };
  add('app');
  add('ds');
  const fcol = m.fk === 'pct' ? 'pct' : m.fk;
  return h('div', null,
    h('div', { className: 'lp-grid2' },
      h(ChartCard, { title: m.title, subtitle: m.def, table: { columns: [{ header: 'Month' }, ...series.map((x) => ({ header: x.label, format: fcol }))], rows: data.map((d: any) => [d.label, ...series.map((x) => d[x.key])]) } }, h(GroupedColumnsChart, { data, series, format: m.fk, height: 230 })),
      h(ChartCard, { title: 'By dealer', subtitle: 'Dealer App total for the dealers in view, ranked. DataSense is in the table below.' },
        h(BarsChart, { data: [...v.rows].map((r) => ({ key: r.key, label: r.name, value: m.f(r.app) ?? 0 })).sort((a, b) => b.value - a.value), format: m.fk, color: RED, seriesName: 'Dealer App' }))),
    h('div', { style: { marginTop: '1rem' } }, h(DataTable, { title: `${m.title} by dealer`, rows: v.rows, columns: cols, getRowId: (r: DealerRow) => r.key, exportName: `dealer_app_vs_datasense_${id}`, initialSort: { id: sh.app ? `app${v.months[v.months.length - 1]}` : 'dealer', desc: true }, pageSize: 25, stickyFirst: true, searchPlaceholder: 'Search dealers…' })));
}

function AdoptionPopup({ v }: { v: View }) {
  const N = v.rows.length;
  const onBoth = v.rows.filter((r) => r.app.valid > 0 && r.ds.valid > 0).length;
  const onlyApp = v.rows.filter((r) => r.app.valid > 0 && r.ds.valid === 0).length;
  const onlyDs = v.rows.filter((r) => r.app.valid === 0 && r.ds.valid > 0).length;
  const none = N - onBoth - onlyApp - onlyDs;
  const share = v.app.valid + v.ds.valid > 0 ? v.app.valid / (v.app.valid + v.ds.valid) : null;
  const vshare = v.app.value + v.ds.value > 0 ? v.app.value / (v.app.value + v.ds.value) : null;
  const m1 = v.ctx.months[0];
  const m2 = v.ctx.months[v.ctx.months.length - 1];
  return h('div', null,
    h('div', { className: 'lp-tiles4' },
      h(Tile, { l: 'Dealer App adoption', v: `${v.app.active} of ${N}`, s: `Dealers with a valid app order · ${v.app.submitters} submitted${v.both ? ` · ${monthShort(m1)} ${v.appM[m1].active}, ${monthShort(m2)} ${v.appM[m2].active} active` : ''}` }),
      h(Tile, { l: 'Dealer App share of comparable orders', v: v.dsAvailable ? pct(share, 1) : '—', s: v.dsAvailable ? `Value share ${pct(vshare, 1)} · ${int(v.app.valid)} app · ${int(v.ds.valid)} DataSense valid orders` : 'DataSense has no model' }),
      h(Tile, { l: 'Dealers by channel used', v: `${onBoth} both`, s: `${onlyApp} only on the app · ${onlyDs} only on DataSense · ${none} with neither` }),
      h(Tile, { l: 'Active dealers', v: `${v.app.active} app · ${v.dsAvailable ? v.ds.active : '—'} DataSense`, s: 'At least one valid order in the period. A dealer with only rejected submissions is not active.' })),
    h(DealerTable, { v }));
}

function MbdPopup({ v }: { v: View }) {
  const months = v.ctx.months.filter((m) => v.months.includes(m));
  return h('div', null,
    h('div', { className: 'lp-tiles3' },
      months.map((m) => h(Tile, { key: m, l: `MBD · ${monthName(m)}`, v: v.mbd[m].value === null ? '—' : v.mbd[m].value!.toFixed(1), s: `Models billed per dealer: ${v.mbd[m].dealers} dealers with a valid order, ${v.mbd[m].models} models billed` })),
      h(Tile, { l: 'Ordered vs billed', v: `${int(v.models.reduce((s, m) => s + m.qty, 0))} → ${int(v.models.reduce((s, m) => s + m.billedQty, 0))}`, s: 'Cycles ordered → cycles billed (invoice exists, fulfilled quantity above zero). An order alone is never read as billed.' }),
      h(Tile, { l: 'Rejected Dealer App orders', v: int(v.app.rej), s: v.appRejByModel.length ? `Models on rejected orders: most often ${v.appRejByModel[0].model} (${v.appRejByModel[0].orders} orders)` : 'No rejected Dealer App orders' })),
    h(Products, { v, part: 'tables' }));
}

/* ------------------------------------------------------------------ page */

const NAVS: [string, string][] = [['lp-kpis', 'Core comparison'], ['lp-trends', 'Trends'], ['lp-products', 'Models (MBD)']];

function Page({ data }: { data: any }) {
  const ctx = useMemo(() => buildCtx(data), [data.dealerLines, data.dsOrders]);
  const [f, setF] = useState<Filters>({ month: 'both', dealers: [], channel: 'both', models: [] });
  const [modal, setModal] = useState('');
  const view = useMemo(() => (ctx ? buildView(ctx, f) : null), [ctx, f]);
  if (!ctx || !view) return h('div', { className: 'lp-note' }, 'No Dealer App order data is loaded, so the 11-dealer comparison cannot be built. Import the Dealer App orders on the Data Import page.');
  const m1 = ctx.months[0];
  const m2 = ctx.months[ctx.months.length - 1];
  const filtered = f.month !== 'both' || f.dealers.length > 0 || f.channel !== 'both' || f.models.length > 0;
  const close = () => setModal('');
  const title = modal === 'adoption' ? 'Dealer adoption and comparison' : modal === 'mbd' ? 'Models billed per dealer (MBD), ordered vs billed, rejections' : modal === 'models' ? 'Model (MBD) and SKU data' : modal.startsWith('m:') ? MEASURES[modal.slice(2)].title : '';
  return h('div', { className: 'lp' },
    h(PageHeader, { title: 'Dealer App vs DataSense SFA' }),
    h('div', { className: 'lp-scope' },
      h('span', { className: 'lp-chip red' }, `${ctx.dealers.length} common dealers`)),
    h('div', { className: 'lp-filters', role: 'group', 'aria-label': 'Filters' },
      h(Seg, { label: 'Month', value: f.month, onChange: (x: any) => setF({ ...f, month: x }), options: [{ value: 'both', label: 'Both' }, ...ctx.months.map((m) => ({ value: m, label: monthName(m) }))] }),
      h(Pick, { label: 'Dealer', all: `All ${ctx.dealers.length} dealers`, value: f.dealers, onChange: (x: any) => setF({ ...f, dealers: x }), options: ctx.dealers.map((d) => ({ value: d.key, label: `${d.name} · ${d.key}` })) }),
      h(Seg, { label: 'Channel', value: f.channel, onChange: (x: any) => setF({ ...f, channel: x as any }), options: [{ value: 'both', label: 'Both' }, { value: 'app', label: 'Dealer App' }, { value: 'ds', label: 'DataSense' }] }),
      h(Pick, { label: 'Model (MBD)', all: 'All models', value: f.models, onChange: (x: any) => setF({ ...f, models: x }), options: ctx.models.map((m) => ({ value: m, label: m })) }),
      filtered && h('button', { type: 'button', className: 'lp-reset', onClick: () => setF({ month: 'both', dealers: [], channel: 'both', models: [] }) }, 'Reset filters')),
    h('nav', { className: 'lp-nav', 'aria-label': 'Sections' }, NAVS.map(([id, l]) => h('button', { key: id, type: 'button', onClick: () => jump(id) }, l))),
    h(Section, { id: 'lp-kpis', title: 'Core comparison', sub: `Dealer App vs DataSense SFA · ${view.periodLabel} · ${view.dealerKeys.length} dealers` }, h(KpiGrid, { v: view, onOpen: setModal })),
    h(Section, { id: 'lp-trends', title: 'Trends', sub: `DataSense SFA ${monthShort(view.trend[0].month)}–${monthShort(m2)} for these dealers · Dealer App from its ${monthName(m1)} launch · ${monthShort(m1)} = ${ctx.wins[m1].label.split(' ')[1]} ${monthShort(m1)}, ${monthShort(m2)} = ${ctx.wins[m2].label.split(' ')[1]} ${monthShort(m2)}, as in the comparison above` }, h(Trends, { v: view, onOpen: setModal })),
    h(Section, { id: 'lp-products', title: 'Models (MBD) and SKUs', right: h('button', { type: 'button', className: 'lp-link', onClick: () => setModal('models') }, 'Open model & SKU data ↗') }, h(Products, { v: view, part: 'visual' })),
    modal && h(Modal, { title, onClose: close },
      modal === 'adoption' ? h(AdoptionPopup, { v: view }) : modal === 'mbd' ? h(MbdPopup, { v: view }) : modal === 'models' ? h(Products, { v: view, part: 'tables' }) : modal.startsWith('m:') ? h(MeasurePopup, { v: view, id: modal.slice(2) }) : null));
}

export function LandingPage() {
  const { data } = useData();
  return h(DataGate, { any: ['dealer_orders', 'ds_orders'], what: 'the Dealer App vs DataSense SFA comparison' }, h(Page, { data }));
}
