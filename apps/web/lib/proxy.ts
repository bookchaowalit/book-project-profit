import { hostAllowed, loadConfig, mutationOriginAllowed, type Env } from './config';
import { errorResponse, CONFIG_REQUIRED, jsonResponse } from './auth-handlers';
import { parseCookie, readSession, SESSION_COOKIE, systemClock, type Clock } from './session';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const UPSTREAM_TIMEOUT_MS = 10_000;

const ID = '[A-Za-z0-9_-]{1,64}';
const RESOURCE = '(?:time-entries|expenses|payments)';

interface Route {
  pattern: RegExp;
  methods: readonly string[];
  /** Methods that must carry Idempotency-Key. */
  idempotent: readonly string[];
  list?: boolean;
}

// The only upstream paths the BFF will ever call (relative to /v1).
const ROUTES: Route[] = [
  { pattern: /^workspaces$/, methods: ['GET', 'POST'], idempotent: ['POST'] },
  { pattern: new RegExp(`^workspaces/${ID}/summary$`), methods: ['GET'], idempotent: [] },
  { pattern: new RegExp(`^workspaces/${ID}/projects$`), methods: ['GET', 'POST'], idempotent: ['POST'], list: true },
  { pattern: new RegExp(`^workspaces/${ID}/projects/${ID}$`), methods: ['GET', 'PATCH'], idempotent: [] },
  {
    pattern: new RegExp(`^workspaces/${ID}/projects/${ID}/${RESOURCE}$`),
    methods: ['GET', 'POST'],
    idempotent: ['POST'],
    list: true,
  },
  {
    pattern: new RegExp(`^workspaces/${ID}/projects/${ID}/${RESOURCE}/${ID}$`),
    methods: ['DELETE'],
    idempotent: [],
  },
];

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._-]{16,128}$/;
const ERROR_CODES = new Set([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_error',
  'idempotency_conflict',
  'service_unavailable',
]);
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function matchRoute(segments: string[]) {
  if (segments.length === 0 || segments.some((s) => !/^[A-Za-z0-9_-]+$/.test(s))) return null;
  const path = segments.join('/');
  return ROUTES.find((r) => r.pattern.test(path)) ?? null;
}

function listQuery(search: URLSearchParams): string | null {
  const out = new URLSearchParams();
  for (const [key, value] of search) {
    if ((key !== 'limit' && key !== 'offset') || !/^\d{1,6}$/.test(value) || out.has(key)) return null;
    if (key === 'limit' && (Number(value) < 1 || Number(value) > 100)) return null;
    out.set(key, value);
  }
  const text = out.toString();
  return text ? `?${text}` : '';
}

async function readBounded(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export interface ProxyDeps {
  env: Env;
  fetch?: typeof fetch;
  now?: Clock;
}

function envelope(status: number, code: string, message: string, requestId: string | null = null): Response {
  return jsonResponse(status, { error: { code, message, request_id: requestId } });
}

function statusToCode(status: number): string {
  if (status === 400 || status === 422) return 'validation_error';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'idempotency_conflict';
  return 'service_unavailable';
}

/** Re-emit only the documented error envelope fields; never the upstream body. */
function sanitizedUpstreamError(status: number, text: string): Response {
  let code = statusToCode(status);
  let message = 'คำขอไม่สำเร็จ';
  let requestId: string | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    const err = (parsed as { error?: Record<string, unknown> } | null)?.error;
    if (err && typeof err === 'object') {
      if (typeof err.code === 'string' && ERROR_CODES.has(err.code)) code = err.code;
      if (typeof err.message === 'string') message = err.message.slice(0, 300);
      if (typeof err.request_id === 'string' && REQUEST_ID.test(err.request_id)) requestId = err.request_id;
    }
  } catch {
    // keep the status-derived envelope
  }
  const outStatus = status >= 400 && status < 600 ? status : 502;
  return envelope(outStatus, code, message, requestId);
}

