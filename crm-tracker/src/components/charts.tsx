// Chart wrappers (Recharts). Rules applied everywhere: one value axis, thin rounded marks, recessive grid,
// legend whenever there are two or more series, tooltips on hover, text in ink tokens (never series colour),
// and a table view of the same data (ChartCard) so nothing depends on colour alone.
import { ReactNode, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { BarChart3, Table2 } from 'lucide-react';
import clsx from 'clsx';
import { ColFormat, formatCell, fCompact, fInrCompact } from '../lib/export/format';
import { InfoTip } from './ui';

/** A chart's highlighted marks: one key, several keys (a multi-select filter), or none. */
export type ActiveKey = string | string[] | null | undefined;
const isDimmed = (active: ActiveKey, key: string): boolean => {
  if (active === null || active === undefined) return false;
  return Array.isArray(active) ? active.length > 0 && !active.includes(key) : active !== '' && active !== key;
};

/** Validated categorical order (colour follows the entity, never the rank). */
export const PALETTE = ['#C8202F', '#2a78d6', '#0E8F9B', '#1baf7a', '#eda100', '#6250d6', '#e87ba4'];
export const NEUTRAL_BAR = '#2a78d6';
export const MUTED = '#c9c7c1';

export const SERIES_COLOR = {
  dealer: '#C8202F',
  ds: '#2a78d6',
  bizom: '#0E8F9B',
  sfa: '#1baf7a',
} as const;

/** Fixed colours for the complaint / order status entities so filters never repaint them. */
export const STATUS_COLOR: Record<string, string> = {
  Closed: '#1baf7a',
  Fulfilled: '#1baf7a',
  Resolved: '#1baf7a',
  Open: '#C8202F',
  Pending: '#eda100',
  'In process': '#2a78d6',
  Escalated: '#6250d6',
  Rejected: '#8b8a85',
  'Partially fulfilled': '#eda100',
  Billing: '#2a78d6',
  'Accepted (awaiting fulfilment)': '#6250d6',
  'In progress': '#2a78d6',
  Waiting: '#eda100',
  'Truck load / delivery': '#e87ba4',
  'Open / pending': '#C8202F',
  'SAP order not created': '#8b8a85',
  Other: '#8b8a85',
};
export const statusColor = (label: string, i = 0) => STATUS_COLOR[label] ?? PALETTE[i % PALETTE.length];

/** "₹28.00 L" -> "₹28 L", "₹4.50 L" -> "₹4.5 L": shorter axis ticks that never need to wrap. */
const trimZeros = (s: string) => s.replace(/(\.\d*?)0+(?=\s|$)/, '$1').replace(/\.(?=\s|$)/, '');
const axisFmt = (f: ColFormat) => (v: number) => (f === 'inr' ? trimZeros(fInrCompact(v)) : f === 'pct' ? `${Math.round(v * 100)}%` : trimZeros(fCompact(v)));
const yWidth = (f: ColFormat) => (f === 'inr' ? 64 : 52);

/** Value label drawn as plain SVG text so it never wraps inside a narrow bar. */
const valueLabel = (horizontal: boolean, f: ColFormat) =>
  function ValueLabel(p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string | null }) {
    if (p.value === null || p.value === undefined || p.value === '') return null;
    const x = Number(p.x), y = Number(p.y), w = Number(p.width), h = Number(p.height);
    const txt = formatCompactByFormat(Number(p.value), f);
    return horizontal ? (
      <text x={x + w + 4} y={y + h / 2} dy={4} fontSize={11} fill="#52514e">{txt}</text>
    ) : (
      <text x={x + w / 2} y={y - 4} fontSize={11} fill="#52514e" textAnchor="middle">{txt}</text>
    );
  };

