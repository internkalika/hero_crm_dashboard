import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DatabaseZap, FileQuestion } from 'lucide-react';
import type { SourceType } from '../lib/types';
import { SOURCES } from '../lib/ingest/sources';
import { useData } from '../state/DataContext';
import { isBounded, monthInPeriod } from '../lib/metrics/period';
import { monthLabel } from '../lib/util/parse';
import { Notice, Spinner } from './ui';

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-ink-3">{icon ?? <FileQuestion size={32} />}</div>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <div className="max-w-xl text-sm text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

/** Wraps a page: shows loading / storage error / "import this file first" until the required sources exist. */
export function DataGate({ need, any, children, what }: { need?: SourceType[]; any?: SourceType[]; children: ReactNode; what: string }) {
  const { data, loading, error } = useData();
  if (loading && data.datasets.length === 0) return <Spinner label="Loading saved data" />;
  if (error) return <Notice tone="bad" title="Saved data could not be read">{error}. Your browser may be blocking site storage (private mode?). The Import Centre still lets you load files for this session, but they will not persist.</Notice>;
  const has = (s: SourceType) => data.datasets.some((d) => d.source === s);
  const missing = (need ?? []).filter((s) => !has(s));
  const noneOfAny = any && !any.some(has);
  if (missing.length || noneOfAny) {
    const list = noneOfAny ? any! : missing;
    return (
      <EmptyState
        icon={<DatabaseZap size={32} />}
        title={`No data yet for ${what}`}
        action={
          <Link to="/import" className="btn btn-primary mt-2">
            Go to Data Import
          </Link>
        }
      >
        This page needs: <strong>{list.map((s) => SOURCES[s].label).join(', ')}</strong>. Import the file(s) and this page will fill in. Nothing is estimated or pre-loaded.
      </EmptyState>
    );
  }
  return <>{children}</>;
}

/** Tells the user when the selected reporting period has no data for this page's source(s). */
export function usePeriodCoverage(months: string[]) {
  const { period } = useData();
  const inPeriod = months.filter((m) => monthInPeriod(m, period));
  const bounded = isBounded(period);
  return {
    months,
    inPeriod,
    empty: bounded && inPeriod.length === 0,
    partial: bounded && inPeriod.length > 0 && inPeriod.length < months.length,
    available: months.length ? `${monthLabel(months[0])}${months.length > 1 ? ` – ${monthLabel(months[months.length - 1])}` : ''}` : 'none',
  };
}

export function PeriodGate({ months, system, children }: { months: string[]; system: string; children: ReactNode }) {
  const { period } = useData();
  const cov = usePeriodCoverage(months);
  if (cov.empty) {
    return (
      <EmptyState title={`No ${system} data in ${period.label}`}>
        {system} data covers <strong>{cov.available}</strong>. Choose one of those periods in the selector above.
      </EmptyState>
    );
  }
  return <>{children}</>;
}

export function Unavailable({ children }: { children: ReactNode }) {
  return <Notice tone="neutral" title="Not available from the supplied files">{children}</Notice>;
}
