import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';

/**
 * Cross-filter state. Every dimension can hold SEVERAL values at once, like an Excel column filter: the filter bar's
 * multi-selects write them, and a click on a chart bar, KPI card or insight sets one. The state lives in the address
 * (`?f.dealer=10061&f.dealer=19100&l.dealer=Name+A&l.dealer=Name+B`), so a link from another page can open this page
 * already filtered, the browser Back button steps through filters, and a dealer profile opened on top of a page leaves
 * the page's filters exactly as they were.
 *
 * A value that is selected is one the record must carry; a dimension with no value is not filtered. Choosing every
 * option of a list is the same as choosing none (nothing is excluded), so "Select all" clears the filter.
 */
export interface CrossFilter {
  /** the selected values of each filtered dimension */
  filters: Record<string, string[]>;
  /** chip text of each selected value, in the same order as `filters[dim]` */
  labels: Record<string, string[]>;
  labelOf: (dim: string, value: string) => string;
  /** chart click: selects just this value, or clears the dimension when it is the only value selected */
  toggle: (dim: string, value: string, label?: string) => void;
  /** adds or removes one value and keeps the others (Ctrl/Shift-click and the chips) */
  toggleIn: (dim: string, value: string, label?: string) => void;
  /** replaces the dimension with one value, or clears it with null */
  set: (dim: string, value: string | null, label?: string) => void;
  /** replaces the dimension with these values; an empty list clears it */
  setMany: (dim: string, values: string[], labels?: string[]) => void;
  clear: () => void;
  clearDim: (dim: string) => void;
  /** is this value among the selected ones? */
  has: (dim: string, value: string) => boolean;
  /** does a record with this value pass the filter? True when the dimension is not filtered. */
  ok: (dim: string, value: string | null | undefined) => boolean;
  /** the single selected value, when exactly one is selected */
  only: (dim: string) => string | undefined;
  /** number of filtered dimensions */
  count: number;
}

const F = 'f.';
const L = 'l.';

/**
 * Writes to the address' query string. react-router's setSearchParams does not queue: two calls in one click handler
 * (for example "set a filter, then switch tab") would each start from the same old address and the second would undo
 * the first. This writer remembers the address it just produced until the end of the current task, so consecutive
 * writes build on each other.
 */
let pendingQuery: URLSearchParams | null = null;
export function useQueryWriter() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (mutate: (q: URLSearchParams) => void, replace = true) => {
      const next = new URLSearchParams(pendingQuery ?? params);
      mutate(next);
      pendingQuery = next;
      queueMicrotask(() => {
        pendingQuery = null;
      });
      // keep the history state so that a dealer profile opened from this page still knows it can step back
      navigate({ search: next.toString() ? `?${next.toString()}` : '' }, { replace, state: location.state });
    },
    [params, navigate, location.state],
  );
}

export function parseFilters(params: URLSearchParams): { filters: Record<string, string[]>; labels: Record<string, string[]> } {
  const filters: Record<string, string[]> = {};
  const labels: Record<string, string[]> = {};
  const rawLabels: Record<string, string[]> = {};
  params.forEach((v, k) => {
    if (k.startsWith(F)) (filters[k.slice(F.length)] ??= []).push(v);
    else if (k.startsWith(L)) (rawLabels[k.slice(L.length)] ??= []).push(v);
  });
  for (const [dim, values] of Object.entries(filters)) {
    const given = rawLabels[dim] ?? [];
    // labels are written next to their values; a link that carries fewer labels than values falls back to the value itself
    labels[dim] = values.map((v, i) => (given.length === values.length ? given[i] : values.length === 1 ? given[0] ?? v : v));
  }
  return { filters, labels };
}

/** Writes the selected values of one dimension (and their chip labels) into a query string. */
export function writeDim(q: URLSearchParams, dim: string, values: string[], labels?: string[]) {
  q.delete(F + dim);
  q.delete(L + dim);
  if (!values.length) return;
  values.forEach((v) => q.append(F + dim, v));
  if (labels && labels.some((l, i) => l && l !== values[i])) values.forEach((v, i) => q.append(L + dim, labels[i] || v));
}

