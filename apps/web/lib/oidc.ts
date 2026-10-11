import * as oidc from 'openid-client';
import { decodeJwt } from 'jose';
import type { WebConfig } from './config';
import type { Transaction } from './session';
import { SESSION_MAX_SECONDS, type SessionInput } from './session';

export type AuthFailure =
  | 'invalid'
  | 'expired'
  | 'denied'
  | 'provider_unavailable'
  | 'session_too_large'
  | 'not_configured';

export class AuthFlowError extends Error {
  constructor(readonly reason: AuthFailure) {
    super(reason);
  }
}

export interface TokenResult {
  claims: Record<string, unknown>;
  accessToken: string;
  tokenType: string;
}

export interface OidcPort {
  begin(config: WebConfig, redirectUri: string): Promise<{ url: URL; transaction: Transaction }>;
  exchange(config: WebConfig, callbackUrl: URL, transaction: Transaction): Promise<TokenResult>;
}

// Only provider metadata is cached in a warm instance; never user tokens.
const configurations = new Map<string, Promise<oidc.Configuration>>();

function discover(config: WebConfig): Promise<oidc.Configuration> {
  const key = JSON.stringify([config.issuer.href, config.clientId, config.clientSecret]);
  let pending = configurations.get(key);
  if (!pending) {
    pending = oidc.discovery(config.issuer, config.clientId, config.clientSecret, undefined, {
      timeout: 10,
      execute: [
        oidc.enableNonRepudiationChecks,
        ...(config.allowLoopback ? [oidc.allowInsecureRequests] : []),
      ],
    });
    configurations.set(key, pending);
    pending.catch(() => configurations.delete(key));
  }
  return pending;
}

/** Production adapter: openid-client verifies state, PKCE, nonce, ID-token signature, iss, aud, exp. */
export const openIdClientPort: OidcPort = {
  async begin(config, redirectUri) {
    let configuration: oidc.Configuration;
    try {
      configuration = await discover(config);
    } catch {
      throw new AuthFlowError('provider_unavailable');
    }
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const params: Record<string, string> = {
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    };
    if (config.apiAudience) params.audience = config.apiAudience;
    return { url: oidc.buildAuthorizationUrl(configuration, params), transaction: { state, nonce, verifier } };
  },
  async exchange(config, callbackUrl, transaction) {
    let configuration: oidc.Configuration;
    try {
      configuration = await discover(config);
    } catch {
      throw new AuthFlowError('provider_unavailable');
    }
    try {
      const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new AuthFlowError('invalid');
      return { claims: { ...claims }, accessToken: tokens.access_token, tokenType: tokens.token_type };
    } catch (error) {
      if (error instanceof AuthFlowError) throw error;
      if (error instanceof oidc.ResponseBodyError || error instanceof oidc.AuthorizationResponseError) {
        throw new AuthFlowError(error.error === 'access_denied' ? 'denied' : 'invalid');
      }
      throw new AuthFlowError(error instanceof oidc.ClientError ? 'invalid' : 'provider_unavailable');
    }
  },
};

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function cleanName(claims: Record<string, unknown>): string {
  for (const key of ['name', 'preferred_username', 'email']) {
    const value = claims[key];
    if (typeof value === 'string') {
      const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
      if (text) return text;
    }
  }
  return 'ผู้ใช้';
}

/**
 * Re-checks the verified claims defensively and derives the session input.
 * The access token's exp is read (not trusted for authorization; the API verifies it).
 */
export function sessionInputFromTokens(
  result: TokenResult,
  config: WebConfig,
  now: number,
): SessionInput {
  const { claims } = result;
  if (typeof claims.iss !== 'string' || trimSlash(claims.iss) !== trimSlash(config.issuer.href)) {
    throw new AuthFlowError('invalid');
  }
  const audience = claims.aud;
  const audiences = typeof audience === 'string' ? [audience] : Array.isArray(audience) ? audience : [];
  if (!audiences.includes(config.clientId)) throw new AuthFlowError('invalid');
  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) {
    throw new AuthFlowError('invalid');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new AuthFlowError('expired');
  if (result.tokenType.toLowerCase() !== 'bearer') throw new AuthFlowError('invalid');
  let accessTokenExp: number;
  try {
    const decoded = decodeJwt(result.accessToken);
    if (typeof decoded.exp !== 'number') throw new Error('no exp');
    accessTokenExp = decoded.exp;
  } catch {
    // The API requires a JWT access token; an opaque token cannot work.
    throw new AuthFlowError('invalid');
  }
  if (accessTokenExp <= now) throw new AuthFlowError('expired');
  return {
    sub: claims.sub,
    displayName: cleanName(claims),
    accessToken: result.accessToken,
    idTokenExp: claims.exp,
    accessTokenExp,
  };
}

export const MAX_SESSION_SECONDS = SESSION_MAX_SECONDS;
