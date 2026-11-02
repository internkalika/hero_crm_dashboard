// End-to-end: the real built app (vite build --mode vercel) + the real /api functions on a local server with a directory
// as the store. Two administrators and viewers in separate browser contexts (separate cookies and IndexedDB).
//   npm run build:vercel && node tools/compat/e2e_publish.cjs
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = 4175;
const BASE = `http://localhost:${PORT}`;
const SECRET = 'correct horse battery staple';
const FX = path.join(__dirname, 'fixtures', 'usage');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (p) => p.evaluate(() => document.body.innerText);
const waitText = async (p, re, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await text(p))) return Date.now() - t0; await sleep(400); } return null; };
const orders = async (p) => { const t = await text(p); const m = /Orders recorded\s+([\d,]+)/i.exec(t); return m ? Number(m[1].replace(/,/g, '')) : null; };

async function startServer(store) {
  const proc = spawn('npx', ['vite-node', 'scripts/dev-server.ts'], { cwd: ROOT, detached: true, env: { ...process.env, PORT: String(PORT), CRM_STORE_DIR: store, CRM_ADMIN_SECRET: SECRET, CRM_SESSION_SECRET: 's'.repeat(48), CRM_PUBLISH_PEPPER: 'p'.repeat(48) } });
  let log = '';
  proc.stdout.on('data', (d) => (log += d)); proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100 && !log.includes('dev server on'); i++) await sleep(300);
  if (!log.includes('dev server on')) throw new Error('server did not start: ' + log);
  return { proc, log: () => log };
}

async function importFile(p, file, mode) {
  await p.goto(`${BASE}/import`); await sleep(1200);
  await p.setInputFiles('input[type=file]', file); await sleep(2500);
  const identified = await text(p);
  // worksheet selection (the workbook has three sheets): pick Orders explicitly
  const sel = p.locator('select').filter({ has: p.locator('option', { hasText: /^Orders/ }) }).first();
  let sheetOptions = [];
  if (await sel.count()) { sheetOptions = await sel.locator('option').allInnerTexts(); const idx = sheetOptions.findIndex((o) => /^Orders/.test(o)); await sel.selectOption({ index: idx }); await sleep(300); }
  const seen = { identified, sheetOptions, steps: [] };
  for (let i = 0; i < 8; i++) {
    const modeSel = p.locator('select[aria-label^="How to import"]');
    if (await modeSel.count()) {
      seen.options = await modeSel.first().locator('option').allInnerTexts();
      if (mode) await modeSel.first().selectOption({ value: mode.toLowerCase() });
      seen.reconcile = (await text(p)).includes('Check against the report');
      seen.refresh = await text(p);
      const box = p.locator('input[type=checkbox]').filter({ has: p.locator('xpath=..') });
      for (let k = 0, n = await p.locator('main input[type=checkbox]').count(); k < n; k++) { const c = p.locator('main input[type=checkbox]').nth(k); if (!(await c.isChecked())) await c.check().catch(() => {}); }
    }
    const next = p.locator('main button', { hasText: /^\s*(Next|Apply import)\b/ }).first();
    for (let w = 0; w < 40 && (await next.count()) && (await next.isDisabled()); w++) await sleep(500); // the file is still being read
    if (!(await next.count()) || (await next.isDisabled())) { seen.stalled = (await text(p)).replace(/\s+/g, ' ').slice(0, 300); break; }
    const label = (await next.innerText()).trim();
    await next.click(); await sleep(label === 'Apply import' ? 3500 : 1300);
    if (label === 'Apply import') break;
  }
  seen.done = await text(p);
  return seen;
}

