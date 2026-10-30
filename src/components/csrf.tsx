import { cookies } from 'next/headers';
import { CSRF_COOKIE } from '@/lib/db/context';

/**
 * Server-rendered CSRF token field. Server actions verify this value against
 * the session record, so a form on a stale page fails closed rather than
 * silently mutating state.
 */
export async function Csrf() {
  const token = (await cookies()).get(CSRF_COOKIE)?.value ?? '';
  return <input type="hidden" name="_csrf" value={token} />;
}
