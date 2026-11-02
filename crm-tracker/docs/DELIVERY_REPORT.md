# CRM Tracker – delivery report

Prepared 26 Oct 2026 for the supplied package (`OneDrive_2026-10-26_1.zip`, 17 files). Every number below was
produced by the app's own parsers and formulas from those files; the same figures are asserted in
`tests/metrics.real.test.ts`.

## 1. Files detected

All 17 files were identified automatically, imported with **0 invalid rows**, and every row is accounted for
(*read = kept + duplicates + invalid + totals row set aside*).

| # | File | Identified as | Sheet read | Period / range | Rows read | Kept | Set aside |
|--:|---|---|---|---|--:|--:|---|
| 1 | `DealerAppOrders-SEPT.csv` | Dealer App orders | CSV | Sep 2026 | 232 | 232 | – |
| 2 | `DealerAppOrders-oct.csv` | Dealer App orders | CSV | Oct 2026 | 375 | 375 | – |
| 3 | `Complaint Module Dump- Dealer App - 26 Oct.xlsx` | Dealer App complaints | ticket-listing sheet | 1–25 Oct 2026 | 7 | 7 | 1 test ticket excluded from KPIs |
| 4 | `MIS_usage_report_bizom-aug.csv` | Bizom MIS usage | CSV | Aug 2026 | 610 | 610 | – |
| 5 | `MISUsagereport-Bizom-sept.csv` | Bizom MIS usage | CSV | Sep 2026 | 565 | 565 | – |
| 6 | `MISUsagereport-Bizom-Oct.csv` | Bizom MIS usage | CSV | Oct 2026 | 575 | 575 | – |
| 7 | `Issue_Tracker.xlsx` | Bizom issue tracker | Tracker (+ Dashboard checked) | dated updates 7–13 Oct | 57 | 57 | – |
| 8 | `Order Punched Report- Datasense - aug to oct.xls` | DataSense orders (HTML table saved as .xls) | HTML table | 1 Aug – 26 Oct 2026 | 5,908 | 5,907 | 1 footer Total row |
| 9 | `Complaint Module Dump- Datasense - 26 Oct.xlsx` | DataSense complaints | Sheet1 | 1 Sep – 26 Oct 2026 | 1,776 | 1,776 | – (sheet claims 10,43,711 rows; only 1,776 are populated) |
| 10 | `Employee-daily-activities-datasense-sept.csv` | DataSense employee activity | CSV | Sep 2026 | 73 | 72 | 1 footer TOTAL row |
| 11 | `Employee-daily-activities- Datasense-oct.csv` | DataSense employee activity | CSV | Oct 2026 | 73 | 72 | 1 footer TOTAL row |
| 12 | `Focus & Liquidation - datasense.xlsx` | Focus & Liquidation (reference) | all 6 plant sheets (1010, 1054, 1020, 1051, 1052, 1056) | n/a | 11,662 | 11,662 | – |
| 13–17 | `CAPILLARY_HERO_EARNING_28 sept / 05Oct / 13oct / 19Oct / 26Oct.csv` | Hero Smiles snapshots | CSV | snapshots 28 Sep, 5, 13, 19, 26 Oct (dates from file names) | 13–24 each (5 files) | all | – |

Headline results (default settings: rejected orders excluded, test/service accounts excluded, as-of 26 Oct 2026)

| Area | Result |
|---|---|
| Dealer App | 607 SKU lines → **34 orders**, **29 eligible**, order value **₹45,54,965** (₹45.55 L), AOV ₹1,57,068, ASP ₹4,082, fulfilment 73.0%, 5 rejected (14.7%), 10 active dealers |
| DataSense | **5,907 orders**, 5,574 eligible, order value **₹1,13,07,75,956** (₹113.08 Cr), AOV ₹2,02,866, 207 rejected (3.5%), billed rate 74.9% (status based), 1,492 active dealers |
| Complaints | DataSense 1,776 raised, 1,496 not closed (572 open > 30 days), average turnaround 518 h; Dealer App 6 real tickets (1 test excluded), 5 not closed, turnaround **unavailable** |
| Bizom usage | **8,130 recorded report accesses**, 145 users, 209 reports, top-5 reports = 59.9% of accesses (test/service accounts excluded; 8,283 including them) |
| Issue tracker | 57 items, 25 open, **13 overdue**, 56.1% resolved |
| DataSense employees | 70 employees, 6,512 visits, 3,639 orders, 0.56 orders per visit |
| Hero Smiles | latest snapshot (26 Oct): 24 members, 11 with a balance, 52,025 current points |
| Source-total reconciliation | 19 of 19 checks match the totals printed in the source files |
| Data quality | 0 error-level issues, 151 warnings (135 of them zero-value DataSense orders), about 880 information notes (for example 386 DataSense orders whose value differs from cycles + spares, 335 Dealer App lines where Amount ≠ qty × price) |

## 2. Mapping table

The complete source-column → canonical-field tables (with every accepted spelling), the reading notes for each file and
the dashboard-to-source map are in **`docs/SOURCE_MAPPING.md`**. In the app they are live in *Data Import →
Map* (editable) and in the file catalogue.

| Source | Key mappings that matter |
|---|---|
| Dealer App orders | `Order_ID` → order; `Outlet_ERP_ID` → dealer key; `Amount` → line value; `Order_Quantity` / `Fulfilled_Quantity` → quantities; `Order_Status` → status; `Order_Date` → period |
| DataSense orders | `Order NO` → order; `[code]` in `Dealer Name` → dealer key; `value of Order` → value; `Cycles volume` / `Cycles value` → ASP; `Status` → status group |
| Complaints | `Ticket Number` / `Case Reference Number` → id; `Dealer code` / `[code]` in `Dealer Name` → dealer key; `Status` → status group (visible map); `TAT` / closed date → turnaround |
| Bizom usage | `User_ID`, `Report_Id`, `Access_Count` (= recorded accesses); month from file name |
| Issue tracker | `Pointer`, `Platform`, `Status`, unnamed third column → priority, `Target Date`, `Latest Update – dd.mm.yyyy` columns → dated updates |
| Employee activity | `EMPLOYEE`, `ROLE`, `VISITED`, `ORDER`, `COMPLAINT`, `TOUR`, `MKT COVERAGE`, `EXPENSES`; month from file name |
| Hero Smiles | `customer_external_ID` (join key), `lifetime_points`, `Current_Points`, `Points_issued/expired/manual_adjustment`, `opening_balance`; mobile masked |

## 3. Missing columns and unavailable measures

**Required columns:** none missing in any of the 17 files. **Optional canonical fields:** every field in the registry
was found in every supplied file of its type. Columns present in the files but not mapped (kept in the raw rows) are
listed per source in `docs/SOURCE_MAPPING.md`.

The sources do not contain the following, so the app shows them as **unavailable** instead of estimating them:

| Measure | Why unavailable |
|---|---|
| Dealer App rejection reasons | no reason column in the order export |
| Dealer App complaint turnaround / resolution time | no closed date or TAT in the ticket listing |
| Complaint assignee names (Dealer App) | `Ticket Assigned To` is a numeric user id |
| Issue-tracker owner, department, created date, resolved date, ageing, resolution time | not columns of the tracker |
| Employee expenses | `EXPENSES` is 0 for every employee in both files (treated as not captured) |
| Dealer SFA usage in August | the employee-activity report covers September and October only, so the Bizom vs Dealer SFA page shows August for Bizom alone (a dash for the Dealer SFA) |
| Dealer App vs DataSense comparison for August | the Dealer App export has no August file; only Sep–Oct are compared |
| Hero Smiles trend of balances | balances are never summed across snapshots; the app shows one total per snapshot (as bars), the difference between the two latest valid snapshots, and per-dealer changes |
| Capillary Smile Quiz Points (comparison table) | the Capillary export has no quiz-points field; the column is kept and shows “—” (never filled with `Current_Points`) |
| Change arrows on the Executive Overview | shown only when the period is whole months and every month of both windows is complete; otherwise no change is shown |

## 4. Exact KPI formulas

The full glossary (formula, exclusions, page, settings) is **`docs/KPI_GLOSSARY.md`**. The same text is on every KPI
card (click **?**) and in the *Formula* column of the *KPI summary* export. In short:

* Eligible order = distinct order id, value > 0, status ≠ rejected (unless *Include rejected* is on).
* Order value = Σ eligible orders' value (Dealer App: Σ line `Amount`; DataSense: `value of Order`).
* AOV = order value ÷ eligible orders. ASP = Σ cycles value ÷ Σ cycles quantity.
* Dealer App fulfilment rate = Σ fulfilled qty ÷ Σ ordered qty (cycles). DataSense billed rate = billed/dispatched ÷ eligible orders. **They are different definitions and are not compared.**
* Rejection rate = rejected ÷ all valid orders.
* Complaint backlog = status neither closed nor rejected; age = as-of date − raised date; resolution rate = closed ÷ raised.
* Bizom accesses = Σ `Access_Count`; top-5 share = five most-accessed reports ÷ all accesses.
* Issue overdue = open, real target date < as-of date.
* Hero Smiles totals are per snapshot; never added across snapshots.

## 5. Unresolved dealer matches

Matching uses the validated ERP dealer code only. Names are never used to merge records.

| Item | Result |
|---|---|
| Ordering in both systems (Sep–Oct), matched on ERP code | **8 of the 11 Dealer App dealers**: Jitesh Traders (14554), Popular Cycle Company (14035), Future Bicycles (19601), Kamala Cycle Mart (10061), B.M.Davey & Company (19100), Lucky Cycles (17421), Bike Innovations (17398), Ghosh Cycle Company (10153). “Ordering in both” means an order of any status through the Dealer App **and** through DataSense in the compared months (Data from Sept to Oct) |
| Name-only candidates awaiting review (same name, different code) | **0** – nothing to confirm |
| Orders only via the Dealer App (Sep–Oct) | **3**: Nanaksar Bikes (3117), Just Bicycle and Assessories (3167) and Upper Assam Cycle Co. (12186). The brief says all 11 are in both systems; the files show these three placed no DataSense order in September or October (3117 and 3167 have no DataSense order in any month; 12186 ordered through DataSense only in August, before the Dealer App export starts). They show 0, not a dash, on the DataSense side with the note “Orders only placed through Dealer App”. Future Bicycles (19601) ordered through both, but its Dealer App orders were all rejected |
| DataSense only (Sep–Oct) | 1,385 of 1,549 DataSense dealers (1,540 over all months) – expected: the Dealer App covers 11 dealers, DataSense the wider network |
| DataSense names used by more than one dealer code | 59 – why names are not a safe join key |
| Dealer App complaints that cannot be tied to a dealer | 2 of 7 (one blank/0 code, one non-ERP-style code) |
| DataSense complaint dealers with no DataSense order in the data | 98 |
| Hero Smiles | 1 verified dealer id without any order in either system (10420 Maa Durga Cycle Stores); 2 unverified ids (`NOT-CAPTURED`, `BIZON-D13`) are never joined |

Reviewing candidates (when any exist) is done on the comparison page; accept/reject decisions are stored in the browser
and kept in this browser.

## 6. Static-deployment limitations

* The deployed site is a static bundle. **Importing files does not change the deployed site**; data is stored in the
  importing browser's IndexedDB only.
* **No sync between users or devices.** To share data, import the same files on the other machine.
* Clearing site data, a private window or a different browser/profile starts empty.
* No login or server-side access control: use Netlify password protection / SSO if the URL must not be public.
* No scheduled or automatic refresh; refresh = import the new month's files.
* The browser must keep the data in memory while the dashboards run: the supplied 17 files (≈7 MB) load in seconds;
  much larger exports will be slower and are limited by the device's memory.
* Verified in Chromium (desktop 1440 px, tablet 768 px, mobile 390 px). Firefox, Safari and Edge were not tested.
* Dealer App complaints have no closure date, and the Dealer App export has no August file, so complaint ageing and August comparisons are not available.
* Hero Smiles snapshot dates are read from the file names (28 Sep, 5, 13, 19 and 26 Oct).
* `xlsx` 0.18.5 has two open advisories (no patched npm release); see the README security note.

## 7. Netlify deployment steps

1. Put the project in a Git repository (`data/`, `node_modules` and `dist` are git-ignored; do **not** commit the MIS files).
2. Netlify → *Add new site → Import an existing project* → choose the repository.
3. Build command `npm run build`, publish directory `dist`, Node 20 – all pre-set by `netlify.toml`.
4. Deploy. Deep links work through the `/* → /index.html` rewrite (`netlify.toml` and `public/_redirects`).
5. Open the site → **Data Import** → drop the MIS ZIP → follow the 8 steps → dashboards fill.
6. Optional: protect the site (Site configuration → Access & security) because the site itself has no login.

Alternative: `npm run build` then drag the `dist` folder onto Netlify (see README for the header caveat), or
`npx netlify deploy --dir=dist --prod`.

## 8. Single-file HTML dashboard

`CRM_Tracker_Dashboard.html` (≈4 MB) is the same app built as one file with the 17 supplied datasets embedded
(normalised records, metadata and data-quality findings; raw source rows are not included, Hero Smiles mobiles stay
masked). It opens by double-click from any folder, needs no server or internet, and can still import new MIS files.

* Built with `npm run build:html`; the Netlify build (`npm run build`) is separate and contains no data.
* On first open the embedded data is copied into the browser's storage; if storage is blocked the page shows the
  embedded data read-only with a banner.
* Re-importing the same files is detected by hash and offered as *skip*.
* The file contains confidential business data (dealer names, complaint text, order values). Share it like the MIS files.
* Verified from `file://` in Chromium: all 14 routes, persistence across reload, ZIP import through every wizard step
  (17 of 17 recognised as already loaded), Excel export, desktop and 390 px layouts, no console errors.
  Firefox, Safari and Edge were not tested.

## 9. Final refinement (Classic Hero theme)

What changed in the second pass, on the same data and the same calculations:

