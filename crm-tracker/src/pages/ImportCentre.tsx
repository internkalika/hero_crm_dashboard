import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FolderUp, FileUp, UploadCloud } from 'lucide-react';
import clsx from 'clsx';
import { useData } from '../state/DataContext';
import { Badge, Card, Notice, PageHeader, Spinner } from '../components/ui';
import { useAdmin } from '../state/AdminContext';
import { AdminLogin } from '../components/AdminLogin';
import { SOURCES, SOURCE_TYPES } from '../lib/ingest/sources';
import type { SourceType } from '../lib/types';
import { ImportItem, commitItems, expandMonths, itemsFromAnalyses, effectiveMapping, missingForItem, normalizeItem, planItems, sheetColumns, batchConflicts, CommitResult } from '../lib/ingest/session';
import type { Mode } from '../lib/ingest/pipeline';
import { fDate, fInt } from '../lib/export/format';
import { Catalogue } from './import/Catalogue';
import { filesFromDrop, filesToInputs, fmtSize } from './import/files';
import type { SheetPreview } from '../lib/ingest/pipeline';

const STEPS = ['Upload', 'Identify', 'Preview', 'Validate', 'Map', 'Reconcile', 'Refresh', 'Confirm'] as const;

const MODE_LABEL: Record<Mode, string> = { add: 'Add as new', replace: 'Replace existing', merge: 'Merge into existing (by record key)', skip: 'Skip this file' };

function Stepper({ step, reached }: { step: number; reached: number }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-1 text-xs" aria-label="Import steps">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1" aria-current={i === step ? 'step' : undefined}>
          <span className={clsx('flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-semibold', i === step ? 'bg-hero-600 text-white' : i < reached ? 'bg-good text-white' : 'bg-slate-200 text-ink-2')}>{i < reached && i !== step ? <Check size={12} /> : i + 1}</span>
          <span className={clsx('font-medium', i === step ? 'text-ink' : 'text-ink-3')}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-slate-300" />}
        </li>
      ))}
    </ol>
  );
}

