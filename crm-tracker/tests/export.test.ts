// Export tests: workbook structure (formatted, multi-sheet) and CSV safety.
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { SheetSpec, buildWorkbook, numFmtFor, safeCsvCell, safeSheetName, toCsv } from '../src/lib/export/excel';

async function load(blob: Blob): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

const demo: SheetSpec[] = [
  {
    name: 'Orders',
    note: '3 rows',
    columns: [{ header: 'Order ID' }, { header: 'Order date', format: 'date' }, { header: 'Value', format: 'inr' }, { header: 'Rate', format: 'pct' }, { header: 'Count', format: 'int' }],
    rows: [
      ['A1', '2026-10-05', 1234567, 0.256, 12],
      ['A2', '2026-10-06', 90, null, 0],
      ['=SUM(A1:A2)', null, 5, 1, 3],
    ],
  },
  { name: 'Orders', columns: [{ header: 'Dup name' }], rows: [['x']] },
];

describe('Excel workbook', () => {
  it('writes a Notes sheet plus every data sheet with unique, legal names', async () => {
    const wb = await load(await buildWorkbook(demo, { title: 'Demo', notes: ['Period: all', 'Rejected excluded'], generatedAt: new Date('2026-10-26T10:00:00Z') }));
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('Notes');
    expect(names).toContain('Orders');
    expect(names).toContain('Orders (2)');
    const notes = wb.getWorksheet('Notes')!;
    const text = notes.getSheetValues().flat().filter(Boolean).join('|');
    expect(text).toContain('Rejected excluded');
    expect(text).toContain('Demo');
  });

  it('freezes the header row, adds a filter and styles the header', async () => {
    const wb = await load(await buildWorkbook(demo, { title: 'Demo', notes: [] }));
    const ws = wb.getWorksheet('Orders')!;
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.getRow(1).values).toEqual([undefined, 'Order ID', 'Order date', 'Value', 'Rate', 'Count']);
  });

  it('keeps numbers numeric with number formats, real dates and blank cells blank', async () => {
    const wb = await load(await buildWorkbook(demo, { title: 'Demo', notes: [] }));
    const ws = wb.getWorksheet('Orders')!;
    const value = ws.getCell('C2');
    expect(value.value).toBe(1234567);
    expect(String(value.numFmt)).toContain('₹');
    expect(ws.getCell('D2').value).toBeCloseTo(0.256, 10);
    expect(ws.getCell('D2').numFmt).toBe('0.0%');
    const date = ws.getCell('B2').value as Date;
    expect(date).toBeInstanceOf(Date);
    expect(date.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(ws.getCell('B2').numFmt).toBe('dd-mmm-yyyy');
    // blank is not zero
    expect(ws.getCell('D3').value).toBeNull();
    expect(ws.getCell('E3').value).toBe(0);
  });

  it('formats Indian digit grouping', () => {
    expect(numFmtFor('int')).toContain('##\\,##\\,##0');
    expect(numFmtFor('text')).toBeUndefined();
    expect(numFmtFor('pct')).toBe('0.0%');
  });
});

describe('sheet names', () => {
  it('strips illegal characters, shortens to 31 characters and de-duplicates case-insensitively', () => {
    const used = new Set<string>();
    expect(safeSheetName('Orders/Value: [Q1]?', used)).toBe('Orders Value Q1');
    expect(safeSheetName('ORDERS VALUE Q1', used)).toBe('ORDERS VALUE Q1 (2)');
    const long = safeSheetName('A very long sheet name that exceeds thirty one characters', used);
    expect(long.length).toBeLessThanOrEqual(31);
    expect(safeSheetName('', used)).toBe('Sheet');
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas but leaves real numbers alone', () => {
    expect(safeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(safeCsvCell('+91 98')).toBe("'+91 98");
    expect(safeCsvCell('@cmd')).toBe("'@cmd");
    expect(safeCsvCell('-5')).toBe('-5');
    expect(safeCsvCell(-5)).toBe(-5);
    expect(safeCsvCell(null)).toBe('');
  });

  it('writes a BOM, CRLF line ends, quoting and escaping', () => {
    const csv = toCsv({ name: 'x', columns: [{ header: 'Name' }, { header: 'Note' }], rows: [['A, B', 'say "hi"'], ['=1+1', null]] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Name,Note');
    expect(lines[1]).toBe('"A, B","say ""hi"""');
    expect(lines[2]).toBe("'=1+1,");
  });
});