* **Look and feel** – red / white / grey “Classic Hero” theme; green = good, amber = watch, red = bad, blue/teal only as a quiet secondary colour; consistent cards, spacing and hover / focus states; mobile shows two KPI cards per row.
* **Settings removed** – no button, modal or menu entry (the switches were later moved to a Data Quality page, which has since been removed – see section 10).
* **Business pages are clean** – no file names, paths, import metadata or “how it was calculated” paragraphs on business pages; that text lives on Data Import. Page-level “Export this data” buttons were replaced by a small download icon on each table.
* **Executive Overview** – ten KPI cards (replaced by system tiles in section 11), clickable key insights computed from the data (three shown, the rest on request), orders by month and one tab per system, at most four charts per tab. Changes against an earlier period appear only when they are honest (section 3).
* **Dealer profile** – any dealer name opens one profile (Overview, Orders, Complaints, Activity, Loyalty, Comparison) on top of the current page; closing it or pressing Back returns to the same filtered view.
* **Dealer App vs DataSense SFA** – a visual summary plus the exact 15-column grouped comparison table (Outlet ID, DB Code, DB Name, Sales App × 5, Dealer App × 5, Capillary × 2), search, sort, horizontal scroll, totals row, Excel/CSV download and rows that open the dealer profile. The screenshot mentioned in the brief did not arrive, so the layout follows the written specification.
* **Every other page** was reduced to five main cards with a “More measures” fold-out, a tab bar and no more than four charts or one table per tab (Orders & Performance, Complaints, MIS Usage, Issue Tracker, DataSense Orders / Complaints / Employee Activity, Hero Smiles, Bizom vs Dealer SFA).
* **Clickable everywhere** – KPI cards, chart bars, legend items, insights and table rows navigate to the filtered detail (filters live in the URL, so links can be shared and Back works).
* **Unchanged** – KPI formulas, import wizard, IndexedDB persistence, all 17 exports, Netlify configuration, single-file HTML build.

## 10. Export Centre and Data Quality & Reconciliation removed

Requested after the refinement pass. Removed from the menu, the routes and the code: the **Export Centre**, and the **Data Quality & Reconciliation** page (summary, files, issues, dealer matching, assumptions and reading notes). The header then centred “CRM Tracker” and its subtitle between the logo and the reporting-period selector (moved to the left corner in section 12).

* Still there: the small download icon on each table (Excel / CSV), the comparison page's own downloads, and Data Import with its Validate and Reconcile steps (every file is still checked against its printed totals before it is loaded).
* Calculation settings (rejected orders, test accounts, as-of date, low-usage threshold, comparison baseline) have no screen now and use their defaults; the Bizom vs Dealer SFA page measures Dealer SFA usage with the employee-activity report (see section 11).
* The 25 tests that only exercised the Export Centre were removed with it (137 → 112).

## 11. Comparison page, Executive Overview and Issue Tracker rework

Requested after section 10.

* **Dealer App vs DataSense SFA** – the 15-column table now sits at the top, listing all 11 Dealer App dealers by default next to their DataSense orders (scopes: Dealer App dealers, Ordering in both, Orders only via Dealer App, DataSense only, All; reworked in section 13). Clickable cards sit above it (dealers on the Dealer App, ordering in both systems, Dealer App orders, DataSense orders; the “SAP orders in both” card was removed in section 14). Figures use only the months both systems cover, with a short note on any row that shows 0 or a dash (the “in both” grouping was changed in section 13).
* **Adoption charts** – dealers that have placed a Dealer App order so far and dealers ordering each week; Dealer App and DataSense orders per week; order value per week. Weeks run Monday to Sunday from the first Dealer App order (9 Sep) and a week is shown only once it is complete in the data. The two systems are never added. In the supplied data all 11 dealers placed their first order between 9 and 29 September; weekly Dealer App orders were 1, 2, 2, 6, 8, 7 and 3.
* **Simple order list** – every order of the Dealer App dealers from both systems (Dealer App 34, DataSense 57 in Sep–Oct) with order number, SAP order number, dealer, date, status, cycles and value. The view and flag for SAP orders found in both systems were removed in section 14.
* **Bizom SFA vs Dealer SFA** – Bizom is measured by the MIS usage report and the Dealer SFA by the employee daily-activity report. The old switch that treated DataSense activity as an assumption was removed.
* **Issue Tracker** is its own menu entry and route (`/issues`); old `/bizom/issues` links redirect and keep their filters.
* **Executive Overview** – three system tiles with four detail tiles under each, a slim Hero Smiles / Issue Tracker row, and key insights redrawn as cards with a system colour, a headline figure, share bars and green / red change arrows. “By system” is unchanged.
* Tests: 112 → 124 (adoption weeks, order list and SAP flags, 9-of-11 matching, the menu, insight visuals).

## 12. Header and filters on every page

Requested after section 11.

* **Header** – the title (“CRM Tracker” and its subtitle) now sits in the left corner next to the logo. An **Import** button in the right corner opens *Data Import*. The reporting period selector sits beside it (below the title on a phone). This replaces the centred title described in section 10.
* **A filter bar on every data page**, built from that page’s own records for the selected period (so a zone, city, role or dealer appears only if the page’s data has it). Choosing a value writes the same address filter a chart click writes (`?f.zone=West`), so the controls, the chart clicks and the KPI cards always agree, links can be shared and Back steps through the choices. Lists with many values (dealers, employees, reports, cities) have a search box. On a phone the bar folds behind a “Filters” button and the chosen filters stay visible as chips.

| Page | Filters offered |
|---|---|
| Dealer App › Orders | status, month, zone, city, dealer, order size |
| DataSense SFA › Orders | status, month, city, role (RSE / ASM), employee, dealer, order size |
| Dealer App › Complaints | status, department, category, sub-type, ageing, dealer |
| DataSense SFA › Complaints | status, month, responsible function, category, role, raised by, ageing, dealer |
| Bizom SFA › MIS Usage | month, zone, account type, designation, report, user |
| Issue Tracker | status, priority, type, platform, target month, a “Show” list (open, overdue, P1 and open, no target) |
| DataSense SFA › Employee Activity | month, role, employee, a “Show” list (no visits, no orders) |
| Hero Smiles | balance, ID check, orders in either system, change since the previous snapshot, member |
| Dealer App vs DataSense SFA | dealer, orders from (Dealer App / DataSense), week, order status |
| Bizom SFA vs Dealer SFA | Bizom zone, Bizom designation, Dealer SFA role |
| Executive Overview | dealer (see below) |

* **Executive Overview filter is the dealer only.** Zone, city and role exist in only some of the systems (complaints and Hero Smiles have none), so a single geographic filter would silently drop data from the others. A validated ERP dealer code exists in every dealer-level system, so choosing a dealer narrows its Dealer App and DataSense orders, complaints in both systems and Hero Smiles balance, and the tiles and links open the detail pages already filtered to that dealer. Bizom report usage, the Issue Tracker and employee activity are not recorded per dealer, so under a dealer filter those tiles say so instead of showing a zero.
* **What the filters do not do.** Filters on the comparison pages narrow the dealer table and the order list; the five summary cards and the adoption charts always cover every Dealer App dealer (said on the page). On Hero Smiles the filters narrow the member list, and balances are still never added across snapshots. The Bizom vs Dealer SFA filters cut the Bizom side (zone, designation) and the Dealer SFA side (role) separately, in the same months.
* **Counts beside a choice** are records on that page (orders placed, complaints, members); on the order pages they include rejected orders, so they can be larger than the cards, which count eligible orders only (said on the page).
* Tests: 124 → 136 (option building, the dealer scope on the supplied files, the dealer partition of orders, the Dealer SFA role cut).

