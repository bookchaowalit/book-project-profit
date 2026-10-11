import type { ApiErrorCode } from './api-types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly requestId: string | null,
  ) {
    super(code);
  }
}

const KNOWN: readonly string[] = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_error',
  'idempotency_conflict',
  'service_unavailable',
  'configuration_required',
  'method_not_allowed',
];

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export const API_BASE = '/api/profit';

/** All private calls go through the same-origin BFF; no automatic retry happens here. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', null);
  }
  if (response.status === 204) return undefined as T;
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    if (response.ok) throw new ApiError(response.status, 'service_unavailable', null);
  }
  if (!response.ok) {
    const err = (parsed as { error?: { code?: unknown; request_id?: unknown } } | null)?.error;
    const code = typeof err?.code === 'string' && KNOWN.includes(err.code) ? (err.code as ApiErrorCode) : 'service_unavailable';
    throw new ApiError(response.status, code, typeof err?.request_id === 'string' ? err.request_id : null);
  }
  return parsed as T;
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
