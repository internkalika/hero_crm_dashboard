// Canonical data model for CRM Tracker.
// Raw source rows are preserved separately (DatasetPayload.raw); everything below is the
// transformed, analytics-ready layer.

export type SourceType =
  | 'dealer_orders'
  | 'dealer_complaints'
  | 'bizom_usage'
  | 'issue_tracker'
  | 'ds_orders'
  | 'ds_complaints'
  | 'ds_employee_activity'
  | 'ds_usage'
  | 'dealer_sfa_activity'
  | 'loyalty_snapshot'
  | 'focus_liquidation';

/** How successive files of a source relate to each other. */
export type Grain = 'monthly' | 'snapshot' | 'range' | 'single';
export type ImportMode = 'add' | 'replace' | 'merge';

export type Severity = 'error' | 'warning' | 'info';

export interface DQIssue {
  code: string;
  severity: Severity;
  message: string;
  /** record reference (row number, order id, ticket id ...) */
  ref?: string;
  field?: string;
  value?: string;
  /** true when the row was NOT retained for analysis because of this issue */
  excluded?: boolean;
}

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface SheetData {
  name: string;
  /** 1-based sheet row number of the detected header row */
  headerRow: number;
  columns: string[];
  rows: Row[];
  /** 1-based sheet row numbers matching `rows` */
  rowNumbers: number[];
  /** non-empty rows that preceded the header (titles etc.) */
  preamble: string[];
  /** dimension claimed by the file vs. the real populated range */
  declaredDimension?: string;
  populatedRows: number;
  blankRowsSkipped: number;
  /** raw matrix of the first rows, for previews */
  hasMergedOrTitle?: boolean;
}

export interface ReadFile {
  fileName: string;
  size: number;
  kind: 'csv' | 'xlsx' | 'xls' | 'html-xls';
  sheets: SheetData[];
}

export interface SourceFieldDef {
  label: string;
  required?: boolean;
  /** accepted header spellings (compared after normalisation) */
  aliases: string[];
}

export interface DatasetMeta {
  id: string;
  source: SourceType;
  scope: string;
  fileName: string;
  sheet?: string;
  importedAt: string;
  /** ISO dates spanned by the data */
  periodStart: string | null;
  periodEnd: string | null;
  /** YYYY-MM for monthly sources, ISO date for snapshots */
  period: string | null;
  snapshotDate?: string | null;
  /** date the export was taken (filename / content inference) */
  asOfDate?: string | null;
  rawCount: number;
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  /** report footer "Total" rows set aside for reconciliation (not data, not invalid) */
  totalRowCount?: number;
  flaggedCount: number;
  mappingVersion: string;
  columns: string[];
  mapping: Record<string, string>;
  inference: string[];
  fileSize: number;
  mode: ImportMode;
  /** free-form per-source facts (reconciliation against source totals, sheet profile ...) */
  extra?: Record<string, unknown>;
}

export interface DatasetPayload<T = unknown> {
  meta: DatasetMeta;
  /** untouched source rows (original headers) */
  raw: Row[];
  /** canonical analytics records */
  records: T[];
  issues: DQIssue[];
}

/* -------------------------------- Dealer App ------------------------------- */

export type DealerOrderStatus = 'fulfilled' | 'partial' | 'rejected' | 'accepted' | 'other';

export interface DealerOrderLine {
  key: string;
  datasetId: string;
  rowNo: number;
  period: string;
  zone: string | null;
  city: string | null;
  warehouse: string | null;
  outletId: string;
  outletName: string;
  /** stable dealer key = Outlet_ERP_ID */
  dealerKey: string | null;
  beat: string | null;
  sku: string | null;
  skuCode: string | null;
  brand: string | null;
  category: string | null;
  orderId: string;
  sapOrderId: string | null;
  orderDate: string | null;
  month: string | null;
  status: DealerOrderStatus;
  rawStatus: string;
  qty: number | null;
  unitPrice: number | null;
  amount: number | null;
  invoiceId: string | null;
  invoiceDate: string | null;
  fulfilledAmount: number | null;
  fulfilledDate: string | null;
  fulfilledQty: number | null;
  lineStatus: 'fulfilled' | 'not_fulfilled' | 'unknown';
}

/** Order-level roll-up used by both order systems. */
export type OrderStatusGroup =
  | 'fulfilled'
  | 'partial'
  | 'accepted'
  | 'billed'
  | 'dispatch'
  | 'open'
  | 'sap_pending'
  | 'rejected'
  | 'other';

