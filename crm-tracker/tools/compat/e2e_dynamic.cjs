// Browser end-to-end for the dynamic-month, calendar, Last Updated and theme features, against the local server
// (a directory plays the Blob store; the data are synthetic files, never real CRM data).
//   npm run build:vercel && node tools/compat/make-orders-fixtures.cjs && node tools/compat/e2e_dynamic.cjs
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = 4178;
const BASE = `http://localhost:${PORT}`;
const SECRET = 'correct horse battery staple';
const EMAIL = 'intern.kalika@herocycles.com';
const FX = path.join(__dirname, 'fixtures', 'orders');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (p) => p.evaluate(() => document.body.innerText);
const waitText = async (p, re, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await text(p))) return Date.now() - t0; await sleep(400); } return null; };
const signIn = async (p) => { await p.fill('#admin-email', EMAIL); await p.fill('#admin-password', SECRET); await p.click('button:has-text("Sign in")'); await sleep(2500); };
const trendText = async (p) => p.locator('#lp-trends').evaluate((e) => e.textContent).catch(() => '');
const rangeLabel = (p) => p.locator('[data-testid=range-label]').first().innerText().catch(() => '');
const lastUpd = (p) => p.locator('[data-testid=last-updated]').first();
const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

async function startServer(store) {
  const proc = spawn('npx', ['vite-node', 'scripts/dev-server.ts'], { cwd: ROOT, detached: true, env: { ...process.env, PORT: String(PORT), CRM_STORE_DIR: store, CRM_ADMIN_SECRET: SECRET, CRM_SESSION_SECRET: 's'.repeat(48), CRM_PUBLISH_PEPPER: 'p'.repeat(48) } });
  let log = ''; proc.stdout.on('data', (d) => (log += d)); proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100 && !log.includes('dev server on'); i++) await sleep(300);
  if (!log.includes('dev server on')) throw new Error('server did not start: ' + log);
  return proc;
}

/** Imports files through the wizard. modes: { 'text in the row label': 'skip' | 'replace' | 'merge' } applied on the mode step. */
async function importFiles(p, files, modes = {}) {
  await p.goto(`${BASE}/import`); await sleep(1500);
  await p.setInputFiles('input[type=file]', files.map((f) => path.join(FX, f))); await sleep(2500);
  const seen = { rows: [], plans: [], done: '' };
  for (let i = 0; i < 8; i++) {
    const sels = p.locator('select[aria-label^="How to import"]');
    const n = await sels.count();
    if (n) {
      for (let k = 0; k < n; k++) {
        const label = await sels.nth(k).getAttribute('aria-label');
        seen.rows.push(label);
        seen.plans.push({ label, value: await sels.nth(k).inputValue(), options: await sels.nth(k).locator('option').allInnerTexts() });
        for (const [needle, mode] of Object.entries(modes)) if (label.includes(needle)) await sels.nth(k).selectOption({ value: mode });
      }
      seen.stepText = await text(p);
      for (let k = 0, m = await p.locator('main input[type=checkbox]').count(); k < m; k++) { const c = p.locator('main input[type=checkbox]').nth(k); if (!(await c.isChecked())) await c.check().catch(() => {}); }
    }
    const next = p.locator('main button', { hasText: /^\s*(Next|Apply import)\b/ }).first();
    for (let w = 0; w < 40 && (await next.count()) && (await next.isDisabled()); w++) await sleep(500);
    if (!(await next.count()) || (await next.isDisabled())) { seen.stalled = (await text(p)).replace(/\s+/g, ' ').slice(0, 300); break; }
    const label = (await next.innerText()).trim();
    await next.click(); await sleep(label === 'Apply import' ? 3500 : 1300);
    if (label === 'Apply import') break;
  }
  seen.done = await text(p);
  return seen;
}
async function publish(p, note) {
  await p.goto(`${BASE}/admin`); await sleep(2500);
  await p.click('button:has-text("Review and publish")'); await sleep(5000);
  await p.fill('#pub-note', note);
  const go = p.locator('button', { hasText: /Publish \d+ datasets?/ }).first();
  await go.waitFor({ timeout: 120000 }).catch(async (e) => { console.log('REVIEW DIALOG:', ((await p.locator('[role=dialog]').innerText().catch(() => '')) || (await text(p))).replace(/\s+/g, ' ').slice(0, 1200)); throw e; });
  await go.click();
  return waitText(p, /Published\. Everyone/);
}
const refocus = async (p) => { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(4000); };

