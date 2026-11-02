import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Light / dark theme. Light is the default for a first-time visitor. The choice is kept in localStorage ('crm.theme') and applied
 * as a class on <html> (public/theme-init.js does the same before first paint, so there is no flash). Changing it touches nothing
 * else: filters and selections live in other state.
 */
export type Theme = 'light' | 'dark';
const KEY = 'crm.theme';

const read = (): Theme => {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', t === 'dark');
  root.style.colorScheme = t;
}

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}
const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(read);
  useEffect(() => applyTheme(theme), [theme]);
  // another tab changed it
  useEffect(() => {
    const on = (e: StorageEvent) => e.key === KEY && setThemeState(e.newValue === 'dark' ? 'dark' : 'light');
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* the choice then lasts for this visit only */
    }
  }, []);
  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);
  return <ThemeCtx.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error('useTheme must be used inside <ThemeProvider>');
  return c;
}
