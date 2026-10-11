'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { ApiError } from '@/lib/api-client';
import type { Entry, EntryKind, Expense, Payment, TimeEntry } from '@/lib/api-types';
import { emptyDraft, validateEntry, type EntryDraft, type FieldErrors } from '@/lib/forms';
import { createIdempotencyTracker, type IdempotencyTracker } from '@/lib/idempotency';
import { formatMinutes, formatMoney, type Currency } from '@/lib/money';
import { usePaged, toApiError } from './hooks';
import { ErrorNotice, Field, Loading } from './ui';

const TABS: { kind: EntryKind; label: string; add: string; noun: string }[] = [
  { kind: 'time-entries', label: 'เวลาทำงาน', add: 'บันทึกเวลา', noun: 'เวลาทำงาน' },
  { kind: 'expenses', label: 'ค่าใช้จ่าย', add: 'บันทึกค่าใช้จ่าย', noun: 'ค่าใช้จ่าย' },
  { kind: 'payments', label: 'เงินที่ได้รับ', add: 'บันทึกเงินที่ได้รับ', noun: 'เงินที่ได้รับ' },
];

const DATE_LABEL: Record<EntryKind, string> = { 'time-entries': 'วันที่ทำงาน', expenses: 'วันที่จ่าย', payments: 'วันที่รับเงิน' };

interface Props {
  basePath: string; // /workspaces/{wid}/projects/{pid}
  currency: Currency;
  canWrite: boolean;
  defaultHourlyHint: string;
  refresh: number;
  onSaved: (message: string) => void;
  onError: (error: ApiError) => void;
}

export const ENTRY_KINDS: { kind: EntryKind; label: string }[] = TABS.map((t) => ({ kind: t.kind, label: t.label }));

/** Compact first-viewport entrypoint: choose a type, then jump to its inline form. */
export function RecordAction({ kind, onKind, onGo }: { kind: EntryKind; onKind: (k: EntryKind) => void; onGo: () => void }) {
  const uid = useId();
  return (
    <div className="record-action">
      <div className="record-field">
        <label htmlFor={`${uid}-kind`}>ประเภทที่จะเพิ่ม</label>
        <select id={`${uid}-kind`} value={kind} onChange={(e) => onKind(e.target.value as EntryKind)}>
          {ENTRY_KINDS.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="button primary" onClick={onGo}>
        เพิ่มรายการ
      </button>
    </div>
  );
}

interface TransactionsProps extends Props {
  kind: EntryKind;
  onKind: (k: EntryKind) => void;
  /** Increments when the user asks to jump to the chosen form. */
  focusRequest: number;
}

export function Transactions({ kind, onKind: setKind, focusRequest, ...props }: TransactionsProps) {
  const [drafts, setDrafts] = useState<Record<EntryKind, EntryDraft>>({
    'time-entries': emptyDraft(),
    expenses: emptyDraft(),
    payments: emptyDraft(),
  });
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sectionRef = useRef<HTMLElement>(null);
  const uid = useId();

  // Submission state lives here (not in the per-tab form) so switching tabs can neither
  // lose the idempotency key of a failed submission nor skip completion of a pending one.
  const trackers = useRef<Partial<Record<EntryKind, IdempotencyTracker>>>({});
  const inFlight = useRef<Set<EntryKind>>(new Set());
  const [busy, setBusy] = useState<Partial<Record<EntryKind, boolean>>>({});
  const [failures, setFailures] = useState<Partial<Record<EntryKind, ApiError | null>>>({});
  const latest = useRef(props);
  latest.current = props;

  async function submit(k: EntryKind, submitted: EntryDraft, body: Record<string, unknown>) {
    if (inFlight.current.has(k)) return;
    inFlight.current.add(k);
    const tracker = (trackers.current[k] ??= createIdempotencyTracker());
    const { basePath } = latest.current;
    setBusy((b) => ({ ...b, [k]: true }));
    setFailures((f) => ({ ...f, [k]: null }));
    const key = tracker.keyFor(JSON.stringify([basePath, k, body]));
    try {
      await apiRequest(`${basePath}/${k}`, { method: 'POST', body, idempotencyKey: key });
      tracker.succeeded();
      // Clear only what was submitted; keep edits the user made while the request was pending.
      setDrafts((all) => (all[k] === submitted ? { ...all, [k]: { ...emptyDraft(), date: submitted.date } } : all));
      latest.current.onSaved('บันทึกรายการแล้ว');
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'idempotency_conflict') tracker.reset();
      setFailures((f) => ({ ...f, [k]: apiError }));
      latest.current.onError(apiError);
    } finally {
      inFlight.current.delete(k);
      setBusy((b) => ({ ...b, [k]: false }));
    }
  }

  useEffect(() => {
    if (focusRequest === 0) return;
    const form = sectionRef.current?.querySelector<HTMLFormElement>('form.entry-form');
    if (!form) return;
    form.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    form.querySelector<HTMLElement>('[data-field="minutes"],[data-field="amount"]')?.focus({ preventScroll: true });
  }, [focusRequest]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((t) => t.kind === kind);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setKind(TABS[next]!.kind);
    tabRefs.current[TABS[next]!.kind]?.focus();
  }

  const tab = TABS.find((t) => t.kind === kind)!;
  return (
    <section ref={sectionRef} aria-labelledby={`${uid}-title`} className="sheet transactions">
      <h2 id={`${uid}-title`}>รายการที่บันทึก</h2>
      <div role="tablist" aria-label="ประเภทรายการ" className="tabs" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.kind}
            ref={(el) => {
              tabRefs.current[t.kind] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-tab-${t.kind}`}
            aria-selected={kind === t.kind}
            aria-controls={`${uid}-panel`}
            tabIndex={kind === t.kind ? 0 : -1}
            onClick={() => setKind(t.kind)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${kind}`} className="tabpanel">
        {props.canWrite ? (
          <EntryForm
            key={`form-${kind}`}
            kind={kind}
            label={tab.add}
            draft={drafts[kind]}
            setDraft={(d) => setDrafts((all) => ({ ...all, [kind]: d }))}
            currency={props.currency}
            defaultHourlyHint={props.defaultHourlyHint}
            busy={!!busy[kind]}
            failure={failures[kind] ?? null}
            onSubmit={submit}
          />
        ) : (
          <p className="muted">บทบาทของคุณในเวิร์กสเปซนี้อ่านได้อย่างเดียว จึงไม่มีฟอร์มบันทึก</p>
        )}
        <History key={`history-${kind}`} kind={kind} noun={tab.noun} {...props} />
      </div>
    </section>
  );
}

