import { describe, expect, it } from 'vitest';
import type { DatasetMeta, DatasetPayload } from '../src/lib/types';
import { findResidual, sanitizePayload } from '../src/lib/publish/sanitize';
import { validatePayload } from '../src/lib/publish/validate';
import { decodeDataset, encodeDataset } from '../src/lib/publish/codec';
import { diffDatasets } from '../src/lib/publish/diff';

const meta = (source: string, scope = 'all'): DatasetMeta => ({
  id: `${source}:${scope}`, source: source as DatasetMeta['source'], scope, fileName: 'f.csv', importedAt: '2026-10-29T00:00:00.000Z', periodStart: null, periodEnd: null, period: null,
  rawCount: 0, validCount: 0, duplicateCount: 0, invalidCount: 0, flaggedCount: 0, mappingVersion: 'm1', columns: [], mapping: {}, inference: [], fileSize: 1, mode: 'add', extra: {},
});
const payload = (source: string, records: unknown[], issues: DatasetPayload['issues'] = [], scope = 'all'): DatasetPayload => {
  const m = meta(source, scope);
  m.validCount = records.length;
  return { meta: m, records, issues, raw: [{ junk: 1 }] };
};
const PEPPER = 'test-pepper';

describe('sanitizer', () => {
  const loyalty = payload('loyalty_snapshot', [
    { key: '2026-10-05|unverified:917002533087:Cycle house', datasetId: 'loyalty_snapshot:all', customerId: 'NOT-CAPTURED', idKind: 'unverified', entityKey: 'unverified:917002533087:Cycle house', mobileMasked: '91••••••3087', firmName: 'Cycle house', current: 10 },
    { key: '2026-10-05|10061', datasetId: 'loyalty_snapshot:all', customerId: '10061', idKind: 'verified', entityKey: '10061', mobileMasked: '91••••••2764', firmName: 'Kamala Cycle Mart', current: 20 },
  ]);

  it('tokenises the mobile number inside unverified loyalty keys, keeping them unique and stable', async () => {
    const a = (await sanitizePayload(loyalty, { pepper: PEPPER })).payload.records as Array<Record<string, string>>;
    expect(a[0].entityKey).toMatch(/^unverified:m[0-9a-f]{12}:Cycle house$/);
    expect(a[0].key).toBe(`2026-10-05|${a[0].entityKey}`);
    expect(JSON.stringify(a)).not.toContain('917002533087');
    const b = (await sanitizePayload(loyalty, { pepper: PEPPER })).payload.records as Array<Record<string, string>>;
    expect(b[0].entityKey).toBe(a[0].entityKey); // stable
    const c = (await sanitizePayload(loyalty, { pepper: 'other' })).payload.records as Array<Record<string, string>>;
    expect(c[0].entityKey).not.toBe(a[0].entityKey); // depends on the secret, so it cannot be brute-forced from the public data
  });
  it('leaves verified keys, ids, masked numbers and names untouched', async () => {
    const out = (await sanitizePayload(loyalty, { pepper: PEPPER })).payload.records as Array<Record<string, unknown>>;
    expect(out[1]).toEqual(loyalty.records[1]);
    expect(out[0].mobileMasked).toBe('91••••••3087');
    expect(out[0].firmName).toBe('Cycle house');
  });
  it('removes phone numbers and e-mail addresses from free text, in records, nested arrays, issues and meta', async () => {
    const p = payload(
      'issue_tracker',
      [{ key: 'k1', datasetId: 'issue_tracker:all', pointer: 'Call Mr Sharma on 9876543210 or +91 98765 43210', lastUpdateText: 'mail a.b@hero.com now', updates: [{ text: 'ring 09876543210' }], ticketNo: '9999900004' }],
      [{ code: 'X', severity: 'info', message: 'value 98765-43210 echoed', value: '9876543210', ref: 'r' }],
    );
    p.meta.inference = ['contact 9123456789'];
    const { payload: out, report } = await sanitizePayload(p, { pepper: PEPPER });
    const r = out.records[0] as Record<string, unknown>;
    expect(r.pointer).toBe('Call Mr Sharma on [removed] or [removed]');
    expect(r.lastUpdateText).toBe('mail [removed] now');
    expect((r.updates as Array<{ text: string }>)[0].text).toBe('ring [removed]');
    expect(r.ticketNo).toBe('9999900004'); // a code, left alone
    expect(out.issues[0]).toMatchObject({ message: 'value [removed] echoed', value: '[removed]' });
    expect(out.meta.inference).toEqual(['contact [removed]']);
    expect(report.scrubbedValues).toBeGreaterThanOrEqual(5);
    expect(report.residual).toEqual([]);
  });
  it('never publishes raw rows', async () => {
    const { payload: out, report } = await sanitizePayload(loyalty, { pepper: PEPPER });
    expect(out.raw).toEqual([]);
    expect(report.droppedRaw).toBe(1);
  });
  it('is idempotent and changes nothing when there is nothing personal', async () => {
    const plain = payload('bizom_usage', [{ key: '2026-10|1|98', datasetId: 'bizom_usage:all', userId: '1', reportId: '98', accessCount: 2, name: 'Dharm Singh', reportName: 'BrandWise Billed Outlets' }]);
    const once = (await sanitizePayload(plain, { pepper: PEPPER })).payload;
    expect({ ...once, raw: plain.raw }).toEqual(plain);
    const twice = (await sanitizePayload(once, { pepper: PEPPER })).payload;
    expect(twice).toEqual(once);
    const lo1 = (await sanitizePayload(loyalty, { pepper: PEPPER })).payload;
    expect((await sanitizePayload(lo1, { pepper: PEPPER })).payload).toEqual(lo1);
  });
  it('reports what it still finds after sanitizing (so a publish can be refused)', () => {
    const dirty = payload('ds_complaints', [{ key: 'k', datasetId: 'ds_complaints:all', id: 'c1', rawStatus: 'Open', description: 'call 9876543210' }]);
    expect(findResidual(dirty)).toEqual([{ path: 'records[0].description', kind: 'mobile' }]);
  });
  it('needs a pepper', async () => {
    await expect(sanitizePayload(loyalty, { pepper: '' })).rejects.toThrow(/pepper/);
  });
});

