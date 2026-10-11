'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { apiRequest, type ApiError } from '@/lib/api-client';
import type { Project } from '@/lib/api-types';
import { validateProject, type ProjectDraft } from '@/lib/forms';
import { createIdempotencyTracker } from '@/lib/idempotency';
import { CURRENCIES, currencyDecimals, isCurrency, minorToDecimal, parseApiMinor } from '@/lib/money';
import { toApiError } from './hooks';
import { ErrorNotice, Field } from './ui';

export function minorToInput(value: string, currency: string): string {
  const minor = parseApiMinor(value);
  return minor !== null && isCurrency(currency) ? minorToDecimal(minor, currency) : '';
}

interface Props {
  mode: 'create' | 'edit';
  workspaceId: string;
  project?: Project;
  onDone: (project: Project) => void;
  onCancel?: () => void;
  onError: (error: ApiError) => void;
}

const STATUS_OPTIONS = [
  ['active', 'กำลังดำเนินการ'],
  ['completed', 'เสร็จแล้ว'],
  ['archived', 'เก็บเข้าคลัง'],
] as const;

export function ProjectForm({ mode, workspaceId, project, onDone, onCancel, onError }: Props) {
  const uid = useId();
  const [draft, setDraft] = useState<ProjectDraft>(() => ({
    name: project?.name ?? '',
    client: project?.client_name ?? '',
    currency: project?.currency ?? 'THB',
    contract: project ? minorToInput(project.contract_value_minor, project.currency) : '',
    hourly: project ? minorToInput(project.hourly_cost_minor, project.currency) : '',
    status: project?.status ?? 'active',
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof ProjectDraft, string>>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const tracker = useRef(createIdempotencyTracker());
  const mounted = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const bind = (name: keyof ProjectDraft) => ({
    'data-field': name,
    value: draft[name],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [name]: e.target.value }),
  });
  const decimals = isCurrency(draft.currency) ? currencyDecimals(draft.currency) : 2;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const result = validateProject(draft, mode);
    if (!result.ok) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus());
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      const saved =
        mode === 'create'
          ? await apiRequest<Project>(`/workspaces/${encodeURIComponent(workspaceId)}/projects`, {
              method: 'POST',
              body: result.body,
              idempotencyKey: tracker.current.keyFor(JSON.stringify([workspaceId, result.body])),
            })
          : await apiRequest<Project>(`/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(project!.id)}`, {
              method: 'PATCH',
              body: result.body,
            });
      tracker.current.succeeded();
      if (mounted.current) onDone(saved);
    } catch (error) {
      if (!mounted.current) return;
      const apiError = toApiError(error);
      if (apiError.code === 'idempotency_conflict') tracker.current.reset();
      setFailure(apiError);
      onError(apiError);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const title = mode === 'create' ? 'สร้างโปรเจกต์' : 'แก้ไขโปรเจกต์';
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="project-form" aria-label={title}>
      <div className="form-row">
        <Field id={`${uid}-name`} label="ชื่อโปรเจกต์" error={errors.name}>
          {(a) => <input {...a} autoComplete="off" maxLength={200} {...bind('name')} />}
        </Field>
        <Field id={`${uid}-client`} label="ชื่อลูกค้า" error={errors.client}>
          {(a) => <input {...a} autoComplete="off" maxLength={200} {...bind('client')} />}
        </Field>
        {mode === 'create' ? (
          <Field id={`${uid}-currency`} label="สกุลเงิน" hint="แต่ละโปรเจกต์ใช้สกุลเงินเดียวและเปลี่ยนภายหลังไม่ได้" error={errors.currency}>
            {(a) => (
              <select {...a} {...bind('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <p className="readonly">
            สกุลเงิน <strong>{project?.currency}</strong> (เปลี่ยนไม่ได้)
          </p>
        )}
        <Field id={`${uid}-contract`} label={`มูลค่าสัญญา (${draft.currency})`} hint={decimals === 0 ? 'สกุลเงินนี้ไม่มีทศนิยม' : 'ใช้จุดเป็นทศนิยม ไม่ต้องใส่จุลภาค'} error={errors.contract}>
          {(a) => <input {...a} inputMode="decimal" autoComplete="off" {...bind('contract')} />}
        </Field>
        <Field id={`${uid}-hourly`} label={`ต้นทุนแรงงานต่อชั่วโมง (${draft.currency})`} hint="ใช้เป็นค่าเริ่มต้นของเวลาที่บันทึกใหม่ รายการเดิมไม่เปลี่ยน" error={errors.hourly}>
          {(a) => <input {...a} inputMode="decimal" autoComplete="off" {...bind('hourly')} />}
        </Field>
        {mode === 'edit' ? (
          <Field id={`${uid}-status`} label="สถานะ" error={errors.status}>
            {(a) => (
              <select {...a} {...bind('status')}>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </div>
      {failure ? <ErrorNotice error={failure} /> : null}
      <p className="inline-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'กำลังบันทึก…' : failure ? `${title}อีกครั้ง` : mode === 'create' ? 'สร้างโปรเจกต์' : 'บันทึกการแก้ไข'}
        </button>
        {onCancel ? (
          <button type="button" className="button" onClick={onCancel}>
            ยกเลิก
          </button>
        ) : null}
      </p>
    </form>
  );
}

export function WorkspaceForm({ onDone, onCancel, onError }: { onDone: (id: string) => void; onCancel: () => void; onError: (e: ApiError) => void }) {
  const uid = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const tracker = useRef(createIdempotencyTracker());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 200) {
      setError(trimmed ? 'ชื่อยาวเกิน 200 ตัวอักษร' : 'กรอกชื่อเวิร์กสเปซ');
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    setFailure(null);
    setBusy(true);
    try {
      const created = await apiRequest<{ id: string }>('/workspaces', {
        method: 'POST',
        body: { name: trimmed },
        idempotencyKey: tracker.current.keyFor(trimmed),
      });
      tracker.current.succeeded();
      onDone(created.id);
    } catch (e) {
      const apiError = toApiError(e);
      if (apiError.code === 'idempotency_conflict') tracker.current.reset();
      setFailure(apiError);
      onError(apiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="workspace-form" aria-label="สร้างเวิร์กสเปซ">
      <Field id={`${uid}-ws`} label="ชื่อเวิร์กสเปซใหม่" error={error}>
        {(a) => <input {...a} ref={inputRef} autoComplete="off" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      {failure ? <ErrorNotice error={failure} /> : null}
      <p className="inline-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'กำลังสร้าง…' : failure ? 'สร้างอีกครั้ง' : 'สร้างเวิร์กสเปซ'}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          ยกเลิก
        </button>
      </p>
    </form>
  );
}
