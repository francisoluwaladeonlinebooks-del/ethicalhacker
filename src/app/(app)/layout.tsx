import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@/lib/db/context';
import { can } from '@/lib/rbac';
import { withScope } from '@/lib/db/pool';
import { SideNav, type NavGroup } from '@/components/nav';
import { CSRF_COOKIE } from '@/lib/db/context';
import { cookies } from 'next/headers';
import { logoutAction } from '@/app/actions/auth';
import { TopNavPersonaSwitcher, SidebarPersonaSwitcher } from '@/components/persona-switcher';
import { demoAutoEntryEnabled } from '@/lib/demo/auto-entry';

export const dynamic = 'force-dynamic';

/**
 * The home route renders a different workspace per role (see
 * `src/app/(app)/page.tsx`), so the navigation names it accordingly instead of
 * calling every one of them "Overview".
 */
const HOME_LABELS: Record<string, string> = {
  cbn_assessor: 'Assessor workspace',
  supervisory_reviewer: 'Supervisory review',
  report_approver: 'Approval queue',
  institution_contact: 'My institution',
  platform_admin: 'Platform operations',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext({ required: false });
  if (!ctx) redirect('/login');

  // Navigation badges are only computed for the material the role may open. A
  // count is a disclosure in its own right, so a role without `finding:read`
  // never has one calculated for it - the figure stays at zero rather than
  // being fetched and then hidden in the markup.
  const showFindings = can(ctx.user, 'finding:read');
  const showJobs = can(ctx.user, 'job:read');
  const showReports = can(ctx.user, 'report:read');

  const counters =
    showFindings || showJobs || showReports
      ? await withScope(ctx.scope, async (tx) => {
          const row = await tx.queryOne<{ open_findings: string; queued_jobs: string; unapproved_reports: string }>(
            `SELECT
              ${showFindings ? `(SELECT count(*)::text FROM findings WHERE data_mode = $1 AND status IN ('new','needs_verification','confirmed','reopened','remediation_in_progress','ready_for_retest'))` : `'0'::text`} AS open_findings,
              ${showJobs ? `(SELECT count(*)::text FROM assessment_jobs WHERE institution_id IN (SELECT id FROM institutions WHERE data_mode = $1) AND status IN ('queued','running'))` : `'0'::text`} AS queued_jobs,
              ${showReports ? `(SELECT count(*)::text FROM reports WHERE data_mode = $1 AND status IN ('draft','in_review','changes_requested'))` : `'0'::text`} AS unapproved_reports`,
            [ctx.mode],
          );
          return {
            openFindings: Number(row?.open_findings ?? 0),
            queuedJobs: Number(row?.queued_jobs ?? 0),
            unapprovedReports: Number(row?.unapproved_reports ?? 0),
          };
        }).catch(() => ({ openFindings: 0, queuedJobs: 0, unapprovedReports: 0 }))
      : { openFindings: 0, queuedJobs: 0, unapprovedReports: 0 };

  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';
  // Shown so a viewer never mistakes a demonstration session for a
  // credentialled sign-in. See src/lib/demo/auto-entry.ts.
  const autoEntry = demoAutoEntryEnabled();

  const groups: NavGroup[] = [
    {
      title: 'Workspace',
      items: [
        { href: '/', label: HOME_LABELS[ctx.user.role] ?? 'Overview' },
        { href: '/ai-analyst', label: 'AI Security Analyst (LLM)' },
        ...(can(ctx.user, 'institution:portfolio') ? [{ href: '/analytics', label: 'Supervisory analytics' }] : []),
      ],
    },
    {
      title: 'Institutions and assets',
      items: [
        ...(can(ctx.user, 'institution:read') ? [{ href: '/registry', label: 'National registry' }] : []),
        ...(can(ctx.user, 'institution:read') ? [{ href: '/registry/assets', label: 'Digital asset inventory' }] : []),
        ...(can(ctx.user, 'institution:read') ? [{ href: '/institutions', label: 'Institution records' }] : []),
        ...(can(ctx.user, 'application:read') ? [{ href: '/applications', label: 'Application inventory' }] : []),
      ],
    },
    {
      title: 'Assessments',
      items: [
        ...(can(ctx.user, 'engagement:read') ? [{ href: '/engagements', label: 'Engagements' }] : []),
        ...(can(ctx.user, 'engagement:create') ? [{ href: '/engagements/new', label: 'New engagement' }] : []),
        ...(can(ctx.user, 'engagement:read') ? [{ href: '/plans', label: 'Assessment plans' }] : []),
        ...(can(ctx.user, 'engagement:read') ? [{ href: '/assessments', label: 'Assessment modules' }] : []),
        ...(can(ctx.user, 'job:read') ? [{ href: '/jobs', label: 'Execution monitor', badge: counters.queuedJobs ? String(counters.queuedJobs) : undefined }] : []),
        ...(can(ctx.user, 'framework:read') ? [{ href: '/frameworks', label: 'Coverage matrix' }] : []),
      ],
    },
    {
      title: 'Findings and risk',
      items: [
        ...(can(ctx.user, 'finding:read') ? [{ href: '/findings', label: 'Findings explorer', badge: counters.openFindings ? String(counters.openFindings) : undefined }] : []),
        ...(can(ctx.user, 'finding:update') ? [{ href: '/risk', label: 'Risk intelligence' }] : []),
        ...(can(ctx.user, 'remediation:read') ? [{ href: '/remediation', label: 'Remediation' }] : []),
        ...(can(ctx.user, 'retest:request') || can(ctx.user, 'retest:verify') ? [{ href: '/retesting', label: 'Retesting' }] : []),
        ...(can(ctx.user, 'evidence:read') ? [{ href: '/evidence', label: 'Evidence register' }] : []),
      ],
    },
    {
      title: 'Reporting',
      items: [
        ...(can(ctx.user, 'report:read') ? [{ href: '/reports', label: 'Reports', badge: counters.unapprovedReports ? String(counters.unapprovedReports) : undefined }] : []),
      ],
    },
    {
      title: 'Frameworks and governance',
      items: [
        ...(can(ctx.user, 'framework:read') ? [{ href: '/frameworks', label: 'Framework reference' }] : []),
        ...(can(ctx.user, 'institution:read') ? [{ href: '/nist', label: 'NIST CSF profiles' }] : []),
        ...(can(ctx.user, 'audit:read') ? [{ href: '/audit', label: 'Audit and compliance' }] : []),
      ],
    },
    {
      title: 'Administration',
      items: [
        ...(can(ctx.user, 'user:manage') ? [{ href: '/admin/users', label: 'Users and roles' }] : []),
        ...(can(ctx.user, 'settings:manage') ? [{ href: '/admin/settings', label: 'Platform configuration' }] : []),
        ...(can(ctx.user, 'engine:manage') ? [{ href: '/admin/engines', label: 'Engine health' }] : []),
        ...(can(ctx.user, 'framework:manage') ? [{ href: '/admin/frameworks', label: 'Catalogue management' }] : []),
        ...(can(ctx.user, 'settings:manage') || can(ctx.user, 'audit:read') ? [{ href: '/admin/verification', label: 'Verification status' }] : []),
      ],
    },
  ];

  return (
    <div className="flex min-h-screen bg-[var(--ficap-bg)]">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* ------------------------------------------------------------- sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col overflow-y-auto bg-[var(--ficap-field)] px-3 py-5 text-white lg:flex">
        <Link href="/" className="mb-2 flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-sm border border-white/20 font-display text-[11px] font-semibold tracking-tight text-warm-200">
            CB
          </span>
          <span className="min-w-0">
            <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-navy-300">Central Bank of Nigeria</span>
            <span className="mt-0.5 block font-display text-base font-medium leading-none tracking-tight text-white">FICAP</span>
          </span>
        </Link>
        <div className="mx-2 mb-1 mt-4 h-px bg-white/10" />
        <SideNav groups={groups} />
        <div className="mt-auto pt-6">
          <div className="rounded-sm border border-white/10 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold uppercase text-white">
                {ctx.user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-2xs font-semibold text-white">{ctx.user.name}</p>
                <p className="truncate text-[10px] capitalize text-navy-300">{ctx.user.role.replace(/_/g, ' ')}</p>
              </div>
            </div>
            <SidebarPersonaSwitcher currentRole={ctx.user.role} demo={ctx.mode === 'demo'} />
            <form action={logoutAction} className="mt-3">
              <button
                type="submit"
                className="w-full rounded-pill border border-white/15 px-2 py-1.5 text-2xs font-medium text-navy-100 transition-colors hover:bg-white/10"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* --------------------------------------------------------------- frame */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-[var(--ficap-border)] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              {/* Small screens get the same navigation, without JavaScript. */}
              <details className="relative lg:hidden">
                <summary className="btn btn-secondary btn-xs cursor-pointer list-none">Menu</summary>
                <div className="absolute left-0 top-9 z-30 max-h-[70vh] w-64 overflow-y-auto rounded-sm bg-[var(--ficap-field)] px-3 py-3 shadow-float">
                  <SideNav groups={groups} />
                </div>
              </details>

              <span
                className={`badge ${ctx.mode === 'demo' ? 'badge-amber' : 'badge-green'}`}
                title={
                  ctx.mode === 'demo'
                    ? 'Synthetic records only. No live institution data or system is contacted.'
                    : 'Live supervisory data.'
                }
              >
                <span aria-hidden="true" className="text-[0.5rem] leading-none">●</span>
                {ctx.mode === 'demo' ? 'Demonstration data' : 'Live data'}
              </span>

              {autoEntry ? (
                <span
                  className="hidden items-center gap-1.5 rounded-pill border border-dashed border-[var(--ficap-border-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ficap-ink-faint)] sm:inline-flex"
                  title="This demonstration build creates a session automatically. No password or authenticator code was entered. Set FICAP_MODE=live to require both."
                >
                  <span aria-hidden="true">◇</span> Auto-entry
                </span>
              ) : null}

              <span className="hidden items-center gap-2 text-2xs text-[var(--ficap-ink-faint)] sm:flex">
                <span aria-hidden="true">·</span> Assessment window enforced
                <span aria-hidden="true">·</span> Evidence encrypted
                <span aria-hidden="true">·</span> Audit append-only
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <TopNavPersonaSwitcher currentRole={ctx.user.role} demo={ctx.mode === 'demo'} />
              <span className="hidden border-l border-[var(--ficap-border)] pl-3 font-mono text-[10px] text-[var(--ficap-ink-faint)] md:inline">
                {ctx.user.email}
              </span>
              <Link href="/" className="btn btn-secondary btn-xs">Overview</Link>
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>

        <footer className="no-print border-t border-[var(--ficap-border)] bg-[var(--ficap-surface)] px-4 py-4 text-[10px] leading-relaxed text-[var(--ficap-ink-faint)] lg:px-8">
          <p className="max-w-prose">
            FICAP — Financial Institution Cybersecurity Assurance Platform. Access is restricted to authorised users; every action is
            recorded in a hash-chained audit trail. Findings reflect the configuration observed within the approved testing window, and
            checks that did not run are reported as not assessed.
          </p>
        </footer>

        {/* CSRF double-submit value for client-side fetches; matches the httpOnly session. */}
        <meta name="ficap-csrf" content={csrf} />
      </div>
    </div>
  );
}
