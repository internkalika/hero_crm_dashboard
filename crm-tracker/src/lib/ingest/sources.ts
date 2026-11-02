// Source registry: what each known file looks like, how to recognise it and which canonical
// fields it must provide. Column names in real exports drift over time, so every field lists
// accepted aliases and users can override the mapping in the Import Centre.
import type { Grain, SheetData, SourceFieldDef, SourceType } from '../types.js';
import { normHeader } from '../util/parse.js';

export const MAPPING_VERSION = 'm1';

export interface SourceDef {
  type: SourceType;
  label: string;
  system: string;
  grain: Grain;
  description: string;
  fields: Record<string, SourceFieldDef>;
  /** filename hints, used for period/scope inference and to break ties */
  filenameHints: RegExp[];
  /** conventional file names (shown in the import catalogue's "expected files") */
  expectedFiles: string[];
  /** true for sources that are registered and preserved but not used in KPIs */
  rawOnly?: boolean;
}

const f = (label: string, aliases: string[], required = false): SourceFieldDef => ({ label, aliases, required });

export const SOURCES: Record<SourceType, SourceDef> = {
  dealer_orders: {
    type: 'dealer_orders',
    label: 'Dealer App orders',
    system: 'Dealer App',
    grain: 'monthly',
    description: 'SKU-level order lines exported monthly from the Dealer App (Bizom).',
    filenameHints: [/dealer\s*app\s*orders?/i],
    expectedFiles: ['DealerAppOrders-SEPT.csv', 'DealerAppOrders-oct.csv'],
    fields: {
      zone: f('Zone', ['Zone']),
      city: f('City', ['City']),
      warehouse: f('Warehouse', ['Mapped_Warehouse_Name']),
      outletId: f('Outlet ID', ['Outlet_ID'], true),
      outletName: f('Outlet name', ['Outlet_Name'], true),
      erpId: f('Outlet ERP ID', ['Outlet_ERP_ID', 'ERP_ID', 'Dealer_Code'], true),
      beat: f('Beat', ['Beat']),
      sku: f('SKU', ['SKU', 'SKU_Name']),
      skuId: f('SKU ID', ['SKU_ID']),
      skuCode: f('SKU code', ['SKU_Code']),
      brand: f('Brand', ['Sku_Brand', 'Brand']),
      category: f('Category', ['Category']),
      orderId: f('Order ID', ['Order_ID'], true),
      sapOrderId: f('SAP order ID', ['SAP_Order_ID']),
      orderDate: f('Order date', ['Order_Date'], true),
      status: f('Order status', ['Order_Status'], true),
      qty: f('Order quantity', ['Order_Quantity', 'Quantity'], true),
      unitPrice: f('Unit price', ['Unitprice', 'Unit_Price']),
      amount: f('Amount', ['Amount'], true),
      invoiceId: f('Invoice ID', ['Invoice_Id']),
      invoiceDate: f('Invoice date', ['Invoice_Date']),
      fulfilledAmount: f('Fulfilled amount', ['Fulfilled_Amount']),
      fulfilledDate: f('Fulfilled date', ['Fulfilled_Date']),
      fulfilledQty: f('Fulfilled quantity', ['Fulfilled_Quantity']),
      lineStatus: f('SKU-wise fulfilled status', ['Sku_Wise_Fulfilled_Status']),
    },
  },
  dealer_complaints: {
    type: 'dealer_complaints',
    label: 'Dealer App complaints',
    system: 'Dealer App',
    grain: 'single',
    description: 'Complaint module ticket listing exported from the Dealer App.',
    filenameHints: [/complaint.*dealer\s*app/i],
    expectedFiles: ['Complaint Module Dump- Dealer App - 26 Oct.xlsx'],
    fields: {
      ticket: f('Ticket number', ['Ticket Number'], true),
      department: f('Department', ['Department']),
      category: f('Category', ['Category']),
      status: f('Status', ['Status'], true),
      raisedOn: f('Ticket raised on', ['Ticket Raised on'], true),
      subType: f('Sub type', ['Sub type', 'Subtype']),
      description: f('Description', ['Description']),
      assignedTo: f('Assigned to', ['Ticket Assigned To']),
      dealerCode: f('Dealer code', ['Dealer code', 'Dealer Code'], true),
      dealerName: f('Dealer name', ['Dealer Name']),
      assignmentLevel: f('Assignment level', ['Current Assigment Level', 'Current Assignment Level']),
    },
  },
  bizom_usage: {
    type: 'bizom_usage',
    label: 'Bizom MIS usage',
    system: 'Bizom SFA',
    grain: 'monthly',
    description: 'Monthly Bizom report/dashboard access counts per user.',
    filenameHints: [/mis[\s_-]*usage/i, /bizom/i],
    expectedFiles: ['MIS_usage_report_bizom-aug.csv', 'MISUsagereport-Bizom-sept.csv', 'MISUsagereport-Bizom-Oct.csv'],
    fields: {
      zone: f('Zone', ['Zone']),
      subzone: f('Subzone', ['Subzone']),
      userId: f('User ID', ['User_ID'], true),
      loginName: f('User name', ['User_Name']),
      designation: f('Designation', ['Designations', 'Designation']),
      name: f('Name', ['Name'], true),
      roleId: f('Role ID', ['Role_id']),
      reportId: f('Report ID', ['Report_Id'], true),
      reportName: f('Report name', ['Report_Name'], true),
      type: f('Type', ['Type']),
      accessCount: f('Access count', ['Access_Count'], true),
    },
  },
  issue_tracker: {
    type: 'issue_tracker',
    label: 'Bizom issue tracker',
    system: 'Bizom SFA',
    grain: 'single',
    description: 'Bizom/Hero pointer tracker with a status dashboard sheet.',
    filenameHints: [/issue[\s_-]*tracker/i],
    expectedFiles: ['Issue_Tracker.xlsx'],
    fields: {
      pointer: f('Pointer', ['Pointer', 'Issue'], true),
      type: f('Type', ['Type']),
      priority: f('Priority', ['Priority', 'Column C']),
      platform: f('Platform', ['Platform'], true),
      status: f('Status', ['Status'], true),
      target: f('Target date', ['Target Date', 'Target']),
    },
  },
  ds_orders: {
    type: 'ds_orders',
    label: 'DataSense orders',
    system: 'DataSense SFA',
    grain: 'range',
    description: 'Order Punched Report (header level, one row per order).',
    filenameHints: [/order\s*punched/i],
    expectedFiles: ['Order Punched Report- Datasense - aug to oct.xls'],
    fields: {
      orderNo: f('Order no', ['Order NO', 'Order No'], true),
      orderDate: f('Order date', ['Order Date'], true),
      invoiceNo: f('Invoice no', ['Invoice NO', 'Invoice No']),
      dealer: f('Dealer name', ['Dealer Name'], true),
      employee: f('Employee name', ['Employee Name']),
      role: f('Role', ['Role']),
      city: f('City', ['city', 'City']),
      value: f('Order value', ['value of Order', 'Order Value'], true),
      cyclesQty: f('Cycles volume', ['Cycles volume']),
      cyclesValue: f('Cycles value', ['Cycles value']),
      sparesValue: f('Spares value', ['spares value']),
      sparesQty: f('Spares volume', ['spares volume']),
      status: f('Status', ['Status'], true),
    },
  },
  ds_complaints: {
    type: 'ds_complaints',
    label: 'DataSense complaints',
    system: 'DataSense SFA',
    grain: 'single',
    description: 'Complaint module dump from DataSense.',
    filenameHints: [/complaint.*data\s*sense/i],
    expectedFiles: ['Complaint Module Dump- Datasense - 26 Oct.xlsx'],
    fields: {
      caseRef: f('Case reference number', ['Case Reference Number'], true),
      date: f('Complaint date', ['Complaint Date'], true),
      createdBy: f('Created by', ['Created By']),
      role: f('Role', ['Role']),
      dealer: f('Dealer name', ['Dealer Name'], true),
      complaint: f('Complaint type', ['Complaint']),
      department: f('Department', ['Department']),
      ownership: f('Ownership', ['Ownership']),
      invoiceNumber: f('Invoice number', ['Invoice Number']),
      invoiceDate: f('Invoice date', ['Invoice Date']),
      description: f('Description', ['Description']),
      additional: f('Additional information', ['Additional Information']),
      closedDate: f('Complaint closed date', ['Complaint Closed Date']),
      tat: f('TAT', ['TAT (day/hr/min/sec)', 'TAT']),
      status: f('Status', ['Status'], true),
    },
  },
  ds_employee_activity: {
    type: 'ds_employee_activity',
    label: 'DataSense employee activity',
    system: 'DataSense SFA',
    grain: 'monthly',
    description: 'Monthly employee activity totals from DataSense (tours, visits, orders ...).',
    filenameHints: [/employee.*activit.*data\s*sense/i, /data\s*sense.*employee/i],
    expectedFiles: ['Employee-daily-activities-datasense-sept.csv', 'Employee-daily-activities- Datasense-oct.csv'],
    fields: {
      employee: f('Employee', ['EMPLOYEE'], true),
      role: f('Role', ['ROLE'], true),
      mktCoverage: f('Market coverage', ['MKT COVERAGE']),
      tour: f('Tours', ['TOUR']),
      visited: f('Visits', ['VISITED'], true),
      orders: f('Orders', ['ORDER'], true),
      complaints: f('Complaints', ['COMPLAINT']),
      expenses: f('Expenses', ['EXPENSES']),
    },
  },
  ds_usage: {
    type: 'ds_usage',
    label: 'DataSense Usage Report',
    system: 'DataSense SFA',
    grain: 'range',
    description:
      'App Usage Report: one row per order with the platform it was punched on (Mobile, Web or the Old App / SAP). Read from the "Orders" sheet; the "Summary" and "ASM-Employee-wise" sheets of the same workbook are used to reconcile and to show the report as supplied.',
    filenameHints: [/app[\s_-]*usage/i, /usage[\s_-]*report/i],
    expectedFiles: ['App_Usage_Report_ApriltoOct.xlsx'],
    fields: {
      date: f('Order date', ['Date', 'Order Date', 'Order Punched Date', 'Punched Date', 'Created Date', 'Created On'], true),
      zone: f('Zone', ['Zone']),
      asm: f('ASM', ['ASM', 'ASM Name']),
      employee: f('Employee', ['Employee', 'Employee Name', 'Emp Name', 'Punched By Name']),
      punchedBy: f('Punched by (role)', ['Punched By', 'Punched By Role', 'Role', 'Employee Role']),
      dealer: f('Dealer', ['Dealer', 'Dealer Name', 'Customer', 'Customer Name'], true),
      platform: f('Platform', ['Platform', 'Order Platform', 'Punched Platform'], true),
      source: f('Source', ['Source', 'Order Source']),
      status: f('Status', ['Status', 'Order Status'], true),
      rejectReason: f('Reject reason', ['Reject Reason', 'Rejection Reason', 'Reject Remarks', 'Rejected Reason']),
      items: f('Items', ['Items', 'No of Items', 'Item Count', 'Total Items', 'Line Items']),
      total: f('Total', ['Total', 'Order Total', 'Order Value', 'Total Value', 'Value', 'Amount']),
      orderNo: f('Order number', ['Order No', 'Order NO', 'Order Number', 'Order ID', 'SAP Order No']),
    },
  },
  dealer_sfa_activity: {
    type: 'dealer_sfa_activity',
    label: 'Dealer SFA employee activity',
    system: 'Dealer SFA',
    grain: 'monthly',
    description: 'Optional: employee activity/usage export for the Dealer SFA. Same layout as the DataSense employee activity file but with "dealer" in the file name.',
    filenameHints: [/dealer.*(employee|activit|usage)/i, /(employee|activit|usage).*dealer/i],
    expectedFiles: [],
    fields: {
      employee: f('Employee', ['EMPLOYEE'], true),
      role: f('Role', ['ROLE'], true),
      mktCoverage: f('Market coverage', ['MKT COVERAGE']),
      tour: f('Tours', ['TOUR']),
      visited: f('Visits', ['VISITED'], true),
      orders: f('Orders', ['ORDER'], true),
      complaints: f('Complaints', ['COMPLAINT']),
      expenses: f('Expenses', ['EXPENSES']),
    },
  },
  loyalty_snapshot: {
    type: 'loyalty_snapshot',
    label: 'Hero Smiles (Capillary) snapshot',
    system: 'Hero Smiles',
    grain: 'snapshot',
    description: 'Point-in-time dealer loyalty balances exported from Capillary.',
    filenameHints: [/capillary/i, /hero[\s_-]*earning/i],
    expectedFiles: [
      'CAPILLARY_HERO_EARNING_28 sept.csv',
      'CAPILLARY_HERO_EARNING_05Oct.csv',
      'CAPILLARY_HERO_EARNING_13oct.csv',
      'CAPILLARY_HERO_EARNING_19Oct.csv',
      'CAPILLARY_HERO_EARNING_26Oct.csv',
    ],
    fields: {
      customerId: f('Customer external ID', ['customer_external_ID'], true),
      mobile: f('Mobile', ['mobile']),
      firmName: f('Firm name', ['firm_name'], true),
      lifetime: f('Lifetime points', ['lifetime_points'], true),
      opening: f('Opening balance', ['opening_balance']),
      issued: f('Points issued', ['Points_issued']),
      expired: f('Points expired', ['Points_expired']),
      adjustment: f('Manual adjustment', ['Points_manual_adjustment']),
      current: f('Current points', ['Current_Points'], true),
    },
  },
  focus_liquidation: {
    type: 'focus_liquidation',
    label: 'Focus & Liquidation (DataSense)',
    system: 'DataSense SFA',
    grain: 'single',
    rawOnly: true,
    description: 'Plant-wise SKU focus/liquidation configuration and stock. Registered and preserved; not used in order KPIs.',
    filenameHints: [/focus.*liquidation/i],
    expectedFiles: ['Focus & Liquidation - datasense.xlsx'],
    fields: {
      materialCode: f('Material code', ['Material Code'], true),
      description: f('Description', ['Description']),
      brand: f('Brand', ['Brand']),
      segment: f('Segment', ['Segment']),
      plantCode: f('Plant code', ['Plant Code'], true),
      plantName: f('Plant name', ['Plant Name']),
      status: f('Status', ['Status']),
      focusStart: f('Focus start', ['Focus Start']),
      focusEnd: f('Focus end', ['Focus End']),
      liquidationStatus: f('Liquidation status', ['Liquation Status', 'Liquidation Status']),
      skuStock: f('SKU stock', ['SKU Stock'], true),
    },
  },
};

