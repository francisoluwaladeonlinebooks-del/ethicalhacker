import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/ids';
import { cookies } from 'next/headers';
import { pageContext, query, canDo, flashFrom } from '@/lib/page-context';
import { getJob } from '@/lib/domain/jobs';
import { cancelJobAction, retryJobAction } from '@/app/actions/supervision';
import { CSRF_COOKIE } from '@/lib/db/context';
import { NotFoundError } from '@/lib/errors';
import { Badge, Card, CardBody, CardHeader, DataQualityNote, DescriptionList, EmptyState, Flash, PageHeader, ProgressBar, StatCard, StatusBadge, TableWrap, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await pageContext('job:read');
  const flash = flashFrom(await searchParams);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';

  let data: any;
  try {
    data = await query(ctx, (tx) => getJob(tx, id));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { job, events, checks, results, engagement } = data;
  const statusCounts: Record<string, number> = checks.reduce((acc: Record<string, number>, check: any) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, {});
  const active = ['queued', 'running', 'cancelling'].includes(job.status);
  const stats = job.stats ?? {};

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${String(job.module).charAt(0).toUpperCase()}${String(job.module).slice(1)} job`}
        description={`Job ${job.id}`}
        meta={
          <>
            <StatusBadge status={job.status} />
            <Badge tone="navy">{job.module}</Badge>
            <Link href={`/engagements/${engagement?.id}`} className="link text-2xs">{engagement?.code} · {engagement?.name}</Link>
            <span className="text-2xs text-[var(--ficap-muted)]">attempt {job.attempts} of {job.max_attempts}</span>
          </>
        }
        actions={
          <>
            {canDo(ctx, 'job:cancel') && active ? (
              <form action={cancelJobAction}>
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="reason" value="Cancelled by operator from job detail" />
                <button type="submit" className="btn btn-danger">Cancel job</button>
              </form>
            ) : null}
            {canDo(ctx, 'job:retry') && ['failed', 'cancelled', 'blocked'].includes(job.status) ? (
              <form action={retryJobAction}>
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="jobId" value={job.id} />
                <button type="submit" className="btn btn-secondary">Retry job</button>
              </form>
            ) : null}
            <Link href="/jobs" className="btn btn-secondary">All jobs</Link>
          </>
        }
      />
      <Flash notice={flash.notice} error={flash.error} />

      {job.error || job.blocked_reason ? (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">{job.error ? 'Job failed: ' : 'Job blocked: '}</span>
          {job.error ?? job.blocked_reason}
          <span className="mt-1 block text-2xs opacity-80">
            Checks that could not execute are recorded below as blocked or skipped and are excluded from coverage claims.
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Progress" value={`${job.progress}%`} hint={`${checks.length} checks recorded`} />
        <StatCard label="Passed" value={statusCounts.passed ?? 0} tone="green" />
        <StatCard label="Failed / needs verification" value={(statusCounts.failed ?? 0) + (statusCounts.needs_verification ?? 0)} tone="red" />
        <StatCard label="Blocked / error / skipped" value={(statusCounts.blocked ?? 0) + (statusCounts.error ?? 0) + (statusCounts.skipped ?? 0)} tone="amber" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Job record" subtitle="Limits are taken from the engagement and enforced by the request client." />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Engagement', value: engagement?.name },
                { label: 'Status', value: <StatusBadge status={job.status} /> },
                { label: 'Progress', value: <div className="w-48"><ProgressBar value={Number(job.progress)} /></div> },
                { label: 'Started', value: formatDate(job.started_at, true) },
                { label: 'Finished', value: formatDate(job.finished_at, true) },
                { label: 'Request limits', value: `${job.limits?.maxRequestsPerSecond ?? '—'} req/s · ${job.limits?.maxRequestsTotal ?? '—'} total · ${job.limits?.maxDurationMinutes ?? '—'} min` },
                { label: 'Dataset', value: stats.dataset ?? stats.source ?? 'live execution' },
                { label: 'Requests made', value: String(stats.requestsMade ?? stats.requests ?? '—') },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Cancellation" subtitle="Cancellation is cooperative: the worker stops at the next check boundary and records the state." />
          <CardBody className="space-y-2">
            {job.cancel_requested_at ? (
              <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-2xs text-amber-900">
                Cancellation requested {formatDate(job.cancel_requested_at, true)}.
              </p>
            ) : (
              <p className="prose-note">No cancellation requested.</p>
            )}
            <p className="prose-note">
              A cancelled job retains every check recorded before the stop point. Findings already created are not retracted; they must be verified or
              dismissed through the finding lifecycle.
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Check record" subtitle="Per-check outcome with the dependency or scope reason when a check did not execute." />
        {checks.length ? (
          <TableWrap maxHeight="420px">
            <table className="table">
              <thead><tr><th>Check</th><th>Framework item</th><th>Status</th><th>Requests</th><th>Started</th><th>Finished</th><th>Detail</th></tr></thead>
              <tbody>
                {checks.map((check: any) => (
                  <tr key={check.id}>
                    <td className="font-mono text-2xs">{check.check_key}</td>
                    <td className="font-mono text-2xs">{check.framework_item_code ?? '—'}</td>
                    <td><StatusBadge status={check.status} /></td>
                    <td className="text-right font-mono text-2xs">{check.requests_made}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(check.started_at, true)}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(check.finished_at, true)}</td>
                    <td className="max-w-[380px] text-2xs text-[var(--ficap-muted)]">{check.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><EmptyState title="No checks recorded yet" description="Checks are written as the worker executes each item. A queued job has not started." /></CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Event log" subtitle="Append-only execution log, newest last." />
        {events.length ? (
          <CardBody>
            <ol className="space-y-1.5">
              {events.map((event: any) => (
                <li key={event.id} className="flex gap-3 rounded border border-[var(--ficap-border)] bg-[#fbfcfd] px-2.5 py-1.5 text-2xs">
                  <span className="w-16 shrink-0 font-mono text-[10px] text-[var(--ficap-muted)]">#{event.seq}</span>
                  <span className="w-16 shrink-0 font-mono text-[10px] text-[var(--ficap-muted)]">{formatDate(event.created_at, true).slice(11)}</span>
                  <span className={`w-12 shrink-0 font-semibold uppercase ${event.level === 'error' ? 'text-risk-critical' : event.level === 'warn' ? 'text-amber-700' : 'text-navy-700'}`}>{event.level}</span>
                  <span className="flex-1 text-[var(--ficap-text)]">{event.message}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        ) : (
          <CardBody><p className="prose-note">No events recorded.</p></CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Framework results" subtitle="Rows written for each executed check, tied to the framework version in force." />
        {results.length ? (
          <TableWrap maxHeight="360px">
            <table className="table">
              <thead><tr><th>Framework</th><th>Version</th><th>Item</th><th>Status</th><th>Observed</th><th>Executed</th></tr></thead>
              <tbody>
                {results.map((result: any) => (
                  <tr key={result.id}>
                    <td className="text-2xs">{result.framework_key}</td>
                    <td className="font-mono text-2xs">{result.framework_version}</td>
                    <td className="font-mono text-2xs">{result.framework_item_code}</td>
                    <td><StatusBadge status={result.status} /></td>
                    <td className="max-w-[360px] text-2xs text-[var(--ficap-muted)]">{result.observed ?? '—'}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(result.executed_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><p className="prose-note">No framework results recorded for this job.</p></CardBody>
        )}
      </Card>

      <DataQualityNote>
        A job that stopped early does not produce a clean result. Blocked and skipped checks remain visible, count towards the job record and are excluded
        from any coverage percentage shown elsewhere in the platform.
      </DataQualityNote>
    </div>
  );
}