function EntryForm({
  kind,
  label,
  draft,
  setDraft,
  currency,
  defaultHourlyHint,
  busy,
  failure,
  onSubmit,
}: {
  kind: EntryKind;
  label: string;
  draft: EntryDraft;
  setDraft: (d: EntryDraft) => void;
  currency: Currency;
  defaultHourlyHint: string;
  busy: boolean;
  failure: ApiError | null;
  onSubmit: (kind: EntryKind, draft: EntryDraft, body: Record<string, unknown>) => void;
}) {
  const uid = useId();
  const [errors, setErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  const set = (key: keyof EntryDraft) => (value: string) => setDraft({ ...draft, [key]: value });
  const textLabel = kind === 'expenses' ? 'รายละเอียด' : 'หมายเหตุ (ไม่บังคับ)';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const result = validateEntry(kind, draft, currency);
    if (!result.ok) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus());
      return;
    }
    setErrors({});
    onSubmit(kind, draft, result.body);
  }

  const input = (name: keyof EntryDraft, props: Record<string, unknown>) => ({
    ...props,
    'data-field': name,
    value: draft[name],
    onChange: (e: { target: { value: string } }) => set(name)(e.target.value),
  });

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="entry-form" aria-label={label}>
      <div className="form-row">
        <Field id={`${uid}-date`} label={DATE_LABEL[kind]} error={errors.date}>
          {(a) => <input {...a} type="date" {...input('date', {})} required />}
        </Field>
        {kind === 'time-entries' ? (
          <Field id={`${uid}-minutes`} label="เวลาที่ทำ (นาที)" hint="จำนวนเต็ม 1 ถึง 1440" error={errors.minutes}>
            {(a) => <input {...a} inputMode="numeric" autoComplete="off" {...input('minutes', {})} />}
          </Field>
        ) : (
          <Field id={`${uid}-amount`} label={`จำนวนเงิน (${currency})`} hint="ใช้จุดเป็นทศนิยม ไม่ต้องใส่จุลภาค" error={errors.amount}>
            {(a) => <input {...a} inputMode="decimal" autoComplete="off" {...input('amount', {})} />}
          </Field>
        )}
        {kind === 'time-entries' ? (
          <Field id={`${uid}-hourly`} label={`ค่าแรงต่อชั่วโมง (${currency}, ไม่บังคับ)`} hint={`เว้นว่างเพื่อใช้ค่าของโปรเจกต์ ${defaultHourlyHint}`} error={errors.hourly}>
            {(a) => <input {...a} inputMode="decimal" autoComplete="off" {...input('hourly', {})} />}
          </Field>
        ) : null}
        <Field id={`${uid}-text`} label={textLabel} error={errors.text}>
          {(a) => <input {...a} autoComplete="off" maxLength={600} {...input('text', {})} />}
        </Field>
      </div>
      {failure ? <ErrorNotice error={failure} /> : null}
      <p>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'กำลังบันทึก…' : failure ? `${label} อีกครั้ง` : label}
        </button>
      </p>
    </form>
  );
}