describe('validation', () => {
  const ok = payload('ds_usage', [{ key: 'a', datasetId: 'ds_usage:all', date: '2026-10-01', dealer: 'D', platform: 'Web', status: 'Open' }]);
  it('accepts a well-formed dataset', () => expect(validatePayload(ok)).toMatchObject({ ok: true, records: 1 }));
  it('rejects unknown sources, id mismatches and missing fields', () => {
    expect(validatePayload(payload('nope', [{ key: 'a', datasetId: 'nope:all' }])).errors[0]).toMatch(/Unknown source/);
    const wrongId = { ...ok, meta: { ...ok.meta, id: 'ds_usage:2026-10' } };
    expect(validatePayload(wrongId).errors.join()).toMatch(/does not match/);
    expect(validatePayload(payload('ds_usage', [{ key: 'a', datasetId: 'ds_usage:all', date: '2026-10-01' }])).errors.join()).toMatch(/required field/);
  });
  it('rejects repeated keys, foreign dataset ids, empty datasets and non-objects', () => {
    const r = { key: 'a', datasetId: 'ds_usage:all', date: 'd', dealer: 'D', platform: 'Web', status: 'Open' };
    expect(validatePayload(payload('ds_usage', [r, r])).errors.join()).toMatch(/repeat a key/);
    expect(validatePayload(payload('ds_usage', [{ ...r, datasetId: 'x:y' }])).errors.join()).toMatch(/another dataset/);
    expect(validatePayload(payload('ds_usage', [])).errors.join()).toMatch(/no records/);
    expect(validatePayload(payload('ds_usage', ['x'])).errors.join()).toMatch(/not objects/);
    expect(validatePayload(null).ok).toBe(false);
    expect(validatePayload({ meta: {} }).ok).toBe(false);
  });
});

describe('codec and diff', () => {
  it('round-trips a dataset and addresses it by content', async () => {
    const p = payload('ds_usage', [{ key: 'a', datasetId: 'ds_usage:all', date: '2026-10-01', dealer: 'D', platform: 'Web', status: 'Open' }]);
    const a = await encodeDataset(p);
    const b = await encodeDataset({ ...p, raw: [{ different: true }] }); // raw is never part of it
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await decodeDataset(a.bytes)).records).toEqual(p.records);
    const c = await encodeDataset({ ...p, records: [{ ...(p.records[0] as object), status: 'Billing' }] });
    expect(c.sha256).not.toBe(a.sha256);
  });
  it('counts inserted, updated, removed and unchanged by key', () => {
    const rec = (key: string, status = 'Open') => ({ key, datasetId: 'ds_usage:all', status });
    const base = payload('ds_usage', [rec('1'), rec('2'), rec('3')]);
    expect(diffDatasets(null, base)).toMatchObject({ status: 'new', inserted: 3 });
    expect(diffDatasets(base, payload('ds_usage', [rec('1'), rec('2', 'Billing'), rec('4')]))).toEqual({ status: 'changed', inserted: 1, updated: 1, removed: 1, unchanged: 1 });
    expect(diffDatasets(base, payload('ds_usage', [rec('1'), rec('2'), rec('3')]))).toMatchObject({ status: 'unchanged', unchanged: 3 });
  });
});
