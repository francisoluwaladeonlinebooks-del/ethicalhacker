import { redirect } from 'next/navigation';
import { readPendingCookie } from '@/lib/auth/session-cookies';
import { demoMfaCodeForEmail, demoMode } from '@/lib/domain/auth';
import { withSystem } from '@/lib/db/pool';
import { MfaForm } from './mfa-form';

export const dynamic = 'force-dynamic';

export default async function MfaPage() {
  const token = await readPendingCookie();
  if (!token) redirect('/login?error=Your+sign-in+session+expired.+Enter+your+credentials+again.');

  const session = await withSystem(async (tx) =>
    tx.queryOne<{ email: string; name: string; role: string; expires_at: string; mfa_verified: boolean }>(
      `SELECT u.email, u.name, u.role, s.expires_at, s.mfa_verified
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [await hashToken(token)],
    ),
  ).catch(() => null);

  if (!session || session.mfa_verified) redirect('/login');

  const demoCode = demoMode() ? await demoMfaCodeForEmail(session.email) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ficap-bg)] px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-navy-950 text-2xs font-bold text-white">CB</div>
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-[var(--ficap-muted)]">Central Bank of Nigeria</p>
            <p className="text-xs font-semibold text-navy-900">FICAP supervisory access</p>
          </div>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold tracking-tight text-navy-900">Multi-factor verification</h1>
          <p className="mt-1 text-xs leading-relaxed text-[var(--ficap-muted)]">
            Signing in as <span className="font-semibold text-navy-800">{session.name}</span> ({session.email}). Enter the current
            six-digit code from your authenticator application. This step expires at{' '}
            {new Date(session.expires_at).toISOString().slice(11, 16)} UTC.
          </p>
          <div className="mt-5">
            <MfaForm demoCode={demoCode} />
          </div>
        </div>
        <p className="mt-4 text-center text-2xs text-[var(--ficap-muted)]">
          Five failed verifications lock the account temporarily. Recovery codes can be used once each.
        </p>
      </div>
    </main>
  );
}

async function hashToken(token: string): Promise<string> {
  const { sessionTokenHash } = await import('@/lib/domain/auth');
  return sessionTokenHash(token);
}
