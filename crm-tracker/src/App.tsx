import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';

const LandingPage = lazy(() => import('./pages/Landing').then((m) => ({ default: m.LandingPage })));
const Overview = lazy(() => import('./pages/Overview'));
const DealerOrders = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.DealerOrdersPage })));
const DsOrders = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.DsOrdersPage })));
const DealerComplaints = lazy(() => import('./pages/ComplaintsPage').then((m) => ({ default: m.DealerComplaintsPage })));
const DsComplaints = lazy(() => import('./pages/ComplaintsPage').then((m) => ({ default: m.DsComplaintsPage })));
const BizomUsage = lazy(() => import('./pages/BizomUsage'));
const BizomIssues = lazy(() => import('./pages/BizomIssues'));
const UsagePage = lazy(() => import('./pages/UsageReport').then((m) => ({ default: m.UsagePage })));
const HeroSmiles = lazy(() => import('./pages/HeroSmiles'));
const BizomVsDataSensePage = lazy(() => import('./pages/BizomVsDataSense').then((m) => ({ default: m.BizomVsDataSensePage })));
const ImportCentre = lazy(() => import('./pages/ImportCentre'));
const DataManagement = lazy(() => import('./pages/DataManagement'));

/** Pages that moved: old links keep working and keep their filters. */
function MovedTo({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="p-8"><Spinner label="Loading page" /></div>}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LandingPage />} />
          <Route path="overview" element={<Overview />} />
          <Route path="dealer/orders" element={<DealerOrders />} />
          <Route path="dealer/complaints" element={<DealerComplaints />} />
          <Route path="bizom/usage" element={<BizomUsage />} />
          <Route path="issues" element={<BizomIssues />} />
          <Route path="bizom/issues" element={<MovedTo to="/issues" />} />
          <Route path="datasense/orders" element={<DsOrders />} />
          <Route path="datasense/complaints" element={<DsComplaints />} />
          <Route path="datasense/employees" element={<UsagePage />} />
          <Route path="hero-smiles" element={<HeroSmiles />} />
          <Route path="compare/dealer-vs-datasense" element={<MovedTo to="/" />} />
          <Route path="compare/bizom-vs-sfa" element={<BizomVsDataSensePage />} />
          <Route path="import" element={<ImportCentre />} />
          <Route path="admin" element={<DataManagement />} />
          <Route path="*" element={<div className="p-8">Page not found.</div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
