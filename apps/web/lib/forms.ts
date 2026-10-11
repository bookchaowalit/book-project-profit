import type { Project } from './api-types';
import {
  isCurrency,
  parseMinutesInput,
  parseMoneyInput,
  type Currency,
  type MoneyParseError,
} from './money';
import type { EntryKind } from './api-types';

export const MONEY_ERROR_TEXT: Record<MoneyParseError, string> = {
  empty: 'กรอกจำนวนเงิน',
  invalid: 'จำนวนเงินต้องเป็นตัวเลข เช่น 1250.50',
  negative: 'จำนวนเงินต้องไม่ติดลบ',
  comma: 'ไม่ต้องใส่เครื่องหมายจุลภาค ใช้จุดสำหรับทศนิยม เช่น 1250.50',
  precision: 'ทศนิยมเกินที่สกุลเงินนี้รองรับ ระบบจะไม่ปัดเศษให้',
  too_large: 'จำนวนเงินมากเกินไป (สูงสุด 15 หลักของหน่วยย่อย)',
  zero: 'จำนวนเงินต้องมากกว่า 0',
};

export function validDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface EntryDraft {
  date: string;
  minutes: string;
  amount: string;
  hourly: string;
  text: string;
}
export const emptyDraft = (): EntryDraft => ({ date: todayLocal(), minutes: '', amount: '', hourly: '', text: '' });

export type FieldErrors = Partial<Record<keyof EntryDraft, string>>;
export type Validation = { ok: true; body: Record<string, unknown> } | { ok: false; errors: FieldErrors };

/** Bounds mirror apps/api/app/schemas.py (Name/ClientName 120, Description 300, Note 500, counted in code points). */
export const MAX_NAME = 120;
export const MAX_CLIENT = 120;
export const MAX_DESCRIPTION = 300;
export const MAX_NOTE = 500;
export const charLength = (s: string): number => [...s].length;

export function validateEntry(kind: EntryKind, draft: EntryDraft, currency: Currency): Validation {
  const errors: FieldErrors = {};
  if (!validDate(draft.date)) errors.date = 'เลือกวันที่ให้ถูกต้อง';
  const text = draft.text.trim();
  const maxText = kind === 'expenses' ? MAX_DESCRIPTION : MAX_NOTE;
  if (charLength(text) > maxText) errors.text = `ยาวเกิน ${maxText} ตัวอักษร`;
  const body: Record<string, unknown> = {};
  if (kind === 'time-entries') {
    const minutes = parseMinutesInput(draft.minutes);
    if (!minutes.ok) errors.minutes = 'กรอกจำนวนนาทีเป็นจำนวนเต็ม 1 ถึง 1440';
    else body.minutes = minutes.minutes;
    body.worked_on = draft.date;
    if (draft.hourly.trim() !== '') {
      const hourly = parseMoneyInput(draft.hourly, currency);
      if (!hourly.ok) errors.hourly = MONEY_ERROR_TEXT[hourly.error];
      else body.hourly_cost_minor = hourly.minor;
    }
    if (text) body.note = text;
  } else {
    const amount = parseMoneyInput(draft.amount, currency, { allowZero: false });
    if (!amount.ok) errors.amount = MONEY_ERROR_TEXT[amount.error];
    else body.amount_minor = amount.minor;
    if (kind === 'expenses') {
      body[`spent_on`] = draft.date;
      if (!text) errors.text = 'กรอกรายละเอียดค่าใช้จ่าย';
      else body.description = text;
    } else {
      body.received_on = draft.date;
      if (text) body.note = text;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, body };
}

export interface ProjectDraft {
  name: string;
  client: string;
  currency: string;
  contract: string;
  hourly: string;
  status: string;
}
export type ProjectErrors = Partial<Record<keyof ProjectDraft, string>>;

export function validateProject(
  draft: ProjectDraft,
  mode: 'create' | 'edit',
): { ok: true; body: Record<string, unknown> } | { ok: false; errors: ProjectErrors } {
  const errors: ProjectErrors = {};
  const name = draft.name.trim();
  const client = draft.client.trim();
  if (!name) errors.name = 'กรอกชื่อโปรเจกต์';
  else if (charLength(name) > MAX_NAME) errors.name = `ชื่อโปรเจกต์ยาวเกิน ${MAX_NAME} ตัวอักษร`;
  if (!client) errors.client = 'กรอกชื่อลูกค้า';
  else if (charLength(client) > MAX_CLIENT) errors.client = `ชื่อลูกค้ายาวเกิน ${MAX_CLIENT} ตัวอักษร`;
  if (!isCurrency(draft.currency)) {
    errors.currency = 'เลือกสกุลเงิน';
    return { ok: false, errors };
  }
  const contract = parseMoneyInput(draft.contract, draft.currency);
  if (!contract.ok) errors.contract = MONEY_ERROR_TEXT[contract.error];
  const hourly = parseMoneyInput(draft.hourly, draft.currency);
  if (!hourly.ok) errors.hourly = MONEY_ERROR_TEXT[hourly.error];
  if (mode === 'edit' && !['active', 'completed', 'archived'].includes(draft.status)) errors.status = 'เลือกสถานะ';
  if (Object.keys(errors).length || !contract.ok || !hourly.ok) return { ok: false, errors };
  const body: Record<string, unknown> = {
    name,
    client_name: client,
    contract_value_minor: contract.minor,
    hourly_cost_minor: hourly.minor,
  };
  if (mode === 'create') body.currency = draft.currency;
  else body.status = draft.status; // currency is never patched
  return { ok: true, body };
}

/**
 * `profit` is the comparison total row (actual OR projected changed).
 * `actual`, `projected`, `cash`, `margin` are the individual equations and flash
 * only when their own value changes.
 */
export type RowKey = 'revenue' | 'expense' | 'labor' | 'profit' | 'actual' | 'projected' | 'cash' | 'margin' | 'time';

/** Which comparison rows changed between two canonical project reads. */
export function changedRows(prev: Project, next: Project): Set<RowKey> {
  const out = new Set<RowKey>();
  const a = prev.summary;
  const b = next.summary;
  if (prev.contract_value_minor !== next.contract_value_minor || a.received_minor !== b.received_minor) out.add('revenue');
  if (a.expense_minor !== b.expense_minor) out.add('expense');
  if (a.labor_cost_minor !== b.labor_cost_minor) out.add('labor');
  const actual = a.actual_profit_minor !== b.actual_profit_minor;
  const projected = a.projected_profit_minor !== b.projected_profit_minor;
  if (actual) out.add('actual');
  if (projected) out.add('projected');
  if (actual || projected) out.add('profit');
  if (a.cash_surplus_minor !== b.cash_surplus_minor) out.add('cash');
  if (a.margin_percent !== b.margin_percent) out.add('margin');
  if (String(a.total_minutes) !== String(b.total_minutes) || a.profit_per_hour_minor !== b.profit_per_hour_minor) out.add('time');
  return out;
}
