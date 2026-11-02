# CRM Tracker – KPI glossary

Every figure in CRM Tracker is calculated in the browser from the files you import. This page gives the **exact
formula, the exclusions and the page where it appears** for each measure. The same formulas are written beside
each number in the app (click the **?** on a KPI card) and in the *Formula* column of the KPI summary export.

Conventions used everywhere

| Rule | Meaning |
|---|---|
| **Blank is not zero** | A blank or unreadable number is *unknown*. It is never added as 0, and averages divide only by populated values. |
| **No silent drops** | For every file the app reports *rows read = kept + duplicates removed + invalid + totals row set aside*. Flagged rows are kept and counted. |
| **Unavailable ≠ zero** | If a source cannot support a measure (for example complaint turnaround in the Dealer App export), the card says *Unavailable* and why. |
| **Systems are separate** | Dealer App, DataSense, Bizom and Hero Smiles figures are calculated on their own and are **never added together**. The one exception is the *combined* view on the first page (section 11), where an order that exists in both exports is counted once. |
| **Assumptions** | Defaults apply everywhere: rejected orders and test / service accounts are left out, the as-of date is today, low usage is 5 accesses or fewer, the Dealer App is the comparison baseline. There is no Settings or Data Quality screen. |
| **Honest changes** | A ▲/▼ change against an earlier period is shown only when the selected period is whole calendar months, the equally long period just before it exists in that source, and every month in both periods is complete (it ended on or before the as-of date and the file reaches within two days of the month end). Otherwise no change is shown. A percentage is never shown when the earlier value is 0. |
| **Indian formatting** | Amounts are shown in ₹ with lakh/crore grouping (₹45,54,965) and compact forms (₹45.55 L). |

Defaults: rejected orders **excluded** from value KPIs, test/service accounts **excluded**, as-of date = **today**
(26 Oct 2026 for the supplied files), low-usage threshold = **5** recorded accesses.

---

## 1. Orders – Dealer App

Source: `DealerAppOrders-*.csv`. The file is **SKU-line level** – one row per SKU on an order. `Amount` and
`Fulfilled_Amount` were checked and are **line** amounts (they differ between lines of one order), so:

* **Order** = distinct `Order_ID`. Lines are never counted as orders.
* **Order value** = Σ line `Amount` of the order.
* **Order status** = the most frequent status across the order's lines (a warning is raised when lines disagree).
* **Eligible order** = valid, order value > 0 and (unless *Include rejected* is on) status not *Rejected*.

| KPI | Exact formula | Excludes / notes | Pages |
|---|---|---|---|
| Valid orders (gross) | distinct `Order_ID` | any status, any value | Dealer App › Orders, Overview |
| SKU lines | rows kept from the export | exact duplicate lines are removed and counted | Dealer App › Orders |
| Eligible orders | distinct `Order_ID` with value > 0 and status ≠ Rejected | rejected, zero/blank-value orders | all order pages |
| Order value | Σ eligible orders' value | same | all order pages |
| Average order value (AOV) | order value ÷ eligible orders | same; `null` if no eligible orders | Dealer App › Orders, Comparison |
| Cycles quantity | Σ `Order_Quantity` of **cycle** lines (Category is blank or contains "cycle") of eligible orders | spares/accessory lines | Dealer App › Orders |
| Average selling price (ASP) | Σ cycle-line `Amount` ÷ Σ cycle `Order_Quantity` over eligible orders that have quantity > 0 | non-cycle lines | Dealer App › Orders, Comparison |
| Fulfilment rate | Σ `Fulfilled_Quantity` ÷ Σ `Order_Quantity` (cycles) over eligible orders whose fulfilled quantity is known | A blank fulfilled quantity is *unknown*, except on lines marked "Not Fulfilled" or on rejected orders (then 0). Orders with unknown fulfilled quantity are left out and counted. | Dealer App › Orders |
| Pending quantity | max(0, cycles quantity − fulfilled quantity) | | Dealer App › Orders |
| Rejected orders | distinct orders whose status is Rejected | | Dealer App › Orders, Overview |
| Rejection rate | rejected orders ÷ all valid orders | **No rejection reason exists in the export; none is invented.** | Dealer App › Orders, Overview |
| Active dealers | distinct `Outlet_ERP_ID` with an eligible order | orders without a dealer code are grouped by name and flagged | Dealer App › Orders |
| Orders per dealer | eligible orders ÷ active dealers | | Dealer App › Orders |
| Unique SKUs ordered | distinct SKU code over lines of eligible orders | | Dealer App › Orders |
| Orders with invoice | eligible orders having at least one line with an `Invoice_Id` | corrupted ids are kept and flagged (`SUSPICIOUS_ID`) | Dealer App › Orders |
| **MBD – models billed per dealer** | Σ over dealers of (distinct models with at least one billed line) ÷ dealers with an eligible order | see *Models and MBD* below | Dealer App › Orders & Performance, Overview |
| Models billed (per dealer) | distinct models with at least one billed line, for one dealer | a model ordered but not billed does not count | Dealer App › Orders (Dealers and Models tabs) |

