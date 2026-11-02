# DataSense Usage Report: import schema and how it feeds the dashboard

Source id `ds_usage` · label "DataSense Usage Report" · dataset id `ds_usage:all` (one dataset, like the DataSense orders) ·
files: `App_Usage_Report_*.xlsx` (workbook) or a CSV of the Orders sheet.

> **What is verified and what is not.** The record and report shapes below are taken from the Usage Report payload that is
> embedded in the deployed 29 Oct 2026 dashboard (29,679 orders, 105 team rows, 10 summary figures) and from the code of the
> two pages that read it. The original workbook `App_Usage_Report_ApriltoOct.xlsx` and the script that packed it are not in the
> repository, so the **header spellings of the real workbook are an assumption** (the accepted spellings are listed below).
> If a real file is not recognised, the wizard's Map step shows which column is missing and lets the administrator map it; add the
> spelling to `src/lib/ingest/sources.ts` (`ds_usage.fields`) afterwards.

## Workbook layout

| Sheet (found by name) | Required? | Used for |
|---|---|---|
| **Orders**: the sheet picked in the wizard (auto-detected by its headers) | **yes** | one row per order; everything on the Usage Report and the DataSense side of "Bizom SFA vs DataSense SFA Usage" |
| `Summary` (any sheet whose name contains "summary") | optional | reconciliation table "as reported vs recomputed", the "Generated on" chip, import-time reconciliation |
| `ASM-Employee-wise` (name contains "asm" and "employee", or "employee-wise") | optional | the "ASM-Employee-wise (as reported)" table |

A CSV carries the Orders sheet only. Without Summary / ASM sheets the page hides the sections that need them (it says why in the import
issues as `NO_SUMMARY_SHEET` / `NO_ASM_SHEET`); every number computed from the orders is unaffected.

## Orders sheet columns

Headers are compared ignoring case, spaces and punctuation. The first accepted spelling that is present is used.

| Field | Accepted headers | Required | Rule | Blank / odd values |
|---|---|:-:|---|---|
| `date` | Date, Order Date, Order Punched Date, Punched Date, Created Date, Created On | **yes** | a real date (ISO, `dd-mm-yyyy`, `dd-Mon-yyyy`, an Excel date); day-first unless the column proves month-first | row **excluded** (`INVALID_DATE`, error). A footer row starting "Total" is set aside (`TOTAL_ROW_EXCLUDED`). A date in the future is kept with a warning |
| `dealer` | Dealer, Dealer Name, Customer, Customer Name | **yes** | text | kept, warning `MISSING_DEALER` |
| `platform` | Platform, Order Platform, Punched Platform | **yes** | `Mobile`, `Web` or `Old App` (also accepts a value starting with those words, `SAP`, `Manual`) | other value kept as written with warning `UNKNOWN_PLATFORM`; it is not part of the platform split |
| `status` | Status, Order Status | **yes** | text; the page treats `Rejected by ASM`, `Rejected by SAP`, `SAP Order Not Created` as rejected and `Archived` as archived | blank becomes `(no status)`, warning |
| `source` | Source, Order Source | no | `SFA` or `SAP` | derived from the platform when absent (`Old App` → `SAP`, `Mobile`/`Web` → `SFA`); a conflict is a warning `PLATFORM_SOURCE_MISMATCH` |
| `employee` | Employee, Employee Name, Emp Name, Punched By Name | no | text | blank allowed (the deployed data has 3 such rows) |
| `punchedBy` | Punched By, Punched By Role, Role, Employee Role | no | role of the person: ASM / RSE / RSM / … | blank becomes `Other / Unknown` |
| `zone` | Zone | no | text | blank allowed; the page shows it as "Not recorded" |
| `asm` | ASM, ASM Name | no | text | blank allowed |
| `rejectReason` | Reject Reason, Rejection Reason, Reject Remarks, Rejected Reason | no | free text | blank allowed |
| `items` | Items, No of Items, Item Count, Total Items, Line Items | no | number | blank stays blank (not zero); negative is a warning |
| `total` | Total, Order Total, Order Value, Total Value, Value, Amount | no | number (Indian digit grouping accepted) | blank stays blank (not zero): counted under "Orders without a value"; negative is a warning |
| `orderNo` | Order No, Order Number, Order ID, SAP Order No | no | text | see "Identity" |

**Required columns: Date, Dealer, Platform, Status.** Wizard behaviour: a file that lacks one is not auto-selected; the Map step names the missing field.

## Summary and ASM sheets

