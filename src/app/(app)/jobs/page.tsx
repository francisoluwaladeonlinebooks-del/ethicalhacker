import Link from 'next/link';
import { pageContext, query, canDo, flashFrom, param } from '@/lib/page-context';
import { listJobs } from '@/lib/domain/jobs';
import { globalKillSwitchAction } from '@/app/actions/supervision';
import { withSystem } from '@/lib/db/pool';
import { isKillSwitchEngaged } from '@/lib/domain/settings';
import { cookies } from 'next/headers';
import { CSRF_COOKIE } from '@/lib/db/context';
import { Badge, Card, CardBody, CardHeader, EmptyState, Flash, PageHeader, ProgressBar, StatCard, StatusBadge, TableWrap, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUSES = ['queued', 'running', 'cancelling', 'cancelled', 'succeeded', 'failed', 'blocked'];

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('job:read');
  const flash = flashFrom(params);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';
  const status = param(params, 'status') ?? '';
  const engagementId = param(params, 'engagementId') ?? '';

  const jobs = await query(ctx, (tx) => listJobs(tx, ctx, { status, engagementId }));
  const killSwitch = await withSystem((tx) => isKillSwitchEngaged(tx));

  const counts = STATUSES.reduce<Record<string, number>>((acc, key) => {
    acc[key] = jobs.filter((job: any) => job.status === key).length;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <PageHeader
        title="Job monitor"
        description="Background assessment jobs with their progress, per-check outcomes, logs and cancellation state. A job never starts a check that is out of scope, outside the testing window, or unauthorised."
        meta={
          <>
            <Badge tone={killSwitch ? 'red' : 'green'}>{killSwitch ? 'global kill switch engaged' : 'execution enabled'}</Badge>
            <span className="text-2xs text-[var(--ficap-muted)]">Worker cycle: 1.5 s · jobs are claimed one at a time by the embedded PostgreSQL queue</span>
          </>
        }
        actions={
          canDo(ctx, 'engagement:stop') ? (
            <form action={globalKillSwitchAction}>
              <input type="hidden" name="_csrf" value={csrf} />
              <input type="hidden" name="engaged" value={killSwitch ? 'false' : 'true'} />
              <input type="hidden" name="reason" value={killSwitch ? 'Released from job monitor' : 'Engaged from job monitor'} />
              <button type="submit" className={`btn ${killSwitch ? 'btn-secondary' : 'btn-danger'}`}>
                {killSwitch ? 'Release global kill switch' : 'Engage global kill switch'}
              </button>
            </form>
          ) : null
        }
      />
      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queued" value={counts.queued ?? 0} tone="slate" />
        <StatCard label="Running" value={(counts.running ?? 0) + (counts.cancelling ?? 0)} tone="navy" />
        <StatCard label="Succeeded" value={counts.succeeded ?? 0} tone="green" />
        <StatCard label="Failed / blocked" value={(counts.failed ?? 0) + (counts.blocked ?? 0)} tone="red" hint="Failures record the dependency that was missing" />
      </div>

      <Card>
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <label className="label" htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={status} className="select mt-1">
                <option value="">All statuses</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            {engagementId ? <input type="hidden" name="engagementId" value={engagementId} /> : null}
            <button type="submit" className="btn btn-primary">Apply</button>
            <Link href="/jobs" className="btn btn-secondary">Reset</Link>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`${jobs.length} job${jobs.length === 1 ? '' : 's'}`} subtitle="Most recent first. Open a job for its event log and check record." />
        {jobs.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Engagement</th>
                  <th>Application</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Checks</th>
                  <th>Findings</th>
                  <th>Created</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job: any) => (
                  <tr key={job.id}>
                    <td>
                      <Link href={`/jobs/${job.id}`} className="link font-mono text-2xs">{String(job.id).slice(0, 8)}</Link>
                      <p className="text-2xs capitalize text-[var(--ficap-muted)]">{job.module}</p>
                    </td>
                    <td className="text-2xs">{job.engagement_code}</td>
                    <td className="text-xs">{job.application_name ?? '—'}</td>
                    <td><StatusBadge status={job.status} /></td>
                    <td className="w-32"><ProgressBar value={Number(job.progress)} tone={job.status === 'failed' ? 'red' : job.status === 'succeeded' ? 'green' : 'navy'} /></td>
                    <td className="text-2xs">{job.completed_checks}/{job.check_count}</td>
                    <td className="text-right font-mono text-2xs">{job.finding_count}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(job.created_at, true)}</td>
                    <td className="max-w-[280px] text-2xs text-[var(--ficap-muted)]">{job.error ?? job.blocked_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState
              title="No jobs recorded"
              description="Jobs appear here once an approved engagement is launched. Nothing runs automatically without an authorised engagement and an approved plan."
              action={<Link href="/engagements" className="btn btn-primary">Open engagements</Link>}
            />
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Engine dependencies" subtitle="A missing dependency is surfaced as a blocked or failed check, never as a pass." actions={<Link href="/admin/engines" className="btn btn-secondary btn-xs">Engine health</Link>} />
        <CardBody>
          <p className="prose-note">
            Dynamic mobile testing requires an approved device farm and an instrumented build; vulnerability intelligence requires a dated snapshot.
            When either is absent the affected checks are recorded as blocked with the reason attached to the job.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
