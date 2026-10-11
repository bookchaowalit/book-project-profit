# Project Profit — web (`apps/web`)

Next.js 16 / TypeScript frontend and stateless BFF for the Project Profit
Tracker. Thai-first "Profit Diff" workspace: contract value vs money actually
received, with an inspectable equation and time denominator.

The web layer stores **no financial data** on disk or in memory between
requests. All data lives in the FastAPI/PostgreSQL API (`apps/api`).

## Architecture

- `app/page.tsx` (server): checks config, reads the encrypted session cookie,
  renders the signed-out/config-required page or `ProfitApp`.
- `app/api/auth/{login,callback,session,logout}`: generic OIDC authorization
  code flow, S256 PKCE, state, nonce, ID-token validation (openid-client 6 +
  jose). Session = encrypted JWE in `__Host-profit-session` (HttpOnly, Secure,
  SameSite=Lax, Path=/, max 1 h, bounded by ID/access token expiry). The
  transaction cookie `__Host-profit-oidc` lives 10 min and is cleared after the
  callback. Cookie value > 3600 bytes fails explicitly (`session_too_large`).
- `app/api/profit/[...path]`: BFF proxy to `${PROFIT_API_ORIGIN}/v1/...`.
  Allow-listed paths/methods only, exact `WEB_ORIGIN` host, mutation `Origin`
  + `application/json`, 64 KiB body cap, `Idempotency-Key` validation, no
  redirects, 10 s timeout, bearer token taken only from the server session.
  Upstream error bodies are never echoed; errors are re-emitted as the stable
  `{error:{code,message,request_id}}` envelope.
- `app/api/health`: configuration readiness only (not upstream liveness).
- Money: `lib/money.ts` uses BigInt on decimal strings of minor units; no
  `Number()` on amounts.

## Environment

Names/placeholders only are in `.env.example`. Never commit real values.

| Variable | Purpose |
| --- | --- |
| `WEB_ORIGIN` | exact HTTPS origin of this web app |
| `OIDC_ISSUER` | HTTPS issuer URL |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | confidential client |
| `OIDC_API_AUDIENCE` | optional `audience` auth parameter if the IdP needs it |
| `SESSION_KEY` | 32 random bytes, base64url (43 chars) |
| `PROFIT_API_ORIGIN` | trusted HTTPS origin of the FastAPI service |
| `ALLOW_INSECURE_LOOPBACK` | `true` only in non-production to permit http loopback origins |

Missing or invalid configuration: pages show a "configuration required" state
and auth/proxy routes return a safe `503 configuration_required`. There is no
auth bypass and no demo identity.

## Identity provider setup (PENDING — not provisioned)

IdP provisioning has **not** been done. Required when it is:

- Register a confidential client with redirect URI
  `${WEB_ORIGIN}/api/auth/callback` (exact).
- The IdP must issue a **JWT access token** whose issuer and audience match the
  FastAPI configuration; the token must be small enough to fit the cookie bound.
- Rotating `SESSION_KEY` invalidates all sessions (users sign in again).
  Rotate `OIDC_CLIENT_SECRET` at the IdP, then update the Vercel variable and
  redeploy.
- Logout clears this app's browser cookie only; it does not revoke a copied
  cookie/access token or end the provider's SSO session. App sessions expire
  within one hour. Provider logout/revocation is not implemented in this MVP.

## Commands

Run from `apps/web` (Node 22, npm 10):

```bash
npm ci
npm run typecheck
npm test                 # vitest: money, forms, auth, proxy, UI (no secrets needed)
npm run build            # works without runtime secrets
task check               # typecheck + test + build (the decisive check)
npm run test:browser     # separate: Playwright component-fixture tests
npm run fixture:build
npm run fixture:serve    # built fixture preview, http://127.0.0.1:4173
```

First browser run needs `npx playwright install chromium`; on Linux it also
needs system libraries (`npx playwright install-deps chromium`, requires root).

### Fixture vs production auth

`tests/browser/fixture` is a Vite harness rendering the real `ProfitApp` with
`/api/profit/**` intercepted by clearly SYNTHETIC data. It is test-only, is not
a Next route and is never deployed. It is **component-fixture verification**,
not production OIDC/BFF end-to-end evidence. Live OIDC E2E is pending IdP
provisioning.
The browser runner builds this fixture before opening a fresh preview server;
it never silently reuses a process already listening on the fixture port.
Unit and browser tests use one worker to bound memory on shared hosts. Run
`task check` and `task test:browser` sequentially, not concurrently.

## Deployment (Vercel — instructions only, nothing is claimed hosted)

1. Create a Vercel project from the product repository, Root Directory
   `apps/web`, framework Next.js (`vercel.json` present).
2. Set the environment variables above for Production with HTTPS origins.
3. Register `${WEB_ORIGIN}/api/auth/callback` at the IdP.
4. Deploy, then check `GET /api/health` returns `ready: true`.
5. API (Railway) is deployed separately from `apps/api`; set
   `PROFIT_API_ORIGIN` to that trusted HTTPS origin.
