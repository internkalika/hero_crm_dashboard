import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../state/ThemeContext';

/** Header switch between the light and dark theme. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button type="button" className="btn shrink-0 gap-1.5 px-2.5 py-1.5" onClick={toggle} aria-pressed={dark} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} data-testid="theme-toggle">
      {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
      <span className="hidden text-xs sm:inline">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