export async function handleProxy(request: Request, segments: string[], deps: ProxyDeps): Promise<Response> {
  const loaded = loadConfig(deps.env);
  if (!loaded.ready) return CONFIG_REQUIRED();
  const { config } = loaded;
  if (!hostAllowed(request, config)) return errorResponse(403, 'forbidden', 'โดเมนนี้ไม่ได้รับอนุญาต');

  const route = matchRoute(segments);
  if (!route) return envelope(404, 'not_found', 'ไม่พบเส้นทางนี้');
  const method = request.method.toUpperCase();
  if (!route.methods.includes(method)) return envelope(405, 'method_not_allowed', 'ไม่รองรับวิธีนี้');

  const mutating = method !== 'GET';
  const incomingOrigin = request.headers.get('origin');
  if (mutating ? !mutationOriginAllowed(request, config) : incomingOrigin !== null && incomingOrigin !== config.webOrigin) {
    return envelope(403, 'forbidden', 'คำขอไม่ได้มาจากเว็บนี้');
  }

  const url = new URL(request.url);
  let query = '';
  if (method === 'GET' && route.list) {
    const q = listQuery(url.searchParams);
    if (q === null) return envelope(400, 'validation_error', 'พารามิเตอร์หน้าไม่ถูกต้อง');
    query = q;
  } else if (url.search !== '') {
    return envelope(400, 'validation_error', 'ไม่รองรับพารามิเตอร์ในคำขอนี้');
  }

  let body: Uint8Array | undefined;
  let idempotencyKey: string | null = null;
  if (method === 'POST' || method === 'PATCH') {
    const type = request.headers.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;.*)?$/i.test(type)) {
      return envelope(415, 'validation_error', 'ต้องส่งข้อมูลเป็น application/json');
    }
    const declared = request.headers.get('content-length');
    if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
      return envelope(413, 'validation_error', 'ข้อมูลที่ส่งมีขนาดใหญ่เกินไป');
    }
    const bytes = await readBounded(request.body, MAX_BODY_BYTES);
    if (!bytes) return envelope(413, 'validation_error', 'ข้อมูลที่ส่งมีขนาดใหญ่เกินไป');
    try {
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return envelope(400, 'validation_error', 'รูปแบบข้อมูลไม่ถูกต้อง');
    }
    body = bytes;
  }
  if (route.idempotent.includes(method)) {
    idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return envelope(400, 'validation_error', 'ต้องมี Idempotency-Key ที่ถูกต้อง');
    }
  }

  // Credentials only ever come from the decrypted server session.
  const session = await readSession(
    parseCookie(request.headers.get('cookie'), SESSION_COOKIE),
    config,
    deps.now ?? systemClock,
  );
  if (!session) return envelope(401, 'unauthorized', 'ต้องเข้าสู่ระบบอีกครั้ง');

  const upstream = `${config.apiOrigin}/v1/${segments.join('/')}${query}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${session.accessToken}`,
    accept: 'application/json',
  };
  if (body) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(upstream, {
      method,
      headers,
      body: body ? Buffer.from(body) : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return envelope(503, 'service_unavailable', 'เชื่อมต่อบริการข้อมูลไม่ได้');
  }
  if (response.status >= 300 && response.status < 400) {
    return envelope(502, 'service_unavailable', 'บริการข้อมูลตอบกลับไม่ถูกต้อง');
  }
  if (response.status === 204) {
    return method === 'DELETE' ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }) : envelope(502, 'service_unavailable', 'บริการข้อมูลตอบกลับไม่ถูกต้อง');
  }
  let text: string;
  try {
    const bytes = await readBounded(response.body, MAX_RESPONSE_BYTES);
    if (!bytes) return envelope(502, 'service_unavailable', 'บริการข้อมูลตอบกลับไม่ถูกต้อง');
    text = new TextDecoder().decode(bytes);
  } catch {
    return envelope(503, 'service_unavailable', 'เชื่อมต่อบริการข้อมูลไม่ได้');
  }
  if (!response.ok) return sanitizedUpstreamError(response.status, text);
  if (!/^application\/json/i.test(response.headers.get('content-type') ?? '')) {
    return envelope(502, 'service_unavailable', 'บริการข้อมูลตอบกลับไม่ถูกต้อง');
  }
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
