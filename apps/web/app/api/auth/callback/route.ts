import { openIdClientPort } from '@/lib/oidc';
import { handleCallback } from '@/lib/auth-handlers';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleCallback(request, { env: process.env, oidc: openIdClientPort });
}
