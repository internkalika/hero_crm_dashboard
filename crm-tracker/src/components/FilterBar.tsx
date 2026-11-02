// The filter bar every data page shows under its title. Each page lists the fields its own data supports (a zone for the
// Dealer App orders, a role for DataSense, a platform for the issues) and the options come from that page's records for
// the selected period. Every field is a multi-select in the manner of an Excel column filter: a search box, a checkbox per
// value, Select all / Clear, a selected-count and Apply / Cancel. Applying writes the same address filter
// (`?f.zone=West&f.zone=East`) that a click on a chart bar writes, so the two always agree, links can be shared and Back
// steps through the choices.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, Filter, Search, X } from 'lucide-react';
import type { CrossFilter } from './filters';
import { fInt } from '../lib/export/format';

export interface FilterOption {
  value: string;
  label?: string;
  count?: number;
}

export interface FilterField {
  dim: string;
  label: string;
  options: FilterOption[];
  /** text shown while nothing is selected, e.g. "All dealers" */
  allLabel?: string;
  /** long lists (dealers, employees) always get a search box; lists of more than 12 choices get one anyway */
  search?: boolean;
}

interface BuildOptions<T> {
  /** how an option is written; receives the key and the first record that has it */
  label?: (key: string, sample: T) => string;
  /** 'count' = most records first (default), 'label' = A–Z, 'value' = by key (months), or an explicit order of keys */
  sort?: 'count' | 'label' | 'value' | string[];
  /** leave the record counts off (when a record is not a meaningful unit) */
  noCounts?: boolean;
}

/** One option per distinct key found in the records, with how many records carry it. Blank keys are left out. */
export function buildOptions<T>(items: T[], keyOf: (t: T) => string | null | undefined, opts: BuildOptions<T> = {}): FilterOption[] {
  const m = new Map<string, { n: number; sample: T }>();
  for (const it of items) {
    const k = keyOf(it);
    if (k === null || k === undefined || k === '') continue;
    const cur = m.get(k);
    if (cur) cur.n += 1;
    else m.set(k, { n: 1, sample: it });
  }
  const list = [...m.entries()].map(([value, { n, sample }]) => ({ value, label: opts.label ? opts.label(value, sample) : value, count: opts.noCounts ? undefined : n }));
  const s = opts.sort ?? 'count';
  if (Array.isArray(s)) list.sort((a, b) => (s.indexOf(a.value) === -1 ? 999 : s.indexOf(a.value)) - (s.indexOf(b.value) === -1 ? 999 : s.indexOf(b.value)));
  else if (s === 'value') list.sort((a, b) => a.value.localeCompare(b.value));
  else if (s === 'label') list.sort((a, b) => a.label.localeCompare(b.label));
  else list.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
  return list;
}

const MAX_ROWS = 150;

