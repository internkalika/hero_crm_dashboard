import { BarChart3, Boxes, Database, Gauge, GitCompareArrows, Headset, Inbox, Layers, LayoutDashboard, Smile, Upload, Users, ClipboardList, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}
export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** leaf (no children) when `to` is set */
  to?: string;
  items?: NavItem[];
}

export const NAV: NavGroup[] = [
  { id: 'growth', label: 'Dealer App vs DataSense SFA', icon: GitCompareArrows, to: '/' },
  {
    id: 'dealer',
    label: 'Dealer App Performance',
    icon: Boxes,
    items: [
      { to: '/dealer/orders', label: 'Orders & Performance', icon: BarChart3 },
      { to: '/dealer/complaints', label: 'Complaints', icon: Headset },
      { to: '/hero-smiles', label: 'Hero Smiles', icon: Smile },
    ],
  },
  {
    id: 'datasense',
    label: 'DataSense SFA Performance',
    icon: Inbox,
    items: [
      { to: '/datasense/orders', label: 'Orders & Performance', icon: BarChart3 },
      { to: '/datasense/complaints', label: 'Complaints', icon: Headset },
      { to: '/datasense/employees', label: 'Usage Report', icon: Users },
    ],
  },
  { id: 'bizom', label: 'Bizom SFA Usage', icon: Gauge, to: '/bizom/usage' },
  { id: 'bizomsfa', label: 'Bizom SFA vs DataSense SFA Usage', icon: Layers, to: '/compare/bizom-vs-sfa' },
  { id: 'issues', label: 'Issue Tracker', icon: ClipboardList, to: '/issues' },
  { id: 'overview', label: 'Overall Summary', icon: LayoutDashboard, to: '/overview' },
  { id: 'import', label: 'Data Import', icon: Upload, to: '/import' },
  { id: 'admin', label: 'Data Management', icon: Database, to: '/admin' },
];

export function crumbsFor(path: string): Array<{ label: string; to?: string }> {
  const home = { label: 'Home', to: '/' };
  if (path === '/') return [{ label: 'Home' }, { label: 'Dealer App vs DataSense SFA' }];
  for (const g of NAV) {
    if (g.to === path) return [home, { label: g.label }];
    const it = g.items?.find((i) => i.to === path);
    if (it) return [home, { label: g.label }, { label: it.label }];
  }
  return [home];
}
