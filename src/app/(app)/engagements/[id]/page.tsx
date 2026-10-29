import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { pageContext, query, canDo, flashFrom } from '@/lib/page-context';
import { getEngagementDetail } from '@/lib/domain/engagements';
import { launchEngagementAction, stopEngagementAction, resumeEngagementAction, approveEngagementAction } from '@/app/actions/supervision';
import { CSRF_COOKIE } from '@/lib/db/context';
import { NotFoundError } from '@/lib/errors';
import { METHOD_LABELS } from '@/lib/constants';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataQualityNote,
  DescriptionList,
  EmptyState,
  Flash,
  PageHeader,
  ProgressBar,
  SeverityBadge,
  StatCard,
  StatusBadge,
  TableWrap,
  formatDate,
  relativeDays,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function EngagementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await pageContext('engagement:read');
  const flash = flashFrom(await searchParams);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';

  let data: any;
  try {
    data = await query(ctx, (tx) => getEngagementDetail(tx, ctx, id));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { engagement, institution, assets, exclusions, authorization, applications, plans, jobs, members, findingsSummary, operational, scopeSummary } = data;

  const approvedPlan = plans.find((plan: any) => plan.status === 'approved');
  const currentAuthorization = authorization[0];
  const severityMap: Record<string, number> = {};
  for (const row of findingsSummary) severityMap[row.technical_severity] = Number(row.count);
  const totalFindings = Object.values(severityMap).reduce((a, b) => a + b, 0);
  const runningJobs = jobs.filter((job: any) => ['queued', 'running', 'cancelling'].includes(job.status));
  const canLaunch = canDo(ctx, 'engagement:launch') && engagement.status === 'approved' && Boolean(approvedPlan) && operational.ok;
  const scopeExpired = engagement.scope_expires_at && new Date(engagement.scope_expires_at) < new Date();

  return (
    <div className="space-y-4">
      <PageHeader
        title={engagement.name}
        description={engagement.description ?? 'No description recorded.'}
        meta={
          <>
            <Badge tone="navy">{engagement.code}</Badge>
            <Link href={`/institutions/${institution?.id}`} className="link text-2xs">{institution?.name}</Link>
            <StatusBadge status={engagement.status} />
            {engagement.kill_switch_engaged ? <Badge tone="red">stop engaged</Badge> : null}
            {scopeExpired ? <Badge tone="red">scope expired</Badge> : null}
            <span className="text-2xs text-[var(--ficap-muted)]">scope expires {formatDate(engagement.scope_expires_at)} ({relativeDays(engagement.scope_expires_at)})</span>
          </>
        }
        actions={
          <>
            <Link href={`/engagements/${id}/authorization`} className="btn btn-secondary">Authorisation and scope</Link>
            <Link href={`/engagements/${id}/plan`} className="btn btn-secondary">Test plan</Link>
            <Link href={`/jobs?engagementId=${id}`} className="btn btn-secondary">Jobs</Link>
          </>
        }
      />
      <Flash notice={flash.notice} error={flash.error} />

      <Card>
        <CardHeader
          title="Operational gate"
          subtitle="Evaluated immediately before launch and again before every outbound request."
          actions={<Badge tone={operational.ok ? 'green' : 'red'}>{operational.ok ? 'execution permitted' : 'execution blocked'}</Badge>}
        />
        <CardBody>
          {operational.ok ? (
            <p className="text-xs text-[var(--ficap-text)]">
              Authorisation is active, the scope is in date, the testing window is open, the kill switch is released and an approved plan exists.
              Individual requests are still validated against the asset list below.
            </p>
          ) : (
            <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
              <span className="font-semibold">Blocked: </span>
              {operational.reason}
              <span className="ml-2 font-mono text-2xs opacity-70">{operational.code}</span>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Scope assets" value={assets.length} hint={`${exclusions.length} exclusions · ${scopeSummary.trainingRangeAssets} training range`} />
        <StatCard label="Active jobs" value={runningJobs.length} tone={runningJobs.length ? 'navy' : 'neutral'} hint={`${jobs.length} jobs recorded in total`} />
        <StatCard label="Findings" value={totalFindings} tone="amber" hint={`${(severityMap.critical ?? 0) + (severityMap.high ?? 0)} critical or high`} />
        <StatCard label="Approved plan" value={approvedPlan ? `v${approvedPlan.version}` : 'none'} tone={approvedPlan ? 'green' : 'amber'} hint={approvedPlan ? `approved ${formatDate(approvedPlan.approved_at)}` : 'A plan must be approved before launch'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Engagement record" subtitle="Recorded at creation and changed only through audited actions." />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Institution', value: institution?.name },
                { label: 'Authorisation reference', value: engagement.authorization_ref },
                { label: 'Scope approved', value: formatDate(engagement.scope_approved_at, true) },
                { label: 'Scope expires', value: formatDate(engagement.scope_expires_at) },
                { label: 'Testing window', value: `${formatDate(engagement.testing_window_start, true)} → ${formatDate(engagement.testing_window_end, true)}` },
                { label: 'Emergency contact', value: `${engagement.emergency_contact_name ?? '—'} ${engagement.emergency_contact_phone ?? ''}` },
                { label: 'Escalation', value: engagement.escalation_procedure },
                { label: 'Request limits', value: `${engagement.max_requests_per_second} req/s · ${engagement.max_concurrency} concurrent · ${engagement.max_requests_total} total · ${engagement.max_duration_minutes} min` },
                { label: 'Applications', value: applications.map((app: any) => app.name).join(', ') || '—' },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Execution controls" subtitle="Sensitive operations require confirmation and are written to the audit trail." />
          <CardBody className="space-y-3">
            {engagement.kill_switch_engaged ? (
              <form action={resumeEngagementAction} className="space-y-2">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="engagementId" value={id} />
                <p className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-2xs text-rose-900">
                  Stop engaged: {engagement.kill_switch_reason ?? 'operator action'}
                </p>
                {canDo(ctx, 'engagement:stop') ? <button type="submit" className="btn btn-secondary w-full">Resume after review</button> : null}
              </form>
            ) : canDo(ctx, 'engagement:stop') && !['completed', 'cancelled', 'stopped'].includes(engagement.status) ? (
              <details className="rounded border border-rose-200 bg-rose-50/50 px-2.5 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-rose-900">Stop this engagement</summary>
                <form action={stopEngagementAction} className="mt-2 space-y-2">
                  <input type="hidden" name="_csrf" value={csrf} />
                  <input type="hidden" name="engagementId" value={id} />
                  <label className="label" htmlFor="reason">Reason (recorded)</label>
                  <textarea id="reason" name="reason" required rows={2} className="textarea" placeholder="Why execution must stop now" />
                  <button type="submit" className="btn btn-danger w-full">Engage stop control</button>
                </form>
              </details>
            ) : null}

            {engagement.status === 'draft' && canDo(ctx, 'engagement:authorize') ? (
              <form action={approveEngagementAction} className="space-y-2">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="engagementId" value={id} />
                <p className="prose-note">Authorising confirms the written authorisation is in date and the recorded scope matches it.</p>
                <button type="submit" className="btn btn-primary w-full">Authorise engagement</button>
              </form>
            ) : null}

            {canLaunch ? (
              <form action={launchEngagementAction} className="space-y-2">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="engagementId" value={id} />
                <p className="label">Modules to launch</p>
                {(approvedPlan.modules ?? []).map((module: string) => (
                  <label key={module} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="modules" value={module} defaultChecked className="h-3.5 w-3.5 rounded border-slate-300" />
                    <span className="capitalize">{module}</span>
                  </label>
                ))}
                <button type="submit" className="btn btn-accent w-full">Queue assessment jobs</button>
                <p className="prose-note">
                  Jobs run in the background worker. Blocked checks and missing dependencies are recorded, never reported as passes.
                </p>
              </form>
            ) : (
              <p className="prose-note">
                {engagement.status === 'approved'
                  ? operational.ok
                    ? 'An approved plan is required before jobs can be queued.'
                    : operational.reason
                  : 'Launch becomes available once the engagement is approved and its plan is approved.'}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Approved scope assets" subtitle="The only targets this engagement may contact." actions={<Link href={`/engagements/${id}/authorization`} className="btn btn-secondary btn-xs">Manage scope</Link>} />
        {assets.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Type</th><th>Value</th><th>Paths</th><th>Methods</th><th>Subdomains</th><th>Ownership</th><th>Note</th></tr>
              </thead>
              <tbody>
                {assets.map((asset: any) => (
                  <tr key={asset.id}>
                    <td className="text-2xs uppercase">{String(asset.asset_type).replace(/_/g, ' ')}</td>
                    <td className="font-mono text-2xs">{asset.value}</td>
                    <td className="font-mono text-2xs">{(asset.approved_paths ?? []).join(', ') || (asset.path_prefix ?? 'any')}</td>
                    <td className="font-mono text-2xs">{(asset.allowed_methods ?? []).join(', ')}</td>
                    <td className="text-2xs">{asset.allow_subdomains ? 'yes' : 'no'}</td>
                    <td><Badge tone={asset.ownership_verified ? 'green' : 'amber'}>{asset.ownership_verified ? 'verified' : 'unverified'}</Badge></td>
                    <td className="text-2xs text-[var(--ficap-muted)]">{asset.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><EmptyState title="No scope assets" description="An engagement cannot be authorised without at least one approved asset." /></CardBody>
        )}
        {exclusions.length ? (
          <CardBody className="border-t border-[var(--ficap-border)]">
            <p className="label">Exclusions (always applied)</p>
            <ul className="mt-1 space-y-1 text-xs">
              {exclusions.map((exclusion: any) => (
                <li key={`${exclusion.asset_type}-${exclusion.value}`} className="flex items-start justify-between gap-3">
                  <span className="font-mono text-2xs">{exclusion.value}</span>
                  <span className="text-2xs text-[var(--ficap-muted)]">{exclusion.reason}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        ) : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Authorisation records" subtitle="Only an active, in-date record enables execution." actions={<Link href={`/engagements/${id}/authorization`} className="btn btn-secondary btn-xs">Open</Link>} />
          {authorization.length ? (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Reference</th><th>Valid</th><th>Methods</th><th>Status</th></tr></thead>
                <tbody>
                  {authorization.map((record: any) => (
                    <tr key={record.id}>
                      <td className="font-mono text-2xs">{record.reference}</td>
                      <td className="whitespace-nowrap text-2xs">{formatDate(record.valid_from)} → {formatDate(record.valid_to)}</td>
                      <td className="text-2xs">{(record.permitted_methods ?? []).length} permitted</td>
                      <td><StatusBadge status={record.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody><p className="prose-note">No authorisation record. Execution is blocked.</p></CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Plans and members" subtitle="Plans are versioned; approving a new plan supersedes the previous one." actions={<Link href={`/engagements/${id}/plan`} className="btn btn-secondary btn-xs">Open plan</Link>} />
          <CardBody className="space-y-2">
            {plans.length ? (
              <ul className="space-y-1.5">
                {plans.map((plan: any) => (
                  <li key={plan.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      Plan v{plan.version} · {formatDate(plan.created_at)}
                      <span className="ml-1 text-2xs text-[var(--ficap-muted)]">{(plan.modules ?? []).join(', ')}</span>
                    </span>
                    <StatusBadge status={plan.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="prose-note">No test plan submitted.</p>
            )}
            <div className="border-t border-[var(--ficap-border)] pt-2">
              <p className="label">Assigned personnel</p>
              <ul className="mt-1 space-y-1">
                {members.map((member: any) => (
                  <li key={member.id} className="flex items-center justify-between text-xs">
                    <span>{member.name}</span>
                    <span className="text-2xs text-[var(--ficap-muted)]">{member.role_in_engagement.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Jobs" subtitle="Every job records its checks, blocked capabilities, logs and cancellation state." actions={<Link href={`/jobs?engagementId=${id}`} className="btn btn-secondary btn-xs">Job monitor</Link>} />
        {jobs.length ? (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Module</th><th>Status</th><th>Progress</th><th>Checks</th><th>Started</th><th>Finished</th><th>Detail</th></tr></thead>
              <tbody>
                {jobs.map((job: any) => (
                  <tr key={job.id}>
                    <td className="text-xs capitalize">{job.module}</td>
                    <td><StatusBadge status={job.status} /></td>
                    <td className="w-32"><ProgressBar value={Number(job.progress)} tone={job.status === 'failed' ? 'red' : job.status === 'succeeded' ? 'green' : 'navy'} /></td>
                    <td className="text-2xs">{job.completed_checks}/{job.check_count}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(job.started_at, true)}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(job.finished_at, true)}</td>
                    <td className="max-w-[320px] text-2xs text-[var(--ficap-muted)]">
                      <Link href={`/jobs/${job.id}`} className="link text-2xs">open</Link>
                      {job.error ? <span className="ml-1">{job.error}</span> : job.blocked_reason ? <span className="ml-1">{job.blocked_reason}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><p className="prose-note">No jobs have been queued for this engagement.</p></CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Findings from this engagement" actions={<Link href={`/findings?engagementId=${id}`} className="btn btn-secondary btn-xs">Open explorer</Link>} />
        <CardBody>
          {totalFindings ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(severityMap).map(([severity, count]) => (
                <span key={severity} className="flex items-center gap-2 rounded border border-[var(--ficap-border)] px-2 py-1">
                  <SeverityBadge severity={severity} />
                  <span className="font-mono text-xs">{count}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="prose-note">No findings recorded for this engagement.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Permitted and prohibited activity" subtitle="Applicable to every request and every operator." />
        <CardBody className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="label">Permitted methods</p>
            <ul className="mt-1 space-y-1 text-xs">
              {(engagement.permitted_methods ?? []).map((method: string) => (
                <li key={method}>• {METHOD_LABELS[method] ?? method}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label">Prohibited actions</p>
            <ul className="mt-1 space-y-1 text-xs">
              {(engagement.prohibited_actions ?? []).map((action: string) => (
                <li key={action}>• {action}</li>
              ))}
            </ul>
          </div>
        </CardBody>
      </Card>

      <DataQualityNote>
        Technical severity is CVSS v4.0 and is not adjusted for business impact. Checks that could not run because a capability or prerequisite was
        unavailable are recorded as blocked or not assessed and are excluded from any coverage statement.
      </DataQualityNote>
      {currentAuthorization ? null : null}
    </div>
  );
}
