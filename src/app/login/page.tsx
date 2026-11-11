import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@/lib/db/context';
import { demoMode } from '@/lib/domain/auth';
import { withSystem } from '@/lib/db/pool';
import { DEMO_PASSWORD } from '@/lib/demo/seed';
import { LoginForm } from './login-form';
import { Flash, SectionMarker, StatRail } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Sign-in.
 *
 * The left field carries the institutional case for the platform; the right
 * panel carries the only thing a user came to do. The display serif and the
 * numbered markers come from design.md §4 and §6.1; the figures in the rail are
 * structural facts about the platform, not seeded demo counts, so they cannot
 * drift out of date or imply a measurement that did not happen.
 */
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
    <main className="min-h-screen lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* ---------------------------------------------------------------- field */}
      <section className="field-grid relative flex flex-col justify-between bg-[var(--ficap-field)] px-6 py-8 text-white sm:px-10 lg:px-16 lg:py-12">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-sm border border-white/15 font-display text-sm font-semibold tracking-tight text-warm-200">
              CB
            </span>
            <div className="leading-tight">
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.22em] text-navy-300">Central Bank of Nigeria</p>
              <p className="mt-1 text-sm font-semibold tracking-tight text-white">FICAP</p>
            </div>
          </div>

          <SectionMarker index={1} label="Supervisory assurance" onField className="mt-14 lg:mt-20" />

          <h1 className="display-xl mt-6 max-w-[19ch] text-white">
            Every finding
            <br />
            <span className="display-italic text-warm-200">has a second reader.</span>
          </h1>

          <p className="mt-6 max-w-[46ch] text-sm leading-relaxed text-navy-200">
            Authorised, scope-bound assessment of internet and mobile banking, open banking interfaces, onboarding, payments and
            administrative channels — tested against OWASP WSTG, the API Security Top 10, MASVS/MASTG and the NIST Cybersecurity
            Framework 2.0.
          </p>

          <ul className="mt-10 max-w-xl divide-y divide-white/10 border-y border-white/10">
            {[
              ['Scope is enforced, not assumed', 'Every request is checked against the approved engagement scope, exclusions and testing window before it is issued.'],
              ['Evidence is confidential by default', 'Redacted on capture, encrypted at rest, hash-verified on read, and released only through short-lived links.'],
              ['Nothing passes twice by accident', 'Findings need an independent verifier; reports need an independent approver. Both are recorded.'],
              ['The audit trail cannot be edited', 'Actions are appended to a hash-chained log. A gap in the chain is itself a finding.'],
            ].map(([title, body]) => (
              <li key={title} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,15rem)_1fr] sm:gap-6">
                <p className="text-xs font-semibold text-white">{title}</p>
                <p className="text-2xs leading-relaxed text-navy-300">{body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-12">
          <StatRail
            items={[
              { value: '05', label: 'Supervisory roles', note: 'each with its own workspace' },
              { value: '02', label: 'Factors at sign-in', note: 'password, then authenticator' },
              { value: 'AA', label: 'Accessibility target', note: 'WCAG 2.2, colour-independent' },
              { value: '01', label: 'Approver per report', note: 'independent of the author' },
            ]}
          />
          <p className="mt-5 max-w-2xl text-[0.625rem] leading-relaxed text-navy-400">
            Restricted system. Unauthorised access is an offence. Session activity, source address and user agent are recorded in a
            tamper-evident audit trail. FICAP reports what it observed within an approved testing window; a check that did not run is
            reported as not assessed, never as passed.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- panel */}
      <section className="flex items-start justify-center bg-[var(--ficap-surface)] px-6 py-10 sm:px-10 lg:items-center lg:py-12">
        <div className="w-full max-w-[26rem]">
          <SectionMarker index={2} label="Authentication" />
          <h2 className="display-md mt-4 text-navy-900">
            Supervisory <span className="display-italic text-seal-700">access</span>
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-[var(--ficap-ink-muted)]">
            Two steps are required: your password, then a time-based one-time code from your enrolled authenticator.
          </p>

          <div className="mt-6">
            <Flash notice={notice} error={error} />
          </div>

          <LoginForm demoAccounts={accounts} demoPassword={DEMO_PASSWORD} demo={isDemo} />

          <div className="mt-8 border-t border-[var(--ficap-border)] pt-4">
            <p className="text-2xs leading-relaxed text-[var(--ficap-ink-muted)]">
              Access is limited to named officers of the Central Bank of Nigeria and to nominated institution contacts, each holding
              one role. Trouble signing in? Contact the platform super administrator. <Link href="/login" className="link">Retry</Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
