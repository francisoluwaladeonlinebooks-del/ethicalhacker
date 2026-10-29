import Link from 'next/link';
import { pageContext, query, param } from '@/lib/page-context';
import { listFindings } from '@/lib/domain/findings';
import { listInstitutions } from '@/lib/domain/institutions';
import { can } from '@/lib/rbac';
import { PageHeader, Card, CardHeader, CardBody, TableWrap, Badge, SeverityBadge, StatusBadge, EmptyState, Pagination, relativeDays, DataQualityNote } from '@/components/ui';

export const dynamic = 'force-dynamic';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'none', 'unscored'];
const STATUSES = [
  'new', 'needs_verification', 'confirmed', 'false_positive', 'accepted_risk',
  'remediation_in_progress', 'ready_for_retest', 'resolved', 'reopened', 'closed',
];

export default async function FindingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('finding:read');
  const page = Math.max(1, Number(param(params, 'page') ?? 1));
  const pageSize = 25;
  const filters = {
    institutionId: param(params, 'institutionId'),
    severity: param(params, 'severity'),
    status: param(params, 'status'),
    search: param(params, 'q'),
    band: param(params, 'band'),
  };
  const [rows, institutions] = await query(ctx, (tx) =>
    Promise.all([listFindings(tx, ctx, filters), listInstitutions(tx, ctx, {})]),
  );
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const unverified = rows.filter((row: any) => !row.verified_at).length;
  const confirmed = rows.filter((row: any) => row.status === 'confirmed' || row.status === 'remediation_in_progress' || row.status === 'ready_for_retest').length;

  return (
    <>
      <PageHeader
        title="Findings explorer"
        description="Every observation is classified before it is counted. A suspected item is not a confirmed deficiency, and an unscored item is an observation rather than a pass."
        meta={
          <>
            <Badge tone="slate">{total} in view</Badge>
            <Badge tone="red">{confirmed} confirmed</Badge>
            <Badge tone="amber">{unverified} awaiting verification</Badge>
            {filters.search ? <Badge tone="navy">search: {filters.search}</Badge> : null}
          </>
        }
        actions={
          <>
            <Link href="/risk" className="btn btn-secondary">Risk workspace</Link>
            {can(ctx.user, 'report:generate') ? <Link href="/reports?new=1" className="btn btn-primary">Generate report</Link> : null}
          </>
        }
      />

      <Card className="mb-4">
        <CardHeader title="Filters" subtitle="Filters apply within the institutions you are authorised to see." />
        <CardBody>
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="block">
              <span className="label">Institution</span>
              <select name="institutionId" defaultValue={filters.institutionId ?? ''} className="input mt-1">
                <option value="">All institutions</option>
                {institutions.map((institution: any) => (
                  <option key={institution.id} value={institution.id}>{institution.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Technical severity</span>
              <select name="severity" defaultValue={filters.severity ?? ''} className="input mt-1">
                <option value="">Any severity</option>
                {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Status</span>
              <select name="status" defaultValue={filters.status ?? ''} className="input mt-1">
                <option value="">Any status</option>
                {STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Search</span>
              <input name="q" defaultValue={filters.search ?? ''} placeholder="Reference, title or asset" className="input mt-1" />
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn btn-primary">Apply</button>
              <Link href="/findings" className="btn btn-ghost">Reset</Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Findings"
          subtitle={`${total} matching record(s) · ordered by remediation priority then CVSS score`}
          actions={<Pagination basePath="/findings" page={page} pageSize={pageSize} total={total} params={{ institutionId: filters.institutionId, severity: filters.severity, status: filters.status, q: filters.search, band: filters.band }} />}
        />
        {pageRows.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Finding</th>
                  <th>Institution</th>
                  <th>Severity</th>
                  <th>Contextual</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Verification</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row: any) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap font-mono text-2xs">
                      <Link href={`/findings/${row.id}`} className="link">{row.reference}</Link>
                    </td>
                    <td className="max-w-[26rem]">
                      <Link href={`/findings/${row.id}`} className="link font-medium">{row.title}</Link>
                      <div className="text-2xs text-[var(--ficap-muted)]">
                        {row.category}
                        {row.application_name ? ` · ${row.application_name}` : ''}
                        {row.evidence_count ? ` · ${row.evidence_count} evidence item(s)` : ''}
                      </div>
                    </td>
                    <td className="text-2xs">{row.institution_name}<div className="text-2xs text-[var(--ficap-muted)]">{row.engagement_code}</div></td>
                    <td><SeverityBadge severity={row.technical_severity} score={row.cvss_score} /></td>
                    <td className="text-2xs capitalize">{row.contextual_rating ?? 'not assessed'}</td>
                    <td className="text-2xs">{row.priority_rank ? `P${row.priority_rank}` : '—'}</td>
                    <td><StatusBadge status={row.status} /></td>
                    <td className="text-2xs">
                      {row.verified_at ? <span className="text-seal-700">verified {relativeDays(row.verified_at)}</span> : <span className="text-amber-700">unverified</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState
              title="No finding matches these filters"
              description="Adjust the filters, or open an engagement to launch an assessment. Areas that have not been tested do not appear here — they are recorded as not assessed on the engagement's coverage page."
              action={<Link href="/engagements" className="btn btn-secondary">Open engagements</Link>}
            />
          </CardBody>
        )}
      </Card>

      <div className="mt-4">
        <DataQualityNote>
          Findings are only created from recorded check outcomes. A finding that has not been independently verified is shown as <em>needs verification</em> and is
          excluded from confirmed counts in reports. CVSS v4.0 severity and contextual banking risk are stored separately; the contextual rating never changes the
          CVSS score.
        </DataQualityNote>
      </div>
    </>
  );
}
