'use client';

import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/api-client';
import { ERROR_TEXT } from '@/lib/error-text';

export function ErrorNotice({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const text = ERROR_TEXT[error.code];
  return (
    <div role="alert" className="notice notice-error">
      <strong>{text.title}</strong>
      <p>{text.recovery}</p>
      {error.code === 'unauthorized' ? (
        <p>
          <a className="button" href="/api/auth/login">
            เข้าสู่ระบบอีกครั้ง
          </a>
        </p>
      ) : null}
      {onRetry && error.code !== 'unauthorized' ? (
        <p>
          <button type="button" className="button" onClick={onRetry}>
            ลองอีกครั้ง
          </button>
        </p>
      ) : null}
      {error.requestId ? <p className="muted small">รหัสอ้างอิง: {error.requestId}</p> : null}
    </div>
  );
}

/**
 * Shown when figures are retained from an earlier successful read but the latest
 * refresh failed. Retry only repeats the read (GET), never a write.
 */
export function StaleNotice({ error, subject, saved, onRetry }: { error: ApiError; subject: string; saved?: boolean; onRetry: () => void }) {
  const text = ERROR_TEXT[error.code];
  return (
    <div role="alert" className="notice notice-error" data-stale-notice>
      <strong>{subject}ที่แสดงอยู่เป็นค่าเก่า (STALE) ยังไม่ใช่ผลล่าสุด</strong>
      <p>
        {saved ? 'รายการที่เพิ่งทำถูกบันทึกแล้ว แต่โหลดผลรวมใหม่ไม่สำเร็จ ' : 'โหลดข้อมูลใหม่ไม่สำเร็จ '}
        {text.title}: {text.recovery}
      </p>
      {error.code === 'unauthorized' ? (
        <p>
          <a className="button" href="/api/auth/login">
            เข้าสู่ระบบอีกครั้ง
          </a>
        </p>
      ) : (
        <p>
          <button type="button" className="button" onClick={onRetry}>
            โหลดผลรวมอีกครั้ง
          </button>
        </p>
      )}
      {error.requestId ? <p className="muted small">รหัสอ้างอิง: {error.requestId}</p> : null}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="muted">
      {label}
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy || undefined })}
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
