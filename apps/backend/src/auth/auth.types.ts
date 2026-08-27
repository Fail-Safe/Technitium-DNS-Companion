export interface AuthSession {
  id: string;
  createdAt: string;
  lastSeenAt: number;
  user: string;
  authSource: "password" | "trusted-sso";
  technitiumUser: string;
  tokensByNodeId: Record<string, string>;
  nodeAuthStatesByNodeId?: Record<string, AuthNodeSessionState>;
}

export type TrustedSsoError =
  | "identity-not-authorized"
  | "invalid-proxy-assertion";

export interface TrustedSsoStatus {
  enabled: boolean;
  available: boolean;
  manualLoginAllowed: boolean;
  error?: TrustedSsoError;
  logoutUrl?: string;
}

export type TrustedSsoRequestClassification =
  | { kind: "disabled" | "direct" }
  | { kind: "invalid"; error: "invalid-proxy-assertion" }
  | { kind: "valid"; identity: string };

export interface AuthLoginRequestDto {
  username: string;
  password: string;
  totp?: string;
}

export interface AuthNodeLoginResult {
  nodeId: string;
  baseUrl: string;
  success: boolean;
  authState?: AuthNodeSessionState["status"];
  token?: string;
  status?: string;
  error?: string;
}

export interface AuthNodeSessionState {
  status: "authenticated" | "unreachable" | "failed";
  error?: string;
}

export interface AuthLoginResponseDto {
  authenticated: boolean;
  nodes: AuthNodeLoginResult[];
}

export interface AuthLoginFailureResponseDto {
  message: string;
  nodes: AuthNodeLoginFailureResult[];
}

export interface AuthNodeLoginFailureResult {
  nodeId: string;
  success: false;
  authState?: AuthNodeSessionState["status"];
  status?: string;
  error?: string;
}

export interface AuthMeResponseDto {
  sessionAuthEnabled: boolean;
  authenticated: boolean;
  user?: string;
  authSource?: AuthSession["authSource"];
  technitiumUser?: string;
  nodeIds?: string[];
  unreachableNodeIds?: string[];
  failedNodeIds?: string[];
  configuredNodeIds?: string[];
  trustedSso: TrustedSsoStatus;
  transport?: {
    requestSecure: boolean;
    httpsEnabled: boolean;
    trustProxyEnabled: boolean;
    forwardedProto?: string;
  };
  backgroundPtrToken?: {
    configured: boolean;
    sessionAuthEnabled: boolean;
    validated: boolean;
    okForPtr?: boolean;
    username?: string;
    reason?: string;
    tooPrivilegedSections?: string[];
  };
}
