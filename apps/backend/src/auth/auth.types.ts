export interface AuthSession {
  id: string;
  createdAt: string;
  lastSeenAt: number;
  user: string;
  tokensByNodeId: Record<string, string>;
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
  token?: string;
  status?: string;
  error?: string;
}

export interface AuthLoginResponseDto {
  authenticated: boolean;
  nodes: AuthNodeLoginResult[];
}

export interface AuthMeResponseDto {
  sessionAuthEnabled: boolean;
  authenticated: boolean;
  user?: string;
  nodeIds?: string[];
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
