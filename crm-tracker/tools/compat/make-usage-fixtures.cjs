// Writes synthetic App Usage Report workbooks (Summary, Orders, ASM-Employee-wise sheets) for the end-to-end test.
//   node tools/compat/make-usage-fixtures.cjs
const XLSX = require('xlsx');
const path = require('node:path');
const H = ['Date', 'Zone', 'ASM', 'Employee', 'Punched By', 'Dealer', 'Platform', 'Source', 'Status', 'Reject Reason', 'Items', 'Total'];
const zones = ['NORTH', 'SOUTH', 'EAST', 'WEST'];
const plat = [['Mobile', 'SFA'], ['Web', 'SFA'], ['Old App', 'SAP']];
const statuses = ['Open', 'Billing', 'Delivery', 'Archived', 'Rejected by ASM'];
function orders(n, tweak = false) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const [p, s] = plat[i % 3];
    const status = statuses[i % 5];
    rows.push([`2026-11-0${2 + (i % 5)}`, zones[i % 4], `ASM ${i % 4}`, `Test Employee ${i % 7}`, ['ASM', 'RSE', 'RSM'][i % 3], `Test Dealer ${i % 11}`, p, s,
      tweak && i < 2 ? 'Delivery' : status, status === 'Rejected by ASM' ? 'price too high' : '', 1 + (i % 4), status === 'Archived' ? null : 1000 + i * 10]);
  }
  return rows;
}
function book(rows, file) {
  const count = (f) => rows.filter(f).length;
  const summary = [
    ['Metric', 'Value'], ['Period', '02-11-2026 to 06-11-2026'], ['Zone', 'All Zones'], ['Generated on', '06-11-2026 10:00'],
    ['Total orders', rows.length], ['SFA app orders', count((r) => r[7] === 'SFA')], ['Manual SAP orders', count((r) => r[7] === 'SAP')],
    ['Archived orders', count((r) => r[8] === 'Archived')], ['Rejected orders (ASM / SAP / Not created)', count((r) => r[8].startsWith('Rejected'))],
  ];
  const asm = [['Zone', 'ASM / Employee', 'Level', 'SFA Orders', 'SAP Orders', 'Archived', 'Rejected', 'Valid Order Value', 'SFA Adoption'], ['NORTH', 'ASM 0 - Team Total', 'ASM', 10, 3, 2, 1, 12000, 0.77]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows]), 'Orders');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(asm), 'ASM-Employee-wise');
  XLSX.writeFile(wb, path.join(__dirname, 'fixtures', 'usage', file));
}
book(orders(40), 'App_Usage_Report_Nov.xlsx');
book(orders(40, true), 'App_Usage_Report_Nov_changed.xlsx'); // same orders, two moved on to "Delivery"
book(orders(25).map((r) => [r[0].replace('2026-11', '2026-12'), ...r.slice(1)]), 'App_Usage_Report_Dec.xlsx'); // other admin's file
book(orders(15).map((r) => [r[0].replace('2026-11-0', '2026-11-1'), ...r.slice(1)]), 'App_Usage_Report_Jan.xlsx'); // second admin round: new orders after the stored data
console.log('written');
