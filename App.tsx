
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { StorageService } from './services/storage';
import DashboardPage from './pages/DashboardPage';
import EditorPage from './pages/EditorPage';
import PublicTAPPage from './pages/PublicTAPPage';
import LoginPage from './pages/LoginPage';
import WalletPage from './pages/WalletPage';

const ProtectedRoute = ({ children }: { children?: React.ReactNode }) => {
  const isAdmin = localStorage.getItem('tap_is_admin') === 'true';
  const location = useLocation();

  if (!isAdmin) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const HomeRoute = () => {
  const isAdmin = localStorage.getItem('tap_is_admin') === 'true';
  if (isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }
  return <LoginPage />;
};

const App: React.FC = () => {
  useEffect(() => {
    StorageService.init();
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-green-500/30">
        <Routes>
          {/* Admin Entry Point (Root) */}
          <Route path="/" element={<HomeRoute />} />
          
          {/* Public Album Routes */}
          <Route path="/:slug" element={<PublicTAPPage />} />
          <Route path="/:slug/wallet" element={<WalletPage />} />
          <Route path="/t/:slug" element={<PublicTAPPage />} />
          <Route path="/t/:slug/wallet" element={<WalletPage />} />

          {/* Legacy Admin Path Redirect */}
          <Route path="/admin" element={<Navigate to="/" replace />} />

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
      </div>
    </BrowserRouter>
  );
};

export default App;