### Models and MBD (Dealer App)

* **Model** = the `Sku_Brand` column exactly as the Dealer App records it (NEXT, STING, FAIRY …; 60 values in the supplied files). Names are not merged: *NEXT*, *NEXT SPORTS* and *NEXT T25* are three models, as they are in the file. A blank is shown as *Not specified*.
* **Billed line** = a line with an `Invoice_Id` **and** a `Fulfilled_Quantity` above zero. In the supplied files the two always go together (386 of 607 lines) and no rejected order carries an invoice.
* **MBD** = the dealers' counts of billed models added up ÷ the dealers that have at least one eligible order in the view. A dealer with an eligible order but nothing billed counts as 0; a dealer whose orders were all rejected is not in the view (so, for all dealers, Sept–Oct: 141 dealer–model pairs ÷ 10 dealers = **14.1**, over 56 distinct models; September 7.4, October 11.6).
* **Model filter** = slices the order **lines**. With a model (or wheel size) chosen, each order is rebuilt from only its lines of that model, so orders, order value, quantity, fulfilment, the dealer and model tables and MBD describe that model and not the whole basket. The other filters (status, zone, order size …) are judged on the whole order. With one model chosen MBD can only be 0 or 1 per dealer, so the card then reads as the share of dealers billed for that model.
* **Wheel size** = the size written in the SKU name (`24T` → 24 inch, `27.5T`, `29ER` → 29 inch, `55CM` → 55 cm frame; “Not stated” when the name has none; none of the supplied SKUs lacks one). The export has **no model category** (`Category` says *Cycles* on every line), so wheel size is the only grouping that can be read from the data; it is not a Hero product category. If Hero has a model → category list it can be added as a lookup.
* **Models table** (Models tab) per model: orders and dealers that ordered it, dealers billed, cycles ordered and billed (`Fulfilled_Quantity` of billed lines), order value and billed value (`Fulfilled_Amount` of billed lines), and the wheel sizes in its SKU names.

## 2. Orders – DataSense SFA

Source: `Order Punched Report- Datasense - aug to oct.xls` (an HTML table saved as .xls). One row per order
(**header level**). The report's own footer *Total* row is set aside and used for reconciliation (all five column
totals match the parsed rows).

| KPI | Exact formula | Excludes / notes | Pages |
|---|---|---|---|
| Valid orders | rows with an Order NO | footer Total row, duplicates | DataSense › Orders |
| Eligible orders | value of Order > 0 and status not *Rejected…* | rejected, zero-value | DataSense › Orders |
| Order value | Σ `value of Order` of eligible orders | | DataSense › Orders |
| AOV | order value ÷ eligible orders | | DataSense › Orders |
| Cycles quantity | Σ `Cycles volume` of eligible orders | | DataSense › Orders |
| ASP | Σ `Cycles value` ÷ Σ `Cycles volume` (orders with volume > 0) | | DataSense › Orders |
| Billed rate | eligible orders with status *Billing*, *Truckload* / *Delivery* (dispatch) ÷ eligible orders | **Status based. Not comparable with the Dealer App fulfilment rate (quantity based).** | DataSense › Orders |
| Rejected orders / rate | status starts with *Rejected* ; ÷ all valid orders | | DataSense › Orders |
| Active dealers | distinct dealer code (the `[code]` in *Dealer Name*) with an eligible order | orders without a code are flagged | DataSense › Orders |
| Status groups | Billing → billed; Truckload / Delivery → dispatch; Open / Pending → open; *SAP Order Not Created* → SAP pending; *Rejected…* → rejected; anything else → *Other* (shown, never guessed) | | DataSense › Orders |

