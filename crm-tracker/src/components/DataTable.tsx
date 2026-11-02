import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ColumnDef, SortingState, flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { Col, SheetSpec, downloadCsv, downloadXlsx, sheetFromCols, stamp } from '../lib/export/excel';
import { formatCell, isNumericFormat } from '../lib/export/format';

export interface DataTableProps<T> {
  rows: T[];
  columns: Col<T>[];
  /** file name stem for exports */
  exportName: string;
  /** describes the active filters; written to the export's Notes sheet */
  exportNotes?: string[];
  /** unfiltered rows: enables an "Export all data" option */
  fullRows?: T[];
  title?: ReactNode;
  getRowId?: (r: T, i: number) => string;
  initialSort?: { id: string; desc?: boolean };
  pageSize?: number;
  onRowClick?: (r: T) => void;
  selectedId?: string | string[] | null;
  emptyText?: string;
  searchPlaceholder?: string;
  maxHeight?: string;
  /** keep the first column visible while scrolling sideways */
  stickyFirst?: boolean;
}

const cmp = (a: unknown, b: unknown) => {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
};

export function DataTable<T>({ rows, columns, exportName, exportNotes = [], fullRows, title, getRowId, initialSort, pageSize = 25, onRowClick, selectedId, emptyText = 'No rows match the current filters.', searchPlaceholder = 'Search…', maxHeight, stickyFirst }: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [{ id: initialSort.id, desc: !!initialSort.desc }] : []);
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => Object.fromEntries(columns.filter((c) => c.hidden).map((c) => [c.id, true])));
  const [colMenu, setColMenu] = useState(false);
  const [expMenu, setExpMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setColMenu(false);
        setExpMenu(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const terms = q.split(/\s+/);
    return rows.filter((r) => {
      const hay = columns.map((c) => formatCell(c.value(r), c.format) + ' ' + String(c.value(r) ?? '')).join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, query, columns]);

  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        accessorFn: (r: T) => c.value(r),
        sortingFn: (a, b, id) => cmp(a.getValue(id), b.getValue(id)),
        sortUndefined: 'last' as const,
        cell: (ctx) => (c.render ? c.render(ctx.row.original) : formatCell(ctx.getValue() as never, c.format)),
        meta: c,
      })),
    [columns],
  );

  const table = useReactTable({
    data: filtered,
    columns: defs,
    state: { sorting, columnVisibility: Object.fromEntries(columns.map((c) => [c.id, !hidden[c.id]])) },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    getRowId: getRowId ? (r, i) => getRowId(r, i) : undefined,
    autoResetPageIndex: true,
  });

  const visibleCols = columns.filter((c) => !hidden[c.id]);
  const pg = table.getState().pagination;
  const total = filtered.length;
  const from = total === 0 ? 0 : pg.pageIndex * pg.pageSize + 1;
  const to = Math.min(total, (pg.pageIndex + 1) * pg.pageSize);

  const sortedFiltered = () => table.getPrePaginationRowModel().rows.map((r) => r.original);

  const doExport = async (kind: 'csv' | 'xlsx', scope: 'filtered' | 'all') => {
    setBusy(true);
    try {
      const data = scope === 'all' && fullRows ? fullRows : sortedFiltered();
      const exportCols = columns.filter((c) => !hidden[c.id] || true); // hidden columns are still exported
      const sheet: SheetSpec = sheetFromCols(exportName.slice(0, 31), exportCols, data, `${data.length.toLocaleString('en-IN')} rows (${scope === 'all' ? 'all data' : 'filtered view'})`);
      const file = `${exportName.replace(/[^A-Za-z0-9_-]+/g, '_')}_${scope}_${stamp()}`;
      if (kind === 'csv') downloadCsv(sheet, file);
      else await downloadXlsx([sheet], { title: `CRM Tracker – ${exportName}`, notes: [`Scope: ${scope === 'all' ? 'all rows, no filters' : 'rows currently shown (search and filters applied)'}`, ...(scope === 'filtered' ? exportNotes : [])] }, file);
    } finally {
      setBusy(false);
      setExpMenu(false);
    }
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        {title && <div className="mr-auto text-sm font-semibold">{title}</div>}
        <div className={clsx('relative', !title && 'mr-auto')}>
          <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-ink-3" aria-hidden />
          <input aria-label="Search table" className="input w-56 pl-7" placeholder={searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button aria-label="Clear search" className="absolute right-1.5 top-2 text-ink-3 hover:text-ink" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
        <div ref={menuRef} className="flex items-center gap-2">
          <div className="relative">
            <button className="btn btn-ghost btn-sm text-ink-2" aria-label="Choose columns" title="Choose columns" aria-haspopup="menu" aria-expanded={colMenu} onClick={() => (setColMenu((o) => !o), setExpMenu(false))}>
              <Columns3 size={16} />
            </button>
            {colMenu && (
              <div role="menu" className="absolute right-0 z-30 mt-1 max-h-80 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-pop">
                {columns.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
                    <input type="checkbox" checked={!hidden[c.id]} onChange={() => setHidden((h) => ({ ...h, [c.id]: !h[c.id] }))} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button className="btn btn-ghost btn-sm text-ink-2" data-testid="table-download" aria-label="Download this table" title="Download (Excel or CSV)" aria-haspopup="menu" aria-expanded={expMenu} disabled={busy || total === 0} onClick={() => (setExpMenu((o) => !o), setColMenu(false))}>
              <Download size={16} />
            </button>
            {expMenu && (
              <div role="menu" className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-slate-200 bg-white p-1 text-xs shadow-pop">
                <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-50" onClick={() => doExport('xlsx', 'filtered')}>
                  Excel – current view ({total.toLocaleString('en-IN')} rows)
                </button>
                <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-50" onClick={() => doExport('csv', 'filtered')}>
                  CSV – current view
                </button>
                {fullRows && (
                  <>
                    <div className="my-1 border-t border-slate-100" />
                    <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-50" onClick={() => doExport('xlsx', 'all')}>
                      Excel – all rows ({fullRows.length.toLocaleString('en-IN')}, no filters)
                    </button>
                    <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-50" onClick={() => doExport('csv', 'all')}>
                      CSV – all rows
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const c = h.column.columnDef.meta as Col<T>;
                  const dir = h.column.getIsSorted();
                  const numeric = c.align ? c.align === 'right' : isNumericFormat(c.format ?? 'text');
                  return (
                    <th key={h.id} scope="col" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'} title={c.help} className={clsx('whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2', numeric ? 'text-right' : 'text-left', stickyFirst && h.index === 0 && 'sticky left-0 z-20')} style={c.width ? { minWidth: c.width } : undefined}>
                      <button className={clsx('inline-flex items-center gap-1 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', numeric && 'flex-row-reverse')} onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === 'asc' ? <ArrowUp size={12} /> : dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUpDown size={12} className="opacity-30" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => {
              const id = getRowId ? getRowId(r.original, r.index) : r.id;
              return (
                <tr
                  key={r.id}
                  onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r.original) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={clsx('group/row border-b border-slate-100 last:border-0 odd:bg-white even:bg-slate-50', onRowClick && 'cursor-pointer hover:bg-hero-50 focus:bg-hero-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hero-600', (Array.isArray(selectedId) ? selectedId.includes(id) : !!selectedId && selectedId === id) && '!bg-hero-50')}
                >
                  {r.getVisibleCells().map((cell, ci) => {
                    const c = cell.column.columnDef.meta as Col<T>;
                    const numeric = c.align ? c.align === 'right' : isNumericFormat(c.format ?? 'text');
                    return (
                      <td key={cell.id} className={clsx('px-3 py-2 align-top', numeric ? 'tnum text-right' : 'text-left', c.align === 'center' && 'text-center', stickyFirst && ci === 0 && 'sticky left-0 z-[1] bg-inherit')}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {total === 0 && (
              <tr>
                <td colSpan={Math.max(1, visibleCols.length)} className="px-3 py-8 text-center text-ink-3">
                  {rows.length === 0 ? emptyText : 'No rows match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs text-ink-2">
        <span>
          {total === 0 ? '0 rows' : `${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} rows`}
          {total !== rows.length && ` (filtered from ${rows.length.toLocaleString('en-IN')})`}
        </span>
        <span className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            Rows
            <select className="input py-0.5" value={pg.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-sm" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
            <ChevronLeft size={14} />
          </button>
          <span className="tnum">
            Page {pg.pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <button className="btn btn-sm" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            <ChevronRight size={14} />
          </button>
        </span>
      </div>
    </div>
  );
}
