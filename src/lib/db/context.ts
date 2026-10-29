import { cookies, headers } from 'next/headers';
import { ensureDatabaseReady } from '@/lib/db/migrate';
import { loadSession, type ActiveSession } from '@/lib/domain/auth';
import { buildAccessScope, type Permission, type SessionUser } from '@/lib/rbac';
import type { AccessScope } from '@/lib/db/pool';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';

export const SESSION_COOKIE = 'ficap_session';
export const CSRF_COOKIE = 'ficap_csrf';

/** Session context resolved for a server component or route handler. */
export type RequestContext = {
  session: ActiveSession['session'];
  user: SessionUser;
  scope: AccessScope;
  ip: string;
  userAgent: string;
  requestId: string;
  token: string;
  mode: 'demo' | 'live';
};

export async function platformMode(): Promise<'demo' | 'live'> {
  const value = (process.env.FICAP_MODE ?? 'demo').toLowerCase();
  return value === 'live' ? 'live' : 'demo';
}

export async function getRequestContext(options: { required?: boolean } = {}): Promise<RequestContext | null> {
  await ensureDatabaseReady();
  const cookieStore = await cookies();
  const headerStore = await headers();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  if (!token) {
    if (options.required === false) return null;
    throw new UnauthorizedError();
  }
  const active = await loadSession(token);
  if (!active) {
    if (options.required === false) return null;
    throw new UnauthorizedError('Your session has expired. Sign in again.');
  }
  const mode = await platformMode();
  const user: SessionUser = { ...active.user, mfa_verified: Boolean(active.session.mfa_verified) };
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const userAgent = headerStore.get('user-agent') ?? 'unknown';
  const requestId = headerStore.get('x-request-id') ?? crypto.randomUUID();
  return {
    session: active.session,
    user,
    scope: buildAccessScope(user, { requestId, ip, mode }),
    ip,
    userAgent,
    requestId,
    token,
    mode,
  };
}

export async function requirePermission(permission: Permission): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) throw new UnauthorizedError();
  const { can } = await import('@/lib/rbac');
  if (!can(ctx.user, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
  return ctx;
}

/** CSRF check for state-changing requests (double submit + origin check). */
export function assertCsrf(request: Request, ctx: RequestContext): void {
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
  const headerToken = request.headers.get('x-csrf-token') ?? '';
  if (!headerToken || headerToken !== ctx.session.csrf_token) {
    throw new ForbiddenError('Invalid or missing CSRF token. Reload the page and try again.');
  }
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) throw new ForbiddenError('Cross-origin request rejected');
    } catch {
      throw new ForbiddenError('Invalid origin');
    }
  }
}