## 13. Comparison: which system each dealer orders through

Requested after section 12: *edit the dashes for Nanaksar, Just Bicycle and Upper Assam to 0, replace “Not in DataSense” with a short note that orders were only placed through the Dealer App, write “Data from Sept to Oct” on the comparison, and understand that the 11 dealers are in both systems but differ in which system they place orders through.*

* **Groups are now decided by where a dealer placed orders** in the compared months (Sep and Oct 2026), not by whether the dealer shows up anywhere in the files. Result: **8 dealers order through both systems, 3 only through the Dealer App** (Nanaksar Bikes 3117, Just Bicycle and Assessories 3167, Upper Assam Cycle Co. 12186). Before, Upper Assam counted as “in both” because it had DataSense orders in August, which made the split 9 / 2. The three tabs were kept but renamed: *Ordering in both (8)*, *Orders only via Dealer App (3)*, *DataSense only (1,385)*; the default tab still lists all 11 Dealer App dealers.
* **Dashes became zeros** for those three dealers on the DataSense side: orders 0, quantity 0, value ₹0, average order value ₹0. Complaints were already 0. **Smile Quiz Points stays “—”** because the Capillary export has no such field. Totals do not change (adding zeros). A total row whose rows have no orders now shows 0 instead of a dash.
* **Note under the dealer name** is now “Orders only placed through Dealer App” (it replaced “Not in DataSense” and “No DataSense orders in the compared months”). Future Bicycles keeps “Dealer App orders were all rejected”; its Dealer App average order value is still a dash because it has no eligible orders (not part of this request).
* **“Data from Sept to Oct”** is written under the page title and beside the dealer tabs, and in the notes of the Excel/CSV download. It is built from the months both systems cover, so it changes if the files change (“Data from Sept to Nov”, or “Data for Oct” for one month).
* **The card “Also in DataSense” became “Ordering in both systems”** (8, “of 11 · 3 only via Dealer App”). The Executive Overview tiles now read “8 also order via Dealer App / via DataSense”, and the key-insight card was renamed “Which system dealers order through”.
* **Dealer profile › Comparison tab** shows the same zeros and note for these three dealers (the average order value and average selling price are shown as 0 but not compared with the Dealer App’s), and the two header badges read “Dealer App orders” and “DataSense orders” because they show where orders exist.
* **Exports** label dealers “Orders in both systems”, “Orders only via Dealer App” and “Orders only via DataSense”; the “common dealers” totals now cover the 8 dealers ordering in both systems (23 Dealer App orders, 53 DataSense orders).
* **What the files cannot show:** whether Nanaksar and Just Bicycle exist in DataSense at all (the DataSense order report only lists dealers that ordered). The brief says they do, so the page speaks of where they *order*, not where they are *registered*.
* Tests: 136 → 140 (the 8 / 3 split, zeros and notes, “Data from Sept to Oct”, the dealer profile agreeing with the table, the zero total AOV).

## 14. Data Import, SAP tile, Hero Smiles menu and Issue Tracker dates

Requested after section 13.

* **Backup and restore removed** from the import page (the *Download backup (.zip)* and *Restore from backup* buttons, their note and the code behind them). The page is now called **Data Import** (menu, header button and page title; the section that held the buttons is “Embedded data and reset” and the history is “Import history”). *Load data embedded in this page* and *Reset all data* stayed at that point and were removed in section 15. A colleague who needs the same numbers imports the same files, or opens the same single HTML file.
* **“SAP orders in both” removed** from the Dealer App vs DataSense page, with everything tied to it: the card (four cards remain), the SAP filter, the “SAP in both” view, the “SAP order in both systems” column and badge, the Overview insight “N SAP orders appear in both systems”, the export sheet and reconciliation row, and the calculation itself. The order list still shows each order’s **SAP order number** as a plain column. Dealer App and DataSense totals are still never added.
* **Hero Smiles** now sits inside the **Dealer App** menu, after Complaints (it is no longer a top-level entry). Its address (`#/hero-smiles`) is unchanged, so saved links still work, and the breadcrumb reads Home › Dealer App › Hero Smiles.
* **Issue Tracker**: the *Last dated update* and *Days since update* columns are gone, together with the “No update in 14+ days” card, the matching “Show” filter option and the Overview insight that counted them. The update notes themselves are still listed when an issue is opened, and the hidden *Latest note* column stays in the Excel download.
* Tests: 140 → 140 (two backup / restore tests removed; tests added for the menu, the page name, the dropped SAP fields and the dropped Issue Tracker measures).

## 15. Embedded data / reset removed, employee mapping removed, MBD added

Requested after section 14: *remove the embedded data and reset feature; in the Dealer App › Orders and Performance add **MBD – models billed per dealer** (the Dealer App orders list which dealer bought which model), add it as a filter that categorises the model so orders and other figures can be checked by model, add it to the executive summary; remove the employee mapping from Bizom SFA vs Dealer SFA usage.*

**Removed**

* **“Embedded data and reset”** on Data Import: the *Load data embedded in this page* and *Reset all data* buttons, the note about the embedded copy, the reset confirmation and the code behind them. Importing, replacing and removing a single dataset still work. **One thing deliberately kept:** the HTML still copies its data into the browser on the very first open (otherwise the file would open empty and the 17 files would have to be imported by hand). Nothing re-loads or wipes it afterwards; to start again from the shipped data, clear the page’s site data in the browser.
* **Employee mapping** on Bizom SFA vs Dealer SFA usage: the *Employee mapping* tab, the “Same name in both reports” suggestions, the “Paired employees” table, the manual pairing controls, the stored pairing list and the calculation behind them. The page keeps its four cards, three charts and the month-by-month table; the two sides are compared by month and by group (zone, designation, role), and people are never paired across the two reports.

**Added – MBD (models billed per dealer)**

