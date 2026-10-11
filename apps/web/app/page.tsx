import { cookies, headers } from 'next/headers';
import { ProfitApp } from '@/components/profit-app';
import { SignedOut } from '@/components/signed-out';
import { loadConfig } from '@/lib/config';
import { readSession, SESSION_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const reason = typeof query.auth_error === 'string' ? query.auth_error : null;
  const loaded = loadConfig(process.env);
  if (!loaded.ready) return <SignedOut state="config" />;
  const host = (await headers()).get('host');
  if (host !== new URL(loaded.config.webOrigin).host) return <SignedOut state="config" />;
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSession(value, loaded.config);
  if (!session) return <SignedOut state="signed-out" reason={reason} />;
  // Only the display name crosses to the browser; the access token stays server-side.
  return <ProfitApp displayName={session.displayName} />;
}
