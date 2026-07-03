export interface AuthSession {
  id: string;
  createdAt: string;
  lastSeenAt: number;
  user: string;
  tokensByNodeId: Record<string, string>;
  nodeAuthStatesByNodeId?: Record<string, AuthNodeSessionState>;
}

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
  nodeIds?: string[];
  unreachableNodeIds?: string[];
  failedNodeIds?: string[];
  configuredNodeIds?: string[];
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
