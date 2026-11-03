// Visual / structural check of every page in both themes against the local server. Run after `npm run build:vercel`.
//   node tools/compat/ui_check.cjs [outDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const PORT = 4176;
const BASE = `http://localhost:${PORT}`;
const OUT = process.argv[2] || path.join(os.tmpdir(), 'crm-shots');
const ROUTES = ['/', '/overview', '/dealer/orders', '/dealer/complaints', '/datasense/orders', '/datasense/complaints', '/datasense/employees', '/bizom/usage', '/compare/bizom-vs-sfa', '/issues', '/hero-smiles', '/import', '/admin'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-ui-'));
  const proc = spawn('npx', ['vite-node', 'scripts/dev-server.ts'], { cwd: ROOT, detached: true, env: { ...process.env, PORT: String(PORT), CRM_STORE_DIR: store, CRM_ADMIN_SECRET: 'correct horse battery staple', CRM_SESSION_SECRET: 's'.repeat(48), CRM_PUBLISH_PEPPER: 'p'.repeat(48) } });
  let log = ''; proc.stdout.on('data', (d) => (log += d)); proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100 && !log.includes('dev server on'); i++) await sleep(300);
  const browser = await chromium.launch();
  try {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await ctx.addInitScript((t) => { try { if (t === 'dark') localStorage.setItem('crm.theme', 'dark'); } catch (e) {} }, theme);
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      for (const r of ROUTES) {
        await page.goto(BASE + r); await sleep(2500);
        const info = await page.evaluate(() => {
          const lum = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c); if (!m) return null; const a = m[4] === undefined ? 1 : +m[4]; return { l: (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255, a }; };
          let bright = 0, total = 0;
          document.querySelectorAll('body *').forEach((el) => {
            const b = el.getBoundingClientRect(); if (b.width < 120 || b.height < 24) return;
            const cs = getComputedStyle(el); const x = lum(cs.backgroundColor); if (!x || x.a < 0.5) return;
            total += b.width * b.height; if (x.l > 0.8) bright += b.width * b.height;
          });
          return { dark: document.documentElement.classList.contains('dark'), bodyBg: getComputedStyle(document.body).backgroundColor, last: document.querySelector('[data-testid=last-updated]')?.textContent ?? null, brightShare: total ? bright / total : 0 };
        });
        fs.writeFileSync(path.join(OUT, `${theme}${r.replace(/\//g, '_') || '_home'}.png`), await page.screenshot({ fullPage: false }));
        check(`${theme} ${r}: renders with Last Updated`, info.dark === (theme === 'dark') && /^Last Updated: .+/.test(info.last ?? ''), `${info.last}`);
        if (theme === 'dark') check(`dark ${r}: no large bright panels`, info.brightShare < 0.02, `bright share ${(info.brightShare * 100).toFixed(1)}%`);
      }
      check(`${theme}: no page errors`, errs.length === 0, errs.join(' | ').slice(0, 200));
      await ctx.close();
    }
  } finally {
    await browser.close();
    try { process.kill(-proc.pid); } catch (e) {}
  }
  const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} checks passed`); process.exit(ok === results.length ? 0 : 1);
})();
