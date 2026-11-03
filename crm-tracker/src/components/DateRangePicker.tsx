import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

/**
 * The one reporting-range control: a calendar with a start date and an end date, Apply and Reset.
 * Dates are plain 'YYYY-MM-DD' strings (no time zones). Days outside [min, max] (the span the loaded data covers) cannot be chosen.
 */
export interface DateRangePickerProps {
  min: string | null;
  max: string | null;
  /** null = everything available */
  value: { from: string; to: string } | null;
  onApply: (from: string, to: string) => void;
  onReset: () => void;
  disabled?: boolean;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dow = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday first
export const fmtDay = (s: string) => `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1].slice(0, 3)} ${s.slice(0, 4)}`;
const shift = (ym: string, by: number) => {
  const i = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + by;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
};

export function rangeLabel(v: { from: string; to: string } | null, min: string | null, max: string | null): string {
  if (v) return v.from === v.to ? fmtDay(v.from) : `${fmtDay(v.from)} – ${fmtDay(v.to)}`;
  return min && max ? `All data · ${fmtDay(min)} – ${fmtDay(max)}` : 'No data loaded';
}

function Month({ ym, min, max, from, to, hover, onPick, onHover }: { ym: string; min: string; max: string; from: string | null; to: string | null; hover: string | null; onPick: (d: string) => void; onHover: (d: string | null) => void }) {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7);
  const lead = dow(y, m, 1);
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: daysIn(y, m) }, (_, i) => iso(y, m, i + 1))];
  const end = to ?? (from && hover && hover >= from ? hover : null);
  return (
    <div className="w-[15.5rem]">
      <div className="mb-1 text-center text-sm font-semibold text-ink">{MONTHS[m - 1]} {y}</div>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium uppercase text-ink-3">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 text-center" role="grid" aria-label={`${MONTHS[m - 1]} ${y}`}>
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const off = d < min || d > max;
          const isStart = d === from;
          const isEnd = d === end;
          const inside = !!from && !!end && d > from && d < end;
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              aria-label={fmtDay(d)}
              aria-pressed={isStart || isEnd}
              data-date={d}
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              className={clsx(
                'h-8 text-xs tnum focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600',
                off && 'cursor-not-allowed text-ink-3/40 line-through decoration-transparent',
                !off && !isStart && !isEnd && !inside && 'text-ink hover:bg-hero-50',
                inside && 'bg-hero-100 text-ink',
                (isStart || isEnd) && 'rounded-md bg-hero-600 font-semibold text-white',
              )}
            >
              {+d.slice(8, 10)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ min, max, value, onApply, onReset, disabled }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<string>(() => (value?.from ?? max ?? '2000-01').slice(0, 7));
  const clampView = (ym: string) => (min && ym < min.slice(0, 7) ? min.slice(0, 7) : ym);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const openIt = () => {
    setFrom(value?.from ?? null);
    setTo(value?.to ?? null);
    setHover(null);
    setView(clampView(shift((value?.to ?? max ?? '2000-01').slice(0, 7), -1)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const presets = useMemo(() => {
    if (!min || !max) return [];
    const lm = max.slice(0, 7);
    const pm = shift(lm, -1);
    const monthSpan = (ym: string) => ({ from: ym < min.slice(0, 7) ? min : iso(+ym.slice(0, 4), +ym.slice(5, 7), 1), to: ym === lm ? max : iso(+ym.slice(0, 4), +ym.slice(5, 7), daysIn(+ym.slice(0, 4), +ym.slice(5, 7))) });
    const out: Array<{ label: string; from: string; to: string }> = [{ label: 'All data', from: min, to: max }];
    out.push({ label: MONTHS[+lm.slice(5, 7) - 1] + ' ' + lm.slice(0, 4), ...monthSpan(lm) });
    if (pm >= min.slice(0, 7)) out.push({ label: MONTHS[+pm.slice(5, 7) - 1] + ' ' + pm.slice(0, 4), ...monthSpan(pm) });
    return out;
  }, [min, max]);

  if (!min || !max) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-ink-3"><CalendarDays size={14} aria-hidden /> No dated data</span>;
  }
  const pick = (d: string) => {
    if (!from || (from && to)) {
      setFrom(d);
      setTo(null);
    } else if (d < from) {
      setTo(from);
      setFrom(d);
    } else setTo(d);
  };
  const ready = !!from && !!to && from <= to;
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        className="btn gap-2 py-1 text-xs"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Reporting range: ${rangeLabel(value, min, max)}. Change`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openIt())}
      >
        <CalendarDays size={14} aria-hidden />
        <span className="tnum" data-testid="range-label">{rangeLabel(value, min, max)}</span>
      </button>
      {open && (
        <div ref={box} role="dialog" aria-label="Choose reporting range" className="absolute right-0 z-50 mt-1 max-w-[calc(100vw-1.5rem)] rounded-lg border border-slate-200 bg-surface p-3 shadow-pop">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p.label} type="button" className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs text-ink-2 hover:border-hero-600 hover:text-hero-700" onClick={() => (setFrom(p.from), setTo(p.to), setView(clampView(p.from.slice(0, 7))))}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mb-1 flex items-center justify-between">
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Previous month" disabled={view <= min.slice(0, 7)} onClick={() => setView(shift(view, -1))}><ChevronLeft size={16} /></button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Next month" disabled={shift(view, 1) >= max.slice(0, 7)} onClick={() => setView(shift(view, 1))}><ChevronRight size={16} /></button>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row" onMouseLeave={() => setHover(null)}>
            <Month ym={view} min={min} max={max} from={from} to={to} hover={hover} onPick={pick} onHover={setHover} />
            <div className="hidden sm:block"><Month ym={shift(view, 1)} min={min} max={max} from={from} to={to} hover={hover} onPick={pick} onHover={setHover} /></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
            <div className="text-xs text-ink-2" aria-live="polite" data-testid="range-draft">
              {from && to ? `${fmtDay(from)} – ${fmtDay(to)}` : from ? `${fmtDay(from)} – choose an end date` : 'Choose a start date'}
              <span className="ml-2 text-ink-3">Data: {fmtDay(min)} – {fmtDay(max)}</span>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-sm" onClick={() => (onReset(), setOpen(false))}>Reset</button>
              <button type="button" className="btn btn-sm btn-primary" disabled={!ready} onClick={() => (onApply(from as string, to as string), setOpen(false))}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
