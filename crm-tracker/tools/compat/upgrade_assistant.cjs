const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const R = __dirname;
const serve = (dir, port) => new Promise((r) => { const s = http.createServer((q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(path.join(R, dir, 'index.html'))); }).listen(port, () => r(s)); });
const norm = (t) => t.replace(/\s+/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, '<t>').trim();
const QS = ['How many orders were placed on the Dealer App?', 'Which zone has the most DataSense complaints?', 'What is the SFA adoption rate?', 'Total Bizom usage in October', 'hello'];
(async () => {
  const servers = [await serve('deployed', 8101), await serve('rebuilt', 8102)]; const b = await chromium.launch(); const out = {};
  for (const [name, port] of [['deployed', 8101], ['rebuilt', 8102]]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await ctx.newPage(); const o = { errs: [] }; p.on('pageerror', (e) => o.errs.push(String(e)));
    await p.goto(`http://localhost:${port}/#/`); await p.waitForTimeout(3500);
    // --- upgrade path: pretend this browser was seeded by an OLDER snapshot and the user changed another dataset
    await p.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('hero-crm-tracker'); r.onsuccess = () => res(r.result); });
      const tx = db.transaction(['meta', 'records', 'raw', 'kv'], 'readwrite');
      const metaS = tx.objectStore('meta'); const all = await new Promise((res) => { const r = metaS.getAll(); r.onsuccess = () => res(r.result); });
      for (const m of all) { if (m.source === 'ds_orders') { metaS.put({ ...m, fileName: 'OLD_ORDERS.xls' }); tx.objectStore('records').put({ records: [], issues: [] }, m.id); } if (m.id === 'bizom_usage:2026-10') metaS.put({ ...m, fileName: 'USER_CHANGED.csv' }); }
      tx.objectStore('kv').put('MIS files as supplied, packaged 1 Jan 2026 (older)', 'snapshotVersion');
      await new Promise((res) => (tx.oncomplete = res));
    });
    await p.reload(); await p.waitForTimeout(4500);
    o.upgrade = await p.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('hero-crm-tracker'); r.onsuccess = () => res(r.result); });
      const g = (s, k) => new Promise((res) => { const r = k ? db.transaction(s).objectStore(s).get(k) : db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); });
      const meta = await g('meta'); const ds = meta.find((m) => m.source === 'ds_orders'); const rec = await g('records', ds.id);
      return { dsOrdersFile: ds.fileName, dsOrdersRecords: rec.records.length, bizomOct: meta.find((m) => m.id === 'bizom_usage:2026-10').fileName, version: (await g('kv', 'snapshotVersion')).slice(0, 30), datasets: meta.length };
    });
    // --- assistant
    o.ask = [];
    await p.goto(`http://localhost:${port}/#/overview`); await p.waitForTimeout(2500);
    const open = p.locator('button', { hasText: /ask the data/i }).first(); o.askButton = await open.count();
    if (o.askButton) { await open.click(); await p.waitForTimeout(600);
      for (const q of QS) { const inp = p.locator('input[type=text], input:not([type]), textarea').last(); await inp.fill(q); await inp.press('Enter'); await p.waitForTimeout(1200); }
      o.ask = [norm(await p.evaluate(() => (document.querySelector('[role=dialog]') || document.body).innerText))]; }
    out[name] = o; await ctx.close();
  }
  await b.close(); servers.forEach((s) => s.close());
  console.log('upgrade deployed:', JSON.stringify(out.deployed.upgrade)); console.log('upgrade rebuilt :', JSON.stringify(out.rebuilt.upgrade));
  console.log('upgrade identical:', JSON.stringify(out.deployed.upgrade) === JSON.stringify(out.rebuilt.upgrade));
  console.log('assistant button present:', out.deployed.askButton, out.rebuilt.askButton, ' transcripts identical:', out.deployed.ask[0] === out.rebuilt.ask[0], 'len', (out.rebuilt.ask[0] || '').length);
  console.log('sample:', (out.rebuilt.ask[0] || '').slice(-700)); console.log('errors', out.deployed.errs.length, out.rebuilt.errs.length);
})();
