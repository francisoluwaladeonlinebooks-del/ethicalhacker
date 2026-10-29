import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@/lib/db/context';
import { demoMode } from '@/lib/domain/auth';
import { withSystem } from '@/lib/db/pool';
import { DEMO_PASSWORD } from '@/lib/demo/seed';
import { LoginForm } from './login-form';
import { Flash } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const notice = typeof params.notice === 'string' ? params.notice : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;

  const existing = await getRequestContext({ required: false }).catch(() => null);
  if (existing) redirect('/');

  const isDemo = demoMode();
  const accounts = isDemo
    ? await withSystem(async (tx) =>
        tx.query<{ email: string; role: string; name: string }>(
          `SELECT email, role, name FROM users WHERE is_demo = true ORDER BY
             CASE role WHEN 'cbn_assessor' THEN 0 WHEN 'supervisory_reviewer' THEN 1 WHEN 'institution_contact' THEN 2
                       WHEN 'report_approver' THEN 3 ELSE 4 END`,
        ),
      ).catch(() => [])
    : [];

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative flex flex-col justify-between bg-navy-950 px-8 py-10 text-white lg:px-14">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-sm font-bold tracking-tight">CB</div>
            <div>
              <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-navy-200">Central Bank of Nigeria</p>
              <p className="text-sm font-semibold">Financial Institution Cybersecurity Assurance Platform</p>
            </div>
          </div>
          <h1 className="mt-12 max-w-xl text-3xl font-semibold leading-tight tracking-tight text-white">
            Authorised, scope-bound assessment of supervised institutions.
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-navy-200">
            FICAP supports assessment of internet and mobile banking, open banking APIs, onboarding, payments and administrative
            channels against OWASP WSTG, the OWASP API Security Top 10, OWASP MASVS/MASTG and the NIST Cybersecurity Framework 2.0.
          </p>
          <dl className="mt-10 grid max-w-lg grid-cols-2 gap-4 text-xs">
            {[
              ['Scope enforced before every request', 'Targets are validated against the approved engagement scope, exclusions and testing window.'],
              ['Evidence governance', 'Evidence is redacted, encrypted at rest and hash verified on every access.'],
              ['Independent verification', 'Findings require a second authorised verifier; reports require an independent approver.'],
              ['Immutable audit trail', 'Every action is appended to a hash-chained audit log that cannot be edited.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-md border border-white/10 bg-white/5 p-3">
                <dt className="text-2xs font-semibold uppercase tracking-wider text-navy-100">{title}</dt>
                <dd className="mt-1 text-2xs leading-relaxed text-navy-200">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-10 text-2xs leading-relaxed text-navy-300">
          Restricted system. Unauthorised access is an offence. Session activity, source address and user agent are recorded in the
          tamper-evident audit trail.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-[var(--ficap-muted)]">Sign in</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-navy-900">Supervisory access</h2>
            <p className="mt-1 text-xs text-[var(--ficap-muted)]">
              Two steps are required: your password followed by a time-based one-time code.
            </p>
          </div>

          <Flash notice={notice} error={error} />

          {isDemo ? (
            <div className="mb-4 rounded-md border border-seal-600/30 bg-seal-600/5 px-3 py-2 text-2xs leading-relaxed text-seal-700">
              <span className="font-semibold">Demonstration mode.</span> All records are synthetic and isolated from live assessment data.
              No external system is contacted.
            </div>
          ) : null}

          <LoginForm demoAccounts={accounts} demoPassword={DEMO_PASSWORD} />

          <p className="mt-6 text-center text-2xs text-[var(--ficap-muted)]">
            Trouble signing in? Contact the platform super administrator. <Link href="/login" className="link">Retry</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