## 3. Complaints (Dealer App and DataSense)

Sources: the two *Complaint Module Dump* workbooks. Statuses are mapped with the visible tables below; anything not
listed is shown as **Unmapped**, never guessed.

| Source status | Group |
|---|---|
| Dealer App: Closed, Resolved | Closed |
| Dealer App: Assigned, Pending | Pending |
| Dealer App: Open, New | Open |
| Dealer App: In progress | In process |
| Dealer App: Escalated / Rejected | Escalated / Rejected |
| DataSense: Ticket Generate | Open |
| DataSense: Process, Change Department | In process |
| DataSense: Closed / Rejected | Closed / Rejected |

| KPI | Exact formula | Excludes / notes |
|---|---|---|
| Complaints raised | distinct complaint ids | test records excluded by default (Dealer App has 1: description says "test") |
| Not closed (backlog) | status group is neither *Closed* nor *Rejected* | |
| Resolution rate | closed ÷ raised | |
| Age of an open complaint | as-of date − raised date (days) | uses the as-of date (today) |
| Open more than 30 days | open complaints aged > 30 days | |
| Age buckets | 0–7, 8–15, 16–30, 31–60, 60+ days | |
| Average / median turnaround | mean / median of TAT minutes ÷ 60 over **closed** complaints with a TAT. TAT comes from the *TAT* column; if that is blank it is the difference between closed and raised dates (flagged as date-based) | **Dealer App: unavailable** – the export has no TAT or closed date. |
| Dealers affected / repeat dealers | distinct dealer codes with ≥ 1 / > 1 complaints | complaints without a dealer code are counted separately |

## 4. Bizom SFA – MIS usage

Source: `MIS usage report` CSVs (one per month; the month comes from the file name). `Access_Count` is the number of
**recorded report accesses** – *not* downloads, and not evidence of business value.

| KPI | Exact formula | Excludes / notes |
|---|---|---|
| Recorded report accesses | Σ `Access_Count` | rows with a blank/non-numeric count are set aside (blank ≠ 0); test/service accounts excluded by default |
| Users with an access | distinct `User_ID` with Access_Count > 0 | |
| Reports accessed | distinct report with Access_Count > 0 | |
| Average accesses per user | accesses ÷ users | |
| Top-5 report share | accesses of the 5 most-accessed reports ÷ all accesses | |
| Single-user reports | reports accessed by exactly one distinct user | |
| Low-usage reports | reports with total accesses ≤ threshold (default 5) | threshold is a setting |
| Field-staff share | accesses by *Field staff* ÷ all accesses | *Distributor* and *Company / admin* accounts are classified from the designation |
| Test / service account | name starts `Hero.`, contains "maintain", starts with "test", or zone contains "Hero Cycle Zone" | rows are kept, flagged, excluded from KPIs |

## 5. Bizom SFA – issue tracker

Source: `Issue_Tracker.xlsx` (header on row 2, *Tracker* sheet). The tracker is a point-in-time list and is **not
period filtered**.

| KPI | Exact formula | Notes |
|---|---|---|
| Items | tracker rows | Dashboard-sheet totals are compared with the Tracker rows (one mismatch is reported) |
| Resolved | status *Completed* | |
| Open | status not *Completed* | statuses map: In Progress / Demo-UAT / Feasibility Check → in progress; Awaiting Hero Input / Not Started / On hold → waiting |
| Resolution rate | resolved ÷ items | |
| Overdue | open **and** target is a real date **and** target < as-of date | targets such as "Pending" or "TBD" are *target unknown*, never overdue |
| Due in next 14 days | open, real target date between as-of date and as-of + 14 days | |
| Target unknown (open) | open items without a usable date | |
| P1 open / overdue | same rules restricted to priority P1 | priority comes from the unnamed third column (P1–P3) |
| Not available | owner, created date, resolved date, ageing and resolution time | the tracker has none of these columns |

