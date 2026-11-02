// Links between dashboards. Filters travel in the address as `f.<dimension>=<value>` (repeated for several values, plus
// `l.<dimension>=<label>` for the chip text), the same format the pages read through useCrossFilter, so any card, chart
// bar or insight can open a page already filtered.

/** One value, one value with its chip label, or several values (Excel-style) with their labels. */
export type FilterSpec = Record<string, string | [value: string, label: string] | { values: string[]; labels?: string[] }>;

export function pageLink(path: string, filters: FilterSpec = {}, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [dim, spec] of Object.entries(filters)) {
    const values = typeof spec === 'string' ? [spec] : Array.isArray(spec) ? [spec[0]] : spec.values;
    const labels = typeof spec === 'string' ? [spec] : Array.isArray(spec) ? [spec[1]] : spec.labels ?? spec.values;
    if (!values.length) continue;
    values.forEach((v) => p.append(`f.${dim}`, v));
    if (labels.some((l, i) => l && l !== values[i])) values.forEach((v, i) => p.append(`l.${dim}`, labels[i] || v));
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

/** Opens a dealer profile on top of the given page. Only validated dealer (ERP) codes are accepted. */
export const dealerLink = (path: string, dealerKey: string, tab?: string) => pageLink(path, {}, { dealer: dealerKey, ...(tab ? { dtab: tab } : {}) });

/** A validated dealer key is an ERP code, never a name-derived key. */
export const isValidatedDealerKey = (k: string | null | undefined): k is string => !!k && !k.startsWith('name:') && k.trim() !== '' && k !== '0';
