// Runs the publish sanitizer over the embedded snapshot and lists every value it changes (needs src/generated/snapshot.data.ts).
//   npx vite-node scripts/check-sanitizer.ts
import zlib from 'node:zlib';
import { SNAPSHOT } from '../src/generated/snapshot.data';
import { sanitizePayload } from '../src/lib/publish/sanitize';
import { validatePayload } from '../src/lib/publish/validate';
const all = JSON.parse(zlib.gunzipSync(Buffer.from(SNAPSHOT!.b64, 'base64')).toString());
const changes: Record<string, number> = {};
let bad = 0;
for (const p of all) {
  const v = validatePayload(p); if (!v.ok) { bad++; console.log('INVALID', p.meta.id, v.errors); }
  const { payload, report } = await sanitizePayload({ ...p, raw: [] }, { pepper: 'x' });
  const walk = (a: any, b: any, path: string) => {
    if (typeof a === 'string' || typeof a !== 'object' || a === null) { if (a !== b) { const k = `${p.meta.source} ${path}`; changes[k] = (changes[k] ?? 0) + 1; } return; }
    for (const k of Object.keys(a)) walk(a[k], b?.[k], Array.isArray(a) ? path : `${path}.${k}`);
  };
  walk(p.records, payload.records, 'records'); walk(p.issues, payload.issues, 'issues'); walk(p.meta, payload.meta, 'meta');
  if (report.tokenisedKeys || report.scrubbedValues || report.residual.length) console.log(p.meta.id.padEnd(34), JSON.stringify({ tokenised: report.tokenisedKeys, scrubbed: report.scrubbedValues, residual: report.residual }));
}
console.log('\nvalues changed by field:', changes, '\ninvalid datasets:', bad);
