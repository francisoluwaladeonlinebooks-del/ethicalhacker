import Link from 'next/link';
import type { RequestContext } from '@/lib/db/context';
import { withScope, type Tx } from '@/lib/db/pool';
import { can } from '@/lib/rbac';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';

/**
 * Role-tailored "what needs my attention" panel.
 *
 * The panel is presentation only. Every action it links to re-checks permission
 * and scope server side, so a role that cannot perform an action is never able
 * to reach it by following a link — hiding it here is purely cosmetic.
 */

type Item = { label: string; count: number; href: string; hint: string };

async function loadItems(tx: Tx, ctx: RequestContext): Promise<{ heading: string; description: string; items: Item[] } | null> {
  const role = ctx.user.role;

  if (role === 'institution_contact') {
    const row = await tx.queryOne<any>(
      `SELECT
         (SELECT count(*)::int FROM evidence WHERE data_mode = $1 AND share_with_institution) AS shared_evidence,
         (SELECT count(*)::int FROM findings WHERE data_mode = $1 AND status IN ('confirmed','remediation_in_progress')) AS open_findings,
         (SELECT count(*)::int FROM remediation_submissions rs JOIN findings f ON f.id = rs.finding_id
            WHERE rs.status IN ('needs_info')) AS action_required,
         (SELECT count(*)::int FROM retests r WHERE r.status IN ('requested','in_progress')) AS pending_retests`,
      [ctx.mode],
    );
    return {
      heading: 'Your institution’s position',
      description: 'Only records explicitly shared with your institution are visible here. Confidential supervisory evidence stays restricted.',
      items: [
        { label: 'Shared evidence', count: Number(row?.shared_evidence ?? 0), href: '/evidence', hint: 'Records released to your institution' },
        { label: 'Open confirmed findings', count: Number(row?.open_findings ?? 0), href: '/findings', hint: 'Confirmed and in remediation' },
        { label: 'Submissions needing information', count: Number(row?.action_required ?? 0), href: '/remediation', hint: 'The assessor asked for more detail' },
        { label: 'Retests pending', count: Number(row?.pending_retests ?? 0), href: '/retesting', hint: 'Awaiting scheduling or execution' },
      ],
    };
  }

  if (role === 'cbn_assessor') {
    const row = await tx.queryOne<any>(
      `SELECT
         (SELECT count(*)::int FROM engagements WHERE data_mode = $1 AND status IN ('draft','pending_authorization')) AS drafting,
         (SELECT count(*)::int FROM test_plans p JOIN engagements e ON e.id = p.engagement_id
            WHERE e.data_mode = $1 AND p.status = 'pending_approval') AS plans_to_approve,
         (SELECT count(*)::int FROM findings WHERE data_mode = $1 AND status = 'needs_verification') AS to_verify,
         (SELECT count(*)::int FROM retests WHERE status = 'completed' AND verified_at IS NULL) AS retests_to_verify,
         (SELECT count(*)::int FROM findings WHERE data_mode = $1 AND cvss_score IS NULL AND status <> 'false_positive') AS unscored`,
      [ctx.mode],
    ).catch(() => null);
    const counts = row ?? {};
    return {
      heading: 'Your assessment queue',
      description: 'Authorisation comes before any activity: an engagement cannot run until its scope, methods and window are approved.',
      items: [
        { label: 'Engagements awaiting authorisation', count: Number(counts.drafting ?? 0), href: '/engagements', hint: 'Draft or pending authorisation' },
        { label: 'Findings awaiting verification', count: Number(counts.to_verify ?? 0), href: '/findings?status=needs_verification', hint: 'Not yet confirmed as a real defect' },
        { label: 'Findings without a CVSS score', count: Number(counts.unscored ?? 0), href: '/findings', hint: 'Technical severity missing' },
        { label: 'Retests awaiting your verification', count: Number(counts.retests_to_verify ?? 0), href: '/retesting', hint: 'Independently verified closure' },
      ],
    };
  }

  if (role === 'supervisory_reviewer') {
    const row = await tx.queryOne<any>(
      `SELECT
         (SELECT count(*)::int FROM reports WHERE data_mode = $1 AND status = 'in_review') AS reports_in_review,
         (SELECT count(*)::int FROM remediation_plans p
            WHERE p.status IN ('open','in_progress') AND p.due_date IS NOT NULL AND p.due_date < current_date) AS overdue_plans,
         (SELECT count(*)::int FROM findings WHERE data_mode = $1 AND status = 'remediation_in_progress'
            AND due_date IS NOT NULL AND due_date < current_date) AS overdue_findings,
         (SELECT count(*)::int FROM institutions WHERE data_mode = $1
            AND (last_verified_at IS NULL OR last_verified_at < now() - (stale_after_days || ' days')::interval)) AS stale_registry`,
      [ctx.mode],
    );
    return {
      heading: 'Supervisory review queue',
      description: 'Reports, overdue remediation and registry records that need a supervisory decision.',
      items: [
        { label: 'Reports awaiting review', count: Number(row?.reports_in_review ?? 0), href: '/reports', hint: 'Submitted by an assessor' },
        { label: 'Overdue findings', count: Number(row?.overdue_findings ?? 0), href: '/remediation', hint: 'Past the agreed remediation date' },
        { label: 'Overdue remediation plans', count: Number(row?.overdue_plans ?? 0), href: '/remediation?view=plans', hint: 'Plan submitted past its due date' },
        { label: 'Registry records to re-verify', count: Number(row?.stale_registry ?? 0), href: '/registry?stale=1', hint: 'Verification window elapsed' },
      ],
    };
  }

  if (role === 'report_approver') {
    const row = await tx.queryOne<any>(
      `SELECT (SELECT count(*)::int FROM reports WHERE data_mode = $1 AND status = 'in_review') AS in_review`,
      [ctx.mode],
    );
    return {
      heading: 'Independent approval queue',
      description: 'Approval requires a substantive comment and is refused to the author of the report.',
      items: [
        { label: 'Reports awaiting independent approval', count: Number(row?.in_review ?? 0), href: '/reports', hint: 'Authored by someone else' },
      ],
    };
  }

  if (role === 'platform_admin') {
    const row = await tx.queryOne<any>(
      `SELECT
         (SELECT count(*)::int FROM users WHERE status = 'active') AS active_users,
         (SELECT count(*)::int FROM engines WHERE status <> 'enabled') AS degraded_engines,
         (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS live_sessions,
         (SELECT count(*)::int FROM audit_events WHERE at > now() - interval '24 hours') AS recent_events`,
    );
    return {
      heading: 'Platform operations',
      description: 'Administration cannot be used to read findings or evidence: those require a separate, time-boxed access grant.',
      items: [
        { label: 'Active accounts', count: Number(row?.active_users ?? 0), href: '/admin/users', hint: 'Users permitted to sign in' },
        { label: 'Engines not enabled', count: Number(row?.degraded_engines ?? 0), href: '/admin/engines', hint: 'Health signals to review' },
        { label: 'Live sessions', count: Number(row?.live_sessions ?? 0), href: '/admin/users', hint: 'Server-side session records' },
        { label: 'Audit events (24h)', count: Number(row?.recent_events ?? 0), href: '/audit', hint: 'Append-only trail' },
      ],
    };
  }

  return null;
}

