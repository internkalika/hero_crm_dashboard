// File readers: CSV, XLSX, legacy XLS (BIFF), HTML-table "XLS" exports, and ZIP archives.
// All readers return the same neutral SheetData shape so that identification and
// normalisation do not care how the bytes arrived.
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { Cell, ReadFile, Row, SheetData } from '../types';
import { colLetter, isBlank, parseNumber } from '../util/parse';

export type Matrix = Cell[][];

/* ------------------------------ text decoding ------------------------------ */

function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/* ------------------------------ matrix -> sheet ------------------------------ */

function isTextual(c: Cell): boolean {
  if (typeof c !== 'string') return false;
  if (c.trim() === '') return false;
  const n = parseNumber(c);
  return n === null || Number.isNaN(n);
}

/** First row (within the top 25) with >=3 filled cells of which >=70% are non-numeric text. */
export function findHeaderRow(matrix: Matrix): number {
  const limit = Math.min(matrix.length, 25);
  for (let i = 0; i < limit; i++) {
    const filled = matrix[i].filter((c) => !isBlank(c));
    if (filled.length >= 3) {
      const text = filled.filter(isTextual).length;
      if (text / filled.length >= 0.7) return i;
    }
  }
  return 0;
}

export function matrixToSheet(name: string, matrix: Matrix, declared?: string, rowOffsets?: number[]): SheetData {
  if (matrix.length === 0) {
    return { name, headerRow: 1, columns: [], rows: [], rowNumbers: [], preamble: [], declaredDimension: declared, populatedRows: 0, blankRowsSkipped: 0 };
  }
  const hi = findHeaderRow(matrix);
  const headerCells = matrix[hi] ?? [];
  const width = Math.max(headerCells.length, ...matrix.slice(hi + 1).map((r) => r.length), 0);
  let lastCol = -1;
  for (let c = 0; c < width; c++) {
    if (!isBlank(headerCells[c])) lastCol = c;
    else if (matrix.slice(hi + 1).some((r) => !isBlank(r[c]))) lastCol = c;
  }
  const columns: string[] = [];
  const seen = new Map<string, number>();
  for (let c = 0; c <= lastCol; c++) {
    let label = isBlank(headerCells[c]) ? `Column ${colLetter(c)}` : String(headerCells[c]).replace(/\s+/g, ' ').trim();
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    if (n > 1) label = `${label} (${n})`;
    columns.push(label);
  }
  const rows: Row[] = [];
  const rowNumbers: number[] = [];
  let blank = 0;
  for (let r = hi + 1; r < matrix.length; r++) {
    const src = matrix[r];
    if (!src || src.every((c) => isBlank(c))) {
      blank++;
      continue;
    }
    const row: Row = {};
    for (let c = 0; c <= lastCol; c++) {
      const v = src[c];
      row[columns[c]] = isBlank(v) ? null : typeof v === 'string' ? v.replace(/ /g, ' ').trim() : (v as Cell);
    }
    rows.push(row);
    rowNumbers.push(rowOffsets ? rowOffsets[r] : r + 1);
  }
  const preamble: string[] = [];
  for (let r = 0; r < hi; r++) {
    const filled = matrix[r].filter((c) => !isBlank(c));
    if (filled.length) preamble.push(filled.join(' | '));
  }
  return {
    name,
    headerRow: rowOffsets ? rowOffsets[hi] : hi + 1,
    columns,
    rows,
    rowNumbers,
    preamble,
    declaredDimension: declared,
    populatedRows: rows.length,
    blankRowsSkipped: blank,
    hasMergedOrTitle: hi > 0,
  };
}

/* ---------------------------------- CSV ---------------------------------- */

export function readCsv(fileName: string, buf: ArrayBuffer): ReadFile {
  const text = decodeText(buf);
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false });
  const matrix: Matrix = (res.data as string[][]).map((r) => r.map((c) => (c === '' ? null : c)));
  while (matrix.length && matrix[matrix.length - 1].every((c) => isBlank(c))) matrix.pop();
  return { fileName, size: buf.byteLength, kind: 'csv', sheets: [matrixToSheet('CSV', matrix)] };
}

/* ------------------------------ HTML table "xls" ------------------------------ */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === '#') {
      const code = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[g.toLowerCase()] ?? m;
  });
}

export function parseHtmlTable(text: string): Matrix {
  const tables = text.match(/<table[\s\S]*?<\/table>/gi) ?? [text];
  let best: Matrix = [];
  for (const t of tables) {
    const rows: Matrix = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(t))) {
      const cells: Cell[] = [];
      const cellRe = /<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1]))) {
        const attrs = cm[2];
        const span = /colspan\s*=\s*["']?(\d+)/i.exec(attrs);
        const inner = decodeEntities(cm[3].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(inner === '' ? null : inner);
        const n = span ? Math.min(+span[1], 200) : 1;
        for (let i = 1; i < n; i++) cells.push(null);
      }
      rows.push(cells);
    }
    if (rows.length > best.length) best = rows;
  }
  return best;
}

/* ---------------------------------- XLSX / XLS ---------------------------------- */

