const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const R = __dirname; const VERBOSE = process.argv[2] === 'v';
const serve = (dir, port) => new Promise((r) => { const s = http.createServer((q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(path.join(R, dir, 'index.html'))); }).listen(port, () => r(s)); });
const norm = (t) => t.replace(/\s+/g, ' ').replace(/\b\d{1,2} \w{3} 20\d\d,? \d{1,2}:\d{2}\b/g, '<ts>').replace(/\b\d{1,2}:\d{2}\b/g, '<t>').trim();
const mainText = (p) => p.evaluate(() => document.querySelector('main').innerText);
const btns = (p) => p.evaluate(() => [...document.querySelectorAll('main button')].map((x) => x.innerText.trim()).filter(Boolean));
const dbState = (p) => p.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open('hero-crm-tracker'); r.onsuccess = () => res(r.result); }); const g = (s) => new Promise((res) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); }); const k = (s) => new Promise((res) => { const r = db.transaction(s).objectStore(s).getAllKeys(); r.onsuccess = () => res(r.result); }); const meta = await g('meta'), recs = await g('records'), rk = await k('records'), hist = await g('history'); return { datasets: meta.length, nov: meta.filter((m) => m.id.includes('2026-11')).map((m) => ({ id: m.id, mode: m.mode, raw: m.rawCount, valid: m.validCount, dup: m.duplicateCount, inv: m.invalidCount })), novRecords: rk.map((x, i) => [x, recs[i].records.length]).filter(([x]) => String(x).includes('2026-11')), history: hist.slice(-3).map((h) => h.action + ':' + h.ok + ':' + h.summary.replace(/\d{1,2}:\d{2}/g, '')) }; });
async function wizard(p, file, pickMode, log) {
  await p.goto(p.url().split('#')[0] + '#/overview'); await p.waitForTimeout(700); await p.goto(p.url().split('#')[0] + '#/import'); await p.waitForTimeout(900);
  await p.setInputFiles('input[type=file]', path.join(R, file)); await p.waitForTimeout(2500);
  for (let step = 0; step < 12; step++) {
    const b = await btns(p); const t = norm(await mainText(p)); log.push({ step, buttons: b.filter((x) => /^(Next|Back|Import|Confirm|Start over|Replace|Merge|Skip|Add)/i.test(x)), text: t.slice(0, 1800) });
    if (pickMode && b.some((x) => new RegExp('^' + pickMode, 'i').test(x))) { await p.locator('main button', { hasText: new RegExp('^' + pickMode, 'i') }).first().click().catch(() => {}); await p.waitForTimeout(500); pickMode = null; }
    const conf = p.locator('main input[type=checkbox]:not(:checked)'); // "I have checked this" confirmations
    for (let i = 0, n = await conf.count(); i < n; i++) { const c = conf.nth(i); if ((await c.evaluate((e) => e.closest('label')?.innerText ?? '')).match(/checked this/i)) await c.check().catch(() => {}); }
    const next = p.locator('main button', { hasText: /^(Next|Apply import)/i }).first();
    if (!(await next.count()) || (await next.isDisabled())) break;
    const label = (await next.innerText()).trim(); await next.click(); await p.waitForTimeout(2500);
    if (/^apply import/i.test(label)) { log.push({ done: label, text: norm(await mainText(p)).slice(0, 900) }); break; }
  }
}
(async () => {
  const out = {}; const servers = [await serve('deployed', 8101), await serve('rebuilt', 8102)]; const b = await chromium.launch();
  for (const [name, port] of [['deployed', 8101], ['rebuilt', 8102]]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 2600 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`http://localhost:${port}/#/import`); await p.waitForTimeout(3000);
    const o = { A: [], B: [], C: [], db: {}, errs };
    await wizard(p, 'fx/MISUsagereport-Bizom-Nov.csv', null, o.A); o.db.afterA = await dbState(p);
    await wizard(p, 'fx/MISUsagereport-Bizom-Nov.csv', null, o.B); o.db.afterB = await dbState(p);
    await wizard(p, 'fx2/MISUsagereport-Bizom-Nov.csv', 'Merge', o.C); o.db.afterC = await dbState(p);
    await p.goto(`http://localhost:${port}/#/bizom/usage`); await p.waitForTimeout(2500); o.usageAfter = norm(await p.evaluate(() => document.body.innerText)).slice(0, 1500);
    await p.reload(); await p.waitForTimeout(2500); o.persisted = (await dbState(p)).datasets; // survives reload
    out[name] = o; await ctx.close();
  }
  await b.close(); servers.forEach((s) => s.close());
  fs.writeFileSync(path.join(R, 'import_result.json'), JSON.stringify(out));
  for (const sc of ['A', 'B', 'C']) {
    const a = out.deployed[sc], r = out.rebuilt[sc];
    const same = JSON.stringify(a) === JSON.stringify(r);
    console.log(`scenario ${sc}: steps ${a.length}/${r.length} wizard text+buttons identical: ${same}`);
    if (VERBOSE || !same) a.forEach((s, i) => { if (JSON.stringify(s) !== JSON.stringify(r[i])) console.log('  first diff at step', i, '\n   D:', JSON.stringify(s).slice(0, 400), '\n   R:', JSON.stringify(r[i] ?? null).slice(0, 400)); });
  }
  for (const k of ['afterA', 'afterB', 'afterC']) console.log(k, 'db identical:', JSON.stringify(out.deployed.db[k]) === JSON.stringify(out.rebuilt.db[k]), JSON.stringify(out.rebuilt.db[k].nov), JSON.stringify(out.rebuilt.db[k].novRecords));
  console.log('bizom usage page after import identical:', out.deployed.usageAfter === out.rebuilt.usageAfter, ' persisted datasets after reload:', out.deployed.persisted, out.rebuilt.persisted);
  console.log('scenario A steps:', out.rebuilt.A.map((s) => s.done ?? s.buttons.join('/')).join(' || ').slice(0, 500)); console.log('B last:', JSON.stringify(out.rebuilt.B.slice(-1)[0]).slice(0, 500)); console.log('page errors', out.deployed.errs.length, out.rebuilt.errs.length);
})();
