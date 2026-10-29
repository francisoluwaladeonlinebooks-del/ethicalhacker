import { cookies } from 'next/headers';
import { CSRF_COOKIE, SESSION_COOKIE } from '@/lib/db/context';

const PENDING_COOKIE = 'ficap_pending';
const SECURE = process.env.NODE_ENV === 'production';

/** Session cookie (httpOnly) plus a readable CSRF token for double-submit forms. */
export async function setSessionCookies(token: string, csrf: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE,
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  store.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    sameSite: 'lax',
    secure: SECURE,
    path: '/',
    maxAge: 8 * 60 * 60,
  });
}

/** Short lived cookie holding the MFA-pending session token. */
export async function setPendingCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE,
    path: '/',
    maxAge: 10 * 60,
  });
}

export async function readPendingCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(PENDING_COOKIE)?.value ?? null;
}

export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
  store.delete(PENDING_COOKIE);
}

export async function clearPendingCookie(): Promise<void> {
  const store = await cookies();
  store.delete(PENDING_COOKIE);
}
