const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
// serves a build directory like a static host with a single-page-app fallback; there is no backend: /api answers 404
const serve = (dir, port) => new Promise((r) => { const s = http.createServer((q, res) => { const u = decodeURIComponent(q.url.split('?')[0]); if (u.startsWith('/api/')) { res.writeHead(404); return res.end(); } let f = path.join(dir, u); if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html'); res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f)); }).listen(port, () => r(s)); });
// REBUILT_STYLE=path tests the multi-file Vercel build (BrowserRouter); the default tests the single file (hash routes)
const STYLE = process.env.REBUILT_STYLE === 'path' ? 'path' : 'hash';
const WAIT = Number(process.env.WAIT_MS ?? 2500); // how long a page is given to settle (charts animate and load lazily)
const PD = Number(process.env.DEPLOYED_PORT ?? 8101), PR = Number(process.env.REBUILT_PORT ?? 8102);
const nav = (url, route, side) => (side === 'rebuilt' && STYLE === 'path' ? url + route.slice(1) : url + '#' + route);
const ROUTES = ['/', '/overview', '/dealer/orders', '/dealer/complaints', '/hero-smiles', '/datasense/orders', '/datasense/complaints', '/datasense/employees', '/bizom/usage', '/compare/bizom-vs-sfa', '/issues', '/import'];
const norm = (t) => t.replace(/\bData Management\b/g, '').replace(/\s+/g, ' ').replace(/\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM|am|pm)?\b/g, '<time>').trim();
async function grab(page, url, route, side) {
  // every page is loaded cold, on both sides: moving between hash routes would keep one page alive (the charts cache text measurements)
  await page.goto('about:blank');
  await page.goto(nav(url, route, side), { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('main, #root')?.innerText.length > 200, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(WAIT);
  return page.evaluate(() => {
    const t = (s) => [...document.querySelectorAll(s)];
    return {
      text: document.body.innerText,
      charts: t('.recharts-surface').length, tables: t('table').length, rows: t('tbody tr').length,
      buttons: t('button').map((b) => b.innerText.trim()).filter(Boolean),
      headings: t('h1,h2,h3').map((h) => h.innerText.trim()),
      links: t('nav a, aside a').map((a) => a.innerText.trim() + '>' + a.getAttribute('href')),
      title: document.title,
    };
  });
}
async function dumpDb(page) {
  return page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('hero-crm-tracker'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open(); const get = (s) => new Promise((res) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); });
    const getK = (s) => new Promise((res) => { const r = db.transaction(s).objectStore(s).getAllKeys(); r.onsuccess = () => res(r.result); });
    const meta = await get('meta'), recs = await get('records'), rk = await getK('records'), kv = await get('kv'), kk = await getK('kv'), hist = await get('history');
    return { meta, recs: rk.map((k, i) => [k, recs[i]]), kv: kk.map((k, i) => [k, kv[i]]), hist };
  });
}
(async () => {
  const sd = await serve(path.join(ROOT, 'deployed'), PD), sr = await serve(path.join(ROOT, 'rebuilt'), PR);
  const browser = await chromium.launch();
  const out = { routes: {}, db: {} };
  const sides = [['deployed', `http://localhost:${PD}/`], ['rebuilt', `http://localhost:${PR}/`]];
  const data = {};
  for (const [name, url] of sides) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    data[name] = { pages: {}, errs };
    for (const r of ROUTES) {
      data[name].pages[r] = await grab(page, url, r, name);
      await page.screenshot({ path: path.join(ROOT, 'shots', `${name}${r === '/' ? '-landing' : r.replace(/\//g, '-')}.png`), fullPage: true });
    }
    data[name].db = await dumpDb(page);
    await ctx.close();
  }
  await browser.close(); sd.close(); sr.close();
  fs.writeFileSync(path.join(ROOT, 'result.json'), JSON.stringify(data));
  // report
  const h = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 12);
  const a = data.deployed, b = data.rebuilt;
  console.log('== IndexedDB (seeded from each build\'s embedded snapshot)');
  console.log('datasets', a.db.meta.length, b.db.meta.length);
  const mk = (d) => Object.fromEntries(d.meta.map((m) => [m.id, h(m.extra?.fileHash ?? m.id)]));
  const recA = Object.fromEntries(a.db.recs.map(([k, v]) => [k, h(v)])), recB = Object.fromEntries(b.db.recs.map(([k, v]) => [k, h(v)]));
  console.log('records identical per dataset:', Object.keys(recA).every((k) => recA[k] === recB[k]) && Object.keys(recA).length === Object.keys(recB).length, Object.keys(recA).length);
  console.log('kv', JSON.stringify(a.db.kv.map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 40) : typeof v])), '\n   ', JSON.stringify(b.db.kv.map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 40) : typeof v])));
  console.log('\n== pages');
  for (const r of ROUTES) {
    const x = a.pages[r], y = b.pages[r];
    const same = norm(x.text) === norm(y.text);
    console.log(`${same ? 'SAME ' : 'DIFF '} ${r.padEnd(26)} charts ${x.charts}/${y.charts} tables ${x.tables}/${y.tables} rows ${x.rows}/${y.rows} buttons ${x.buttons.length}/${y.buttons.length} chars ${x.text.length}/${y.text.length}`);
  }
  console.log('\nconsole/page errors deployed:', a.errs.length, ' rebuilt:', b.errs.length);
  a.errs.slice(0, 3).forEach((e) => console.log('  D', e.slice(0, 160))); b.errs.slice(0, 3).forEach((e) => console.log('  R', e.slice(0, 160)));
})();