export const SOURCE_TYPES = Object.keys(SOURCES) as SourceType[];

/** Case/spacing-insensitive alias lookup. Returns canonical -> actual column. */
export function autoMap(columns: string[], fields: Record<string, SourceFieldDef>): Record<string, string> {
  const byNorm = new Map<string, string>();
  for (const c of columns) if (!byNorm.has(normHeader(c))) byNorm.set(normHeader(c), c);
  const mapping: Record<string, string> = {};
  for (const [canon, def] of Object.entries(fields)) {
    for (const alias of def.aliases) {
      const hit = byNorm.get(normHeader(alias));
      if (hit) {
        mapping[canon] = hit;
        break;
      }
    }
  }
  return mapping;
}

export function missingRequired(mapping: Record<string, string>, fields: Record<string, SourceFieldDef>): string[] {
  return Object.entries(fields)
    .filter(([k, d]) => d.required && !mapping[k])
    .map(([k]) => k);
}

export interface Candidate {
  source: SourceType;
  score: number;
  mapped: number;
  required: number;
  missing: string[];
}

export function scoreSheet(sheet: SheetData, fileName: string): Candidate[] {
  const out: Candidate[] = [];
  for (const def of Object.values(SOURCES)) {
    const mapping = autoMap(sheet.columns, def.fields);
    const reqKeys = Object.entries(def.fields).filter(([, d]) => d.required).map(([k]) => k);
    const mappedReq = reqKeys.filter((k) => mapping[k]).length;
    const allKeys = Object.keys(def.fields);
    const mappedAll = allKeys.filter((k) => mapping[k]).length;
    let score = (mappedReq / reqKeys.length) * 0.75 + (mappedAll / allKeys.length) * 0.25;
    if (def.filenameHints.some((re) => re.test(fileName))) score += 0.08;
    out.push({ source: def.type, score, mapped: mappedAll, required: reqKeys.length, missing: reqKeys.filter((k) => !mapping[k]) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface Identification {
  source: SourceType | null;
  confidence: number;
  sheetName: string | null;
  candidates: Candidate[];
  ambiguous: boolean;
  note?: string;
}

/**
 * Decides which source a file is. Header signature is the primary signal; the filename
 * breaks ties between sources that share a layout (DataSense vs Dealer SFA employee activity).
 */
export function identify(sheets: SheetData[], fileName: string): Identification {
  let best: { sheet: SheetData; cands: Candidate[] } | null = null;
  for (const sh of sheets) {
    if (sh.columns.length === 0) continue;
    const cands = scoreSheet(sh, fileName);
    if (!best || cands[0].score > best.cands[0].score) best = { sheet: sh, cands };
  }
  if (!best) return { source: null, confidence: 0, sheetName: null, candidates: [], ambiguous: false, note: 'No readable header row was found.' };
  let [top] = best.cands;
  const sameLayout = best.cands.filter((c) => Math.abs(c.score - top.score) < 0.081 && c.score >= 0.7);
  let ambiguous = false;
  let note: string | undefined;
  const isEmpl = (s: SourceType) => s === 'ds_employee_activity' || s === 'dealer_sfa_activity';
  if (isEmpl(top.source)) {
    // Both employee-activity sources share one layout. Disambiguate by file name.
    const ds = /data\s*sense/i.test(fileName);
    const dealer = /dealer/i.test(fileName);
    if (dealer && !ds) top = best.cands.find((c) => c.source === 'dealer_sfa_activity')!;
    else if (ds && !dealer) top = best.cands.find((c) => c.source === 'ds_employee_activity')!;
    else {
      ambiguous = true;
      note = 'This employee-activity layout is shared by DataSense and Dealer SFA exports. Choose the system it came from.';
    }
  } else if (sameLayout.length > 1 && sameLayout[0].source !== top.source) {
    ambiguous = true;
  }
  const ok = top.score >= 0.7 && top.missing.length === 0;
  return {
    source: top.score >= 0.55 ? top.source : null,
    confidence: Math.min(1, top.score),
    sheetName: best.sheet.name,
    candidates: best.cands.slice(0, 4),
    ambiguous: ambiguous || !ok,
    note: note ?? (!ok && top.score >= 0.55 ? `Required columns not found: ${top.missing.join(', ')}. Use the Map step.` : undefined),
  };
}
