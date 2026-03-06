import { lazy, Suspense } from "react";
import {
    BrowserRouter,
    Navigate,
    Outlet,
    Route,
    Routes,
    useLocation,
} from "react-router-dom";
import "./App.css";
import { AppLayout } from "./components/layout/AppLayout";
import { InstallPrompt } from "./components/pwa/InstallPrompt";
import { OfflineBanner } from "./components/pwa/OfflineBanner";
import { getAuthRedirectReason } from "./config";
import { AuthProvider } from "./context/AuthContext";
import { TechnitiumProvider } from "./context/TechnitiumContext";
import { ToastProvider } from "./context/ToastContext";
import { useAuth } from "./context/useAuth";
import { useTechnitiumState } from "./context/useTechnitiumState";
import { isNodeSessionRequiredButMissing } from "./utils/authSession";

// Lazy load ALL pages for optimal code splitting
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const ConfigurationPage = lazy(() => import("./pages/ConfigurationPage"));
const LogsPage = lazy(() => import("./pages/LogsPage"));
const DhcpPage = lazy(() => import("./pages/DhcpPage"));
const ZonesPage = lazy(() => import("./pages/ZonesPage"));
const DnsLookupPage = lazy(() => import("./pages/DnsLookupPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const AdvancedBlockingRuleOptimizerPage = lazy(
  () => import("./pages/AdvancedBlockingRuleOptimizerPage"),
);

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
      <p className="text-gray-600">Loading...</p>
    </div>
  </div>
);

function RequireAuth() {
  const { status, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <PageLoader />;
  }

  // If any API request observed a 401, we store a redirect reason in
  // sessionStorage. Redirecting here prevents protected pages (like DNS Logs)
  // from getting stuck spamming 401s when the auth status hasn't refreshed yet.
  const redirectReason = getAuthRedirectReason();
  if (redirectReason) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location, reason: redirectReason }}
      />
    );
  }

  if (!status?.authenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (isNodeSessionRequiredButMissing(status)) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location, reason: "node-session-expired" }}
      />
    );
  }

  return (
    <RequireOptimizerRouteGate>
      <Outlet />
    </RequireOptimizerRouteGate>
  );
}

function RequireOptimizerRouteGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const location = useLocation();
  const { blockingStatus, nodes } = useTechnitiumState();

  const optimizerEnabled = Boolean(
    blockingStatus?.nodes?.some((n) => n.advancedBlockingInstalled) ||
    nodes.some((node) => node.hasAdvancedBlocking === true),
  );

  if (
    location.pathname.startsWith("/advanced-blocking/rule-optimizer") &&
    !optimizerEnabled
  ) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <TechnitiumProvider>
          <BrowserRouter
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <OfflineBanner />
            <AppLayout>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route element={<RequireAuth />}>
                    <Route path="/" element={<OverviewPage />} />
                    <Route
                      path="/configuration"
                      element={<ConfigurationPage />}
                    />
                    <Route path="/dhcp" element={<DhcpPage />} />
                    <Route path="/logs" element={<LogsPage />} />
                    <Route path="/zones" element={<ZonesPage />} />
                    <Route path="/dns-lookup" element={<DnsLookupPage />} />
                    <Route
                      path="/advanced-blocking/rule-optimizer"
                      element={<AdvancedBlockingRuleOptimizerPage />}
                    />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </AppLayout>
            <InstallPrompt />
          </BrowserRouter>
        </TechnitiumProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