## 6. DataSense SFA – employee activity

Source: `Employee-daily-activities-…csv` (monthly totals per employee; footer **TOTAL** row set aside and reconciled).

| KPI | Exact formula | Notes |
|---|---|---|
| Employees | distinct employee | rows whose name contains "test" excluded by default |
| Visits / Orders / Complaints / Tours | Σ `VISITED` / `ORDER` / `COMPLAINT` / `TOUR` | |
| Orders per visit | Σ orders ÷ Σ visits | visits = 0 → unavailable |
| Visits / orders per employee | Σ ÷ distinct employees | |
| Average market coverage | mean of populated `MKT COVERAGE` values | |
| Zero-visit / zero-order employees | employees whose summed visits / orders are 0 | may mean leave, role or unmapped login; the data cannot say |
| Orders exceed visits | employee-months where orders > visits | data-quality flag (`ORDERS_EXCEED_VISITS`) |
| Expenses | shown only if any value ≠ 0 | otherwise *Unavailable – column not populated* |

These files are the **Dealer SFA's usage** (confirmed by the business): the *Bizom SFA vs Dealer SFA* page measures the
Dealer SFA with this employee daily-activity report and Bizom with the MIS usage report. Employees are linked across
the two by month and by group (zone, designation, role); there is no shared employee ID, so people are not paired across
the two reports. A dedicated `dealer_sfa_activity` file, when one is imported, takes priority.

## 7. Hero Smiles (Capillary)

Source: five point-in-time snapshots. **Snapshot date = date in the file name** (documented inference; the year is
inferred from the current date). Join key = `customer_external_ID`, which equals the Outlet ERP ID / DataSense dealer
code. The ID `NOT-CAPTURED` is *unverified* and never joined. Mobile numbers are masked (`XXXXXX1234`).

| KPI | Exact formula | Notes |
|---|---|---|
| Members | rows in one snapshot | |
| Members with a balance | rows with `Current_Points` > 0 | |
| Current points | Σ `Current_Points` **of one snapshot** | **Balances are point-in-time and are never added across snapshots.** |
| Lifetime points | Σ `lifetime_points` of one snapshot | |
| Change between snapshots | per dealer: current(to) − current(from), same for lifetime | only dealers with a verified id in both snapshots |
| Anomalies | lifetime decreased; opening ≠ previous closing; balance ≠ opening + issued − expired + adjustment; unverified id | |
| Change since the previous snapshot (Overall Summary / Hero Smiles) | total current points of the latest valid snapshot − total of the one before it | a difference of two point-in-time totals, never a sum. It is only a like-for-like change when both files list the same members (the 19 and 26 Oct files both list 24 members, 22 with a dealer code) |
| Smile Quiz Points | **unavailable** | the Capillary export has no quiz-points field; `Current_Points` is never substituted for it |

## 8. Dealer App vs DataSense SFA: comparison table and adoption

* **Compared months** = months present in *both* systems (Sep–Oct 2026; DataSense also has August, which the Dealer
  App export does not, so August is excluded from the comparison).
* **Matching** is on the validated ERP dealer code (`Outlet_ERP_ID` = the `[code]` in DataSense). **Names are never
  used to merge.** Dealers with identical names but different codes are listed as *name-only candidates* for manual
  review and are not merged until you accept them (decisions are stored in this browser).
* **Difference** = DataSense − Dealer App (or the reverse when you change the baseline). Percentage = difference ÷
  baseline; blank when the baseline is 0 or unknown.
* Fulfilment (Dealer App, quantity based) and billed rate (DataSense, status based) are shown separately and labelled
  *not comparable*.
