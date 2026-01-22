import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { BackgroundTokenSecurityBanner } from "../common/BackgroundTokenSecurityBanner";
import { NodeSessionExpiredBanner } from "../common/NodeSessionExpiredBanner";
import { TransportSecurityBanner } from "../common/TransportSecurityBanner";
import { Header } from "./Header";

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { status } = useAuth();
  const WIDE_ROUTE_PREFIXES = ["/logs", "/zones"];
  const isWideRoute = WIDE_ROUTE_PREFIXES.some((prefix) =>
    location.pathname.startsWith(prefix),
  );
  const mainClassName =
    isWideRoute ? "app-content app-content--wide" : "app-content";

  return (
    <div className="app-shell">
      <Header />
      <NodeSessionExpiredBanner
        sessionAuthEnabled={status?.sessionAuthEnabled}
        authenticated={status?.authenticated ?? false}
        configuredNodeIds={status?.configuredNodeIds}
        nodeIds={status?.nodeIds}
      />
      <TransportSecurityBanner
        sessionAuthEnabled={status?.sessionAuthEnabled}
        transport={status?.transport}
      />
      <BackgroundTokenSecurityBanner
        backgroundPtrToken={status?.backgroundPtrToken}
      />
      <main className={mainClassName}>{children}</main>
    </div>
  );
}
