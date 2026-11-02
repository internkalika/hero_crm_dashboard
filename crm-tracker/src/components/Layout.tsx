import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, Upload, X } from 'lucide-react';
import clsx from 'clsx';
import { NAV, crumbsFor } from './nav';
import { useData } from '../state/DataContext';
import { DealerProfile } from './DealerProfile';
import { Assistant } from './Assistant';
import { Notice } from './ui';
import { DateRangePicker } from './DateRangePicker';
import { LastUpdated } from './LastUpdated';
import { ThemeToggle } from './ThemeToggle';
import logoUrl from '../assets/hero-cycles-logo.jpg?inline';

const safeGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage can be blocked; the UI still works */
  }
};

function Logo() {
  return (
    /* the supplied logo file, unaltered; multiply removes its off-white box on the light panel */
    <div className="logo-chip flex h-10 shrink-0 items-center rounded-md bg-surface-2 px-2 sm:h-12">
      <img src={logoUrl} alt="Hero Cycles" className="h-7 w-auto max-w-none shrink-0 mix-blend-multiply sm:h-9" />
    </div>
  );
}

function Title() {
  return (
    <div className="leading-tight">
      <div className="text-lg font-bold tracking-tight text-ink sm:text-xl">CRM Tracker</div>
      <div className="text-[11px] text-ink-2 sm:text-xs">Bizom SFA | Dealer App | DataSense SFA</div>
    </div>
  );
}

/** Pages whose figures follow the reporting range. The others (issue tracker, Hero Smiles balances, data tools) have no dated figures to narrow. */
const RANGE_PAGES = new Set(['/', '/overview', '/dealer/orders', '/dealer/complaints', '/datasense/orders', '/datasense/complaints', '/datasense/employees', '/bizom/usage', '/compare/bizom-vs-sfa']);

/** The one reporting-range control of the dashboard: a calendar limited to the dates the data covers. */
function RangeControl() {
  const { period, span, setCustomRange, setPeriodId } = useData();
  const value = period.from && period.to ? { from: period.from, to: period.to } : null;
  return <DateRangePicker min={span?.min ?? null} max={span?.max ?? null} value={value} onApply={setCustomRange} onReset={() => setPeriodId('all')} />;
}

/** Header shortcut to Data Import. */
function ImportButton() {
  const { pathname } = useLocation();
  const here = pathname === '/import';
  return (
    <Link
      to="/import"
      title="Data Import"
      aria-label="Import data: open Data Import"
      aria-current={here ? 'page' : undefined}
      className={clsx('btn shrink-0 gap-1.5 px-2.5 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-2', here ? 'btn-primary' : 'border-hero-600 text-hero-700 hover:bg-hero-50')}
    >
      <Upload size={16} aria-hidden />
      <span className="hidden sm:inline">Import</span>
    </Link>
  );
}

