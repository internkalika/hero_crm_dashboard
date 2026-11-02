// The grouped dealer comparison table (Dealer App next to DataSense, dealer by dealer) and the dealer-name matches that need
// a person's decision. The months compared are the ones both systems cover in the header period ("Data from Sept to Oct").
import { useMemo } from 'react';
import { Check, X as XIcon } from 'lucide-react';
import { useData } from '../../state/DataContext';
import { ComparisonTable } from '../../components/ComparisonTable';
import { DataTable } from '../../components/DataTable';
import { Badge, Segmented } from '../../components/ui';
import { useDealerProfile, useUrlValue } from '../../components/filters';
import type { Col } from '../../lib/export/excel';
import { downloadCsv, downloadXlsx, stamp } from '../../lib/export/excel';
import { comparisonTableSheet } from '../../lib/export/comparison';
import { fInt } from '../../lib/export/format';
import { MatchCandidate, buildComparison } from '../../lib/metrics/comparison';
import { ComparisonRow, comparisonRows } from '../../lib/metrics/comparisonTable';
import { dataRangeLabel, titleCase } from '../../lib/util/parse';
import { periodNote } from '../common';

export type Scope = 'app' | 'common' | 'dealer_only' | 'ds_only' | 'all';
export const SCOPES: Scope[] = ['app', 'common', 'dealer_only', 'ds_only', 'all'];

export function ComparisonTableSection({ dealerOk }: { dealerOk: (dealerCode: string) => boolean }) {
  const { data, period, settings, crosswalk, setCrosswalk } = useData();
  const { open } = useDealerProfile();
  const [scopeRaw, setScope] = useUrlValue('scope', 'app');
  const scope = (SCOPES.includes(scopeRaw as Scope) ? scopeRaw : 'app') as Scope;

  const res = useMemo(() => buildComparison(data, period, settings, crosswalk), [data, period, settings, crosswalk]);
  const dataRange = dataRangeLabel(res.months); // "Data from Sept to Oct"
  const allRows = useMemo(() => comparisonRows(res), [res]);
  const appRows = useMemo(() => {
    const onApp = new Set(res.rows.filter((r) => r.onDealerApp).map((r) => r.key));
    return allRows.filter((r) => onApp.has(r.key));
  }, [res.rows, allRows]);
  const inScope = useMemo(() => (scope === 'all' ? allRows : scope === 'app' ? appRows : allRows.filter((r) => r.match === (scope === 'common' ? 'matched' : scope))), [allRows, appRows, scope]);
  const rows = useMemo(() => inScope.filter((r) => dealerOk(r.dbCode)), [inScope, dealerOk]);

  const notes = [periodNote(period), `${dataRange || 'No months in common'} (months compared: ${res.months.join(', ') || 'none'})`, 'A dealer with 0 DataSense orders placed its orders only through the Dealer App.', 'Matching uses the ERP dealer code; names are never auto-merged.'];
  const download = async (list: ComparisonRow[], kind: 'xlsx' | 'csv') => {
    const sheet = comparisonTableSheet('Comparison table', list, `${notes[1]}; ${list.length} dealers`);
    const file = `Dealer_vs_DataSense_comparison_table_${stamp()}`;
    if (kind === 'csv') downloadCsv(sheet, file);
    else await downloadXlsx([sheet], { title: 'CRM Tracker – Dealer App vs DataSense: comparison table', notes }, file);
  };

  const decide = (c: MatchCandidate, decision: 'accepted' | 'rejected' | null) => {
    const cur = { ...crosswalk };
    const list = (cur[c.dealerKey] ?? []).filter((d) => d.dsKey !== c.dsKey);
    if (decision) list.push({ dsKey: c.dsKey, decision });
    if (list.length) cur[c.dealerKey] = list;
    else delete cur[c.dealerKey];
    setCrosswalk(cur);
  };
  const candCols: Col<MatchCandidate>[] = [
    { id: 'dn', header: 'Dealer App', value: (c) => `${titleCase(c.dealerName.toLowerCase())} (${c.dealerKey})`, width: 240 },
    { id: 'sn', header: 'DataSense', value: (c) => `${titleCase(c.dsName.toLowerCase())} (${c.dsKey})`, width: 240 },
    { id: 'o', header: 'DataSense orders', value: (c) => c.dsOrders, format: 'int' },
    { id: 'dec', header: 'Decision', value: (c) => c.decision ?? 'Pending', render: (c) => (c.decision ? <Badge tone={c.decision === 'accepted' ? 'good' : 'neutral'}>{c.decision === 'accepted' ? 'Same dealer' : 'Different dealers'}</Badge> : <Badge tone="warn">Review</Badge>) },
    {
      id: 'act',
      header: 'Action',
      value: () => null,
      noExport: true,
      render: (c) => (
        <span className="flex gap-1">
          <button className="btn btn-sm" onClick={() => decide(c, 'accepted')}><Check size={12} /> Same dealer</button>
          <button className="btn btn-sm" onClick={() => decide(c, 'rejected')}><XIcon size={12} /> Different</button>
          {c.decision && <button className="btn btn-ghost btn-sm" onClick={() => decide(c, null)}>Undo</button>}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Scope>
          label="Dealers shown"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'app', label: `Dealer App dealers (${appRows.length})` },
            { value: 'common', label: `Ordering in both (${res.counts.common})` },
            { value: 'dealer_only', label: `Only via Dealer App (${res.counts.dealerOnly})` },
            { value: 'ds_only', label: `DataSense only (${fInt(res.counts.dsOnly)})` },
            { value: 'all', label: `All (${fInt(allRows.length)})` },
          ]}
        />
        {dataRange && <Badge tone="info" icon={false}>{dataRange}</Badge>}
      </div>
      <ComparisonTable rows={rows} onOpen={(r) => open(r.key, 'comparison')} onDownload={download} emptyText="No dealers in this group for the selected period." />
      {res.candidates.length > 0 && (
        <details className="card p-3">
          <summary className="cursor-pointer text-sm font-semibold">Possible dealer matches to review ({res.candidates.length})</summary>
          <div className="mt-3">
            <DataTable rows={res.candidates} columns={candCols} getRowId={(c) => `${c.dealerKey}-${c.dsKey}`} exportName="Dealer_name_candidates" pageSize={10} />
          </div>
        </details>
      )}
    </div>
  );
}
