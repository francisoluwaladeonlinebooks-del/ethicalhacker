import Link from 'next/link';
import { pageContext, query, canDo, flashFrom, param } from '@/lib/page-context';
import { listInstitutions } from '@/lib/domain/institutions';
import { INSTITUTION_CATEGORIES } from '@/lib/constants';
import { Badge, Card, CardBody, CardHeader, EmptyState, Flash, PageHeader, StatCard, TableWrap, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function InstitutionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('institution:read');
  const search = param(params, 'search') ?? '';
  const category = param(params, 'category') ?? '';
  const riskTier = param(params, 'riskTier') ?? '';
  const status = param(params, 'status') ?? '';
  const flash = flashFrom(params);

  const rows = await query(ctx, (tx) => listInstitutions(tx, ctx, { search, category, riskTier, status }));

  const totals = rows.reduce(
    (acc, row) => ({
      institutions: acc.institutions + 1,
      applications: acc.applications + Number((row as any).application_count ?? 0),
      criticalHigh: acc.criticalHigh + Number((row as any).critical_high ?? 0),
      open: acc.open + Number((row as any).open_findings ?? 0),
    }),
    { institutions: 0, applications: 0, criticalHigh: 0, open: 0 },
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Institution registry"
        description="The register of supervised institutions with their application estate and current supervisory risk position. Institution contacts see only their own institution."
        actions={canDo(ctx, 'institution:write') ? <Link href="/institutions/new" className="btn btn-primary">Add institution</Link> : null}
      />
      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Institutions" value={totals.institutions} hint="Matching the current filters" />
        <StatCard label="Applications" value={totals.applications} hint="Inventoried across those institutions" />
        <StatCard label="Open findings" value={totals.open} tone="amber" />
        <StatCard label="Critical / High" value={totals.criticalHigh} tone={totals.criticalHigh ? 'red' : 'green'} />
      </div>

      <Card>
        <CardHeader
          title="Filter the register"
          subtitle="Filters are applied server side; results remain bound to your authorised scope."
        />
        <CardBody>
          <form method="get" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="label" htmlFor="search">Search</label>
              <input id="search" name="search" defaultValue={search} className="input mt-1" placeholder="Name or code" />
            </div>
            <div>
              <label className="label" htmlFor="category">Category</label>
              <select id="category" name="category" defaultValue={category} className="select mt-1">
                <option value="">All categories</option>
                {INSTITUTION_CATEGORIES.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="riskTier">Risk tier</label>
              <select id="riskTier" name="riskTier" defaultValue={riskTier} className="select mt-1">
                <option value="">All tiers</option>
                {['critical', 'high', 'medium', 'low', 'unassessed'].map((tier) => (
                  <option key={tier} value={tier}>{tier}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={status} className="select mt-1">
                <option value="">All statuses</option>
                {['active', 'assessment_pending', 'remediation', 'suspended', 'closed'].map((value) => (
                  <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn btn-primary">Apply</button>
              <Link href="/institutions" className="btn btn-secondary">Reset</Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`${rows.length} institution${rows.length === 1 ? '' : 's'}`} subtitle="Sorted by open critical and high findings." />
        {rows.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Institution</th>
                  <th>Category</th>
                  <th>Risk tier</th>
                  <th className="text-right">Applications</th>
                  <th className="text-right">Engagements</th>
                  <th className="text-right">Open findings</th>
                  <th className="text-right">Critical / High</th>
                  <th>Last assessment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/institutions/${row.id}`} className="link">{row.name}</Link>
                      <p className="text-2xs text-[var(--ficap-muted)]">{row.code}{row.licence_number ? ` · licence ${row.licence_number}` : ''}</p>
                    </td>
                    <td className="capitalize">{String(row.category).replace(/_/g, ' ')}</td>
                    <td>
                      <Badge tone={row.risk_tier === 'critical' || row.risk_tier === 'high' ? 'red' : row.risk_tier === 'medium' ? 'amber' : row.risk_tier === 'low' ? 'green' : 'neutral'}>
                        {row.risk_tier}
                      </Badge>
                    </td>
                    <td className="text-right font-mono">{row.application_count}</td>
                    <td className="text-right font-mono">{row.engagement_count}</td>
                    <td className="text-right font-mono">{row.open_findings}</td>
                    <td className="text-right font-mono">{Number(row.critical_high) > 0 ? <span className="font-semibold text-risk-critical">{row.critical_high}</span> : '0'}</td>
                    <td className="whitespace-nowrap text-2xs text-[var(--ficap-muted)]">{row.last_assessment ? formatDate(row.last_assessment) : 'never assessed'}</td>
                    <td><Badge tone={row.status === 'active' ? 'green' : row.status === 'suspended' ? 'red' : 'neutral'}>{String(row.status).replace(/_/g, ' ')}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState
              title="No institutions match the filters"
              description="Adjust the filters, or add an institution to the supervisory register to begin scoping an engagement."
              action={canDo(ctx, 'institution:write') ? <Link href="/institutions/new" className="btn btn-primary">Add institution</Link> : undefined}
            />
          </CardBody>
        )}
      </Card>
    </div>
  );
}
