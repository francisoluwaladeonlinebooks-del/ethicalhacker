import Link from 'next/link';
import { pageContext, query, canDo, flashFrom, param } from '@/lib/page-context';
import { listEngagements } from '@/lib/domain/engagements';
import { listInstitutions } from '@/lib/domain/institutions';
import { Badge, Card, CardBody, CardHeader, EmptyState, Flash, PageHeader, StatCard, StatusBadge, TableWrap, formatDate, relativeDays } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUSES = ['draft', 'pending_authorization', 'authorized', 'plan_review', 'approved', 'running', 'paused', 'stopped', 'completed', 'cancelled'];

export default async function EngagementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('engagement:read');
  const status = param(params, 'status') ?? '';
  const institutionId = param(params, 'institutionId') ?? '';
  const flash = flashFrom(params);

  const [rows, institutions] = await query(ctx, async (tx) => [
    await listEngagements(tx, ctx, { status, institutionId }),
    await listInstitutions(tx, ctx, {}),
  ]);

  const running = rows.filter((row: any) => row.status === 'running').length;
  const awaiting = rows.filter((row: any) => ['draft', 'pending_authorization', 'authorized', 'plan_review'].includes(row.status)).length;
  const expiredScope = rows.filter((row: any) => row.scope_expires_at && new Date(row.scope_expires_at) < new Date() && !['completed', 'cancelled'].includes(row.status)).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assessment engagements"
        description="Each engagement binds one institution, its written authorisation, the approved asset scope, permitted methods and the testing window. Nothing is sent to a target until all of those are in place and the plan is approved."
        actions={canDo(ctx, 'engagement:create') ? <Link href="/engagements/new" className="btn btn-primary">New engagement</Link> : null}
      />
      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Engagements" value={rows.length} hint="Matching the current filters" />
        <StatCard label="Running" value={running} tone="navy" />
        <StatCard label="Awaiting approval" value={awaiting} tone="amber" hint="Authorisation or plan approval outstanding" />
        <StatCard label="Expired scope" value={expiredScope} tone={expiredScope ? 'red' : 'green'} hint="Execution is blocked when scope has expired" />
      </div>

      <Card>
        <CardBody>
          <form method="get" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="institutionId">Institution</label>
              <select id="institutionId" name="institutionId" defaultValue={institutionId} className="select mt-1">
                <option value="">All institutions</option>
                {institutions.map((institution: any) => (
                  <option key={institution.id} value={institution.id}>{institution.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={status} className="select mt-1">
                <option value="">All statuses</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn btn-primary">Apply</button>
              <Link href="/engagements" className="btn btn-secondary">Reset</Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`${rows.length} engagement${rows.length === 1 ? '' : 's'}`} subtitle="Ordered by most recent activity." />
        {rows.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Engagement</th>
                  <th>Institution</th>
                  <th>Status</th>
                  <th>Scope window</th>
                  <th className="text-right">Assets</th>
                  <th className="text-right">Jobs</th>
                  <th className="text-right">Findings</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => {
                  const expired = row.scope_expires_at && new Date(row.scope_expires_at) < new Date();
                  return (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/engagements/${row.id}`} className="link">{row.name}</Link>
                        <p className="text-2xs text-[var(--ficap-muted)]">{row.code}</p>
                      </td>
                      <td className="text-xs">{row.institution_name}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="whitespace-nowrap text-2xs">
                        {row.scope_approved_at ? formatDate(row.scope_approved_at) : '—'} → {row.scope_expires_at ? formatDate(row.scope_expires_at) : '—'}
                        {expired ? <Badge tone="red">expired</Badge> : row.scope_expires_at ? <span className="ml-1 text-[var(--ficap-muted)]">({relativeDays(row.scope_expires_at)})</span> : null}
                      </td>
                      <td className="text-right font-mono">{row.scope_assets ?? '—'}</td>
                      <td className="text-right font-mono">{row.job_count ?? '—'}</td>
                      <td className="text-right font-mono">{row.finding_count ?? 0}</td>
                      <td className="text-xs">{row.owner_name ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState
              title="No engagements match"
              description="Create an engagement to record the institution's written authorisation, the assets in scope and the permitted methods before any assessment activity."
              action={canDo(ctx, 'engagement:create') ? <Link href="/engagements/new" className="btn btn-primary">New engagement</Link> : undefined}
            />
          </CardBody>
        )}
      </Card>
    </div>
  );
}
