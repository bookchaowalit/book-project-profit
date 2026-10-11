// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfitApp } from '@/components/profit-app';
import { createSyntheticApi, type SyntheticApi } from '../shared/synthetic-api';

let api: SyntheticApi;

function install(a: SyntheticApi) {
  api = a;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const r = await api.handle(init.method ?? 'GET', String(input), body, headers);
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
}

beforeEach(() => install(createSyntheticApi()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ready() {
  const user = userEvent.setup();
  render(<ProfitApp displayName="ผู้ใช้สังเคราะห์" />);
  await screen.findByRole('heading', { level: 2, name: 'SYNTHETIC เว็บไซต์ร้านกาแฟ' });
  return user;
}

describe('ProfitApp', () => {
  it('shows the selected project comparison with exact formatting and the time denominator state', async () => {
    await ready();
    const table = screen.getByRole('table', { name: /เปรียบเทียบสัญญากับเงินที่ได้รับจริง/ });
    expect(within(table).getByText('120,000.00 THB')).toBeInTheDocument();
    expect(screen.getByText(/ยังคำนวณไม่ได้ เพราะยังไม่มีเวลาที่บันทึก/)).toBeInTheDocument();
    expect(screen.getByText(/ใช้เฉพาะต้นทุนที่บันทึกแล้ว/)).toBeInTheDocument();
    expect(screen.getByText(/แสดง 2 จากทั้งหมด 2 โปรเจกต์/)).toBeInTheDocument();
  });

  it('validates money locally and records a payment with an idempotency key, then recalculates', async () => {
    const user = await ready();
    await user.click(screen.getByRole('tab', { name: 'เงินที่ได้รับ' }));
    const amount = screen.getByLabelText(/จำนวนเงิน/);
    await user.type(amount, '1.234');
    await user.click(screen.getByRole('button', { name: 'บันทึกเงินที่ได้รับ' }));
    expect(await screen.findByText(/ทศนิยมเกินที่สกุลเงินนี้รองรับ/)).toBeInTheDocument();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(api.log.some((l) => l.method === 'POST')).toBe(false);

    await user.clear(amount);
    await user.type(amount, '5000.50');
    await user.click(screen.getByRole('button', { name: 'บันทึกเงินที่ได้รับ' }));
    await waitFor(() => expect(screen.getAllByText('5,000.50 THB').length).toBeGreaterThan(0));
    const post = api.log.find((l) => l.method === 'POST')!;
    expect(post.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(post.body).toMatchObject({ amount_minor: '500050' });
    await waitFor(() => expect(screen.getByText(/โหลดผลรวมล่าสุดสำเร็จ/, { selector: 'p.sr-only' })).toBeInTheDocument());
    // payment changes actual profit, never the projected equation
    expect(document.querySelector('[data-eq="actual"]')).toHaveClass('flash');
    expect(document.querySelector('[data-eq="projected"]')).not.toHaveClass('flash');
  });

  it('shows retained figures as STALE when a write succeeds but the project reload fails; retry repeats GET only', async () => {
    const user = await ready();
    const inner = globalThis.fetch;
    let failProject = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (failProject && method === 'GET' && /\/projects\/[^/?]+$/.test(String(input)) && api.log.some((l) => l.method === 'POST')) {
        return new Response(JSON.stringify({ error: { code: 'service_unavailable', message: 'x', request_id: 'req-1' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return inner(input, init);
    });
    await user.click(screen.getByRole('tab', { name: 'เงินที่ได้รับ' }));
    await user.type(screen.getByLabelText(/จำนวนเงิน/), '100');
    await user.click(screen.getByRole('button', { name: 'บันทึกเงินที่ได้รับ' }));
    const notice = await screen.findByText(/ค่าเก่า \(STALE\)/);
    expect(notice).toBeInTheDocument();
    expect(await screen.findByText(/ถูกบันทึกแล้ว แต่โหลดผลรวมใหม่ไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.queryByText(/โหลดผลรวมล่าสุดสำเร็จ/)).toBeNull();
    failProject = false;
    await user.click(screen.getByRole('button', { name: 'โหลดผลรวมอีกครั้ง' }));
    await waitFor(() => expect(screen.queryByText(/ค่าเก่า \(STALE\)/)).toBeNull());
    expect(api.log.filter((l) => l.method === 'POST')).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/โหลดผลรวมล่าสุดสำเร็จ/, { selector: 'p.sr-only' })).toBeInTheDocument());
  });

  it('keeps the same idempotency key across tab switches after a committed write with a lost response (one persisted entry)', async () => {
    const user = await ready();
    const inner = globalThis.fetch;
    let lose = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const response = await inner(input, init);
      if (lose && init.method === 'POST' && String(input).endsWith('/payments')) {
        lose = false;
        throw new TypeError('network down after commit'); // server committed, client never saw the response
      }
      return response;
    });
    await user.click(screen.getByRole('tab', { name: 'เงินที่ได้รับ' }));
    await user.type(screen.getByLabelText(/จำนวนเงิน/), '100');
    await user.click(screen.getByRole('button', { name: 'บันทึกเงินที่ได้รับ' }));
    await screen.findByRole('button', { name: /บันทึกเงินที่ได้รับ อีกครั้ง/ });
    await user.click(screen.getByRole('tab', { name: 'ค่าใช้จ่าย' }));
    await user.click(screen.getByRole('tab', { name: 'เงินที่ได้รับ' }));
    expect(screen.getByLabelText(/จำนวนเงิน/)).toHaveValue('100');
    await user.click(screen.getByRole('button', { name: /บันทึกเงินที่ได้รับ อีกครั้ง/ }));
    await waitFor(() => expect(screen.getByRole('table', { name: /รายการเงินที่ได้รับ/ })).toBeInTheDocument());
    const posts = api.log.filter((l) => l.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.key).toBe(posts[0]!.key);
    const rows = within(screen.getByRole('table', { name: /รายการเงินที่ได้รับ/ })).getAllByRole('row');
    expect(rows).toHaveLength(2); // header + exactly one persisted payment
  });

  it('completes a write whose tab changed while the POST was held: clears that draft and refetches canonical totals', async () => {
    const user = await ready();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    api.hooks.gate = (path) => (!path.includes('?') && path.endsWith('/payments') ? held : undefined);
    await user.click(screen.getByRole('tab', { name: 'เงินที่ได้รับ' }));
    await user.type(screen.getByLabelText(/จำนวนเงิน/), '100');
    await user.click(screen.getByRole('button', { name: 'บันทึกเงินที่ได้รับ' }));
    await waitFor(() => expect(api.log.some((l) => l.method === 'POST')).toBe(true));
    await user.click(screen.getByRole('tab', { name: 'ค่าใช้จ่าย' }));
    release();
    await waitFor(() => expect(screen.getByText(/โหลดผลรวมล่าสุดสำเร็จ/, { selector: 'p.sr-only' })).toBeInTheDocument());
    const table = screen.getByRole('table', { name: /เปรียบเทียบสัญญากับเงินที่ได้รับจริง/ });
    expect(within(table).getAllByText('100.00 THB').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'เงินที่ได้รับ' }));
    expect(screen.getByLabelText(/จำนวนเงิน/)).toHaveValue('');
  });

  it('offers an explicit GET-only retry when the first page of the project list fails', async () => {
    const inner = globalThis.fetch;
    let fail = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (fail && (init.method ?? 'GET') === 'GET' && /\/projects\?limit=/.test(String(input))) {
        fail = false;
        return new Response(JSON.stringify({ error: { code: 'service_unavailable', message: 'x', request_id: 'req-2' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return inner(input, init);
    });
    const user = userEvent.setup();
    render(<ProfitApp displayName="ผู้ใช้สังเคราะห์" />);
    await user.click(await screen.findByRole('button', { name: 'ลองอีกครั้ง' }));
    await screen.findByRole('heading', { level: 2, name: 'SYNTHETIC เว็บไซต์ร้านกาแฟ' });
    expect(api.log.some((l) => l.method === 'POST')).toBe(false);
  });

  it('offers an explicit GET-only retry when the first page of a history list fails', async () => {
    const inner = globalThis.fetch;
    let fail = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (fail && (init.method ?? 'GET') === 'GET' && /\/time-entries\?limit=/.test(String(input))) {
        fail = false;
        return new Response(JSON.stringify({ error: { code: 'service_unavailable', message: 'x', request_id: 'req-3' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return inner(input, init);
    });
    const user = await ready();
    await user.click(await screen.findByRole('button', { name: 'ลองอีกครั้ง' }));
    await screen.findByText(/ยังไม่มีรายการเวลาทำงาน/);
    expect(api.log.some((l) => l.method === 'POST')).toBe(false);
  });

  it('first-viewport action selects the type and moves focus to the chosen inline form', async () => {
    const user = await ready();
    await user.selectOptions(screen.getByLabelText('ประเภทที่จะเพิ่ม'), 'expenses');
    expect(screen.getByRole('tab', { name: 'ค่าใช้จ่าย' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));
    await waitFor(() => expect(screen.getByLabelText(/จำนวนเงิน/)).toHaveFocus());
  });

  it('keeps form data after a failed save and reuses the idempotency key on explicit retry only', async () => {
    const user = await ready();
    await user.click(screen.getByRole('tab', { name: 'ค่าใช้จ่าย' }));
    await user.type(screen.getByLabelText(/จำนวนเงิน/), '300');
    await user.type(screen.getByLabelText('รายละเอียด'), 'SYNTHETIC โดเมน');
    api.hooks.failNext = { status: 503, code: 'service_unavailable' };
    await user.click(screen.getByRole('button', { name: 'บันทึกค่าใช้จ่าย' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('บริการข้อมูลยังไม่พร้อมใช้งาน');
    expect(alert.textContent).not.toMatch(/(^|\s)synthetic(\s|$)/);
    expect(screen.getByLabelText(/จำนวนเงิน/)).toHaveValue('300');
    expect(api.log.filter((l) => l.method === 'POST')).toHaveLength(1); // no automatic retry

    await user.click(screen.getByRole('button', { name: /บันทึกค่าใช้จ่าย อีกครั้ง/ }));
    await waitFor(() => expect(api.log.filter((l) => l.method === 'POST')).toHaveLength(2));
    const [first, second] = api.log.filter((l) => l.method === 'POST');
    expect(second!.key).toBe(first!.key);
    expect(await screen.findByText('SYNTHETIC โดเมน')).toBeInTheDocument();
  });

  it('creates a project from the inline form using minor-unit strings and the project currency', async () => {
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'เพิ่มโปรเจกต์' }));
    const form = screen.getByRole('form', { name: 'สร้างโปรเจกต์' });
    await user.type(within(form).getByLabelText('ชื่อโปรเจกต์'), 'SYNTHETIC ใหม่');
    await user.type(within(form).getByLabelText('ชื่อลูกค้า'), 'SYNTHETIC Client N');
    await user.selectOptions(within(form).getByLabelText('สกุลเงิน'), 'JPY');
    await user.type(within(form).getByLabelText(/มูลค่าสัญญา/), '1500.5');
    await user.type(within(form).getByLabelText(/ต้นทุนแรงงาน/), '2000');
    await user.click(within(form).getByRole('button', { name: 'สร้างโปรเจกต์' }));
    expect(await within(form).findByText(/ทศนิยมเกินที่สกุลเงินนี้รองรับ/)).toBeInTheDocument();
    await user.clear(within(form).getByLabelText(/มูลค่าสัญญา/));
    await user.type(within(form).getByLabelText(/มูลค่าสัญญา/), '1500');
    await user.click(within(form).getByRole('button', { name: 'สร้างโปรเจกต์' }));
    await screen.findByRole('heading', { level: 2, name: 'SYNTHETIC ใหม่' });
    const post = api.log.find((l) => l.method === 'POST' && l.path.endsWith('/projects'))!;
    expect(post.body).toEqual({ name: 'SYNTHETIC ใหม่', client_name: 'SYNTHETIC Client N', currency: 'JPY', contract_value_minor: '1500', hourly_cost_minor: '2000' });
  });

  it('never shows a stale response after switching projects', async () => {
    const user = await ready();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    api.hooks.gate = (path) => (path === 'workspaces/ws-synthetic-1/projects/pr-2' ? held : undefined);
    await user.selectOptions(screen.getByLabelText('เลือกโปรเจกต์'), 'pr-2');
    await user.selectOptions(screen.getByLabelText('เลือกโปรเจกต์'), 'pr-1');
    release();
    await screen.findByRole('heading', { level: 2, name: 'SYNTHETIC เว็บไซต์ร้านกาแฟ' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('heading', { level: 2, name: 'SYNTHETIC App Redesign' })).toBeNull();
  });

  it('confirms before deleting an entry', async () => {
    const user = await ready();
    await user.type(screen.getByLabelText(/เวลาที่ทำ/), '90');
    await user.click(screen.getByRole('button', { name: 'บันทึกเวลา' }));
    const history = await screen.findByRole('table', { name: /รายการเวลาทำงาน/ });
    await within(history).findByText('1 ชม. 30 นาที');
    await user.click(screen.getByRole('button', { name: /ลบรายการเวลาทำงาน/ }));
    expect(api.log.some((l) => l.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'ยืนยันลบ' }));
    await waitFor(() => expect(api.log.some((l) => l.method === 'DELETE')).toBe(true));
    await screen.findByText(/ยังไม่มีรายการเวลาทำงาน/);
  });

  it('is read-only for viewers', async () => {
    const user = await ready();
    await user.selectOptions(screen.getByLabelText('เวิร์กสเปซ'), 'ws-synthetic-2');
    await screen.findByRole('heading', { level: 2, name: 'SYNTHETIC Read-only Project' });
    expect(screen.getByText(/อ่านได้อย่างเดียว/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เพิ่มโปรเจกต์' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'บันทึกเวลา' })).toBeNull();
  });

  it('shows the group overview per currency without merging', async () => {
    await ready();
    const table = await screen.findByRole('table', { name: 'ยอดรวมแยกตามสกุลเงิน' });
    expect(within(table).getByRole('rowheader', { name: 'THB' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'JPY' })).toBeInTheDocument();
  });

  it('shows a sign-in-again state when the session expired, without retrying', async () => {
    api.hooks.gate = null;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'x', request_id: null } }), { status: 401, headers: { 'content-type': 'application/json' } })));
    render(<ProfitApp displayName="ผู้ใช้สังเคราะห์" />);
    const links = await screen.findAllByRole('link', { name: 'เข้าสู่ระบบอีกครั้ง' });
    expect(links[0]).toHaveAttribute('href', '/api/auth/login');
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('guides the first project when the workspace is empty', async () => {
    const empty = createSyntheticApi();
    empty.projects.splice(0, empty.projects.length);
    install(empty);
    render(<ProfitApp displayName="ผู้ใช้สังเคราะห์" />);
    expect(await screen.findByText(/เริ่มจากกรอกมูลค่าสัญญา/)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'สร้างโปรเจกต์' })).toBeInTheDocument();
  });

  it('offers load-more instead of pretending a partial list is complete', async () => {
    install(createSyntheticApi({ extraProjects: 55 }));
    const user = userEvent.setup();
    render(<ProfitApp displayName="ผู้ใช้สังเคราะห์" />);
    await screen.findByText(/แสดง 50 จากทั้งหมด 57 โปรเจกต์/);
    await user.click(screen.getByRole('button', { name: /โหลดโปรเจกต์เพิ่ม/ }));
    await screen.findByText(/แสดง 57 จากทั้งหมด 57 โปรเจกต์/);
  });
});
