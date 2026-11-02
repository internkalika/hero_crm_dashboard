// Sheet builders for the Executive Overview download: the management brief and the system figures behind it.
import type { SheetSpec } from './excel';
import type { ExecutiveBrief } from '../metrics/executive';

const TONE: Record<string, string> = { good: 'Positive', warn: 'Watch', bad: 'Concern', neutral: 'Context' };
const PRIORITY: Record<number, string> = { 1: 'Do first', 2: 'Next', 3: 'Then' };

export function briefSheets(b: ExecutiveBrief): SheetSpec[] {
  const items = (name: string, rows: ExecutiveBrief['takeaways']): SheetSpec => ({
    name,
    note: `Measurements for ${b.period}. None says what caused a change, and order value is sales, not profit.`,
    columns: [{ header: '#', format: 'int' }, { header: 'Statement', width: 60 }, { header: 'Detail', width: 90 }, { header: 'Figure' }, { header: 'Period' }, { header: 'Reading' }],
    rows: rows.map((r, i) => [i + 1, r.title, r.detail, r.metric, r.period, TONE[r.tone]]),
  });
  return [
    items('Management takeaways', b.takeaways),
    items('Key risks', b.risks),
    {
      name: 'Recommended actions',
      columns: [{ header: '#', format: 'int' }, { header: 'Priority' }, { header: 'Action', width: 70 }, { header: 'Why', width: 80 }],
      rows: b.actions.map((a, i) => [i + 1, PRIORITY[a.priority], a.title, a.why]),
    },
  ];
}

export interface FigureRow {
  system: string;
  measure: string;
  value: number | string | null;
  unit: string;
  basis: string;
}

/** One row per figure; Value is a plain number and Unit says what it is, so the sheet can be sorted and summed by measure. */
export function figuresSheet(rows: FigureRow[]): SheetSpec {
  return {
    name: 'System figures',
    note: 'Dealer App and DataSense figures are separate measures and are not added together. Blank means not available, not zero.',
    columns: [{ header: 'System' }, { header: 'Measure', width: 36 }, { header: 'Value' }, { header: 'Unit' }, { header: 'Basis', width: 40 }],
    rows: rows.map((r) => [r.system, r.measure, r.value, r.unit, r.basis]),
  };
}
