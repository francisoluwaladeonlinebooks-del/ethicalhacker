import type { Tx } from '@/lib/db/pool';
import { withSystem } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';

export type JobRow = {
  id: string;
  engagement_id: string;
  institution_id: string;
  application_id: string | null;
  plan_id: string | null;
  module: 'web' | 'api' | 'mobile' | 'dependencies' | 'correlation' | 'retest';
  status: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed' | 'blocked';
  progress: number;
  attempts: number;
  max_attempts: number;
  cancel_requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  blocked_reason: string | null;
  config: Record<string, unknown>;
  limits: { maxRequestsPerSecond?: number; maxConcurrency?: number; maxRequestsTotal?: number; maxDurationMinutes?: number };
  stats: Record<string, unknown>;
  created_at: string;
};

export async function listJobs(tx: Tx, ctx: RequestContext, filters: { engagementId?: string; status?: string; institutionId?: string } = {}) {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (filters.engagementId) {
    params.push(filters.engagementId);
    clauses.push(`j.engagement_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`j.status = $${params.length}`);
  }
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`j.institution_id = $${params.length}`);
  }
  return tx.query(
    `SELECT j.*, a.name AS application_name, e.code AS engagement_code, e.name AS engagement_name, i.name AS institution_name,
            (SELECT count(*)::int FROM job_checks c WHERE c.job_id = j.id) AS check_count,
            (SELECT count(*)::int FROM job_checks c WHERE c.job_id = j.id AND c.status IN ('passed','failed','needs_verification')) AS completed_checks,
            (SELECT count(*)::int FROM findings f WHERE f.engagement_id = j.engagement_id AND f.application_id = j.application_id AND f.created_at >= j.created_at) AS finding_count
       FROM assessment_jobs j
       LEFT JOIN applications a ON a.id = j.application_id
       JOIN engagements e ON e.id = j.engagement_id
       JOIN institutions i ON i.id = j.institution_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY j.created_at DESC LIMIT 100`,
    params,
  );
}

export async function getJob(tx: Tx, jobId: string) {
  const job = await tx.queryOne<JobRow>('SELECT * FROM assessment_jobs WHERE id = $1', [jobId]);
  if (!job) throw new NotFoundError('Job not found');
  const events = await tx.query('SELECT * FROM job_events WHERE job_id = $1 ORDER BY seq ASC LIMIT 500', [jobId]);
  const checks = await tx.query('SELECT * FROM job_checks WHERE job_id = $1 ORDER BY started_at NULLS LAST, check_key', [jobId]);
  const results = await tx.query(
    `SELECT tr.*, fi.title AS item_title FROM test_results tr
       LEFT JOIN framework_items fi ON fi.code = tr.framework_item_code
      WHERE tr.job_id = $1 ORDER BY tr.executed_at DESC`,
    [jobId],
  );
  const engagement = await tx.queryOne('SELECT id, code, name, status, institution_id FROM engagements WHERE id = $1', [job.engagement_id]);
  return { job, events, checks, results, engagement };
}

export async function requestCancel(tx: Tx, ctx: RequestContext, jobId: string) {
  if (!can(ctx.user, 'job:cancel')) throw new ForbiddenError('Missing permission: job:cancel');
  const job = await tx.queryOne<JobRow>('SELECT * FROM assessment_jobs WHERE id = $1', [jobId]);
  if (!job) throw new NotFoundError('Job not found');
  if (!['queued', 'running', 'cancelling'].includes(job.status)) throw new ConflictError('Only queued or running jobs can be cancelled');

  if (job.status === 'queued') {
    await tx.query(`UPDATE assessment_jobs SET status = 'cancelled', cancel_requested_at = now(), finished_at = now(), blocked_reason = 'Cancelled by operator' WHERE id = $1`, [jobId]);
  } else {
    await tx.query(`UPDATE assessment_jobs SET status = 'cancelling', cancel_requested_at = now() WHERE id = $1`, [jobId]);
  }
  await appendJobEvent(tx, job.id, job.institution_id, 'warn', 'Cancellation requested by operator', { actor: ctx.user.email });
  await recordAudit(
    {
      action: 'assessment.job_cancelled',
      entityType: 'assessment_job',
      entityId: jobId,
      institutionId: job.institution_id,
      engagementId: job.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { module: job.module, previousStatus: job.status },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function retryJob(tx: Tx, ctx: RequestContext, jobId: string) {
  if (!can(ctx.user, 'job:retry')) throw new ForbiddenError('Missing permission: job:retry');
  const job = await tx.queryOne<JobRow>('SELECT * FROM assessment_jobs WHERE id = $1', [jobId]);
  if (!job) throw new NotFoundError('Job not found');
  if (!['failed', 'cancelled', 'blocked'].includes(job.status)) throw new ConflictError('Only failed, cancelled or blocked jobs can be retried');
  await tx.query(
    `UPDATE assessment_jobs SET status = 'queued', progress = 0, attempts = 0, error = NULL, blocked_reason = NULL,
            started_at = NULL, finished_at = NULL, cancel_requested_at = NULL WHERE id = $1`,
    [jobId],
  );
  await tx.query('DELETE FROM job_checks WHERE job_id = $1', [jobId]);
  await appendJobEvent(tx, job.id, job.institution_id, 'info', 'Job re-queued by operator', { actor: ctx.user.email });
  await recordAudit(
    {
      action: 'assessment.job_retried',
      entityType: 'assessment_job',
      entityId: jobId,
      institutionId: job.institution_id,
      engagementId: job.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function appendJobEvent(tx: Tx, jobId: string, institutionId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) {
  const next = await tx.queryOne<{ seq: string }>('SELECT coalesce(max(seq),0) + 1 AS seq FROM job_events WHERE job_id = $1', [jobId]);
  await tx.query(
    `INSERT INTO job_events (job_id, engagement_id, institution_id, seq, level, message, data)
     SELECT $1, engagement_id, institution_id, $4, $5, $6, $7 FROM assessment_jobs WHERE id = $1`,
    [jobId, null, null, Number(next?.seq ?? 1), level, message, JSON.stringify(data ?? {})],
  );
}

export async function upsertJobCheck(
  tx: Tx,
  input: {
    jobId: string;
    checkKey: string;
    frameworkItemCode?: string | null;
    status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'error' | 'needs_verification';
    detail?: string | null;
    requestsMade?: number;
  },
) {
  const job = await tx.queryOne<{ engagement_id: string; institution_id: string }>('SELECT engagement_id, institution_id FROM assessment_jobs WHERE id = $1', [input.jobId]);
  if (!job) throw new NotFoundError('Job not found');
  const existing = await tx.queryOne<{ id: string }>('SELECT id FROM job_checks WHERE job_id = $1 AND check_key = $2', [input.jobId, input.checkKey]);
  if (existing) {
    await tx.query(
      `UPDATE job_checks SET status = $2, detail = $3, requests_made = requests_made + $4,
              started_at = COALESCE(started_at, now()), finished_at = CASE WHEN $2 IN ('pending','running') THEN NULL ELSE now() END
        WHERE id = $1`,
      [existing.id, input.status, input.detail ?? null, input.requestsMade ?? 0],
    );
  } else {
    await tx.query(
      `INSERT INTO job_checks (job_id, engagement_id, institution_id, check_key, framework_item_code, status, detail, requests_made, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), CASE WHEN $6 IN ('pending','running') THEN NULL ELSE now() END)`,
      [input.jobId, job.engagement_id, job.institution_id, input.checkKey, input.frameworkItemCode ?? null, input.status, input.detail ?? null, input.requestsMade ?? 0],
    );
  }
}

/** Internal worker helpers (privileged; the worker performs its own authorisation gates). */
export async function claimNextJob(): Promise<JobRow | null> {
  return withSystem(async (tx) => {
    const job = await tx.queryOne<JobRow>(
      `SELECT * FROM assessment_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
    );
    if (!job) return null;
    const updated = await tx.queryOne<JobRow>(
      `UPDATE assessment_jobs SET status = 'running', started_at = now(), attempts = attempts + 1 WHERE id = $1 AND status = 'queued' RETURNING *`,
      [job.id],
    );
    if (updated) {
      await appendJobEvent(tx, updated.id, updated.institution_id, 'info', 'Job started', { module: updated.module });
    }
    return updated;
  });
}

