const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
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
const SKIP = /^(remove|delete|clear|reset all|replace|merge|import|load|choose|browse|upload|download|ask the data|show all data)\b/i;
const norm = (t) => t.replace(/\bData Management\b/g, '').replace(/\s+/g, ' ').replace(/\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM|am|pm)?\b/g, '<time>').trim();
async function run(browser, name, url) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 3600 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const res = {};
  for (const r of ROUTES) {
    await page.goto('about:blank'); // cold load on both sides (see compare.cjs)
    await page.goto(nav(url, r, name), { waitUntil: 'load' }); await page.waitForTimeout(WAIT);
    await page.screenshot({ path: path.join(ROOT, 'shots', `full-${name}${r === '/' ? '-landing' : r.replace(/\//g, '-')}.png`), fullPage: true });
    const n = await page.evaluate(() => [...document.querySelectorAll('main button, [role=main] button')].length || document.querySelectorAll('button').length);
    const steps = [];
    for (let i = 0; i < Math.min(n, 60); i++) {
      const info = await page.evaluate((i) => { const root = document.querySelector('main') || document; const b = [...root.querySelectorAll('button')][i]; return b ? { t: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40), dis: b.disabled } : null; }, i);
      if (!info || info.dis || SKIP.test(info.t)) { steps.push([i, info?.t ?? null, 'skipped']); continue; }
      try {
        await page.evaluate((i) => { const root = document.querySelector('main') || document; [...root.querySelectorAll('button')][i].click(); }, i);
        await page.waitForTimeout(350);
        const txt = await page.evaluate(() => document.body.innerText);
        steps.push([i, info.t, norm(txt)]);
        await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      } catch (e) { steps.push([i, info.t, 'ERR ' + String(e).slice(0, 80)]); }
    }
    res[r] = steps;
  }
  await ctx.close();
  return { res, errs };
}
(async () => {
  const sd = await serve(path.join(ROOT, 'deployed'), PD), sr = await serve(path.join(ROOT, 'rebuilt'), PR);
  const browser = await chromium.launch();
  const a = await run(browser, 'deployed', `http://localhost:${PD}/`), b = await run(browser, 'rebuilt', `http://localhost:${PR}/`);
  await browser.close(); sd.close(); sr.close();
  let tot = 0, same = 0, skipped = 0; const diffs = [];
  for (const r of ROUTES) {
    let rs = 0, rt = 0;
    a.res[r].forEach((s, i) => { const t = b.res[r][i]; if (s[2] === 'skipped') { skipped++; return; } tot++; rt++; if (s[2] === t[2] && s[1] === t[1]) { same++; rs++; } else diffs.push([r, i, s[1], t[1]]); });
    console.log(`${r.padEnd(26)} clicks compared ${rt}, identical ${rs}`);
  }
  console.log(`\nTOTAL interactions ${tot}, identical ${same}, different ${tot - same}, skipped(destructive/file) ${skipped}`);
  diffs.slice(0, 10).forEach((d) => console.log('DIFF', JSON.stringify(d)));
  console.log('page errors deployed/rebuilt:', a.errs.length, b.errs.length);
})();