export async function RoleBrief({ ctx }: { ctx: RequestContext }) {
  // The brief owns its transaction: a failure in one counter must never take
  // down the rest of the overview, and it must never leak a half-open scope.
  const brief = await withScope(ctx.scope, (tx) => loadItems(tx, ctx)).catch(() => null);
  if (!brief) return null;
  const actionable = brief.items.filter((item) => item.count > 0);
  const linked = brief.items.filter((item) => can(ctx.user, 'institution:read') || item.href === '/evidence');

  return (
    <Card>
      <CardHeader
        title={brief.heading}
        subtitle={brief.description}
        actions={<Badge tone={actionable.length ? 'amber' : 'green'}>{actionable.length ? `${actionable.length} item(s) need attention` : 'Nothing outstanding'}</Badge>}
      />
      <CardBody>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {(linked.length ? linked : brief.items).map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className={`block rounded-md border px-3 py-2 transition-colors hover:bg-slate-50 ${item.count ? 'border-[var(--ficap-border)]' : 'border-dashed border-[var(--ficap-border)]'}`}
              >
                <p className="text-2xs font-semibold uppercase tracking-wider text-[var(--ficap-muted)]">{item.label}</p>
                <p className={`mt-0.5 text-lg font-semibold leading-none ${item.count ? 'text-navy-900' : 'text-[var(--ficap-muted)]'}`}>{item.count}</p>
                <p className="mt-1 text-[10px] leading-snug text-[var(--ficap-muted)]">{item.hint}</p>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
