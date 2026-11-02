# CRM Tracker

*Bizom SFA | Dealer App | DataSense SFA* – an analytics web app for Hero Cycles that turns the monthly CRM MIS
exports into dashboards and comparisons, with Excel/CSV downloads of the tables.

* **Browser-only.** React + TypeScript + Vite. All parsing and calculation happens in your browser; the files are never
  uploaded. No backend, no database server, no paid API.
* **Two ways to ship it.**
  * **`CRM_Tracker_Dashboard.html`** – one self-contained HTML file with the supplied MIS data already inside it.
    Double-click it and the dashboard opens; no server, no install, no internet. This is the file to hand to colleagues.
  * **The Netlify build (`dist/`)** – the same app with **no data inside**. You import the MIS files (ZIP, folder or
    individual files) and the result is saved in the browser's IndexedDB.
* **Real data only.** Nothing is mocked or estimated. If a file cannot support a figure, the page says *Unavailable*
  and why.

## The single-file HTML dashboard

```bash
npm run build:html   # snapshot of data/CRM MIS → single-file build → CRM_Tracker_Dashboard.html
```

(`npm run snapshot` and `npm run build:single` are the two halves if you want them separately.)

* **Opening it.** Double-click `CRM_Tracker_Dashboard.html`. Chrome or Edge are recommended. On first open the page
  copies its embedded data into the browser's storage; later opens are instant and everything you import afterwards is
  kept too. The routes use `#/…` addresses so they work from a `file://` location.
* **What is inside.** For each of the 17 datasets: the normalised records, the dataset metadata (file name, hash,
  period, row counts) and the data-quality findings, compressed. The raw source rows are **not** embedded and Hero Smiles
  mobile numbers stay masked. The file still contains dealer names, complaint text and order values, so **treat it like
  the MIS files themselves** and share it only with people who may see them.
* **Refreshing it.** Open *Data Import* and import the new month's files exactly as before. Files that are
  already inside the page are recognised by their hash and offered as *skip*. A refreshed state lives in that browser;
  to ship the refreshed numbers to someone else, rebuild the HTML (`npm run build:html` after putting the new files in
  `data/CRM MIS/`).
* **No “load embedded data” or “reset” buttons.** Data Import has no section for the embedded data any more: the copy
  into the browser happens once, on the very first open, and nothing in the page re-loads or wipes it afterwards. A single
  dataset can still be removed from the list of imported datasets (and imported again from its file). To start again from
  the shipped data, clear this page's site data in the browser.
* **If the browser blocks storage** (some locked-down or private windows do with `file://`), the page shows the embedded
  data read-only and says so in a banner at the top; imports cannot be saved in that case.
* **The Netlify build is unaffected.** `npm run build` swaps the data module for an empty stub, so `dist/` never contains
  business data. `src/generated/snapshot.data.ts` and the HTML file are git-ignored for the same reason.

Documents in this repository

| File | What it is |
|---|---|
| `docs/KPI_GLOSSARY.md` | Exact formula, exclusions and page for every KPI |
| `docs/SOURCE_MAPPING.md` | Each source file → canonical fields → dashboards, with the files detected in the supplied package |
| `docs/DELIVERY_REPORT.md` | Files detected, mapping, missing columns, unresolved dealer matches, static-deployment limits, Netlify steps |

## Pages (Classic Hero theme)

