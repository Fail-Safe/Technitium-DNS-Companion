import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import './App.css';
import { TechnitiumProvider } from './context/TechnitiumContext';
import { ToastProvider } from './context/ToastContext';
import { AppLayout } from './components/layout/AppLayout';
import { InstallPrompt } from './components/pwa/InstallPrompt';
import { OfflineBanner } from './components/pwa/OfflineBanner';

// Lazy load ALL pages for optimal code splitting
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const ConfigurationPage = lazy(() => import('./pages/ConfigurationPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const DhcpPage = lazy(() => import('./pages/DhcpPage'));
const ZonesPage = lazy(() => import('./pages/ZonesPage'));
const DnsLookupPage = lazy(() => import('./pages/DnsLookupPage'));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
      <p className="text-gray-600">Loading...</p>
    </div>
  </div>
);

export default function App() {
  return (
    <TechnitiumProvider>
      <ToastProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <OfflineBanner />
          <AppLayout>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/configuration" element={<ConfigurationPage />} />
                <Route path="/dhcp" element={<DhcpPage />} />
                <Route path="/logs" element={<LogsPage />} />
                <Route path="/zones" element={<ZonesPage />} />
                <Route path="/dns-lookup" element={<DnsLookupPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppLayout>
          <InstallPrompt />
        </BrowserRouter>
      </ToastProvider>
    </TechnitiumProvider>
  );
}
