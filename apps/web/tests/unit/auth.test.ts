import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/lib/config';
import { handleCallback, handleHealth, handleLogin, handleLogout, handleSession } from '@/lib/auth-handlers';
import { AuthFlowError, sessionInputFromTokens } from '@/lib/oidc';
import { createSession, readSession, readTransaction, sealTransaction, SessionError, SESSION_COOKIE, TRANSACTION_COOKIE } from '@/lib/session';
import { NOW, TEST_ENV, accessToken, clock, config, goodTokens, mockOidc, request, sessionCookie } from './helpers';

const deps = (oidc = mockOidc(goodTokens()), env = TEST_ENV) => ({ env, oidc, now: clock });
const cookies = (res: Response) => res.headers.getSetCookie();

describe('configuration', () => {
  it('is not ready without configuration and never leaks values', () => {
    const res = handleHealth(deps(mockOidc(goodTokens()), {}));
    expect(res.status).toBe(503);
  });
  it('reports readiness by name only', async () => {
    const res = handleHealth(deps());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('synthetic-client-value');
    expect(text).not.toContain(TEST_ENV.SESSION_KEY!);
    expect(JSON.parse(text).ready).toBe(true);
  });
  it('rejects insecure or malformed origins and issuers', () => {
    const bad = (patch: Record<string, string>) => loadConfig({ ...TEST_ENV, ...patch }).ready;
    expect(bad({ WEB_ORIGIN: 'http://profit.test.example' })).toBe(false);
    expect(bad({ WEB_ORIGIN: 'https://profit.test.example/path' })).toBe(false);
    expect(bad({ WEB_ORIGIN: 'https://*.example.com' })).toBe(false);
    expect(bad({ WEB_ORIGIN: 'http://127.0.0.1:3000' })).toBe(false);
    expect(bad({ OIDC_ISSUER: 'http://idp.test.example' })).toBe(false);
    expect(bad({ PROFIT_API_ORIGIN: 'http://api.test.example' })).toBe(false);
    expect(bad({ PROFIT_API_ORIGIN: 'http://127.0.0.1:8000' })).toBe(false);
    expect(bad({ SESSION_KEY: 'short' })).toBe(false);
    expect(bad({ OIDC_CLIENT_ID: '' })).toBe(false);
  });
  it('permits http loopback only with the explicit non-production flag', () => {
    const local = { ...TEST_ENV, WEB_ORIGIN: 'http://127.0.0.1:3000', PROFIT_API_ORIGIN: 'http://127.0.0.1:8000' };
    expect(loadConfig({ ...local, ALLOW_INSECURE_LOOPBACK: 'true' }).ready).toBe(true);
    expect(loadConfig({ ...local, ALLOW_INSECURE_LOOPBACK: 'true', NODE_ENV: 'production' }).ready).toBe(false);
    expect(loadConfig(local).ready).toBe(false);
  });
});

describe('login', () => {
  it('returns explicit 503 when unconfigured and never calls the provider', async () => {
    const oidc = mockOidc(goodTokens());
    const res = await handleLogin(request('/api/auth/login'), { env: {}, oidc, now: clock });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('configuration_required');
    expect(oidc.calls).toEqual([]);
  });
  it('rejects a foreign Host', async () => {
    const res = await handleLogin(request('/api/auth/login', { host: 'evil.example' }), deps());
    expect(res.status).toBe(403);
  });
  it('starts the flow with a hardened encrypted transaction cookie and fixed callback', async () => {
    const res = await handleLogin(request('/api/auth/login'), deps());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://idp.test.example');
    expect(location.searchParams.get('redirect_uri')).toBe('https://profit.test.example/api/auth/callback');
    const [cookie] = cookies(res);
    expect(cookie).toMatch(/^__Host-profit-oidc=/);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) expect(cookie).toContain(part);
    expect(cookie).not.toContain('verifier-1');
    const value = cookie.split(';')[0]!.split('=')[1]!;
    expect(await readTransaction(value, config(), clock)).toEqual({ state: 'state-1', nonce: 'nonce-1', verifier: 'verifier-1' });
  });
  it('ignores any caller-supplied redirect target', async () => {
    const res = await handleLogin(request('/api/auth/login?next=https://evil.example&redirect_uri=https://evil.example'), deps());
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe('https://profit.test.example/api/auth/callback');
  });
  it('fails closed when discovery fails', async () => {
    const oidc = mockOidc(goodTokens());
    oidc.begin = async () => {
      throw new AuthFlowError('provider_unavailable');
    };
    const res = await handleLogin(request('/api/auth/login'), deps(oidc));
    expect(res.headers.get('location')).toBe('https://profit.test.example/?auth_error=provider_unavailable');
    expect(cookies(res)).toEqual([]);
  });
});

async function callback(tokens: Parameters<typeof mockOidc>[0], withTransaction = true) {
  const txn = withTransaction ? await sealTransaction({ state: 'state-1', nonce: 'nonce-1', verifier: 'verifier-1' }, config(), clock) : '';
  const oidc = mockOidc(tokens);
  const res = await handleCallback(
    request('/api/auth/callback?code=abc&state=state-1', { headers: withTransaction ? { cookie: `${TRANSACTION_COOKIE}=${txn}` } : {} }),
    deps(oidc),
  );
  return { res, oidc };
}

