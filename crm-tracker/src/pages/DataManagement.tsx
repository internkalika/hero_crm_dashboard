// Data Management: what is published, and (for a signed-in administrator) publishing, history and rollback.
// Everyone can see the status; nothing here changes anything unless the server accepts the administrator's session.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, LogOut, RefreshCw, Trash2, Undo2, UploadCloud } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '../state/DataContext';
import { Badge, Card, Confirm, Modal, Notice, PageHeader, SectionTitle, Spinner } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SOURCES } from '../lib/ingest/sources';
import { formatCell, fInt } from '../lib/export/format';
import type { Col } from '../lib/export/excel';
import type { DatasetChange, PublishedDataset, SnapshotStatus, VersionManifest, VersionSummary } from '../lib/publish/types';
import { ApiError, adminManifest, adminRollback, adminVersions, fetchStatus } from '../lib/sync/api';
import { useAdmin } from '../state/AdminContext';
import { AdminLogin } from '../components/AdminLogin';
import { PublishPreview, PublishProgress, discardLocalChange, previewPublish, publishLocal } from '../lib/sync/published';
import { LocalChange, localChanges } from '../lib/sync/state';

const dt = (v: string | null | undefined) => (v ? formatCell(v, 'datetime') : '—');
const label = (id: string) => {
  const [source, scope] = id.split(':');
  const def = SOURCES[source as keyof typeof SOURCES];
  return def ? `${def.label}${scope && scope !== 'all' ? ` (${scope})` : ''}` : id;
};
const ACTION: Record<string, { text: string; tone: 'good' | 'info' | 'neutral' | 'warn' }> = {
  publish: { text: 'Published', tone: 'good' },
  initial: { text: 'First publish', tone: 'good' },
  rollback: { text: 'Restored', tone: 'warn' },
};

