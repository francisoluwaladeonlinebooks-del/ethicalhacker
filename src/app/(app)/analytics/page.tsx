import Link from 'next/link';
import { pageContext, query } from '@/lib/page-context';
import { executiveSummary, frameworkDashboard, portfolioAnalytics } from '@/lib/domain/analytics';
import { Card, CardHeader, CardBody, PageHeader, Badge, StatCard, TableWrap, EmptyState, Bar, DataQualityNote, relativeDays } from '@/components/ui';

export const dynamic = 'force-dynamic';

const OPEN_STATES = ['new', 'needs_verification', 'confirmed', 'reopened', 'remediation_in_progress', 'ready_for_retest', 'accepted_risk'];

export default async function AnalyticsPage() {
  const ctx = await pageContext('institution:portfolio');
  const data = await query(ctx, async (tx) => {
    const [summary, frameworks, portfolio] = await Promise.all([
      executiveSummary(tx, ctx),
      frameworkDashboard(tx, ctx),
      portfolioAnalytics(tx, ctx),
    ]);
    const institutions = await tx.query<any>(
      `SELECT i.id, i.name, i.category, i.risk_tier,
              count(f.id) FILTER (WHERE f.status = ANY($2::text[]))::int AS open_findings,
              count(f.id) FILTER (WHERE f.technical_severity IN ('critical','high') AND f.status = ANY($2::text[]))::int AS critical_high,
              count(f.id) FILTER (WHERE f.status = 'needs_verification')::int AS unverified,
              max(f.updated_at)::text AS last_activity,
              (SELECT count(*)::int FROM applications a WHERE a.institution_id = i.id AND a.status = 'active') AS applications,
              (SELECT count(*)::int FROM engagements e WHERE e.institution_id = i.id AND e.status IN ('approved','running')) AS active_engagements
         FROM institutions i LEFT JOIN findings f ON f.institution_id = i.id
        WHERE i.data_mode = $1 GROUP BY i.id ORDER BY critical_high DESC, open_findings DESC`,
      [ctx.mode, OPEN_STATES],
    );
    return { summary, frameworks, portfolio, institutions };
  });

  const totals = data.summary.totals ?? {};
  const severityMap: Record<string, number> = data.summary.bySeverity ?? {};
  const severities = Object.entries(severityMap).map(([technical_severity, count]) => ({ technical_severity, count }));
  const severityOf = (key: string) => severityMap[key] ?? 0;
  const maxChannel = Math.max(1, ...(data.summary.channelCoverage ?? []).map((row: any) => row.applications));
  const frameworkRows = data.frameworks.catalogue ?? [];
  const resultRows = data.frameworks.results ?? [];

  return (
    <>
      <PageHeader
        title="Supervisory analytics"
        description="Portfolio position across supervised institutions. Figures are aggregated from recorded assessments only; an unassessed institution is shown as unassessed, never as compliant."
        meta={
          <>
            <Badge tone="slate">{totals.institutions ?? 0} institutions</Badge>
            <Badge tone="navy">{data.institutions.length} with records</Badge>
            <Badge tone="red">{totals.open_critical_high ?? 0} open critical/high</Badge>
          </>
        }
        actions={<Link href="/reports?status=" className="btn btn-secondary">Portfolio report</Link>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Institutions supervised" value={totals.institutions ?? 0} tone="navy" hint="In the supervisory register" />
        <StatCard label="Applications in scope" value={totals.applications ?? 0} tone="slate" hint="Active application records" />
        <StatCard label="Open critical / high" value={totals.open_critical_high ?? 0} tone="red" hint="Unresolved technical severity" />
        <StatCard label="Overdue remediation" value={totals.overdue_remediation ?? 0} tone="amber" hint="Past agreed target date" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Institution position" subtitle="Counts only. A zero count means no finding has been recorded — not that the institution is secure." />
          <TableWrap>
            <table className="table">
              <thead><tr><th>Institution</th><th>Category</th><th>Risk tier</th><th>Applications</th><th>Open</th><th>Critical / High</th><th>Unverified</th><th>Active engagements</th><th>Last activity</th></tr></thead>
              <tbody>
                {data.institutions.map((row: any) => (
                  <tr key={row.id}>
                    <td className="text-2xs"><Link href={`/institutions/${row.id}`} className="link font-medium">{row.name}</Link></td>
                    <td className="text-2xs capitalize">{String(row.category).replace(/_/g, ' ')}</td>
                    <td className="text-2xs capitalize">{row.risk_tier ?? 'unassessed'}</td>
                    <td className="text-right font-mono text-2xs">{row.applications}</td>
                    <td className="text-right font-mono text-2xs">{row.open_findings}</td>
                    <td className={`text-right font-mono text-2xs ${row.critical_high ? 'font-semibold text-risk-critical' : ''}`}>{row.critical_high}</td>
                    <td className="text-right font-mono text-2xs">{row.unverified}</td>
                    <td className="text-right font-mono text-2xs">{row.active_engagements}</td>
                    <td className="whitespace-nowrap text-2xs">{row.last_activity ? relativeDays(row.last_activity) : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Severity mix" subtitle="Open findings by CVSS v4.0 band." />
            <CardBody>
              {severities.length ? (
                <ul className="space-y-2">
                  {['critical', 'high', 'medium', 'low', 'none', 'unscored'].map((band) => {
                    const count = severityOf(band);
                    const max = Math.max(1, ...severities.map((row: any) => row.count));
                    return (
                      <li key={band}>
                        <div className="mb-1 flex items-center justify-between text-2xs">
                          <span className="capitalize">{band}</span>
                          <span className="font-mono">{count}</span>
                        </div>
                        <Bar value={count} max={max} label={band} />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="prose-note">No open finding has been recorded.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Applications by channel" subtitle="Channel distribution in the registry." />
            <CardBody>
              {(data.summary.channelCoverage ?? []).length ? (
                <ul className="space-y-2">
                  {(data.summary.channelCoverage ?? []).map((row: any) => (
                    <li key={row.channel}>
                      <div className="mb-1 flex items-center justify-between text-2xs">
                        <span className="capitalize">{String(row.channel).replace(/_/g, ' ')}</span>
                        <span className="font-mono">{row.applications}</span>
                      </div>
                      <Bar value={row.applications} max={maxChannel} label={row.channel} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="prose-note">No application has been registered.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recurring weakness themes" subtitle="Aggregated by category across institutions." />
          {data.portfolio.authorised && data.portfolio.themes.length ? (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Category</th><th>Findings</th><th>Institutions</th><th>Applications</th><th>Highest severity</th></tr></thead>
                <tbody>
                  {data.portfolio.themes.map((row: any) => (
                    <tr key={row.category}>
                      <td className="text-2xs">{row.category}</td>
                      <td className="text-right font-mono text-2xs">{row.findings}</td>
                      <td className="text-right font-mono text-2xs">{row.institutions}</td>
                      <td className="text-right font-mono text-2xs">{row.applications}</td>
                      <td className="text-2xs capitalize">{row.highest}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody><EmptyState title="No theme recorded" description="Themes appear once findings exist across the portfolio." /></CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Framework coverage" subtitle="Executed checks by framework. Blocked and not-assessed checks are excluded from “passed”." />
          {frameworkRows.length ? (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Framework</th><th>Version</th><th>Items</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>Needs verification</th></tr></thead>
                <tbody>
                  {frameworkRows.map((framework: any) => {
                    const rows = resultRows.filter((row: any) => row.framework_key === framework.key);
                    const count = (status: string) => rows.filter((row: any) => row.status === status).reduce((sum: number, row: any) => sum + row.count, 0);
                    return (
                      <tr key={`${framework.key}-${framework.version}`}>
                        <td className="text-2xs">{framework.name}</td>
                        <td className="font-mono text-2xs">{framework.version}</td>
                        <td className="text-right font-mono text-2xs">{framework.items}</td>
                        <td className="text-right font-mono text-2xs">{count('passed')}</td>
                        <td className="text-right font-mono text-2xs">{count('failed')}</td>
                        <td className="text-right font-mono text-2xs">{count('blocked')}</td>
                        <td className="text-right font-mono text-2xs">{count('needs_verification')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody><p className="prose-note">No framework catalogue is loaded.</p></CardBody>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <DataQualityNote>
          Portfolio aggregates are for supervisory planning. They are not a supervisory rating of any institution, and they are never derived by converting
          vulnerability counts into a maturity score. Cross-institution figures never expose one institution&apos;s evidence to another.
        </DataQualityNote>
      </div>
    </>
  );
}
