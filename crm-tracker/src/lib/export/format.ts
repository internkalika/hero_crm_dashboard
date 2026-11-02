// Display + export formatting shared by tables, KPI cards and the workbook builder.
export type ColFormat = 'text' | 'int' | 'dec' | 'inr' | 'pct' | 'date' | 'datetime' | 'days' | 'hours';

export type CellValue = string | number | boolean | null | undefined;

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const NA = '—';

export const fInt = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? NA : nf0.format(v));
export const fDec = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? NA : d === 1 ? nf1.format(v) : nf2.format(v));
export const fInr = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? NA : `${v < 0 ? '−' : ''}₹${nf0.format(Math.abs(v))}`);
export const fPct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? NA : `${(v * 100).toFixed(d)}%`);

/** Compact Indian units for KPI cards: ₹1.13 Cr, ₹4.5 L, ₹12.3 K */
export function fInrCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)} K`;
  return `${s}₹${nf0.format(a)}`;
}
export function fCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(1)} K`;
  return `${s}${nf0.format(a)}`;
}

export function fDate(v: string | null | undefined): string {
  if (!v) return NA;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[3]} ${names[+m[2] - 1]} ${m[1]}`;
}

export function formatCell(v: CellValue, fmt: ColFormat = 'text'): string {
  if (v === null || v === undefined || v === '') return NA;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  switch (fmt) {
    case 'int': return typeof v === 'number' ? fInt(v) : String(v);
    case 'dec': return typeof v === 'number' ? fDec(v) : String(v);
    case 'inr': return typeof v === 'number' ? fInr(v) : String(v);
    case 'pct': return typeof v === 'number' ? fPct(v) : String(v);
    case 'days': return typeof v === 'number' ? `${fDec(v, 1)} d` : String(v);
    case 'hours': return typeof v === 'number' ? `${fDec(v, 1)} h` : String(v);
    case 'date': return fDate(String(v));
    case 'datetime': return fDate(String(v)) + (String(v).length > 10 ? ` ${String(v).slice(11, 16)}` : '');
    default: return String(v);
  }
}

export const isNumericFormat = (f: ColFormat) => f === 'int' || f === 'dec' || f === 'inr' || f === 'pct' || f === 'days' || f === 'hours';

/** Signed change helper for comparison tables: +1,234 / −5.0% */
export function fDelta(v: number | null | undefined, fmt: 'int' | 'inr' | 'pct' | 'dec' = 'int'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  const body = fmt === 'pct' ? fPct(a) : fmt === 'inr' ? fInr(a) : fmt === 'dec' ? fDec(a) : fInt(a);
  return `${sign}${body}`;
}
