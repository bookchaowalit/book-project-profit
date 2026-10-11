import { openIdClientPort } from '@/lib/oidc';
import { handleLogout } from '@/lib/auth-handlers';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleLogout(request, { env: process.env, oidc: openIdClientPort });
}
