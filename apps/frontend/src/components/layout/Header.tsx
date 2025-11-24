import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine, faFileLines, faShield, faWrench, faGlobe, faPlug, faBolt } from '@fortawesome/free-solid-svg-icons';

export function Header() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const links = [
        { to: '/', label: 'Overview', end: true, icon: faChartLine },
        { to: '/logs', label: 'DNS Logs', icon: faFileLines },
        { to: '/configuration', label: 'DNS Filtering', icon: faShield },
        { to: '/dns-tools', label: 'DNS Tools', icon: faWrench },
        { to: '/zones', label: 'DNS Zones', icon: faGlobe },
        { to: '/dhcp', label: 'DHCP Scopes', icon: faPlug },
    ];

    return (
        <header className="app-header">
            <div className="app-header__brand">
                <span className="app-header__brand-icon"><FontAwesomeIcon icon={faBolt} /></span>
                <span className="app-header__brand-text">{__APP_NAME__}</span>
            </div>
            <button
                className="app-header__mobile-toggle"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle navigation"
                aria-expanded={mobileMenuOpen}
            >
                <span className={`hamburger ${mobileMenuOpen ? 'hamburger--open' : ''}`}>
                    <span></span>
                    <span></span>
                    <span></span>
                </span>
            </button>
            <nav className={`app-header__nav ${mobileMenuOpen ? 'app-header__nav--open' : ''}`}>
                {links.map((link) => (
                    <NavLink
                        key={link.to}
                        to={link.to}
                        end={link.end}
                        className={({ isActive }: { isActive: boolean }) =>
                            isActive ? 'nav-link active' : 'nav-link'
                        }
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        <span className="nav-link__icon"><FontAwesomeIcon icon={link.icon} /></span>
                        <span className="nav-link__label">{link.label}</span>
                    </NavLink>
                ))}
            </nav>
            {mobileMenuOpen && (
                <div
                    className="app-header__overlay"
                    onClick={() => setMobileMenuOpen(false)}
                />
            )}
        </header>
    );
}