function cellValue(cell: XLSX.CellObject, date1904: boolean): Cell {
  switch (cell.t) {
    case 'n': {
      const v = cell.v as number;
      if (cell.z && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
        const d = XLSX.SSF.parse_date_code(v, { date1904 });
        if (d) {
          const p = (n: number) => String(n).padStart(2, '0');
          const day = `${d.y}-${p(d.m)}-${p(d.d)}`;
          const secs = Math.round(d.S);
          return d.H || d.M || secs ? `${day}T${p(d.H)}:${p(d.M)}:${p(Math.min(secs, 59))}` : day;
        }
      }
      return v;
    }
    case 's': {
      const s = String(cell.v ?? '').replace(/ /g, ' ').trim();
      return s === '' ? null : s;
    }
    case 'b':
      return Boolean(cell.v);
    case 'd':
      return cell.v instanceof Date ? cell.v.toISOString().slice(0, 19) : String(cell.v);
    default:
      return null; // errors, stubs
  }
}

export function worksheetToMatrix(ws: XLSX.WorkSheet, date1904 = false): { matrix: Matrix; declared: string; rowOffsets: number[] } {
  const declared = ws['!ref'] ?? '';
  const byRow = new Map<number, Map<number, Cell>>();
  let maxC = -1;
  for (const key of Object.keys(ws)) {
    if (key.charCodeAt(0) === 33) continue; // '!ref', '!merges', ...
    const cell = ws[key] as XLSX.CellObject;
    if (!cell) continue;
    const v = cellValue(cell, date1904);
    if (v === null) continue;
    const a = XLSX.utils.decode_cell(key);
    let r = byRow.get(a.r);
    if (!r) byRow.set(a.r, (r = new Map()));
    r.set(a.c, v);
    if (a.c > maxC) maxC = a.c;
  }
  // Rows are rebuilt densely over the REAL populated range only, never the declared dimension.
  const rowIdx = [...byRow.keys()].sort((x, y) => x - y);
  const matrix: Matrix = [];
  const rowOffsets: number[] = [];
  let prev = -1;
  for (const r of rowIdx) {
    // keep blank rows between populated rows so row numbers stay meaningful
    for (let b = prev + 1; b < r && prev >= 0; b++) {
      matrix.push([]);
      rowOffsets.push(b + 1);
    }
    const cells = byRow.get(r)!;
    const line: Cell[] = new Array(maxC + 1).fill(null);
    cells.forEach((v, c) => (line[c] = v));
    matrix.push(line);
    rowOffsets.push(r + 1);
    prev = r;
  }
  return { matrix, declared, rowOffsets };
}

export function readWorkbook(fileName: string, buf: ArrayBuffer, kind: 'xlsx' | 'xls'): ReadFile {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellNF: true, cellDates: false, cellText: false, cellStyles: false, sheetStubs: false });
  const date1904 = Boolean((wb.Workbook as { WBProps?: { date1904?: boolean } } | undefined)?.WBProps?.date1904);
  const sheets: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const { matrix, declared, rowOffsets } = worksheetToMatrix(ws, date1904);
    sheets.push(matrixToSheet(name, matrix, declared, rowOffsets));
  }
  return { fileName, size: buf.byteLength, kind, sheets };
}

/* ---------------------------------- dispatcher ---------------------------------- */

export type DetectedKind = 'csv' | 'xlsx' | 'xls' | 'html-xls' | 'zip' | 'unknown';

export function detectKind(fileName: string, buf: ArrayBuffer): DetectedKind {
  const b = new Uint8Array(buf.slice(0, 8));
  if (b[0] === 0x50 && b[1] === 0x4b) {
    return /\.zip$/i.test(fileName) ? 'zip' : 'xlsx'; // xlsx is itself a zip
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'xls';
  const head = decodeText(buf.slice(0, 2048)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<') && /<(table|div|html|tr|thead|!doctype)/.test(head)) return 'html-xls';
  if (/\.(csv|txt)$/i.test(fileName)) return 'csv';
  if (/\.xlsx?$/i.test(fileName)) return /\.xlsx$/i.test(fileName) ? 'xlsx' : 'xls';
  return 'unknown';
}

export function readAny(fileName: string, buf: ArrayBuffer): ReadFile {
  const kind = detectKind(fileName, buf);
  switch (kind) {
    case 'csv':
      return readCsv(fileName, buf);
    case 'html-xls': {
      const matrix = parseHtmlTable(decodeText(buf));
      return { fileName, size: buf.byteLength, kind: 'html-xls', sheets: [matrixToSheet('HTML table', matrix)] };
    }
    case 'xlsx':
    case 'xls':
      return readWorkbook(fileName, buf, kind);
    default:
      throw new Error(`Unsupported or unreadable file type for "${fileName}".`);
  }
}

/* ---------------------------------- archives ---------------------------------- */

export interface FileInput {
  name: string;
  size: number;
  buffer: ArrayBuffer;
  /** where it came from (archive path / relative folder path) */
  origin?: string;
}

const IGNORE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)~\$/i;

export async function expandInputs(inputs: FileInput[], depth = 0): Promise<FileInput[]> {
  const out: FileInput[] = [];
  for (const f of inputs) {
    const kind = detectKind(f.name, f.buffer);
    if (kind === 'zip' && depth < 2) {
      const zip = await JSZip.loadAsync(f.buffer);
      const entries = Object.values(zip.files).filter((e) => !e.dir && !IGNORE.test(e.name));
      const inner: FileInput[] = [];
      for (const e of entries) {
        const buffer = await e.async('arraybuffer');
        inner.push({ name: e.name.split('/').pop() || e.name, size: buffer.byteLength, buffer, origin: `${f.name}/${e.name}` });
      }
      out.push(...(await expandInputs(inner, depth + 1)));
    } else if (!IGNORE.test(f.name)) {
      out.push(f);
    }
  }
  return out;
}
