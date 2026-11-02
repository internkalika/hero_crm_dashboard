// What is driving the change: a bridge from the comparison period to the reporting period (what each channel added or
// took away) and a few signal cards for the findings that apply. The sentence behind each card is in its "?" popover.
import { BridgeChart, BridgeStep, ChartCard } from '../../components/charts';
import { SignalCard, signalLabel } from '../../components/SignalCard';
import type { GrowthModel } from '../../lib/metrics/growth';
import { CH } from './shared';

/** Findings the bridge and the class tiles already show are not repeated as cards. */
const SHOWN_ELSEWHERE = new Set(['combined', 'classes']);

export function Drivers({ m, onGo }: { m: GrowthModel; onGo: (to: string) => void }) {
  const cards = m.insights.filter((i) => !SHOWN_ELSEWHERE.has(i.id));
  if (!m.comparison || !m.prev) {
    return (
      <section aria-label="What is driving growth" id="g-drivers" className="card scroll-mt-4 p-4 text-sm text-ink-3">
        Choose a comparison period to see what moved.
      </section>
    );
  }
  const showD = m.channels.dealer;
  const showS = m.channels.ds;
  const dealerDelta = (m.cur.dealer?.value ?? 0) - (m.prev.dealer?.value ?? 0);
  const dsDelta = (m.cur.ds?.value ?? 0) - (m.prev.ds?.value ?? 0);
  const before = (showD ? m.prev.dealer?.value ?? 0 : 0) + (showS ? m.prev.ds?.value ?? 0 : 0);
  const after = (showD ? m.cur.dealer?.value ?? 0 : 0) + (showS ? m.cur.ds?.value ?? 0 : 0);
  const steps: BridgeStep[] = [
    { key: 'before', label: m.comparison.label, kind: 'total', value: before, color: '#9b9a95' },
    ...(showD ? [{ key: 'dealer', label: CH.dealer.label, kind: 'delta' as const, value: dealerDelta, color: CH.dealer.color }] : []),
    ...(showS ? [{ key: 'ds', label: CH.ds.label, kind: 'delta' as const, value: dsDelta, color: CH.ds.color }] : []),
    { key: 'after', label: m.reporting.label, kind: 'total', value: after, color: CH.combined.color },
  ];
  return (
    <section aria-label="What is driving growth" id="g-drivers" className={`scroll-mt-4 grid gap-3 ${cards.length ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''}`}>
      <ChartCard
        title="Order value bridge"
        subtitle="From the comparison period to the reporting period: what each channel added or took away. Click a channel to filter the page."
        info={{ formula: 'Order value now − order value before, per channel (₹). Each order is counted once.', exclusions: 'Sales value, not profit.' }}
        table={{ columns: [{ header: 'Step' }, { header: 'Value', format: 'inr' }], rows: steps.map((s) => [s.label, s.value]) }}
      >
        <BridgeChart steps={steps} format="inr" onSelect={(k) => (k === 'dealer' || k === 'ds') && onGo(`/?f.channel=${k}&l.channel=${k === 'dealer' ? 'Dealer+App' : 'DataSense+SFA'}`)} />
      </ChartCard>
      {cards.length > 0 && (
        <div className="grid content-start gap-2">
          {cards.map((i) => (
            <SignalCard key={i.id} label={signalLabel(i.id, i.title)} metric={i.metric} period={i.period} tone={i.tone} detail={`${i.title}. ${i.detail}`} onClick={() => onGo(i.to)} />
          ))}
        </div>
      )}
    </section>
  );
}
