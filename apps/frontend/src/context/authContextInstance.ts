import { createContext } from "react";
import type { AuthContextValue } from "./AuthContext";

// In development, Vite Fast Refresh can reload modules that define contexts.
// If the Context object identity changes, existing Providers won't match new
// Consumers, and hooks can throw even though a Provider exists.
// Cache the context instance on globalThis to keep it stable across HMR.
type GlobalWithAuthContext = typeof globalThis & {
  __tdc_auth_context__?: ReturnType<
    typeof createContext<AuthContextValue | undefined>
  >;
};

const globalWithAuthContext = globalThis as GlobalWithAuthContext;

export const AuthContext: ReturnType<
  typeof createContext<AuthContextValue | undefined>
> =
  globalWithAuthContext.__tdc_auth_context__ ??
  (globalWithAuthContext.__tdc_auth_context__ = createContext<
    AuthContextValue | undefined
  >(undefined));