* **Which system a dealer orders through** – the project brief says all 11 Dealer App dealers are in both systems; what
  differs is where they place orders, so the groups are decided by orders (any status) in the compared months
  (Sep–Oct 2026, the page says “Data from Sept to Oct”), matched on the validated ERP code:
  *ordering in both* = at least one Dealer App order and one DataSense order in those months (8 of the 11);
  *orders only via the Dealer App* = Dealer App orders but no DataSense order in those months (3 of the 11: Nanaksar
  Bikes 3117, Just Bicycle and Assessories 3167, Upper Assam Cycle Co. 12186);
  *DataSense only* = DataSense orders from a dealer that is not on the Dealer App.
  Counts, quantities and values use eligible orders in the compared months only.
  A dealer in the *orders only via the Dealer App* group shows **0** (not a dash) for its DataSense orders, quantity,
  value and average order value, with the note “Orders only placed through Dealer App”, because it recorded no order
  there. Smile Quiz Points stays “—” (not in the export). A dealer whose orders in one system were all rejected shows 0
  orders and a blank average order value, with the note “… orders were all rejected”.
  The “common dealers” totals in the exports cover the 8 dealers ordering in both systems.
* **Dealers on the Dealer App** = distinct dealers with an order of any status in the period (a dealer whose orders were
  all rejected has still started to use the app).
* **Adoption weeks** = Monday-to-Sunday weeks from the week of the first Dealer App order; a week is shown only when it
  ends on or before the latest DataSense order date. *Placed an order so far* counts a dealer from its first order of any
  status; *ordering that week* counts dealers with an eligible order in the week; orders and value count eligible orders.
  DataSense figures are for the same dealers. The two systems are never added.
* **Order list** = every order of the Dealer App dealers in both systems for the compared months, with its SAP order number.

### The grouped comparison table (15 columns)

| # | Column | Group | Formula |
|--:|---|---|---|
| 1 | Outlet ID | Dealer | Dealer App `Outlet_ID` |
| 2 | DB Code | Dealer | validated ERP dealer code (`Outlet_ERP_ID` = DataSense `[code]`) |
| 3 | DB Name | Dealer | Dealer App outlet name, else the DataSense dealer name |
| 4–8 | Sales App Complaint Count / Order Count / Total Qty / Total Value / Avrg Order Value | **Sales App = DataSense SFA** (light blue) | distinct complaint ids; eligible orders; cycles quantity; Σ order value; value ÷ eligible orders |
| 9–13 | Dealer App Complaint Count / Order Count / Total Qty / Total Value / Avrg Order Value | **Bizom App = Dealer App** (light green) | distinct complaint ids; distinct eligible `Order_ID`s (never SKU lines); Σ line amounts of eligible orders; value ÷ eligible orders |
| 14 | Capillary Smile Quiz Points | Capillary (light yellow) | **unavailable** – no such field in the export; shown as “—” |
| 15 | Capillary Current Total Points | Capillary (light yellow) | `Current_Points` from the latest valid snapshot (one snapshot, so the total row can add them) |

The Total row adds counts, quantities, values and points and recomputes the average order value as total value ÷ total
orders (0 when the rows shown have no orders). A dash means unavailable, not zero; the only exception is the DataSense side
of a dealer that orders only through the Dealer App, which is a recorded 0 (see above). The Excel/CSV download has the same 15
columns and Total row.

## 9. Data quality and reconciliation

| Measure | Formula |
|---|---|
| Rows read | rows in the data sheet (title rows and fully blank rows are skipped and counted) |
| Kept | rows turned into analysis records |
| Duplicates | exact duplicate rows removed (DataSense orders: same Order NO and content) |
| Invalid | rows without a usable key or numeric (e.g. no Order_ID) |
| Totals row set aside | report footer *Total* rows, used only for reconciliation |
| Flagged | kept rows that carry at least one warning |
| Reconciliation | the report's printed total vs the parsed total; match when the difference is ≤ 1 |

Issue codes are shown with plain-language explanations in the import wizard's Validate step.

## 10. Filters

