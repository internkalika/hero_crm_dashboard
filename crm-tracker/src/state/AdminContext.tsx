// The administrator session as the screens see it. One place asks the server; the Data Import and Data Management pages read it.
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adminLogin, adminLogout } from '../lib/sync/api';
import { AdminState, mayUseDataTools, probeAdmin } from '../lib/sync/admin';

interface Ctx {
  admin: AdminState;
  /** may this visitor use the import tools (administrator, or no backend at all) */
  canUseDataTools: boolean;
  /** throws the API error when the email or password is wrong */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AdminCtx = createContext<Ctx | null>(null);
const SINGLE_FILE = import.meta.env.MODE === 'single';

export function AdminProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminState>({ phase: 'loading' });
  const refresh = useCallback(async () => setAdmin(await probeAdmin({ singleFile: SINGLE_FILE })), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // a session ends on its own (expiry): look again when the tab comes back and every few minutes, so the tools close by themselves
  useEffect(() => {
    if (SINGLE_FILE || typeof document === 'undefined') return;
    const tick = () => document.visibilityState === 'visible' && void refresh();
    const id = window.setInterval(tick, 120_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);
  const value = useMemo<Ctx>(
    () => ({
      admin,
      canUseDataTools: mayUseDataTools(admin),
      signIn: async (email, password) => {
        await adminLogin(email, password);
        await refresh();
      },
      signOut: async () => {
        await adminLogout().catch(() => undefined);
        await refresh();
      },
      refresh,
    }),
    [admin, refresh],
  );
  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>;
}

export function useAdmin(): Ctx {
  const c = useContext(AdminCtx);
  if (!c) throw new Error('useAdmin must be used inside <AdminProvider>');
  return c;
}
