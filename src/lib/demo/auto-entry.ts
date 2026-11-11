/**
 * Demonstration auto-entry.
 *
 * The platform is a supervisory system whose entire case rests on authentication:
 * password, authenticator, short-lived session, server-side authorisation on every
 * route. Deleting that would leave a "supervisory platform" that any visitor can
 * read, and would break the security properties the product exists to demonstrate.
 *
 * What a demonstration build actually needs is different: no friction between the
 * browser and the dashboards. So auto-entry creates a real session — the same
 * session the sign-in path would create, with the same cookies, expiry and audit
 * record — without asking for the credentials. Three properties keep that honest:
 *
 *  1. It exists only in demonstration mode. `FICAP_MODE=live` turns it off in the
 *     middleware, in the route handler and in the domain function that mints the
 *     session, independently of one another.
 *  2. It can only assume an account flagged `is_demo`, reusing the same gate as the
 *     persona shortcut. A real officer's account cannot be entered this way.
 *  3. It is stated in the interface. The header carries an "auto-entry" badge so a
 *     viewer never mistakes the demonstration for an authenticated session.
 *
 * Set `FICAP_DEMO_AUTO_ENTER=0` to require the sign-in screen in demonstration mode.
 */

/** Roles an auto-entry link may name, mapped to the seeded account role. */
export const DEMO_PERSONA_ALIASES: Record<string, string> = {
  assessor: 'cbn_assessor',
  cbn_assessor: 'cbn_assessor',
  reviewer: 'supervisory_reviewer',
  supervisory_reviewer: 'supervisory_reviewer',
  approver: 'report_approver',
  report_approver: 'report_approver',
  contact: 'institution_contact',
  institution_contact: 'institution_contact',
  admin: 'platform_admin',
  platform_admin: 'platform_admin',
};

/** The persona a bare visit to `/` lands on: the assessor workspace. */
export const DEFAULT_DEMO_PERSONA = 'cbn_assessor';

/**
 * Paths that must never be auto-entered. `/login` stays reachable so the real
 * sign-in flow can still be inspected; `/demo` prevents a redirect loop; `/api`
 * would turn a browser navigation into an unexpected side effect.
 */
const EXCLUDED = [/^\/login(\/|$)/, /^\/demo(\/|$)/, /^\/api(\/|$)/, /^\/_next(\/|$)/];

export function isExcludedPath(pathname: string): boolean {
  return EXCLUDED.some((pattern) => pattern.test(pathname));
}

/**
 * Demonstration mode, using exactly the predicate the domain layer uses
 * (`demoMode()` in `domain/auth`): only an explicit `demo`, or an unset value,
 * counts. A deployment set to `production` or `staging` is therefore *not*
 * demonstration mode, and both the middleware and `directLoginAsPersona` agree.
 * A looser "anything but live" reading would let the middleware redirect into an
 * entry the domain function then refuses.
 */
export function demoModeFromEnv(mode: string | undefined = process.env.FICAP_MODE): boolean {
  return (mode ?? 'demo').toLowerCase() === 'demo';
}

export function demoAutoEntryEnabled(
  mode: string | undefined = process.env.FICAP_MODE,
  flag: string | undefined = process.env.FICAP_DEMO_AUTO_ENTER,
): boolean {
  if (!demoModeFromEnv(mode)) return false;
  const value = (flag ?? '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

/**
 * Validate a post-entry destination.
 *
 * This is an open-redirect guard: the value arrives from the query string, so it
 * is attacker-controllable. Only a same-origin absolute path is accepted. `//host`
 * and `/\host` are rejected because browsers normalise both into a scheme-relative
 * URL, which would send the visitor off-site immediately after a sign-in.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/';
  const pathOnly = raw.split('?')[0].split('#')[0];
  if (isExcludedPath(pathOnly)) return '/';
  return raw;
}

export function personaForAlias(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_DEMO_PERSONA;
  return DEMO_PERSONA_ALIASES[raw.trim().toLowerCase()] ?? DEFAULT_DEMO_PERSONA;
}

/**
 * Decide whether a request should be redirected into auto-entry.
 *
 * Takes its inputs explicitly rather than reading the request, so the decision can
 * be unit tested without a server: this is the gate that stands between an
 * anonymous visitor and a supervisory dashboard.
 */
export function shouldAutoEnter(input: {
  pathname: string;
  search: string;
  hasSessionCookie: boolean;
  enabled: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.hasSessionCookie) return false;
  if (isExcludedPath(input.pathname)) return false;
  // Loop guard: if we have already entered once and the cookie still did not
  // arrive, the browser is refusing cookies. Stop, and let the page show the
  // sign-in screen instead of redirecting forever.
  if (new URLSearchParams(input.search || '').has('demo_enter')) return false;
  return true;
}

/**
 * The origin the *browser* used, not the address the server is bound to.
 *
 * A `NextResponse.redirect` needs an absolute URL, and `new URL(request.url)` is
 * not reliable for that: behind a proxy, and even in some `next start` setups, it
 * reflects the internal bind address (`0.0.0.0:3000`). Redirecting a visitor from
 * `127.0.0.1` to `0.0.0.0` is a different host as far as the browser is concerned,
 * so the session cookie just set is not sent and the visitor bounces to the
 * sign-in screen. The forwarded headers, then the Host header, describe the
 * address the browser actually used.
 */
export function requestOrigin(
  headers: { get(name: string): string | null },
  fallback = 'http://localhost:3000',
): string {
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || headers.get('host')?.split(',')[0]?.trim();
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (!host) return fallback;
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('0.0.0.0');
  const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : isLocal ? 'http' : 'https';
  return `${proto}://${host}`;
}

/** Destination for the middleware redirect, preserving the deep link. */
export function autoEntryUrl(pathname: string, search: string): string {
  const target = `${pathname}${search || ''}`;
  return `/demo/enter?next=${encodeURIComponent(target)}`;
}
