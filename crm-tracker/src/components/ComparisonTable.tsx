import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { COMPARISON_COLUMNS, CMP_GROUP_LABEL, CmpColumn, CmpGroup, ComparisonRow, comparisonTotals } from '../lib/metrics/comparisonTable';
import { formatCell } from '../lib/export/format';
import { InfoTip } from './ui';
import { DownloadMenu } from './DownloadMenu';

// Light blue = Sales App (DataSense), light green = Bizom App (Dealer App), restrained light yellow = Capillary.
const GROUP_HEAD: Record<CmpGroup, string> = {
  identity: 'bg-slate-200 text-ink',
  sales: 'bg-sky-200 text-sky-950',
  app: 'bg-emerald-200 text-emerald-950',
  capillary: 'bg-amber-200 text-amber-950',
};
const COL_HEAD: Record<CmpGroup, string> = {
  identity: 'bg-slate-100',
  sales: 'bg-sky-100',
  app: 'bg-emerald-100',
  capillary: 'bg-amber-100',
};
const CELL_TINT: Record<CmpGroup, string> = {
  identity: '',
  sales: '',
  app: '',
  capillary: '!bg-amber-50',
};

const cmp = (a: unknown, b: unknown) => {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
};

export function ComparisonTable({
  rows,
  onOpen,
  onDownload,
  emptyText = 'No dealers to show.',
}: {
  rows: ComparisonRow[];
  /** a click (or Enter) on a row opens that dealer's profile */
  onOpen: (r: ComparisonRow) => void;
  onDownload: (rows: ComparisonRow[], kind: 'xlsx' | 'csv') => void | Promise<void>;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ id: keyof ComparisonRow; desc: boolean } | null>({ id: 'salesValue', desc: true });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) {
      const terms = q.split(/\s+/);
      out = rows.filter((r) => {
        const hay = `${r.dbName} ${r.dbCode} ${r.outletId ?? ''}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    if (sort) {
      const dir = sort.desc ? -1 : 1;
      out = [...out].sort((a, b) => {
        const av = a[sort.id];
        const bv = b[sort.id];
        const nullA = av === null || av === undefined || av === '';
        const nullB = bv === null || bv === undefined || bv === '';
        if (nullA || nullB) return nullA === nullB ? 0 : nullA ? 1 : -1; // blanks last, whichever direction
        return cmp(av, bv) * dir;
      });
    }
    return out;
  }, [rows, query, sort]);

  const totals = useMemo(() => comparisonTotals(shown), [shown]);
  const groups = (['identity', 'sales', 'app'] as CmpGroup[]).map((g) => ({ g, span: COMPARISON_COLUMNS.filter((c) => (g === 'app' ? c.group === 'app' || c.group === 'capillary' : c.group === g)).length }));
  const numeric = (c: CmpColumn) => c.format !== 'text';
  const cell = (r: ComparisonRow, c: CmpColumn) => {
    const v = r[c.id];
    if (v === null || v === undefined || v === '') return <span className="text-ink-3" title="Not available">—</span>;
    return formatCell(v as number | string, c.format);
  };
  const toggle = (id: keyof ComparisonRow) => setSort((s) => (s?.id === id ? (s.desc ? { id, desc: false } : null) : { id, desc: !(id === 'dbName' || id === 'dbCode' || id === 'outletId') }));

  return (
    <div className="card overflow-hidden" data-testid="comparison-table">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <div className="relative mr-auto">
          <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-ink-3" aria-hidden />
          <input aria-label="Search dealers" className="input w-64 pl-7" placeholder="Search dealer name, DB code or outlet ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button aria-label="Clear search" className="absolute right-1.5 top-2 text-ink-3 hover:text-ink" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
        <span className="hidden text-xs text-ink-3 sm:inline">Click a row to open the dealer</span>
        <DownloadMenu
          label="Download this table"
          disabled={shown.length === 0}
          items={[
            { label: `Excel – table as shown (${shown.length} dealers + total)`, run: () => onDownload(shown, 'xlsx') },
            { label: 'CSV – table as shown', run: () => onDownload(shown, 'csv') },
          ]}
        />
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[1280px] border-collapse text-sm">
          <thead>
            <tr>
              {groups.map(({ g, span }) => (
                <th key={g} colSpan={span} scope="colgroup" className={clsx('border-x border-white px-3 py-2 text-center text-xs font-bold uppercase tracking-wide', GROUP_HEAD[g])}>
                  {g === 'identity' ? CMP_GROUP_LABEL.identity : g === 'sales' ? CMP_GROUP_LABEL.sales : CMP_GROUP_LABEL.app}
                </th>
              ))}
            </tr>
            <tr>
              {COMPARISON_COLUMNS.map((c) => {
                const dir = sort?.id === c.id ? (sort.desc ? 'descending' : 'ascending') : 'none';
                return (
                  <th key={`${c.id}-${c.group}`} scope="col" aria-sort={dir} className={clsx('border-b border-slate-300 px-3 py-2 align-bottom text-[11px] font-semibold leading-tight text-ink', COL_HEAD[c.group], numeric(c) ? 'text-right' : 'text-left', c.group === 'capillary' && 'text-amber-950')} style={{ minWidth: c.id === 'dbName' ? 190 : c.format === 'inr' ? 120 : 96 }}>
                    <span className={clsx('flex items-end gap-1', numeric(c) && 'justify-end')}>
                      <button className={clsx('inline-flex items-center gap-1 text-inherit hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', numeric(c) && 'flex-row-reverse text-right')} onClick={() => toggle(c.id)}>
                        <span>{c.header}</span>
                        {dir === 'ascending' ? <ArrowUp size={12} /> : dir === 'descending' ? <ArrowDown size={12} /> : <ArrowUpDown size={12} className="opacity-30" />}
                      </button>
                      <InfoTip title={c.header} lines={[{ text: c.help }]} className="shrink-0" />
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.key}
                tabIndex={0}
                onClick={() => onOpen(r)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(r)}
                aria-label={`Open dealer profile: ${r.dbName}`}
                className="group/row cursor-pointer border-b border-slate-100 odd:bg-surface even:bg-slate-50 hover:bg-hero-50 focus:bg-hero-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hero-600"
              >
                {COMPARISON_COLUMNS.map((c) => (
                  <td key={`${c.id}-${c.group}`} className={clsx('px-3 py-2', numeric(c) ? 'tnum text-right' : 'text-left', c.id === 'dbName' && 'font-medium text-ink group-hover/row:text-hero-700', CELL_TINT[c.group])}>
                    {cell(r, c)}
                    {c.id === 'dbName' && r.note && <span className="block text-[11px] font-normal text-ink-3">{r.note}</span>}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={COMPARISON_COLUMNS.length} className="px-3 py-10 text-center text-ink-3">
                  {rows.length === 0 ? emptyText : 'No dealers match your search.'}
                </td>
              </tr>
            )}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-ink" data-testid="comparison-totals">
                {COMPARISON_COLUMNS.map((c, i) => (
                  <td key={`${c.id}-${c.group}`} className={clsx('px-3 py-2.5', numeric(c) ? 'tnum text-right' : 'text-left', c.group === 'capillary' && '!bg-amber-100')}>
                    {i === 0 ? '' : c.id === 'dbCode' ? '' : c.id === 'dbName' ? `Total (${shown.length} dealer${shown.length === 1 ? '' : 's'})` : cell(totals, c)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