function explain(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'locked' && e.retryAfterSeconds) return `Too many failed attempts. Try again in ${Math.ceil(e.retryAfterSeconds / 60)} minute${e.retryAfterSeconds > 90 ? 's' : ''}.`;
    if (e.code === 'conflict') return 'Someone published a newer version while you were reviewing. Nothing was changed. Close this window, check the history and review again.';
    if (e.code === 'not_configured') return `Publishing is not set up on this deployment yet${Array.isArray(e.data.missing) ? ` (missing: ${(e.data.missing as string[]).join('; ')})` : ''}.`;
    if (e.code === 'unauthorized') return 'Your administrator session has ended. Sign in again.';
    if (e.code === 'personal_data' || e.code === 'invalid_dataset') return `${e.message}${Array.isArray(e.data.errors) ? ` ${(e.data.errors as string[]).join(' ')}` : ''}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export default function DataManagement() {
  const { data, reload, published, syncNow } = useData();
  const { admin, signOut: endSession } = useAdmin();
  const isAdmin = admin.phase === 'admin';
  const [status, setStatus] = useState<SnapshotStatus | null | undefined>(undefined);
  const [changes, setChanges] = useState<LocalChange[]>([]);
  const [hist, setHist] = useState<{ current: string | null; versions: VersionSummary[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [review, setReview] = useState<{ rows: PublishPreview[]; base: string | null } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [outcome, setOutcome] = useState<{ changes: DatasetChange[]; versionId: string | null; unchanged: boolean } | null>(null);
  const [discard, setDiscard] = useState<string | null>(null);
  const [restore, setRestore] = useState<VersionSummary | null>(null);
  const [unpublish, setUnpublish] = useState<PublishedDataset | null>(null);
  const [detail, setDetail] = useState<VersionManifest | null>(null);

  const refresh = useCallback(async () => {
    const [st, ch] = await Promise.all([fetchStatus(), localChanges().catch(() => [])]);
    setStatus(st);
    setChanges(ch);
    // the version history is for the administrator only (the server refuses everybody else as well)
    if (isAdmin) setHist(await adminVersions().catch(() => null));
    else setHist(null);
  }, [isAdmin]);
  useEffect(() => {
    void refresh();
  }, [refresh, data.version]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setOk(null);
    try {
      await fn();
    } catch (e) {
      setError(explain(e));
      if (e instanceof ApiError && e.status === 401) void endSession(); // the session ended: look again and close the tools
    } finally {
      setBusy(null);
    }
  };

  const signOut = () => run('logout', async () => { await endSession(); setHist(null); setReview(null); });

  const openReview = () =>
    run('review', async () => {
      const st = await fetchStatus();
      const rows = await previewPublish(st);
      setReview({ rows, base: st?.version?.versionId ?? null });
      setPicked(new Set(rows.filter((r) => r.sanitize.blocked === 0).map((r) => r.id)));
      setNote('');
      setOutcome(null);
    });

  const doPublish = () =>
    run('publish', async () => {
      if (!review) return;
      const rows = review.rows.filter((r) => picked.has(r.id));
      const out = await publishLocal({ ids: rows.filter((r) => r.kind !== 'removed').map((r) => r.id), remove: rows.filter((r) => r.kind === 'removed').map((r) => r.id), baseVersion: review.base, note, onProgress: setProgress });
      setOutcome({ changes: out.changes, versionId: out.versionId, unchanged: out.unchanged });
      setReview(null);
      await reload();
      await refresh();
      setOk(out.unchanged ? 'Nothing had changed compared with the published data.' : 'Published. Everyone who has the dashboard open will receive it within a minute.');
    }).finally(() => setProgress(null));

  const publishedIds = useMemo(() => new Set(status?.version?.datasets.map((d) => d.id) ?? []), [status]);
  const dirty = useMemo(() => new Map(changes.map((c) => [c.id, c])), [changes]);
  const origin = (id: string) => (dirty.has(id) ? { text: 'Unpublished import', tone: 'warn' as const } : publishedIds.has(id) ? { text: 'Published', tone: 'good' as const } : { text: 'Embedded in this page', tone: 'neutral' as const });

  const dsCols: Col<(typeof data.datasets)[number]>[] = [
    { id: 'src', header: 'Dataset', value: (d) => label(d.id), width: 230 },
    { id: 'file', header: 'File', value: (d) => d.fileName, width: 240 },
    { id: 'period', header: 'Period / scope', value: (d) => d.period ?? d.scope },
    { id: 'rec', header: 'Records', value: (d) => d.validCount, format: 'int' },
    { id: 'at', header: 'Imported', value: (d) => d.importedAt, format: 'datetime' },
    { id: 'origin', header: 'Data comes from', value: (d) => origin(d.id).text, render: (d) => <Badge tone={origin(d.id).tone}>{origin(d.id).text}</Badge> },
    ...(isAdmin
      ? [{ id: 'act', header: '', value: () => null, noExport: true, render: (d: (typeof data.datasets)[number]) => { const p = status?.version?.datasets.find((x) => x.id === d.id); return p ? <button className="btn btn-sm" aria-label={`Remove ${label(d.id)} from the published data`} onClick={() => setUnpublish(p)}><Trash2 size={12} /> Unpublish</button> : null; } } as Col<(typeof data.datasets)[number]>]
      : []),
  ];
  const histCols: Col<VersionSummary>[] = [
    { id: 'at', header: 'Published', value: (v) => v.createdAt, format: 'datetime' },
    { id: 'what', header: 'Kind', value: (v) => ACTION[v.action]?.text ?? v.action, render: (v) => <Badge tone={ACTION[v.action]?.tone ?? 'neutral'}>{ACTION[v.action]?.text ?? v.action}</Badge> },
    { id: 'note', header: 'Note', value: (v) => v.note, width: 260 },
    { id: 'ds', header: 'Datasets', value: (v) => v.datasets, format: 'int' },
    { id: 'rec', header: 'Records', value: (v) => v.records, format: 'int' },
    { id: 'id', header: 'Version', value: (v) => v.versionId, hidden: true },
    { id: 'cur', header: 'Status', value: (v) => (v.current ? 'Live' : ''), render: (v) => (v.current ? <Badge tone="good">Live</Badge> : <span className="text-ink-3">earlier</span>) },
    {
      id: 'act', header: '', value: () => null, noExport: true,
      render: (v) => (
        <span className="flex gap-1">
          <button className="btn btn-sm" onClick={() => void run('manifest', async () => setDetail((await adminManifest(v.versionId)).manifest))}><History size={12} /> Changes</button>
          {!v.current && <button className="btn btn-sm" onClick={() => setRestore(v)}><Undo2 size={12} /> Restore</button>}
        </span>
      ),
    },
  ];

  const lastPub = status?.publishedAt ?? published.publishedAt;
  const configured = admin.phase === 'admin' || (admin.phase === 'public' ? admin.configured : status?.configured ?? false);

  return (
    <div className="space-y-4">
      <PageHeader title="Data Management" actions={<button className="btn btn-sm" disabled={!!busy} onClick={() => void run('check', async () => { await syncNow(); await refresh(); })}><RefreshCw size={12} /> Check for updates</button>} />

      {error && <Notice tone="bad" title="That did not work">{error}</Notice>}
      {ok && <Notice tone="good" title={ok} />}

      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="label">Last published</div>
            <div className="text-lg font-semibold" data-testid="last-published">{status === undefined ? <Spinner label="Checking" /> : lastPub ? dt(lastPub) : 'Nothing published yet'}</div>
            <div className="text-xs text-ink-3">{status === null ? 'The publishing service cannot be reached from here.' : lastPub ? `Version ${status?.version?.versionId ?? published.versionId}` : 'The dashboards show the data embedded in this page.'}</div>
          </div>
          <div>
            <div className="label">Dashboards are showing</div>
            <div className="mt-1"><Badge tone={status?.version ? 'good' : 'neutral'}>{status?.version ? 'Published data' : 'Embedded data'}</Badge></div>
            <div className="mt-1 text-xs text-ink-3">{status?.version ? 'Datasets the published version does not carry still come from this page.' : 'Used until a publish succeeds, and whenever the service is unavailable.'}</div>
          </div>
          <div>
            <div className="label">This browser checked</div>
            <div className="text-lg font-semibold">{dt(published.checkedAt)}</div>
            <div className="text-xs text-ink-3">{published.keptLocal.length > 0 ? `${published.keptLocal.length} dataset${published.keptLocal.length === 1 ? ' is' : 's are'} not updated because of unpublished imports here.` : 'Updates arrive on their own about every minute.'}</div>
          </div>
        </div>
      </Card>

      {status === null && <Notice tone="neutral" title="Publishing is not available here">This copy of the dashboard has no publishing service (for example it is the single HTML file opened from disk). Importing files still works in this browser.</Notice>}

      <SectionTitle>Administrator</SectionTitle>
      {admin.phase === 'loading' || status === undefined ? (
        <Spinner label="Checking" />
      ) : admin.phase === 'no-backend' ? (
        <Notice tone="neutral" title="Data tools are not shared on this copy">This copy of the dashboard has no publishing service, so importing works in this browser only.</Notice>
      ) : admin.phase === 'unavailable' ? (
        <Notice tone="warn" title="Sign-in is temporarily unavailable">The server could not be reached, so the data tools stay closed. The dashboards still work.</Notice>
      ) : admin.phase === 'public' && !admin.configured ? (
        <Notice tone="neutral" title="Publishing is not set up on this deployment">The administrator has to connect the Blob store and set the administrator secrets (see docs/PUBLISHING.md). The dashboards are not affected.</Notice>
      ) : admin.phase === 'public' ? (
        <>
          <Notice tone="neutral" title="The data tools are for the administrator">Everyone can view the dashboards. Importing, validating, replacing, merging, publishing, the version history and restoring are available after signing in.</Notice>
          <AdminLogin compact />
        </>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm"><Badge tone="good">Signed in as the administrator</Badge><span className="text-ink-2">{admin.email}</span><span className="text-ink-3">until {dt(admin.expiresAt)}</span></div>
            <button className="btn btn-sm" onClick={() => void signOut()} disabled={busy === 'logout'}><LogOut size={12} /> Sign out</button>
          </div>
        </Card>
      )}

      {isAdmin && configured && (
        <>
          <SectionTitle right={<Link className="text-sm text-hero-600 underline" to="/import">Import files →</Link>}>Changes waiting to be published</SectionTitle>
          {changes.length === 0 ? (
            <Notice tone="neutral" title="Nothing to publish">Import a file in Data Import (choose Replace, Merge or Skip there), check the dashboards, then come back here to publish it.</Notice>
          ) : (
            <Card pad={false}>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left"><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">File</th><th className="px-3 py-2">Change</th><th className="px-3 py-2" /></tr></thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">{label(c.id)}</td>
                      <td className="px-3 py-2 text-ink-2">{c.meta?.fileName ?? '—'}</td>
                      <td className="px-3 py-2"><Badge tone={c.kind === 'removed' ? 'bad' : 'warn'}>{c.kind === 'new' ? 'New' : c.kind === 'changed' ? 'Changed' : 'Removed here'}</Badge></td>
                      <td className="px-3 py-2 text-right"><button className="btn btn-sm" onClick={() => setDiscard(c.id)}>Discard</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end border-t border-slate-200 p-3">
                <button className="btn btn-primary" disabled={!!busy} onClick={() => void openReview()}><UploadCloud size={14} /> {busy === 'review' ? 'Checking…' : 'Review and publish…'}</button>
              </div>
            </Card>
          )}
          {outcome && !outcome.unchanged && <ResultTable changes={outcome.changes} versionId={outcome.versionId} />}
        </>
      )}

      {isAdmin && (
        <>
        <SectionTitle>Datasets in use</SectionTitle>
        {data.datasets.length === 0 ? <Notice tone="neutral" title="No data loaded" /> : <DataTable title={`Datasets in use (${data.datasets.length})`} rows={data.datasets} columns={dsCols} getRowId={(d) => d.id} exportName="Datasets_in_use" pageSize={25} />}
        </>
      )}

      {isAdmin && hist && (
        <>
          <SectionTitle>Version history</SectionTitle>
          <DataTable title={`Published versions (${hist.versions.length})`} rows={hist.versions} columns={histCols} getRowId={(v) => v.versionId} exportName="Published_versions" pageSize={10} />
          <p className="text-xs text-ink-3">Restoring a version publishes it again as a new version; the history is never rewritten.</p>
        </>
      )}

      <Modal open={!!review} onClose={() => !busy && setReview(null)} title="Review before publishing" width="max-w-5xl">
        {review && (
          <div className="space-y-3 text-sm">
            <p className="text-ink-2">Compared with the data that is published now (where nothing is published yet, with the copy embedded in this page). The server checks and cleans every dataset again; personal data (mobile numbers, e-mail addresses) is removed before anything is stored, and raw rows are never published.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-200 text-left"><th className="px-2 py-1">Publish</th><th className="px-2 py-1">Dataset</th><th className="px-2 py-1">File / mode</th><th className="px-2 py-1 text-right">Records</th><th className="px-2 py-1 text-right">Inserted</th><th className="px-2 py-1 text-right">Updated</th><th className="px-2 py-1 text-right">Unchanged</th><th className="px-2 py-1 text-right">Removed</th><th className="px-2 py-1 text-right" title="Rows the importer set aside (duplicates and invalid rows)">Rejected</th><th className="px-2 py-1">Personal data check</th></tr></thead>
                <tbody>
                  {review.rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 align-top">
                      <td className="px-2 py-1"><input type="checkbox" aria-label={`Publish ${label(r.id)}`} checked={picked.has(r.id)} disabled={r.sanitize.blocked > 0} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                      <td className="px-2 py-1">{label(r.id)}<div className="text-ink-3">{r.kind === 'removed' ? 'remove from published data' : r.baseline === 'embedded' ? 'first publish: compared with the embedded copy' : r.baseline === 'none' ? 'new dataset' : 'changed'}</div></td>
                      <td className="px-2 py-1">{r.fileName}<div className="text-ink-3">{r.mode}</div></td>
                      <td className="px-2 py-1 text-right tnum">{fInt(r.records)}</td>
                      <td className="px-2 py-1 text-right tnum">{fInt(r.diff.inserted)}</td>
                      <td className="px-2 py-1 text-right tnum">{fInt(r.diff.updated)}</td>
                      <td className="px-2 py-1 text-right tnum">{fInt(r.diff.unchanged)}</td>
                      <td className="px-2 py-1 text-right tnum">{fInt(r.diff.removed)}</td>
                      <td className="px-2 py-1 text-right tnum">{fInt(r.rejected)}</td>
                      <td className="px-2 py-1">{r.sanitize.blocked > 0 ? <Badge tone="bad">Blocked: personal data left</Badge> : r.sanitize.tokenisedKeys + r.sanitize.scrubbedValues === 0 ? <Badge tone="good">Clean</Badge> : <Badge tone="warn">{r.sanitize.tokenisedKeys > 0 ? `${r.sanitize.tokenisedKeys} keys made anonymous` : ''}{r.sanitize.tokenisedKeys > 0 && r.sanitize.scrubbedValues > 0 ? ', ' : ''}{r.sanitize.scrubbedValues > 0 ? `${r.sanitize.scrubbedValues} values removed` : ''}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <label className="label" htmlFor="pub-note">Note for the history (optional)</label>
              <input id="pub-note" className="input mt-1 w-full" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: November usage report" />
            </div>
            {progress && <Spinner label={`${progress.stage}`} />}
            <div className="flex justify-end gap-2">
              <button className="btn" disabled={busy === 'publish'} onClick={() => setReview(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy === 'publish' || picked.size === 0} onClick={() => void doPublish()}><UploadCloud size={14} /> Publish {picked.size} dataset{picked.size === 1 ? '' : 's'}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Version of ${dt(detail.createdAt)}` : ''} width="max-w-4xl">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="text-ink-2">{detail.note || 'No note.'}{detail.restoredFrom ? ` Restores ${detail.restoredFrom}.` : ''}</div>
            <ResultTable changes={detail.changes} versionId={detail.versionId} embedded />
          </div>
        )}
      </Modal>

      <Confirm open={!!discard} title="Discard this import?" confirmLabel="Discard" onCancel={() => setDiscard(null)} message={<>This browser goes back to the published copy of {discard ? label(discard) : ''} (or the embedded one if nothing was published). Other viewers are not affected.</>}
        onConfirm={() => { const id = discard!; setDiscard(null); void run('discard', async () => { await discardLocalChange(id); await reload(); await refresh(); }); }} />
      <Confirm open={!!restore} title="Restore this version?" confirmLabel="Restore" onCancel={() => setRestore(null)} message={<>The published data goes back to the version of {restore ? dt(restore.createdAt) : ''}{restore?.note ? ` (“${restore.note}”)` : ''}. It is published as a new version and everyone receives it within a minute.</>}
        onConfirm={() => { const v = restore!; setRestore(null); void run('restore', async () => { const out = await adminRollback(v.versionId, hist!.current!); setOutcome({ changes: out.changes, versionId: out.versionId, unchanged: false }); await syncNow(); await refresh(); setOk('Restored.'); }); }} />
      <Confirm open={!!unpublish} danger title="Remove from the published data?" confirmLabel="Remove" onCancel={() => setUnpublish(null)} message={<>{unpublish ? label(unpublish.id) : ''} is taken out of the published data. Viewers go back to the embedded copy of it, if this page has one, otherwise the dashboards that need it show “no data yet”. You can undo this by restoring the previous version.</>}
        onConfirm={() => { const d = unpublish!; setUnpublish(null); void run('unpublish', async () => { const st = await fetchStatus(); const out = await publishLocal({ ids: [], remove: [d.id], baseVersion: st?.version?.versionId ?? null, note: `Removed ${d.id}` }); setOutcome({ changes: out.changes, versionId: out.versionId, unchanged: out.unchanged }); await reload(); await refresh(); }); }} />
    </div>
  );
}