* **Where it is.** Dealer App › Orders & Performance: a sixth card, a **Models billed (MBD)** column in the dealer table, and a new **Models** tab (models billed per dealer, cycles billed by model, a “which dealer was billed for which model” list, and a table of every model). Executive Overview: an MBD tile under the Dealer App column and an MBD card in the *By system › Dealer App* row. Both Overview items open the Models tab.
* **Definition used** (the data has no field that says “MBD”, so this is my reading of the request; please confirm it): *model* = the Dealer App’s own `Sku_Brand` (60 values, names not merged); *billed* = the line has an `Invoice_Id` and a fulfilled quantity above zero (386 of 607 lines; no rejected order has an invoice); a dealer’s MBD = the distinct models with at least one billed line; the headline = the dealers’ counts added up ÷ dealers with an eligible order.
* **Result on the supplied files (Sept–Oct):** **MBD 14.1** = 141 dealer–model pairs ÷ 10 dealers, 56 distinct models billed, all 10 dealers billed at least one model. By month: September 7.4 (9 dealers), October 11.6 (7 dealers). Per dealer: Jitesh Traders 36, Kamala Cycle Mart 36, Popular Cycle Company 16, Lucky Cycles 14, Nanaksar Bikes 11, Just Bicycle and Assessories 9, Bike Innovations 7, Upper Assam Cycle Co. 6, Ghosh Cycle Company 3, B.M. Davey & Company 3. Future Bicycles (19601) ordered 16 models but all its orders were rejected, so it is outside the eligible orders; with *Include rejected* on it counts as 0 and MBD becomes 12.8.
* **Filters.** The Dealer App filter bar gains **Model** (60 choices, searchable) and **Wheel size**. Choosing either slices the order *lines*: each order is rebuilt from only its lines of that model or size, so the cards, charts, dealer table, Models tab and order list all describe that model (a note under the filters says so). Status, zone, order size and the other filters are still judged on the whole order. Both write an address filter (`f.model`, `f.size`) like every other filter, so links can be shared. The order list also gets a **Models** column and the order drawer a “Models” line.
* **“Categorise the model”.** The export has **no model category** (`Category` is *Cycles* on every line). The only grouping that can be read from the data is the size in the SKU name, so the second filter is **Wheel size** (12, 14, 16, 20, 24, 26, 27, 27.5, 29 inch and 50 / 55 cm frames). It is not a Hero product category; if Hero has a model → category list, it can be added as a lookup.
* **Not changed:** DataSense pages have no model data and no MBD; MBD is not added to any Dealer App vs DataSense total.
* Tests: 140 → 156 (16 new in `tests/mbd.test.ts`: billed and model definitions, wheel-size reading, the headline and per-dealer figures on hand-made orders, rejected orders and the include-rejected setting, slice behaviour, and on the real files the 141 pairs / MBD 14.1, September and October, and that slicing by model or by wheel size loses and double-counts nothing; the role-filter tests no longer pass a pairing list).

## 16. Business growth and profitability analytics upgrade

Requested after section 15: *does the new Dealer App help Hero Cycles grow its business and improve profitability compared with the existing SFA channels?* (the brief “HERO CYCLES CRM TRACKER – BUSINESS GROWTH & PROFITABILITY ANALYTICS UPGRADE”).

**What was added**

* **The app now opens on “Dealer App vs SFA Comparison”** (`#/`); the Executive Overview is the second menu entry (`#/overview`). Reporting and comparison periods are chosen on the page (default: 1–21 Oct against 1–21 Sep, month to date against the same days of the previous month; cut-off 21 Oct, the last day both order exports reach).
* **Comparison page**, tabs *Summary · Comparison · What is driving growth · Trends · Dealers · Profitability · MBD · Orders · Definitions*: a “short answer” (business growth, new business or moved business, profitability), headline cards (value, volume, ordering in both channels, adoption, margin), side-by-side cards per channel (value, orders, cycles, AOV, ASP, active dealers, rejection, fulfilment, complaints) with change, gap and an *indicative* tag when the base is small, a drivers waterfall (what added or lost value), trend charts, the dealer table with a **class per dealer** and the evidence, a pilot-versus-others benchmark, the Profitability tab and the MBD tab.
* **Multi-select filters** on the page: Dealer, DB code, Outlet ID, Zone, City / territory, Channel, Model, Wheel size (several values each, searchable, kept in the address). Choosing every value is the same as choosing none. Every card, chart, table and the exports follow them.
* **Executive Overview** gets a brief on top: takeaways, key risks and recommended actions derived from the same model (each with its figure, period and link). Its “By system” tabs are unchanged.
* **Dealer profile** opens with a *Growth and channel* block: class, combined value change, Dealer App and DataSense share, change per channel, MBD, with a link back to the comparison page on that dealer.
* **Data assistant** (floating button, bottom right): answers from the data in the browser for the periods and filters on screen, with the figures, period, dealers and links to the records. It is rule-based, offline and key-less (see the AI decision below).
* **Exports** respect the filters: the comparison workbook (sheets: KPI comparison, dealers with class and evidence, monthly trend, orders, profitability status, and a Notes sheet with the periods, filters and definitions) and an executive-summary workbook (the brief and the figures behind it).
* **Menu order:** Dealer App vs SFA Comparison, Executive Overview, Dealer App Performance (Orders & Performance, Hero Smiles), DataSense SFA Performance, Bizom SFA Usage, Dealer App vs SFA Usage, Bizom SFA vs Dealer SFA Usage, Complaints and Issues, Data Import. The Overview moved from `#/` to `#/overview`; every other address is unchanged.

**Result on the supplied files** (11 Dealer App dealers, 1–21 Oct 2026 against 1–21 Sep 2026, both channels):

| Measure | Result |
|---|---|
| Combined order value | ₹36.33 L → ₹46.03 L, **+26.7 %** (cycles 918 → 1,180, +28.5 %) |
| Dealer App / DataSense | Dealer App ₹5.39 L → ₹27.47 L (+₹22.08 L); DataSense ₹30.94 L → ₹18.56 L (−₹12.38 L) |
| Orders | Dealer App 3 → 18; DataSense 22 → 13 |
| Dealer classes | 7 incremental growth, 1 channel migration, 2 declining, 1 stable / no baseline |
| Adoption | 70 % of active dealers ordered via the Dealer App (30 % in 1–21 Sep) |
| Profitability | **Not verified** – no file has cost, margin, discount, return, freight or incentive data |

