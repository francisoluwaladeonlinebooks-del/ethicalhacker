import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@/lib/db/context';

export const dynamic = 'force-dynamic';

/**
 * Post-verification checkpoint.
 *
 * Reached only after the authenticator code has been accepted. The session
 * cookie was just issued, so if a session is present the sign-in worked and the
 * user continues into the platform. If it is not present the browser refused to
 * store the cookie - the usual cause is third-party cookie blocking inside an
 * embedded view - and saying so plainly is far more useful than a silent bounce
 * back to the sign-in page.
 */
export default async function LoginCompletePage() {
  const ctx = await getRequestContext({ required: false }).catch(() => null);
  if (ctx) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ficap-bg)] px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-navy-950 text-2xs font-bold text-white">CB</div>
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-[var(--ficap-muted)]">Central Bank of Nigeria</p>
            <p className="text-xs font-semibold text-navy-900">FICAP supervisory access</p>
          </div>
        </div>

        <div className="card p-6">
          <h1 className="text-lg font-semibold tracking-tight text-navy-900">Your code was accepted, but the session was not kept</h1>
          <p className="mt-2 text-xs leading-relaxed text-[var(--ficap-muted)]">
            The authenticator code verified correctly. The platform then issued a session cookie and this browser did not store it, so the
            next request arrived without a session. Nothing is wrong with your account or your code.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[var(--ficap-muted)]">
            This happens when a page is shown inside an embedded frame that blocks third-party cookies. Open FICAP in its own browser tab and
            sign in again — the flow is identical.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/" className="btn btn-primary text-sm">
              Open in this tab and retry
            </Link>
            <Link href="/login" className="btn btn-secondary text-sm">
              Back to sign in
            </Link>
          </div>

          <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-2xs leading-relaxed text-slate-600">
            <p className="font-semibold text-navy-800">Why this is a browser setting, not a platform fault</p>
            <p className="mt-1">
              FICAP keeps sessions in an <span className="font-mono">HttpOnly</span>, <span className="font-mono">Secure</span> cookie and never
              carries a session token in a URL. Safari and browsers with strict tracking protection refuse those cookies in a cross-site frame.
              Opening the platform directly gives it a first-party context, where the cookie is always accepted.
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-2xs text-[var(--ficap-muted)]">
          No session was created for this attempt. The event is recorded in the audit trail.
        </p>
      </div>
    </main>
  );
}
