// Profitability (honestly unverified) and models billed per dealer (MBD) on the comparison page.
import { BadgeHelp, CircleSlash, ShieldAlert } from 'lucide-react';
import { KpiCard, KpiGrid } from '../../components/KpiCard';
import { BarsChart, ChartCard } from '../../components/charts';
import { DownloadMenu } from '../../components/DownloadMenu';
import { fInt } from '../../lib/export/format';
import type { GrowthModel, KpiPair } from '../../lib/metrics/growth';
import type { ProfitabilityCheck } from '../../lib/metrics/profitability';
import { CH, fSignedPct, fUnit } from './shared';

const row = (m: GrowthModel, id: string): KpiPair | undefined => m.kpis.find((k) => k.id === id);

export function Profitability({ check, m, onDownload }: { check: ProfitabilityCheck; m: GrowthModel; onDownload: () => void | Promise<void> }) {
  // proxies that ARE in the data: sales value, quantity, order frequency, order value, selling price, fulfilment, rejection
  const perDealer = (s: { orders: number; activeDealers: number } | null) => (s && s.activeDealers > 0 ? s.orders / s.activeDealers : null);
  const proxies: Array<{ label: string; dealer: number | null; ds: number | null; dealerPrev: number | null; dsPrev: number | null; unit: KpiPair['unit']; help: string }> = [
    { label: 'Sales value', dealer: row(m, 'value')?.dealer ?? null, ds: row(m, 'value')?.ds ?? null, dealerPrev: row(m, 'value')?.dealerPrev ?? null, dsPrev: row(m, 'value')?.dsPrev ?? null, unit: 'inr', help: 'Order value before any discount, scheme, return or cost.' },
    { label: 'Cycles quantity', dealer: row(m, 'qty')?.dealer ?? null, ds: row(m, 'qty')?.ds ?? null, dealerPrev: row(m, 'qty')?.dealerPrev ?? null, dsPrev: row(m, 'qty')?.dsPrev ?? null, unit: 'int', help: 'Volume sold.' },
    { label: 'Order frequency (orders per active dealer)', dealer: perDealer(m.cur.dealer), ds: perDealer(m.cur.ds), dealerPrev: perDealer(m.prev?.dealer ?? null), dsPrev: perDealer(m.prev?.ds ?? null), unit: 'dec', help: 'More frequent, smaller orders can mean more handling cost per cycle; that cost is not in the data.' },
    { label: 'Average order value', dealer: row(m, 'aov')?.dealer ?? null, ds: row(m, 'aov')?.ds ?? null, dealerPrev: row(m, 'aov')?.dealerPrev ?? null, dsPrev: row(m, 'aov')?.dsPrev ?? null, unit: 'inr', help: 'Larger orders spread fixed cost, but cost is not in the data.' },
    { label: 'Average selling price', dealer: row(m, 'asp')?.dealer ?? null, ds: row(m, 'asp')?.ds ?? null, dealerPrev: row(m, 'asp')?.dealerPrev ?? null, dsPrev: row(m, 'asp')?.dsPrev ?? null, unit: 'inr', help: 'A higher price per cycle is a better mix or price; it is not margin.' },
    { label: 'Fulfilment (Dealer App) / billed share (DataSense)', dealer: m.cur.dealer?.fulfilmentRate ?? null, ds: m.cur.ds?.fulfilmentRate ?? null, dealerPrev: m.prev?.dealer?.fulfilmentRate ?? null, dsPrev: m.prev?.ds?.fulfilmentRate ?? null, unit: 'pct', help: 'Dealer App: fulfilled ÷ ordered quantity. DataSense: orders billed or dispatched ÷ eligible orders. The two are not the same measure.' },
    { label: 'Rejection rate', dealer: row(m, 'rejection')?.dealer ?? null, ds: row(m, 'rejection')?.ds ?? null, dealerPrev: row(m, 'rejection')?.dealerPrev ?? null, dsPrev: row(m, 'rejection')?.dsPrev ?? null, unit: 'pct', help: 'Rejected orders are lost sales.' },
  ];
  return (
    <section aria-label="Profitability" id="g-profit" className="scroll-mt-4 space-y-3">
      <KpiGrid cols={3}>
        <KpiCard compact icon={ShieldAlert} tone={check.verified ? 'good' : 'warn'} label="Profitability" value={check.verified ? 'Fields found' : 'Not verified'} sub="sales value only, never profit" info={{ formula: check.statement }} />
        <KpiCard compact icon={BadgeHelp} label="Cost fields found" value={fInt(check.found.length)} sub={`${fInt(check.columnsChecked)} columns in ${check.inspected.length} files checked`} info={{ formula: 'Looks for cost, margin, discount, return, freight, incentive and contribution columns in every imported file.' }} />
        <KpiCard compact icon={CircleSlash} label="Data still needed" value={fInt(check.requirements.length)} sub="inputs to measure margin" />
      </KpiGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">What the data does show (sales, not margin)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-ink-2">
                  <th className="py-1 pr-2 font-semibold">Measure</th>
                  <th className="px-2 py-1 text-right font-semibold" style={{ color: CH.dealer.color }}>Dealer App</th>
                  <th className="px-2 py-1 text-right font-semibold" style={{ color: CH.ds.color }}>DataSense</th>
                  <th className="px-2 py-1 text-right font-semibold">Dealer App was</th>
                  <th className="px-2 py-1 text-right font-semibold">DataSense was</th>
                </tr>
              </thead>
              <tbody>
                {proxies.map((p) => (
                  <tr key={p.label} className="border-b border-slate-100" title={p.help}>
                    <td className="py-1.5 pr-2 text-ink">{p.label}</td>
                    <td className="tnum px-2 py-1.5 text-right font-medium">{p.unit === 'dec' ? (p.dealer === null ? '—' : p.dealer.toFixed(1)) : fUnit(p.dealer, p.unit)}</td>
                    <td className="tnum px-2 py-1.5 text-right font-medium">{p.unit === 'dec' ? (p.ds === null ? '—' : p.ds.toFixed(1)) : fUnit(p.ds, p.unit)}</td>
                    <td className="tnum px-2 py-1.5 text-right text-ink-3">{p.unit === 'dec' ? (p.dealerPrev === null ? '—' : p.dealerPrev.toFixed(1)) : fUnit(p.dealerPrev, p.unit)}</td>
                    <td className="tnum px-2 py-1.5 text-right text-ink-3">{p.unit === 'dec' ? (p.dsPrev === null ? '—' : p.dsPrev.toFixed(1)) : fUnit(p.dsPrev, p.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold">Data needed to verify profit</h3>
            <DownloadMenu label="Download the data-needed list" items={[{ label: 'Data needed (Excel)', run: onDownload }]} />
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {check.requirements.map((r) => (
              <li key={r.item} title={r.why} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-ink-2">
                <CircleSlash size={12} className="shrink-0 text-ink-3" aria-hidden />
                {r.item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function MbdSection({ m, onModels, onDealer }: { m: GrowthModel; onModels: () => void; onDealer: (key: string, name: string) => void }) {
  const b = m.mbd;
  if (!b || b.cur === null) {
    return (
      <section aria-label="Models billed per dealer" id="g-mbd" className="card scroll-mt-4 p-4 text-sm text-ink-3">
        No eligible Dealer App order in the reporting period.
      </section>
    );
  }
  const change = b.prev !== null && b.prev !== 0 ? (b.cur - b.prev) / b.prev : null;
  const top = m.rows.filter((r) => r.mbd !== null && r.mbd > 0).sort((x, y) => (y.mbd ?? 0) - (x.mbd ?? 0)).slice(0, 12);
  return (
    <section aria-label="Models billed per dealer" id="g-mbd" className="grid scroll-mt-4 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <KpiCard
        label="Models billed per dealer"
        value={b.cur.toFixed(1)}
        sub={`${fInt(b.dealersCur)} dealers · ${fInt(b.models)} models`}
        trend={m.comparison && b.prev !== null && change !== null ? { text: `${fSignedPct(change, 0)} vs ${b.prev.toFixed(1)}`, dir: change > 0 ? 'up' : change < 0 ? 'down' : 'flat', good: true } : undefined}
        onClick={onModels}
        hint="Opens the models and MBD per dealer."
        info={{ formula: 'Distinct models (SKU brand) with at least one billed line, per Dealer App dealer, averaged over dealers with an eligible order.', exclusions: 'Dealer App only: the DataSense order report has no model field, so there is no DataSense MBD.' }}
      />
      <ChartCard
        title="Models billed by dealer"
        subtitle="Distinct models billed through the Dealer App in the reporting period. Click a dealer to filter the page."
        info={{ formula: 'Distinct models with a billed line, per dealer' }}
        table={{ columns: [{ header: 'Dealer' }, { header: 'Models billed', format: 'int' }], rows: top.map((r) => [r.name, r.mbd]) }}
      >
        <BarsChart data={top.map((r) => ({ key: r.key, label: r.name, value: r.mbd ?? 0, color: CH.dealer.color }))} format="int" onSelect={onDealer} seriesName="Models billed" />
      </ChartCard>
    </section>
  );
}
