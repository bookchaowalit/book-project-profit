import { hostAllowed, loadConfig, mutationOriginAllowed, type Env } from './config';
import { AuthFlowError, sessionInputFromTokens, type AuthFailure, type OidcPort } from './oidc';
import {
  clearCookie,
  createSession,
  parseCookie,
  readSession,
  readTransaction,
  sealTransaction,
  serializeCookie,
  SessionError,
  SESSION_COOKIE,
  TRANSACTION_COOKIE,
  TRANSACTION_MAX_SECONDS,
  systemClock,
  type Clock,
} from './session';

export interface Deps {
  env: Env;
  oidc: OidcPort;
  now?: Clock;
}

const NO_STORE = { 'cache-control': 'no-store' };

export function jsonResponse(status: number, body: unknown, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...NO_STORE, ...extra },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message, request_id: null } });
}

export const CONFIG_REQUIRED = () =>
  errorResponse(503, 'configuration_required', 'ระบบยังไม่ได้ตั้งค่าการเข้าสู่ระบบ');
const HOST_REJECTED = () => errorResponse(403, 'forbidden', 'โดเมนนี้ไม่ได้รับอนุญาต');

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ location, ...NO_STORE });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function failureRedirect(webOrigin: string, reason: AuthFailure, cookies: string[]): Response {
  return redirect(`${webOrigin}/?auth_error=${reason}`, cookies);
}

export async function handleLogin(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'ไม่รองรับวิธีนี้');
  const loaded = loadConfig(deps.env);
  if (!loaded.ready) return CONFIG_REQUIRED();
  const { config } = loaded;
  if (!hostAllowed(request, config)) return HOST_REJECTED();
  try {
    const { url, transaction } = await deps.oidc.begin(config, `${config.webOrigin}/api/auth/callback`);
    if (url.protocol !== 'https:' && !config.allowLoopback) throw new AuthFlowError('provider_unavailable');
    const sealed = await sealTransaction(transaction, config, deps.now);
    return redirect(url.href, [serializeCookie(TRANSACTION_COOKIE, sealed, TRANSACTION_MAX_SECONDS)]);
  } catch (error) {
    const reason: AuthFailure = error instanceof AuthFlowError ? error.reason : 'provider_unavailable';
    return failureRedirect(config.webOrigin, reason, []);
  }
}

export async function handleCallback(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'ไม่รองรับวิธีนี้');
  const loaded = loadConfig(deps.env);
  if (!loaded.ready) return CONFIG_REQUIRED();
  const { config } = loaded;
  if (!hostAllowed(request, config)) return HOST_REJECTED();
  const now = deps.now ?? systemClock;
  // The transaction is single-use: always cleared, whatever the outcome.
  const clear = clearCookie(TRANSACTION_COOKIE);
  const transaction = await readTransaction(
    parseCookie(request.headers.get('cookie'), TRANSACTION_COOKIE),
    config,
    now,
  );
  if (!transaction) return failureRedirect(config.webOrigin, 'invalid', [clear]);
  try {
    const callback = new URL(`${config.webOrigin}/api/auth/callback${new URL(request.url).search}`);
    const tokens = await deps.oidc.exchange(config, callback, transaction);
    const input = sessionInputFromTokens(tokens, config, now());
    const session = await createSession(input, config, now);
    return redirect(`${config.webOrigin}/`, [
      clear,
      serializeCookie(SESSION_COOKIE, session.value, session.maxAge),
    ]);
  } catch (error) {
    const reason: AuthFailure =
      error instanceof AuthFlowError
        ? error.reason
        : error instanceof SessionError
          ? error.code === 'cookie_too_large'
            ? 'session_too_large'
            : 'expired'
          : 'provider_unavailable';
    return failureRedirect(config.webOrigin, reason, [clear, clearCookie(SESSION_COOKIE)]);
  }
}

export async function handleSession(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'ไม่รองรับวิธีนี้');
  const loaded = loadConfig(deps.env);
  if (!loaded.ready) return CONFIG_REQUIRED();
  if (!hostAllowed(request, loaded.config)) return HOST_REJECTED();
  const session = await readSession(
    parseCookie(request.headers.get('cookie'), SESSION_COOKIE),
    loaded.config,
    deps.now,
  );
  return jsonResponse(200, session ? { authenticated: true, user: { displayName: session.displayName } } : { authenticated: false });
}

export async function handleLogout(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'ไม่รองรับวิธีนี้');
  const loaded = loadConfig(deps.env);
  if (!loaded.ready) return CONFIG_REQUIRED();
  if (!hostAllowed(request, loaded.config) || !mutationOriginAllowed(request, loaded.config)) {
    return HOST_REJECTED();
  }
  return jsonResponse(200, { authenticated: false }, { 'set-cookie': clearCookie(SESSION_COOKIE) });
}

/** Safe readiness: configuration only; never upstream liveness, never values. */
export function handleHealth(deps: Deps): Response {
  const loaded = loadConfig(deps.env);
  return jsonResponse(loaded.ready ? 200 : 503, { ready: loaded.ready, checks: loaded.checks });
}
