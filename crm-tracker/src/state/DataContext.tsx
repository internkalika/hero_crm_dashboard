// Application state: imported data (from IndexedDB), settings, reporting period, mappings.
// Everything is computed in the browser; nothing is sent anywhere.
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppData, Settings, defaultSettings, emptyAppData } from '../lib/types';
import { HistoryEntry, kvGet, kvSet, listHistory, loadAppData } from '../lib/store/db';
import { ALL_PERIOD, Period, availableMonths, customPeriod, periodOptions } from '../lib/metrics/period';
import type { Crosswalk } from '../lib/metrics/comparison';
import { IngestClient, createWorkerClient } from '../lib/ingest/client';
import { seedIfFirstOpen, snapshotAppData } from '../lib/store/snapshot';
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
}

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
  const version = useRef(0);
  const clientRef = useRef<IngestClient | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (version.current === 0) await seedIfFirstOpen().catch(() => undefined);
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
  }, []);

  useEffect(() => {
    void reload();
    return () => clientRef.current?.terminate();
  }, [reload]);

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
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData must be used inside <DataProvider>');
  return c;
}
