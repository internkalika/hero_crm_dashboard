import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileWarning, Trash2 } from 'lucide-react';
import { useData } from '../../state/DataContext';
import { Badge, Confirm, Modal, Notice, SectionTitle } from '../../components/ui';
import { DataTable } from '../../components/DataTable';
import { SOURCES } from '../../lib/ingest/sources';
import { addHistory, removeDataset } from '../../lib/store/db';
import { fDate, fInt } from '../../lib/export/format';
import type { Col } from '../../lib/export/excel';
import type { DatasetMeta } from '../../lib/types';
import type { HistoryEntry } from '../../lib/store/db';
import { missingExpectedFiles, schemaChanges } from '../../lib/metrics/quality';
import { fmtSize } from './files';

export function Catalogue() {
  const { data, reload, history } = useData();
  const [confirmRemove, setConfirmRemove] = useState<DatasetMeta | null>(null);
  const [detail, setDetail] = useState<DatasetMeta | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const expectations = useMemo(() => missingExpectedFiles(data), [data]);
  const changes = useMemo(() => schemaChanges(data), [data]);

  const cols: Col<DatasetMeta>[] = [
    { id: 'src', header: 'Source', value: (d) => SOURCES[d.source].label, width: 200 },
    { id: 'sys', header: 'System', value: (d) => SOURCES[d.source].system },
    { id: 'file', header: 'File', value: (d) => d.fileName, width: 240 },
    { id: 'period', header: 'Period / scope', value: (d) => d.period ?? d.scope },
    { id: 'raw', header: 'Rows read', value: (d) => d.rawCount, format: 'int' },
    { id: 'valid', header: 'Records kept', value: (d) => d.validCount, format: 'int' },
    { id: 'dup', header: 'Duplicates', value: (d) => d.duplicateCount, format: 'int' },
    { id: 'inv', header: 'Invalid', value: (d) => d.invalidCount, format: 'int' },
    { id: 'tot', header: 'Totals row set aside', value: (d) => d.totalRowCount ?? 0, format: 'int', hidden: true },
    { id: 'flag', header: 'Flagged', value: (d) => d.flaggedCount, format: 'int' },
    { id: 'mode', header: 'Import mode', value: (d) => d.mode },
    { id: 'at', header: 'Imported', value: (d) => d.importedAt, format: 'datetime' },
    { id: 'size', header: 'File size', value: (d) => fmtSize(d.fileSize), hidden: true },
    {
      id: 'act',
      header: 'Actions',
      value: () => null,
      noExport: true,
      render: (d) => (
        <span className="flex gap-1">
          <button className="btn btn-sm" onClick={() => setDetail(d)}>Details</button>
          <button className="btn btn-sm" aria-label={`Remove ${d.fileName}`} onClick={() => setConfirmRemove(d)}><Trash2 size={12} /></button>
        </span>
      ),
    },
  ];
  const histCols: Col<HistoryEntry>[] = [
    { id: 'at', header: 'When', value: (h) => h.at, format: 'datetime' },
    { id: 'act', header: 'Action', value: (h) => h.action },
    { id: 'sum', header: 'Summary', value: (h) => h.summary, width: 360 },
    { id: 'ok', header: 'Result', value: (h) => (h.ok ? 'OK' : 'Problems'), render: (h) => <Badge tone={h.ok ? 'good' : 'warn'}>{h.ok ? 'OK' : 'Problems'}</Badge> },
  ];

  const doRemove = async (d: DatasetMeta) => {
    try {
      await removeDataset(d.id);
      await addHistory({ at: new Date().toISOString(), action: 'remove', ok: true, summary: `Removed ${d.fileName} (${SOURCES[d.source].label}, ${d.period ?? d.scope}).` });
      await reload();
      setMsg({ tone: 'good', text: `Removed ${d.fileName}.` });
    } finally {
      setConfirmRemove(null);
    }
  };
  const missing = expectations.filter((e) => e.missing.length > 0 && e.expected.length > 0);

  return (
    <>
      <SectionTitle>What is loaded in this browser</SectionTitle>
      {msg && <div className="mb-3"><Notice tone={msg.tone} title={msg.text} /></div>}
      {data.datasets.length === 0 ? (
        <Notice tone="neutral" title="Nothing imported yet">Use the steps above to bring in the MIS files. Nothing is estimated.</Notice>
      ) : (
        <DataTable title={`Imported datasets (${data.datasets.length})`} rows={data.datasets} columns={cols} getRowId={(d) => d.id} exportName="Imported_datasets" pageSize={25} />
      )}

      {missing.length > 0 && data.datasets.length > 0 && (
        <div className="mt-3 space-y-2">
          <Notice tone="warn" title="Expected files not found">
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m) => (
                <li key={m.source}>
                  <strong>{m.label}</strong>: {m.missing.join(', ')}
                </li>
              ))}
            </ul>
            <div className="mt-1 text-xs">These are the file names this app was built against. A differently named file is fine if it is recognised by its columns; this list only warns about gaps.</div>
          </Notice>
        </div>
      )}
      {changes.length > 0 && (
        <div className="mt-3">
          <Notice tone="warn" title="Column layout changed between files of the same kind">
            <ul className="mt-1 list-disc pl-5 text-xs">
              {changes.map((c, i) => (
                <li key={i}>
                  {SOURCES[c.source].label}: <strong>{c.file}</strong> vs {c.baseline}. {c.added.length > 0 && <>New: {c.added.join(', ')}. </>}
                  {c.removed.length > 0 && <>Missing: {c.removed.join(', ')}.</>}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <SectionTitle>Import history</SectionTitle>
      {history.length === 0 ? <p className="text-sm text-ink-3">No imports yet.</p> : <DataTable rows={history} columns={histCols} getRowId={(h) => String(h.id)} exportName="Import_history" pageSize={10} />}

      <Confirm open={!!confirmRemove} danger title="Remove this dataset?" confirmLabel="Remove" onCancel={() => setConfirmRemove(null)} onConfirm={() => confirmRemove && doRemove(confirmRemove)} message={confirmRemove && <>This removes <strong>{confirmRemove.fileName}</strong> ({fInt(confirmRemove.validCount)} records) from this browser. Dashboards will recalculate without it. You can import the file again at any time.</>} />
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.fileName ?? ''} width="max-w-2xl">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-ink-3">Source</span><span>{SOURCES[detail.source].label}</span>
              <span className="text-ink-3">Sheet</span><span>{detail.sheet ?? '—'}</span>
              <span className="text-ink-3">Period</span><span>{detail.period ?? detail.scope}</span>
              <span className="text-ink-3">Data covers</span><span>{detail.periodStart ? `${fDate(detail.periodStart)} – ${fDate(detail.periodEnd)}` : '—'}</span>
              <span className="text-ink-3">Rows read / kept</span><span>{fInt(detail.rawCount)} / {fInt(detail.validCount)}</span>
              <span className="text-ink-3">Duplicates / invalid / totals row / flagged</span><span>{fInt(detail.duplicateCount)} / {fInt(detail.invalidCount)} / {fInt(detail.totalRowCount ?? 0)} / {fInt(detail.flaggedCount)}</span>
              <span className="text-ink-3">Mapping version</span><span>{detail.mappingVersion}</span>
            </div>
            <div>
              <div className="label mb-1">How the file was read</div>
              <ul className="list-disc space-y-1 pl-5 text-ink-2">{detail.inference.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
            <div>
              <div className="label mb-1">Column mapping</div>
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(detail.mapping).map(([k, v]) => (
                    <tr key={k} className="border-b border-slate-100"><td className="py-1 pr-3 text-ink-3">{SOURCES[detail.source].fields[k]?.label ?? k}</td><td>{v}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export const OkIcon = CheckCircle2;
export const WarnIcon = AlertTriangle;
export const FileWarnIcon = FileWarning;