| Item | Rule |
|---|---|
| Choices offered | Only values that exist in the page’s own records for the selected period. A control with a single choice is hidden unless that choice is already applied. |
| Number beside a choice | Records on that page: orders placed (rejected orders included on the order pages), complaints, members. It is not an eligible-order count and is never a sum across systems. Bizom usage rows are user–report–month rows, so no number is shown. |
| Filter and chart click | Both write the same address filter (`f.<field>`), so the control, the chart highlight, the KPI cards and the table always agree. One value per field; choosing a value again from a chart clears it. |
| Dealer App › Orders | Besides status, month, zone, city, dealer and order size, **Model** and **Wheel size** slice the order lines (see *Models and MBD*); their numbers count the orders that contain the model or size. |
| Hero Smiles | Filters narrow the member list. Points are balances on the chosen snapshot date and are never added across snapshots. |
| Dealer App vs DataSense SFA (comparison table and adoption charts) | The dealer filters also narrow the comparison table; the adoption charts always cover every Dealer App dealer over all imported data. |
| Bizom vs Dealer SFA | Zone and designation narrow the Bizom side; role narrows the Dealer SFA side; both sides stay in the same months. |
| Overall Summary – dealer | Narrows to one validated ERP dealer code: Dealer App and DataSense orders, complaints in both systems, Hero Smiles balance. Bizom usage, the Issue Tracker and employee activity are not recorded per dealer and are shown as “not per dealer”, never as 0. Dealer App and DataSense figures are still never added together. |

---

## 11. Growth and channel comparison (the first page, *Dealer App vs DataSense SFA*)

The question this page answers: *is the Dealer App adding business, or only moving it from one channel to another?* It
is built on the same order roll-ups as the Dealer App and DataSense pages, so every number can be traced to a detail page.

| Item | Rule |
|---|---|
| Windows | Two explicit date windows of the **same length and the same days of the month**. The data cut-off is the last day **both** order exports reach (the earlier of the two last order dates; 21 Oct 2026 on the supplied files). A month the cut-off cuts short is “month to date”, and the default comparison is the same number of days of the previous month (1–21 Oct against 1–21 Sep). Other choices: previous period of the same length, a named earlier month (same days), no comparison, custom ranges. Both end dates are included. |
| Eligible order | One row per Order ID (Dealer App) or per order (DataSense), value above zero and not rejected (the *Include rejected* setting is honoured). |
| Dealers in view | **Dealer App dealers** (the 11 with a Dealer App order, default) or **all dealers**; or any dealers chosen in the filters. Matching is by validated ERP code only; names never merge dealers. |
| Combined value / orders / cycles | Dealer App + DataSense, **each order counted once**: a DataSense order whose order number or SAP number equals that of a Dealer App order of the *same* dealer is the same order and is counted as Dealer App. Dealer App and DataSense totals are otherwise never added. |
| Value growth | (combined value, reporting − comparison) ÷ comparison. Blank when the comparison is 0. Volume growth is the same for cycles. |
| Order value, order count, cycles | Per channel, per window, with the change in units and in %. “Gap” = Dealer App − DataSense in the reporting window. |
| Average order value | Value ÷ eligible orders. Average selling price = value ÷ cycles. Both are dashes when the divisor is 0. |
| Active dealers | Dealers with at least one eligible order in the window, per channel. |
| Ordering in both channels | Dealers with an eligible order in **both** channels in the window ÷ dealers active in either. |
| Dealer App adoption | Dealers active on the Dealer App ÷ dealers active in either channel, in the window. |
| Rejection rate | Rejected orders ÷ all orders placed (rejected + eligible), per channel. |
| Fulfilment | Dealer App: fulfilled ÷ ordered quantity. DataSense: share of orders billed / dispatched. |
| Complaint rate | Distinct complaints raised in the window ÷ eligible orders. It is a dash when the complaint export does not cover the whole window (never 0). |
| Colour of a change | Polarity-aware: green is good for value, orders, cycles, adoption, fulfilment; green is a **fall** in rejection rate and complaint rate. A change under ±2 % is “flat” (amber). A Dealer App change measured against days before its launch (9 Sep), or a rate measured on fewer than 10 orders in either window, is tagged *indicative* and is never coloured green or red. |

### Dealer classes

Every dealer is put in one class from its change in **combined** value (±10 % threshold):

| Class | Rule |
|---|---|
| **Incremental growth** | Combined value up by 10 % or more. |
| **Channel migration** | Combined value within ±10 %, Dealer App up and DataSense down, and the DataSense fall offsets 50–200 % of the Dealer App gain. |
| **Declining** | Combined value down by 10 % or more, or no orders in the reporting window. |
| **Stable** | Combined value within ±10 % otherwise. |
| **Insufficient data** | No comparison period, or no orders in the comparison period (new, returning or not yet active). The evidence line gives the last earlier order date. |

