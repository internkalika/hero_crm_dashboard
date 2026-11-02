# Source files → canonical fields → dashboards

This document is generated from the same source registry the app uses (`src/lib/ingest/sources.ts`), so the column
names and accepted spellings below are exactly what the importer matches. Matching ignores case, spaces and
punctuation. In the **Map** step of *Data Import* every canonical field can be re-pointed to a different
column; fields marked **required** must be mapped before a file can be imported.

## How a file becomes a dashboard

1. **Upload** – CSV, XLS (including HTML tables saved as .xls), XLSX, folder or ZIP are read in the browser (a web worker).
2. **Identify** – each sheet is scored against every registered source (matched required columns, header signature, file-name hints). Ambiguous files must be confirmed by you.
3. **Preview → Validate → Map** – raw rows are normalised into canonical records; duplicates, invalid rows, footer totals and flags are counted.
4. **Reconcile** – parsed totals are compared with totals printed in the files; dealer-matching consequences are shown.
5. **Refresh → Confirm** – *add / replace / merge / skip* per file; the result is stored in the browser's IndexedDB. Dashboards read only from storage.

The raw rows are stored untouched beside the canonical records, so every figure can be traced back to a source row.

## Files detected in the supplied package (17 files → 17 datasets)

| Dataset | Source file | Sheet read | Period | Rows read | Kept | Duplicates | Invalid | Totals row set aside | Flagged |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| `dealer_orders:2026-09` | DealerAppOrders-SEPT.csv | CSV | 2026-09 | 232 | 232 | 0 | 0 | 0 | 1 |
| `dealer_orders:2026-10` | DealerAppOrders-oct.csv | CSV | 2026-10 | 375 | 375 | 0 | 0 | 0 | 0 |
| `dealer_complaints:all` | Complaint Module Dump- Dealer App - 26 Oct.xlsx | (Hero)(Ticket Listing)(26-10-20 | 2026-10-01 to 2026-10-25 | 7 | 7 | 0 | 0 | 0 | 2 |
| `bizom_usage:2026-08` | MIS_usage_report_bizom-aug.csv | CSV | 2026-08 | 610 | 610 | 0 | 0 | 0 | 0 |
| `bizom_usage:2026-09` | MISUsagereport-Bizom-sept.csv | CSV | 2026-09 | 565 | 565 | 0 | 0 | 0 | 0 |
| `bizom_usage:2026-10` | MISUsagereport-Bizom-Oct.csv | CSV | 2026-10 | 575 | 575 | 0 | 0 | 0 | 0 |
| `issue_tracker:all` | Issue_Tracker.xlsx | Tracker | 2026-10-07 to 2026-10-13 | 57 | 57 | 0 | 0 | 0 | 1 |
| `ds_orders:all` | Order Punched Report- Datasense - aug to oct.xls | HTML table | 2026-08-01 to 2026-10-26 | 5,908 | 5,907 | 0 | 0 | 1 | 135 |
| `ds_complaints:all` | Complaint Module Dump- Datasense - 26 Oct.xlsx | Sheet1 | 2026-09-01 to 2026-10-26 | 1,776 | 1,776 | 0 | 0 | 0 | 1 |
| `ds_employee_activity:2026-09` | Employee-daily-activities-datasense-sept.csv | CSV | 2026-09 | 73 | 72 | 0 | 0 | 1 | 0 |
| `ds_employee_activity:2026-10` | Employee-daily-activities- Datasense-oct.csv | CSV | 2026-10 | 73 | 72 | 0 | 0 | 1 | 0 |
| `loyalty_snapshot:2026-09-28` | CAPILLARY_HERO_EARNING_28 sept.csv | CSV | 2026-09-28 | 14 | 14 | 0 | 0 | 0 | 2 |
| `loyalty_snapshot:2026-10-05` | CAPILLARY_HERO_EARNING_05Oct.csv | CSV | 2026-10-05 | 13 | 13 | 0 | 0 | 0 | 1 |
| `loyalty_snapshot:2026-10-13` | CAPILLARY_HERO_EARNING_13oct.csv | CSV | 2026-10-13 | 14 | 14 | 0 | 0 | 0 | 1 |
| `loyalty_snapshot:2026-10-19` | CAPILLARY_HERO_EARNING_19Oct.csv | CSV | 2026-10-19 | 24 | 24 | 0 | 0 | 0 | 1 |
| `loyalty_snapshot:2026-10-26` | CAPILLARY_HERO_EARNING_26Oct.csv | CSV | 2026-10-26 | 24 | 24 | 0 | 0 | 0 | 1 |
| `focus_liquidation:all` | Focus & Liquidation - datasense.xlsx | 1010, 1054, 1020, 1051, 1052, 1056 | — | 11,662 | 11,662 | 0 | 0 | 0 | 0 |

Rows read = kept + duplicates + invalid + totals row set aside, for every file. Nothing is dropped silently. The Focus & Liquidation workbook holds six plant sheets that are all read (the *Period* column is blank because it has no dates).

## Dealer App orders

*Dealer App · refresh pattern: monthly* — SKU-level order lines exported monthly from the Dealer App (Bizom).

Expected file(s): `DealerAppOrders-SEPT.csv`; `DealerAppOrders-oct.csv`

**Feeds:** Dealer App › Orders & Performance (including the Model filter and MBD); Overview; Comparison (Dealer App vs DataSense)

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `zone` | Zone |  | `Zone` |
| `city` | City |  | `City` |
| `warehouse` | Warehouse |  | `Mapped_Warehouse_Name` |
| `outletId` | Outlet ID | yes | `Outlet_ID` |
| `outletName` | Outlet name | yes | `Outlet_Name` |
| `erpId` | Outlet ERP ID | yes | `Outlet_ERP_ID`, `ERP_ID`, `Dealer_Code` |
| `beat` | Beat |  | `Beat` |
| `sku` | SKU |  | `SKU`, `SKU_Name` |
| `skuId` | SKU ID |  | `SKU_ID` |
| `skuCode` | SKU code |  | `SKU_Code` |
| `brand` | Brand |  | `Sku_Brand`, `Brand` |
| `category` | Category |  | `Category` |
| `orderId` | Order ID | yes | `Order_ID` |
| `sapOrderId` | SAP order ID |  | `SAP_Order_ID` |
| `orderDate` | Order date | yes | `Order_Date` |
| `status` | Order status | yes | `Order_Status` |
| `qty` | Order quantity | yes | `Order_Quantity`, `Quantity` |
| `unitPrice` | Unit price |  | `Unitprice`, `Unit_Price` |
| `amount` | Amount | yes | `Amount` |
| `invoiceId` | Invoice ID |  | `Invoice_Id` |
| `invoiceDate` | Invoice date |  | `Invoice_Date` |
| `fulfilledAmount` | Fulfilled amount |  | `Fulfilled_Amount` |
| `fulfilledDate` | Fulfilled date |  | `Fulfilled_Date` |
| `fulfilledQty` | Fulfilled quantity |  | `Fulfilled_Quantity` |
| `lineStatus` | SKU-wise fulfilled status |  | `Sku_Wise_Fulfilled_Status` |

Columns in the supplied files that are **not** mapped to a canonical field (kept in the raw rows, not used by any KPI): `Distributor_Bill_No`, `Invoice_Time`, `Mapped_Warehouse_ID`, `Order_Time`, `Outlet_Type`, `User_Name`.

**Reading notes**

* SKU-line grain; order = distinct `Order_ID`; order value = Σ line `Amount`.
* Two date styles are handled: `DD-MM-YYYY` in September and ISO (`YYYY-MM-DD`) in October. The order of day/month is decided by examining every value in the column, not the first row.
* `Invoice_Id` values containing separators (corrupted by spreadsheet formatting) are kept and flagged `SUSPICIOUS_ID`.
* Period (`YYYY-MM`) is taken from the dominant month of `Order_Date`; the file name is only a cross-check (`PERIOD_MISMATCH` if they disagree).
* Columns read but not used in a KPI: `Mapped_Warehouse_ID`, `Outlet_Type`, `User_Name`, `Order_Time`, `Distributor_Bill_No`, `Invoice_Time` (kept in the raw rows).
* There is **no rejection-reason column**; no reason is ever displayed.
* **Model** = `Sku_Brand` as recorded (60 values; variants such as *NEXT*, *NEXT SPORTS*, *NEXT T25* stay separate). `Category` is *Cycles* on every line, so there is no model category in the file. **Wheel size** is read from the SKU name (`24T`, `27.5T`, `29ER`, `55CM`). A line is **billed** when it has an `Invoice_Id` and a `Fulfilled_Quantity` above zero. These feed MBD (models billed per dealer); see `docs/KPI_GLOSSARY.md`.

## Dealer App complaints

*Dealer App · refresh pattern: single* — Complaint module ticket listing exported from the Dealer App.

Expected file(s): `Complaint Module Dump- Dealer App - 26 Oct.xlsx`

**Feeds:** Dealer App › Complaints; Overview; Comparison (complaints per dealer)

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `ticket` | Ticket number | yes | `Ticket Number` |
| `department` | Department |  | `Department` |
| `category` | Category |  | `Category` |
| `status` | Status | yes | `Status` |
| `raisedOn` | Ticket raised on | yes | `Ticket Raised on` |
| `subType` | Sub type |  | `Sub type`, `Subtype` |
| `description` | Description |  | `Description` |
| `assignedTo` | Assigned to |  | `Ticket Assigned To` |
| `dealerCode` | Dealer code | yes | `Dealer code`, `Dealer Code` |
| `dealerName` | Dealer name |  | `Dealer Name` |
| `assignmentLevel` | Assignment level |  | `Current Assigment Level`, `Current Assignment Level` |

Columns in the supplied files that are **not** mapped to a canonical field (kept in the raw rows, not used by any KPI): `Attachment`.

**Reading notes**

* The workbook sheet is named like a report title (`(Hero)(Ticket Listing)(26-10-20…`), so the sheet is chosen by its columns, not by name.
* The export has no resolution timestamp and no TAT: turnaround is **unavailable**. Age is measured from `Ticket Raised on` to the as-of date, which is the export date **2026-10-26 taken from the file name** (recorded as an inference).
* `Ticket Assigned To` is a numeric user id; no names are provided.
* `Attachment` is not mapped (no analytical use).
* Two of the seven tickets cannot be tied to an ERP dealer: one has a blank/0 dealer code (`MISSING_DEALER_KEY`) and one has a code that is not an ERP-style number (`SUSPICIOUS_ID`). They stay in the complaint counts and are excluded from per-dealer views.

## Bizom MIS usage

*Bizom SFA · refresh pattern: monthly* — Monthly Bizom report/dashboard access counts per user.

Expected file(s): `MIS_usage_report_bizom-aug.csv`; `MISUsagereport-Bizom-sept.csv`; `MISUsagereport-Bizom-Oct.csv`

**Feeds:** Bizom SFA › MIS Usage Analytics; Bizom SFA vs Dealer SFA Usage; Overview

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `zone` | Zone |  | `Zone` |
| `subzone` | Subzone |  | `Subzone` |
| `userId` | User ID | yes | `User_ID` |
| `loginName` | User name |  | `User_Name` |
| `designation` | Designation |  | `Designations`, `Designation` |
| `name` | Name | yes | `Name` |
| `roleId` | Role ID |  | `Role_id` |
| `reportId` | Report ID | yes | `Report_Id` |
| `reportName` | Report name | yes | `Report_Name` |
| `type` | Type |  | `Type` |
| `accessCount` | Access count | yes | `Access_Count` |

**Reading notes**

* Month comes from the file name (`aug`, `sept`, `Oct`), shown in the Identify step and editable.
* `Access_Count` = recorded report accesses (not downloads).
* Test / service accounts are flagged and excluded from KPIs by default.

## Bizom issue tracker

*Bizom SFA · refresh pattern: single* — Bizom/Hero pointer tracker with a status dashboard sheet.

Expected file(s): `Issue_Tracker.xlsx`

**Feeds:** Issue Tracker; Overview

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `pointer` | Pointer | yes | `Pointer`, `Issue` |
| `type` | Type |  | `Type` |
| `priority` | Priority |  | `Priority`, `Column C` |
| `platform` | Platform | yes | `Platform` |
| `status` | Status | yes | `Status` |
| `target` | Target date |  | `Target Date`, `Target` |

Columns in the supplied files that are **not** mapped to a canonical field (kept in the raw rows, not used by any KPI): `08.10.2026`, `09.10.2026`, `13.10.2026`, `16.10.2027`, `Latest Update - 07.10.2026`.

**Reading notes**

* Header is on sheet row 2; row 1 is a title. The *Dashboard* sheet is reconciled against the *Tracker* rows: its headline total (57) matches the tracker, but its platform table totals only 41 and looks stale (`DASHBOARD_MISMATCH`). CRM Tracker always recomputes from the Tracker rows.
* The third column has no header; it holds the priority (P1–P3). In 14 rows Type and Priority are in each other's columns; they are read the right way round and flagged (`COLUMNS_SWAPPED`). 16 rows hold "Completed"/"Ongoing" where a priority should be; they have no priority and the raw value is kept (`PRIORITY_COLUMN_MIXED`).
* Targets are parsed as real dates, text-dates (7 rows, e.g. `9th oct` → 2026-10-09, year assumed from the other targets – `TARGET_TEXT_DATE`) or non-dates (`Pending`, `TBD`). Only real dates can be overdue.
* `Latest Update – dd.mm.yyyy` columns become dated updates; the header dated `16.10.2027` is flagged `SUSPICIOUS_DATE` (probably a typo for 2026) and kept as written.
* Not in the source: owner, department, created date, resolved date. Ageing and resolution time are shown as unavailable.

## DataSense orders

*DataSense SFA · refresh pattern: range* — Order Punched Report (header level, one row per order).

Expected file(s): `Order Punched Report- Datasense - aug to oct.xls`

**Feeds:** DataSense SFA › Orders & Performance; Comparison; Overview

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `orderNo` | Order no | yes | `Order NO`, `Order No` |
| `orderDate` | Order date | yes | `Order Date` |
| `invoiceNo` | Invoice no |  | `Invoice NO`, `Invoice No` |
| `dealer` | Dealer name | yes | `Dealer Name` |
| `employee` | Employee name |  | `Employee Name` |
| `role` | Role |  | `Role` |
| `city` | City |  | `city`, `City` |
| `value` | Order value | yes | `value of Order`, `Order Value` |
| `cyclesQty` | Cycles volume |  | `Cycles volume` |
| `cyclesValue` | Cycles value |  | `Cycles value` |
| `sparesValue` | Spares value |  | `spares value` |
| `sparesQty` | Spares volume |  | `spares volume` |
| `status` | Status | yes | `Status` |

**Reading notes**

* The real format is an **HTML table with a .xls extension**; it is detected and read as such.
* Report title carries the range `01-08-2026 to 26-10-2026`; the footer *Total* row is set aside and reconciled (order value, cycles volume/value, spares volume/value).
* Dealer and employee codes come from the `[code]` suffix of the name fields. `Order NO` is either a 10-digit SAP number (`0030…`) or a 14-digit DataSense number; the SAP form is the one that can also appear in the Dealer App.
* `value of Order` is the order value. It can differ from Cycles + Spares value (other components); this is reported as information (`VALUE_DIFFERS_FROM_CYCLES_PLUS_SPARES`), not corrected.
* Zero-value orders are kept in the order list and excluded from value KPIs.

## DataSense complaints

*DataSense SFA · refresh pattern: single* — Complaint module dump from DataSense.

Expected file(s): `Complaint Module Dump- Datasense - 26 Oct.xlsx`

**Feeds:** DataSense SFA › Complaints; Comparison; Overview

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `caseRef` | Case reference number | yes | `Case Reference Number` |
| `date` | Complaint date | yes | `Complaint Date` |
| `createdBy` | Created by |  | `Created By` |
| `role` | Role |  | `Role` |
| `dealer` | Dealer name | yes | `Dealer Name` |
| `complaint` | Complaint type |  | `Complaint` |
| `department` | Department |  | `Department` |
| `ownership` | Ownership |  | `Ownership` |
| `invoiceNumber` | Invoice number |  | `Invoice Number` |
| `invoiceDate` | Invoice date |  | `Invoice Date` |
| `description` | Description |  | `Description` |
| `additional` | Additional information |  | `Additional Information` |
| `closedDate` | Complaint closed date |  | `Complaint Closed Date` |
| `tat` | TAT |  | `TAT (day/hr/min/sec)`, `TAT` |
| `status` | Status | yes | `Status` |

**Reading notes**

* Real range 2026-09-01 to 2026-10-26. The worksheet claims 10,43,711 rows but only 1,776 are populated; only populated rows are read and the difference is reported as `OVERSIZED_DIMENSION`.
* One case reference number is used by two different complaints (different dealers and descriptions); both are retained and flagged (`DUPLICATE_KEY`).
* Dealer code is read from the `[code]` in *Dealer Name*. `TAT (day/hr/min/sec)` is parsed to minutes.
* *Ownership* mixes functions and named individuals; it is classified, not discarded (`DEPARTMENT_FIELD_MIXED`).

## DataSense employee activity

*DataSense SFA · refresh pattern: monthly* — Monthly employee activity totals from DataSense (tours, visits, orders ...).

Expected file(s): `Employee-daily-activities-datasense-sept.csv`; `Employee-daily-activities- Datasense-oct.csv`

**Feeds:** DataSense SFA › Employee Activity; Bizom SFA vs Dealer SFA Usage (this report is the Dealer SFA's usage); Overview

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `employee` | Employee | yes | `EMPLOYEE` |
| `role` | Role | yes | `ROLE` |
| `mktCoverage` | Market coverage |  | `MKT COVERAGE` |
| `tour` | Tours |  | `TOUR` |
| `visited` | Visits | yes | `VISITED` |
| `orders` | Orders | yes | `ORDER` |
| `complaints` | Complaints |  | `COMPLAINT` |
| `expenses` | Expenses |  | `EXPENSES` |

**Reading notes**

* Monthly totals per employee; the month comes from the file name. The footer `TOTAL` row is set aside and reconciled to the sum of the employee rows.
* `EXPENSES` is zero for every employee in both files, so it is treated as *not captured* (`FIELD_NOT_POPULATED`), not as zero spend.
* This report is treated as the **Dealer SFA's usage** (confirmed by the business) on the Bizom SFA vs Dealer SFA page.

## Hero Smiles (Capillary) snapshot

*Hero Smiles · refresh pattern: snapshot* — Point-in-time dealer loyalty balances exported from Capillary.

Expected file(s): `CAPILLARY_HERO_EARNING_28 sept.csv`; `CAPILLARY_HERO_EARNING_05Oct.csv`; `CAPILLARY_HERO_EARNING_13oct.csv`; `CAPILLARY_HERO_EARNING_19Oct.csv`; `CAPILLARY_HERO_EARNING_26Oct.csv`

**Feeds:** Hero Smiles; Comparison (points per dealer); Overview

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `customerId` | Customer external ID | yes | `customer_external_ID` |
| `mobile` | Mobile |  | `mobile` |
| `firmName` | Firm name | yes | `firm_name` |
| `lifetime` | Lifetime points | yes | `lifetime_points` |
| `opening` | Opening balance |  | `opening_balance` |
| `issued` | Points issued |  | `Points_issued` |
| `expired` | Points expired |  | `Points_expired` |
| `adjustment` | Manual adjustment |  | `Points_manual_adjustment` |
| `current` | Current points | yes | `Current_Points` |

**Reading notes**

* Snapshot date = the date in the file name (`28 sept`, `05Oct`, `13oct`, `19Oct`, `26Oct`); the files have no date column. The year is the latest year that is not in the future. This is a documented inference shown in Data Import.
* `NOT-CAPTURED` (and `BIZON-D13` in the 28 Sept file) are *unverified* ids: never joined to dealers, never used in dealer rankings, counted in data quality (10 rows across the five files). One 28 Sept row also has a blank firm name.
* `mobile` is masked on screen and in exports. Joins use `customer_external_ID`, never the mobile number.
* `opening_balance`, `Points_issued`, `Points_expired` and `Points_manual_adjustment` are present, and every row satisfies opening + issued − expired + adjustment = current (no `BALANCE_MISMATCH`).

## Focus & Liquidation (DataSense)

*DataSense SFA · refresh pattern: single* — Plant-wise SKU focus/liquidation configuration and stock. Registered and preserved; not used in order KPIs.

Expected file(s): `Focus & Liquidation - datasense.xlsx`

**Feeds:** Registered and browsable in Data Import; **not** used in any order KPI

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `materialCode` | Material code | yes | `Material Code` |
| `description` | Description |  | `Description` |
| `brand` | Brand |  | `Brand` |
| `segment` | Segment |  | `Segment` |
| `plantCode` | Plant code | yes | `Plant Code` |
| `plantName` | Plant name |  | `Plant Name` |
| `status` | Status |  | `Status` |
| `focusStart` | Focus start |  | `Focus Start` |
| `focusEnd` | Focus end |  | `Focus End` |
| `liquidationStatus` | Liquidation status |  | `Liquation Status`, `Liquidation Status` |
| `skuStock` | SKU stock | yes | `SKU Stock` |

Columns in the supplied files that are **not** mapped to a canonical field (kept in the raw rows, not used by any KPI): `Body Size`, `Carrier`, `Chain Cover`, `Created Date`, `Last Updated`, `Launch Date`, `Model`, `Pack Size`, `Saddle`, `Speed`, `Stand`, `Tyre`.

**Reading notes**

* Six plant sheets (1010, 1054, 1020, 1051, 1052, 1056) are all read (11,662 rows). Product attribute columns (Model, Body Size, Speed, …) are preserved in the raw rows.
* Registered for reference only; not mixed into order KPIs.

## Dealer SFA employee activity

*Dealer SFA · refresh pattern: monthly* — Optional: employee activity/usage export for the Dealer SFA. Same layout as the DataSense employee activity file but with "dealer" in the file name.

Expected file(s): none supplied (optional source).

**Feeds:** Bizom SFA vs Dealer SFA Usage (optional file – none supplied; the DataSense employee-activity report is used instead)

| Canonical field | Meaning | Required | Accepted column names |
|---|---|:--:|---|
| `employee` | Employee | yes | `EMPLOYEE` |
| `role` | Role | yes | `ROLE` |
| `mktCoverage` | Market coverage |  | `MKT COVERAGE` |
| `tour` | Tours |  | `TOUR` |
| `visited` | Visits | yes | `VISITED` |
| `orders` | Orders | yes | `ORDER` |
| `complaints` | Complaints |  | `COMPLAINT` |
| `expenses` | Expenses |  | `EXPENSES` |

**Reading notes**

* Optional. Same layout as the DataSense employee-activity file; recognised when "dealer" appears in the file name. None was supplied.

## Dashboard → data it needs

| Page | Reads | If the data is missing |
|---|---|---|
| Overall Summary | every source that is present | Cards for missing sources show *not imported*; no number is invented |
| Dealer App › Orders & Performance | `dealer_orders` (+ `loyalty_snapshot` for points per dealer) | Empty state with a link to Data Import |
| Dealer App › Complaints | `dealer_complaints` | Empty state |
| Bizom SFA › MIS Usage Analytics | `bizom_usage` | Empty state |
| Issue Tracker | `issue_tracker` (not period filtered) | Empty state |
| DataSense SFA › Orders & Performance | `ds_orders` | Empty state |
| DataSense SFA › Complaints | `ds_complaints` | Empty state |
| DataSense SFA › Employee Activity | `ds_employee_activity` | Empty state |
| Hero Smiles | `loyalty_snapshot` (not period filtered; snapshots are never added) | Empty state |
| Dealer App vs DataSense SFA | `dealer_orders` and `ds_orders` (+ both complaint files, Hero Smiles). The weekly adoption charts and the order list (with SAP order numbers) use the two order files only. Columns: Outlet ID ← Dealer App `Outlet_ID`; DB Code ← ERP code; Sales App = DataSense, Bizom App = Dealer App; Capillary Current Total Points ← `Current_Points` of the latest valid snapshot; Smile Quiz Points has **no source field** | Page explains which file is missing; quiz points always show “—” |
| Dealer profile (opens from any dealer name) | all of the above, joined on the validated ERP code only | Tabs show an empty state for a system the dealer is not in |
| Bizom SFA vs Dealer SFA Usage | `bizom_usage` and `ds_employee_activity` (or `dealer_sfa_activity` when imported, which takes priority) | Explains which file is missing |
| Dealer App vs DataSense SFA (first page) and Overall Summary brief | `dealer_orders` (value, quantity, status, Outlet ID, zone, city, `Sku_Brand`, invoice and fulfilled quantity for MBD), `ds_orders` (value, quantity, status, dealer and DB codes), `SAP_Order_ID` / DataSense `Order NO` to count an order once across channels, both complaint files (complaint rate), plus the **column headers of every imported file** for the profitability check. Windows come from the first and last order date of the two order files | Page explains which file is missing; profitability says *Not verified* when no cost, margin, discount, return, freight or incentive column exists |
| Data Import | everything imported + import history | – |

## Period filter

The reporting-period list is built from the months actually present in the imported data (August, September and
October 2026 for the supplied files), plus a custom range limited to those dates. Hero Smiles and the issue tracker are
point-in-time and say so instead of being filtered. A period that no loaded file supports is never offered.
