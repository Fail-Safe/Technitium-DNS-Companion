import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Header } from './Header';

export function AppLayout({ children }: { children: ReactNode }) {
    const location = useLocation();
    const WIDE_ROUTE_PREFIXES = ['/logs', '/zones'];
    const isWideRoute = WIDE_ROUTE_PREFIXES.some((prefix) => location.pathname.startsWith(prefix));
    const mainClassName = isWideRoute ? 'app-content app-content--wide' : 'app-content';

    return (
        <div className="app-shell">
            <Header />
            <main className={mainClassName}>{children}</main>
        </div>
    );
}
