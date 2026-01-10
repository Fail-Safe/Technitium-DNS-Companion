import {
  faBolt,
  faChartLine,
  faCircleInfo,
  faFileLines,
  faGlobe,
  faMagnifyingGlass,
  faMoon,
  faPlug,
  faShield,
  faSun,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTheme } from "../../context/theme-context";
import { AboutModal } from "../common/AboutModal";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const headerEl = headerRef.current;
    if (!headerEl) {
      return;
    }

    const setHeaderHeightVar = () => {
      const height = headerEl.getBoundingClientRect().height;
      if (Number.isFinite(height) && height > 0) {
        document.documentElement.style.setProperty(
          "--app-header-height",
          `${Math.round(height)}px`,
        );
      }
    };

    setHeaderHeightVar();

    const resizeObserver = new ResizeObserver(() => {
      setHeaderHeightVar();
    });

    resizeObserver.observe(headerEl);

    window.addEventListener("resize", setHeaderHeightVar);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", setHeaderHeightVar);
    };
  }, []);

  const links = [
    { to: "/", label: "Overview", end: true, icon: faChartLine },
    { to: "/logs", label: "DNS Logs", icon: faFileLines },
    { to: "/configuration", label: "DNS Filtering", icon: faShield },
    { to: "/dns-lookup", label: "DNS Lookup", icon: faMagnifyingGlass },
    { to: "/zones", label: "DNS Zones", icon: faGlobe },
    { to: "/dhcp", label: "DHCP Scopes", icon: faPlug },
  ];

  return (
    <header className="app-header" ref={headerRef}>
      <div className="app-header__brand">
        <span className="app-header__brand-icon">
          <FontAwesomeIcon icon={faBolt} />
        </span>
        <span className="app-header__brand-text">{__APP_NAME__}</span>
      </div>
      <nav
        className={`app-header__nav ${mobileMenuOpen ? "app-header__nav--open" : ""}`}
      >
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }: { isActive: boolean }) =>
              isActive ? "nav-link active" : "nav-link"
            }
            onClick={() => setMobileMenuOpen(false)}
          >
            <span className="nav-link__icon">
              <FontAwesomeIcon icon={link.icon} />
            </span>
            <span className="nav-link__label">{link.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="app-header__controls">
        <button
          className="app-header__theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          <FontAwesomeIcon icon={theme === "light" ? faMoon : faSun} />
        </button>
        <button
          className="app-header__info-toggle"
          onClick={() => setAboutOpen(true)}
          aria-label="About this application"
          title="About"
        >
          <FontAwesomeIcon icon={faCircleInfo} />
        </button>
        <button
          className="app-header__mobile-toggle"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle navigation"
          aria-expanded={mobileMenuOpen}
        >
          <span
            className={`hamburger ${mobileMenuOpen ? "hamburger--open" : ""}`}
          >
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
      </div>
      {mobileMenuOpen && (
        <div
          className="app-header__overlay"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <AboutModal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} />
    </header>
  );
}