function Sidebar({ collapsed, onToggle, mobileOpen, closeMobile }: { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; closeMobile: () => void }) {
  const loc = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({ dealer: true, bizom: true, datasense: true, compare: true });
  useEffect(() => {
    const g = NAV.find((n) => n.items?.some((i) => i.to === loc.pathname));
    if (g) setOpen((o) => ({ ...o, [g.id]: true }));
  }, [loc.pathname]);
  const linkCls = ({ isActive }: { isActive: boolean }) => clsx('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', isActive ? 'bg-hero-600 text-white' : 'text-ink hover:bg-slate-100');
  const rail = collapsed && !mobileOpen;
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={closeMobile} />}
      <nav aria-label="Main navigation" className={clsx('z-30 flex shrink-0 flex-col border-r border-slate-200 bg-surface transition-all', 'fixed inset-y-0 left-0 top-[110px] sm:top-16 lg:static', mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0', rail ? 'w-16' : 'w-72')}>
        <div className="flex-1 overflow-y-auto p-2">
          {NAV.map((g) => {
            const Icon = g.icon;
            if (g.to) {
              return (
                <NavLink key={g.id} to={g.to} end onClick={closeMobile} className={linkCls} title={rail ? g.label : undefined}>
                  <Icon size={18} className="shrink-0" />
                  {!rail && <span>{g.label}</span>}
                </NavLink>
              );
            }
            const isOpen = open[g.id] ?? true;
            const childActive = g.items?.some((i) => i.to === loc.pathname);
            return (
              <div key={g.id} className="mt-1">
                <button
                  className={clsx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600', childActive ? 'text-hero-700' : 'text-ink')}
                  aria-expanded={isOpen}
                  title={rail ? g.label : undefined}
                  onClick={() => (rail ? onToggle() : setOpen((o) => ({ ...o, [g.id]: !isOpen })))}
                >
                  <Icon size={18} className="shrink-0" />
                  {!rail && (
                    <>
                      <span className="flex-1">{g.label}</span>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </>
                  )}
                </button>
                {!rail && isOpen && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
                    {g.items!.map((i) => (
                      <NavLink key={i.to} to={i.to} onClick={closeMobile} className={linkCls}>
                        <span className="text-[13px]">{i.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="hidden border-t border-slate-200 p-2 lg:block">
          <button className="btn btn-ghost w-full justify-start" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </nav>
    </>
  );
}

export function Layout(): ReactNode {
  const { data, loading, storageNote } = useData();
  const loc = useLocation();
  const navigate = useNavigate();
  const canGoBack = loc.key !== 'default';
  const [collapsed, setCollapsed] = useState(() => safeGet('crm.sidebar') === 'collapsed');
  const [mobile, setMobile] = useState(false);
  const crumbs = crumbsFor(loc.pathname);
  useEffect(() => setMobile(false), [loc.pathname]);
  const files = data.datasets.length;
  return (
    <div className="flex h-full flex-col">
      <header className="no-print z-40 grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-b border-slate-200 bg-surface px-3 py-2 sm:min-h-16 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:gap-x-3 sm:px-4 sm:py-0">
        <div className="col-start-1 row-start-1 flex items-center gap-1 justify-self-start sm:gap-2">
          <button className="btn btn-ghost lg:hidden" aria-label="Open navigation" onClick={() => setMobile((m) => !m)}>
            {mobile ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link to="/" aria-label="CRM Tracker home" className="shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600">
            <Logo />
          </Link>
        </div>
        {/* the title sits in the left corner beside the logo; the import button is in the right corner */}
        <Link to="/" aria-label="CRM Tracker home" className="col-start-2 row-start-1 min-w-0 justify-self-start rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600">
          <Title />
        </Link>
        <div className="col-span-3 row-start-2 flex flex-wrap items-center gap-x-4 gap-y-1 sm:col-span-1 sm:col-start-3 sm:row-start-1">
          <LastUpdated />
          {RANGE_PAGES.has(loc.pathname) && <RangeControl />}
        </div>
        <div className="col-start-3 row-start-1 flex items-center gap-2 justify-self-end sm:col-start-4">
          <ThemeToggle />
          <ImportButton />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} onToggle={() => (setCollapsed((c) => !c), safeSet('crm.sidebar', collapsed ? 'open' : 'collapsed'))} mobileOpen={mobile} closeMobile={() => setMobile(false)} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
            <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-ink-3">
              {canGoBack && (
                <button className="mr-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-ink-2 hover:bg-slate-200/60 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600" onClick={() => navigate(-1)} aria-label="Go back">
                  <ArrowLeft size={13} /> Back
                </button>
              )}
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={12} />}
                  {c.to ? (
                    <Link to={c.to} className="hover:text-ink hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span className={i === crumbs.length - 1 ? 'font-medium text-ink-2' : ''}>{c.label}</span>
                  )}
                </span>
              ))}
            </nav>
            {storageNote && (
              <div className="mb-4">
                <Notice tone="warn" title="Showing the embedded data only">{storageNote}</Notice>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>
      <DealerProfile />
      <Assistant />
    </div>
  );
}
