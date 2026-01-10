import { createContext } from "react";
import type { TechnitiumState } from "./TechnitiumContext";

// In development, Vite Fast Refresh can reload modules that define contexts.
// If the Context object identity changes, existing Providers won't match new
// Consumers, and hooks can throw even though a Provider exists.
// Cache the context instance on globalThis to keep it stable across HMR.
type GlobalWithTechnitiumContext = typeof globalThis & {
  __tdc_technitium_context__?: ReturnType<
    typeof createContext<TechnitiumState | undefined>
  >;
};

const globalWithTechnitiumContext = globalThis as GlobalWithTechnitiumContext;

export const TechnitiumContext: ReturnType<
  typeof createContext<TechnitiumState | undefined>
> =
  globalWithTechnitiumContext.__tdc_technitium_context__ ??
  (globalWithTechnitiumContext.__tdc_technitium_context__ = createContext<
    TechnitiumState | undefined
  >(undefined));
