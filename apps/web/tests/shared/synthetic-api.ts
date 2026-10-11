// SYNTHETIC test double for the Profit API contract. It exists only for component
// tests and the browser fixture; it is never imported by app code or shipped as a route.

export interface SyntheticResponse {
  status: number;
  body: unknown;
}

interface SyntheticEntry {
  id: string;
  workspace_id: string;
  project_id: string;
  created_at: string;
  [key: string]: unknown;
}

export interface SyntheticOptions {
  pageSizeCap?: number;
  extraProjects?: number;
}

const KINDS = ['time-entries', 'expenses', 'payments'] as const;

export function createSyntheticApi(options: SyntheticOptions = {}) {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  const workspaces = [
    { id: 'ws-synthetic-1', name: 'SYNTHETIC Workspace Alpha', role: 'owner' },
    { id: 'ws-synthetic-2', name: 'SYNTHETIC Workspace Viewer', role: 'viewer' },
  ];
  type P = {
    id: string; workspace_id: string; name: string; client_name: string; currency: string;
    contract_value_minor: string; hourly_cost_minor: string; status: string; created_at: string; updated_at: string;
  };
  const projects: P[] = [];
  const entries: Record<string, SyntheticEntry[]> = {};
  const replay = new Map<string, SyntheticResponse>();

  const addProject = (workspace_id: string, name: string, client_name: string, currency: string, contract: string, hourly: string): P => {
    const p: P = {
      id: nextId('pr'), workspace_id, name, client_name, currency, contract_value_minor: contract, hourly_cost_minor: hourly,
      status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    projects.push(p);
    for (const k of KINDS) entries[`${p.id}/${k}`] = [];
    return p;
  };
  addProject('ws-synthetic-1', 'SYNTHETIC เว็บไซต์ร้านกาแฟ', 'SYNTHETIC Client A', 'THB', '12000000', '50000');
  addProject('ws-synthetic-1', 'SYNTHETIC App Redesign', 'SYNTHETIC Client B', 'JPY', '900000', '4000');
  addProject('ws-synthetic-2', 'SYNTHETIC Read-only Project', 'SYNTHETIC Client C', 'USD', '500000', '6000');
  for (let i = 0; i < (options.extraProjects ?? 0); i++) addProject('ws-synthetic-1', `SYNTHETIC Extra ${i + 1}`, 'SYNTHETIC Client X', 'THB', '100', '100');

  const log: { method: string; path: string; key: string | null; body: unknown }[] = [];
  const hooks: { failNext: { status: number; code: string } | null; gate: ((path: string) => Promise<void> | undefined) | null } = { failNext: null, gate: null };

  const sum = (list: SyntheticEntry[], field: string) => list.reduce((a, e) => a + BigInt(e[field] as string), 0n);
  function summary(p: P) {
    const received = sum(entries[`${p.id}/payments`]!, 'amount_minor');
    const expense = sum(entries[`${p.id}/expenses`]!, 'amount_minor');
    const times = entries[`${p.id}/time-entries`]!;
    const labor = times.reduce((a, e) => a + (BigInt(e.minutes as number) * BigInt(e.hourly_cost_minor as string) + 30n) / 60n, 0n);
    const minutes = times.reduce((a, e) => a + BigInt(e.minutes as number), 0n);
    const actual = received - expense - labor;
    const pct = received > 0n ? actual * 10000n / received : null;
    return {
      received_minor: received.toString(),
      expense_minor: expense.toString(),
      labor_cost_minor: labor.toString(),
      cash_surplus_minor: (received - expense).toString(),
      actual_profit_minor: actual.toString(),
      projected_profit_minor: (BigInt(p.contract_value_minor) - expense - labor).toString(),
      total_minutes: Number(minutes),
      profit_per_hour_minor: minutes > 0n ? (actual * 60n / minutes).toString() : null,
      margin_percent: pct === null ? null : `${pct / 100n}.${(((pct < 0n ? -pct : pct) % 100n)).toString().padStart(2, '0')}`,
    };
  }
  const present = (p: P) => ({ ...p, summary: summary(p) });
  const fail = (status: number, code: string): SyntheticResponse => ({ status, body: { error: { code, message: 'synthetic', request_id: 'req-synthetic-1' } } });

  function totals(wid: string) {
    const groups = new Map<string, { [k: string]: bigint | number | string }>();
    for (const p of projects.filter((x) => x.workspace_id === wid)) {
      const s = summary(p);
      const g = groups.get(p.currency) ?? { currency: p.currency, received_minor: 0n, expense_minor: 0n, labor_cost_minor: 0n, cash_surplus_minor: 0n, actual_profit_minor: 0n, projected_profit_minor: 0n, total_minutes: 0, project_count: 0 };
      for (const f of ['received_minor', 'expense_minor', 'labor_cost_minor', 'cash_surplus_minor', 'actual_profit_minor', 'projected_profit_minor']) {
        g[f] = (g[f] as bigint) + BigInt(s[f as keyof typeof s] as string);
      }
      g.total_minutes = (g.total_minutes as number) + s.total_minutes;
      g.project_count = (g.project_count as number) + 1;
      groups.set(p.currency, g);
    }
    return [...groups.values()].map((g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])));
  }

  async function handle(method: string, rawPath: string, body: unknown, headers: Record<string, string>): Promise<SyntheticResponse> {
    const url = new URL(rawPath, 'http://synthetic.invalid');
    const path = url.pathname.replace(/^\/api\/profit\//, '');
    log.push({ method, path: path + url.search, key: headers['idempotency-key'] ?? null, body });
    const gate = hooks.gate?.(path + url.search);
    if (gate) await gate;
    if (hooks.failNext && method !== 'GET') {
      const f = hooks.failNext;
      hooks.failNext = null;
      return fail(f.status, f.code);
    }
    const seg = path.split('/');
    const idemp = headers['idempotency-key'];
    if (method === 'POST') {
      if (!idemp) return fail(400, 'validation_error');
      const cached = replay.get(idemp);
      if (cached) return cached;
    }
    const finish = (r: SyntheticResponse) => {
      if (method === 'POST' && idemp && r.status < 300) replay.set(idemp, r);
      return r;
    };
    const page = <T,>(items: T[]) => {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), options.pageSizeCap ?? 100);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return { status: 200, body: { items: items.slice(offset, offset + limit), total: items.length, limit, offset } };
    };
    if (seg[0] !== 'workspaces') return fail(404, 'not_found');
    if (seg.length === 1) {
      if (method === 'GET') return { status: 200, body: { items: workspaces, total: workspaces.length } };
      const w = { id: nextId('ws'), name: String((body as { name: string }).name), role: 'owner' };
      workspaces.push(w);
      return finish({ status: 201, body: w });
    }
    const wid = seg[1]!;
    const workspace = workspaces.find((w) => w.id === wid);
    if (!workspace) return fail(404, 'not_found');
    const readOnly = workspace.role === 'viewer';
    if (seg[2] === 'summary') return { status: 200, body: { totals_by_currency: totals(wid), project_count: projects.filter((p) => p.workspace_id === wid).length } };
    if (seg[2] !== 'projects') return fail(404, 'not_found');
    if (seg.length === 3) {
      if (method === 'GET') return page(projects.filter((p) => p.workspace_id === wid).map(present));
      if (readOnly) return fail(403, 'forbidden');
      const b = body as Record<string, string>;
      const p = addProject(wid, b.name!, b.client_name!, b.currency!, b.contract_value_minor!, b.hourly_cost_minor!);
      return finish({ status: 201, body: present(p) });
    }
    const project = projects.find((p) => p.id === seg[3] && p.workspace_id === wid);
    if (!project) return fail(404, 'not_found');
    if (seg.length === 4) {
      if (method === 'PATCH') {
        if (readOnly) return fail(403, 'forbidden');
        Object.assign(project, body as object, { updated_at: new Date().toISOString() });
      }
      return { status: 200, body: present(project) };
    }
    const kind = seg[4]!;
    if (!(KINDS as readonly string[]).includes(kind)) return fail(404, 'not_found');
    const list = entries[`${project.id}/${kind}`]!;
    if (seg.length === 5) {
      if (method === 'GET') return page([...list].reverse());
      if (readOnly) return fail(403, 'forbidden');
      const b = body as Record<string, unknown>;
      const entry: SyntheticEntry = { id: nextId('en'), workspace_id: wid, project_id: project.id, created_at: '2026-01-02T00:00:00Z', ...b };
      if (kind === 'time-entries') entry.hourly_cost_minor = (b.hourly_cost_minor as string | undefined) ?? project.hourly_cost_minor;
      list.push(entry);
      return finish({ status: 201, body: entry });
    }
    if (method === 'DELETE') {
      if (readOnly) return fail(403, 'forbidden');
      const index = list.findIndex((e) => e.id === seg[5]);
      if (index < 0) return fail(404, 'not_found');
      list.splice(index, 1);
      return { status: 204, body: null };
    }
    return fail(404, 'not_found');
  }

  return { handle, log, hooks, workspaces, projects, entries };
}
export type SyntheticApi = ReturnType<typeof createSyntheticApi>;