function SamplePreview({ sheet }: { sheet: SheetPreview }) {
  return (
    <div className="overflow-auto rounded border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50">
          <tr>{sheet.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-semibold text-ink-2">{c}</th>)}</tr>
        </thead>
        <tbody>
          {sheet.sample.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {sheet.columns.map((c) => <td key={c} className="max-w-[14rem] truncate whitespace-nowrap px-2 py-1" title={String(r[c] ?? '')}>{String(r[c] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportWizard() {
  const { data, client, reload, published } = useData();
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; file: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skippedNames, setSkippedNames] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const go = (n: number) => {
    setStep(n);
    setReached((r) => Math.max(r, n));
  };
  const patch = (id: string, p: Partial<ImportItem>) => setItems((cur) => cur.map((it) => (it.analysis.id === id ? { ...it, ...p } : it)));

  const ingestFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      setBusy('analyze');
      try {
        const { inputs, skipped } = await filesToInputs(files);
        setSkippedNames(skipped);
        if (!inputs.length) {
          setError(files.length ? 'None of those files is a CSV, Excel (.xls/.xlsx) or ZIP file.' : 'No files were selected.');
          return;
        }
        const analyses = await client().analyze(inputs, (done, total, file) => setProgress({ done, total, file }));
        setItems((cur) => [...cur, ...itemsFromAnalyses(analyses)]);
        setResult(null);
        go(1);
      } catch (e) {
        setError(`Could not read the files: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [client], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const included = items.filter((i) => i.include && i.source);

  const runValidate = useCallback(async () => {
    setBusy('validate');
    setError(null);
    try {
      const out: ImportItem[] = [];
      for (const it of items) {
        if (it.include && it.source && !it.payload) out.push(await normalizeItem(client(), it));
        else out.push(it);
      }
      setItems(planItems(data.datasets, expandMonths(out)));
    } finally {
      setBusy(null);
    }
  }, [items, client, data.datasets]);

  useEffect(() => {
    if (step === 3 && items.some((i) => i.include && i.source && !i.payload && !i.error)) void runValidate();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const renormalize = async (id: string, p: Partial<ImportItem>) => {
    setBusy('validate');
    try {
      const cur = items.find((i) => i.analysis.id === id)!;
      const next = await normalizeItem(client(), { ...cur, ...p, payload: undefined, plan: undefined });
      setItems((all) => planItems(data.datasets, expandMonths(all.map((i) => (i.analysis.id === id ? next : i)))));
    } finally {
      setBusy(null);
    }
  };

  const conflicts = useMemo(() => batchConflicts(items), [items]);
  const ready = included.filter((i) => i.payload && !i.error && missingForItem(i).length === 0);
  const blockers = included.filter((i) => !i.payload || i.error || missingForItem(i).length > 0);
  const needsConfirm = items.filter((i) => i.include && i.plan?.needsConfirmation && i.mode !== 'skip' && !confirmed[i.analysis.id]);

  const apply = async () => {
    setBusy('commit');
    setError(null);
    try {
      const res = await commitItems(items.filter((i) => i.include && i.payload && missingForItem(i).length === 0));
      setResult(res);
      await reload();
      client().release(items.map((i) => i.analysis.id));
      go(7);
    } catch (e) {
      setError(`The import failed and nothing further was written: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const startOver = () => {
    client().release(items.map((i) => i.analysis.id));
    setItems([]);
    setResult(null);
    setConfirmed({});
    setStep(0);
    setReached(0);
    setError(null);
    setSkippedNames([]);
  };

  const next = () => {
    if (step === 0) return;
    if (step === 6) return void apply();
    go(step + 1);
  };
  const canNext = (() => {
    switch (step) {
      case 1: return included.length > 0;
      case 2: return true;
      case 3: return !busy && ready.length > 0 && blockers.length === 0;
      case 4: return !busy && ready.length > 0 && blockers.length === 0;
      case 5: return ready.length > 0 && conflicts.length === 0 && needsConfirm.length === 0;
      case 6: return ready.length > 0 && !busy;
      default: return false;
    }
  })();

  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    await ingestFiles(await filesFromDrop(e.dataTransfer));
  };

  /* -------------------------------- step bodies -------------------------------- */
  const body: ReactNode = (() => {
    switch (step) {
      case 0:
        return (
          <div>
            <div
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={drop}
              className={clsx('flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors', dragging ? 'border-hero-600 bg-hero-50' : 'border-slate-300 bg-surface')}
            >
              <UploadCloud size={36} className="text-ink-3" />
              <div className="text-base font-semibold">Drop files, a folder or a ZIP here</div>
              <p className="max-w-xl text-sm text-ink-2">CSV, Excel (.xlsx / .xls) and ZIP files are read in this browser. Nothing is uploaded to a server. You can add files month by month: new months are added, a newer export of the same month replaces the old one.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button className="btn btn-primary" disabled={busy !== null} onClick={() => fileInput.current?.click()}><FileUp size={16} /> Choose files or ZIP</button>
                <button className="btn" disabled={busy !== null} onClick={() => folderInput.current?.click()}><FolderUp size={16} /> Choose folder</button>
              </div>
              <input ref={fileInput} data-testid="file-input" type="file" multiple accept=".csv,.xls,.xlsx,.zip" className="hidden" onChange={(e) => e.target.files && ingestFiles(Array.from(e.target.files)).then(() => (e.target.value = ''))} />
              <input ref={folderInput} data-testid="folder-input" type="file" multiple className="hidden" onChange={(e) => e.target.files && ingestFiles(Array.from(e.target.files)).then(() => (e.target.value = ''))} />
              {busy === 'analyze' && <Spinner label={progress ? `Reading ${progress.file || 'files'} (${progress.done}/${progress.total})` : 'Reading files'} />}
            </div>
            {skippedNames.length > 0 && <div className="mt-2"><Notice tone="neutral" title={`${skippedNames.length} unsupported file${skippedNames.length === 1 ? '' : 's'} ignored`}>{skippedNames.slice(0, 8).join(', ')}{skippedNames.length > 8 ? '…' : ''}</Notice></div>}
          </div>
        );
      case 1:
        return (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">Each file is recognised from its columns, then its name. Check the guess and change it if needed; untick files you do not want to import.</p>
            <div className="overflow-auto rounded border border-slate-200 bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-ink-2">
                  <tr>
                    <th className="px-3 py-2 text-left">Import</th>
                    <th className="px-3 py-2 text-left">File</th>
                    <th className="px-3 py-2 text-left">Detected as</th>
                    <th className="px-3 py-2 text-left">Sheet</th>
                    <th className="px-3 py-2 text-left">Rows</th>
                    <th className="px-3 py-2 text-left">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const a = it.analysis;
                    const sheet = a.sheets.find((s) => s.name === it.sheetName) ?? a.sheets[0];
                    return (
                      <tr key={a.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2"><input type="checkbox" aria-label={`Import ${a.fileName}`} checked={it.include} disabled={!!a.error || !it.source} onChange={(e) => patch(a.id, { include: e.target.checked, payload: undefined })} /></td>
                        <td className="px-3 py-2"><div className="font-medium">{a.fileName}</div><div className="text-xs text-ink-3" title={a.origin ?? undefined}>{fmtSize(a.size)} · {a.kind}{a.origin ? ' · from ZIP / folder' : ''}</div>{a.error && <div className="text-xs text-bad-text">{a.error}</div>}</td>
                        <td className="px-3 py-2">
                          <select className="input py-1" aria-label={`Kind of ${a.fileName}`} value={it.source ?? ''} disabled={!!a.error} onChange={(e) => patch(a.id, { source: (e.target.value || null) as SourceType | null, include: !!e.target.value, payload: undefined, mapping: undefined, plan: undefined })}>
                            <option value="">Choose…</option>
                            {SOURCE_TYPES.map((s) => <option key={s} value={s}>{SOURCES[s].system}: {SOURCES[s].label}</option>)}
                          </select>
                          {a.identification.ambiguous && !a.error && <div className="mt-1 flex items-center gap-1 text-xs text-warn-text"><AlertTriangle size={12} /> {a.identification.note ?? 'Not sure: please choose.'}</div>}
                        </td>
                        <td className="px-3 py-2">
                          {it.source === 'focus_liquidation' && a.sheets.length > 1 ? (
                            <span className="text-ink-2">All {a.sheets.length} sheets are read</span>
                          ) : a.sheets.length > 1 ? (
                            <select className="input py-1" value={it.sheetName ?? ''} onChange={(e) => patch(a.id, { sheetName: e.target.value, payload: undefined, mapping: undefined })}>
                              {a.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({fInt(s.rowCount)} rows)</option>)}
                            </select>
                          ) : <span className="text-ink-2">{sheet?.name ?? '—'}</span>}
                        </td>
                        <td className="px-3 py-2 tnum">{it.source === 'focus_liquidation' && a.sheets.length > 1 ? fInt(a.sheets.reduce((n, x) => n + x.rowCount, 0)) : sheet ? fInt(sheet.rowCount) : '—'}{sheet?.declaredDimension && sheet.rowCount < 1000 && /1048|1043/.test(sheet.declaredDimension) && <div className="text-xs text-ink-3">file claims {sheet.declaredDimension}; only populated rows are read</div>}</td>
                        <td className="px-3 py-2">{a.error ? <Badge tone="bad">Unreadable</Badge> : <Badge tone={a.identification.confidence >= 0.8 && !a.identification.ambiguous ? 'good' : 'warn'}>{Math.round(a.identification.confidence * 100)}%</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>Add more files…</button>
            <input type="file" multiple accept=".csv,.xls,.xlsx,.zip" ref={fileInput} className="hidden" onChange={(e) => e.target.files && ingestFiles(Array.from(e.target.files)).then(() => (e.target.value = ''))} />
          </div>
        );
      case 2: {
        const cur = items.find((i) => i.analysis.id === previewId) ?? included[0] ?? items[0];
        const sheet = cur?.analysis.sheets.find((s) => s.name === cur.sheetName) ?? cur?.analysis.sheets[0];
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm">File <select className="input ml-1" value={cur?.analysis.id} onChange={(e) => setPreviewId(e.target.value)}>{items.map((i) => <option key={i.analysis.id} value={i.analysis.id}>{i.analysis.fileName}</option>)}</select></label>
              {cur?.source && <Badge tone="info">{SOURCES[cur.source].label}</Badge>}
            </div>
            {sheet ? (
              <>
                <div className="grid gap-2 text-sm sm:grid-cols-4">
                  <Card><div className="label">Header row</div><div className="text-lg font-semibold">{sheet.headerRow}</div></Card>
                  <Card><div className="label">Populated rows</div><div className="text-lg font-semibold">{fInt(sheet.rowCount)}</div></Card>
                  <Card><div className="label">Blank rows skipped</div><div className="text-lg font-semibold">{fInt(sheet.blankRowsSkipped)}</div></Card>
                  <Card><div className="label">Columns</div><div className="text-lg font-semibold">{sheet.columns.length}</div></Card>
                </div>
                {sheet.preamble.length > 0 && <Notice tone="neutral" title="Title lines above the header">{sheet.preamble.slice(0, 4).join(' · ')}</Notice>}
                {sheet.declaredDimension && <p className="text-xs text-ink-3">Worksheet dimension declared by the file: {sheet.declaredDimension}. Only rows that actually contain data are read.</p>}
                <SamplePreview sheet={sheet} />
                <p className="text-xs text-ink-3">First {sheet.sample.length} data rows shown exactly as read; no cleaning has been applied yet.</p>
              </>
            ) : <p className="text-sm text-ink-3">Nothing to preview.</p>}
          </div>
        );
      }
      case 3:
        return (
          <div className="space-y-3">
            {busy === 'validate' && <Spinner label="Reading and validating" />}
            <div className="overflow-auto rounded border border-slate-200 bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-ink-2">
                  <tr>
                    <th className="px-3 py-2 text-left">File</th>
                    <th className="px-3 py-2 text-left">Period</th>
                    <th className="px-3 py-2 text-right">Rows read</th>
                    <th className="px-3 py-2 text-right">Kept</th>
                    <th className="px-3 py-2 text-right">Duplicates</th>
                    <th className="px-3 py-2 text-right">Invalid</th>
                    <th className="px-3 py-2 text-right" title="Report footer Total rows are set aside and used to reconcile, not counted as data">Totals row</th>
                    <th className="px-3 py-2 text-right" title="Kept rows that carry a warning">Flagged</th>
                    <th className="px-3 py-2 text-left">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {included.map((it) => {
                    const m = it.payload?.meta;
                    const missing = missingForItem(it);
                    const grain = it.source ? SOURCES[it.source].grain : 'single';
                    return (
                      <tr key={it.analysis.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2"><div className="font-medium">{it.analysis.fileName}</div><div className="text-xs text-ink-3">{it.source && SOURCES[it.source].label}</div></td>
                        <td className="px-3 py-2">
                          {m && (grain === 'monthly' || grain === 'snapshot') ? (
                            <input aria-label={`Period of ${it.analysis.fileName}`} className="input w-36 py-1" type={grain === 'monthly' ? 'month' : 'date'} value={it.scopeOverride ?? (m.scope === 'unknown' ? '' : m.scope)} onChange={(e) => e.target.value && renormalize(it.analysis.id, { scopeOverride: e.target.value })} />
                          ) : <span className="text-ink-2">{m?.period ?? m?.scope ?? '—'}</span>}
                          {m?.scope === 'unknown' && !it.scopeOverride && <div className="text-xs text-bad-text">Period not found in the file name: enter it.</div>}
                        </td>
                        <td className="px-3 py-2 text-right tnum">{m ? fInt(m.rawCount) : '—'}</td>
                        <td className="px-3 py-2 text-right tnum">{m ? fInt(m.validCount) : '—'}</td>
                        <td className="px-3 py-2 text-right tnum">{m ? fInt(m.duplicateCount) : '—'}</td>
                        <td className="px-3 py-2 text-right tnum">{m ? fInt(m.invalidCount) : '—'}</td>
                        <td className="px-3 py-2 text-right tnum">{m ? fInt(m.totalRowCount ?? 0) : '—'}</td>
                        <td className="px-3 py-2 text-right tnum">{m ? fInt(m.flaggedCount) : '—'}</td>
                        <td className="px-3 py-2">
                          {it.error ? <Badge tone="bad">{it.error}</Badge> : missing.length ? <Badge tone="bad">Missing: {missing.map((k) => SOURCES[it.source!].fields[k]?.label ?? k).join(', ')}</Badge> : m ? <Badge tone={m.flaggedCount || m.invalidCount ? 'warn' : 'good'}>{m.flaggedCount || m.invalidCount ? 'Readable, with warnings' : 'Looks good'}</Badge> : <span className="text-ink-3">Waiting…</span>}
                          {it.payload && (
                            <details className="mt-1 text-xs text-ink-2">
                              <summary className="cursor-pointer">What was found</summary>
                              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                {topIssues(it).map(([code, n, sev]) => <li key={code}><strong>{code}</strong> ×{fInt(n)} <span className="text-ink-3">({sev})</span></li>)}
                                {it.payload.meta.inference.map((l, i) => <li key={`i${i}`}>{l}</li>)}
                              </ul>
                            </details>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {blockers.length > 0 && !busy && <Notice tone="warn" title={`${blockers.length} file${blockers.length === 1 ? ' needs' : 's need'} attention`}>Fix the column mapping in the next step, change the period, or untick the file on the Identify step. Nothing is dropped silently: every row is read, kept, flagged, or counted as a duplicate/invalid row above.</Notice>}
          </div>
        );
      case 4:
        return (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">Each field the dashboards need is matched to a column in your file by name. Correct anything that is wrong or missing; required fields are marked *.</p>
            {included.map((it) => {
              const def = SOURCES[it.source!];
              const cols = sheetColumns(it);
              const map = effectiveMapping(it);
              const miss = missingForItem(it);
              return (
                <details key={it.analysis.id} open={miss.length > 0} className="card">
                  <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3">
                    <span className="font-medium">{it.analysis.fileName}<span className="ml-2 text-xs font-normal text-ink-3">{def.label}</span></span>
                    {miss.length ? <Badge tone="bad">{miss.length} required missing</Badge> : <Badge tone="good">All required fields mapped</Badge>}
                  </summary>
                  <div className="grid gap-x-6 gap-y-2 border-t border-slate-100 p-4 sm:grid-cols-2">
                    {Object.entries(def.fields).map(([key, f]) => (
                      <label key={key} className="flex items-center justify-between gap-2 text-sm">
                        <span className={clsx(f.required && !map[key] && 'font-semibold text-bad-text')}>{f.label}{f.required ? ' *' : ''}</span>
                        <select className="input w-52 py-1" value={map[key] ?? ''} onChange={(e) => { const m = { ...map }; if (e.target.value) m[key] = e.target.value; else delete m[key]; void renormalize(it.analysis.id, { mapping: m }); }}>
                          <option value="">— not mapped —</option>
                          {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
              );
            })}
            {busy === 'validate' && <Spinner label="Re-reading with the new mapping" />}
          </div>
        );
      case 5:
        return (
          <div className="space-y-3">
            {conflicts.length > 0 && <Notice tone="bad" title="Two files in this batch would overwrite each other">{conflicts.map((c) => `${c.files.join(' and ')} both map to ${c.id}`).join('; ')}. Untick one on the Identify step or fix its period on the Validate step.</Notice>}
            {ready.map((it) => {
              const m = it.payload!.meta;
              const recon = (m.extra?.reconciliation as Array<{ field: string; reported: number; computed: number; diff: number }> | undefined) ?? [];
              const dash = m.extra?.dashboardCheck as { headlineTotal: number | null; trackerTotal: number } | null | undefined;
              return (
                <Card key={it.analysis.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{it.analysis.fileName}</div>
                      <div className="text-xs text-ink-3">{SOURCES[m.source].label} · {m.period ?? m.scope} · {fInt(m.validCount)} records</div>
                    </div>
                    <div className="text-right">
                      <select className="input py-1" aria-label={`How to import ${it.analysis.fileName}`} value={it.mode} onChange={(e) => patch(it.analysis.id, { mode: e.target.value as Mode })}>
                        {it.plan?.options.map((o) => <option key={o} value={o}>{MODE_LABEL[o]}</option>)}
                      </select>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-ink-2">{it.plan?.reason}</p>
                  {it.plan?.existing && <p className="text-xs text-ink-3">Currently stored: {it.plan.existing.fileName} ({fInt(it.plan.existing.validCount)} records, imported {fDate(it.plan.existing.importedAt.slice(0, 10))}).</p>}
                  {it.plan?.needsConfirmation && it.mode !== 'skip' && (
                    <label className="mt-2 flex items-center gap-2 text-sm font-medium text-warn-text">
                      <input type="checkbox" checked={!!confirmed[it.analysis.id]} onChange={(e) => setConfirmed((c) => ({ ...c, [it.analysis.id]: e.target.checked }))} />
                      I have checked this and want to {it.mode === 'merge' ? 'merge' : 'replace'}.
                    </label>
                  )}
                  {recon.length > 0 && (
                    <table className="mt-3 w-full text-xs">
                      <thead><tr className="text-left text-ink-3"><th className="py-1">Check against the report’s own totals</th><th className="py-1 text-right">Report says</th><th className="py-1 text-right">Parsed rows add to</th><th className="py-1 text-right">Difference</th></tr></thead>
                      <tbody>
                        {recon.map((r) => (
                          <tr key={r.field} className="border-t border-slate-100"><td className="py-1">{r.field}</td><td className="py-1 text-right tnum">{r.reported.toLocaleString('en-IN')}</td><td className="py-1 text-right tnum">{r.computed.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td className={clsx('py-1 text-right tnum', Math.abs(r.diff) > 1 ? 'font-semibold text-bad-text' : 'text-good-text')}>{Math.abs(r.diff) > 1 ? r.diff.toFixed(2) : 'matches'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {dash && dash.headlineTotal !== null && <p className="mt-2 text-xs text-ink-2">Dashboard sheet says {dash.headlineTotal} pointers; Tracker sheet has {dash.trackerTotal}. {dash.headlineTotal === dash.trackerTotal ? 'These agree.' : 'They disagree: the Tracker rows are used.'}</p>}
                </Card>
              );
            })}
          </div>
        );
      case 6:
        return (
          <div className="space-y-3">
            <Notice tone="info" title="Ready to refresh">
              {ready.filter((r) => r.mode !== 'skip').length} file{ready.filter((r) => r.mode !== 'skip').length === 1 ? '' : 's'} will be written to this browser’s storage; {ready.filter((r) => r.mode === 'skip').length} skipped. Existing data for other months is not touched.
            </Notice>
            <ul className="list-disc space-y-1 pl-6 text-sm text-ink-2">
              {ready.map((it) => <li key={it.analysis.id}><strong>{it.analysis.fileName}</strong>: {MODE_LABEL[it.mode ?? 'add']}</li>)}
            </ul>
            {busy === 'commit' && <Spinner label="Saving" />}
            <Notice tone="neutral" title="This changes your browser only">Imported data lives in this browser’s IndexedDB. It does not change the deployed website and is not shared with colleagues, who need to import the same files themselves.{published.configured && <> Sharing it with everyone is a separate step, done by an administrator in Data Management.</>}</Notice>
          </div>
        );
      default:
        return (
          <div className="space-y-3">
            {result && result.failed.length === 0 && <Notice tone="good" title="Import complete">Dashboards now use the new data.</Notice>}
            {result && result.failed.length > 0 && <Notice tone="bad" title={`${result.failed.length} file${result.failed.length === 1 ? '' : 's'} failed`}>{result.failed.map((f) => `${f.fileName}: ${f.message}`).join('; ')}. The other files were saved.</Notice>}
            <div className="overflow-auto rounded border border-slate-200 bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-ink-2"><tr><th className="px-3 py-2 text-left">File</th><th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-right">Added</th><th className="px-3 py-2 text-right">Updated</th><th className="px-3 py-2 text-right">Unchanged</th><th className="px-3 py-2 text-right">Replaced (removed)</th><th className="px-3 py-2 text-right">Skipped rows</th><th className="px-3 py-2 text-right">Flagged</th></tr></thead>
                <tbody>
                  {(result?.summaries ?? []).map((s) => (
                    <tr key={s.datasetId + s.fileName} className="border-t border-slate-100"><td className="px-3 py-2">{s.fileName}</td><td className="px-3 py-2">{MODE_LABEL[s.mode]}</td><td className="px-3 py-2 text-right tnum">{fInt(s.added)}</td><td className="px-3 py-2 text-right tnum">{fInt(s.updated)}</td><td className="px-3 py-2 text-right tnum">{fInt(s.unchanged)}</td><td className="px-3 py-2 text-right tnum">{fInt(s.removed)}</td><td className="px-3 py-2 text-right tnum">{fInt(s.skipped)}</td><td className="px-3 py-2 text-right tnum">{fInt(s.flagged)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/" className="btn btn-primary">Open Dealer App vs SFA Comparison</Link>
              <button className="btn" onClick={startOver}>Import more files</button>
            </div>
          </div>
        );
    }
  })();

  return (
    <div>
      <PageHeader title="Data Import" />
      <p className="text-sm text-ink-2">Imported data is saved in <strong>this browser only</strong> and survives a reload. It does not change the website and is not shared: each person imports the same files.</p>
      {published.configured && <p className="mt-1 text-sm text-ink-2">To share an import with everyone, an administrator publishes it afterwards from <Link className="text-hero-600 underline" to="/admin">Data Management</Link>.</p>}
      <div className="mt-4">
        <Stepper step={step} reached={reached} />
        {error && <div className="mb-3"><Notice tone="bad" title="Something went wrong">{error}</Notice></div>}
        <div className="card p-4">{body}</div>
        {step > 0 && step < 7 && (
          <div className="mt-3 flex items-center justify-between">
            <button className="btn" onClick={() => (step === 1 ? startOver() : setStep(step - 1))} disabled={busy !== null}><ArrowLeft size={14} /> {step === 1 ? 'Start over' : 'Back'}</button>
            <button className="btn btn-primary" disabled={!canNext} onClick={next}>
              {step === 6 ? (busy === 'commit' ? 'Saving…' : 'Apply import') : 'Next'} {step !== 6 && <ArrowRight size={14} />}
            </button>
          </div>
        )}
      </div>
      <Catalogue />
    </div>
  );
}

function topIssues(it: ImportItem): Array<[string, number, string]> {
  const by = new Map<string, { n: number; sev: string }>();
  for (const i of it.payload?.issues ?? []) {
    const e = by.get(i.code) ?? { n: 0, sev: i.severity };
    e.n++;
    by.set(i.code, e);
  }
  return [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([c, e]) => [c, e.n, e.sev]);
}

/** Data Import is visible to everyone, but only the administrator (or a copy without a server) can use it. */
export default function ImportCentre() {
  const { admin, canUseDataTools } = useAdmin();
  if (admin.phase === 'loading') return <Spinner label="Checking access" />;
  if (canUseDataTools) return <ImportWizard />;
  return (
    <div className="space-y-4">
      <PageHeader title="Data Import" />
      <Notice tone="neutral" title="Data Import is restricted to the administrator">
        Everyone can view the dashboards. Importing, validating, replacing, merging and publishing data need the administrator sign-in.
      </Notice>
      {admin.phase === 'unavailable' ? (
        <Notice tone="warn" title="Sign-in is temporarily unavailable">The server could not be reached. Try again in a moment.</Notice>
      ) : (
        <AdminLogin />
      )}
    </div>
  );
}
