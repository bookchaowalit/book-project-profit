import { describe, expect, it, vi } from 'vitest';
import { handleProxy, matchRoute, MAX_BODY_BYTES } from '@/lib/proxy';
import { NOW, TEST_ENV, accessToken, clock, request, sessionCookie } from './helpers';

const ORIGIN = 'https://profit.test.example';
const KEY = '123e4567-e89b-42d3-a456-426614174000';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function call(
  path: string,
  init: RequestInit & { host?: string } = {},
  upstream: ReturnType<typeof vi.fn> = vi.fn(async () => json({ items: [], total: 0 })),
  withSession = true,
  env = TEST_ENV,
) {
  const headers = { ...(init.headers as Record<string, string>) };
  if (withSession) headers.cookie = headers.cookie ?? (await sessionCookie());
  const segments = path.split('?')[0]!.replace(/^\/api\/profit\//, '').split('/');
  const res = await handleProxy(request(path, { ...init, headers }), segments, { env, fetch: upstream as unknown as typeof fetch, now: clock });
  return { res, upstream };
}
const write = (extra: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': KEY, ...extra },
  body: JSON.stringify({ name: 'x' }),
});

describe('route allow-list', () => {
  it('matches only declared API paths', () => {
    expect(matchRoute(['workspaces'])).not.toBeNull();
    expect(matchRoute(['workspaces', 'w1', 'projects', 'p1', 'time-entries', 'e1'])).not.toBeNull();
    for (const bad of [['health'], ['workspaces', 'w1'], ['workspaces', '..', 'summary'], ['workspaces', 'w1', 'members'], ['workspaces', 'w%2f', 'summary'], []]) {
      expect(matchRoute(bad)).toBeNull();
    }
  });
  it('404s unknown paths and 405s undeclared methods without calling upstream', async () => {
    const a = await call('/api/profit/admin/users');
    expect(a.res.status).toBe(404);
    const b = await call('/api/profit/workspaces/w1/summary', { method: 'DELETE', headers: { origin: ORIGIN } });
    expect(b.res.status).toBe(405);
    expect(a.upstream).not.toHaveBeenCalled();
    expect(b.upstream).not.toHaveBeenCalled();
  });
});

