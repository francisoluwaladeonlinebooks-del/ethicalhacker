import { cookies, headers } from 'next/headers';
import { CSRF_COOKIE, SESSION_COOKIE } from '@/lib/db/context';

const PENDING_COOKIE = 'ficap_pending';

/** Lifetime of the MFA-pending state, in seconds. Mirrors PENDING_MFA_MINUTES. */
const PENDING_MAX_AGE = 10 * 60;
/** Absolute session lifetime, in seconds. Mirrors SESSION_ABSOLUTE_MINUTES. */
const SESSION_MAX_AGE = 8 * 60 * 60;

export type SameSitePolicy = 'lax' | 'strict' | 'none';

export type CookiePolicy = {
  secure: boolean;
  sameSite: SameSitePolicy;
  /** CHIPS: allows the cookie to survive third-party cookie blocking in a framed context. */
  partitioned: boolean;
};

function parseBoolean(value: string | undefined): boolean | undefined {
  const normalised = (value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false;
  return undefined;
}

/**
 * Resolve cookie attributes for the *current request*.
 *
 * Using `NODE_ENV === 'production'` to decide `Secure` was wrong: a production
 * build served over plain HTTP sets a Secure cookie that the browser silently
 * discards, and the MFA step then loses its pending session and reports an
 * expiry that never happened. The decision is therefore made from the actual
 * request scheme, and is overridable per deployment:
 *
 *   FICAP_COOKIE_SECURE=1|0        force the Secure attribute on or off
 *   FICAP_COOKIE_SAMESITE=lax|strict|none
 *
 * When the platform is embedded in a third-party frame (the hosted preview), a
 * `Lax` cookie is not sent on the action POST because the request is cross-site.
 * In that case, and only over HTTPS, the policy widens to `SameSite=None` with
 * CHIPS partitioning. That is the one case where widening is required, and the
 * CSRF token check plus the framework's own Origin verification still apply to
 * every mutating request.
 */
export async function cookiePolicy(): Promise<CookiePolicy> {
  const store = await headers();
  const forwardedProto = (store.get('x-forwarded-proto') ?? '').split(',')[0].trim().toLowerCase();
  const origin = (store.get('origin') ?? '').toLowerCase();
  const fetchSite = (store.get('sec-fetch-site') ?? '').toLowerCase();
  const host = (store.get('x-forwarded-host') ?? store.get('host') ?? '').toLowerCase();

  // A request is cross-site when the browser says so, or when the Origin header
  // names a different host than the one serving the application.
  let crossSite = fetchSite === 'cross-site';
  if (!crossSite && origin) {
    try {
      crossSite = new URL(origin).host.toLowerCase() !== host;
    } catch {
      crossSite = false;
    }
  }

  const https = forwardedProto === 'https';
  const secureOverride = parseBoolean(process.env.FICAP_COOKIE_SECURE);
  const secure = secureOverride ?? https;

  const sameSiteOverride = (process.env.FICAP_COOKIE_SAMESITE ?? '').trim().toLowerCase();
  let sameSite: SameSitePolicy;
  if (sameSiteOverride === 'none' || sameSiteOverride === 'strict' || sameSiteOverride === 'lax') {
    sameSite = sameSiteOverride as SameSitePolicy;
  } else {
    // Only widen automatically for a genuinely cross-site request over HTTPS.
    sameSite = crossSite && secure ? 'none' : 'lax';
  }

  // Browsers reject SameSite=None without Secure, so fall back rather than
  // emit a cookie that will be dropped.
  if (sameSite === 'none' && !secure) sameSite = 'lax';

  return { secure, sameSite, partitioned: sameSite === 'none' };
}

/** Session cookie (httpOnly) plus a readable CSRF token for double-submit forms. */
export async function setSessionCookies(token: string, csrf: string): Promise<void> {
  const store = await cookies();
  const policy = await cookiePolicy();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: policy.sameSite,
    secure: policy.secure,
    partitioned: policy.partitioned,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  store.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    sameSite: policy.sameSite,
    secure: policy.secure,
    partitioned: policy.partitioned,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

/** Short lived cookie holding the MFA-pending session token. */
export async function setPendingCookie(token: string): Promise<void> {
  const store = await cookies();
  const policy = await cookiePolicy();
  store.set(PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: policy.sameSite,
    secure: policy.secure,
    partitioned: policy.partitioned,
    path: '/',
    maxAge: PENDING_MAX_AGE,
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
