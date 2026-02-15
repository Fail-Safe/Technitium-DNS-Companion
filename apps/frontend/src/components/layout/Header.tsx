import {
    faBars,
    faBolt,
    faChartLine,
    faCheck,
    faCircleInfo,
    faDesktop,
    faFileLines,
    faGlobe,
    faMagnifyingGlass,
    faMoon,
    faPlug,
    faRightFromBracket,
    faShield,
    faSun,
    faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTheme } from "../../context/theme-context";
import { useAuth } from "../../context/useAuth";
import { useOptionalTechnitiumState } from "../../context/useTechnitiumState";
import { AboutModal } from "../common/AboutModal";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const headerRef = useRef<HTMLElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

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

    const ResizeObserverCtor =
      typeof ResizeObserver === "undefined" ? null : ResizeObserver;

    const resizeObserver =
      ResizeObserverCtor ?
        new ResizeObserverCtor(() => {
          setHeaderHeightVar();
        })
      : null;

    resizeObserver?.observe(headerEl);

    window.addEventListener("resize", setHeaderHeightVar);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", setHeaderHeightVar);
    };
  }, []);

  useEffect(() => {
    if (!actionsMenuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (actionsMenuRef.current?.contains(target)) {
        return;
      }

      setActionsMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [actionsMenuOpen]);

  const technitium = useOptionalTechnitiumState();
  const blockingStatus = technitium?.blockingStatus;

  const canShowDnsRuleOptimizer = Boolean(
    blockingStatus?.nodes?.some(
      (n) => n.advancedBlockingInstalled && n.advancedBlockingEnabled,
    ),
  );

  const links = [
    { to: "/", label: "Overview", end: true, icon: faChartLine },
    { to: "/logs", label: "DNS Logs", icon: faFileLines },
    { to: "/configuration", label: "DNS Filtering", icon: faShield },
    ...(canShowDnsRuleOptimizer ?
      [
        {
          to: "/advanced-blocking/rule-optimizer",
          label: "DNS Rule Optimizer",
          icon: faWandMagicSparkles,
        },
      ]
    : []),
    { to: "/dns-lookup", label: "DNS Lookup", icon: faMagnifyingGlass },
    { to: "/zones", label: "DNS Zones", icon: faGlobe },
    { to: "/dhcp", label: "DHCP Scopes", icon: faPlug },
  ];

  const handleAboutAction = () => {
    setActionsMenuOpen(false);
    setAboutOpen(true);
  };

  const handleThemeSelect = (nextTheme: "light" | "dark" | "system") => {
    setTheme(nextTheme);
    setActionsMenuOpen(false);
  };

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    setActionsMenuOpen(false);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

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
        <div className="app-header__actions" ref={actionsMenuRef}>
          <button
            className="app-header__actions-toggle"
            onClick={() => setActionsMenuOpen((open) => !open)}
            aria-label="Open menu"
            title="Menu"
            aria-haspopup="menu"
            aria-expanded={actionsMenuOpen}
          >
            <FontAwesomeIcon icon={faBars} />
          </button>
          {actionsMenuOpen && (
            <div className="app-header__actions-menu" role="menu">
              <button
                type="button"
                className="app-header__actions-item"
                onClick={handleAboutAction}
                role="menuitem"
              >
                <FontAwesomeIcon icon={faCircleInfo} />
                <span>About</span>
              </button>
              <div className="app-header__actions-group-label">Theme</div>
              <button
                type="button"
                className={`app-header__actions-item ${theme === "light" ? "app-header__actions-item--active" : ""}`}
                onClick={() => handleThemeSelect("light")}
                role="menuitemradio"
                aria-checked={theme === "light"}
              >
                <FontAwesomeIcon icon={faSun} />
                <span>Light</span>
                {theme === "light" && (
                  <span className="app-header__actions-item-check">
                    <FontAwesomeIcon icon={faCheck} />
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`app-header__actions-item ${theme === "dark" ? "app-header__actions-item--active" : ""}`}
                onClick={() => handleThemeSelect("dark")}
                role="menuitemradio"
                aria-checked={theme === "dark"}
              >
                <FontAwesomeIcon icon={faMoon} />
                <span>Dark</span>
                {theme === "dark" && (
                  <span className="app-header__actions-item-check">
                    <FontAwesomeIcon icon={faCheck} />
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`app-header__actions-item ${theme === "system" ? "app-header__actions-item--active" : ""}`}
                onClick={() => handleThemeSelect("system")}
                role="menuitemradio"
                aria-checked={theme === "system"}
              >
                <FontAwesomeIcon icon={faDesktop} />
                <span>{`System (${resolvedTheme === "dark" ? "Dark" : "Light"})`}</span>
                {theme === "system" && (
                  <span className="app-header__actions-item-check">
                    <FontAwesomeIcon icon={faCheck} />
                  </span>
                )}
              </button>
              <div className="app-header__actions-divider" aria-hidden="true" />
              <button
                type="button"
                className="app-header__actions-item app-header__actions-item--danger"
                onClick={() => {
                  void handleSignOut();
                }}
                role="menuitem"
                disabled={signingOut}
              >
                <FontAwesomeIcon icon={faRightFromBracket} />
                <span>{signingOut ? "Signing out..." : "Sign Out"}</span>
              </button>
            </div>
          )}
        </div>
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