export function useCrossFilter(): CrossFilter {
  const [params] = useSearchParams();
  const write = useQueryWriter();
  const { filters, labels } = useMemo(() => parseFilters(params), [params]);

  const setMany = useCallback((dim: string, values: string[], lab?: string[]) => write((next) => writeDim(next, dim, values, lab)), [write]);
  const set = useCallback((dim: string, value: string | null, label?: string) => setMany(dim, value === null ? [] : [value], label ? [label] : undefined), [setMany]);
  const toggle = useCallback(
    (dim: string, value: string, label?: string) => {
      if (filters[dim]?.length === 1 && filters[dim][0] === value) set(dim, null);
      else set(dim, value, label);
    },
    [filters, set],
  );
  const toggleIn = useCallback(
    (dim: string, value: string, label?: string) => {
      const cur = filters[dim] ?? [];
      const curLabels = labels[dim] ?? [];
      if (cur.includes(value)) {
        const keep = cur.map((v, i) => [v, curLabels[i]] as const).filter(([v]) => v !== value);
        setMany(dim, keep.map(([v]) => v), keep.map(([, l]) => l));
      } else setMany(dim, [...cur, value], [...curLabels, label ?? value]);
    },
    [filters, labels, setMany],
  );
  const clear = useCallback(() => {
    write((next) => {
      [...next.keys()].forEach((k) => (k.startsWith(F) || k.startsWith(L)) && next.delete(k));
    });
  }, [write]);
  const clearDim = useCallback((dim: string) => setMany(dim, []), [setMany]);

  return useMemo(
    () => ({
      filters,
      labels,
      labelOf: (dim, value) => {
        const i = filters[dim]?.indexOf(value) ?? -1;
        return i >= 0 ? labels[dim][i] : value;
      },
      toggle,
      toggleIn,
      set,
      setMany,
      clear,
      clearDim,
      has: (d, v) => !!filters[d]?.includes(v),
      ok: (d, v) => !filters[d] || (v !== null && v !== undefined && filters[d].includes(v)),
      only: (d) => (filters[d]?.length === 1 ? filters[d][0] : undefined),
      count: Object.keys(filters).length,
    }),
    [filters, labels, toggle, toggleIn, set, setMany, clear, clearDim],
  );
}

/** The chips of the active filters: one per selected value (a long selection is summarised), each removable. */
export function FilterChips({ cf, dimLabels = {}, className = 'mb-3' }: { cf: CrossFilter; dimLabels?: Record<string, string>; className?: string }) {
  if (cf.count === 0) return null;
  const chip = 'inline-flex max-w-full items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-surface hover:bg-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-1';
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} aria-label="Active filters">
      <span className="label">Filtered by</span>
      {Object.entries(cf.filters).map(([dim, values]) => {
        const name = dimLabels[dim] ?? dim;
        if (values.length > 3)
          return (
            <button key={dim} type="button" className={chip} title={values.map((v) => cf.labelOf(dim, v)).join('\n')} onClick={() => cf.clearDim(dim)} aria-label={`Remove all ${values.length} selected: ${name}`}>
              <span className="truncate">{name}: {values.length} selected</span>
              <X size={12} aria-hidden />
            </button>
          );
        return values.map((v) => (
          <button key={`${dim}:${v}`} type="button" className={chip} onClick={() => cf.toggleIn(dim, v)} aria-label={`Remove filter ${name}: ${cf.labelOf(dim, v)}`}>
            <span className="truncate">{name}: {cf.labelOf(dim, v)}</span>
            <X size={12} aria-hidden />
          </button>
        ));
      })}
      <button type="button" className="btn btn-ghost btn-sm text-hero-700" onClick={cf.clear}>
        Clear all filters
      </button>
    </div>
  );
}

/** Lines that say which filters an export or table was made with. */
export function describeFilters(cf: CrossFilter, dimLabels: Record<string, string>, extra: string[] = []): string[] {
  const lines = Object.entries(cf.filters).map(([d, vs]) => `Filter – ${dimLabels[d] ?? d}: ${vs.map((v) => cf.labelOf(d, v)).join(', ')}`);
  return [...extra, ...(lines.length ? lines : ['Filters: none (all rows in the selected period)'])];
}

/** One string value kept in the address (for example the active tab of a page). Uses replace so tabs do not fill the history. */
export function useUrlValue(key: string, fallback: string): [string, (v: string) => void] {
  const [params] = useSearchParams();
  const write = useQueryWriter();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (v: string) =>
      write((next) => {
        if (v === fallback) next.delete(key);
        else next.set(key, v);
      }),
    [key, fallback, write],
  );
  return [value, set];
}

/**
 * The dealer profile is an overlay controlled by `?dealer=<ERP code>`. It opens on top of whatever page is showing, so
 * that page keeps its filters; closing it steps back in history when this app opened it, otherwise just removes the parameter.
 */
export function useDealerProfile() {
  const [params] = useSearchParams();
  const write = useQueryWriter();
  const navigate = useNavigate();
  const location = useLocation();
  const dealer = params.get('dealer');
  const open = useCallback(
    (key: string, tab?: string) => {
      const next = new URLSearchParams(params);
      next.set('dealer', key);
      if (tab) next.set('dtab', tab);
      else next.delete('dtab');
      navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { state: { dealerOpened: true } });
    },
    [params, navigate, location.pathname],
  );
  const close = useCallback(() => {
    if ((location.state as { dealerOpened?: boolean } | null)?.dealerOpened) {
      navigate(-1);
      return;
    }
    write((next) => {
      next.delete('dealer');
      next.delete('dtab');
    });
  }, [location.state, navigate, write]);
  return { dealer, open, close };
}