describe('callback', () => {
  it('creates a hardened session, clears the transaction and redirects to a fixed path', async () => {
    const { res, oidc } = await callback(goodTokens());
    expect(res.headers.get('location')).toBe('https://profit.test.example/');
    const set = cookies(res);
    expect(set.find((c) => c.startsWith(`${TRANSACTION_COOKIE}=;`))).toContain('Max-Age=0');
    const session = set.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(session).toContain(part);
    expect(Number(/Max-Age=(\d+)/.exec(session)![1])).toBe(1800); // bounded by access token expiry
    expect(oidc.calls).toEqual(['exchange:state-1:state-1']);
    const value = session.split(';')[0]!.split('=')[1]!;
    expect(session).not.toContain(goodTokens().accessToken); // provider token is encrypted, not readable
    expect(value.split('.')).toHaveLength(5); // JWE compact serialization
    const read = await readSession(value, config(), clock);
    expect(read?.displayName).toBe('ผู้ใช้ทดสอบ');
    expect(read?.accessToken).toBe(goodTokens().accessToken);
  });
  it('caps the session at one hour', async () => {
    const { res } = await callback(goodTokens({ exp: NOW + 99999 }, accessToken(NOW + 99999)));
    expect(cookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))).toContain('Max-Age=3600');
  });
  it('rejects a missing, forged or replayed transaction', async () => {
    const { res, oidc } = await callback(goodTokens(), false);
    expect(res.headers.get('location')).toContain('auth_error=invalid');
    expect(cookies(res).join(';')).not.toContain(`${SESSION_COOKIE}=ey`);
    expect(oidc.calls).toEqual([]);
  });
  it('fails closed on a provider error without a session', async () => {
    const { res } = await callback(new AuthFlowError('invalid'));
    expect(res.headers.get('location')).toContain('auth_error=invalid');
    expect(cookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
  });
  it('rejects a wrong issuer, wrong audience and expired tokens', async () => {
    for (const [tokens, reason] of [
      [goodTokens({ iss: 'https://evil.example' }), 'invalid'],
      [goodTokens({ aud: 'someone-else' }), 'invalid'],
      [goodTokens({ exp: NOW - 1 }), 'expired'],
      [goodTokens({}, accessToken(NOW - 1)), 'expired'],
      [goodTokens({}, 'opaque-token'), 'invalid'],
    ] as const) {
      const { res } = await callback(tokens);
      expect(res.headers.get('location')).toContain(`auth_error=${reason}`);
      expect(cookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=ey`))).toBe(false);
    }
  });
  it('fails explicitly when the sealed session would not fit in a cookie', async () => {
    const { res } = await callback(goodTokens({}, accessToken(NOW + 1800, { pad: 'x'.repeat(6000) })));
    expect(res.headers.get('location')).toContain('auth_error=session_too_large');
  });
});

describe('session bounds', () => {
  it('never outlives the ID token or access token', async () => {
    const s = await createSession({ sub: 's', displayName: 'n', accessToken: accessToken(NOW + 100), idTokenExp: NOW + 50, accessTokenExp: NOW + 100 }, config(), clock);
    expect(s.maxAge).toBe(50);
  });
  it('refuses an already expired token and oversized payload', async () => {
    await expect(createSession({ sub: 's', displayName: 'n', accessToken: 'a', idTokenExp: NOW, accessTokenExp: NOW + 5 }, config(), clock)).rejects.toThrow(SessionError);
    await expect(createSession({ sub: 's', displayName: 'n', accessToken: 'a'.repeat(5000), idTokenExp: NOW + 9, accessTokenExp: NOW + 9 }, config(), clock)).rejects.toMatchObject({ code: 'cookie_too_large' });
  });
  it('expires and is bound to the configured origin and key', async () => {
    const cookie = (await sessionCookie()).split('=')[1];
    expect(await readSession(cookie, config(), clock)).not.toBeNull();
    expect(await readSession(cookie, config(), () => NOW + 1801)).toBeNull();
    expect(await readSession(cookie, config({ ...TEST_ENV, WEB_ORIGIN: 'https://other.test.example' }), clock)).toBeNull();
    expect(await readSession(cookie, config({ ...TEST_ENV, SESSION_KEY: Buffer.alloc(32, 9).toString('base64url') }), clock)).toBeNull();
    expect(await readSession('garbage', config(), clock)).toBeNull();
  });
  it('rejects a transaction cookie used as a session', async () => {
    const txn = await sealTransaction({ state: 's', nonce: 'n', verifier: 'v' }, config(), clock);
    expect(await readSession(txn, config(), clock)).toBeNull();
  });
});

describe('sessionInputFromTokens', () => {
  it('sanitizes the display name', () => {
    const input = sessionInputFromTokens(goodTokens({ name: '  A\u0000B  ' }), config(), NOW);
    expect(input.displayName).toBe('AB');
    expect(sessionInputFromTokens(goodTokens({ name: undefined }), config(), NOW).displayName).toBe('ผู้ใช้');
  });
});

describe('session and logout endpoints', () => {
  it('reports only authenticated state and display name', async () => {
    const res = await handleSession(request('/api/auth/session', { headers: { cookie: await sessionCookie() } }), deps());
    expect(await res.json()).toEqual({ authenticated: true, user: { displayName: 'ผู้ใช้ทดสอบ' } });
    const anon = await handleSession(request('/api/auth/session'), deps());
    expect(await anon.json()).toEqual({ authenticated: false });
    const expired = await handleSession(request('/api/auth/session', { headers: { cookie: await sessionCookie() } }), { ...deps(), now: () => NOW + 4000 });
    expect(await expired.json()).toEqual({ authenticated: false });
  });
  it('requires the exact Origin for logout', async () => {
    const post = (origin?: string) => handleLogout(request('/api/auth/logout', { method: 'POST', headers: origin ? { origin } : {} }), deps());
    expect((await post()).status).toBe(403);
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await post('https://profit.test.example.evil.example')).status).toBe(403);
    const ok = await post('https://profit.test.example');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await handleLogout(request('/api/auth/logout'), deps())).status).toBe(405);
  });
});