export interface OrderSummary {
  key: string;
  system: 'dealer' | 'ds';
  datasetId: string;
  orderId: string;
  sapOrderId: string | null;
  dealerKey: string | null;
  dealerName: string;
  outletId?: string | null;
  date: string | null;
  month: string | null;
  statusGroup: OrderStatusGroup;
  rawStatus: string;
  /** order value (Dealer App: sum of line Amount, DataSense: 'value of Order') */
  value: number | null;
  /** cycles quantity */
  qty: number | null;
  /** value on a cycles basis (for ASP) */
  cyclesValue: number | null;
  fulfilledQty: number | null;
  fulfilledValue: number | null;
  lines: number;
  skus: number;
  /** Dealer App only: the distinct models (Sku_Brand) on the order's lines, A–Z */
  models?: string[];
  invoiced: boolean | null;
  zone: string | null;
  city: string | null;
  employee?: string | null;
  role?: string | null;
  flags: string[];
}

/* -------------------------------- DataSense -------------------------------- */

export interface DsOrder {
  key: string;
  datasetId: string;
  rowNo: number;
  orderNo: string;
  idFormat: 'sap' | 'datasense';
  orderDate: string | null;
  month: string | null;
  invoiceNo: string | null;
  dealerName: string;
  dealerKey: string | null;
  employeeName: string | null;
  employeeId: string | null;
  role: string | null;
  city: string | null;
  value: number | null;
  cyclesQty: number | null;
  cyclesValue: number | null;
  sparesValue: number | null;
  sparesQty: number | null;
  rawStatus: string;
  statusGroup: OrderStatusGroup;
  flags: string[];
}

/* -------------------------------- Complaints -------------------------------- */

export type ComplaintStatusGroup = 'open' | 'pending' | 'in_process' | 'escalated' | 'closed' | 'rejected' | 'unmapped';

export interface ComplaintRec {
  key: string;
  datasetId: string;
  system: 'dealer' | 'ds';
  id: string;
  rowNo: number;
  raisedAt: string | null;
  raisedDate: string | null;
  month: string | null;
  closedAt: string | null;
  rawStatus: string;
  statusGroup: ComplaintStatusGroup;
  department: string | null;
  departmentKind: 'function' | 'individual' | 'closed' | 'none';
  category: string | null;
  subType: string | null;
  owner: string | null;
  assignmentLevel: string | null;
  dealerKey: string | null;
  dealerCode: string | null;
  dealerName: string | null;
  description: string | null;
  additionalInfo: string | null;
  createdBy: string | null;
  role: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  tatMinutes: number | null;
  tatSource: 'tat' | 'dates' | null;
  flags: string[];
}

/* -------------------------------- Bizom usage -------------------------------- */

export interface UsageRec {
  key: string;
  datasetId: string;
  rowNo: number;
  period: string;
  month: string;
  zone: string | null;
  subzone: string | null;
  userId: string;
  name: string;
  loginName: string | null;
  designation: string;
  accountKind: 'Field staff' | 'Distributor' | 'Company / admin';
  roleId: string | null;
  reportId: string;
  reportName: string;
  type: string;
  accessCount: number;
  flags: string[];
}

/* ------------------------- DataSense Usage Report (App Usage Report) ------------------------- */

/** One order of the DataSense App Usage Report ("Orders" sheet). Counts are orders recorded per platform. */
export interface DsUsageRec {
  /** order no + dealer when the file has an order number, otherwise date|employee|dealer|items|total + occurrence */
  key: string;
  datasetId: string;
  rowNo: number;
  /** YYYY-MM-DD */
  date: string;
  month: string;
  zone: string;
  asm: string;
  employee: string;
  /** role of the person who punched the order (ASM / RSE / RSM / Other / Unknown) */
  punchedBy: string;
  dealer: string;
  /** Mobile | Web | Old App */
  platform: string;
  /** SFA | SAP */
  source: string;
  status: string;
  rejectReason: string;
  items: number | null;
  total: number | null;
  orderNo?: string | null;
}

/** One row of the report's ASM-Employee-wise sheet, as reported (team totals and own-order rows overlap). */
export interface DsUsageAsmRow {
  zone: string;
  name: string;
  level: string;
  sfa: number | null;
  sap: number | null;
  archived: number | null;
  rejected: number | null;
  value: number | null;
  adoption: number | null;
}

/** What a Usage Report dataset keeps besides its order rows (dataset meta.extra.usageReport). */
export interface DsUsageReported {
  /** Period / Zone / Generated on, as printed by the report */
  reported: Record<string, string> | null;
  /** the report's Summary sheet: label -> value */
  summary: Record<string, number> | null;
  /** the report's ASM-Employee-wise sheet */
  employees: DsUsageAsmRow[] | null;
  /** facts about the file worth printing under the reconciliation (for example repeated order numbers) */
  notes?: string[];
}