function ResultTable({ changes, versionId, embedded }: { changes: DatasetChange[]; versionId: string | null; embedded?: boolean }) {
  return (
    <div className={embedded ? '' : 'mt-3'}>
      {!embedded && <Notice tone="good" title="Published">{versionId ? `Version ${versionId}` : ''}</Notice>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-200 text-left"><th className="px-2 py-1">Dataset</th><th className="px-2 py-1">Result</th><th className="px-2 py-1 text-right">Inserted</th><th className="px-2 py-1 text-right">Updated</th><th className="px-2 py-1 text-right">Unchanged</th><th className="px-2 py-1 text-right">Removed</th><th className="px-2 py-1 text-right">Rejected</th><th className="px-2 py-1">Cleaned</th></tr></thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.id} className="border-b border-slate-100">
                <td className="px-2 py-1">{label(c.id)}</td>
                <td className="px-2 py-1">{c.status}</td>
                <td className="px-2 py-1 text-right tnum">{fInt(c.inserted)}</td>
                <td className="px-2 py-1 text-right tnum">{fInt(c.updated)}</td>
                <td className="px-2 py-1 text-right tnum">{fInt(c.unchanged)}</td>
                <td className="px-2 py-1 text-right tnum">{fInt(c.removed)}</td>
                <td className="px-2 py-1 text-right tnum">{fInt(c.rejected)}</td>
                <td className="px-2 py-1">{c.sanitized.tokenisedKeys + c.sanitized.scrubbedValues === 0 ? '—' : `${c.sanitized.tokenisedKeys} keys, ${c.sanitized.scrubbedValues} values`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
