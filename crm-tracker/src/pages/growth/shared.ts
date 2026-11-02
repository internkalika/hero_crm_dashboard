// State and small helpers shared by the sections of the Dealer App vs SFA Comparison page.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CrossFilter, useCrossFilter, useQueryWriter } from '../../components/filters';
import { ChannelId, GrowthInput, Tone, defaultGrowthInput } from '../../lib/metrics/growth';
import { fInrCompact, fInt } from '../../lib/export/format';

/** The dimension names this page writes into the address. */
export const DIM_LABELS: Record<string, string> = {
  dealer: 'Dealer',
  db: 'DB code',
  outlet: 'Outlet ID',
  zone: 'Zone',
  city: 'City / territory',
  channel: 'Channel',
  model: 'Model',
  size: 'Wheel size',
  status: 'Order status',
};

/** The sections of the page (the id after `g-` in the element id, and the label of its chip). */
export const SECTIONS: Array<[string, string]> = [
  ['kpis', 'Summary'],
  ['drivers', 'What changed'],
  ['trends', 'Trends'],
  ['adoption', 'Adoption'],
  ['dealers', 'Dealers'],
  ['table', 'Comparison table'],
  ['profit', 'Profitability'],
  ['mbd', 'MBD'],
  ['orders', 'Orders'],
];
/** Older links name sections by their former id; they land on the nearest section. */
export const SECTION_ALIAS: Record<string, string> = { charts: 'trends', summary: 'kpis' };
export const sectionId = (show: string): string | null => {
  const id = SECTION_ALIAS[show] ?? show;
  return SECTIONS.some(([s]) => s === id) ? id : null;
};

const PAGE_KEYS = ['rp', 'cp', 'cohort', 'cls', 'show'];

export interface GrowthState {
  cf: CrossFilter;
  input: GrowthInput;
  cls: string;
  setRp: (id: string) => void;
  setCp: (id: string) => void;
  setCohort: (c: 'pilot' | 'all') => void;
  setCls: (c: string) => void;
  /** back to the default period, comparison, dealers and no filters; the imported data is untouched */
  reset: () => void;
  /** is anything different from the defaults? */
  changed: boolean;
}

export function useGrowthState(): GrowthState {
  const cf = useCrossFilter();
  const [params] = useSearchParams();
  const write = useQueryWriter();
  const rp = params.get('rp') ?? '';
  const cp = params.get('cp') ?? 'prev';
  const cohort = params.get('cohort') === 'all' ? 'all' : 'pilot';
  const cls = params.get('cls') ?? '';

  const setKey = useCallback((key: string, value: string, fallback: string) => write((q) => (value === fallback ? q.delete(key) : q.set(key, value))), [write]);
  const reset = useCallback(
    () =>
      write((q) => {
        PAGE_KEYS.forEach((k) => q.delete(k));
        [...q.keys()].forEach((k) => (k.startsWith('f.') || k.startsWith('l.')) && q.delete(k));
      }),
    [write],
  );

  const input = useMemo<GrowthInput>(() => {
    const f = cf.filters;
    return {
      ...defaultGrowthInput(),
      rp,
      cp,
      cohort,
      dealers: f.dealer ?? [],
      dbs: f.db ?? [],
      outlets: f.outlet ?? [],
      zones: f.zone ?? [],
      cities: f.city ?? [],
      channels: (f.channel ?? []).filter((c): c is ChannelId => c === 'dealer' || c === 'ds'),
      models: f.model ?? [],
      sizes: f.size ?? [],
    };
  }, [cf.filters, rp, cp, cohort]);

  return {
    cf,
    input,
    cls,
    setRp: (id) => setKey('rp', id, ''),
    setCp: (id) => setKey('cp', id, 'prev'),
    setCohort: (c) => setKey('cohort', c, 'pilot'),
    setCls: (c) => setKey('cls', c, ''),
    reset,
    changed: cf.count > 0 || !!rp || cp !== 'prev' || cohort !== 'pilot' || !!cls,
  };
}

/* ------------------------------- display helpers ------------------------------- */

export const CH = {
  dealer: { label: 'Dealer App', color: '#C8202F' },
  ds: { label: 'DataSense SFA', color: '#2a78d6' },
  combined: { label: 'Combined', color: '#52514E' },
} as const;

export const toneClass: Record<Tone, string> = {
  good: 'bg-good-soft text-good-text',
  warn: 'bg-warn-soft text-warn-text',
  bad: 'bg-bad-soft text-bad-text',
  neutral: 'bg-slate-100 text-ink-2',
};

export const toneWord: Record<Tone, string> = { good: 'Better', warn: 'Flat or unclear', bad: 'Worse', neutral: 'No comparison' };

export const fSignedPct = (v: number | null | undefined, d = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(d)}%`);
export const fSignedInr = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}${fInrCompact(Math.abs(v))}`);
export const fSignedInt = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}${fInt(Math.abs(v))}`);

/** A KPI value in its unit. */
export function fUnit(v: number | null | undefined, unit: 'inr' | 'int' | 'dec' | 'pct' | 'per100'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (unit === 'inr') return fInrCompact(v);
  if (unit === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (unit === 'per100') return v.toFixed(1);
  if (unit === 'dec') return v.toFixed(2);
  return fInt(v);
}

export const fSignedUnit = (v: number | null | undefined, unit: 'inr' | 'int' | 'dec' | 'pct' | 'per100'): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−' : '+';
  const a = Math.abs(v);
  if (unit === 'pct') return `${sign}${(a * 100).toFixed(1)} pts`;
  return `${sign}${fUnit(a, unit)}`;
};
