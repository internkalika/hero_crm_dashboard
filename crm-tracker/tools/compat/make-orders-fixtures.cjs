// Writes SYNTHETIC Dealer App and DataSense order files (fictional dealers TEST-1..TEST-3) for the dynamic-month end-to-end test.
//   node tools/compat/make-orders-fixtures.cjs
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.join(__dirname, 'fixtures', 'orders');
const DEALERS = [['TEST-1', 'Test Cycles One'], ['TEST-2', 'Test Cycles Two'], ['TEST-3', 'Test Cycles Three']];
const AH = ['Zone', 'City', 'Mapped_Warehouse_Name', 'Outlet_ID', 'Outlet_Name', 'Outlet_ERP_ID', 'Beat', 'SKU', 'SKU_Code', 'Sku_Brand', 'Category', 'Order_ID', 'SAP_Order_ID', 'Order_Date', 'Order_Status', 'Order_Quantity', 'Unitprice', 'Amount', 'Invoice_Id', 'Invoice_Date', 'Fulfilled_Amount', 'Fulfilled_Date', 'Fulfilled_Quantity', 'Sku_Wise_Fulfilled_Status'];
const DH = ['Order NO', 'Order Date', 'Invoice NO', 'Dealer Name', 'Employee Name', 'Role', 'city', 'value of Order', 'Cycles volume', 'Cycles value', 'spares value', 'spares volume', 'Status'];
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const csv = (h, rows) => [h, ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n';

/** n Dealer App orders per dealer on the given days; amount = 10000 * qty (qty 2) */
function app(prefix, month, days, over = {}) {
  const rows = [];
  DEALERS.forEach(([code, name]) => days.forEach((d, i) => {
    const id = `${prefix}-${code}-${month}-${d}`;
    rows.push(['West', 'Pune', 'WH-1', `OUT-${code}`, name, code, 'B1', 'Model A 26T', 'A26', 'Model A', 'Cycle', id, '', `${month}-${d}`, over.status ?? 'Fulfilled', 2, 5000, over.amount ?? 10000, '', '', '', '', '', 'fulfilled']);
  }));
  return rows;
}
function ds(prefix, month, days) {
  const rows = [];
  DEALERS.forEach(([code, name]) => days.forEach((d) => rows.push([`${prefix}-${code}-${month}-${d}`, `${month}-${d}`, '', `${name} [${code}]`, 'Test Employee', 'RSE', 'Pune', 8000, 1, 8000, 0, 0, 'Open'])));
  return rows;
}
const w = (f, t) => fs.writeFileSync(path.join(OUT, f), t);
fs.mkdirSync(OUT, { recursive: true });
w('DealerAppOrders-NOV.csv', csv(AH, app('N', '2026-11', ['03', '10', '17'])));                       // 3 dealers x 3 days = 9 orders, value 90,000
w('DealerAppOrders-DEC.csv', csv(AH, app('D', '2026-12', ['02', '09'])));                             // 3 x 2 = 6 orders
w('DealerAppOrders-OCT-NOV.csv', csv(AH, [...app('X', '2026-10', ['28']), ...app('N', '2026-11', ['03', '10', '17'])])); // two months in one workbook
w('DealerAppOrders-NOV-corrected.csv', csv(AH, app('N', '2026-11', ['03', '10', '17'], { amount: 20000 }))); // same 9 orders, amount corrected to 20,000 each (value 180,000)
w('Order Punched Report - Datasense - nov.csv', csv(DH, ds('N', '2026-11', ['03', '10', '17'])));
w('Order Punched Report - Datasense - dec.csv', csv(DH, ds('D', '2026-12', ['02', '09'])));
console.log('written to', OUT);
