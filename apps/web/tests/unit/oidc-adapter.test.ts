import { expect, it, vi } from 'vitest';
import { openIdClientPort } from '@/lib/oidc';
import { config } from './helpers';

vi.mock('openid-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openid-client')>();
  return {
    ...actual,
    discovery: vi.fn(async () => new actual.Configuration({
      issuer: 'https://idp.test.example',
      authorization_endpoint: 'https://idp.test.example/authorize',
      token_endpoint: 'https://idp.test.example/token',
    }, 'synthetic-client')),
  };
});

it('maps an actual authorization denial to denied without contacting the token endpoint', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(openIdClientPort.exchange(
      config(),
      new URL('https://profit.test.example/api/auth/callback?error=access_denied&state=synthetic-state'),
      { state: 'synthetic-state', nonce: 'synthetic-nonce', verifier: 'synthetic-verifier' },
    )).rejects.toMatchObject({ reason: 'denied' });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
