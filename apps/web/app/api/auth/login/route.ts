import { openIdClientPort } from '@/lib/oidc';
import { handleLogin } from '@/lib/auth-handlers';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleLogin(request, { env: process.env, oidc: openIdClientPort });
}
