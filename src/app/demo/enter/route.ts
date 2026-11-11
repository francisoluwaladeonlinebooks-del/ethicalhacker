import { NextResponse } from 'next/server';
import {
  DEFAULT_DEMO_PERSONA,
  demoAutoEntryEnabled,
  demoModeFromEnv,
  personaForAlias,
  requestOrigin,
  safeNextPath,
} from '@/lib/demo/auto-entry';
import { directLoginAsPersona } from '@/lib/domain/auth';
import { setSessionCookies } from '@/lib/auth/session-cookies';

export const dynamic = 'force-dynamic';

/**
 * Demonstration auto-entry.
 *
 * Mints a real session for a demonstration account and redirects to the requested
 * page. It is not an alternative authorisation path: it calls the same domain
 * function as the sign-in screen, which independently enforces demonstration mode
 * and the `is_demo` flag, and the session it creates is an ordinary session with
 * an ordinary expiry and an audit record of type `auth.login` (stage
 * `direct_persona`) — so auto-entry is visibly distinct from a credentialled
 * sign-in in the audit trail.
 *
 * Any refusal goes to `/login` rather than to a broken page.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // The browser's origin, not the bind address: a redirect that changes host
  // would discard the cookie this response is about to set. See requestOrigin.
  const origin = requestOrigin(request.headers);

  if (!demoModeFromEnv() || !demoAutoEntryEnabled()) {
    return NextResponse.redirect(`${origin}/login`, { status: 303 });
  }

  const next = safeNextPath(url.searchParams.get('next'));
  const persona = personaForAlias(url.searchParams.get('as') ?? DEFAULT_DEMO_PERSONA);

  const outcome = await directLoginAsPersona(persona, {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  });

  if (outcome.status !== 'ok') {
    const target = new URL(`${origin}/login`);
    target.searchParams.set('error', outcome.reason);
    return NextResponse.redirect(target, { status: 303 });
  }

  await setSessionCookies(outcome.token, outcome.csrf);

  const destination = new URL(next, origin);
  // Marks that an entry was attempted, so the middleware can stop redirecting if
  // the browser refused the cookie instead of looping.
  destination.searchParams.set('demo_enter', '1');
  return NextResponse.redirect(destination, { status: 303 });
}
