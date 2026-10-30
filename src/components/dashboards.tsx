import Link from 'next/link';
import type { RequestContext } from '@/lib/db/context';
import { query } from '@/lib/page-context';
import {
  adminDashboard,
  approverDashboard,
  assessorDashboard,
  contactDashboard,
  reviewerDashboard,
} from '@/lib/domain/dashboard';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataQualityNote,
  EmptyState,
  PageHeader,
  SeverityBadge,
  StatCard,
  StatusBadge,
  TableWrap,
  formatDate,
  relativeDays,
} from '@/components/ui';

/**
 * The five persona dashboards.
 *
 * Each one answers a single question for the person looking at it — what is in
 * my queue, and what needs a decision from me — rather than presenting a shared
 * executive summary that only makes sense to one role. The figures come from
 * `src/lib/domain/dashboard.ts`, which keeps every count a count of records the
 * role is permitted to open.
 */

function SignedInAs({ ctx }: { ctx: RequestContext }) {
  return (
    <span className="text-2xs text-[var(--ficap-muted)]">
      Signed in as {ctx.user.name} · {ctx.user.role.replace(/_/g, ' ')}
    </span>
  );
}

function ModeBadge({ ctx }: { ctx: RequestContext }) {
  return (
    <Badge tone={ctx.mode === 'demo' ? 'amber' : 'green'}>
      {ctx.mode === 'demo' ? 'Synthetic demonstration data' : 'Live supervisory data'}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* CBN assessor                                                                */
/* -------------------------------------------------------------------------- */

export async function AssessorDashboard({ ctx }: { ctx: RequestContext }) {
  const data = await query(ctx, (tx) => assessorDashboard(tx, ctx));
  const c = data.counts;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Assessor workspace${ctx.mode === 'demo' ? ' — demonstration estate' : ''}`}
        description="Your engagements, plans and findings. Nothing runs until an engagement is authorised and its test plan is approved by a second person."
        meta={<><ModeBadge ctx={ctx} /><SignedInAs ctx={ctx} /></>}
        actions={
          <>
            <Link href="/engagements/new" className="btn btn-primary">New engagement</Link>
            <Link href="/findings" className="btn btn-secondary">Findings explorer</Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Awaiting authorisation" value={c.awaiting_authorisation ?? 0} tone={Number(c.awaiting_authorisation) ? 'amber' : 'neutral'} hint="Engagements that cannot run yet" href="/engagements" />
        <StatCard label="Plans awaiting approval" value={c.plans_awaiting_approval ?? 0} tone={Number(c.plans_awaiting_approval) ? 'amber' : 'neutral'} hint="Needs a second approver" href="/plans" />
        <StatCard label="Findings to verify" value={c.findings_to_verify ?? 0} tone={Number(c.findings_to_verify) ? 'red' : 'neutral'} hint="Suspected, not yet confirmed" href="/findings?status=needs_verification" />
        <StatCard label="Findings unscored" value={c.findings_unscored ?? 0} tone={Number(c.findings_unscored) ? 'amber' : 'neutral'} hint="No CVSS v4.0 vector recorded" href="/findings" />
        <StatCard label="Retests to verify" value={c.retests_to_verify ?? 0} tone={Number(c.retests_to_verify) ? 'navy' : 'neutral'} hint="Completed, awaiting your check" href="/retesting" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Your work queue"
            subtitle="Active engagements, newest activity first."
            actions={<Link href="/engagements" className="btn btn-secondary btn-xs">All engagements</Link>}
          />
          <CardBody className="space-y-2">
            {data.engagements.length ? (
              data.engagements.map((row: any) => (
                <div key={row.id} className="rounded border border-[var(--ficap-border)] px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/engagements/${row.id}`} className="link truncate text-xs">{row.name}</Link>
                      <p className="mt-0.5 truncate text-2xs text-[var(--ficap-muted)]">{row.code} · {row.institution_name}</p>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-[var(--ficap-muted)]">
                    <span>{row.scope_assets} scope assets</span><span>·</span>
                    <span>{row.findings} findings</span><span>·</span>
                    <span>{row.active_jobs} running</span><span>·</span>
                    <span>scope {relativeDays(row.scope_expires_at)}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No active engagements"
                description="Create an engagement to record institution authorisation, scope and the approved test plan before any assessment activity."
                action={<Link href="/engagements/new" className="btn btn-primary btn-xs">New engagement</Link>}
              />
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Plans awaiting approval" subtitle="A plan needs approval by someone other than its author." />
            <CardBody className="space-y-2">
              {data.plans.length ? (
                data.plans.map((row: any) => (
                  <div key={row.id} className="rounded border border-amber-200 bg-amber-50/50 px-2.5 py-2">
                    <Link href={`/engagements/${row.engagement_id}/plan`} className="link text-xs">{row.name}</Link>
                    <p className="mt-0.5 text-2xs text-[var(--ficap-muted)]">
                      v{row.version} · {row.institution_name} · created {relativeDays(row.created_at)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="prose-note">No plan is waiting for approval.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Execution" subtitle="Queued, running and recently finished jobs." actions={<Link href="/jobs" className="btn btn-secondary btn-xs">Monitor</Link>} />
            <CardBody className="space-y-1.5">
              {data.jobs.length ? (
                data.jobs.map((row: any) => (
                  <div key={row.id} className="flex items-center justify-between gap-2 text-2xs">
                    <Link href={`/jobs/${row.id}`} className="link truncate">{row.module} · {row.engagement_code}</Link>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {row.status === 'running' ? <span className="font-mono text-[var(--ficap-muted)]">{row.progress}%</span> : null}
                      <StatusBadge status={row.status} />
                    </span>
                  </div>
                ))
              ) : (
                <p className="prose-note">No assessment jobs recorded.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Findings awaiting verification"
          subtitle="A suspected issue is not a confirmed deficiency until a second authorised person verifies it."
          actions={<Link href="/findings?status=needs_verification" className="btn btn-secondary btn-xs">Open queue</Link>}
        />
        <CardBody>
          {data.findings.length ? (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Reference</th><th>Title</th><th>Institution</th><th>Severity</th><th>Age</th></tr>
                </thead>
                <tbody>
                  {data.findings.map((row: any) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap font-mono text-2xs">{row.reference}</td>
                      <td className="max-w-[22rem] truncate"><Link href={`/findings/${row.id}`} className="link">{row.title}</Link></td>
                      <td className="truncate text-2xs text-[var(--ficap-muted)]">{row.institution_name}</td>
                      <td><SeverityBadge severity={row.technical_severity} /></td>
                      <td className="whitespace-nowrap text-2xs text-[var(--ficap-muted)]">{relativeDays(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState title="Nothing awaiting verification" description="Every recorded finding has been through independent verification." />
          )}
          <DataQualityNote>
            {c.open_findings ?? 0} findings are open across the estate you can see.
            {' '}{c.jobs_active ?? 0} assessment jobs are queued or running. Blocked checks are never counted as passes.
          </DataQualityNote>
        </CardBody>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Supervisory reviewer                                                        */
/* -------------------------------------------------------------------------- */

export async function ReviewerDashboard({ ctx }: { ctx: RequestContext }) {
  const data = await query(ctx, (tx) => reviewerDashboard(tx, ctx));
  const c = data.counts;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Supervisory review${ctx.mode === 'demo' ? ' — demonstration estate' : ''}`}
        description="Portfolio position, reports awaiting review and remediation that has fallen past its agreed date. Figures cover only institutions you are authorised to see."
        meta={<><ModeBadge ctx={ctx} /><SignedInAs ctx={ctx} /></>}
        actions={
          <>
            <Link href="/analytics" className="btn btn-secondary">Portfolio analytics</Link>
            <Link href="/reports" className="btn btn-primary">Reports</Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Reports awaiting review" value={c.reports_in_review ?? 0} tone={Number(c.reports_in_review) ? 'amber' : 'neutral'} hint="Submitted for supervisory review" href="/reports" />
        <StatCard label="Critical / high open" value={c.critical_high_open ?? 0} tone={Number(c.critical_high_open) ? 'red' : 'green'} hint="CVSS v4.0 base severity" href="/findings?severity=critical" />
        <StatCard label="Findings past due date" value={c.findings_overdue ?? 0} tone={Number(c.findings_overdue) ? 'red' : 'green'} hint="Remediation date elapsed" href="/remediation" />
        <StatCard label="Remediation plans overdue" value={c.plans_overdue ?? 0} tone={Number(c.plans_overdue) ? 'amber' : 'green'} hint="Past the agreed target date" href="/remediation" />
        <StatCard label="Registry to re-verify" value={c.registry_stale ?? 0} tone={Number(c.registry_stale) ? 'amber' : 'green'} hint="Verification window elapsed" href="/registry?stale=1" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Supervisory portfolio"
            subtitle="Open position by institution. Cross-institution aggregates never disclose one institution's evidence to another."
            actions={<Link href="/analytics" className="btn btn-secondary btn-xs">Full analytics</Link>}
          />
          <CardBody>
            {data.portfolio.length ? (
              <TableWrap maxHeight="380px">
                <table className="table">
                  <thead>
                    <tr><th>Institution</th><th>Category</th><th>Risk tier</th><th className="text-right">Open</th><th className="text-right">Critical / high</th></tr>
                  </thead>
                  <tbody>
                    {data.portfolio.map((row: any) => (
                      <tr key={row.id}>
                        <td><Link href={`/institutions/${row.id}`} className="link">{row.name}</Link></td>
                        <td className="capitalize text-2xs">{String(row.category).replace(/_/g, ' ')}</td>
                        <td>
                          <Badge tone={row.risk_tier === 'critical' || row.risk_tier === 'high' ? 'red' : row.risk_tier === 'medium' ? 'amber' : row.risk_tier === 'low' ? 'green' : 'neutral'}>
                            {row.risk_tier ?? 'unrated'}
                          </Badge>
                        </td>
                        <td className="text-right font-mono">{row.open_findings}</td>
                        <td className="text-right font-mono">{Number(row.critical_high) > 0 ? <span className="font-semibold text-risk-critical">{row.critical_high}</span> : '0'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="No institutions in scope" description="Portfolio figures appear once institution records exist in this data mode." />
            )}
            <DataQualityNote>
              {c.systemic ?? 0} findings are flagged as systemic across the portfolio. A systemic flag means the same control failed more than once, not that every instance has been confirmed.
            </DataQualityNote>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Reports awaiting review" subtitle="Oldest first." actions={<Link href="/reports?status=in_review" className="btn btn-secondary btn-xs">Open</Link>} />
            <CardBody className="space-y-2">
              {data.reports.length ? (
                data.reports.map((row: any) => (
                  <div key={row.id} className="rounded border border-[var(--ficap-border)] px-2.5 py-2">
                    <Link href={`/reports/${row.id}`} className="link text-xs">{row.title}</Link>
                    <p className="mt-0.5 text-2xs text-[var(--ficap-muted)]">
                      {row.institution_name} · generated {relativeDays(row.generated_at)} by {row.generated_by_name ?? 'unknown'}
                    </p>
                  </div>
                ))
              ) : (
                <p className="prose-note">No report is awaiting review.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Registry records to re-verify" subtitle="The verification window for these records has elapsed." actions={<Link href="/registry?stale=1" className="btn btn-secondary btn-xs">Open</Link>} />
            <CardBody className="space-y-1.5">
              {data.stale.length ? (
                data.stale.map((row: any) => (
                  <div key={row.id} className="text-2xs">
                    <Link href={`/registry/${row.id}`} className="link">{row.name}</Link>
                    <p className="text-[var(--ficap-muted)]">
                      {row.last_verified_at ? `last verified ${formatDate(row.last_verified_at)}` : 'never verified'}
                      {row.source_name ? ` · source ${row.source_name}` : ''}
                    </p>
                  </div>
                ))
              ) : (
                <p className="prose-note">Every registry record is inside its verification window.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Independent report approver                                                 */
/* -------------------------------------------------------------------------- */

export async function ApproverDashboard({ ctx }: { ctx: RequestContext }) {
  const data = await query(ctx, (tx) => approverDashboard(tx, ctx));
  const c = data.counts;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Independent approval${ctx.mode === 'demo' ? ' — demonstration estate' : ''}`}
        description="Your role is to test whether the evidence supports the conclusion. Approval requires a substantive comment and is refused to the person who generated the report."
        meta={<><ModeBadge ctx={ctx} /><SignedInAs ctx={ctx} /></>}
        actions={<Link href="/reports" className="btn btn-secondary">Report library</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting your approval" value={c.awaiting_my_approval ?? 0} tone={Number(c.awaiting_my_approval) ? 'amber' : 'neutral'} hint="Submitted by another user" href="/reports?status=in_review" />
        <StatCard label="Authored by you" value={c.authored_by_me ?? 0} tone={Number(c.authored_by_me) ? 'red' : 'neutral'} hint="You cannot approve these" href="/reports?status=in_review" />
        <StatCard label="Approved by you" value={c.approved_by_me ?? 0} tone="green" hint="Cleared for supervisory use" href="/reports" />
        <StatCard label="Returned for revision" value={c.returned_total ?? 0} tone={Number(c.returned_total) ? 'amber' : 'neutral'} hint="Decisions recorded in the trail" href="/reports" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Approval queue"
            subtitle="Oldest submission first. A report you generated is marked so and cannot be approved by you."
            actions={<Link href="/reports" className="btn btn-secondary btn-xs">All reports</Link>}
          />
          <CardBody>
            {data.queue.length ? (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr><th>Report</th><th>Institution</th><th>Type</th><th>Generated</th><th>Author</th></tr>
                  </thead>
                  <tbody>
                    {data.queue.map((row: any) => (
                      <tr key={row.id}>
                        <td className="max-w-[20rem]">
                          <Link href={`/reports/${row.id}`} className="link truncate">{row.title}</Link>
                          <p className="text-2xs text-[var(--ficap-muted)]">v{row.version} · {row.confidentiality ?? 'standard'} · {row.prior_reviews} prior decision(s)</p>
                        </td>
                        <td className="truncate text-2xs text-[var(--ficap-muted)]">{row.institution_name}</td>
                        <td className="whitespace-nowrap text-2xs capitalize">{String(row.report_type).replace(/_/g, ' ')}</td>
                        <td className="whitespace-nowrap text-2xs text-[var(--ficap-muted)]">{relativeDays(row.generated_at)}</td>
                        <td className="whitespace-nowrap text-2xs">
                          {row.authored_by_me
                            ? <Badge tone="red">you — cannot approve</Badge>
                            : <span className="text-[var(--ficap-muted)]">{row.generated_by_name ?? 'unknown'}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Nothing awaiting approval" description="Reports submitted for review will appear here." />
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Recent decisions" subtitle="Approval and return decisions across the estate." />
            <CardBody className="space-y-2">
              {data.decisions.length ? (
                data.decisions.map((row: any) => (
                  <div key={row.id} className="rounded border border-[var(--ficap-border)] px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="badge badge-neutral">{row.decision}</span>
                      <span className="text-2xs text-[var(--ficap-muted)]">{relativeDays(row.created_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-2xs text-[var(--ficap-muted)]">{row.title} · {row.reviewer_name ?? 'unknown'}</p>
                  </div>
                ))
              ) : (
                <p className="prose-note">No approval decisions recorded yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What approval means here" />
            <CardBody>
              <ul className="space-y-1.5 text-2xs leading-relaxed text-[var(--ficap-muted)]">
                <li>· The report is a frozen snapshot; approving it approves exactly that snapshot.</li>
                <li>· A substantive comment is required for every decision.</li>
                <li>· You cannot approve a report you generated — the server refuses it as well as hiding the button.</li>
                <li>· Approving does not publish; publication is a separate, audited action.</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Institution contact                                                         */
/* -------------------------------------------------------------------------- */

export async function ContactDashboard({ ctx }: { ctx: RequestContext }) {
  const data = await query(ctx, (tx) => contactDashboard(tx, ctx));
  const c = data.counts;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Your institution${ctx.mode === 'demo' ? ' — demonstration estate' : ''}`}
        description="Only records explicitly shared with your institution are visible here. Confidential supervisory evidence, internal notes and other institutions' records are not shown."
        meta={
          <>
            <ModeBadge ctx={ctx} />
            {data.institution ? <Badge tone="navy">{data.institution.name}</Badge> : null}
            <SignedInAs ctx={ctx} />
          </>
        }
        actions={<Link href="/remediation" className="btn btn-primary">Remediation</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open confirmed findings" value={c.open_confirmed ?? 0} tone={Number(c.open_confirmed) ? 'amber' : 'green'} hint="Confirmed by the assessor" href="/findings" />
        <StatCard label="Past due date" value={c.findings_overdue ?? 0} tone={Number(c.findings_overdue) ? 'red' : 'green'} hint="Remediation date elapsed" href="/remediation" />
        <StatCard label="Submissions needing information" value={c.submissions_needing_info ?? 0} tone={Number(c.submissions_needing_info) ? 'amber' : 'neutral'} hint="The assessor asked for detail" href="/remediation" />
        <StatCard label="Retests pending" value={c.retests_pending ?? 0} tone={Number(c.retests_pending) ? 'navy' : 'neutral'} hint="Requested or in progress" href="/retesting" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Findings shared with you"
            subtitle="Confirmed findings and later lifecycle states. Unverified assessor observations stay internal until confirmed."
            actions={<Link href="/findings" className="btn btn-secondary btn-xs">All findings</Link>}
          />
          <CardBody>
            {data.findings.length ? (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr><th>Reference</th><th>Title</th><th>Severity</th><th>Status</th><th>Due</th></tr>
                  </thead>
                  <tbody>
                    {data.findings.map((row: any) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap font-mono text-2xs">{row.reference}</td>
                        <td className="max-w-[18rem]">
                          <Link href={`/findings/${row.id}`} className="link truncate">{row.title}</Link>
                          {row.application_name ? <p className="text-2xs text-[var(--ficap-muted)]">{row.application_name}</p> : null}
                        </td>
                        <td><SeverityBadge severity={row.technical_severity} /></td>
                        <td><StatusBadge status={row.status} /></td>
                        <td className="whitespace-nowrap text-2xs text-[var(--ficap-muted)]">{row.due_date ? formatDate(row.due_date) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="No findings shared yet" description="Findings appear here once the assessor confirms them for your institution." />
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Evidence shared with you" subtitle="Confidential supervisory evidence is never included." actions={<Link href="/evidence" className="btn btn-secondary btn-xs">Register</Link>} />
            <CardBody className="space-y-1.5">
              {data.evidence.length ? (
                data.evidence.map((row: any) => (
                  <div key={row.id} className="text-2xs">
                    <Link href="/evidence" className="link truncate">{row.title}</Link>
                    <p className="text-[var(--ficap-muted)]">
                      {row.kind} · shared {relativeDays(row.created_at)}{row.redacted ? ' · redacted' : ''}
                    </p>
                  </div>
                ))
              ) : (
                <p className="prose-note">No evidence has been released to your institution.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your submissions" subtitle="Responses you have sent for assessor review." />
            <CardBody className="space-y-1.5">
              {data.submissions.length ? (
                data.submissions.map((row: any) => (
                  <div key={row.id} className="text-2xs">
                    <Link href="/remediation" className="link">{row.reference}</Link>
                    <p className="text-[var(--ficap-muted)]">{row.status.replace(/_/g, ' ')} · {relativeDays(row.created_at)}</p>
                  </div>
                ))
              ) : (
                <p className="prose-note">You have not submitted remediation evidence yet.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <DataQualityNote>
        Signed in as the nominated contact for {data.institution ? data.institution.name : 'your institution'}. Row level security confines every query in
        this workspace to that institution; the filters above are a convenience, not the control.
      </DataQualityNote>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Platform administrator                                                      */
/* -------------------------------------------------------------------------- */

export async function AdminDashboard({ ctx }: { ctx: RequestContext }) {
  const data = await query(ctx, (tx) => adminDashboard(tx, ctx));
  const c = data.counts;
  const killSwitch = data.settings.global_kill_switch === true;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Platform operations${ctx.mode === 'demo' ? ' — demonstration estate' : ''}`}
        description="Accounts, sessions, engines and catalogue state. Administrative visibility deliberately excludes findings and evidence: reading institution data requires a separate, time-boxed access grant."
        meta={<><ModeBadge ctx={ctx} /><SignedInAs ctx={ctx} /></>}
        actions={
          <>
            <Link href="/admin/users" className="btn btn-primary">Users and roles</Link>
            <Link href="/audit" className="btn btn-secondary">Audit trail</Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Active accounts" value={c.active_users ?? 0} hint={`${c.signed_in_7d ?? 0} signed in during the last 7 days`} href="/admin/users" />
        <StatCard label="Live sessions" value={c.live_sessions ?? 0} tone="navy" hint="Server-side session records" href="/admin/users" />
        <StatCard label="Engines not enabled" value={c.engines_not_enabled ?? 0} tone={Number(c.engines_not_enabled) ? 'amber' : 'green'} hint="Unavailable capability is stated, never assumed" href="/admin/engines" />
        <StatCard label="Access grants active" value={c.active_grants ?? 0} tone={Number(c.active_grants) ? 'amber' : 'neutral'} hint="Time-boxed grants to institution data" href="/admin/verification" />
        <StatCard label="Audit events (24h)" value={c.audit_events_24h ?? 0} hint="Append-only, hash chained" href="/audit" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Engine health"
            subtitle="An engine that is disabled or reporting a fault cannot produce an assessment result."
            actions={<Link href="/admin/engines" className="btn btn-secondary btn-xs">Configure</Link>}
          />
          <CardBody>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Engine</th><th>Version</th><th>Status</th><th className="text-right">Running</th><th className="text-right">Failed</th><th>Last check</th></tr>
                </thead>
                <tbody>
                  {data.engines.map((row: any) => (
                    <tr key={row.key}>
                      <td className="font-medium">{row.name}</td>
                      <td className="font-mono text-2xs">{row.version ?? '—'}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="text-right font-mono">{row.running_jobs}</td>
                      <td className="text-right font-mono">{Number(row.failed_jobs) > 0 ? <span className="text-risk-critical">{row.failed_jobs}</span> : '0'}</td>
                      <td className="whitespace-nowrap text-2xs text-[var(--ficap-muted)]">{row.last_health_check ? relativeDays(row.last_health_check) : 'never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Platform safeguards" subtitle="Current switch and enforcement settings." />
            <CardBody className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between border-b border-[#eef0f4] pb-1.5">
                <span className="text-[var(--ficap-muted)]">Global kill switch</span>
                <Badge tone={killSwitch ? 'red' : 'green'}>{killSwitch ? 'engaged' : 'released'}</Badge>
              </div>
              <div className="flex items-center justify-between border-b border-[#eef0f4] pb-1.5">
                <span className="text-[var(--ficap-muted)]">Data mode</span>
                <Badge tone={data.settings.platform_mode === 'live' ? 'navy' : 'amber'}>{String(data.settings.platform_mode ?? ctx.mode)}</Badge>
              </div>
              <div className="flex items-center justify-between border-b border-[#eef0f4] pb-1.5">
                <span className="text-[var(--ficap-muted)]">Independent verification</span>
                <Badge tone={data.settings.require_independent_verification === false ? 'red' : 'green'}>
                  {data.settings.require_independent_verification === false ? 'not enforced' : 'required'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ficap-muted)]">Catalogues unverified</span>
                <Badge tone={Number(c.catalogues_unverified) ? 'amber' : 'green'}>{c.catalogues_unverified ?? 0}</Badge>
              </div>
              <p className="pt-1 text-2xs leading-relaxed text-[var(--ficap-muted)]">
                A catalogue that has not been verified against its official source is shown as unverified wherever it is used.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Live sessions" subtitle="Every session is server side and revocable." />
            <CardBody className="space-y-1.5">
              {data.sessions.length ? (
                data.sessions.map((row: any) => (
                  <div key={row.id} className="text-2xs">
                    <p className="truncate text-navy-800">{row.name} <span className="text-[var(--ficap-muted)]">· {row.role.replace(/_/g, ' ')}</span></p>
                    <p className="text-[var(--ficap-muted)]">
                      {row.mfa_verified ? 'MFA verified' : 'MFA pending'} · {row.ip ?? 'unknown ip'} · started {relativeDays(row.created_at)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="prose-note">No live sessions.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Recent audited activity"
          subtitle="Actor, action, entity and outcome are retained for every operation."
          actions={<Link href="/audit" className="btn btn-secondary btn-xs">Full trail</Link>}
        />
        <CardBody>
          <TableWrap>
            <table className="table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Outcome</th></tr></thead>
              <tbody>
                {data.audit.map((row: any) => (
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
          <DataQualityNote>
            Administrative figures never include findings, evidence bodies or assessment results. This account holds no reading right to institution
            material unless a separate, time-boxed access grant has been recorded.
          </DataQualityNote>
        </CardBody>
      </Card>
    </div>
  );
}
