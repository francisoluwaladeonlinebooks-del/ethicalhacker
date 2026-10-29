import Link from 'next/link';
import { pageContext, query, canDo, flashFrom, param } from '@/lib/page-context';
import { listApplications } from '@/lib/domain/applications';
import { CHANNELS } from '@/lib/constants';
import { Badge, Card, CardBody, CardHeader, EmptyState, Flash, PageHeader, StatCard, TableWrap } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('application:read');
  const channel = param(params, 'channel') ?? '';
  const flash = flashFrom(params);

  const rows = await query(ctx, (tx) => listApplications(tx, ctx, { channel }));
  const byChannel = CHANNELS.map((entry) => ({ ...entry, count: rows.filter((row: any) => row.channel === entry.key).length })).filter((entry) => entry.count > 0);
  const criticalHigh = rows.reduce((sum, row: any) => sum + Number(row.critical_high ?? 0), 0);
  const openFindings = rows.reduce((sum, row: any) => sum + Number(row.open_findings ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Application inventory"
        description="Internet banking, mobile, API, onboarding, payments and administrative channels under supervisory assessment. Inventory records describe the estate; assessment scope is approved separately on each engagement."
        actions={canDo(ctx, 'application:write') ? <Link href="/applications/new" className="btn btn-primary">Add application</Link> : null}
      />
      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications" value={rows.length} hint={`${byChannel.length} channels represented`} />
        <StatCard label="Test environments" value={rows.filter((row: any) => row.environment !== 'production').length} hint="Staging, sandbox and test systems" />
        <StatCard label="Open findings" value={openFindings} tone="amber" />
        <StatCard label="Critical / High" value={criticalHigh} tone={criticalHigh ? 'red' : 'green'} />
      </div>

      <Card>
        <CardHeader title="Filter" subtitle="Server-side filtering, scoped to the institutions you may see." />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <label className="label" htmlFor="channel">Channel</label>
              <select id="channel" name="channel" defaultValue={channel} className="select mt-1">
                <option value="">All channels</option>
                {CHANNELS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">Apply</button>
            <Link href="/applications" className="btn btn-secondary">Reset</Link>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Inventory" subtitle="Ordered by institution then application name." />
        {rows.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Institution</th>
                  <th>Channel</th>
                  <th>Environment</th>
                  <th>Data sensitivity</th>
                  <th className="text-right">Open findings</th>
                  <th className="text-right">Critical / High</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/applications/${row.id}`} className="link">{row.name}</Link>
                      <p className="text-2xs text-[var(--ficap-muted)]">{row.web_url ?? row.api_base_url ?? row.package_identifier ?? '—'}</p>
                    </td>
                    <td className="text-xs">{row.institution_name}</td>
                    <td className="capitalize text-xs">{String(row.channel).replace(/_/g, ' ')}</td>
                    <td className="capitalize text-xs">{row.environment}</td>
                    <td><Badge tone={row.data_sensitivity === 'restricted' ? 'red' : row.data_sensitivity === 'confidential' ? 'amber' : 'neutral'}>{row.data_sensitivity}</Badge></td>
                    <td className="text-right font-mono">{row.open_findings}</td>
                    <td className="text-right font-mono">{Number(row.critical_high) > 0 ? <span className="font-semibold text-risk-critical">{row.critical_high}</span> : '0'}</td>
                    <td className="text-xs capitalize">{String(row.status).replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState title="No applications inventoried" description="Add an application to describe the channel, environment and data sensitivity before scoping an engagement." />
          </CardBody>
        )}
      </Card>
    </div>
  );
}