Reading: in the first three weeks of October the 11 dealers placed more business than in the same days of September, and most of the gain is in dealers that grew overall; part of the Dealer App gain replaced DataSense orders. The data cannot show that the Dealer App *caused* the growth (September was also the app's launch month, with a small base), and it cannot show profit.

**Decisions to confirm**

1. **Windows and cut-off.** Month to date is compared with the same days of the previous month, so a month in progress never looks like a collapse. The cut-off is the earlier of the two last order dates (21 Oct), so the channels cover the same days.
2. **Counting an order once.** A DataSense order that carries the order or SAP number of a Dealer App order of the same dealer is the same order and is counted as Dealer App in the combined view. (Everywhere else Dealer App and DataSense totals are still never added.)
3. **Class thresholds** (10 % growth, 3-order minimum base, 14-day minimum window, ±2 % flat band, 50–200 % offset for migration) are named constants in `src/lib/metrics/growth.ts`; change them there if the business wants other rules.
4. **AI assistant.** The brief asks for an assistant grounded in the local data that does not expose API keys and does not send business data to an external service without explicit approval. No such approval or key exists, so the assistant is a **local rule-based question matcher**, not a generative model. The Netlify security policy (`connect-src 'self'`) blocks outside calls, and no serverless function or environment variable is needed or included. If a generative assistant is wanted later, it needs an approved provider and a Netlify function holding the key; the engine's `ask()` interface is the single place to connect it.
5. **Profitability** cannot be assessed from these files (see the limitations below).

**Limitations**

* **Profitability.** Nothing in the 17 files measures cost, margin, discount, return, freight, incentive or contribution, so no profit or margin figure is shown and the page does not say the Dealer App improved profit. The Profitability tab lists the six inputs needed (cost of goods per SKU, discounts and schemes, returns and credit notes, freight, incentives, channel cost to serve) and detects them automatically if a later import contains them.
* **MBD.** The data has no field called MBD. The definition is the one in section 15 (distinct `Sku_Brand` values with a billed line per dealer); DataSense has no model data, so MBD and the Model / Wheel size filters cover the Dealer App only. The export has no model category, so “categorise the model” is wheel size.
* **Cause.** Classes are estimates from order values. They do not prove that the Dealer App caused a change, and the Dealer App has only been live since 9 Sep, so the comparison period is a small base (tagged *indicative* or *inconclusive*).
* **Weekly refresh.** The browser stores imported files in its own IndexedDB; a weekly ZIP is imported on the Data Import page. New months are added, a corrected export of an existing period is replaced, identical files are skipped. Each person importing the same files sees the same numbers; nothing is shared or synced.

## 17. Menu, comparison page and text removal

What changed, as the business asked:

* **One comparison page.** *Dealer App vs SFA Comparison* and *Dealer App vs DataSense* were the same question, so they are now one page, **Dealer App vs DataSense SFA**, at the top of the menu and the page the app opens on. It keeps everything the growth page had (headline and per-channel cards, bridge, monthly trends, dealer classes, dealer charts and table, Profitability, MBD, order list) and adds the weekly adoption charts and the grouped dealer-by-dealer comparison table from the old second page. The old address `#/compare/dealer-vs-datasense` redirects to the new page; links from the dealer profile, the insights and the assistant point at its sections (`?show=table`, `?show=adoption`, and so on).
* **Menu.** Dealer App vs DataSense SFA · Dealer App Performance (Orders & Performance, **Complaints**, Hero Smiles) · DataSense SFA Performance (Orders & Performance, **Complaints**, Employee Activity) · Bizom SFA Usage · Bizom SFA vs Dealer SFA Usage · **Issue Tracker** (its own entry; the “Complaints and Issues” group is gone) · **Overall Summary** (formerly Executive Overview) · Data Import.
* **No written part.** Page subtitles, the “short answer” block, the notes, definitions and caption paragraphs were removed. Findings are KPI cards, signal cards, charts and tables; a figure’s explanation (formula, exclusions, how to read a chart) is in its “?” popover. The Overall Summary now shows signal cards (takeaways and risks) and numbered next-step chips instead of paragraphs. Employee Activity’s four note blocks became signal cards. Issue Tracker and Hero Smiles carry a small “not period-filtered” badge.
* **Compact filters.** A filter is a small pill (lit while it holds a selection) in one wrapped row with a single “Clear”; the growth page puts its period controls and filters in one card; on a phone the filters fold behind a “Filters” button.
* **Everything clickable.** Cards, chips, bridge bars, chart bars and points, class tiles, table rows, system tiles, signal cards and next-step chips all open the records behind them.

Changes to figures: none. Only layout, naming and navigation changed; every number comes from the same functions as before.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 206 tests pass, including the new menu, redirect and section-link checks |
| Real browser, built HTML from `file://` | 1440 px and 390 px: every page loads without console errors; sidebar entries, section chips, headline cards, bridge bar, class tile, filter pill, reset, comparison-table row to dealer profile, signal cards, next-step chips and system tiles all navigate; the old comparison address redirects |

## 18. Landing page redesign, April–October DataSense data and Usage Report (29 Oct 2026)

**Requested:** make *Dealer App vs DataSense SFA* the executive landing page for the 11 Dealer App dealers (September–October only,
same dates on both channels); load DataSense April–October from three new files; rename Employee Activity to Usage Report.

**Files used**
| File | Used for | Result |
|---|---|---|
| `Order_Punched_Report_01-04-2026_to_29-10-2026…xls` | DataSense orders, Apr–Oct | 16,452 rows read, 16,451 kept, 1 footer "Total" row set aside, 0 duplicate order numbers, 297 flagged (zero value, value differs from components, possible duplicate) |
| `Complaint_dump_-_datasense_-_YTD.xls` | DataSense complaints, Apr–Oct | 6,702 kept, 1 flagged |
| `App_Usage_Report_ApriltoOct.xlsx` | Usage Report (Summary, ASM-Employee-wise, Orders sheets) | 29,679 order rows; summary totals reproduced from the rows (see glossary 12.9) |
| Dealer App Sep / Oct exports, other 14 files | unchanged, taken from the embedded data of the previous HTML | – |

**Changes**
* Landing page (`/`): scope strip, Month / Dealer / Channel / Model filters, two channel cards, Key Takeaways, 13 comparison cards,
  one dealer table with signal chips, six Sep-vs-Oct charts, models and SKUs, additional business vs channel shift, definitions panel.
* Same dates for both channels: **9–30 Sep** (Dealer App launch 9 Sep) and **1–21 Oct** (last day of the Dealer App export). DataSense orders
  outside these days are listed on the DataSense card (9 before launch, 12 after 21 Oct for these dealers) and not compared.
* DataSense orders that carry the SAP number of a Dealer App order of the same dealer (2) are counted once, as Dealer App.
* Usage Report page replaces the Employee Activity page at the same address (`#/datasense/employees`); the old Sep/Oct employee-activity datasets stay
  in storage because other pages read them.
* First open of the new HTML in a browser that already holds the old data replaces **only** the DataSense order and complaint datasets (version key
  `snapshotVersion`), once. Verified: no duplicates, other datasets untouched.

**Missing or limited**
* DataSense orders have no model/SKU, billed or fulfilled quantity: the product comparison is Dealer App only.
* Usage Report is embedded, not importable through the wizard until a `ds_usage` source is added to the source project.
* 3 of the 11 dealers (Nanaksar Bikes 3117, Just Bicycle and Assessories 3167, Upper Assam Cycle Co. 12186) placed no DataSense order in the compared days: shown as 0.
* No cost data: nothing on the page is profit.
* Built by patching the compiled HTML (no network to rebuild). Source changes are in `patch-oct2026/`; see its README.

**Checked:** headline figures recomputed independently in Python (Dealer App 34 / 29 / 5, ₹45,54,965, 1,116 cycles; DataSense 37 / 34 / 2, ₹48,46,929, 1,305 cycles);
Month, Dealer, Channel and Model filters; dealer profile opens from the table; all 11 routes load without console errors; upgrade of a browser holding the
previous data; 390 px width without sideways scroll. Not run: the project's `vitest` suite (build tools unavailable).

## 19. Landing page v2: visual layout, popups, sections removed (29 Oct 2026, second change)

**Requested:** core comparison as the main content; Key Takeaways moved to the bottom and shown as charts; MBD added to the comparison; dealer and
model/SKU data behind popups instead of on the page; "Channel summary", "Additional business or channel shift" and "Observed pattern by dealer" removed.

**Page order now:** filters → Core comparison (12 cards incl. **MBD**, each with proportional bars; Sep→Oct change; dealer ranking) → September vs October
(6 charts) → Models (MBD) and SKUs (ranked charts, MBD tiles, MBD by dealer) → **Key takeaways (visual)** → Data and definitions (3 buttons).

**Key takeaways, all visual:** "who leads" bars per measure; donuts for share of valid orders, share of order value and dealers by channel used;
stock-style movement tiles (Sep→Oct sparkline, ▲/▼ and % per channel, green = better, red = worse, lower rejection = better); a Gantt-style order-activity
timeline per dealer and channel (marks sized by value, ✕ = rejected, launch line); channel mix by dealer; who drives Dealer App value.

**Popups (open on click, Esc or ✕ closes):** Dealer adoption and comparison (full table, signal chips, search, column chooser, download); Model (MBD) and SKU data
(two tables); Definitions and sources. Dealer names inside open the dealer profile.

**Removed from the page:** the two channel summary cards, the written takeaways, the channel-migration section and the observed-pattern table. The dealer signals
"combined business up / down" were removed with them.

**Checked:** popups open and close; removed sections absent; dealer table not on the page; filters (month, channel, model) respond; all routes load without console errors.

## 20. Landing page v3: movement under the core comparison, everything clickable (29 Oct 2026, third change)

**Requested:** move the September→October movement tiles up under the core comparison; remove Dealer App adoption, Dealer App share of comparable orders, the
Change Sep → Oct table, all Key takeaways, the MBD / ordered-vs-billed / rejected-orders tiles and the Data and definitions section; make cards open popups.

**Page now:** filters → Core comparison (9 cards incl. MBD, plus dealer ranking) → September versus October (movement tiles first, then six charts) → Models (MBD)
and SKUs (ranked charts and MBD by dealer).

**Popups (click a card, tile or chart; Esc or ✕ closes):**
| Click | Opens |
|---|---|
| Submitted, valid, rejected (count + rate), value, quantity, AOV, value per cycle cards; the matching movement tiles and monthly charts | The measure: Sep/Oct chart by channel, ranking by dealer, table by dealer and month with download |
| Active dealers card / tile / chart, dealer ranking | Dealer adoption and comparison: adoption, Dealer App share of comparable orders, dealers by channel used, then the full dealer table with signals |
| MBD card | MBD Sep/Oct, ordered vs billed, rejected Dealer App orders, then the model and SKU tables |
| "Open model & SKU data" | Model and SKU tables |

The "?" help button on a card still opens its definition and does not open a popup. The Change Sep → Oct table was removed because the movement tiles show the same figures.
The Definitions popup was removed; each measure popup and each card's "?" carries its definition.

**Checked:** all 10 cards, 6 tiles, a chart and the models link open the right popup; removed content absent; no console errors.

## 21. Scope strip trimmed (29 Oct 2026, fourth change)
The chips beside "N common dealers" (the Sep/Oct date windows, "same dates for both channels", "Dealer App live from…", "Order value is sales, not profit" and the click hint) were removed; only the "11 common dealers" chip remains. The windows (Sep 9–30, Oct 1–21) are still shown on every chart axis, and the sales-not-profit and same-dates rules stay in the card "?" help and the delivery notes.

## 22. Overall Summary: profitability and Next steps removed (29 Oct 2026, fifth change)
On the Overall Summary page the two profitability signal cards ("Profitability cannot be judged from the imported files" and "Profit impact of the Dealer App is unknown") and the whole **Next steps** section were removed. The remaining signals, system tiles and filters are unchanged. The profitability inspection in the source (`metrics/profitability.ts`) and the Excel summary download still exist; the download may still list actions and the no-cost-data note. The patch is in `patch-oct2026/build.py` (section "Overall Summary").

## 23. Trends (April–October) and Bizom SFA vs DataSense SFA Usage (29 Oct 2026, sixth change)

**Trends (landing page).** "September versus October" is now **Trends**; the movement tiles were removed and only the six bar charts remain. DataSense SFA shows the 11 dealers from **April to October** (full months April–August); the Dealer App shows only **September and October** (no bar before its launch: absent, not zero). September and October use the same dates as the core comparison (9–30 Sep, 1–21 Oct), so those bars equal the core figures; the axis shows month names and the section line states the dates. The Month filter does not change Trends (always the full range); Dealer, Channel and Model filters do. Charts still open the measure popups (Sep/Oct detail). The shared column chart now shows every month label when there are up to 8 months (it skipped labels before; this also applies to other pages' column charts with 6–8 months).

**Bizom SFA vs DataSense SFA Usage (renamed from "Bizom SFA vs Dealer SFA Usage").** The page was rebuilt on two sources: **Bizom SFA usage** (the Bizom MIS report-usage data, Aug–Oct) and the **Usage Report of DataSense SFA Performance** (App Usage Report, Apr–Oct). They are compared on the months both cover (Aug, Sep, Oct). The old Dealer SFA employee-activity comparison, its labels and its "Dealer SFA" wording were removed from this page. Content: side-by-side cards (active people, activity recorded, per active person, breadth, people in both systems), charts (active people by month and by zone, people in both systems, Bizom report accesses by month, DataSense orders by month), and popups with the people-in-both table and the zone × month table. Filters: Month, Zone, Bizom account type.

**Limits.** Report accesses (Bizom) and orders (DataSense) are different measures and are never added or divided by each other. People are matched by name (30 in both over Aug–Oct); there is no shared ID, so spelling differences can hide matches. Bizom test and service accounts are excluded as before. Bizom has no data before August. The import wizard still lists "Dealer SFA employee activity" as a file type; it is unused by this page.

**Checked:** Trends and Bizom page render; filters and both popups work; all 11 routes load without console errors.

## 24. Issue Tracker updated with the new Bizom tracker (29 Oct 2026, seventh change)

**File:** `Bizom_Hero_Tracker__6_.xlsx` (Tracker sheet: 45 Bizom pointers; Dashboard sheet: the file's own summary). Imported with the app's own issue-tracker importer (header row detected, priority column found, text dates kept, one "16.10.2027" update column flagged as a probable year typo, as before).

**What changed in the Issue Tracker (59 issues = 45 Bizom + 14 DataSense, was 57 = 43 + 14)**
* 3 Bizom pointers added: *user leave days transactions*, *Off location ordering*, *DIY Analytics Pilot Creds generated*.
* 1 Bizom pointer no longer in the file: *ARS Edit order functionality for ASM…* (removed from the tracker, as the new file is the source of truth for Bizom).
* 5 status changes: Outlet Mapping with Beat – DSO (Demo / UAT → Completed), Rename 'Fulfilled' to 'Dispatched' (Feasibility Check → In Progress), New 12 Dealer onboard (In Progress → Completed), New Search bar (Not Started → In Progress), Optimisation of app filters and speed (Not Started → In Progress).
* Bizom status now: 25 completed, 8 in progress, 3 Demo / UAT, 3 Feasibility Check, 2 Awaiting Hero Input, 3 Not Started, 1 On hold (matches the file's headline). Whole tracker: 37 resolved, 22 open, resolution rate 62.7%.

**DataSense issues are unchanged.** The new file holds Bizom issues only, so the 14 DataSense issues of the previous tracker were kept exactly (every field identical; only the internal row key was prefixed `ds-` to avoid clashing with the new rows). Verified by comparing all 14 records before and after.

**Everywhere issues appear:** the Issue Tracker page (cards, status, platform, priority, type, target month, register), the Overall Summary (Issue Tracker tile, "overdue issues" signal) and the data assistant all read the same issue records, so they show the new numbers. First open of the new HTML in a browser holding the old data replaces the issue dataset once (tested: 57 → 59).

**Note on the file's own Dashboard sheet:** its platform table totals 43 because one row's platform is typed "Bizom Dealer App " (trailing space) and was counted as a separate platform; the tracker has 45 pointers and the dashboard counts them together (the page shows 20 Dealer App issues). The existing reconciliation note about this mismatch remains in the import.

## 25. "Ask the data" with Groq tool calling on Vercel (29 Oct 2026, eighth change)

**Requested:** let the assistant use a free LLM API so it reads out correct figures from the dashboard, and say "currently no such data is present in the dashboard" when it has none. Chosen: **Groq (`llama-3.3-70b-versatile`)** on its free tier, hosted on **Vercel**, with **tool calling**.

**Design**
* The dashboard's own calculations are the tools; the model never calculates. Ten tools: data coverage; Dealer App vs DataSense (overall or one dealer); dealer table; trends; models/SKUs/MBD; issues; Usage Report; Bizom vs DataSense; DataSense orders (all dealers); complaints. They run in the browser and return small summaries (the only data that leaves the browser).
* `api/ask.js` (Vercel function) holds the key (`GROQ_API_KEY`), fixed system prompt, model, temperature 0 and the tool schemas, validates the request and rate-limits per IP. It stores and logs nothing.
* Safeguards in the browser: at most 3 tool calls per question; every number in the reply must appear in a tool result (one rewrite is requested, otherwise the reply is replaced by the no-data message); no tool result or no matching tool gives **"Currently no such data is present in the dashboard."** with the reason; Groq rate limit gives a "busy, try again in a minute" message; any other failure falls back to the existing offline rule-based assistant. Each answer shows period, scope, source and the figures used.
* The panel text now says the AI only reads out figures the dashboard calculates.

**Checked here (no access to Groq or a key):** a scripted stand-in for the model exercised the whole loop in a browser: correct tool figures (e.g. 29 / 34 valid orders, 59 issues / 22 open / 11 overdue, 29,679 Usage Report orders, 145 / 78 / 30 Bizom-DataSense people, 6,702 complaints, all matching an independent Python calculation), no-data cases (unknown dealer, August comparison, DataSense SKU, off-topic), a made-up number being blocked, rate limit, and fallback when the service is down; the Vercel function was unit-tested with a mocked Groq (validation, CORS, limits, errors). **Not tested:** real Groq calls and the model's choice of tools. `vercel/tests/questions.json` (30 questions) and `live_test.mjs` run them against the deployed dashboard.

**Limits.** Open models can choose a wrong tool; the number check and the no-data rule catch unsupported figures but not every poorly chosen question. Free-tier limits and the model name may change. The offline fallback has its old quirks (it can mistake some phrases for a dealer name). The dashboard file opened from disk uses only the offline assistant unless `localStorage.askApiUrl` is set.

## How the work was checked

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 206 tests pass (46 new for the growth model: windows and cut-off, same-days comparison, order counted once, classification and confidence, profitability detection, brief and assistant answers; before that 156: KPI formulas, ingest on the 17 real files, import session on IndexedDB, Excel/CSV writer, headline regression, 35 for the refinement: honest trends, key insights, 15-column comparison table, dealer profile, URL navigation, Hero Smiles change; 12 for the comparison rework: adoption weeks, order list and SAP flags, 9-of-11 matching, menu, insight visuals; and 12 for the filters: option building, the dealer scope, orders partitioned by dealer, the Dealer SFA role cut) |
| Production build | succeeds; `exceljs` is loaded only when an export is requested |
| Single-file HTML | opened from `file://`; routes, persistence, import wizard, export and mobile layout verified (section 8) |
| Real browser, real data | ZIP import through all 8 steps; persistence across fresh page loads; every route loads without console errors; all 17 exports download and open; remove / reset round trip; desktop, tablet and mobile layouts |
| Refinement pass in a real browser | `CRM_Tracker_Dashboard.html` from `file://` and the Netlify build served locally, at 1440 px and 390 px: every page, KPI-card and chart-bar click-through, dealer profile open / close / Back with filters kept, tab switching with two URL writes in one click, comparison table search / sort / scroll / profile open, Data Import, no console errors |
| Comparison and Overview rework in a real browser | `CRM_Tracker_Dashboard.html` from `file://` at 1440 px and 390 px: all 17 Overview tiles and all 18 key-insight rows open the right page; every comparison card, scope tab, table row (including dealers 3167, 3117, 12186, 19601), weekly chart bar and order row; Bizom vs Dealer SFA cards, chart bars, month rows and mapping tab; the Issue Tracker menu entry and the old URL redirect; no console errors and no horizontal overflow on mobile |
| Header and filters in a real browser | `CRM_Tracker_Dashboard.html` from `file://` at 1440 px and 390 px: header layout (title left, Import right, Import opens Data Import); all 11 filtered pages: every one of the 56 controls was set, checked against the address, the cards and the search box; two controls combined; Clear all; Overview dealer filter (tiles, links, Hero Smiles, not-per-dealer tiles); the dropdown stays on screen from the right-hand cell on a phone; no console errors and no horizontal overflow |
| MBD and removals in a real browser | `CRM_Tracker_Dashboard.html` from `file://` at 1440 px and 390 px (Chromium only): Data Import without the embedded / reset section; Bizom vs Dealer SFA without the mapping tab; Dealer App orders MBD card 14.1, Model and Wheel size filters (chosen from the dropdown and by address), model slice note and re-counted cards, Models tab, dealer-table MBD column, Models column in the order list; DataSense orders unchanged; Overview tile 14.1 and 36.0 when narrowed to Jitesh Traders; no horizontal overflow and no console errors |
| Growth upgrade in a real browser | `CRM_Tracker_Dashboard.html` from `file://` at 1440 px and 390 px (Chromium only): the app opens on the comparison page and the Overview is second; every tab; period and comparison choices; multi-select filters (dealer, DB code, outlet, zone, city, channel, model, wheel size) update cards, charts and tables; dealer-table and chart clicks open the dealer profile with its growth block; assistant (suggested questions, filter-aware answers, links, Escape, no network request, mobile layout); executive and comparison downloads follow the filters; **weekly ZIP import**: the same 17 files are all skipped (no duplicates, figures unchanged), and a ZIP with a changed Dealer App export replaces only that file (375 → 377 rows) and moves the headline by exactly the two added orders (₹46.03 L → ₹46.26 L), importing it again changes nothing; no console errors, no horizontal overflow |
