import { ReactNode, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { InfoTip, Segmented } from '../../components/ui';
import { fInt } from '../../lib/export/format';
import { DataSpan, Win, comparisonChoices, reportingChoices } from '../../lib/metrics/growthWindows';

/** A period list with a "Custom range…" entry that reveals two date inputs. The label sits beside the list to save a row. */
function PeriodSelect({ label, value, options, min, max, onChange }: { label: string; value: string; options: Array<{ id: string; label: string }>; min: string; max: string; onChange: (id: string) => void }) {
  const isCustom = value.startsWith('c:');
  const [open, setOpen] = useState(isCustom);
  const [a, b] = isCustom ? value.slice(2).split('..') : ['', ''];
  const [from, setFrom] = useState(a);
  const [to, setTo] = useState(b);
  const known = options.some((o) => o.id === value);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{label}</span>
      <select
        aria-label={label}
        className="input h-8 w-auto max-w-[14rem] py-0 text-xs"
        value={isCustom || open ? 'custom' : known ? value : options[0]?.id}
        onChange={(e) => {
          if (e.target.value === 'custom') setOpen(true);
          else {
            setOpen(false);
            onChange(e.target.value);
          }
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        <option value="custom">{isCustom ? `Custom: ${a} to ${b}` : 'Custom range…'}</option>
      </select>
      {open && (
        <span className="flex flex-wrap items-center gap-1 text-xs">
          <input aria-label={`${label}: from date`} type="date" className="input h-8 py-0 text-xs" min={min} max={max} value={from} onChange={(e) => setFrom(e.target.value)} />
          –
          <input aria-label={`${label}: to date`} type="date" className="input h-8 py-0 text-xs" min={min} max={max} value={to} onChange={(e) => setTo(e.target.value)} />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!from || !to || from > to}
            onClick={() => {
              onChange(`c:${from}..${to}`);
              setOpen(false);
            }}
          >
            Apply
          </button>
        </span>
      )}
    </div>
  );
}

const Chip = ({ children, strong }: { children: ReactNode; strong?: boolean }) => <span className={`rounded-full px-2 py-0.5 text-[11px] ${strong ? 'bg-ink font-semibold text-white' : 'bg-slate-100 font-medium text-ink-2'}`}>{children}</span>;

export function Controls({
  span,
  reporting,
  comparison,
  rp,
  cp,
  cohort,
  onRp,
  onCp,
  onCohort,
  onReset,
  changed,
  dealerCount,
  notes,
  children,
}: {
  span: DataSpan;
  reporting: Win;
  comparison: Win | null;
  rp: string;
  cp: string;
  cohort: 'pilot' | 'all';
  onRp: (id: string) => void;
  onCp: (id: string) => void;
  onCohort: (c: 'pilot' | 'all') => void;
  onReset: () => void;
  changed: boolean;
  dealerCount: number;
  /** what to know about these periods; shown in a "?" popover */
  notes: string[];
  /** the filter bar, drawn inside the same card */
  children?: ReactNode;
}) {
  const rpOptions = reportingChoices(span);
  const cpOptions = comparisonChoices(span, reporting);
  const rpValue = rp || rpOptions[0].id;
  return (
    <section aria-label="Reporting controls" className="card mb-3 space-y-2 p-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PeriodSelect label="Period" value={rpValue} options={rpOptions} min={span.start} max={span.cutoff} onChange={onRp} />
        <PeriodSelect label="vs" value={cp} options={cpOptions} min={span.start} max={span.cutoff} onChange={onCp} />
        <Segmented<'pilot' | 'all'>
          label="Dealers shown"
          value={cohort}
          onChange={onCohort}
          options={[
            { value: 'pilot', label: 'Dealer App dealers' },
            { value: 'all', label: 'All dealers' },
          ]}
        />
        <span className="flex flex-wrap items-center gap-1.5" aria-live="polite">
          <Chip strong>{reporting.label}{reporting.partialMonth ? ' · to date' : ''}</Chip>
          <span className="text-[11px] text-ink-3">vs</span>
          <Chip>{comparison ? comparison.label : 'no comparison'}</Chip>
          {comparison && comparison.days === reporting.days && <Chip>{reporting.days} days</Chip>}
          <Chip>{fInt(dealerCount)} dealer{dealerCount === 1 ? '' : 's'}</Chip>
          {notes.length > 0 && <InfoTip title="About these periods" lines={notes.map((n) => ({ text: n }))} />}
        </span>
        <button type="button" className="btn btn-sm ml-auto h-7 py-0" onClick={onReset} disabled={!changed} title="Back to the default period, comparison and dealers. Imported data is not touched.">
          <RotateCcw size={13} aria-hidden /> Reset
        </button>
      </div>
      {children && <div className="border-t border-slate-100 pt-2">{children}</div>}
    </section>
  );
}
