// Recovers the data of the deployed CRM_Tracker_Dashboard (the single index.html) so that the rebuilt app can be
// loaded with exactly the same datasets:
//   npx vite-node scripts/extract-from-deployed.ts [path/to/deployed/index.html]    (npm run extract)
// Writes src/generated/snapshot.data.ts: the 17 embedded datasets plus the embedded Usage Report converted into a
// regular `ds_usage` dataset (it used to be a separate payload, so it could not be imported). Git-ignored: business data.
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { sanitizePayload } from '../src/lib/publish/sanitize';
import { findResidual } from '../src/lib/publish/sanitize';

const from = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? new URL('../../index.html', import.meta.url).pathname;
const html = fs.readFileSync(from, 'utf8');
const out = new URL('../src/generated/snapshot.data.ts', import.meta.url);

const snap = html.match(/const \w+=\{info:\{label:("(?:[^"\\]|\\.)*")\},b64:"([A-Za-z0-9+/=]+)"\};/);
if (!snap) throw new Error('embedded snapshot not found in ' + from);
const label = JSON.parse(snap[1]);
const payloads = JSON.parse(zlib.gunzipSync(Buffer.from(snap[2], 'base64')).toString('utf8'));
const usage = html.match(/const __UREP_B64="([A-Za-z0-9+/=]+)";/);
if (!usage) throw new Error('usage report payload not found');
const d = JSON.parse(zlib.gunzipSync(Buffer.from(usage[1], 'base64')).toString('utf8'));

/** The deployed Usage Report payload (dictionary-coded rows) as a DatasetPayload of source `ds_usage`. */
export function usageDataset(d: any) {
  const pick = (c: string, i: number) => (i < 0 ? '' : d.dict[c][i]);
  const occ = new Map<string, number>();
  const records = d.rows.map((a: any[], i: number) => {
    const date = a[0];
    const employee = pick('Employee', a[3]);
    const dealer = pick('Dealer', a[5]);
    const base = `${date}|${employee}|${dealer}|${a[10] ?? ''}|${a[11] ?? ''}`;
    const n = (occ.get(base) ?? 0) + 1;
    occ.set(base, n);
    return {
      key: `${base}#${n}`, datasetId: 'ds_usage:all', rowNo: i + 2, date, month: date.slice(0, 7),
      zone: pick('Zone', a[1]), asm: pick('ASM', a[2]), employee, punchedBy: pick('Punched By', a[4]), dealer,
      platform: pick('Platform', a[6]), source: pick('Source', a[7]), status: pick('Status', a[8]), rejectReason: pick('Reject Reason', a[9]),
      items: a[10], total: a[11], orderNo: null,
    };
  });
  const dates = records.map((r: any) => r.date).sort();
  const [lo, hi] = [dates[0], dates.at(-1) as string];
  const count = (f: (r: any) => boolean) => records.filter(f).length;
  const rejected = new Set(['Rejected by ASM', 'Rejected by SAP', 'SAP Order Not Created']);
  const computed: Record<string, number> = { 'Total orders': records.length, 'SFA app orders': count((r: any) => r.source === 'SFA'), 'Manual SAP orders': count((r: any) => r.source === 'SAP'), 'Archived orders': count((r: any) => r.status === 'Archived'), 'Rejected orders (ASM / SAP / Not created)': count((r: any) => rejected.has(r.status)) };
  const reconciliation = Object.entries(computed).filter(([k]) => d.summary[k] !== undefined).map(([field, c]) => ({ field, reported: d.summary[field], computed: c, diff: c - d.summary[field] }));
  const [dd, mm, yy, hh, mi] = d.meta['Generated on'].match(/\d+/g).map(Number);
  const importedAt = new Date(Date.UTC(yy, mm - 1, dd, hh, mi) - 330 * 60000).toISOString(); // report time is IST
  const columns = ['Date', 'Zone', 'ASM', 'Employee', 'Punched By', 'Dealer', 'Platform', 'Source', 'Status', 'Reject Reason', 'Items', 'Total'];
  return {
    meta: {
      id: 'ds_usage:all', source: 'ds_usage', scope: 'all', fileName: d.file, sheet: 'Orders', importedAt,
      periodStart: lo, periodEnd: hi, period: `${lo} to ${hi}`, snapshotDate: null, asOfDate: hi,
      rawCount: records.length, validCount: records.length, duplicateCount: 0, invalidCount: 0, flaggedCount: 0,
      mappingVersion: 'm1', columns,
      mapping: { date: 'Date', zone: 'Zone', asm: 'ASM', employee: 'Employee', punchedBy: 'Punched By', dealer: 'Dealer', platform: 'Platform', source: 'Source', status: 'Status', rejectReason: 'Reject Reason', items: 'Items', total: 'Total' },
      inference: [
        'Loaded from the Usage Report embedded in the 29 Oct 2026 dashboard (the original workbook is not part of this build, so there is no file hash to recognise a repeat upload).',
        'Each row is one order recorded on a platform (Mobile, Web or Old App / SAP). Counts are orders, not report accesses, downloads or successful transactions.',
        'The file has no order number: an order is identified by date, employee, dealer, items and total, so a changed status updates the same order when files are merged.',
      ],
      fileSize: 0, mode: 'add', totalRowCount: 0,
      extra: {
        reconciliation, fileKind: 'xlsx', sheets: ['Summary', 'ASM-Employee-wise', 'Orders'], recoveredFromEmbeddedReport: true,
        usageReport: { reported: d.meta, summary: d.summary, employees: d.employees, notes: ['3 order numbers appear on two rows each with different dealers; every row is kept as its own order.'] },
      },
    },
    records, issues: [], raw: [],
  };
}

// The page that ships must not carry what the publish workflow would remove (mobile numbers inside the Hero Smiles keys,
// numbers in free text). The secret only has to be unguessable; it is not needed again, so a build without one makes its own.
const pepper = process.env.CRM_PUBLISH_PEPPER && process.env.CRM_PUBLISH_PEPPER.length >= 32 ? process.env.CRM_PUBLISH_PEPPER : crypto.randomBytes(32).toString('hex');
const all: any[] = [];
let tokenised = 0;
let scrubbed = 0;
for (const p of [...payloads.filter((p: any) => p.meta.source !== 'ds_usage'), usageDataset(d)]) {
  const { payload, report } = await sanitizePayload({ ...p, raw: [] }, { pepper });
  if (report.residual.length || findResidual(payload).length) throw new Error(`${p.meta.id} still holds personal data after sanitizing.`);
  tokenised += report.tokenisedKeys;
  scrubbed += report.scrubbedValues;
  all.push(payload);
}
const info = { label: `${label} + Usage Report dataset`, builtAt: payloads.map((p: any) => p.meta.importedAt).sort().pop(), datasets: all.length };
const b64 = zlib.gzipSync(Buffer.from(JSON.stringify(all)), { level: 9 }).toString('base64');
fs.writeFileSync(out, `// GENERATED by scripts/extract-from-deployed.mjs - contains business data, never commit.\nimport type { SnapshotBundle } from '../lib/store/snapshot';\n\nexport const SNAPSHOT: SnapshotBundle | null = {\n  info: ${JSON.stringify(info)},\n  b64: '${b64}',\n};\n`);
console.log(`snapshot "${info.label}": ${all.length} datasets (${payloads.length} embedded + the Usage Report, ${all.at(-1).records.length} orders), ${(b64.length / 1e6).toFixed(2)} MB base64; sanitized: ${tokenised} keys made anonymous, ${scrubbed} values removed`);