export async function isCancellationRequested(jobId: string): Promise<boolean> {
  const row = await withSystem((tx) => tx.queryOne<{ status: string; cancel_requested_at: string | null }>('SELECT status, cancel_requested_at FROM assessment_jobs WHERE id = $1', [jobId]));
  return Boolean(row && (row.cancel_requested_at || row.status === 'cancelling' || row.status === 'cancelled'));
}

export async function finishJob(
  jobId: string,
  input: { status: 'succeeded' | 'failed' | 'cancelled' | 'blocked'; stats?: Record<string, unknown>; error?: string | null; blockedReason?: string | null; progress?: number },
) {
  await withSystem(async (tx) => {
    await tx.query(
      `UPDATE assessment_jobs SET status = $2, finished_at = now(), stats = $3, error = $4, blocked_reason = $5, progress = COALESCE($6, progress) WHERE id = $1`,
      [jobId, input.status, JSON.stringify(input.stats ?? {}), input.error ?? null, input.blockedReason ?? null, input.progress ?? 100],
    );
    await appendJobEvent(tx, jobId, '', input.status === 'succeeded' ? 'info' : 'warn', `Job ${input.status}`, input.stats ?? {});
  });
}

export async function updateJobProgress(jobId: string, progress: number, stats?: Record<string, unknown>) {
  await withSystem((tx) =>
    tx.query(`UPDATE assessment_jobs SET progress = $2, stats = COALESCE($3, stats) WHERE id = $1`, [jobId, progress, stats ? JSON.stringify(stats) : null]),
  );
}

export async function queuedJobCount(): Promise<number> {
  const row = await withSystem((tx) => tx.queryOne<{ count: string }>(`SELECT count(*)::text AS count FROM assessment_jobs WHERE status IN ('queued','running')`));
  return Number(row?.count ?? 0);
}