| Page | What it shows |
|---|---|
| **Dealer App vs DataSense SFA** (opens first; the one comparison page) | answers *is the Dealer App adding business, or only moving it from DataSense?* Cards, charts and tables only: five headline cards and one card per measure (Dealer App next to DataSense), an order-value bridge with signal cards, monthly trends (more charts behind one button), weekly Dealer App adoption, a class per dealer (incremental, channel shift, declining, stable, new) with charts and a dealer table, the grouped dealer-by-dealer comparison table (Dealer App dealers, ordering in both, only via the Dealer App, DataSense only), Profitability (**not verified**: the files hold no cost data), MBD and the order list. Two same-length periods (default 1–21 Oct against 1–21 Sep); compact filter pills for dealer, DB code, outlet, zone, city, channel, model and wheel size; the old `#/compare/dealer-vs-datasense` address redirects here |
| Dealer App › Orders & Performance, Complaints, Hero Smiles | six main cards on Orders & Performance (the sixth is **MBD**), a “More measures” fold-out, filters that include **Model** and **Wheel size**, tabs (Trends / Dealers / Models / Orders); Dealer App complaints live here, not in a separate group; Hero Smiles: balance on the chosen snapshot day, top balances, largest changes, members, snapshots, anomalies |
| DataSense SFA › Orders & Performance, Complaints, Employee Activity | the same pattern as the Dealer App pages; DataSense complaints live here |
| Bizom SFA Usage | usage by month, report and user rankings |
| Bizom SFA vs Dealer SFA Usage | Bizom (the MIS usage report) against the Dealer SFA (the employee daily-activity report): people, accesses, visits and orders by month |
| **Issue Tracker** (its own menu entry) | issue status, platform, priority, target month and an issue register; not period-filtered |
| **Overall Summary** (directly above Data Import, `#/overview`; formerly *Executive Overview*) | signal cards for the takeaways and risks (a short label, one figure, its period; the sentence is in the “?” popover), numbered next-step chips, a tile per system with detail tiles (Dealer App adds **MBD**), Hero Smiles and Issue Tracker tiles, key insights as cards, orders by month and a tab per system. A dealer filter narrows it to one dealer. Everything is clickable |
| Dealer profile | opens from any dealer name: Overview (starts with a *Growth and channel* block), Orders, Complaints, Activity, Loyalty, Comparison |
| Data assistant | floating “Ask the data” button on every page: answers from the data in the browser for the periods and filters on screen; rule-based, offline, no API key, not a generative model |
| Data Import | the import wizard and the import history |
**Header.** The logo and “CRM Tracker | Bizom SFA | Dealer App | DataSense SFA” are in the left corner; the reporting period and an **Import** button (opens Data Import) are in the right corner.

**Filters.** Every data page has a filter bar under its title with the choices that page’s own data supports (zone, city, role, dealer, status, month and so on). The Overall Summary filters by dealer. Filters are compact pills (a pill lights up while it holds a selection; on a phone they fold behind one “Filters” button). Filters are kept in the address, so they can be shared and the Back button steps through them.

**No prose on the dashboards.** Findings are shown as KPI cards, signal cards, charts and tables. The sentence that explains a figure (formula, exclusions, how to read a chart) sits in the “?” popover beside it.

Each table has a small download icon (Excel / CSV). There is no Export Centre and no Data Quality page; the import wizard still validates and reconciles every file against its printed totals before it is loaded.

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173
```

Open **Data Import**, drop the MIS ZIP (or the folder) on the upload area and follow the eight steps
(Upload → Identify → Preview → Validate → Map → Reconcile → Refresh → Confirm). Every page then reads from the stored data.

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest: unit + integration tests
npm run build        # type-check + production build into dist/ (no data inside)
npm run build:html   # single-file CRM_Tracker_Dashboard.html with the data in data/CRM MIS embedded
npm run preview      # serve dist/ on http://localhost:4173
```

### Tests

`npm test` runs 200+ tests:

| File | Covers |
|---|---|
| `tests/metrics.test.ts` | KPI formulas on small synthetic files whose answers are checked by hand: SKU lines → orders, order value, eligible orders, AOV, ASP, fulfilment, rejected/zero-value handling, unique SKUs, blank ≠ zero, day-first dates, duplicate lines/keys, DataSense totals row and status groups, periods, complaint backlog/age/TAT availability, issue overdue/stale, Hero Smiles snapshot changes |
| `tests/ingest.integration.test.ts` | The real files: identification of all 17, HTML-as-.xls, header detection, reconciliation to source totals, no silent row drops |
| `tests/session.integration.test.ts` | The import workflow against IndexedDB (fake-indexeddb): new period, replace, duplicate upload, merge, partial overlap, missing columns and manual mapping, unidentified/failed files, persistence across reload, remove and reset |
| `tests/export.test.ts` | Workbook structure (named sheets, frozen header, filters, number/date formats, blank cells), CSV formula-injection guard, Excel workbook writer |
| `tests/metrics.real.test.ts` | Headline numbers on the supplied files (regression anchors) |
| `tests/mbd.test.ts` | Models billed per dealer: what counts as billed and as a model, the headline and per-dealer figures on hand-made orders, and on the real files the partition by model and wheel size, the 141 dealer–model pairs and MBD 14.1 |
| `tests/growth.test.ts`, `tests/comparison_page.test.ts` | The growth model: windows and the data cut-off, same-days comparison, an order counted once across channels, dealer classes and confidence, polarity-aware tones, profitability detection, the executive brief, the data assistant's answers and the menu order |