describe('fail-closed guards', () => {
  it('is a 503 configuration state when unconfigured', async () => {
    const { res, upstream } = await call('/api/profit/workspaces', {}, undefined, false, {});
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('configuration_required');
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects wrong Host and unauthenticated callers', async () => {
    expect((await call('/api/profit/workspaces', { host: 'evil.example' })).res.status).toBe(403);
    const anon = await call('/api/profit/workspaces', {}, undefined, false);
    expect(anon.res.status).toBe(401);
    expect(anon.upstream).not.toHaveBeenCalled();
  });
  it('rejects expired sessions without an upstream call', async () => {
    const expired = await sessionCookie({ accessTokenExp: NOW + 10 });
    const upstream = vi.fn();
    const res = await handleProxy(request('/api/profit/workspaces', { headers: { cookie: expired } }), ['workspaces'], {
      env: TEST_ENV,
      fetch: upstream as unknown as typeof fetch,
      now: () => NOW + 11,
    });
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('requires exact Origin, JSON content type and a valid Idempotency-Key on writes', async () => {
    const u = vi.fn();
    expect((await call('/api/profit/workspaces', { ...write(), headers: { ...write().headers, origin: 'https://evil.example' } }, u)).res.status).toBe(403);
    expect((await call('/api/profit/workspaces', { ...write(), headers: { ...write().headers, origin: '' } }, u)).res.status).toBe(403);
    expect((await call('/api/profit/workspaces', { ...write(), headers: { ...write().headers, 'content-type': 'text/plain' } }, u)).res.status).toBe(415);
    expect((await call('/api/profit/workspaces', { ...write(), headers: { ...write().headers, 'idempotency-key': 'short' } }, u)).res.status).toBe(400);
    const missing = write();
    delete (missing.headers as Record<string, string>)['idempotency-key'];
    expect((await call('/api/profit/workspaces', missing, u)).res.status).toBe(400);
    expect((await call('/api/profit/workspaces', { ...write(), body: '{not json' }, u)).res.status).toBe(400);
    expect(u).not.toHaveBeenCalled();
  });
  it('bounds the request body', async () => {
    const u = vi.fn();
    const big = JSON.stringify({ note: 'x'.repeat(MAX_BODY_BYTES) });
    const { res } = await call('/api/profit/workspaces', { ...write(), body: big }, u);
    expect(res.status).toBe(413);
    expect(u).not.toHaveBeenCalled();
  });
  it('rejects unexpected query parameters and out-of-range paging', async () => {
    const u = vi.fn();
    expect((await call('/api/profit/workspaces?admin=1', {}, u)).res.status).toBe(400);
    expect((await call('/api/profit/workspaces/w1/projects?limit=101', {}, u)).res.status).toBe(400);
    expect((await call('/api/profit/workspaces/w1/projects?limit=5&limit=6', {}, u)).res.status).toBe(400);
    expect(u).not.toHaveBeenCalled();
  });
});

describe('upstream call', () => {
  it('sends the session bearer token only, with fixed origin and no caller credentials', async () => {
    const upstream = vi.fn(async () => json({ items: [], total: 0, limit: 50, offset: 0 }));
    const { res } = await call(
      '/api/profit/workspaces/w1/projects?limit=50&offset=100',
      { headers: { authorization: 'Bearer caller-supplied', 'x-forwarded-host': 'evil.example', 'x-api-key': 'k' } },
      upstream,
    );
    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test.example/v1/workspaces/w1/projects?limit=50&offset=100');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${accessToken(NOW + 1800)}`);
    expect(JSON.stringify(headers)).not.toContain('caller-supplied');
    expect(Object.keys(headers)).not.toContain('x-api-key');
    expect(Object.keys(headers)).not.toContain('cookie');
  });
  it('forwards a validated Idempotency-Key and body on writes', async () => {
    const upstream = vi.fn(async () => json({ id: 'w' }, 201));
    const { res } = await call('/api/profit/workspaces', write(), upstream);
    expect(res.status).toBe(201);
    const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['idempotency-key']).toBe(KEY);
    expect(init.headers['content-type']).toBe('application/json');
    expect(Buffer.from(init.body as Buffer).toString()).toBe('{"name":"x"}');
  });
  it('returns 204 for DELETE', async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 204 }));
    const { res } = await call('/api/profit/workspaces/w1/projects/p1/expenses/e1', { method: 'DELETE', headers: { origin: ORIGIN } }, upstream);
    expect(res.status).toBe(204);
  });
  it('preserves the stable error envelope and drops everything else', async () => {
    const upstream = vi.fn(async () =>
      json({ error: { code: 'idempotency_conflict', message: 'dup', request_id: 'req-12345678' }, trace: 'SELECT secret FROM x', detail: 'Bearer abc' }, 409),
    );
    const { res } = await call('/api/profit/workspaces', write(), upstream);
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'idempotency_conflict', message: 'dup', request_id: 'req-12345678' } });
    expect(text).not.toContain('SELECT');
  });
  it('maps non-envelope upstream failures without exposing the body', async () => {
    const upstream = vi.fn(async () => new Response('<html>stack trace with token abc</html>', { status: 500 }));
    const { res } = await call('/api/profit/workspaces', {}, upstream);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text).error.code).toBe('service_unavailable');
    expect(text).not.toContain('stack trace');
  });
  it('does not follow redirects and hides their location', async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
    const { res } = await call('/api/profit/workspaces', {}, upstream);
    expect(res.status).toBe(502);
    expect(res.headers.get('location')).toBeNull();
  });
  it('reports a timeout or network failure as service_unavailable', async () => {
    const upstream = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const { res } = await call('/api/profit/workspaces', {}, upstream);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('service_unavailable');
  });
  it('rejects non-JSON success bodies', async () => {
    const upstream = vi.fn(async () => new Response('hello', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect((await call('/api/profit/workspaces', {}, upstream)).res.status).toBe(502);
  });
});
