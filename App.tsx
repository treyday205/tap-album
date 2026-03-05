import React, { useEffect, Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { StorageService } from './services/storage';
import { API_BASE_URL } from './services/api';
import { AlbumAudioPlayerProvider } from './services/albumAudioPlayer';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const EditorPage = lazy(() => import('./pages/EditorPage'));
const PublicTAPPage = lazy(() => import('./pages/PublicTAPPage'));
const PublicTAPPagePerf = lazy(() => import('./pages/PublicTAPPagePerf'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const WalletPage = lazy(() => import('./pages/WalletPage'));
const AlbumPlayerPage = lazy(() => import('./pages/AlbumPlayerPage'));
const ADMIN_ENTRY_PATH = '/control-admin';
const ADMIN_DASHBOARD_PATH = '/control-admin/dashboard';
const ADMIN_EDITOR_BASE_PATH = '/control-admin/dashboard/edit';
const DEFAULT_ADMIN_ROOT_HOSTS = 'tap-album-production-bfdb.up.railway.app';
const PUBLIC_SITE_ENABLED =
  String(import.meta.env?.VITE_PUBLIC_SITE_ENABLED || 'false').toLowerCase() === 'true';
const PUBLIC_ALBUM_ENABLED =
  String(import.meta.env?.VITE_PUBLIC_ALBUM_ENABLED || 'true').toLowerCase() === 'true';

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

const shouldUseAdminRoot = () => {
  if (typeof window === 'undefined') return false;
  const mode = String(import.meta.env?.VITE_ROOT_ADMIN_MODE || '').trim().toLowerCase();
  if (mode === 'admin' || mode === 'true') return true;
  if (mode === 'public' || mode === 'false') return false;

  const configuredHosts = String(import.meta.env?.VITE_ROOT_ADMIN_HOSTS || DEFAULT_ADMIN_ROOT_HOSTS)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (configuredHosts.length === 0) return false;
  return configuredHosts.includes(window.location.hostname.toLowerCase());
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

const RootEntryRoute = () => {
  if (!PUBLIC_SITE_ENABLED) {
    return <AdminEntryRoute />;
  }
  if (isStandalonePwa()) {
    return <LandingPage />;
  }
  if (shouldUseAdminRoot()) {
    return <AdminEntryRoute />;
  }
  return <LandingPage />;
};

const FeaturesRoute = () => {
  if (!PUBLIC_SITE_ENABLED) {
    return <Navigate to={ADMIN_ENTRY_PATH} replace />;
  }
  if (shouldUseAdminRoot()) {
    return <Navigate to="/" replace />;
  }
  return <LandingPage />;
};

const PublicTAPRoute = () => {
  if (!PUBLIC_ALBUM_ENABLED) {
    return <Navigate to={ADMIN_ENTRY_PATH} replace />;
  }
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
      <AlbumAudioPlayerProvider>
        <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-green-500/30">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Public Marketing Entry (Root) */}
              <Route path="/" element={<RootEntryRoute />} />
              <Route path="/features" element={<FeaturesRoute />} />

              {/* Dedicated One Album Player */}
              <Route path="/album/:slug" element={<AlbumPlayerPage />} />

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
      </AlbumAudioPlayerProvider>
    </BrowserRouter>
  );
};

export default App;
