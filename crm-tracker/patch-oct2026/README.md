# Patch layer, 29 Oct 2026 (Dealer App vs DataSense landing page + Usage Report)

These files produced `CRM_Tracker_Dashboard.html` of 29 Oct 2026 **without a Vite rebuild** (no network was available to
install the build tools). They are NOT yet integrated into `src/`.

| File | Purpose |
|---|---|
| `src/model.ts` | Calculation layer: same-date windows, valid/rejected rules, per-dealer, model/SKU, MBD, channel-pattern classes, Key Takeaways |
| `src/landing.tsx` | The landing page (route `/`): core comparison, visual takeaways, popups |
| `src/usage.tsx` | The Usage Report page (route `/datasense/employees`, renamed) |
| `src/lp.css` | Styles for both pages |
| `build.py` | Assembles the HTML: swaps the embedded DataSense datasets, patches first-open seeding (version key `snapshotVersion`), injects the compiled module, route and menu label |
| `tools/dump_datasense_payloads.mjs` | Drives the app's own Data Import wizard (Playwright) and dumps the normalised DataSense order/complaint records |
| `tools/package_usage_report.py` | Packs the App Usage Report for the Usage page |

## To integrate into the project (needs `npm install`, network)
1. Move `model.ts` to `src/lib/metrics/landing.ts`, `landing.tsx`/`usage.tsx` to `src/pages/`, replacing the `__B()` bridge with real imports
   (`useData`, `ChartCard`, `Bars`, `ColumnChart`, `DataTable`, `PageHeader`, `DataGate`, `useDealerProfile` ...).
2. Point the `index` route at `LandingPage`, `datasense/employees` at `UsagePage`; rename the nav label to "Usage Report" in `components/nav.ts`.
3. Add a `ds_usage` source (reader, normaliser, types) so the Usage Report can be imported through the wizard; today it is embedded only.
4. Put the three source files in `data/CRM MIS/` and run `npm run build:html`.
| `src/compare.tsx` | Bizom SFA vs DataSense SFA Usage page (route `/compare/bizom-vs-sfa`) |
| `src/ask.ts` | "Ask the data" tool calling: 10 tools run on the browser data, 3-call limit, number check, explicit "no data" answer, offline fallback |
| `vercel/` | Deployable Vercel project (function, tool schemas, tests, README_DEPLOY.md) for the Groq-backed assistant |
