import { describe, expect, it } from 'vitest';
import { changedRows, validateEntry, validateProject, emptyDraft } from '@/lib/forms';
import { createIdempotencyTracker } from '@/lib/idempotency';
import type { Project } from '@/lib/api-types';

describe('idempotency tracker', () => {
  it('reuses the key for the same failed payload and renews it for a new one', () => {
    let n = 0;
    const t = createIdempotencyTracker(() => `key-${++n}`);
    const a = t.keyFor('payload-a');
    expect(t.keyFor('payload-a')).toBe(a);
    expect(t.keyFor('payload-b')).not.toBe(a);
    const b = t.keyFor('payload-b');
    t.succeeded();
    expect(t.keyFor('payload-b')).not.toBe(b);
  });
});

describe('entry validation', () => {
  const base = { ...emptyDraft(), date: '2026-02-03' };
  it('builds canonical time entry bodies', () => {
    const r = validateEntry('time-entries', { ...base, minutes: '90', hourly: '250.50', text: ' ออกแบบ ' }, 'THB');
    expect(r).toEqual({ ok: true, body: { worked_on: '2026-02-03', minutes: 90, hourly_cost_minor: '25050', note: 'ออกแบบ' } });
  });
  it('rejects impossible dates and out-of-range minutes', () => {
    const r = validateEntry('time-entries', { ...base, date: '2026-02-30', minutes: '1441' }, 'THB');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['date', 'minutes']);
  });
  it('requires positive amounts and an expense description', () => {
    const r = validateEntry('expenses', { ...base, amount: '0', text: '' }, 'USD');
    expect(r.ok).toBe(false);
    expect(validateEntry('payments', { ...base, amount: '10' }, 'JPY')).toEqual({ ok: true, body: { received_on: '2026-02-03', amount_minor: '10' } });
  });
});

describe('project validation', () => {
  const draft = { name: 'A', client: 'B', currency: 'JPY', contract: '100000', hourly: '3000', status: 'active' };
  it('sends currency only on create, never on edit', () => {
    const create = validateProject(draft, 'create');
    const edit = validateProject({ ...draft, status: 'completed' }, 'edit');
    expect(create.ok && create.body.currency).toBe('JPY');
    expect(edit.ok && 'currency' in edit.body).toBe(false);
    expect(edit.ok && edit.body.status).toBe('completed');
  });
  it('rejects fractions for JPY contract', () => {
    expect(validateProject({ ...draft, contract: '1.5' }, 'create').ok).toBe(false);
  });
  it('matches API length bounds: names/clients 120, expense description 300, note 500 (code points)', () => {
    const name = (n: number) => 'ก'.repeat(n);
    expect(validateProject({ ...draft, name: name(120) }, 'create').ok).toBe(true);
    const longName = validateProject({ ...draft, name: name(121) }, 'create');
    expect(!longName.ok && longName.errors.name).toMatch(/120/);
    expect(validateProject({ ...draft, client: name(120) }, 'create').ok).toBe(true);
    const longClient = validateProject({ ...draft, client: name(121) }, 'create');
    expect(!longClient.ok && longClient.errors.client).toMatch(/120/);
    const base = { ...emptyDraft(), date: '2026-02-03', amount: '1' };
    expect(validateEntry('expenses', { ...base, text: name(300) }, 'THB').ok).toBe(true);
    const longExpense = validateEntry('expenses', { ...base, text: name(301) }, 'THB');
    expect(!longExpense.ok && longExpense.errors.text).toMatch(/300/);
    expect(validateEntry('payments', { ...base, text: name(500) }, 'THB').ok).toBe(true);
    const longNote = validateEntry('payments', { ...base, text: name(501) }, 'THB');
    expect(!longNote.ok && longNote.errors.text).toMatch(/500/);
    // astral characters count as one code point, like Python len()
    expect(validateEntry('expenses', { ...base, text: '😀'.repeat(300) }, 'THB').ok).toBe(true);
  });
});

describe('changedRows', () => {
  const project = (received: string, minutes = 0): Project => ({
    id: 'p', workspace_id: 'w', name: 'n', client_name: 'c', currency: 'THB', contract_value_minor: '1000', hourly_cost_minor: '100',
    status: 'active', created_at: '', updated_at: '',
    summary: {
      received_minor: received, expense_minor: '0', labor_cost_minor: '0', cash_surplus_minor: received,
      actual_profit_minor: received, projected_profit_minor: '1000', total_minutes: minutes, profit_per_hour_minor: null, margin_percent: null,
    },
  });
  it('flags changed rows only', () => {
    // a payment changes actual profit and cash, never the projected equation
    const payment = changedRows(project('0'), project('500'));
    expect([...payment].sort()).toEqual(['actual', 'cash', 'profit', 'revenue']);
    expect(payment.has('projected')).toBe(false);
    expect([...changedRows(project('0'), project('0', 30))]).toEqual(['time']);
    expect(changedRows(project('0'), project('0')).size).toBe(0);
  });
});