/* -------------------------------- Issue tracker -------------------------------- */

export type IssueStatusGroup = 'resolved' | 'in_progress' | 'waiting' | 'unmapped';

export interface IssueUpdate {
  label: string;
  date: string | null;
  text: string;
}

export interface IssueRec {
  key: string;
  datasetId: string;
  rowNo: number;
  pointer: string;
  type: string | null;
  typeRaw: string | null;
  priority: 'P1' | 'P2' | 'P3' | null;
  priorityRaw: string | null;
  platform: string | null;
  status: string;
  rawStatus: string;
  statusGroup: IssueStatusGroup;
  targetRaw: string | null;
  targetDate: string | null;
  targetKind: 'date' | 'text-date' | 'non-date' | 'none';
  updates: IssueUpdate[];
  lastUpdateText: string | null;
  lastUpdateLabel: string | null;
  flags: string[];
}

/* -------------------------------- Employee activity -------------------------------- */

export interface EmployeeActivityRec {
  key: string;
  datasetId: string;
  source: 'ds_employee_activity' | 'dealer_sfa_activity';
  rowNo: number;
  period: string;
  month: string;
  employee: string;
  employeeKey: string;
  role: string;
  mktCoverage: number | null;
  tour: number | null;
  visited: number | null;
  orders: number | null;
  complaints: number | null;
  expenses: number | null;
  isTest: boolean;
  flags: string[];
}

/* -------------------------------- Loyalty -------------------------------- */

export interface LoyaltyRec {
  key: string;
  datasetId: string;
  rowNo: number;
  snapshotDate: string;
  customerId: string;
  idKind: 'verified' | 'unverified';
  /** join key. verified -> normalised external id; unverified -> never joined across systems */
  entityKey: string;
  mobileMasked: string | null;
  firmName: string;
  lifetime: number | null;
  opening: number | null;
  issued: number | null;
  expired: number | null;
  adjustment: number | null;
  current: number | null;
  flags: string[];
}

/* -------------------------------- Focus & Liquidation -------------------------------- */

export interface FocusRec {
  key: string;
  datasetId: string;
  plantCode: string;
  plantName: string | null;
  materialCode: string;
  description: string | null;
  brand: string | null;
  segment: string | null;
  status: string | null;
  liquidationStatus: string | null;
  focusStart: string | null;
  focusEnd: string | null;
  skuStock: number | null;
}

/* -------------------------------- Aggregate app data -------------------------------- */

export interface TaggedIssue extends DQIssue {
  datasetId: string;
  source: SourceType;
  fileName: string;
}

export interface AppData {
  version: number;
  datasets: DatasetMeta[];
  dealerLines: DealerOrderLine[];
  dsOrders: DsOrder[];
  dealerComplaints: ComplaintRec[];
  dsComplaints: ComplaintRec[];
  usage: UsageRec[];
  issues: IssueRec[];
  dsEmployees: EmployeeActivityRec[];
  dsUsage: DsUsageRec[];
  dealerSfa: EmployeeActivityRec[];
  loyalty: LoyaltyRec[];
  focus: FocusRec[];
  dq: TaggedIssue[];
}

export const emptyAppData = (): AppData => ({
  version: 0,
  datasets: [],
  dealerLines: [],
  dsOrders: [],
  dealerComplaints: [],
  dsComplaints: [],
  usage: [],
  issues: [],
  dsEmployees: [],
  dsUsage: [],
  dealerSfa: [],
  loyalty: [],
  focus: [],
  dq: [],
});

/* -------------------------------- Insights -------------------------------- */

export interface Insight {
  id: string;
  level: 'good' | 'info' | 'watch' | 'concern';
  title: string;
  detail: string;
  /** route to open for more detail */
  to?: string;
}

/* -------------------------------- Settings -------------------------------- */

export interface Settings {
  /** include rejected orders in order value / AOV / ASP / active dealers */
  includeRejected: boolean;
  /** ISO date used for aging / overdue calculations (null = today) */
  asOfDate: string | null;
  /** report accessed this many times or fewer (whole period) is "low usage" */
  lowUsageThreshold: number;
  /** include flagged test / service accounts in Bizom and employee KPIs */
  includeTestAccounts: boolean;
  /** which system is the baseline in Dealer App vs DataSense comparison */
  comparisonBaseline: 'dealer' | 'ds';
}

export const defaultSettings: Settings = {
  includeRejected: false,
  asOfDate: null,
  lowUsageThreshold: 5,
  includeTestAccounts: false,
  comparisonBaseline: 'dealer',
};