The tests that need the real MIS files read them from `data/CRM MIS/` (or the folder in `CRM_MIS_DIR`). If that
folder is absent they are skipped and the synthetic tests still run. **`data/` is git-ignored**: the confidential
exports are not part of the repository or the build.

## Deploy to Netlify

The repository contains `netlify.toml` (build command, publish directory, SPA redirect, security headers).

**From Git (recommended)**

1. Push this folder to a Git repository (the `.gitignore` already excludes `node_modules`, `dist` and `data/`).
2. In Netlify choose **Add new site → Import an existing project** and select the repository.
3. Leave the detected settings: build command `npm run build`, publish directory `dist`, Node 20 (set by `netlify.toml`).
4. Deploy. Every route (for example `/dealer/orders`) works on reload because of the `/* → /index.html` rewrite.

**Drag and drop**

1. `npm install && npm run build` locally.
2. Drag the `dist/` folder (not the project folder) onto Netlify's *Deploys* page. The build copies `public/_redirects`
   into `dist/`, so deep links and reloads work. The security headers are defined in `netlify.toml`, which Git and CLI
   deploys apply; for a drag-and-drop site add the same headers under *Site configuration → Headers* (or use the Git route).

**Netlify CLI**

```bash
npm run build
npx netlify deploy --dir=dist --prod
```

## What a static deployment can and cannot do

* The deployed site is a static bundle. **Importing files in the browser does not change the deployed site.** The
  imported data lives in *that browser's* IndexedDB only.
* There is **no sync**: a colleague opening the same URL sees an empty app until they import the same files. To share a
  data set, import the same files on the other machine (**Data Import**).
* Clearing site data, using a private window or switching browser/profile starts empty again.
* Because nothing is stored on a server there is no login. Anyone who can open the URL can use the (empty) app; the data
  is protected only by who has the files and the browser profile. Put the site behind Netlify password protection or
  SSO if the URL should not be public.
* Large files are read in a Web Worker so the page stays responsive; the Focus & Liquidation workbook (≈11,700 rows
  over six sheets) and the 5,900-row DataSense order report import in a few seconds.
* Scheduled or automatic refresh from a shared drive is not possible without a server. Monthly refresh = import the new
  month's files (new months are **added**, a corrected export of an existing month **replaces** it, a later date range
  can be **merged**).

## Project layout

```
src/
  lib/ingest/     readers (CSV / XLS / XLSX / HTML-xls / ZIP), source registry, per-source normalisers,
                  pipeline (identify, normalise, plan, apply), import-session logic, worker client
  lib/store/      IndexedDB persistence, history
  lib/metrics/    all KPI formulas (orders, complaints, Bizom, issues, employees, loyalty, comparison, comparison table,
                  dealer profile, period windows, overview, key insights, quality)
  lib/nav/        links between dashboards (filter links, dealer links)
  lib/export/     formatted Excel (ExcelJS, loaded on demand), CSV, comparison downloads
  components/     layout, KPI cards, tabs, data table, comparison table, dealer profile, charts, drawers, URL filters
  pages/          one file per page
  workers/        ingest web worker (spawn.ts = normal build, spawn.single.ts = inline worker for the HTML file)
  generated/      snapshot.empty.ts (Netlify) / snapshot.data.ts (generated for the HTML file, git-ignored)
scripts/          make-snapshot.ts (data → embedded snapshot), finish-html.mjs (copy the built page)
tests/            vitest suites
docs/             KPI glossary, source mapping, delivery report
```

