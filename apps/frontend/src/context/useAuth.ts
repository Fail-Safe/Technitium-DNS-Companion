import { useContext } from "react";
import type { AuthContextValue } from "./AuthContext";
import { AuthContext } from "./authContextInstance";

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}

/**
 * Optional form of useAuth.
 *
 * This is useful for contexts (like TechnitiumContext) that can operate in a
 * limited mode without an AuthProvider (e.g., unit tests).
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext) ?? null;
}
