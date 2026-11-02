// Formatted Excel (ExcelJS, loaded on demand) and CSV export.
import Papa from 'papaparse';
import type { CellValue, ColFormat } from './format';

export interface Col<T> {
  id: string;
  header: string;
  value: (row: T) => CellValue;
  format?: ColFormat;
  width?: number;
  align?: 'left' | 'right' | 'center';
  /** custom cell renderer for the on-screen table only; exports always use `value` */
  render?: (row: T) => import('react').ReactNode;
  /** hidden by default in the table (still available through "Columns" and in exports) */
  hidden?: boolean;
  /** description shown as a tooltip on the header */
  help?: string;
  /** exclude from exports (UI-only columns) */
  noExport?: boolean;
}

export interface SheetSpec {
  name: string;
  columns: Array<{ header: string; format?: ColFormat; width?: number }>;
  rows: CellValue[][];
  /** shown under the header on the Notes sheet */
  note?: string;
}

export function sheetFromCols<T>(name: string, cols: Col<T>[], rows: T[], note?: string): SheetSpec {
  const use = cols.filter((c) => !c.noExport);
  return {
    name,
    note,
    columns: use.map((c) => ({ header: c.header, format: c.format, width: c.width })),
    rows: rows.map((r) => use.map((c) => c.value(r))),
  };
}

export interface WorkbookMeta {
  title: string;
  /** free-form lines for the Notes sheet: filters, period, definitions */
  notes: string[];
  generatedAt?: Date;
}

const INDIAN_INT = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0';
const INDIAN_DEC = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';

export function numFmtFor(f: ColFormat | undefined): string | undefined {
  switch (f) {
    case 'int': return INDIAN_INT;
    case 'dec': return INDIAN_DEC;
    case 'inr': return `"₹"${INDIAN_INT}`;
    case 'pct': return '0.0%';
    case 'days':
    case 'hours': return '0.0';
    case 'date': return 'dd-mmm-yyyy';
    case 'datetime': return 'dd-mmm-yyyy hh:mm';
    default: return undefined;
  }
}

export function safeSheetName(name: string, used: Set<string>): string {
  let n = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  let i = 2;
  const base = n;
  while (used.has(n.toLowerCase())) {
    const suffix = ` (${i++})`;
    n = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(n.toLowerCase());
  return n;
}

function toExcelValue(v: CellValue, f: ColFormat | undefined): string | number | boolean | Date | null {
  if (v === null || v === undefined || v === '') return null;
  if ((f === 'date' || f === 'datetime') && typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0));
    return v;
  }
  return v;
}

export async function buildWorkbook(sheets: SheetSpec[], meta: WorkbookMeta): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Tracker';
  wb.created = meta.generatedAt ?? new Date();
  const used = new Set<string>();
  const notes = wb.addWorksheet(safeSheetName('Notes', used));
  notes.getColumn(1).width = 28;
  notes.getColumn(2).width = 110;
  notes.addRow([meta.title]).font = { bold: true, size: 14 };
  notes.addRow(['Generated', (meta.generatedAt ?? new Date()).toISOString()]);
  meta.notes.forEach((n) => notes.addRow(['', n]));
  notes.addRow([]);
  notes.addRow(['Sheet', 'Contents']).font = { bold: true };

  for (const s of sheets) {
    const name = safeSheetName(s.name, used);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.header, width: c.width ?? Math.min(60, Math.max(10, c.header.length + 2)) }));
    const hdr = ws.getRow(1);
    hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF292929' } };
    hdr.alignment = { vertical: 'middle', wrapText: true };
    hdr.height = 22;
    const widths = s.columns.map((c, i) => s.columns[i].width ?? Math.min(60, Math.max(10, c.header.length + 2)));
    s.rows.forEach((r) => {
      const row = ws.addRow(r.map((v, i) => toExcelValue(v, s.columns[i].format)));
      r.forEach((v, i) => {
        if (s.columns[i].width) return;
        const len = v === null || v === undefined ? 0 : String(v).length;
        widths[i] = Math.min(60, Math.max(widths[i], len + 2));
      });
      void row;
    });
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = widths[i];
      const nf = numFmtFor(c.format);
      if (nf) col.numFmt = nf;
      if (c.format && c.format !== 'text' && c.format !== 'date' && c.format !== 'datetime') col.alignment = { horizontal: 'right' };
    });
    // header must stay left/centre-aligned and keep its fill after column-level formats
    ws.getRow(1).eachCell((cell) => {
      cell.numFmt = 'General';
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    if (s.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    notes.addRow([name, s.note ?? `${s.rows.length.toLocaleString('en-IN')} rows`]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Neutralise spreadsheet formula injection in CSV text cells. */
export function safeCsvCell(v: CellValue): string | number | boolean {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) return `'${v}`;
  return v;
}

export function toCsv(sheet: SheetSpec): string {
  const data = [sheet.columns.map((c) => c.header), ...sheet.rows.map((r) => r.map(safeCsvCell))];
  return '﻿' + Papa.unparse(data, { newline: '\r\n' });
}

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const downloadCsv = (sheet: SheetSpec, fileName: string) => download(new Blob([toCsv(sheet)], { type: 'text/csv;charset=utf-8' }), fileName.endsWith('.csv') ? fileName : `${fileName}.csv`);

export async function downloadXlsx(sheets: SheetSpec[], meta: WorkbookMeta, fileName: string) {
  const blob = await buildWorkbook(sheets, meta);
  download(blob, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
