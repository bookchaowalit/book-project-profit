// Server-side configuration. Pure: takes an env object so tests can inject values.

export type Env = Record<string, string | undefined>;

export interface WebConfig {
  webOrigin: string;
  issuer: URL;
  clientId: string;
  clientSecret: string;
  apiAudience: string | null;
  sessionKey: Uint8Array;
  apiOrigin: string;
  allowLoopback: boolean;
}

export const CONFIG_NAMES = [
  'WEB_ORIGIN',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'SESSION_KEY',
  'PROFIT_API_ORIGIN',
] as const;

export function loopbackAllowed(env: Env): boolean {
  return env.NODE_ENV !== 'production' && env.ALLOW_INSECURE_LOOPBACK === 'true';
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Exact origin (no path/credentials/wildcards). HTTPS; loopback http only when explicitly allowed. */
export function strictOrigin(value: string | undefined, allowLoopback: boolean): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (value !== url.origin && value !== `${url.origin}/`) return null;
    if (url.hostname.includes('*')) return null;
    const loopback = isLoopbackHost(url.hostname);
    if (url.protocol === 'https:') return loopback && !allowLoopback ? null : url.origin;
    if (url.protocol === 'http:' && allowLoopback && loopback) return url.origin;
    return null;
  } catch {
    return null;
  }
}

export function parseIssuer(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function parseSessionKey(value: string | undefined): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const key = Buffer.from(value, 'base64url');
  return key.length === 32 && key.toString('base64url') === value ? new Uint8Array(key) : null;
}

export interface Check {
  name: string;
  status: 'configured' | 'missing_or_invalid';
}
export type ConfigResult =
  | { ready: true; config: WebConfig; checks: Check[] }
  | { ready: false; checks: Check[] };

export function loadConfig(env: Env): ConfigResult {
  const allowLoopback = loopbackAllowed(env);
  const webOrigin = strictOrigin(env.WEB_ORIGIN, allowLoopback);
  const issuer = parseIssuer(env.OIDC_ISSUER);
  const sessionKey = parseSessionKey(env.SESSION_KEY);
  const apiOrigin = strictOrigin(env.PROFIT_API_ORIGIN, allowLoopback);
  const clientId = env.OIDC_CLIENT_ID?.trim() || null;
  const clientSecret = env.OIDC_CLIENT_SECRET || null;
  const valid: Record<(typeof CONFIG_NAMES)[number], boolean> = {
    WEB_ORIGIN: !!webOrigin,
    OIDC_ISSUER: !!issuer,
    OIDC_CLIENT_ID: !!clientId,
    OIDC_CLIENT_SECRET: !!clientSecret,
    SESSION_KEY: !!sessionKey,
    PROFIT_API_ORIGIN: !!apiOrigin,
  };
  const checks: Check[] = CONFIG_NAMES.map((name) => ({
    name,
    status: valid[name] ? 'configured' : 'missing_or_invalid',
  }));
  if (!webOrigin || !issuer || !clientId || !clientSecret || !sessionKey || !apiOrigin) {
    return { ready: false, checks };
  }
  const audience = env.OIDC_API_AUDIENCE?.trim();
  return {
    ready: true,
    checks,
    config: {
      webOrigin,
      issuer,
      clientId,
      clientSecret,
      apiAudience: audience ? audience : null,
      sessionKey,
      apiOrigin,
      allowLoopback,
    },
  };
}

/** The request Host must equal the configured origin's host exactly. */
export function hostAllowed(request: Request, config: WebConfig): boolean {
  return request.headers.get('host') === new URL(config.webOrigin).host;
}

/** Mutations need an Origin header exactly equal to the configured origin. */
export function mutationOriginAllowed(request: Request, config: WebConfig): boolean {
  return request.headers.get('origin') === config.webOrigin;
}
