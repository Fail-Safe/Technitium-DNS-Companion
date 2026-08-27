import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AuthSession,
  TrustedSsoRequestClassification,
} from "./auth.types";

interface AuthRequestContextState {
  session?: AuthSession;
  trustedSsoRequest?: TrustedSsoRequestClassification;
}

const storage = new AsyncLocalStorage<AuthRequestContextState>();

export const AuthRequestContext = {
  run<T>(state: AuthRequestContextState, fn: () => T): T {
    return storage.run(state, fn);
  },

  getSession(): AuthSession | undefined {
    return storage.getStore()?.session;
  },

  setSession(session: AuthSession | undefined): void {
    const store = storage.getStore();
    if (!store) {
      return;
    }

    store.session = session;
  },

  getTrustedSsoRequest(): TrustedSsoRequestClassification | undefined {
    return storage.getStore()?.trustedSsoRequest;
  },
};