* **Summary**: two columns, label then value. Recognised labels: `Total orders`, `SFA app orders`, `Manual SAP orders`, `SFA adoption %`, `Net valid orders`, `Valid SFA orders`, `Adoption on valid orders %`, `Archived orders`, `Rejected orders (ASM / SAP / Not created)`, `Rejection rate % (SFA)`. The lines `Period`, `Zone`, `Generated on` may sit in the same sheet or above it. At import the five counts `Total orders`, `SFA app orders`, `Manual SAP orders`, `Archived orders`, `Rejected orders…` are compared with the orders (Reconcile step; a difference is a warning, not a blocker).
* **ASM-Employee-wise**: `Zone`, `ASM / Employee` (or `Name`), `Level`, `SFA Orders`, `SAP Orders`, `Archived`, `Rejected`, `Valid Order Value`, `SFA Adoption`. Required to show the table: the name and `SFA Orders` columns. Team-total and "own orders" rows overlap; they are shown as reported and never added up. (The shared reader trims cells, so the leading spaces that indent employee rows in the original are not kept; the table does not render them anyway.)

## Stored shape

Records (`DsUsageRec`): `key, datasetId, rowNo, date, month, zone, asm, employee, punchedBy, dealer, platform, source, status, rejectReason, items, total, orderNo`.
Dataset meta: the usual fields plus `extra.usageReport = { reported: {Period, Zone, "Generated on"} | null, summary: {label: number} | null, employees: [...] | null, notes: [...] }` and `extra.reconciliation`.
`raw` (the source rows) stays in this browser; it is never published.

## Identity, duplicates, replace / merge / skip

* **Identity (`key`)**: with an order number `orderNo|dealer` (the same number on two rows with different dealers is two orders, as in the report); without one `date|employee|dealer|items|total#n` (n = the n-th identical row), so identical-looking orders are all kept and a changed status updates the same order.
* **Duplicates**: with an order number, an identical repeat is excluded (`DUPLICATE_ROW`); the same key with different content keeps both (`DUPLICATE_KEY`). Without one, nothing is dropped.
* **Same file twice**: recognised by file hash → "skip" recommended.
* **Range logic** (same as DataSense orders): new range covers the stored one → Replace recommended; new range starts after the stored data ends → Merge recommended; partial overlap → the administrator must tick "I have checked this".
* **Replace**: the file becomes the dataset (counts: inserted = all, removed = what was there). **Merge**: by `key`: new orders inserted, changed ones updated, the rest unchanged, nothing removed; the report's Summary / ASM sheets describe a single file, so they are dropped after a merge and the page hides the sections that need them. **Skip**: nothing written.
* The wizard's refresh summary shows inserted, updated, unchanged, removed, skipped (duplicates + invalid) and flagged before anything is applied; the publish review shows the same against the published copy.

## How the data feeds the pages

The page works on `rows` made from the records: blank zone → "Not recorded", blank role → "Unknown", `employee` → `emp`, `rejectReason` → `reason`.

| On the page | Calculation | Fields |
|---|---|---|
| Orders recorded | number of rows in the filter | – |
| SFA app orders / SFA share | rows with `source = SFA`; share = SFA ÷ all | source |
| Old App (manual SAP) orders | all − SFA | source |
| Active employees | distinct non-blank employees | employee |
| Net valid orders | all − rejected − archived | status |
| Valid SFA orders | SFA − SFA rejected − SFA archived | source, status |
| SFA rejection rate | SFA rejected ÷ SFA | source, status |
| Orders without a value | rows with `total` blank (not treated as zero); "mostly archived" is shown when at least half of them are archived | total, status |
| Order value (employee table) | Σ `total` of non-rejected rows that have one: a lower bound | total, status |
| Filters: month / zone / platform / role | month = `date` month | date, zone, platform, punchedBy |
| Orders by platform and month; SFA share by month | counts per month for Mobile / Web / Old App; SFA ÷ all per month (zone/platform/role filters apply, the month filter does not) | date, platform, source, zone, punchedBy |
| Orders by zone (SFA vs Old App) / by status | counts | zone, source, status |
| Top employees by SFA orders | 12 largest SFA counts | employee, source |
| Most common rejection reasons | `reason` lower-cased, trimmed, cut at 60 characters, blanks and `---` ignored | rejectReason |
| Employees table | per employee: orders, SFA, SAP, share, rejected, archived, value | employee, punchedBy, zone, asm, … |
| "Report as supplied" | the ASM sheet as printed; the Summary figures next to the recomputed ones with a Matches / Differs check | extra.usageReport |
| Period chips and headings ("April–October 2026") | from the dataset's first and last order date | date |
| **Bizom SFA vs DataSense SFA Usage** | DataSense side: people (distinct employees), orders, SFA orders by month and zone | date, zone, employee, source, punchedBy |

The text on the page that depended on this particular file ("3 order numbers appear on two rows…", "mostly archived") is now produced from the dataset, and reads exactly as before for the embedded one.
