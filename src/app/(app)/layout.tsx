import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@/lib/db/context';
import { can } from '@/lib/rbac';
import { withScope } from '@/lib/db/pool';
import { SideNav, type NavGroup } from '@/components/nav';
import { CSRF_COOKIE } from '@/lib/db/context';
import { cookies } from 'next/headers';
import { logoutAction } from '@/app/actions/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext({ required: false });
  if (!ctx) redirect('/login');

  const counters = await withScope(ctx.scope, async (tx) => {
    const row = await tx.queryOne<{ open_findings: string; queued_jobs: string; unapproved_reports: string }>(
      `SELECT
        (SELECT count(*)::text FROM findings WHERE data_mode = $1 AND status IN ('new','needs_verification','confirmed','reopened','remediation_in_progress','ready_for_retest')) AS open_findings,
        (SELECT count(*)::text FROM assessment_jobs WHERE institution_id IN (SELECT id FROM institutions WHERE data_mode = $1) AND status IN ('queued','running')) AS queued_jobs,
        (SELECT count(*)::text FROM reports WHERE data_mode = $1 AND status IN ('draft','in_review','changes_requested')) AS unapproved_reports`,
      [ctx.mode],
    );
    return {
      openFindings: Number(row?.open_findings ?? 0),
      queuedJobs: Number(row?.queued_jobs ?? 0),
      unapprovedReports: Number(row?.unapproved_reports ?? 0),
    };
  }).catch(() => ({ openFindings: 0, queuedJobs: 0, unapprovedReports: 0 }));

  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';

  const groups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { href: '/', label: 'Overview' },
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
    <div className="flex min-h-screen">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-navy-950 px-3 py-4 text-white lg:flex">
        <Link href="/" className="mb-2 flex items-center gap-2 px-1.5">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-white/10 text-2xs font-bold">CB</span>
          <span>
            <span className="block text-2xs font-semibold uppercase tracking-[0.14em] text-navy-300">Central Bank of Nigeria</span>
            <span className="block text-xs font-semibold tracking-tight">FICAP</span>
          </span>
        </Link>
        <SideNav groups={groups} />
        <div className="mt-auto pt-6">
          <div className="rounded-md border border-white/10 bg-white/5 p-2.5">
            <p className="truncate text-2xs font-semibold text-white">{ctx.user.name}</p>
            <p className="mt-0.5 truncate text-[10px] text-navy-200">{ctx.user.role.replace(/_/g, ' ')}</p>
            <form action={logoutAction} className="mt-2">
              <button type="submit" className="w-full rounded border border-white/15 px-2 py-1 text-2xs font-medium text-navy-100 hover:bg-white/10">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--ficap-border)] bg-white px-4 py-2.5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="lg:hidden text-xs font-semibold tracking-tight text-navy-900">FICAP</span>
            <span
              className={`badge ${ctx.mode === 'demo' ? 'badge-amber' : 'badge-green'}`}
              title={ctx.mode === 'demo' ? 'Synthetic records only. No live institution data or system is contacted.' : 'Live supervisory data.'}
            >
              {ctx.mode === 'demo' ? 'Demonstration data' : 'Live mode'}
            </span>
            <span className="hidden text-2xs text-[var(--ficap-muted)] sm:inline">
              Assessment window enforced · evidence encrypted · audit append-only
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-2xs text-[var(--ficap-muted)] md:inline">
              {ctx.user.email} · session expires {new Date(ctx.session.expires_at).toISOString().slice(11, 16)}Z
            </span>
            <Link href="/" className="btn btn-secondary btn-xs">Overview</Link>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-4 lg:px-6 lg:py-5">{children}</main>
        <footer className="no-print border-t border-[var(--ficap-border)] px-4 py-3 text-[10px] leading-relaxed text-[var(--ficap-muted)] lg:px-6">
          FICAP — Financial Institution Cybersecurity Assurance Platform. Access is restricted to authorised users; every action is
          recorded in a hash-chained audit trail. Findings reflect the configuration observed within the approved testing window and
          checks that did not run are reported as not assessed.
        </footer>
        {/* CSRF double-submit value for client-side fetches; matches the httpOnly session. */}
        <meta name="ficap-csrf" content={csrf} />
      </div>
    </div>
  );
}