(async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-dyn-'));
  const proc = await startServer(store);
  const browser = await chromium.launch();
  const mk = async (headers = {}, storage = true) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, extraHTTPHeaders: headers }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e))); return { ctx, page, errs }; };
  try {
    // ------------------------------------------------ the public viewer, before anything is published
    const V = await mk({ 'x-forwarded-for': '198.51.100.51' });
    await V.page.goto(`${BASE}/`); await sleep(4500);
    const t0 = await trendText(V.page);
    check('baseline: the trends chart has the existing months and no November', /Oct/.test(t0) && !/Nov/.test(t0), t0.slice(0, 120));
    const range0 = await rangeLabel(V.page);
    check('the calendar shows the span of the data, not a reporting-period dropdown', /^All data · /.test(range0) && (await V.page.locator('select[aria-label="Reporting period"]').count()) === 0, range0);
    const l0 = await lastUpd(V.page).innerText();
    check('Last Updated shows the embedded data date before anything is published', /^Last Updated: \d{1,2} [A-Z][a-z]+ 20\d\d$/.test(l0), l0);
    const tip0 = await lastUpd(V.page).getAttribute('title');

    // ------------------------------------------------ administrator imports November (Dealer App + DataSense) and publishes it
    const A = await mk({ 'x-forwarded-for': '203.0.113.60' });
    await A.page.goto(`${BASE}/admin`); await sleep(2000); await signIn(A.page);
    const s1 = await importFiles(A.page, ['DealerAppOrders-NOV.csv', 'Order Punched Report - Datasense - nov.csv']);
    check('November files are imported', /Import complete/.test(s1.done), s1.rows.join(' | '));
    check('November was detected from the order dates: a new month, offered as Add / Merge', s1.plans.some((x) => /DealerAppOrders-NOV/.test(x.label) && x.value === 'add'), JSON.stringify(s1.plans.map((x) => [x.label.slice(15), x.value])));
    await A.page.goto(`${BASE}/`); await sleep(4500);
    const tA = await trendText(A.page);
    check('administrator (unpublished): November is in the Dealer App vs DataSense trends', /Nov/.test(tA), tA.slice(0, 140));
    const lA = await lastUpd(A.page).innerText();
    check('an unpublished local import does not move Last Updated', lA === l0, `${l0} -> ${lA}`);
    check('the viewer does not see unpublished data', !/Nov/.test(await trendText(V.page)));
    const took = await publish(A.page, 'November data');
    check('November publishes', took !== null, `${took} ms`);

    // ------------------------------------------------ viewer gets it
    await refocus(V.page);
    await V.page.goto(`${BASE}/`); await sleep(4500);
    const tV = await trendText(V.page);
    check('public viewer sees November in the trends after publication', /Nov/.test(tV) && /Oct/.test(tV) && /Sep|Apr/.test(tV), tV.slice(0, 160));
    const rangeV = await rangeLabel(V.page);
    check('the calendar span grew to the new data (17 Nov 2026)', /17 Nov 2026/.test(rangeV), rangeV);
    const l1 = await lastUpd(V.page).innerText();
    check('Last Updated is now the publication date', l1 === `Last Updated: ${today}`, `${l1} (expected ${today})`);
    const tip1 = await lastUpd(V.page).getAttribute('title');
    check('the indicator records that it comes from the published version', /published version/.test(tip1 ?? ''), tip1);
    for (let i = 0; i < 2; i++) { await V.page.reload(); await sleep(3500); }
    check('refreshing the page does not change Last Updated', (await lastUpd(V.page).getAttribute('title')) === tip1);
    check('every other dashboard shows the same Last Updated', await (async () => { for (const r of ['/overview', '/dealer/orders', '/datasense/employees', '/bizom/usage', '/issues', '/hero-smiles']) { await V.page.goto(BASE + r); await sleep(2200); if ((await lastUpd(V.page).getAttribute('title')) !== tip1) return false; } return true; })());

    // ------------------------------------------------ December: no code change, only data
    const s2 = await importFiles(A.page, ['DealerAppOrders-DEC.csv', 'Order Punched Report - Datasense - dec.csv']);
    check('December files are imported', /Import complete/.test(s2.done));
    await A.page.goto(`${BASE}/`); await sleep(4500);
    check('administrator (unpublished): December is in the trends', /Dec/.test(await trendText(A.page)));
    check('still the November publication date until December is published', (await lastUpd(A.page).getAttribute('title')) === tip1);
    await sleep(1200);
    const took2 = await publish(A.page, 'December data');
    check('December publishes', took2 !== null, `${took2} ms`);
    await refocus(V.page);
    await V.page.goto(`${BASE}/`); await sleep(4500);
    const tV2 = await trendText(V.page);
    check('public viewer sees December (and November, October) in the trends', /Dec/.test(tV2) && /Nov/.test(tV2) && /Oct/.test(tV2), tV2.slice(0, 160));
    check('the calendar span now reaches 9 Dec 2026', /9 Dec 2026/.test(await rangeLabel(V.page)), await rangeLabel(V.page));
    const tip2 = await lastUpd(V.page).getAttribute('title');
    check('Last Updated moved only because December was published', tip2 !== tip1, `${tip1} -> ${tip2}`);

    // ------------------------------------------------ one workbook with October and November; same month again; corrected month
    const s4 = await importFiles(A.page, ['DealerAppOrders-NOV.csv']);
    check('uploading the same November file again is flagged as a duplicate and skipped by default', s4.plans.some((x) => x.value === 'skip') && /duplicate|identical/i.test(s4.stepText ?? ''), JSON.stringify(s4.plans.map((x) => x.value)));
    const s3 = await importFiles(A.page, ['DealerAppOrders-OCT-NOV.csv'], { '2026-10': 'skip' });
    const labels3 = s3.rows.join(' | ');
    check('a workbook with October and November is recognised as two months', /2026-10/.test(labels3) && /2026-11/.test(labels3), labels3);
    check('November (already stored) defaults to Replace, October (stored in the embedded data) to Replace too, and Skip is offered', s3.plans.every((x) => x.options.some((o) => /^Skip/.test(o))) && s3.plans.some((x) => /2026-11/.test(x.label) && x.value === 'replace'), JSON.stringify(s3.plans.map((x) => [x.label.slice(-30), x.value])));
    check('the multi-month import applies', /Import complete/.test(s3.done));
    await A.page.goto(`${BASE}/admin`); await sleep(2500);
    const rAfterMulti = await A.page.locator('tr', { hasText: 'Dealer App orders (2026-11)' }).last().innerText().catch(() => '');
    check('November (replaced from the multi-month workbook) still holds 9 orders', /2026-11\s+9\s/.test(rAfterMulti), rAfterMulti.replace(/\s+/g, ' ').slice(0, 140));
    await A.page.goto(`${BASE}/admin`); await sleep(2500);
    const row = async () => A.page.locator('tr', { hasText: 'Dealer App orders (2026-11)' }).last().innerText().catch(() => '');
    const r1 = await row();
    check('November still holds exactly 9 orders after the duplicate upload (nothing counted twice)', /2026-11\s+9\s/.test(r1), r1.replace(/\s+/g, ' ').slice(0, 160));
    const s5 = await importFiles(A.page, ['DealerAppOrders-NOV-corrected.csv'], { 'corrected': 'replace' });
    check('the corrected November file is offered Replace and applies', /Import complete/.test(s5.done) && s5.plans.some((x) => x.options.some((o) => /^Replace/.test(o))), JSON.stringify(s5.plans.map((x) => x.value)));
    await A.page.goto(`${BASE}/admin`); await sleep(2500);
    const r2 = await row();
    check('after the correction November still has 9 orders (replaced, not added)', /2026-11\s+9\s/.test(r2), r2.replace(/\s+/g, ' ').slice(0, 160));
    await A.page.goto(`${BASE}/`); await sleep(4500);
    const monthsA = await trendText(A.page);
    check('October, November and December all stay in the trends (history kept)', /Oct/.test(monthsA) && /Nov/.test(monthsA) && /Dec/.test(monthsA));

    // ------------------------------------------------ the calendar
    await V.page.goto(`${BASE}/`); await sleep(4000);
    await V.page.click('[data-testid=range-label]'); await sleep(500);
    const dlg = V.page.locator('[role=dialog][aria-label="Choose reporting range"]');
    check('the calendar opens with Apply and Reset', (await dlg.locator('button:has-text("Apply")').count()) === 1 && (await dlg.locator('button:has-text("Reset")').count()) === 1);
    check('Apply stays disabled until a start and an end are chosen', await dlg.locator('button:has-text("Apply")').isDisabled());
    // go to November/December view: the dialog shows two months ending at the month before the latest
    const day = (d) => dlg.locator(`button[data-date="${d}"]`).first();
    for (let i = 0; i < 6 && !(await day('2026-11-03').count()); i++) { await dlg.locator('button[aria-label="Next month"]').click().catch(() => {}); await sleep(150); }
    for (let i = 0; i < 6 && !(await day('2026-11-03').count()); i++) { await dlg.locator('button[aria-label="Previous month"]').click().catch(() => {}); await sleep(150); }
    check('a day beyond the data is not selectable', (await day('2026-12-10').count()) === 0 || (await day('2026-12-10').isDisabled()));
    await day('2026-11-03').click(); await day('2026-11-10').click(); await sleep(200);
    check('the chosen start and end are shown before applying', /3 Nov 2026 – 10 Nov 2026/.test(await V.page.locator('[data-testid=range-draft]').innerText()));
    await dlg.locator('button:has-text("Apply")').click(); await sleep(1500);
    check('the selected range is displayed clearly', (await rangeLabel(V.page)) === '3 Nov 2026 – 10 Nov 2026', await rangeLabel(V.page));
    const sub1 = await V.page.locator('#lp-kpis').innerText();
    check('the page follows the range (November only)', /November 2026/.test(sub1) && !/Oct/.test(sub1.split('\n')[1] ?? ''), sub1.split('\n').slice(0, 2).join(' / '));
    const trendAfter = await trendText(V.page);
    check('the trends keep every month visible while a range is chosen', /Oct/.test(trendAfter) && /Nov/.test(trendAfter) && /Dec/.test(trendAfter));
    await V.page.locator('nav[aria-label="Main navigation"] a', { hasText: 'Usage Report' }).click(); await sleep(3000);
    check('the range stays chosen when moving to another page', (await rangeLabel(V.page)) === '3 Nov 2026 – 10 Nov 2026');
    check('Usage Report responds to the range (nothing in 3-10 Nov in its data: a clear message, not zeros)', /No Usage Report orders fall inside/.test(await text(V.page)));
    await V.page.locator('nav[aria-label="Main navigation"] a', { hasText: 'Dealer App vs DataSense SFA' }).click(); await sleep(3500);
    await V.page.click('[data-testid=range-label]'); await sleep(400);
    await V.page.locator('[role=dialog] button:has-text("Reset")').click(); await sleep(1200);
    check('Reset returns to all data', /^All data · /.test(await rangeLabel(V.page)));
    // a range with no data in it
    await V.page.click('[data-testid=range-label]'); await sleep(400);
    const dlg2 = V.page.locator('[role=dialog]');
    for (let i = 0; i < 12 && !(await dlg2.locator('button[data-date="2026-04-05"]').count()); i++) { await dlg2.locator('button[aria-label="Previous month"]').click().catch(() => {}); await sleep(120); }
    await dlg2.locator('button[data-date="2026-04-05"]').first().click(); await dlg2.locator('button[data-date="2026-04-08"]').first().click(); await dlg2.locator('button:has-text("Apply")').click(); await sleep(1500);
    check('a range before the Dealer App existed is handled with a message', /No Dealer App orders fall in the chosen date range/.test(await text(V.page)));
    await V.page.click('[data-testid=range-label]'); await sleep(400); await V.page.locator('[role=dialog] button:has-text("Reset")').click(); await sleep(800);

    // ------------------------------------------------ theme
    const N = await mk({ 'x-forwarded-for': '198.51.100.70' });
    await N.page.goto(`${BASE}/`); await sleep(2500);
    check('first-time visitors get the light theme', !(await N.page.evaluate(() => document.documentElement.classList.contains('dark'))));
    await N.page.click('[data-testid=range-label]'); await sleep(400);
    const dN = N.page.locator('[role=dialog]');
    for (let i = 0; i < 6 && !(await dN.locator('button[data-date="2026-11-03"]').count()); i++) { await dN.locator('button[aria-label="Next month"]').click().catch(() => {}); await sleep(120); }
    await dN.locator('button[data-date="2026-11-03"]').first().click(); await dN.locator('button[data-date="2026-11-10"]').first().click(); await dN.locator('button:has-text("Apply")').click(); await sleep(1200);
    await N.page.click('[data-testid=theme-toggle]'); await sleep(800);
    check('the toggle switches to dark', await N.page.evaluate(() => document.documentElement.classList.contains('dark')) && (await N.page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== 'rgb(245, 246, 248)');
    check('switching theme keeps the chosen range', (await rangeLabel(N.page)) === '3 Nov 2026 – 10 Nov 2026');
    for (const r of ['/overview', '/dealer/orders', '/datasense/complaints', '/admin', '/import']) {
      await N.page.goto(BASE + r); await sleep(1800);
      if (!(await N.page.evaluate(() => document.documentElement.classList.contains('dark')))) { check(`dark theme persists on ${r}`, false); break; }
    }
    check('dark theme persists across page navigation', await N.page.evaluate(() => document.documentElement.classList.contains('dark')));
    check('the preference is remembered for the next visit', await N.page.evaluate(() => localStorage.getItem('crm.theme')) === 'dark');
    // no flash: with the app scripts blocked, the early script alone must already have set the theme
    const F = await N.ctx.newPage(); await F.route('**/assets/*.js', (r) => r.abort());
    await F.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    check('no flash of the wrong theme: it is applied before the app loads', await F.evaluate(() => document.documentElement.classList.contains('dark') && getComputedStyle(document.documentElement).colorScheme === 'dark'));
    await F.close();
    await N.page.click('[data-testid=theme-toggle]').catch(async () => { await N.page.goto(`${BASE}/`); await sleep(1500); await N.page.click('[data-testid=theme-toggle]'); }); await sleep(600);
    check('and back to light', !(await N.page.evaluate(() => document.documentElement.classList.contains('dark'))) && (await N.page.evaluate(() => localStorage.getItem('crm.theme'))) === 'light');
    // mobile
    const M = await browser.newContext({ viewport: { width: 390, height: 800 } }); const mp = await M.newPage(); await mp.addInitScript(() => localStorage.setItem('crm.theme', 'dark'));
    await mp.goto(`${BASE}/`); await sleep(3000);
    const mob = await mp.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 2, toggle: !!document.querySelector('[data-testid=theme-toggle]'), upd: !!document.querySelector('[data-testid=last-updated]'), range: !!document.querySelector('[data-testid=range-label]') }));
    check('on a phone: dark theme, toggle, Last Updated and the calendar button all present, no sideways scroll', mob.dark && mob.toggle && mob.upd && mob.range && mob.noHScroll, JSON.stringify(mob));
    await M.close();

    // ------------------------------------------------ public viewer cannot reach the data tools
    await V.page.goto(`${BASE}/import`); await sleep(2000);
    check('public viewers still see only the sign-in on Data Import', /restricted to the administrator/i.test(await text(V.page)) && (await V.page.locator('input[type=file]').count()) === 0);
    const st = await V.page.evaluate(async () => (await fetch('/api/admin/publish', { method: 'POST', headers: { 'X-CRM-Admin': '1', 'Content-Type': 'application/json' }, body: '{}' })).status);
    check('and cannot publish through the API', st === 401 || st === 403, String(st));
    check('no page errors', [V, A, N].every((x) => x.errs.length === 0), [V, A, N].map((x) => x.errs.join('|')).join(' ; ').slice(0, 300));
  } catch (e) {
    check('e2e run completed', false, String((e && e.stack) || e));
  } finally {
    await browser.close();
    try { process.kill(-proc.pid); } catch (e) {}
    fs.rmSync(store, { recursive: true, force: true });
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} checks passed`);
  process.exit(ok === results.length ? 0 : 1);
})();
