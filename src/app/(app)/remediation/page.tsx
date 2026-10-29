import Link from 'next/link';
import { pageContext, query, param } from '@/lib/page-context';
import { listRemediation } from '@/lib/domain/remediation';
import { listInstitutions } from '@/lib/domain/institutions';
import { can } from '@/lib/rbac';
import { flashFrom } from '@/lib/page-context';
import {
  Card, CardHeader, CardBody, PageHeader, Badge, SeverityBadge, TableWrap, StatCard, EmptyState,
  Flash, DataQualityNote, formatDate, relativeDays,
} from '@/components/ui';
import { submitRemediationAction } from '@/app/actions/assessments';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

const STATUSES: { key: string; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'verified', label: 'Verified' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'closed', label: 'Closed' },
];

export default async function RemediationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('remediation:read');
  const flash = flashFrom(params);
  const institutionId = param(params, 'institutionId');
  const status = param(params, 'status');

  const [rows, institutions] = await query(ctx, (tx) =>
    Promise.all([listRemediation(tx, ctx, { institutionId, status }), listInstitutions(tx, ctx, {})]),
  );

  const open = rows.filter((row: any) => row.status === 'open').length;
  const inProgress = rows.filter((row: any) => row.status === 'in_progress').length;
  const submitted = rows.filter((row: any) => row.status === 'submitted').length;
  const overdue = rows.filter((row: any) => row.overdue).length;
  const canSubmit = can(ctx.user, 'remediation:submit');

  return (
    <>
      <PageHeader
        title="Remediation management"
        description="Institution remediation is tracked against a written plan. A submitted fix is a claim until an independent retest verifies it — submission never closes a finding."
        meta={<><Badge tone="slate">{rows.length} plans in view</Badge>{overdue ? <Badge tone="red">{overdue} overdue</Badge> : null}</>}
        actions={<Link href="/retesting" className="btn btn-secondary">Retesting workspace</Link>}
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open" value={open} tone="slate" hint="Plan agreed, work not started" />
        <StatCard label="In progress" value={inProgress} tone="navy" hint="Institution reports active work" />
        <StatCard label="Awaiting verification" value={submitted} tone="amber" hint="Claimed fixed, retest outstanding" />
        <StatCard label="Overdue" value={overdue} tone="red" hint="Past the agreed target date" />
      </div>

      <Card className="mb-4">
        <CardHeader title="Filters" />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label">Institution</span>
              <select name="institutionId" defaultValue={institutionId ?? ''} className="input mt-1">
                <option value="">All institutions</option>
                {institutions.map((institution: any) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Plan status</span>
              <select name="status" defaultValue={status ?? ''} className="input mt-1">
                <option value="">Any status</option>
                {STATUSES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" type="submit">Apply</button>
            <Link href="/remediation" className="btn btn-ghost">Reset</Link>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Remediation plans" subtitle="Ordered by overdue status, remediation priority and target date." />
        {rows.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Finding</th><th>Institution</th><th>Owner</th><th>Severity</th><th>Priority</th><th>Target</th><th>Status</th><th>Submissions</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.id}>
                    <td className="max-w-[22rem]">
                      <Link href={`/findings/${row.finding_id}`} className="link text-2xs font-medium">{row.finding_reference}</Link>
                      <div className="text-2xs text-[var(--ficap-muted)]">{row.title}</div>
                    </td>
                    <td className="text-2xs">{row.institution_name}<div className="text-2xs text-[var(--ficap-muted)]">{row.application_name ?? '—'}</div></td>
                    <td className="text-2xs">{row.owner_team ?? 'unassigned'}</td>
                    <td><SeverityBadge severity={row.technical_severity} /></td>
                    <td className="text-2xs">{row.priority_rank ? `P${row.priority_rank}` : '—'}</td>
                    <td className="whitespace-nowrap text-2xs">
                      {row.target_date ? formatDate(row.target_date) : 'not set'}
                      {row.overdue ? <div className="text-risk-critical">overdue</div> : null}
                    </td>
                    <td className="text-2xs capitalize">{String(row.status).replace(/_/g, ' ')}</td>
                    <td className="text-2xs">{row.submission_count}</td>
                    <td className="text-right">
                      {canSubmit && ['open', 'in_progress'].includes(row.status) ? (
                        <details>
                          <summary className="btn btn-ghost btn-xs cursor-pointer">Submit fix</summary>
                          <form action={submitRemediationAction} className="mt-2 w-64 space-y-2 rounded border border-[var(--ficap-border)] p-2">
                            <Csrf />
                            <input type="hidden" name="planId" value={row.id} />
                            <input type="hidden" name="findingId" value={row.finding_id} />
                            <label className="label" htmlFor={`notes-${row.id}`}>What changed</label>
                            <textarea id={`notes-${row.id}`} name="notes" rows={3} className="input" required minLength={10} placeholder="Describe the change and the evidence the institution holds" />
                            <button className="btn btn-primary btn-xs" type="submit">Submit for verification</button>
                          </form>
                        </details>
                      ) : (
                        <Link href={`/findings/${row.finding_id}`} className="btn btn-ghost btn-xs">Open</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState
              title="No remediation plan matches these filters"
              description="Plans are created with each finding. If an assessment has not produced findings, nothing will appear here."
              action={<Link href="/findings" className="btn btn-secondary">Open findings</Link>}
            />
          </CardBody>
        )}
      </Card>

      <div className="mt-4">
        <DataQualityNote>
          A remediation plan records the root cause, containment, short-term and permanent fix, verification criteria and retest procedure. Target dates are
          agreed with the institution; when a date passes without verification the plan is flagged overdue in every report that includes it.
        </DataQualityNote>
      </div>
    </>
  );
}
