import React, { useEffect, Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { StorageService } from './services/storage';
import { API_BASE_URL } from './services/api';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const EditorPage = lazy(() => import('./pages/EditorPage'));
const PublicTAPPage = lazy(() => import('./pages/PublicTAPPage'));
const PublicTAPPagePerf = lazy(() => import('./pages/PublicTAPPagePerf'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const WalletPage = lazy(() => import('./pages/WalletPage'));

const isAdminSession = () =>
  Boolean(localStorage.getItem('tap_admin_token')) ||
  localStorage.getItem('tap_is_admin') === 'true';

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
  const isAdmin = isAdminSession();
  const location = useLocation();

  if (!isAdmin) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const AdminEntryRoute = () => {
  const isAdmin = isAdminSession();

  if (isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LoginPage />;
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
            {/* Admin Entry Point (Root) */}
            <Route path="/" element={<AdminEntryRoute />} />
            <Route path="/admin/*" element={<AdminEntryRoute />} />
             
            {/* Public Album Routes */}
            <Route path="/:slug" element={<PublicTAPRoute />} />
            <Route path="/:slug/wallet" element={<WalletPage />} />
            <Route path="/t/:slug" element={<PublicTAPRoute />} />
            <Route path="/t/:slug/wallet" element={<WalletPage />} />

            {/* Administrator Only Routes */}
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/dashboard/edit/:projectId" 
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