Each class carries a plain-language evidence line (Dealer App change, DataSense change, combined change) and a
**confidence**: *inconclusive* when the comparison had fewer than 3 combined orders, the window was shorter than
14 days, or the Dealer App was not live for the whole comparison period; otherwise *indicative*. The classes are
estimates from order values. **They are never proof that the Dealer App caused a change** and the page says so. A
**benchmark** compares the pilot dealers (Dealer App users) with all other dealers over the same two windows; it is
context, not a control group.

### Profitability (not verified)

Profit needs cost. The page scans the column headers of every imported file for cost, margin, discount, return,
freight, incentive or contribution fields. **None exists in the supplied files**, so the page shows *Not verified*,
lists what is missing (cost of goods per SKU, discounts and schemes, returns and credit notes, freight, incentives,
channel cost to serve) and shows only the proxies that are in the data (sales value, quantity, order frequency,
order value, selling price, fulfilment, rejection). Order value is **sales**, never profit; no margin is estimated.
If a file with a cost or margin column is imported later, the page detects it and says which column it found.

### MBD on this page

MBD (models billed per dealer) is the definition in *Models and MBD* above, shown for the reporting window with its
change from the comparison window. DataSense has no model data, so there is no DataSense MBD, and choosing a Model or
Wheel size filter slices the Dealer App side only and leaves DataSense out.

### Executive brief and assistant

* **Overall Summary brief** – three to five takeaways, the key risks and the recommended actions, all derived from
  the growth model above and the complaint / import facts (each card names its figure, its period and a link to the
  records). Nothing is typed by hand.
* **Data assistant** – a floating panel that answers from the data in the browser with a rule-based question matcher
  (growth, channels, a named dealer, complaints, adoption, MBD, profitability, definitions). It follows the periods and
  filters on screen, shows the figures, period and dealers behind each answer, and links to the records. It is **not a
  generative AI model**: it sends nothing anywhere, uses no API key, and says so when it cannot answer. The dashboard
  works the same without it.


## 12. Landing page: Dealer App vs DataSense SFA (29 Oct 2026)

Scope: the dealers that have Dealer App orders (11), matched to DataSense on the ERP dealer code. Same dates on both channels: from the Dealer App launch
date to the end of the first month (9–30 Sep) and 1 Oct to the last day of the Dealer App export (21 Oct).

| # | KPI | Formula | Exclusions / notes |
|---|---|---|---|
| 12.1 | Submitted orders | Distinct orders of any status. Dealer App: Order ID (SKU lines rolled up). DataSense: Order NO | Footer total rows; DataSense records that duplicate a Dealer App order (same dealer, same SAP number) |
| 12.2 | Rejected orders / rejection rate | Dealer App status Rejected; DataSense Rejected by ASM or SAP. Rate = rejected ÷ submitted | – |
| 12.3 | Net valid orders | Submitted − rejected − orders with value ≤ 0 | DataSense "SAP Order Not Created" counted as valid (as on the DataSense Orders page), noted on the card |
| 12.4 | Order value | Valid orders: Dealer App sum of line amounts; DataSense "value of Order" | Sales value, not profit |
| 12.5 | Quantity / value per cycle | Cycles on valid orders; cycles value ÷ cycles quantity on valid orders with a quantity | Spares excluded |
| 12.6 | AOV | Order value ÷ valid orders | – |
| 12.7 | Active dealers / adoption | Dealers with ≥ 1 valid order on the channel in the period | A dealer with only rejected submissions is not active |
| 12.8 | Dealer App share of comparable orders | App valid ÷ (app valid + DataSense valid); value share likewise | Duplicates counted once |
| 12.9 | Usage Report (DataSense) | Orders recorded per platform. SFA = Mobile + Web; Old App = manual SAP. Net valid = total − archived − rejected (ASM, SAP, SAP order not created). Valid SFA = SFA − SFA archived − SFA rejected | Reproduces the file's Summary sheet (29,679 / 22,404 / 7,275 / 15,390 / 13,796 / 13,246 / 1,043). SFA rejection rate here = SFA rejections ÷ SFA orders (4.24%); the file's 4.66% divides all rejections by SFA orders. Counts are orders, not report accesses |
| 12.10 | Percentage change | (to − from) ÷ from | Not calculated from a zero or missing base: shown as "new" / "n/a" |
| 12.11 | Models (MBD) | Dealer App only. Model = Sku_Brand. MBD = distinct billed models ÷ dealers with a valid order in the month. Billed = invoice exists and fulfilled quantity > 0 | DataSense has no model or SKU |

