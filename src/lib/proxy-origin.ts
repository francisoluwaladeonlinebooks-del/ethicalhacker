/**
 * Forwarded-host repair for deployments behind a proxy.
 *
 * Next.js aborts every Server Action whose `Origin` host does not equal the
 * `x-forwarded-host` it sees. A proxy that rewrites `Host` to an internal
 * address (`localhost:3000`) makes that comparison impossible to satisfy, so
 * every form submission — including the sign-in form — fails with
 * "Invalid Server Actions request" and no account can log in.
 *
 * The repair is narrow by design:
 *
 *  - it only applies to requests the browser itself labels `same-origin`;
 *    `Sec-Fetch-Site` is set by the browser and cannot be written by page
 *    script, so a hostile cross-origin page cannot obtain it;
 *  - it only *restores* the host the browser actually used, taken from the
 *    action's own `Origin` header, which the browser also sets;
 *  - it never relaxes the CSRF token check, which still runs on every action.
 *
 * The decision is a pure function so it can be tested without a server.
 */

export type ProxyRequestFacts = {
  /** `sec-fetch-site`, as sent by the browser. */
  fetchSite?: string | null;
  /** `origin`, as sent by the browser. */
  origin?: string | null;
  /** `x-forwarded-host`, if the proxy set one. */
  forwardedHost?: string | null;
  /** `host`, as received. */
  host?: string | null;
};

/** The host that should be presented to Next, or null when no repair is needed. */
export function forwardedHostRepair(facts: ProxyRequestFacts): string | null {
  if ((facts.fetchSite ?? '').trim().toLowerCase() !== 'same-origin') return null;

  const origin = (facts.origin ?? '').trim();
  if (!origin) return null;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
  if (!originHost) return null;

  const presented = ((facts.forwardedHost ?? '') || (facts.host ?? '')).trim().toLowerCase();
  if (presented === originHost) return null;

  return originHost;
}
