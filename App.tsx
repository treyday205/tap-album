import React, { useEffect, Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { StorageService } from './services/storage';
import { API_BASE_URL } from './services/api';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const EditorPage = lazy(() => import('./pages/EditorPage'));
const PublicTAPPage = lazy(() => import('./pages/PublicTAPPage'));
const PublicTAPPagePerf = lazy(() => import('./pages/PublicTAPPagePerf'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const WalletPage = lazy(() => import('./pages/WalletPage'));
const ADMIN_ENTRY_PATH = '/control-admin';
const ADMIN_DASHBOARD_PATH = '/control-admin/dashboard';
const ADMIN_EDITOR_BASE_PATH = '/control-admin/dashboard/edit';

const isAdminSession = () =>
  Boolean(localStorage.getItem('tap_admin_token')) ||
  localStorage.getItem('tap_is_admin') === 'true';

const isStandalonePwa = () => {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any)?.standalone === true
  );
};

const resolvePublicPerfFlag = () => {
  const envValue = String(import.meta.env?.VITE_PUBLIC_PERF_V2 || '').toLowerCase();
  const envEnabled = envValue === 'true';
  const envDisabled = envValue === 'false';
  const localOverride = typeof window !== 'undefined' ? localStorage.getItem('PUBLIC_PERF_V2') : null;
  const localEnabled = localOverride === 'true';
  const localDisabled = localOverride === 'false';
  if (localEnabled) return true;
  if (localDisabled) return false;
  if (envEnabled) return true;
  if (envDisabled) return false;
  return false;
};

const ProtectedRoute = ({ children }: { children?: React.ReactNode }) => {
  if (isStandalonePwa()) {
    return <Navigate to="/" replace />;
  }

  const isAdmin = isAdminSession();
  const location = useLocation();

  if (!isAdmin) {
    return <Navigate to={ADMIN_ENTRY_PATH} state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const AdminEntryRoute = () => {
  if (isStandalonePwa()) {
    return <Navigate to="/" replace />;
  }

  const isAdmin = isAdminSession();

  if (isAdmin) {
    return <Navigate to={ADMIN_DASHBOARD_PATH} replace />;
  }

  return <LoginPage />;
};

const LegacyDashboardEditRoute = () => {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) {
    return <Navigate to={ADMIN_DASHBOARD_PATH} replace />;
  }
  return <Navigate to={`${ADMIN_EDITOR_BASE_PATH}/${projectId}`} replace />;
};

const PublicTAPRoute = () => {
  const [usePerf] = useState(resolvePublicPerfFlag);
  const Page = usePerf ? PublicTAPPagePerf : PublicTAPPage;
  return <Page />;
};

const RouteFallback = () => (
  <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-6">
    <div className="w-full max-w-md space-y-4">
      <div className="h-6 w-3/4 bg-slate-800/70 rounded-full animate-pulse" />
      <div className="h-4 w-full bg-slate-800/50 rounded-full animate-pulse" />
      <div className="h-4 w-5/6 bg-slate-800/50 rounded-full animate-pulse" />
      <div className="h-10 w-full bg-slate-800/70 rounded-2xl animate-pulse" />
    </div>
  </div>
);

const App: React.FC = () => {
  useEffect(() => {
    StorageService.init();
    console.info('[TAP] API base URL:', API_BASE_URL || '(relative)');
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-green-500/30">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Public Marketing Entry (Root) */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/features" element={<LandingPage />} />

            {/* Non-Public Admin Entry */}
            <Route path={ADMIN_ENTRY_PATH} element={<AdminEntryRoute />} />
            <Route path="/admin/*" element={<Navigate to="/" replace />} />
            <Route path="/dashboard" element={<Navigate to={ADMIN_DASHBOARD_PATH} replace />} />
            <Route path="/dashboard/edit/:projectId" element={<LegacyDashboardEditRoute />} />
             
            {/* Public Album Routes */}
            <Route path="/:slug" element={<PublicTAPRoute />} />
            <Route path="/:slug/wallet" element={<WalletPage />} />
            <Route path="/t/:slug" element={<PublicTAPRoute />} />
            <Route path="/t/:slug/wallet" element={<WalletPage />} />

            {/* Administrator Only Routes */}
            <Route 
              path={ADMIN_DASHBOARD_PATH} 
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              } 
            />
            <Route 
              path={`${ADMIN_EDITOR_BASE_PATH}/:projectId`} 
              element={
                <ProtectedRoute>
                  <EditorPage />
                </ProtectedRoute>
              } 
            />
            
            {/* Fallback */}
            <Route path="*" element={<div className="flex items-center justify-center h-screen font-bold text-slate-500 italic text-center px-6">404 - Area Restricted or Link Expired</div>} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
};

export default App;
