import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedTheme, Theme } from "./theme-context";
import { STORAGE_KEY, ThemeContext } from "./theme-context";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ?
      "dark"
    : "light";
}

function getInitialTheme(): Theme {
  // 1. Check localStorage first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }

  // 2. Default to explicit system-follow mode
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] =
    useState<ResolvedTheme>(getSystemTheme);
  const transitionTimerRef = useRef<number | null>(null);

  const appliedTheme = useMemo(
    () => (theme === "system" ? resolvedTheme : theme),
    [theme, resolvedTheme],
  );

  const applyTransition = () => {
    document.documentElement.classList.add("theme-transitioning");
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }
    transitionTimerRef.current = window.setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
      transitionTimerRef.current = null;
    }, 300);
  };

  useEffect(() => {
    // Apply resolved theme to document root while preserving preference in localStorage
    document.documentElement.setAttribute("data-theme", appliedTheme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [appliedTheme, theme]);

  useEffect(() => {
    // Listen for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? "dark" : "light");
    };

    setResolvedTheme(mediaQuery.matches ? "dark" : "light");

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    // Fallback for older browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const toggleTheme = () => {
    applyTransition();
    setThemeState((prev) => {
      if (prev === "light") {
        return "dark";
      }

      if (prev === "dark") {
        return "system";
      }

      return "light";
    });
  };

  const setTheme = (newTheme: Theme) => {
    applyTransition();
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, toggleTheme, setTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
