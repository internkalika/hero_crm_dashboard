// Dealer App adoption week by week: how many dealers have started ordering through the app, how many order each week,
// and the weekly orders and value of the two channels for those dealers. A click on a week reports on that week.
import { ChartCard, GroupedColumnsChart, SERIES_COLOR, TrendChart } from '../../components/charts';
import type { Adoption } from '../../lib/metrics/adoption';

export function AdoptionCharts({ adoption, onWeek }: { adoption: Adoption; onWeek: (weekStart: string) => void }) {
  const weeks = adoption.weeks;
  const channels = [
    { key: 'app', label: 'Dealer App', color: SERIES_COLOR.dealer },
    { key: 'ds', label: 'DataSense', color: SERIES_COLOR.ds },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Dealers using the Dealer App"
        subtitle="Weekly, from the first Dealer App order. Click a week to report on it."
        info={{ formula: 'Placed an order so far = dealers whose first Dealer App order (any status) is on or before the end of the week. Ordering that week = dealers with an eligible order in the week.' }}
        table={{ columns: [{ header: 'Week of' }, { header: 'Placed an order so far', format: 'int' }, { header: 'Ordering that week', format: 'int' }], rows: weeks.map((w) => [w.label, w.onboarded, w.appDealers]) }}
      >
        <TrendChart onSelect={onWeek} data={weeks.map((w) => ({ key: w.key, label: w.label, onboarded: w.onboarded, active: w.appDealers }))} series={[{ key: 'onboarded', label: 'Placed an order so far', color: SERIES_COLOR.dealer }, { key: 'active', label: 'Ordering that week', color: '#6250d6' }]} height={230} />
      </ChartCard>
      <ChartCard
        title="Orders per week"
        subtitle="Dealer App, and DataSense for the same dealers. Click a week to report on it."
        info={{ formula: 'Eligible orders by order date, weeks starting Monday', exclusions: 'Rejected orders. A week is shown once it is complete in the data.' }}
        table={{ columns: [{ header: 'Week of' }, { header: 'Dealer App', format: 'int' }, { header: 'DataSense', format: 'int' }], rows: weeks.map((w) => [w.label, w.appOrders, w.dsOrders]) }}
      >
        <GroupedColumnsChart onSelect={onWeek} format="int" height={230} data={weeks.map((w) => ({ key: w.key, label: w.label, app: w.appOrders, ds: w.dsOrders }))} series={channels} />
      </ChartCard>
      <div className="lg:col-span-2">
        <ChartCard
          title="Order value per week"
          subtitle="Dealer App, and DataSense for the same dealers. Click a week to report on it."
          info={{ formula: 'Σ order value of eligible orders by order date, weeks starting Monday' }}
          table={{ columns: [{ header: 'Week of' }, { header: 'Dealer App', format: 'inr' }, { header: 'DataSense', format: 'inr' }], rows: weeks.map((w) => [w.label, w.appValue, w.dsValue]) }}
        >
          <GroupedColumnsChart onSelect={onWeek} format="inr" height={230} data={weeks.map((w) => ({ key: w.key, label: w.label, app: w.appValue, ds: w.dsValue }))} series={channels} />
        </ChartCard>
      </div>
    </div>
  );
}
