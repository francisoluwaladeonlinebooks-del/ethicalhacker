import Link from 'next/link';
import { pageContext, query, param, flashFrom } from '@/lib/page-context';
import { listReports } from '@/lib/reporting/report';
import { listEngagements } from '@/lib/domain/engagements';
import { listInstitutions } from '@/lib/domain/institutions';
import { can } from '@/lib/rbac';
import {
  Card, CardHeader, CardBody, PageHeader, Badge, StatusBadge, TableWrap, StatCard, EmptyState, Flash,
  Field, DataQualityNote, formatDate, relativeDays,
} from '@/components/ui';
import { generateReportAction } from '@/app/actions/reports';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

const REPORT_TYPES = [
  { key: 'executive', label: 'Executive summary', help: 'Board-level position: counts by classification, coverage, remediation and limitations.' },
  { key: 'technical', label: 'Technical report', help: 'Full finding detail with CVSS v4.0 vectors, contextual risk, evidence manifest and not-assessed list.' },
  { key: 'supervisory_portfolio', label: 'Supervisory portfolio', help: 'Cross-institution aggregate for supervisory planning. No institution detail is disclosed across institutions.' },
  { key: 'remediation_status', label: 'Remediation status', help: 'Plan status, target dates and overdue position for the selected scope.' },
  { key: 'coverage', label: 'Coverage report', help: 'Which checks were executed, blocked or not assessed, against the framework versions in force.' },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('report:read');
  const flash = flashFrom(params);
  const status = param(params, 'status');
  const preselectedEngagement = param(params, 'engagementId');

  const [reports, engagements, institutions] = await query(ctx, (tx) =>
    Promise.all([listReports(tx, ctx, { status }), listEngagements(tx, ctx, {}), listInstitutions(tx, ctx, {})]),
  );

  const draft = reports.filter((report: any) => report.status === 'draft').length;
  const inReview = reports.filter((report: any) => report.status === 'in_review').length;
  const approved = reports.filter((report: any) => report.status === 'approved' || report.status === 'published').length;
  const canGenerate = can(ctx.user, 'report:generate');

  return (
    <>
      <PageHeader
        title="Reports"
        description="A report is a frozen snapshot of what the platform recorded at generation time. Regeneration creates a new version; an approved report is never silently rewritten."
        meta={<><Badge tone="slate">{reports.length} reports</Badge>{inReview ? <Badge tone="amber">{inReview} awaiting approval</Badge> : null}</>}
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Drafts" value={draft} tone="slate" hint="Not yet submitted for review" />
        <StatCard label="In review" value={inReview} tone="amber" hint="Awaiting independent approval" />
        <StatCard label="Approved or published" value={approved} tone="green" hint="Cleared for supervisory use" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            <CardHeader
              title="Report library"
              subtitle="Confidential supervisory material. Every export is recorded in the audit trail."
              actions={
                <form method="get" className="flex items-end gap-2">
                  <select name="status" defaultValue={status ?? ''} className="input py-1 text-2xs" aria-label="Status filter">
                    <option value="">Any status</option>
                    {['draft', 'in_review', 'changes_requested', 'approved', 'published'].map((key) => <option key={key} value={key}>{key.replace(/_/g, ' ')}</option>)}
                  </select>
                  <button className="btn btn-secondary btn-xs" type="submit">Filter</button>
                </form>
              }
            />
            {reports.length ? (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Report</th><th>Scope</th><th>Status</th><th>Version</th><th>Generated</th><th>Approved</th><th /></tr></thead>
                  <tbody>
                    {reports.map((report: any) => (
                      <tr key={report.id}>
                        <td className="max-w-[24rem]">
                          <Link href={`/reports/${report.id}`} className="link text-2xs font-medium">{report.title}</Link>
                          <div className="text-2xs text-[var(--ficap-muted)]">{String(report.report_type).replace(/_/g, ' ')} · {report.review_count} review event(s)</div>
                        </td>
                        <td className="text-2xs">{report.institution_name ?? 'Portfolio'}{report.engagement_code ? <div className="text-2xs text-[var(--ficap-muted)]">{report.engagement_code}</div> : null}</td>
                        <td><StatusBadge status={report.status} /></td>
                        <td className="font-mono text-2xs">v{report.version}</td>
                        <td className="whitespace-nowrap text-2xs">{relativeDays(report.generated_at)}</td>
                        <td className="whitespace-nowrap text-2xs">{report.approved_at ? formatDate(report.approved_at) : '—'}</td>
                        <td className="text-right"><Link href={`/reports/${report.id}`} className="btn btn-ghost btn-xs">Open</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <CardBody><EmptyState title="No report has been generated" description="Generate a report from a completed engagement or an institution's current position." /></CardBody>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {canGenerate ? (
            <Card>
              <CardHeader title="Generate a report" subtitle="Snapshots are generated server side from persisted records only." />
              <CardBody>
                <form action={generateReportAction} className="space-y-2">
                  <Csrf />
                  <Field label="Report type" name="reportType" required>
                    <select name="reportType" className="input" required defaultValue="technical">
                      {REPORT_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Engagement" name="engagementId" hint="Recommended. The snapshot is bound to this engagement and its authorisation record.">
                    <select name="engagementId" className="input" defaultValue={preselectedEngagement ?? ''}>
                      <option value="">No engagement (institution-wide)</option>
                      {engagements.map((engagement: any) => (
                        <option key={engagement.id} value={engagement.id}>{engagement.code} · {engagement.name?.slice(0, 40)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Institution" name="institutionId" hint="Required when no engagement is selected, except for a portfolio report.">
                    <select name="institutionId" className="input">
                      <option value="">Select institution</option>
                      {institutions.map((institution: any) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Title" name="title" hint="Leave blank to use the standard title."><input name="title" className="input" /></Field>
                  <button className="btn btn-primary btn-sm" type="submit">Generate snapshot</button>
                </form>
                <ul className="mt-3 space-y-1 text-2xs text-[var(--ficap-muted)]">
                  {REPORT_TYPES.map((type) => <li key={type.key}><span className="font-medium text-[var(--ficap-fg)]">{type.label}</span> — {type.help}</li>)}
                </ul>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Report generation" />
              <CardBody><p className="prose-note">Your role can read reports but not generate them. Generation is restricted to assessment personnel; approval is restricted to an independent approver.</p></CardBody>
            </Card>
          )}

          <DataQualityNote>
            Reports separate confirmed, suspected and observation status, and list every blocked or unexecuted check. A high pass rate is never presented as assurance
            that the institution is secure.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