/** Excel-style multi-select: tick any number of values, then Apply. Ticking every value is the same as ticking none. */
export function MultiSelect({ field, selected, selectedLabels, onApply }: { field: FilterField; selected: string[]; selectedLabels?: string[]; onApply: (values: string[], labels: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Map<string, string>>(new Map());
  const [alignRight, setAlignRight] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const searchBox = field.search || field.options.length > 12;
  const optionLabel = (o: FilterOption) => o.label ?? o.value;

  // choices that are selected (for example by a link) but not among this page's options stay visible and removable
  const orphans = useMemo(() => selected.map((v, i) => ({ value: v, label: selectedLabels?.[i] ?? v })).filter((s) => !field.options.some((o) => o.value === s.value)), [selected, selectedLabels, field.options]);
  const all = useMemo<FilterOption[]>(() => [...orphans, ...field.options], [orphans, field.options]);
  const matched = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? all.filter((o) => optionLabel(o).toLowerCase().includes(n) || o.value.toLowerCase().includes(n)) : all;
  }, [q, all]);
  const shown = matched.slice(0, MAX_ROWS);
  const nMatchedChecked = matched.filter((o) => draft.has(o.value)).length;
  const allMatchedChecked = matched.length > 0 && nMatchedChecked === matched.length;

  const start = () => {
    if (wrap.current) setAlignRight(wrap.current.getBoundingClientRect().left + 320 > window.innerWidth - 8);
    setDraft(new Map(selected.map((v, i) => [v, selectedLabels?.[i] ?? field.options.find((o) => o.value === v)?.label ?? v])));
    setQ('');
    setOpen(true);
  };
  const cancel = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const tick = (o: FilterOption) =>
    setDraft((d) => {
      const n = new Map(d);
      if (n.has(o.value)) n.delete(o.value);
      else n.set(o.value, optionLabel(o));
      return n;
    });
  const selectAllMatched = () =>
    setDraft((d) => {
      const n = new Map(d);
      if (allMatchedChecked) matched.forEach((o) => n.delete(o.value));
      else matched.forEach((o) => n.set(o.value, optionLabel(o)));
      return n;
    });
  const apply = () => {
    const keys = [...draft.keys()];
    const everything = field.options.length > 0 && field.options.every((o) => draft.has(o.value)) && orphans.every((o) => draft.has(o.value));
    if (keys.length === 0 || everything) onApply([], []);
    else onApply(keys, keys.map((k) => draft.get(k) ?? k));
    setOpen(false);
  };

  const n = selected.length;
  const text = n === 0 ? field.allLabel ?? 'All' : n === 1 ? selectedLabels?.[0] ?? field.options.find((o) => o.value === selected[0])?.label ?? selected[0] : `${fInt(n)} selected`;
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label={`${field.label}: ${text}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={clsx('inline-flex h-7 max-w-[15rem] items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', n > 0 ? 'border-hero-600 bg-hero-50 text-hero-700' : 'border-slate-300 bg-surface text-ink-2 hover:border-slate-400')}
        onClick={() => (open ? cancel() : start())}
      >
        <span className={clsx('truncate', n === 0 && 'font-medium')}>
          {field.label}
          {n > 0 && <span className="font-semibold">: {text}</span>}
        </span>
        {n > 1 && <span className="rounded-full bg-hero-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{n}</span>}
        <ChevronDown size={12} className="shrink-0 opacity-60" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Filter ${field.label}`}
          className={clsx('absolute top-full z-30 mt-1 w-80 max-w-[88vw] rounded-md border border-slate-200 bg-surface p-2 shadow-pop', alignRight ? 'right-0' : 'left-0')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
          }}
        >
          {searchBox && (
            <label className="relative mb-1 block">
              <Search size={14} className="pointer-events-none absolute left-2 top-2 text-ink-3" aria-hidden />
              <input autoFocus className="input w-full py-1 pl-7 text-sm" placeholder={`Search ${field.label.toLowerCase()}…`} aria-label={`Search ${field.label}`} value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          )}
          <div className="flex items-center justify-between border-b border-slate-100 px-1 pb-1.5 pt-0.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 accent-hero-600"
                checked={allMatchedChecked}
                ref={(el) => {
                  if (el) el.indeterminate = nMatchedChecked > 0 && !allMatchedChecked;
                }}
                onChange={selectAllMatched}
                disabled={matched.length === 0}
              />
              {q.trim() ? `Select all results (${fInt(matched.length)})` : `Select all (${fInt(matched.length)})`}
            </label>
            <button type="button" className="btn btn-ghost btn-sm text-hero-700" onClick={() => setDraft(new Map())} disabled={draft.size === 0}>
              Clear
            </button>
          </div>
          <ul className="max-h-60 overflow-y-auto py-1" aria-label={field.label}>
            {shown.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm hover:bg-hero-50">
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-hero-600" checked={draft.has(o.value)} onChange={() => tick(o)} />
                  <span className="min-w-0 flex-1 truncate" title={optionLabel(o)}>{optionLabel(o)}</span>
                  {o.count !== undefined && <span className="tnum shrink-0 text-xs text-ink-3">{fInt(o.count)}</span>}
                </label>
              </li>
            ))}
            {matched.length === 0 && <li className="px-2 py-2 text-sm text-ink-3">Nothing matches “{q}”.</li>}
            {matched.length > shown.length && <li className="px-2 py-1.5 text-xs text-ink-3">Showing {shown.length} of {fInt(matched.length)}. Type to narrow the list; “Select all” still covers all {fInt(matched.length)}.</li>}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <span className="text-xs text-ink-3" aria-live="polite">{fInt(draft.size)} of {fInt(all.length)} selected</span>
            <span className="flex gap-1.5">
              <button type="button" className="btn btn-sm" onClick={cancel}>Cancel</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={apply}>Apply</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** One slim row of filter pills: a pill is lit while it holds a selection, and "Clear" removes them all. `embedded` drops the card around it. */
export function FilterBar({ cf, fields, embedded }: { cf: CrossFilter; fields: FilterField[]; embedded?: boolean }) {
  const [openMobile, setOpenMobile] = useState(false);
  // a field with nothing to choose between is not worth a control, unless a value is already set
  const visible = fields.filter((f) => f.options.length > 1 || (cf.filters[f.dim]?.length ?? 0) > 0);
  if (!visible.length && cf.count === 0) return null;
  return (
    <section aria-label="Filters" className={clsx(!embedded && 'card mb-3 px-2.5 py-2')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="btn btn-sm h-7 py-0 sm:hidden" aria-expanded={openMobile} onClick={() => setOpenMobile((o) => !o)}>
          <Filter size={13} aria-hidden /> Filters{cf.count ? ` (${cf.count})` : ''}
          <ChevronDown size={13} className={clsx('transition-transform', openMobile && 'rotate-180')} aria-hidden />
        </button>
        <span className="hidden items-center gap-1 pr-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3 sm:flex">
          <Filter size={13} aria-hidden /> Filters
        </span>
        <div className={clsx('flex-wrap items-center gap-1.5 sm:flex', openMobile ? 'flex w-full' : 'hidden')}>
          {visible.map((f) => (
            <MultiSelect key={f.dim} field={f} selected={cf.filters[f.dim] ?? []} selectedLabels={cf.labels[f.dim]} onApply={(v, l) => cf.setMany(f.dim, v, l)} />
          ))}
          {cf.count > 0 && (
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-semibold text-hero-700 hover:bg-hero-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600" onClick={cf.clear}>
              <X size={12} aria-hidden /> Clear
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
