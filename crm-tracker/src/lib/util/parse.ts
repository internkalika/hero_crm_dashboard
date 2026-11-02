// Low-level, deterministic parsing helpers. No business logic lives here.
import type { Cell } from '../types';

export const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export const str = (v: unknown): string | null => {
  if (isBlank(v)) return null;
  return String(v).replace(/ /g, ' ').trim();
};

/** Header normalisation: lower-case alphanumerics only. */
export const normHeader = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Parses numbers written in plain, Western ("1,234.5") or Indian ("1,17,23,38,876.11") grouping.
 * Blank is NOT zero: returns null. Unparseable text returns NaN so callers can flag it.
 */
export function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'boolean') return NaN;
  let s = String(v).replace(/ /g, ' ').trim();
  if (s === '' || s === '-' || s === '--' || s === '---' || /^n\/?a$/i.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[₹$€£]|rs\.?|inr/gi, '').replace(/\s+/g, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d[\d,]*(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return NaN;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

/** Number or null (NaN folded to null). Use parseNumber when you need to distinguish. */
export const num = (v: unknown): number | null => {
  const n = parseNumber(v);
  return n === null || Number.isNaN(n) ? null : n;
};

/* ---------------------------------- dates ---------------------------------- */

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
export const monthNumber = (token: string): number | null => MONTHS[token.toLowerCase()] ?? null;

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function build(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0, hasTime = false): ParsedDate | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const date = `${y}-${pad(m)}-${pad(d)}`;
  return { date, dateTime: hasTime ? `${date}T${pad(hh)}:${pad(mm)}:${pad(ss)}` : null };
}

export interface ParsedDate {
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DDTHH:mm:ss when a time was present */
  dateTime: string | null;
}

const RE_ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const RE_NUM = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i;
const RE_MON = /^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i;

function to24(h: number, ampm?: string) {
  if (!ampm) return h;
  const p = ampm.toUpperCase();
  if (p === 'PM' && h < 12) return h + 12;
  if (p === 'AM' && h === 12) return 0;
  return h;
}

export function parseDate(v: unknown, order: DateOrder = 'dmy'): ParsedDate | null {
  if (isBlank(v)) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return build(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds(), true);
  }
  if (typeof v !== 'string') return null;
  const s = v.replace(/ /g, ' ').trim();
  let m = RE_ISO.exec(s);
  if (m) return build(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, !!m[4]);
  m = RE_MON.exec(s);
  if (m) {
    const mon = monthNumber(m[2]);
    if (!mon) return null;
    let y = +m[3];
    if (m[3].length === 2) y += 2000;
    return build(y, mon, +m[1], m[4] ? to24(+m[4], m[7]) : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, !!m[4]);
  }
  m = RE_NUM.exec(s);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += 2000;
    const a = +m[1];
    const b = +m[2];
    const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    const hh = m[4] ? to24(+m[4], m[7]) : 0;
    return build(y, mo, d, hh, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, !!m[4]);
  }
  return null;
}

/**
 * Looks at every value of a column to decide whether ambiguous numeric dates are day-first or
 * month-first. Day-first is the default (India). ISO values never influence the result.
 */
export function detectDateOrder(values: unknown[]): DateOrder {
  let aOver12 = false;
  let bOver12 = false;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = RE_NUM.exec(v.trim());
    if (!m) continue;
    if (+m[1] > 12) aOver12 = true;
    if (+m[2] > 12) bOver12 = true;
  }
  if (bOver12 && !aOver12) return 'mdy';
  return 'dmy';
}

export const monthOf = (iso: string | null | undefined): string | null => (iso && iso.length >= 7 ? iso.slice(0, 7) : null);

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function monthLabel(m: string): string {
  const [y, mo] = m.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[+mo - 1]} ${y}`;
}

/** "Data from Sept to Oct" for the months a comparison covers ("Data for Oct" for a single month, "" for none). */
export function dataRangeLabel(months: string[]): string {
  if (months.length === 0) return '';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const name = (m: string) => names[+m.split('-')[1] - 1];
  const first = name(months[0]);
  const last = name(months[months.length - 1]);
  return first === last ? `Data for ${first}` : `Data from ${first} to ${last}`;
}

export function monthEnd(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${pad(daysInMonth(y, mo))}`;
}

export function monthsBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let y = +startIso.slice(0, 4);
  let m = +startIso.slice(5, 7);
  const ey = +endIso.slice(0, 4);
  const em = +endIso.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Excel-style duration text ("1 Hr 25 Mins", "55 Days 9 Hrs 1 Min") -> minutes. */
export function parseTatMinutes(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  let total = 0;
  let hit = false;
  const re = /(\d+)\s*(day|days|hr|hrs|hour|hours|min|mins|minute|minutes|sec|secs)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    hit = true;
    const n = +m[1];
    const u = m[2].toLowerCase();
    if (u.startsWith('d')) total += n * 1440;
    else if (u.startsWith('h')) total += n * 60;
    else if (u.startsWith('m')) total += n;
    else total += n / 60;
  }
  return hit ? total : null;
}

/* ---------------------------------- ids & names ---------------------------------- */

/** "UNITED CYCLE STORES[ 9402 ]" -> { name: 'UNITED CYCLE STORES', id: '9402' } */
export function extractBracketId(v: unknown): { name: string; id: string | null } {
  const s = str(v) ?? '';
  const m = /^(.*?)\s*\[\s*([^\]]*?)\s*\]\s*$/.exec(s);
  if (!m) return { name: s, id: null };
  return { name: m[1].trim(), id: m[2].trim() || null };
}

/** Stable dealer/ERP key: trimmed, upper-case, leading zeros removed from purely numeric codes. */
export function dealerKeyOf(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let k = s.replace(/^'+/, '').replace(/\.0+$/, '').toUpperCase();
  if (/^\d+$/.test(k)) k = k.replace(/^0+(?=\d)/, '');
  if (k === '0' || k === '') return null;
  return k;
}

export const isNumericCode = (k: string | null | undefined): boolean => !!k && /^\d+$/.test(k);

export const normName = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const maskMobile = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 6) return '••••';
  return `${digits.slice(0, 2)}••••••${digits.slice(-4)}`;
};

export const titleCase = (s: string): string =>
  s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export const cellStr = (v: Cell | undefined): string | null => str(v);

/** Excel column letter for a 0-based index (0 -> A). */
export function colLetter(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function sum(values: Array<number | null | undefined>): number {
  let t = 0;
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) t += v;
  return t;
}

export function safeDiv(a: number, b: number): number | null {
  return b === 0 || !Number.isFinite(b) ? null : a / b;
}

/** stable, order-independent id for strings (FNV-1a) */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
