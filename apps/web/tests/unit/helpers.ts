import { UnsecuredJWT } from 'jose';
import type { Env } from '@/lib/config';
import { loadConfig } from '@/lib/config';
import { createSession, SESSION_COOKIE, type SessionInput } from '@/lib/session';
import type { OidcPort, TokenResult } from '@/lib/oidc';

export const NOW = 1_800_000_000;
export const clock = () => NOW;

export const TEST_ENV: Env = {
  WEB_ORIGIN: 'https://profit.test.example',
  OIDC_ISSUER: 'https://idp.test.example',
  OIDC_CLIENT_ID: 'synthetic-client',
  OIDC_CLIENT_SECRET: 'synthetic-client-value',
  OIDC_API_AUDIENCE: 'https://api.test.example',
  SESSION_KEY: Buffer.alloc(32, 7).toString('base64url'),
  PROFIT_API_ORIGIN: 'https://api.test.example',
  NODE_ENV: 'test',
};

export function config(env: Env = TEST_ENV) {
  const loaded = loadConfig(env);
  if (!loaded.ready) throw new Error('test config invalid');
  return loaded.config;
}

export function accessToken(exp: number, extra: Record<string, unknown> = {}): string {
  return new UnsecuredJWT(extra).setIssuer('https://idp.test.example').setExpirationTime(exp).encode();
}

export function goodTokens(overrides: Partial<TokenResult['claims']> = {}, access = accessToken(NOW + 1800)): TokenResult {
  return {
    claims: { iss: 'https://idp.test.example', aud: 'synthetic-client', sub: 'user-1', name: 'ผู้ใช้ทดสอบ', exp: NOW + 7200, ...overrides },
    accessToken: access,
    tokenType: 'Bearer',
  };
}

export function mockOidc(tokens: TokenResult | Error): OidcPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async begin(_c, redirectUri) {
      calls.push('begin');
      const url = new URL('https://idp.test.example/authorize');
      url.searchParams.set('redirect_uri', redirectUri);
      return { url, transaction: { state: 'state-1', nonce: 'nonce-1', verifier: 'verifier-1' } };
    },
    async exchange(_c, callback, txn) {
      calls.push(`exchange:${callback.searchParams.get('state')}:${txn.state}`);
      if (tokens instanceof Error) throw tokens;
      return tokens;
    },
  };
}

export async function sessionCookie(overrides: Partial<SessionInput> = {}, env: Env = TEST_ENV): Promise<string> {
  const s = await createSession(
    { sub: 'user-1', displayName: 'ผู้ใช้ทดสอบ', accessToken: accessToken(NOW + 1800), idTokenExp: NOW + 7200, accessTokenExp: NOW + 1800, ...overrides },
    config(env),
    clock,
  );
  return `${SESSION_COOKIE}=${s.value}`;
}

export function request(path: string, init: RequestInit & { host?: string } = {}): Request {
  const { host = 'profit.test.example', headers, ...rest } = init;
  return new Request(`https://profit.test.example${path}`, { ...rest, headers: { host, ...(headers as Record<string, string>) } });
}