## Design decisions worth knowing

* **Dealer App orders are SKU lines.** An order is counted once by `Order_ID`; its value is the sum of its line amounts.
* **Dealer matching is by validated ERP code only.** Names are never used to merge; identical names with different codes
  are shown as *candidates for review* and stay unmerged until a person accepts them.
* **Dealer App and DataSense totals are never added** – the two systems are different sources and are always shown side by side. The one exception is the *combined* view on the comparison page, where a DataSense order that carries the SAP number of a Dealer App order of the same dealer is counted once.
* **Growth is not profit, and not proof of cause.** The comparison page reports sales value only (no file has cost or margin) and classes dealers from order values; it never says the Dealer App caused a change or improved profitability.
* **The data assistant is not a generative AI.** It matches questions to the dashboard's own calculations, sends nothing out and holds no key. The Netlify security policy (`connect-src 'self'`) blocks outside calls; no serverless function is used.
* **The employee-activity report is the Dealer SFA's usage.** The Bizom vs Dealer SFA page measures Bizom with the MIS
  usage report and the Dealer SFA with the employee daily-activity report (confirmed by the business). The two are
  compared by month and by group (zone, designation, role); there is no shared employee ID, so people are never paired.
* **Hero Smiles balances are point-in-time.** They are never summed across snapshots; snapshot dates come from file
  names (documented inference); mobile numbers are masked; joins use `customer_external_ID`.
* **Bizom `Access_Count` is "recorded report accesses"**, not downloads.
* **Assumptions are defaults, not hard-coded.** Rejected orders and test/service accounts are left out, the as-of date is
  today, low usage is 5 accesses or fewer, the Dealer App is the comparison baseline. There is no Settings or Data Quality screen to change them; the stored values
  (`Settings` in `src/lib/types.ts`) are still honoured if present.
* **Changes against an earlier period are shown only when they are honest** (whole months, same-length earlier window,
  every month complete). A month in progress is never compared with a full month.
* **Everything is clickable and URL-backed.** The filter bar on each page, KPI cards, chart bars, insights and table rows open the right page already
  filtered (`?f.status=open&l.status=Open`); a dealer name anywhere opens the dealer profile on top of the page
  (`?dealer=<ERP code>`), and closing it, or the browser Back button, returns to exactly the same filtered view. Only
  validated ERP codes open a profile.

## Security and dependency notes

* `netlify.toml` sends a strict Content-Security-Policy (`default-src 'self'`, no third-party scripts, `connect-src 'self'`),
  `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. The app makes no network requests after it loads.
* Exports neutralise spreadsheet formulas in CSV text cells (`=`, `+`, `-`, `@` prefixes).
* `npm audit --omit=dev` currently reports five advisories:
  * **`xlsx` 0.18.5 (high – prototype pollution, ReDoS).** SheetJS no longer publishes patched builds to npm; the fixed
    releases are distributed from `cdn.sheetjs.com`, which was not reachable from the build environment. The library is
    used only to read `.xls`/`.xlsx` files you choose, inside your own browser, behind the CSP above, so exposure is limited to opening a
    deliberately malicious workbook. To remove the advisory, install the patched tarball
    (`npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) and re-run `npm test`. The code uses only
    `XLSX.read`, `XLSX.SSF` and `XLSX.utils.decode_cell` (all in `src/lib/ingest/readers.ts`), so the swap should be a
    drop-in, but it could not be tested here because the CDN is blocked in the build environment.
  * **`react-router` / `react-router-dom` 6.30.6 (moderate).** The advisories concern server-side rendering hydration and
    redirects built from untrusted input. This app is a client-only SPA and only navigates to fixed internal paths.
    The fix is in v7 (breaking change); upgrading is optional.
  * **`exceljs` → `uuid` (moderate).** The advisory is about the `buf` argument of uuid v3/v5/v6; exceljs does not use it that way.
