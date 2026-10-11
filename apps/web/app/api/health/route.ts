import { openIdClientPort } from '@/lib/oidc';
import { handleHealth } from '@/lib/auth-handlers';

export const dynamic = 'force-dynamic';

export function GET() {
  return handleHealth({ env: process.env, oidc: openIdClientPort });
}