function ChartTooltip({ active, payload, label, format, unit }: { active?: boolean; payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string; payload?: Record<string, unknown> }>; label?: string; format: ColFormat; unit?: string }) {
  if (!active || !payload?.length) return null;
  const title = (payload[0].payload?.label as string | undefined) ?? label;
  return (
    <div className="rounded-md border border-slate-200 bg-surface px-3 py-2 text-xs shadow-pop">
      {title && <div className="mb-1 font-semibold text-ink">{title}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-ink-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span>{p.name}</span>
          <span className="tnum ml-auto pl-3 font-medium text-ink">
            {formatCell(typeof p.value === 'number' ? p.value : null, format)}
            {unit ?? ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface ChartCardProps {
  title: string;
  /** how to read the chart; shown in the "?" popover next to the title, not on the card */
  subtitle?: ReactNode;
  info?: { formula: string; exclusions?: string };
  children: ReactNode;
  /** table fallback / alternative view */
  table?: { columns: Array<{ header: string; format?: ColFormat }>; rows: Array<Array<string | number | null>> };
  className?: string;
  /** a caveat about the data behind the chart; also shown in the "?" popover */
  note?: ReactNode;
}

export function ChartCard({ title, subtitle, info, children, table, className, note }: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  // Explanations stay available but out of the way: a "?" next to the title opens them.
  const lines = [...(subtitle ? [{ label: 'Reading it', text: subtitle }] : []), ...(info ? [{ label: 'Formula', text: info.formula }, ...(info.exclusions ? [{ label: 'Excludes', text: info.exclusions }] : [])] : []), ...(note ? [{ label: 'Note', text: note }] : [])];
  return (
    <section className={clsx('card flex flex-col p-4', className)} aria-label={title}>
      <header className="mb-2 flex items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          {title}
          {lines.length > 0 && <InfoTip title={title} lines={lines} />}
        </h3>
        {table && (
          <div className="inline-flex shrink-0 rounded-md border border-slate-300 bg-surface p-0.5" role="group" aria-label="View as chart or table">
            <button aria-pressed={view === 'chart'} aria-label="Chart view" onClick={() => setView('chart')} className={clsx('rounded p-1', view === 'chart' ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-slate-100')}>
              <BarChart3 size={14} />
            </button>
            <button aria-pressed={view === 'table'} aria-label="Table view" onClick={() => setView('table')} className={clsx('rounded p-1', view === 'table' ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-slate-100')}>
              <Table2 size={14} />
            </button>
          </div>
        )}
      </header>
      {view === 'chart' || !table ? (
        <div className="min-h-0 flex-1">{children}</div>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={i} className={clsx('border-b border-slate-200 px-2 py-1 font-semibold text-ink-2', i === 0 ? 'text-left' : 'text-right')}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri} className="border-b border-slate-100">
                  {r.map((v, i) => (
                    <td key={i} className={clsx('tnum px-2 py-1', i === 0 ? 'text-left' : 'text-right')}>
                      {formatCell(v, table.columns[i].format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export function BarsChart({
  data,
  layout = 'horizontal',
  format = 'int',
  onSelect,
  activeKey,
  color = NEUTRAL_BAR,
  height,
  seriesName = 'Value',
  labels = true,
}: {
  data: BarDatum[];
  layout?: 'horizontal' | 'vertical';
  format?: ColFormat;
  onSelect?: (key: string, label: string) => void;
  activeKey?: ActiveKey;
  color?: string;
  height?: number;
  seriesName?: string;
  labels?: boolean;
}) {
  if (!data.length) return <EmptyChart />;
  const horizontal = layout === 'horizontal';
  const h = height ?? (horizontal ? Math.max(160, data.length * 28 + 24) : 260);
  const catWidth = horizontal ? Math.min(190, Math.max(70, Math.max(...data.map((d) => d.label.length)) * 6.9)) : 0;
  const dim = (d: BarDatum) => (isDimmed(activeKey, d.key) ? 0.3 : 1);
  return (
    <div style={{ height: h }} role="img" aria-label={`${seriesName} bar chart with ${data.length} bars`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: horizontal ? 8 : 20, right: labels && horizontal ? 64 : 12, bottom: 4, left: 4 }} barCategoryGap={horizontal ? '28%' : '22%'}>
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={axisFmt(format)} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={catWidth} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={0} tickFormatter={(v: string) => (v.length > 30 ? v.slice(0, 29) + '…' : v)} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={{ stroke: '#c9c7c1' }} tickLine={false} interval={0} tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + '…' : v)} />
              <YAxis tickFormatter={axisFmt(format)} axisLine={false} tickLine={false} width={yWidth(format)} />
            </>
          )}
          <Tooltip cursor={{ fill: 'rgba(41,41,41,0.05)' }} content={<ChartTooltip format={format} />} />
          <Bar dataKey="value" name={seriesName} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={22} cursor={onSelect ? 'pointer' : undefined} onClick={onSelect ? (d: unknown) => { const p = (d as { payload?: BarDatum }).payload ?? (d as BarDatum); onSelect(p.key, p.label); } : undefined} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.color ?? color} fillOpacity={dim(d)} />
            ))}
            {labels && data.length <= 16 && <LabelList dataKey="value" content={valueLabel(horizontal, format) as never} />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatCompactByFormat(v: number, f: ColFormat): string {
  if (f === 'inr') return fInrCompact(v);
  if (f === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (f === 'dec') return v.toFixed(2);
  return fCompact(v);
}

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

export function StackedBarsChart({
  data,
  series,
  format = 'int',
  height = 280,
  onSelect,
  activeKey,
  layout = 'vertical',
}: {
  /** one row per category (x); numeric columns per series key; `label` is the x label, `key` the filter value */
  data: Array<Record<string, string | number>>;
  series: StackSeries[];
  format?: ColFormat;
  height?: number;
  onSelect?: (seriesKey: string, categoryKey: string, categoryLabel: string) => void;
  activeKey?: ActiveKey;
  layout?: 'vertical' | 'horizontal';
}) {
  if (!data.length) return <EmptyChart />;
  const horizontal = layout === 'horizontal';
  const catWidth = horizontal ? Math.min(180, Math.max(70, Math.max(...data.map((d) => String(d.label).length)) * 6.9)) : 0;
  const h = horizontal ? Math.max(height, data.length * 30 + 60) : height;
  return (
    <div style={{ height: h }} role="img" aria-label={`Stacked bar chart of ${series.map((s) => s.label).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap="24%">
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={axisFmt(format)} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={catWidth} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={{ stroke: '#c9c7c1' }} tickLine={false} interval={0} />
              <YAxis tickFormatter={axisFmt(format)} axisLine={false} tickLine={false} width={yWidth(format)} />
            </>
          )}
          <Tooltip cursor={{ fill: 'rgba(41,41,41,0.05)' }} content={<ChartTooltip format={format} />} />
          <Legend verticalAlign="top" align="left" iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: '#52514e', paddingBottom: 6 }} />
          {series.map((s, si) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} stroke="#fff" strokeWidth={2} maxBarSize={30} radius={si === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0} cursor={onSelect ? 'pointer' : undefined} isAnimationActive={false} onClick={onSelect ? (d: unknown) => { const p = (d as { payload?: Record<string, string> }).payload ?? (d as Record<string, string>); onSelect(s.key, String(p.key), String(p.label)); } : undefined}>
              {data.map((d, i) => (
                <Cell key={i} fillOpacity={isDimmed(activeKey, s.key) ? 0.35 : 1} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({
  data,
  series,
  format = 'int',
  height = 260,
  onSelect,
}: {
  data: Array<Record<string, string | number | null>>;
  series: StackSeries[];
  format?: ColFormat;
  height?: number;
  onSelect?: (key: string, label: string) => void;
}) {
  if (!data.length) return <EmptyChart />;
  return (
    <div style={{ height }} role="img" aria-label={`Line chart of ${series.map((s) => s.label).join(', ')} by period`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} onClick={onSelect ? (e: unknown) => { const p = (e as { activePayload?: Array<{ payload: Record<string, string> }> } | null)?.activePayload?.[0]?.payload; if (p) onSelect(String(p.key), String(p.label)); } : undefined}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={{ stroke: '#c9c7c1' }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickFormatter={axisFmt(format)} axisLine={false} tickLine={false} width={yWidth(format)} />
          <Tooltip content={<ChartTooltip format={format} />} />
          {series.length > 1 && <Legend verticalAlign="top" align="left" iconType="plainline" wrapperStyle={{ fontSize: 12, color: '#52514e', paddingBottom: 6 }} />}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={data.length <= 24 ? { r: 4, strokeWidth: 2, stroke: '#fff', fill: s.color } : false} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EmptyChart({ text = 'No data for this view.' }: { text?: string }) {
  return <div className="flex h-40 items-center justify-center text-sm text-ink-3">{text}</div>;
}

/** Single-hue sequential heat table (magnitude by shading, value always printed). */
export function HeatTable({ rowLabels, colLabels, values, format = 'int', rowHeader = '', onCell }: { rowLabels: string[]; colLabels: string[]; values: number[][]; format?: ColFormat; rowHeader?: string; onCell?: (row: string, col: string) => void }) {
  const max = Math.max(1, ...values.flat());
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface px-2 py-1 text-left font-semibold text-ink-2">{rowHeader}</th>
            {colLabels.map((c) => (
              <th key={c} className="px-2 py-1 text-right font-semibold text-ink-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((r, ri) => (
            <tr key={r}>
              <td className="sticky left-0 max-w-[16rem] truncate bg-surface px-2 py-1 text-ink" title={r}>
                {r}
              </td>
              {values[ri].map((v, ci) => {
                const a = v / max;
                return (
                  <td key={ci} onClick={onCell ? () => onCell(r, colLabels[ci]) : undefined} className={clsx('tnum px-2 py-1 text-right', onCell && 'cursor-pointer')} style={{ background: v > 0 ? `rgba(42,120,214,${0.08 + a * 0.5})` : undefined, color: '#292929' }}>
                    {v === 0 ? '·' : formatCell(v, format)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Side-by-side bars for two or more entities that share one axis (e.g. Dealer App vs DataSense). */
export function GroupedBarsChart({
  data,
  series,
  format = 'int',
  height,
  onSelect,
  activeKey,
}: {
  /** one row per category: { key, label, <seriesKey>: number } */
  data: Array<Record<string, string | number | null>>;
  series: StackSeries[];
  format?: ColFormat;
  height?: number;
  onSelect?: (key: string, label: string) => void;
  activeKey?: ActiveKey;
}) {
  if (!data.length) return <EmptyChart />;
  const catWidth = Math.min(190, Math.max(70, Math.max(...data.map((d) => String(d.label).length)) * 6.9));
  const h = height ?? Math.max(200, data.length * (series.length * 14 + 14) + 50);
  return (
    <div style={{ height: h }} role="img" aria-label={`Grouped bar chart comparing ${series.map((s) => s.label).join(' and ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="22%" barGap={2}>
          <CartesianGrid horizontal={false} vertical />
          <XAxis type="number" tickFormatter={axisFmt(format)} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={catWidth} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={0} tickFormatter={(v: string) => (v.length > 30 ? v.slice(0, 29) + '…' : v)} />
          <Tooltip cursor={{ fill: 'rgba(41,41,41,0.05)' }} content={<ChartTooltip format={format} />} />
          <Legend verticalAlign="top" align="left" iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: '#52514e', paddingBottom: 6 }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false} cursor={onSelect ? 'pointer' : undefined} onClick={onSelect ? (d: unknown) => { const p = (d as { payload?: Record<string, string> }).payload ?? (d as Record<string, string>); onSelect(String(p.key), String(p.label)); } : undefined}>
              {data.map((d, i) => (
                <Cell key={i} fillOpacity={isDimmed(activeKey, String(d.key)) ? 0.3 : 1} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Side-by-side columns per category (for example months) for two or more series that share one unit and one axis. */
export function GroupedColumnsChart({
  data,
  series,
  format = 'int',
  height = 240,
  onSelect,
  activeKey,
}: {
  /** one row per category: { key, label, <seriesKey>: number | null } */
  data: Array<Record<string, string | number | null>>;
  series: StackSeries[];
  format?: ColFormat;
  height?: number;
  onSelect?: (key: string, label: string) => void;
  activeKey?: ActiveKey;
}) {
  if (!data.length) return <EmptyChart />;
  return (
    <div style={{ height }} role="img" aria-label={`Column chart comparing ${series.map((s) => s.label).join(' and ')} by ${data.length} categories`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap="26%" barGap={3}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={{ stroke: '#c9c7c1' }} tickLine={false} interval={data.length > 8 ? 'preserveStartEnd' : 0} tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + '…' : v)} />
          <YAxis tickFormatter={axisFmt(format)} axisLine={false} tickLine={false} width={yWidth(format)} />
          <Tooltip cursor={{ fill: 'rgba(41,41,41,0.05)' }} content={<ChartTooltip format={format} />} />
          {series.length > 1 && <Legend verticalAlign="top" align="left" iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: '#52514e', paddingBottom: 6 }} />}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false} cursor={onSelect ? 'pointer' : undefined} onClick={onSelect ? (d: unknown) => { const p = (d as { payload?: Record<string, string> }).payload ?? (d as Record<string, string>); onSelect(String(p.key), String(p.label)); } : undefined}>
              {data.map((d, i) => (
                <Cell key={i} fillOpacity={isDimmed(activeKey, String(d.key)) ? 0.3 : 1} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Part-to-whole for a handful of categories. The legend doubles as the click target and always prints the number. */
export function DonutChart({
  data,
  centerValue,
  centerLabel,
  onSelect,
  activeKey,
  height = 190,
  stack = false,
  format = 'int',
}: {
  data: DonutDatum[];
  /** how the slice values are written next to the legend */
  format?: ColFormat;
  centerValue?: string;
  centerLabel?: string;
  onSelect?: (key: string, label: string) => void;
  activeKey?: ActiveKey;
  height?: number;
  /** legend under the ring instead of beside it: for narrow cards */
  stack?: boolean;
}) {
  const rows = data.filter((d) => d.value > 0);
  if (!rows.length) return <EmptyChart />;
  const total = rows.reduce((a, d) => a + d.value, 0);
  return (
    <div className={clsx('flex items-center gap-4', stack ? 'flex-col' : 'flex-wrap sm:flex-nowrap')} role="img" aria-label={`Donut chart: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}>
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="96%" paddingAngle={2} stroke="#fff" strokeWidth={2} isAnimationActive={false} cursor={onSelect ? 'pointer' : undefined} onClick={onSelect ? (d: unknown) => { const p = (d as { payload?: DonutDatum }).payload ?? (d as DonutDatum); onSelect(p.key, p.label); } : undefined}>
              {rows.map((r) => (
                <Cell key={r.key} fill={r.color} fillOpacity={isDimmed(activeKey, r.key) ? 0.45 : 1} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip format={format} />} />
          </PieChart>
        </ResponsiveContainer>
        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue && <div className="tnum text-xl font-bold leading-tight text-ink">{centerValue}</div>}
            {centerLabel && <div className="text-[11px] text-ink-3">{centerLabel}</div>}
          </div>
        )}
      </div>
      <ul className={clsx('min-w-0 space-y-1 text-xs', stack ? 'w-full' : 'flex-1')}>
        {rows.map((r) => {
          const inner = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} aria-hidden />
              <span className={clsx('min-w-0 flex-1 text-left text-ink-2', stack ? 'leading-snug' : 'truncate')}>{r.label}</span>
              <span className="tnum font-semibold text-ink">{format === 'inr' ? fInrCompact(r.value) : formatCell(r.value, format)}</span>
              <span className="tnum w-11 text-right text-ink-3">{((r.value / total) * 100).toFixed(0)}%</span>
            </>
          );
          return (
            <li key={r.key}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(r.key, r.label)} aria-pressed={Array.isArray(activeKey) ? activeKey.includes(r.key) : activeKey === r.key} className={clsx('flex w-full items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', (Array.isArray(activeKey) ? activeKey.includes(r.key) : activeKey === r.key) && 'bg-hero-50')}>
                  {inner}
                </button>
              ) : (
                <div className="flex items-center gap-2 px-1.5 py-1">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface ScatterPoint {
  key: string;
  label: string;
  x: number;
  y: number;
  color: string;
  /** extra lines for the tooltip (the real values when the plotted ones are clamped) */
  tip?: string[];
}

/**
 * Two measures against each other, one dot per entity (here: a dealer). Reference lines split it into quadrants.
 * Both axes are labelled with units; the dots are coloured by class and the legend names the classes.
 */
export function ScatterPlot({
  data,
  xTitle,
  yTitle,
  xFormat = 'pct',
  yFormat = 'pct',
  refX,
  refY,
  height = 320,
  onSelect,
  activeKey,
  legend,
  xDomain,
  yDomain,
}: {
  data: ScatterPoint[];
  xTitle: string;
  yTitle: string;
  xFormat?: ColFormat;
  yFormat?: ColFormat;
  refX?: number;
  refY?: number;
  height?: number;
  onSelect?: (key: string, label: string) => void;
  activeKey?: ActiveKey;
  legend?: Array<{ label: string; color: string }>;
  xDomain?: [number, number];
  yDomain?: [number, number];
}) {
  if (!data.length) return <EmptyChart />;
  return (
    <div>
      {legend && legend.length > 1 && (
        <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} aria-hidden />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <div style={{ height }} role="img" aria-label={`Scatter chart of ${yTitle} against ${xTitle} with ${data.length} points`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 8 }}>
            <CartesianGrid />
            <XAxis type="number" dataKey="x" name={xTitle} domain={xDomain ?? ['auto', 'auto']} tickFormatter={axisFmt(xFormat)} axisLine={{ stroke: '#c9c7c1' }} tickLine={false} label={{ value: xTitle, position: 'insideBottom', offset: -14, fontSize: 11, fill: '#52514e' }} />
            <YAxis type="number" dataKey="y" name={yTitle} domain={yDomain ?? ['auto', 'auto']} tickFormatter={axisFmt(yFormat)} axisLine={false} tickLine={false} width={yWidth(yFormat) + 10} label={{ value: yTitle, angle: -90, position: 'insideLeft', offset: 8, fontSize: 11, fill: '#52514e', style: { textAnchor: 'middle' } }} />
            <ZAxis range={[90, 90]} />
            {refX !== undefined && <ReferenceLine x={refX} stroke="#9b9a95" strokeDasharray="4 4" />}
            {refY !== undefined && <ReferenceLine y={refY} stroke="#9b9a95" strokeDasharray="4 4" />}
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as ScatterPoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border border-slate-200 bg-surface px-3 py-2 text-xs shadow-pop">
                    <div className="mb-1 font-semibold text-ink">{p.label}</div>
                    {(p.tip ?? [`${xTitle}: ${formatCompactByFormat(p.x, xFormat)}`, `${yTitle}: ${formatCompactByFormat(p.y, yFormat)}`]).map((t, i) => (
                      <div key={i} className="text-ink-2">{t}</div>
                    ))}
                  </div>
                );
              }}
            />
            <Scatter data={data} isAnimationActive={false} cursor={onSelect ? 'pointer' : undefined} onClick={onSelect ? (d: unknown) => { const p = (d as { payload?: ScatterPoint }).payload ?? (d as ScatterPoint); onSelect(p.key, p.label); } : undefined}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} fillOpacity={isDimmed(activeKey, d.key) ? 0.25 : 0.9} stroke="#fff" strokeWidth={2} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------- bridge (waterfall) ------------------------------- */

export interface BridgeStep {
  key: string;
  label: string;
  /** a total starts from zero; a delta floats from the running total */
  kind: 'total' | 'delta';
  value: number;
  color: string;
}

/** A waterfall: the first total, what each part added or took away, the last total. Labels carry the sign, so colour is never the only cue. */
export function BridgeChart({ steps, format = 'inr', height = 250, onSelect }: { steps: BridgeStep[]; format?: ColFormat; height?: number; onSelect?: (key: string) => void }) {
  if (!steps.length) return <EmptyChart />;
  let run = 0;
  const data = steps.map((st) => {
    if (st.kind === 'total') {
      run = st.value;
      return { ...st, base: 0, span: st.value, shown: formatCompactByFormat(st.value, format) };
    }
    const from = run;
    run += st.value;
    return { ...st, base: Math.min(from, run), span: Math.abs(st.value), shown: `${st.value < 0 ? '−' : '+'}${formatCompactByFormat(Math.abs(st.value), format)}` };
  });
  const label = (p: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
    const d = data[Number(p.index)];
    if (!d) return null;
    return (
      <text x={Number(p.x) + Number(p.width) / 2} y={Number(p.y) - 6} fontSize={12} fontWeight={600} fill="#292929" textAnchor="middle">
        {d.shown}
      </text>
    );
  };
  return (
    <div style={{ height }} role="img" aria-label={`Bridge from ${data[0].label} (${data[0].shown}) to ${data[data.length - 1].label} (${data[data.length - 1].shown})`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 24, right: 12, bottom: 4, left: 4 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={{ stroke: '#c9c7c1' }} tickLine={false} interval={0} />
          <YAxis tickFormatter={axisFmt(format)} axisLine={false} tickLine={false} width={yWidth(format)} />
          <Tooltip
            cursor={{ fill: 'rgba(41,41,41,0.05)' }}
            content={({ active, payload }) => {
              const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              return d ? (
                <div className="rounded-md border border-slate-200 bg-surface px-3 py-2 text-xs shadow-pop">
                  <div className="mb-0.5 flex items-center gap-2 font-semibold text-ink">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} aria-hidden />
                    {d.label}
                  </div>
                  <div className="tnum text-ink-2">{d.kind === 'total' ? formatCell(d.value, format) : `${d.value < 0 ? '−' : '+'}${formatCell(Math.abs(d.value), format)}`}</div>
                </div>
              ) : null;
            }}
          />
          <Bar dataKey="base" stackId="bridge" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="span" stackId="bridge" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} cursor={onSelect ? 'pointer' : undefined} onClick={onSelect ? (d: unknown) => onSelect(((d as { payload?: { key: string } }).payload ?? (d as { key: string })).key) : undefined}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
            <LabelList dataKey="span" content={label as never} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
