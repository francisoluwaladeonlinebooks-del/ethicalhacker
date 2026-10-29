import Link from 'next/link';
import { pageContext, query, canDo } from '@/lib/page-context';
import { executiveSummary, technicalSummary } from '@/lib/domain/analytics';
import { listAuditEvents } from '@/lib/domain/audit';
import { Badge, Bar, Card, CardBody, CardHeader, DataQualityNote, EmptyState, PageHeader, SeverityBadge, StatCard, StatusBadge, TableWrap, formatDate, relativeDays } from '@/components/ui';

export const dynamic = 'force-dynamic';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unscored'] as const;
const SEVERITY_BAR: Record<string, string> = {
  critical: 'bg-risk-critical',
  high: 'bg-[#c2410c]',
  medium: 'bg-amber-500',
  low: 'bg-seal-600',
  unscored: 'bg-slate-300',
};

export default async function OverviewPage() {
  const ctx = await pageContext();
  const { executive, technical, audit } = await query(ctx, async (tx) => ({
    executive: await executiveSummary(tx, ctx),
    technical: await technicalSummary(tx, ctx),
    audit: canDo(ctx, 'audit:read') ? await listAuditEvents(tx, { limit: 8 }) : [],
  }));

  const t = executive.totals ?? {};
  const totalSeverity = SEVERITIES.reduce((sum, key) => sum + Number(executive.bySeverity[key] ?? 0), 0);
  const highestSeverity = SEVERITIES.find((key) => Number(executive.bySeverity[key] ?? 0) > 0) ?? 'none';
  const checks = technical.checks ?? {};

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Supervisory overview${ctx.mode === 'demo' ? ' — demonstration estate' : ''}`}
        description="Live position across the institutions, applications and assessments you are authorised to see. Counts exclude checks that were blocked or not assessed, and technical severity (CVSS v4.0) is always shown separately from contextual banking risk."
        meta={
          <>
            <Badge tone={ctx.mode === 'demo' ? 'amber' : 'green'}>{ctx.mode === 'demo' ? 'Synthetic demonstration data' : 'Live supervisory data'}</Badge>
            <span className="text-2xs text-[var(--ficap-muted)]">
              Signed in as {ctx.user.name} · {ctx.user.role.replace(/_/g, ' ')}
            </span>
          </>
        }
        actions={
          <>
            {canDo(ctx, 'engagement:create') ? (
              <Link href="/engagements/new" className="btn btn-primary">
                New engagement
              </Link>
            ) : null}
            {canDo(ctx, 'finding:read') ? (
              <Link href="/findings" className="btn btn-secondary">
                Findings explorer
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Institutions in scope" value={t.institutions ?? 0} hint={`${t.applications ?? 0} active applications inventoried`} href={canDo(ctx, 'institution:read') ? '/institutions' : undefined} />
        <StatCard label="Assessments in progress" value={t.assessments_in_progress ?? 0} tone="navy" hint={`${t.completed_assessments ?? 0} completed engagements retained`} href={canDo(ctx, 'engagement:read') ? '/engagements' : undefined} />
        <StatCard label="Open findings" value={t.open_findings ?? 0} tone="amber" hint={`${t.awaiting_verification ?? 0} awaiting independent verification`} href={canDo(ctx, 'finding:read') ? '/findings' : undefined} />
        <StatCard label="Critical / High open" value={t.open_critical_high ?? 0} tone="red" hint="CVSS v4.0 base severity, excluding resolved and false positives" href={canDo(ctx, 'finding:read') ? '/findings?severity=critical' : undefined} />
        <StatCard label="Overdue remediation" value={t.overdue_remediation ?? 0} tone={(t.overdue_remediation ?? 0) > 0 ? 'red' : 'green'} hint={`${t.awaiting_retest ?? 0} findings ready for retest`} href={canDo(ctx, 'remediation:read') ? '/remediation' : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Open risk by technical severity"
            subtitle="CVSS v4.0 base scores across open findings. Severity is never uplifted for business context; contextual banking risk is assessed and reported separately."
            actions={<Link href="/findings" className="btn btn-secondary btn-xs">Open findings</Link>}
          />
          <CardBody className="space-y-3">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Severity distribution">
              {SEVERITIES.map((key) => {
                const value = Number(executive.bySeverity[key] ?? 0);
                if (!value || !totalSeverity) return null;
                return <div key={key} className={SEVERITY_BAR[key]} style={{ width: `${(value / totalSeverity) * 100}%` }} title={`${key}: ${value}`} />;
              })}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
              {SEVERITIES.map((key) => (
                <div key={key}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--ficap-muted)]">{key}</span>
                    <span className="font-mono text-xs font-semibold text-navy-900">{executive.bySeverity[key] ?? 0}</span>
                  </div>
                  <div className="mt-1 h-1 rounded bg-slate-100">
                    <div className={SEVERITY_BAR[key]} style={{ height: 4, width: `${totalSeverity ? (Number(executive.bySeverity[key] ?? 0) / totalSeverity) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-[var(--ficap-muted)]">Top finding categories</h3>
                {executive.byCategory.length ? (
                  <ul className="space-y-1.5">
                    {executive.byCategory.slice(0, 6).map((row: any) => (
                      <li key={row.category} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-[var(--ficap-text)]" title={row.category}>{row.category}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {Number(row.critical_high) > 0 ? <Badge tone="red">{row.critical_high} crit/high</Badge> : null}
                          <span className="font-mono text-2xs text-[var(--ficap-muted)]">{row.count}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="prose-note">No open findings recorded for this mode.</p>
                )}
              </div>
              <div>
                <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-[var(--ficap-muted)]">Channel coverage</h3>
                {executive.channelCoverage.length ? (
                  <ul className="space-y-1.5">
                    {executive.channelCoverage.slice(0, 6).map((row: any) => (
                      <li key={row.channel} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span>{row.channel.replace(/_/g, ' ')}</span>
                          <span className="font-mono text-2xs text-[var(--ficap-muted)]">
                            {row.assessed}/{row.applications} assessed
                          </span>
                        </div>
                        <Bar value={Number(row.assessed)} max={Number(row.applications)} tone={Number(row.assessed) < Number(row.applications) ? 'amber' : 'green'} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="prose-note">No applications inventoried yet.</p>
                )}
              </div>
            </div>
            <DataQualityNote>
              Highest open severity: <strong className="uppercase">{highestSeverity}</strong>. Checks recorded as blocked or not assessed are
              excluded from all coverage figures — an untested control is never reported as effective.
            </DataQualityNote>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Assessment pipeline" subtitle="Engagements and queued or running jobs." actions={<Link href="/jobs" className="btn btn-secondary btn-xs">Job monitor</Link>} />
          <CardBody className="space-y-3">
            {technical.engagements.length ? (
              <ul className="space-y-2">
                {technical.engagements.slice(0, 5).map((row: any) => (
                  <li key={row.id} className="rounded border border-[var(--ficap-border)] px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/engagements/${row.id}`} className="link truncate text-xs">{row.name}</Link>
                        <p className="mt-0.5 truncate text-2xs text-[var(--ficap-muted)]">
                          {row.code} · {row.institution_name}
                        </p>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-2xs text-[var(--ficap-muted)]">
                      <span>{row.scope_assets} scope assets</span>
                      <span>·</span>
                      <span>{row.findings} findings</span>
                      <span>·</span>
                      <span>scope {relativeDays(row.scope_expires_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No active engagements" description="Create an engagement to record institution authorisation, scope and the approved test plan before any assessment activity." />
            )}

            <div className="rounded border border-[var(--ficap-border)] bg-[#fbfcfd] px-2.5 py-2">
              <h3 className="text-2xs font-semibold uppercase tracking-wider text-[var(--ficap-muted)]">Check execution record</h3>
              <dl className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-2xs text-[var(--ficap-muted)]">Passed</dt>
                  <dd className="font-mono font-semibold text-seal-700">{checks.passed ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-[var(--ficap-muted)]">Failed</dt>
                  <dd className="font-mono font-semibold text-risk-critical">{checks.failed ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-[var(--ficap-muted)]">Blocked / error</dt>
                  <dd className="font-mono font-semibold text-amber-700">{checks.blocked ?? 0}</dd>
                </div>
              </dl>
              <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--ficap-muted)]">
                Blocked checks indicate a missing capability or prerequisite and are never counted as passes.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Framework coverage"
            subtitle="Executed checks by framework, as recorded against the version in force at the time of assessment."
            actions={<Link href="/frameworks" className="btn btn-secondary btn-xs">Coverage detail</Link>}
          />
          <CardBody>
            {executive.frameworkCoverage.length ? (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Framework</th>
                      <th className="text-right">Executed</th>
                      <th className="text-right">Failed</th>
                      <th className="text-right">Blocked</th>
                      <th>Effective coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executive.frameworkCoverage.map((row: any) => {
                      const executed = Number(row.executed);
                      const blocked = Number(row.blocked);
                      const effective = executed > 0 ? Math.round(((executed - blocked) / executed) * 100) : 0;
                      return (
                        <tr key={row.framework_key}>
                          <td className="font-medium">{row.framework_key}</td>
                          <td className="text-right font-mono">{executed}</td>
                          <td className="text-right font-mono text-risk-critical">{row.failed}</td>
                          <td className="text-right font-mono text-amber-700">{blocked}</td>
                          <td className="w-40">
                            <Bar value={effective} max={100} tone={effective >= 80 ? 'green' : effective >= 50 ? 'amber' : 'red'} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="No framework results yet" description="Framework coverage appears once an assessment job records test results." />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Remediation performance" subtitle="Tracked against agreed target dates." actions={<Link href="/remediation" className="btn btn-secondary btn-xs">Open</Link>} />
          <CardBody className="space-y-2">
            {[
              ['Plans recorded', executive.remediationPerformance?.total ?? 0, 'neutral'],
              ['Verified by retest', executive.remediationPerformance?.verified ?? 0, 'green'],
              ['Awaiting review', executive.remediationPerformance?.awaiting_review ?? 0, 'amber'],
              ['Past target date', executive.remediationPerformance?.overdue ?? 0, 'red'],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="flex items-center justify-between border-b border-[#eef0f4] pb-1.5 text-xs last:border-b-0">
                <span className="text-[var(--ficap-muted)]">{label}</span>
                <span className={`font-mono font-semibold ${tone === 'red' ? 'text-risk-critical' : tone === 'green' ? 'text-seal-700' : tone === 'amber' ? 'text-amber-700' : 'text-navy-900'}`}>{String(value)}</span>
              </div>
            ))}
            <p className="pt-1 text-2xs leading-relaxed text-[var(--ficap-muted)]">
              A plan is only marked verified after an independent retest confirms the fix. Submissions alone never change a finding status.
            </p>
          </CardBody>
        </Card>
      </div>

      {canDo(ctx, 'institution:portfolio') && executive.portfolio.length ? (
        <Card>
          <CardHeader title="Supervisory portfolio" subtitle="Aggregated position by institution. Cross-institution analytics are restricted to authorised supervisory roles and never disclose one institution's evidence to another." actions={<Link href="/analytics" className="btn btn-secondary btn-xs">Full analytics</Link>} />
          <CardBody>
            <TableWrap maxHeight="360px">
              <table className="table">
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Category</th>
                    <th>Risk tier</th>
                    <th className="text-right">Open</th>
                    <th className="text-right">Critical / High</th>
                  </tr>
                </thead>
                <tbody>
                  {executive.portfolio.map((row: any) => (
                    <tr key={row.institution_id}>
                      <td>
                        <Link href={`/institutions/${row.institution_id}`} className="link">{row.name}</Link>
                      </td>
                      <td className="capitalize">{String(row.category).replace(/_/g, ' ')}</td>
                      <td><Badge tone={row.risk_tier === 'critical' ? 'red' : row.risk_tier === 'high' ? 'red' : row.risk_tier === 'medium' ? 'amber' : row.risk_tier === 'low' ? 'green' : 'neutral'}>{row.risk_tier}</Badge></td>
                      <td className="text-right font-mono">{row.open_findings}</td>
                      <td className="text-right font-mono">{row.critical_high > 0 ? <span className="font-semibold text-risk-critical">{row.critical_high}</span> : '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </CardBody>
        </Card>
      ) : null}

      {canDo(ctx, 'audit:read') && audit.length ? (
        <Card>
          <CardHeader title="Recent audited activity" subtitle="Immutable, hash-chained records. Actor, action, entity and outcome are retained for every operation." actions={<Link href="/audit" className="btn btn-secondary btn-xs">Audit trail</Link>} />
          <CardBody>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((row: any) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap font-mono text-2xs">{formatDate(row.at, true)}</td>
                      <td className="truncate">{row.actor_email ?? 'system'}</td>
                      <td className="font-mono text-2xs">{row.action}</td>
                      <td className="text-2xs text-[var(--ficap-muted)]">{row.entity_type}</td>
                      <td><StatusBadge status={row.outcome === 'success' ? 'passed' : 'failed'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Repeat findings', `${executive.repeatFindings.length}`, 'Identical fingerprints recurring across engagements indicate a systemic control failure rather than an isolated defect.'],
          ['Systemic flags', `${t.systemic_findings ?? 0}`, 'Findings repeated within the same institution are flagged for supervisory follow-up.'],
          ['Reports awaiting decision', `${t.reports_in_review ?? 0}`, 'Reports in review require an approver who did not generate the report.'],
          ['Evidence records', `${technical.evidence?.records ?? 0}`, `${technical.evidence?.redacted ?? 0} records carry automated redactions. Bodies are encrypted and never rendered in the browser as raw data.`],
        ].map(([label, value, hint]) => (
          <StatCard key={label} label={label} value={value} hint={hint} />
        ))}
      </div>
    </div>
  );
}
