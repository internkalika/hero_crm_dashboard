// Publish-time sanitizer. Runs in the browser (preview) and on the server (authoritative) over the dataset a
// viewer would receive. It must be neutral for everything the dashboards read: only personal identifiers are touched.
//
//   * raw source rows are never published
//   * Hero Smiles: the full mobile number that the "unverified" entity keys carry is replaced by a one-way token
//     (HMAC with a server-side secret), so the key stays unique; the masked display field stays as it is
//   * every other text: mobile numbers (10 digits, optional +91 / 0 / a 5-5 split) and e-mail addresses are removed
//   * fields that hold codes (…Id, …Code, …Key, …No, …Number, …Ref, ticket) are left alone: they join datasets
// Names of dealers and staff are NOT removed: the dashboards rank and list them.
import type { DatasetPayload } from '../types.js';

export const MOBILE_RE = /(?<![\d.\-])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
export const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LONG_DIGITS_RE = /\d{10,}/g;
const ID_FIELD_RE = /(?:^|[a-z])(?:id|code|key|no|number|ref|ticket)$/i;
export const REMOVED = '[removed]';

export interface SanitizeReport {
  dataset: string;
  droppedRaw: number;
  tokenisedKeys: number;
  scrubbedValues: number;
  /** values that still look like a phone number or e-mail after sanitizing (must be empty to publish) */
  residual: Array<{ path: string; kind: 'mobile' | 'email' }>;
}

const isIdField = (name: string) => ID_FIELD_RE.test(name);

/** The display field is already masked ("91••••••2764"); if a full number ever shows up there, mask it the same way. */
function maskIfUnmasked(v: string): string {
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 && !/[•*xX]{3,}/.test(v) ? `${digits.slice(0, 2)}••••••${digits.slice(-4)}` : v;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Digit runs of the loyalty keys that identify a phone number, tokenised once each. */
async function tokenTable(payload: DatasetPayload, pepper: string): Promise<Map<string, string>> {
  const runs = new Set<string>();
  const scan = (s: unknown) => {
    if (typeof s !== 'string') return;
    for (const m of s.matchAll(LONG_DIGITS_RE)) runs.add(m[0]);
  };
  for (const r of payload.records as Array<Record<string, unknown>>) {
    scan(r.key);
    scan(r.entityKey);
  }
  const table = new Map<string, string>();
  for (const run of runs) table.set(run, `m${(await hmacHex(pepper, run)).slice(0, 12)}`);
  return table;
}

export async function sanitizePayload(input: DatasetPayload, opts: { pepper: string }): Promise<{ payload: DatasetPayload; report: SanitizeReport }> {
  if (!opts.pepper) throw new Error('A pepper (server-side secret) is required to sanitize a dataset.');
  const loyalty = input.meta.source === 'loyalty_snapshot';
  const tokens = loyalty ? await tokenTable(input, opts.pepper) : new Map<string, string>();
  const report: SanitizeReport = { dataset: input.meta.id, droppedRaw: input.raw?.length ?? 0, tokenisedKeys: 0, scrubbedValues: 0, residual: [] };

  const scrubText = (s: string): string => {
    let hit = false;
    const out = s.replace(EMAIL_RE, () => ((hit = true), REMOVED)).replace(MOBILE_RE, () => ((hit = true), REMOVED));
    if (hit) report.scrubbedValues++;
    return out;
  };
  const tokenise = (s: string): string => {
    if (!s.match(LONG_DIGITS_RE)) return s;
    report.tokenisedKeys++;
    return s.replace(LONG_DIGITS_RE, (run) => tokens.get(run) ?? REMOVED);
  };

  const walk = (v: unknown, field: string): unknown => {
    if (typeof v === 'string') {
      if (loyalty && (field === 'key' || field === 'entityKey')) return tokenise(v);
      if (isIdField(field)) return v;
      if (loyalty && field === 'mobileMasked') return maskIfUnmasked(v);
      return scrubText(v);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, field));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = walk(x, k);
      return o;
    }
    return v;
  };

  const payload: DatasetPayload = {
    meta: walk(input.meta, 'meta') as DatasetPayload['meta'],
    records: (input.records as unknown[]).map((r) => walk(r, 'record')),
    issues: input.issues.map((i) => walk(i, 'issue') as DatasetPayload['issues'][number]),
    raw: [],
  };
  // The rows' own fields are walked by name; the container names above must not be mistaken for a code field.
  report.residual = findResidual(payload, loyalty);
  return { payload, report };
}

/** Anything that still looks like a phone number or e-mail in a field that is not a code. */
export function findResidual(payload: DatasetPayload, loyalty = payload.meta.source === 'loyalty_snapshot', cap = 20): SanitizeReport['residual'] {
  const out: SanitizeReport['residual'] = [];
  const visit = (v: unknown, field: string, path: string) => {
    if (out.length >= cap) return;
    if (typeof v === 'string') {
      if (isIdField(field) || (loyalty && (field === 'key' || field === 'entityKey'))) return;
      if (/[•*xX]{4,}/.test(v) && !/\d{7,}/.test(v)) return;
      MOBILE_RE.lastIndex = 0;
      EMAIL_RE.lastIndex = 0;
      if (MOBILE_RE.test(v)) out.push({ path, kind: 'mobile' });
      else if (EMAIL_RE.test(v)) out.push({ path, kind: 'email' });
      MOBILE_RE.lastIndex = 0;
      EMAIL_RE.lastIndex = 0;
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, field, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k, `${path}.${k}`);
  };
  visit(payload.meta, 'meta', 'meta');
  payload.records.forEach((r, i) => visit(r, 'record', `records[${i}]`));
  payload.issues.forEach((r, i) => visit(r, 'issue', `issues[${i}]`));
  return out;
}
