// Application state: imported data (from IndexedDB), settings, reporting period, mappings.
// Everything is computed in the browser; nothing is sent anywhere.
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppData, Settings, defaultSettings, emptyAppData } from '../lib/types';
import { HistoryEntry, kvGet, kvSet, listHistory, loadAppData } from '../lib/store/db';
import { ALL_PERIOD, Period, availableMonths, customPeriod, periodOptions } from '../lib/metrics/period';
import type { Crosswalk } from '../lib/metrics/comparison';
import { IngestClient, createWorkerClient } from '../lib/ingest/client';
import { seedIfFirstOpen, snapshotAppData } from '../lib/store/snapshot';
import { SyncResult, syncPublished } from '../lib/sync/published';
import { todayIso } from '../lib/util/parse';

interface Ctx {
  data: AppData;
  loading: boolean;
  error: string | null;
  /** set when browser storage is unusable and the page shows the embedded snapshot read-only */
  storageNote: string | null;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  months: string[];
  periods: Period[];
  period: Period;
  setPeriodId: (id: string) => void;
  setCustomRange: (from: string, to: string) => void;
  crosswalk: Crosswalk;
  setCrosswalk: (c: Crosswalk) => void;
  history: HistoryEntry[];
  reload: () => Promise<void>;
  asOf: string;
  lastRefresh: string | null;
  client: () => IngestClient;
  /** the published version this browser has applied, and how the last check went */
  published: PublishedInfo;
  /** check for a newer published version now (the page also does this on its own) */
  syncNow: () => Promise<SyncResult | null>;
}

export interface PublishedInfo {
  state: SyncResult['state'] | 'unknown';
  configured: boolean;
  versionId: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  keptLocal: string[];
}

/** how long the first load waits for the published data before showing what is already stored */
const FIRST_SYNC_WAIT_MS = 1500;
const POLL_MS = 60_000;

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children, clientFactory }: { children: ReactNode; clientFactory?: () => IngestClient }) {
  const [data, setData] = useState<AppData>(emptyAppData());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [periodId, setPeriodIdState] = useState<string>('all');
  const [custom, setCustom] = useState<Period | null>(null);
  const [crosswalk, setCrosswalkState] = useState<Crosswalk>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [published, setPublished] = useState<PublishedInfo>({ state: 'unknown', configured: false, versionId: null, publishedAt: null, checkedAt: null, keptLocal: [] });
  const version = useRef(0);
  const clientRef = useRef<IngestClient | null>(null);

  const note = useCallback((r: SyncResult | null) => {
    if (r) setPublished({ state: r.state, configured: r.configured, versionId: r.versionId, publishedAt: r.publishedAt, checkedAt: new Date().toISOString(), keptLocal: r.keptLocal });
  }, []);

  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) setLoading(true);
    try {
      if (version.current === 0) {
        await seedIfFirstOpen().catch(() => undefined);
        // bring in the published version before the first paint, but never hold the page up for long or fail because of it
        note(await Promise.race([syncPublished().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), FIRST_SYNC_WAIT_MS))]));
      }
      version.current += 1;
      const [d, s, cw, h] = await Promise.all([
        loadAppData(version.current),
        kvGet<Partial<Settings>>('settings', {}),
        kvGet<Crosswalk>('dealerCrosswalk', {}),
        listHistory(),
      ]);
      setData(d);
      setSettings({ ...defaultSettings, ...s });
      setCrosswalkState(cw);
      setHistory(h);
      setError(null);
      setStorageNote(null);
    } catch (e) {
      const fallback = await snapshotAppData(version.current).catch(() => null);
      if (fallback) {
        setData(fallback);
        setError(null);
        setStorageNote('This browser does not allow the page to save data, so it is showing the data embedded in the file. Importing new files will not be saved. Open the file in Chrome or Edge to import and keep new data.');
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [note]);
  const reload = useCallback(() => load(false), [load]);

  /** Applies a newer published version and refreshes the dashboards quietly (no spinner, no page change). */
  const syncNow = useCallback(async () => {
    const r = await syncPublished().catch(() => null);
    note(r);
    if (r && r.changed.length) await load(true);
    return r;
  }, [load, note]);

  useEffect(() => {
    void reload();
    return () => clientRef.current?.terminate();
  }, [reload]);

  // other viewers pick up a publish by themselves: every minute while the page is open, and when it comes back into view
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.protocol === 'file:') return;
    const tick = () => {
      if (document.visibilityState === 'visible' && version.current > 0) void syncNow();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [syncNow]);

  const months = useMemo(() => availableMonths(data), [data]);
  const periods = useMemo(() => {
    const base = periodOptions(months);
    return custom ? [...base, custom] : base;
  }, [months, custom]);
  const period = useMemo(() => periods.find((p) => p.id === periodId) ?? ALL_PERIOD, [periods, periodId]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void kvSet('settings', next);
      return next;
    });
  }, []);

  const lastRefresh = useMemo(() => data.datasets.reduce<string | null>((a, d) => (!a || d.importedAt > a ? d.importedAt : a), null), [data.datasets]);

  const value: Ctx = {
    data,
    loading,
    error,
    storageNote,
    settings,
    updateSettings,
    months,
    periods,
    period,
    setPeriodId: (id) => setPeriodIdState(id),
    setCustomRange: (from, to) => {
      const p = customPeriod(from, to);
      setCustom(p);
      setPeriodIdState(p.id);
    },
    crosswalk,
    setCrosswalk: (c) => {
      setCrosswalkState(c);
      void kvSet('dealerCrosswalk', c);
    },
    history,
    reload,
    asOf: settings.asOfDate ?? todayIso(),
    lastRefresh,
    client: () => {
      if (!clientRef.current) clientRef.current = (clientFactory ?? createWorkerClient)();
      return clientRef.current;
    },
    published,
    syncNow,
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData must be used inside <DataProvider>');
  return c;
}
