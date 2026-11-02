// Runs tests/questions.json through the real "Ask the data" panel of a deployed dashboard.
// Usage: node tests/live_test.mjs https://your-project.vercel.app
import { chromium } from 'playwright';
import fs from 'node:fs';
const url = process.argv[2];
if (!url) { console.error('Usage: node tests/live_test.mjs <dashboard url>'); process.exit(1); }
const Q = JSON.parse(fs.readFileSync(new URL('./questions.json', import.meta.url)));
const NO = 'Currently no such data is present in the dashboard';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
await p.goto(url); await p.waitForTimeout(8000);
await p.click('button[aria-label="Open the data assistant"]');
let pass = 0, fail = 0;
for (const t of Q) {
  await p.fill('#assistant-input', t.q); await p.keyboard.press('Enter');
  await p.waitForFunction(() => !document.querySelector('[role=log] [role=status]'), null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(800);
  const log = await p.locator('[role=log]').innerText();
  const ans = log.split(t.q).pop() || '';
  if (/AI service is busy/.test(ans)) { console.log('STOPPED: rate limit reached at:', t.q); break; }
  const ok = t.no_data ? ans.includes(NO) : t.expect.every((e) => ans.toLowerCase().includes(String(e).toLowerCase())) && !ans.includes(NO);
  ok ? pass++ : fail++;
  console.log(ok ? 'PASS' : 'FAIL', '|', t.q, ok ? '' : '\n      got: ' + ans.replace(/\n+/g, ' | ').slice(0, 300));
  await p.waitForTimeout(2500);
}
console.log(`\n${pass} passed, ${fail} failed of ${Q.length}`);
await b.close();