function History({ kind, noun, basePath, currency, canWrite, refresh, onSaved, onError }: Props & { kind: EntryKind; noun: string }) {
  const list = usePaged<Entry>(`${basePath}/${kind}`, refresh);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function remove(id: string) {
    setDeleting(id);
    setFailure(null);
    try {
      await apiRequest(`${basePath}/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setConfirming(null);
      // Canonical refetch must happen even if the user switched tabs while the delete was pending.
      onSaved('ลบรายการแล้ว');
    } catch (error) {
      const apiError = toApiError(error);
      setFailure(apiError);
      onError(apiError);
    } finally {
      setDeleting(null);
    }
  }

  if (list.loading) return <Loading label={`กำลังโหลดรายการ${noun}…`} />;
  if (list.error && list.items.length === 0) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  const remaining = list.total - list.items.length;
  return (
    <div className="history" aria-busy={list.refreshing}>
      {list.error ? (
        <div role="alert" className="notice notice-error">
          <strong>รายการที่แสดงอาจไม่ล่าสุด</strong>
          <p>โหลดรายการใหม่ไม่สำเร็จ รายการด้านล่างเป็นค่าเก่า ลองโหลดอีกครั้ง (ไม่บันทึกซ้ำ)</p>
          <p>
            <button type="button" className="button" onClick={list.reload}>
              โหลดรายการอีกครั้ง
            </button>
          </p>
        </div>
      ) : null}
      {failure ? <ErrorNotice error={failure} /> : null}
      {list.items.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ{noun} {canWrite ? 'กรอกฟอร์มด้านบนเพื่อบันทึกรายการแรก' : ''}</p>
      ) : (
        <table className="stack-table entries">
          <caption className="sr-only">
            รายการ{noun} แสดง {list.items.length} จากทั้งหมด {list.total}
          </caption>
          <thead>
            <tr>
              <th scope="col">วันที่</th>
              <th scope="col">{kind === 'time-entries' ? 'เวลา' : 'จำนวนเงิน'}</th>
              <th scope="col">{kind === 'time-entries' ? 'ค่าแรง/ชม. ที่บันทึก' : kind === 'expenses' ? 'รายละเอียด' : 'หมายเหตุ'}</th>
              {kind === 'time-entries' ? <th scope="col">หมายเหตุ</th> : null}
              {canWrite ? <th scope="col">จัดการ</th> : null}
            </tr>
          </thead>
          <tbody>
            {list.items.map((entry) => (
              <tr key={entry.id}>
                <EntryCells kind={kind} entry={entry} currency={currency} />
                {canWrite ? (
                  <td data-label="จัดการ">
                    {confirming === entry.id ? (
                      <span className="inline-actions">
                        <button type="button" className="button danger" disabled={deleting === entry.id} onClick={() => remove(entry.id)}>
                          {deleting === entry.id ? 'กำลังลบ…' : 'ยืนยันลบ'}
                        </button>
                        <button type="button" className="button" onClick={() => setConfirming(null)}>
                          ยกเลิก
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="button" onClick={() => setConfirming(entry.id)} aria-label={`ลบรายการ${noun}วันที่ ${dateOf(entry)}`}>
                        ลบ
                      </button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small" role="status">
        แสดง {list.items.length} จากทั้งหมด {list.total} รายการ
      </p>
      {list.moreError ? <ErrorNotice error={list.moreError} onRetry={list.loadMore} /> : null}
      {remaining > 0 ? (
        <p>
          <button type="button" className="button" onClick={list.loadMore} disabled={list.loadingMore || list.refreshing}>
            {list.loadingMore ? 'กำลังโหลด…' : `โหลดเพิ่ม (เหลือ ${remaining})`}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function dateOf(entry: Entry): string {
  return 'worked_on' in entry ? entry.worked_on : 'spent_on' in entry ? entry.spent_on : entry.received_on;
}

function EntryCells({ kind, entry, currency }: { kind: EntryKind; entry: Entry; currency: Currency }) {
  if (kind === 'time-entries') {
    const e = entry as TimeEntry;
    return (
      <>
        <td data-label="วันที่">{e.worked_on}</td>
        <td data-label="เวลา" className="num">{formatMinutes(e.minutes)}</td>
        <td data-label="ค่าแรง/ชม. ที่บันทึก" className="num">{formatMoney(e.hourly_cost_minor, currency)}</td>
        <td data-label="หมายเหตุ">{e.note || '—'}</td>
      </>
    );
  }
  if (kind === 'expenses') {
    const e = entry as Expense;
    return (
      <>
        <td data-label="วันที่">{e.spent_on}</td>
        <td data-label="จำนวนเงิน" className="num">{formatMoney(e.amount_minor, currency)}</td>
        <td data-label="รายละเอียด">{e.description}</td>
      </>
    );
  }
  const e = entry as Payment;
  return (
    <>
      <td data-label="วันที่">{e.received_on}</td>
      <td data-label="จำนวนเงิน" className="num">{formatMoney(e.amount_minor, currency)}</td>
      <td data-label="หมายเหตุ">{e.note || '—'}</td>
    </>
  );
}
