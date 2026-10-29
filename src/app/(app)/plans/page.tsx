import Link from 'next/link';
import { pageContext, query } from '@/lib/page-context';
import { Card, CardHeader, PageHeader, Badge, TableWrap, StatCard, EmptyState, DataQualityNote, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'navy' | 'slate' | 'red'> = {
  approved: 'green',
  pending_approval: 'amber',
  rejected: 'red',
  superseded: 'slate',
  draft: 'slate',
};

export default async function PlansPage() {
  const ctx = await pageContext('engagement:read');

  const { plans, summary } = await query(ctx, async (tx) => {
    const rows = await tx.query<any>(
      `SELECT p.id, p.version, p.status, p.modules, p.frameworks, p.impact_summary, p.limitations,
              p.created_at, p.approved_at, e.id AS engagement_id, e.code AS engagement_code, e.name AS engagement_name,
              e.status AS engagement_status, i.name AS institution_name,
              cu.name AS created_by_name, au.name AS approved_by_name,
              (SELECT count(*)::int FROM job_checks jc JOIN assessment_jobs j ON j.id = jc.job_id WHERE j.engagement_id = e.id) AS executed_checks
         FROM test_plans p
         JOIN engagements e ON e.id = p.engagement_id
         JOIN institutions i ON i.id = p.institution_id
         LEFT JOIN users cu ON cu.id = p.created_by
         LEFT JOIN users au ON au.id = p.approved_by
        ORDER BY CASE p.status WHEN 'pending_approval' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, p.created_at DESC
        LIMIT 100`,
    );
    const counts = await tx.queryOne<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'pending_approval')::int AS pending,
              count(*) FILTER (WHERE status = 'approved')::int AS approved,
              count(*) FILTER (WHERE status = 'rejected')::int AS rejected
         FROM test_plans`,
    );
    return { plans: rows, summary: counts ?? {} };
  });

  return (
    <>
      <PageHeader
        title="Assessment plans"
        description="Every engagement needs a plan that names the modules, frameworks and checks that will run, plus the limitations of the approach. A plan is approved before any execution."
        meta={<><Badge tone="navy">{Number(summary.total ?? 0)} plans</Badge>{Number(summary.pending ?? 0) ? <Badge tone="amber">{summary.pending} awaiting approval</Badge> : null}</>}
        actions={<Link href="/engagements" className="btn btn-secondary">Engagements</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Plans total" value={Number(summary.total ?? 0)} hint="All versions across engagements" tone="navy" />
        <StatCard label="Awaiting approval" value={Number(summary.pending ?? 0)} hint="Cannot be executed until approved" tone={Number(summary.pending ?? 0) ? 'amber' : 'slate'} />
        <StatCard label="Approved" value={Number(summary.approved ?? 0)} hint="Eligible for execution once the window opens" tone="green" />
        <StatCard label="Rejected" value={Number(summary.rejected ?? 0)} hint="Returned for revision with a reason" tone={Number(summary.rejected ?? 0) ? 'red' : 'slate'} />
      </div>

      <Card className="mt-4">
        <CardHeader title="Plan register" subtitle="A superseded plan stays in the register: the audit trail must show what was approved at the time of execution." />
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Engagement</th>
                <th>Institution</th>
                <th className="text-right">Ver.</th>
                <th>Status</th>
                <th>Modules</th>
                <th>Frameworks</th>
                <th className="text-right">Checks run</th>
                <th>Prepared</th>
                <th>Approved</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan: any) => (
                <tr key={plan.id}>
                  <td className="text-2xs">
                    <Link href={`/engagements/${plan.engagement_id}/plan`} className="link font-medium">{plan.engagement_name}</Link>
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--ficap-muted)]">{plan.engagement_code} · engagement {String(plan.engagement_status).replace(/_/g, ' ')}</div>
                  </td>
                  <td className="text-2xs">{plan.institution_name}</td>
                  <td className="text-right font-mono text-2xs">{plan.version}</td>
                  <td className="text-2xs"><Badge tone={STATUS_TONE[plan.status] ?? 'slate'}>{String(plan.status).replace(/_/g, ' ')}</Badge></td>
                  <td className="text-2xs">{(plan.modules ?? []).join(', ') || '—'}</td>
                  <td className="text-2xs">{(plan.frameworks ?? []).map((framework: any) => `${framework.key}${framework.version ? ` ${framework.version}` : ''}`).join(', ') || '—'}</td>
                  <td className="text-right font-mono text-2xs">{plan.executed_checks}</td>
                  <td className="text-[10px] text-[var(--ficap-muted)]">{formatDate(plan.created_at)}<div>{plan.created_by_name ?? '—'}</div></td>
                  <td className="text-[10px] text-[var(--ficap-muted)]">{plan.approved_at ? formatDate(plan.approved_at) : 'not approved'}<div>{plan.approved_by_name ?? ''}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {!plans.length ? (
          <div className="px-4 py-6">
            <EmptyState title="No plans recorded" description="A plan is created from an engagement before execution is possible." action={<Link href="/engagements" className="btn btn-secondary btn-sm">Open engagements</Link>} />
          </div>
        ) : null}
      </Card>

      <div className="mt-4">
        <DataQualityNote>
          Approving a plan approves the method, not the outcome. Checks that a plan lists but that could not run are recorded as blocked or not assessed, and they never
          count towards coverage. Plan approval and report approval are separate decisions because they answer different questions.
        </DataQualityNote>
      </div>
    </>
  );
}
