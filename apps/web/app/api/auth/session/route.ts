import { openIdClientPort } from '@/lib/oidc';
import { handleSession } from '@/lib/auth-handlers';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleSession(request, { env: process.env, oidc: openIdClientPort });
}