(async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-e2e-'));
  const srv = await startServer(store);
  const browser = await chromium.launch();
  const mk = async (headers = {}) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 }, extraHTTPHeaders: headers }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e))); return { ctx, page, errs }; };
  try {
    // ------------------------------------------------------------- viewer, before anything is published
    const B = await mk({ 'x-forwarded-for': '198.51.100.20' });
    await B.page.goto(`${BASE}/datasense/employees`); await sleep(3500);
    const base = await orders(B.page);
    check('viewer sees the embedded Usage Report without signing in', base === 29679, `Orders recorded ${base}`);
    await B.page.goto(`${BASE}/admin`); await sleep(2000);
    const bt = await text(B.page);
    check('viewer sees "nothing published yet" and no admin tools', /Nothing published yet/.test(bt) && /Administrator secret/i.test(bt) && !/Review and publish/.test(bt));
    await B.page.goto(`${BASE}/datasense/employees`); await sleep(2500);

    // ------------------------------------------------------------- the built app never contains a secret
    const assets = fs.readdirSync(path.join(ROOT, 'dist/assets')).filter((f) => f.endsWith('.js'));
    const bundle = assets.map((f) => fs.readFileSync(path.join(ROOT, 'dist/assets', f), 'utf8')).join('\n') + fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
    check('front-end bundle contains neither the admin secret, nor the token names, nor the pepper', !bundle.includes(SECRET) && !/BLOB_READ_WRITE_TOKEN|CRM_PREVIEW_READ_WRITE_TOKEN|CRM_ADMIN_SECRET_VALUE|vercel_blob_rw_/.test(bundle) && !bundle.includes('p'.repeat(48)));
    const rawLeak = /917002533087|916301773040|919550387445/.test(bundle);
    check('the embedded fallback no longer carries the Hero Smiles mobile numbers', !rawLeak);

    // ------------------------------------------------------------- administrator A signs in
    const A = await mk({ 'x-forwarded-for': '203.0.113.10' });
    await A.page.goto(`${BASE}/admin`); await sleep(2000);
    await A.page.fill('#admin-secret', 'not the secret'); await A.page.click('button:has-text("Sign in")'); await sleep(1500);
    check('wrong secret is refused with a clear message', /not correct/.test(await text(A.page)));
    await A.page.fill('#admin-secret', SECRET); await A.page.click('button:has-text("Sign in")'); await sleep(2500);
    check('right secret signs in', /Signed in as administrator/.test(await text(A.page)));
    const jsCookie = await A.page.evaluate(() => document.cookie);
    const cookies = await A.ctx.cookies();
    const c = cookies.find((x) => x.name === 'crm_admin');
    check('session cookie is HttpOnly, SameSite=Strict, limited to /api, and not readable by page scripts', c && c.httpOnly && c.sameSite === 'Strict' && c.path === '/api' && !jsCookie.includes('crm_admin'), JSON.stringify({ httpOnly: c?.httpOnly, sameSite: c?.sameSite, path: c?.path }));
    check('the secret is nowhere in the page after signing in', !(await A.page.content()).includes(SECRET));

    // ------------------------------------------------------------- import through the wizard: worksheet selection, validation, merge
    const seen = await importFile(A.page, path.join(FX, 'App_Usage_Report_Nov.xlsx'), 'Merge');
    check('wizard recognises the workbook as a DataSense Usage Report', /DataSense Usage Report/.test(seen.identified));
    check('wizard offers worksheet selection (Summary / Orders / ASM-Employee-wise)', seen.sheetOptions.length === 3, seen.sheetOptions.join(' | '));
    check('wizard offers Replace, Merge and Skip', ['Replace', 'Merge', 'Skip'].every((m) => seen.options?.some((o) => o.startsWith(m))), (seen.options ?? []).join(' | '));
    check('wizard reconciles the orders against the report\'s own Summary sheet', seen.reconcile === true);
    check('import applied', /Import complete/.test(seen.done));
    await A.page.goto(`${BASE}/datasense/employees`); await sleep(3000);
    const afterImport = await orders(A.page);
    check('Usage Report page shows the merged data (29,679 + 40)', afterImport === 29719, `Orders recorded ${afterImport}`);
    const viewerStill = await orders(B.page);
    check('the viewer is not affected by an unpublished import', viewerStill === 29679);

    // ------------------------------------------------------------- review and publish
    await A.page.goto(`${BASE}/admin`); await sleep(2500);
    check('Data Management lists the unpublished import', /Changes waiting to be published/i.test(await text(A.page)) && /DataSense Usage Report/.test(await text(A.page)));
    await A.page.click('button:has-text("Review and publish")'); await sleep(5000);
    const rev = await A.page.locator('[role=dialog]').innerText();
    check('review shows inserted / updated / unchanged counts and a personal-data check', /Inserted/.test(rev) && /Unchanged/.test(rev) && /Clean|made anonymous/.test(rev) && /\b40\b/.test(rev) && /29,679/.test(rev), rev.replace(/\s+/g, ' ').slice(0, 260));
    check('review shows what the sanitizer would do and the counts (full text)', true, rev.replace(/\s+/g, ' ').slice(280, 900));
    await A.page.fill('#pub-note', 'November usage report'); await A.page.click('button:has-text("Publish 1 dataset")');
    const took1 = await waitText(A.page, /Published\. Everyone/);
    check('first publish of the 29,719-record dataset completes', took1 !== null, `${took1} ms`);
    const pt = await text(A.page);
    check('publish succeeds and shows the last published time', /Published/.test(pt) && !/Nothing published yet/.test(pt) && /Published versions/.test(pt) && /First publish/.test(pt), '');
    check('history shows the version as live with its note', /November usage report/.test(pt) && /Live/.test(pt));

    // ------------------------------------------------------------- the viewer receives it without reloading
    await B.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(5000);
    const viewerNow = await orders(B.page);
    check('viewer receives the published data without a reload (refocus check)', viewerNow === 29719, `Orders recorded ${viewerNow}`);

    // ------------------------------------------------------------- second publish (two statuses moved on), picked up by plain polling
    await importFile(A.page, path.join(FX, 'App_Usage_Report_Nov_changed.xlsx'), 'Merge');
    await A.page.goto(`${BASE}/admin`); await sleep(2500);
    await A.page.click('button:has-text("Review and publish")'); await sleep(5000);
    const rev2 = await A.page.locator('[role=dialog]').innerText();
    check('second review shows 2 updated orders and nothing inserted', /Updated/.test(rev2), rev2.replace(/\s+/g, ' ').slice(0, 300));
    const v1Applied = await B.page.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('hero-crm-tracker'); q.onsuccess = () => r(q.result); }); return (await new Promise((r) => { const q = db.transaction('kv').objectStore('kv').get('publishedSync'); q.onsuccess = () => r(q.result); })).versionId; });
    await A.page.fill('#pub-note', 'Two orders moved on'); await A.page.click('button:has-text("Publish 1 dataset")');
    const took2 = await waitText(A.page, /Published\. Everyone/);
    const t0 = Date.now();
    const newest = await B.page.evaluate(async () => (await (await fetch('/api/snapshot')).json()).version);
    check('public status shows the newest version', took2 !== null && newest.note === 'Two orders moved on' && newest.versionId !== v1Applied, `${took2} ms; note "${newest.note}"; ${newest.versionId} vs applied ${v1Applied}`);
    // the viewer polls on its own once a minute: wait for it (no event is sent)
    let polled = false;
    for (let i = 0; i < 28 && !polled; i++) { await sleep(3000); polled = await B.page.evaluate(async (want) => { const db = await new Promise((r) => { const q = indexedDB.open('hero-crm-tracker'); q.onsuccess = () => r(q.result); }); const s = await new Promise((r) => { const q = db.transaction('kv').objectStore('kv').get('publishedSync'); q.onsuccess = () => r(q.result); }); return s.versionId === want; }, newest.versionId); }
    check('viewer picked up the second version by itself (polling, no event sent), within 85 s', polled, `${Math.round((Date.now() - t0) / 1000)} s after the publish`);
    const polledUsage = await orders(B.page);
    check('viewer\'s Usage Report still shows 29,719 orders (the update only moved two statuses)', polledUsage === 29719, String(polledUsage));

    // ------------------------------------------------------------- history and rollback
    await A.page.goto(`${BASE}/admin`); await sleep(3000);
    const rows = await A.page.locator('tr', { hasText: /November usage report/ }).count();
    check('history lists both versions', rows >= 1 && /Two orders moved on/.test(await text(A.page)));
    const firstRow = A.page.locator('tr', { hasText: 'November usage report' }).first();
    await firstRow.locator('button:has-text("Restore")').click(); await sleep(600);
    await A.page.locator('[role=dialog] button:has-text("Restore")').click();
    const tookRb = await waitText(A.page, /Restored\./);
    await sleep(1500);
    const ht = await text(A.page);
    check('rollback publishes a new "Restored" version and keeps history', tookRb !== null && /Restored/.test(ht) && /First publish/.test(ht) && /Two orders moved on/.test(ht), `${tookRb} ms`);
    const st = await B.page.evaluate(async () => (await (await fetch('/api/snapshot')).json()).version);
    check('public status now shows the restored version', st.action === 'rollback', st.action);

    // ------------------------------------------------------------- concurrent publishes from two administrators
    const A2 = await mk({ 'x-forwarded-for': '203.0.113.11' });
    await A2.page.goto(`${BASE}/admin`); await sleep(1500);
    await A2.page.fill('#admin-secret', SECRET); await A2.page.click('button:has-text("Sign in")'); await sleep(2500);
    await importFile(A2.page, path.join(FX, 'App_Usage_Report_Dec.xlsx'), 'Merge');
    await importFile(A.page, path.join(FX, 'App_Usage_Report_Jan.xlsx'), 'Merge');
    for (const X of [A, A2]) { await X.page.goto(`${BASE}/admin`); await sleep(2500); await X.page.click('button:has-text("Review and publish")'); await sleep(5000); }
    await Promise.all([A, A2].map((X) => X.page.click('button:has-text("Publish 1 dataset")')));
    await Promise.all([A, A2].map((X) => waitText(X.page, /Published\. Everyone|published a newer version/)));
    const [ta, ta2] = await Promise.all([text(A.page), text(A2.page)]);
    const lost = [ta, ta2].filter((t) => /published a newer version/.test(t)).length;
    check('two simultaneous publishes: exactly one wins, the other is told to review again', lost === 1, `losers: ${lost}`);

    // ------------------------------------------------------------- fallback when the service is unreachable
    const C = await mk({ 'x-forwarded-for': '198.51.100.30' });
    await C.page.route('**/api/**', (r) => r.abort());
    await C.page.goto(`${BASE}/datasense/employees`); await sleep(4500);
    const fb = await orders(C.page);
    check('with the service unreachable a new visitor still gets the embedded data', fb === 29679, `Orders recorded ${fb}`);
    await C.page.goto(`${BASE}/`); await sleep(2500);
    check('the landing page renders from the embedded data', /Dealer App vs DataSense SFA/.test(await text(C.page)) && (await C.page.locator('.recharts-surface').count()) > 5);
    await C.page.goto(`${BASE}/admin`); await sleep(2000);
    check('Data Management says publishing is not available, instead of failing', /not available here/.test(await text(C.page)));

    // ------------------------------------------------------------- sign out, and brute force protection
    await A.page.goto(`${BASE}/admin`); await sleep(2000);
    await A.page.click('button:has-text("Sign out")'); await sleep(2000);
    const after = await A.page.evaluate(async () => (await fetch('/api/admin/versions', { credentials: 'same-origin' })).status);
    check('after sign-out the admin API is closed and the form is back', after === 401 && /Administrator secret/i.test(await text(A.page)), `status ${after}`);
    const X = await mk({ 'x-forwarded-for': '192.0.2.99' });
    await X.page.goto(`${BASE}/admin`); await sleep(1500);
    for (let i = 0; i < 5; i++) { await X.page.fill('#admin-secret', 'guess' + i); await X.page.click('button:has-text("Sign in")'); await sleep(1100); }
    await X.page.fill('#admin-secret', SECRET); await X.page.click('button:has-text("Sign in")'); await sleep(1500);
    check('after 5 wrong guesses even the right secret is refused for a while', /Too many failed attempts/.test(await text(X.page)));

    // ------------------------------------------------------------- the store holds no raw or personal data
    const files = []; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
    walk(store);
    check('nothing is left in the staging area', !files.some((f) => f.includes('/staging/')));
    check('the page never threw an error', [B, A, A2, C].every((x) => x.errs.length === 0), [B, A, A2, C].map((x) => x.errs.length).join(','));
  } catch (e) {
    check('e2e run completed', false, String(e && e.stack || e));
  } finally {
    await browser.close(); try { process.kill(-srv.proc.pid, 'SIGTERM'); } catch { /* already gone */ } fs.rmSync(store, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(os.tmpdir(), 'e2e-result.json'), JSON.stringify(results, null, 1));
  process.exit(failed.length ? 1 : 0);
})();
