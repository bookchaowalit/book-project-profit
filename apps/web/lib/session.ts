import { EncryptJWT, jwtDecrypt } from 'jose';
import type { WebConfig } from './config';

export const SESSION_COOKIE = '__Host-profit-session';
export const TRANSACTION_COOKIE = '__Host-profit-oidc';
export const SESSION_MAX_SECONDS = 3600;
export const TRANSACTION_MAX_SECONDS = 600;
/** Name + value + attributes must stay under the 4096-byte browser limit. */
export const MAX_COOKIE_VALUE_BYTES = 3600;

const SESSION_AUDIENCE = 'profit-web-session';
const TRANSACTION_AUDIENCE = 'profit-web-oidc';

export interface Session {
  sub: string;
  displayName: string;
  accessToken: string;
  exp: number;
}

export class SessionError extends Error {
  constructor(readonly code: 'cookie_too_large' | 'session_expired') {
    super(code);
  }
}

export type Clock = () => number; // epoch seconds
export const systemClock: Clock = () => Math.floor(Date.now() / 1000);

async function seal(
  payload: Record<string, unknown>,
  audience: string,
  expires: number,
  config: WebConfig,
  now: Clock,
): Promise<string> {
  const value = await new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer(config.webOrigin)
    .setAudience(audience)
    .setIssuedAt(now())
    .setExpirationTime(expires)
    .encrypt(config.sessionKey);
  if (Buffer.byteLength(value) > MAX_COOKIE_VALUE_BYTES) throw new SessionError('cookie_too_large');
  return value;
}

async function unseal(value: string, audience: string, config: WebConfig, now: Clock) {
  const { payload } = await jwtDecrypt(value, config.sessionKey, {
    issuer: config.webOrigin,
    audience,
    keyManagementAlgorithms: ['dir'],
    contentEncryptionAlgorithms: ['A256GCM'],
    currentDate: new Date(now() * 1000),
  });
  return payload;
}

export interface SessionInput {
  sub: string;
  displayName: string;
  accessToken: string;
  idTokenExp: number;
  accessTokenExp: number;
}

/** Cookie lifetime: at most one hour, never beyond ID token or access token expiry. */
export async function createSession(input: SessionInput, config: WebConfig, now: Clock = systemClock) {
  const current = now();
  const expires = Math.min(input.idTokenExp, input.accessTokenExp, current + SESSION_MAX_SECONDS);
  if (!Number.isSafeInteger(expires) || expires <= current) throw new SessionError('session_expired');
  const value = await seal(
    { sub: input.sub, name: input.displayName, at: input.accessToken },
    SESSION_AUDIENCE,
    expires,
    config,
    now,
  );
  return { value, maxAge: expires - current };
}

export async function readSession(
  value: string | undefined,
  config: WebConfig,
  now: Clock = systemClock,
): Promise<Session | null> {
  if (!value) return null;
  try {
    const p = await unseal(value, SESSION_AUDIENCE, config, now);
    if (
      typeof p.sub !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.at !== 'string' ||
      typeof p.exp !== 'number' ||
      p.exp <= now()
    ) {
      return null;
    }
    return { sub: p.sub, displayName: p.name, accessToken: p.at, exp: p.exp };
  } catch {
    return null;
  }
}

export interface Transaction {
  state: string;
  nonce: string;
  verifier: string;
}

export function sealTransaction(t: Transaction, config: WebConfig, now: Clock = systemClock) {
  return seal({ ...t }, TRANSACTION_AUDIENCE, now() + TRANSACTION_MAX_SECONDS, config, now);
}

export async function readTransaction(
  value: string | undefined,
  config: WebConfig,
  now: Clock = systemClock,
): Promise<Transaction | null> {
  if (!value) return null;
  try {
    const p = await unseal(value, TRANSACTION_AUDIENCE, config, now);
    if (typeof p.state !== 'string' || typeof p.nonce !== 'string' || typeof p.verifier !== 'string') {
      return null;
    }
    return { state: p.state, nonce: p.nonce, verifier: p.verifier };
  } catch {
    return null;
  }
}

export function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return serializeCookie(name, '', 0);
}
