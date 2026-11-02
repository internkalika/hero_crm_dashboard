// The Executive Overview's dealer filter. A dealer is the one thing every dealer-level system shares, and only the
// validated ERP dealer code identifies it (names are never used to join), so the filter narrows the data to one code:
// that dealer's Dealer App orders, DataSense orders, complaints in both systems and Hero Smiles balance.
//
// Bizom report usage, the issue tracker and the DataSense employee-activity report are not recorded per dealer, so a
// dealer scope empties them. The Overview then shows those tiles as "not recorded per dealer" instead of a misleading zero.
import type { AppData } from '../types';
import { isValidatedDealerKey } from '../nav/links';
import { titleCase } from '../util/parse';

export interface DealerChoice {
  key: string;
  label: string;
}

/** Narrow every dealer-level dataset to one or several validated dealer codes. No code leaves the data untouched. */
export function scopeToDealer(data: AppData, dealerKeys: string | string[] | null | undefined): AppData {
  const keys = (Array.isArray(dealerKeys) ? dealerKeys : dealerKeys ? [dealerKeys] : []).filter(Boolean);
  if (!keys.length) return data;
  const want = new Set(keys);
  const mine = <T extends { dealerKey: string | null }>(xs: T[]) => xs.filter((x) => x.dealerKey !== null && want.has(x.dealerKey));
  return {
    ...data,
    dealerLines: mine(data.dealerLines),
    dsOrders: mine(data.dsOrders),
    dealerComplaints: mine(data.dealerComplaints),
    dsComplaints: mine(data.dsComplaints),
    loyalty: data.loyalty.filter((r) => r.idKind === 'verified' && want.has(r.entityKey)),
    // not recorded per dealer
    usage: [],
    issues: [],
    dsEmployees: [],
    dealerSfa: [],
  };
}

/** Every validated dealer code found in the imported data, with the most trustworthy name seen for it (Dealer App name first). */
export function dealerChoices(data: AppData): DealerChoice[] {
  const names = new Map<string, string>();
  const see = (key: string | null | undefined, name: string | null | undefined) => {
    if (!isValidatedDealerKey(key)) return;
    if (!names.has(key) || (!names.get(key) && name)) names.set(key, (name ?? '').trim());
  };
  data.dealerLines.forEach((l) => see(l.dealerKey, l.outletName));
  data.dsOrders.forEach((o) => see(o.dealerKey, o.dealerName));
  data.dealerComplaints.forEach((c) => see(c.dealerKey, c.dealerName));
  data.dsComplaints.forEach((c) => see(c.dealerKey, c.dealerName));
  data.loyalty.forEach((r) => r.idKind === 'verified' && see(r.entityKey, r.firmName));
  return [...names.entries()]
    .map(([key, name]) => ({ key, label: name ? `${titleCase(name.toLowerCase())} · ${key}` : key }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
