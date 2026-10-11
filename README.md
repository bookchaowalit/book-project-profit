# Project Profit Tracker

A standalone SaaS product for project-level profitability. FastAPI owns the
business API and PostgreSQL data; Next.js owns the web interface and its
server-side authenticated API adapter. Neither runtime depends on Solo Empire.

## MVP boundary

An authenticated user can create a workspace, manage client projects, record
work time, direct expenses and received payments, and inspect the resulting
profit. A project has one currency. Summaries remain grouped by currency.
Workspace member invitations and role management are not included in this MVP;
the normal signup workflow creates an owner-operated workspace.

```text
Browser -> Next.js web/BFF -> FastAPI API -> PostgreSQL
              |                 |
              +--- OIDC --------+
```

The API validates access tokens and separately checks stored workspace
membership. Browser-supplied workspace IDs are never evidence of permission.
The web does not expose upstream access tokens to client JavaScript.

## Financial meaning

- `received`: actual recorded payments, not the agreed contract value.
- `labor cost`: each entry's minutes times its hourly-cost snapshot, rounded
  to the currency's minor unit using half-up rounding.
- `cash surplus`: payments minus direct expenses.
- `actual profit`: payments minus direct expenses minus labor cost.
- `projected profit`: contract value minus recorded direct expenses and labor
  cost; this is not a forecast of unrecorded future costs.
- `profit per hour`: actual profit divided by worked hours; absent when no
  time has been recorded.

This is management information, not a tax or double-entry accounting system.
No exchange-rate conversion is performed.

## Deployment boundary

The intended targets are Vercel (`apps/web`), Railway (`apps/api`) and a
dedicated PostgreSQL database such as Neon. The backend is stateless and does
not store runtime records on container disks. Each runtime can scale separately.

No cloud resource has been provisioned and no deployment has been performed.
Authentication, database and host configuration are required before opening
the product to users. Production migrations run as a controlled release step,
not automatically in every API replica.
The API ships a portable Dockerfile and manual Railway service instructions,
not the deprecated `railway.json` descriptor. An actual image build and hosted
authentication smoke test remain release gates.

See the package READMEs for setup, verification and environment variable names.

## Repository checks

```bash
task --dir apps/web install
task check
task test:browser
```

Each package owns its command implementation and dependency installation.
PostgreSQL tests use disposable test storage, not a production connection.
Browser component fixtures are synthetic and never shipped as an authentication
bypass in the Next.js application. Live identity-provider and hosted deployment
smoke checks remain a separate release gate.

See [architecture and release boundaries](docs/architecture.md).