### Dealer signals (thresholds in `model.ts`, `T`)
High app adoption: ≥ 2 valid app orders and ≥ 70% of the dealer's valid orders. Rising: more valid app orders in October than September (≥ 2).
Low / none: ≤ 1 valid app order. High rejection: ≥ 20% of ≥ 3 app submissions. Mostly DataSense: more valid DataSense than app orders.
Combined up / down: combined valid value moved ≥ 10% on a September base of ≥ 3 valid orders.

### Observed patterns (not causation)
Combined growth / decline: ±10% on combined value. Possible channel migration: app value up, DataSense value down by 0.5–2× as much, combined within ±10%.
Insufficient evidence: fewer than 3 valid orders in the base month, or no baseline. Also flagged: app orders up while DataSense down; app submissions up with
under 50% valid.

### 12b. Added in landing page v2
| KPI | Formula | Notes |
|---|---|---|
| Rejected orders and rate (one card) | Rejected orders; rate = rejected ÷ submitted; difference shown in percentage points | Lower is better |
| MBD (comparison card) | Distinct billed models ÷ dealers with a valid order in the month, September and October | Dealer App only; DataSense shown as n/a (no model on the order) |
| Who leads | Each channel's share of the two combined (orders, value, quantity, AOV, value per cycle, active dealers); for rejection rate the lower rate leads | Bar only; differences in % (rate in points) |
| Movement tiles | October vs September per channel; green = better, red = worse; changes under 0.5% shown as flat | No percentage from a zero base ("new") |
| Dealers by channel used | Both = valid orders on both channels; app only; DataSense only; neither | Valid orders in the period |
| Order activity timeline | One mark per order on its date; size by order value; ✕ rejected; bar spans first to last order | Same dates for both channels |

### 12c. Landing page v3
Visuals added in v2 for Key takeaways (who leads, donuts, timeline, channel mix, value drivers) were removed. The movement tiles (12b) now sit directly under the core comparison.
Adoption, Dealer App share of comparable orders (valid app orders ÷ app + DataSense valid orders), dealers by channel used, MBD, ordered vs billed and rejected Dealer App
orders keep the definitions in 12.7, 12.8 and 12.11 and are shown inside popups only.

## 13. Bizom SFA vs DataSense SFA Usage (29 Oct 2026)
Months compared: those present in both sources (Aug–Oct 2026). Filters: month, zone, Bizom account type.
| KPI | Formula | Notes |
|---|---|---|
| Active people (Bizom) | Distinct users with at least one report access in the selected months | Test/service accounts excluded |
| Active people (DataSense) | Distinct employees who punched at least one order in the Usage Report | |
| Activity recorded | Bizom: sum of report accesses. DataSense: orders recorded (one per row of the Usage Report) | Different units; never added or divided |
| Per active person | Accesses ÷ active users; orders ÷ active employees | |
| Breadth | Bizom: distinct reports with an access. DataSense: SFA (Mobile + Web) orders ÷ orders recorded | |
| People in both systems | Same person name (letters only, case-insensitive) active in both | No shared ID; 30 matched |
| Zone | Bizom zone and DataSense zone grouped to East, North, South, West, Other | |

### Landing page Trends (updated 12b)
Valid orders, order value, quantity, AOV, active dealers and rejection rate by month for the dealers in view. DataSense: April–October (full months Apr–Aug; Sep 9–30 and Oct 1–21). Dealer App: September and October only. DataSense orders that duplicate a Dealer App order are counted once as Dealer App.
