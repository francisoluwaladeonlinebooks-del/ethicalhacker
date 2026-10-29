import type { Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';

export async function listRemediation(tx: Tx, ctx: RequestContext, filters: { institutionId?: string; status?: string } = {}) {
  const params: unknown[] = [ctx.mode];
  const clauses = ['f.data_mode = $1'];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`f.institution_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`rp.status = $${params.length}`);
  }
  return tx.query(
    `SELECT rp.*, f.reference AS finding_reference, f.title, f.technical_severity, f.status AS finding_status,
            f.asset, f.contextual_rating, f.priority_rank, i.name AS institution_name, a.name AS application_name,
            (SELECT count(*)::int FROM remediation_submissions s WHERE s.plan_id = rp.id) AS submission_count,
            (rp.target_date < current_date AND rp.status NOT IN ('verified','closed')) AS overdue
       FROM remediation_plans rp
       JOIN findings f ON f.id = rp.finding_id
       JOIN institutions i ON i.id = rp.institution_id
       LEFT JOIN applications a ON a.id = f.application_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY overdue DESC, f.priority_rank ASC, rp.target_date ASC NULLS LAST
      LIMIT 200`,
    params,
  );
}

export async function updatePlan(
  tx: Tx,
  ctx: RequestContext,
  planId: string,
  patch: Partial<{
    root_cause: string;
    containment: string;
    short_term: string;
    permanent_fix: string;
    owner_team: string;
    verification_criteria: string;
    retest_procedure: string;
    evidence_required: string;
    priority: string;
    target_date: string;
    status: string;
  }>,
) {
  if (!can(ctx.user, 'finding:update')) throw new ForbiddenError('Missing permission: finding:update');
  const plan = await tx.queryOne<any>('SELECT * FROM remediation_plans WHERE id = $1', [planId]);
  if (!plan) throw new NotFoundError('Remediation plan not found');
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (!entries.length) return plan;
  const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ');
  await tx.query(`UPDATE remediation_plans SET ${assignments}, updated_at = now() WHERE id = $1`, [planId, ...entries.map(([, value]) => value)]);
  await recordAudit(
    {
      action: 'remediation.plan_updated',
      entityType: 'remediation_plan',
      entityId: planId,
      institutionId: plan.institution_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { fields: Object.keys(patch) },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { ...plan, ...patch };
}

export async function submitRemediation(
  tx: Tx,
  ctx: RequestContext,
  input: { planId: string; notes: string; evidenceId?: string | null },
) {
  if (!can(ctx.user, 'remediation:submit')) throw new ForbiddenError('Missing permission: remediation:submit');
  if (!input.notes?.trim()) throw new ValidationError('Describe the remediation performed');
  const plan = await tx.queryOne<any>('SELECT * FROM remediation_plans WHERE id = $1', [input.planId]);
  if (!plan) throw new NotFoundError('Remediation plan not found');
  if (ctx.user.role === 'institution_contact' && ctx.user.institution_id !== plan.institution_id) {
    throw new ForbiddenError('You can only submit remediation for your own institution');
  }
  const submission = await tx.queryOne<{ id: string }>(
    `INSERT INTO remediation_submissions (plan_id, finding_id, institution_id, submitted_by, notes, evidence_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [plan.id, plan.finding_id, plan.institution_id, ctx.user.id, input.notes.trim(), input.evidenceId ?? null],
  );
  await tx.query(`UPDATE remediation_plans SET status = 'submitted', updated_at = now() WHERE id = $1`, [plan.id]);
  await tx.query(`UPDATE findings SET status = 'ready_for_retest', updated_at = now() WHERE id = $1 AND status IN ('confirmed','remediation_in_progress')`, [plan.finding_id]);
  await tx.query(
    `INSERT INTO finding_history (finding_id, institution_id, actor_id, action, note) VALUES ($1,$2,$3,'remediation_submitted',$4)`,
    [plan.finding_id, plan.institution_id, ctx.user.id, input.notes.slice(0, 500)],
  );
  await recordAudit(
    {
      action: 'remediation.submitted',
      entityType: 'remediation_plan',
      entityId: plan.id,
      institutionId: plan.institution_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { findingId: plan.finding_id, evidenceId: input.evidenceId ?? null },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return submission;
}

export async function reviewSubmission(
  tx: Tx,
  ctx: RequestContext,
  input: { submissionId: string; decision: 'accepted' | 'rejected' | 'needs_info'; note?: string },
) {
  if (!can(ctx.user, 'remediation:review')) throw new ForbiddenError('Missing permission: remediation:review');
  const submission = await tx.queryOne<any>('SELECT * FROM remediation_submissions WHERE id = $1', [input.submissionId]);
  if (!submission) throw new NotFoundError('Submission not found');
  if (submission.submitted_by === ctx.user.id) throw new ForbiddenError('You cannot review a remediation submission you made');
  await tx.query(
    `UPDATE remediation_submissions SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 WHERE id = $1`,
    [input.submissionId, input.decision, ctx.user.id, input.note ?? null],
  );
  if (input.decision === 'accepted') {
    await tx.query(`UPDATE findings SET status = 'ready_for_retest', updated_at = now() WHERE id = $1`, [submission.finding_id]);
  } else if (input.decision === 'rejected') {
    await tx.query(`UPDATE findings SET status = 'remediation_in_progress', updated_at = now() WHERE id = $1`, [submission.finding_id]);
    await tx.query(`UPDATE remediation_plans SET status = 'in_progress', updated_at = now() WHERE id = $1`, [submission.plan_id]);
  }
  await recordAudit(
    {
      action: 'remediation.reviewed',
      entityType: 'remediation_submission',
      entityId: input.submissionId,
      institutionId: submission.institution_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { decision: input.decision, findingId: submission.finding_id },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function createRetest(
  tx: Tx,
  ctx: RequestContext,
  input: { findingId: string; notes?: string },
) {
  if (!can(ctx.user, 'retest:perform') && !can(ctx.user, 'retest:request')) throw new ForbiddenError('Missing permission: retest:request');
  const finding = await tx.queryOne<any>('SELECT * FROM findings WHERE id = $1', [input.findingId]);
  if (!finding) throw new NotFoundError('Finding not found');
  if (!['confirmed', 'ready_for_retest', 'remediation_in_progress', 'reopened'].includes(finding.status)) {
    throw new ConflictError('A retest can only be requested for a confirmed finding awaiting verification');
  }
  const retest = await tx.queryOne<{ id: string }>(
    `INSERT INTO retests (finding_id, institution_id, engagement_id, requested_by, status, notes)
     VALUES ($1,$2,$3,$4,'requested',$5) RETURNING id`,
    [finding.id, finding.institution_id, finding.engagement_id, ctx.user.id, input.notes ?? null],
  );
  await tx.query(`UPDATE findings SET status = 'ready_for_retest', updated_at = now() WHERE id = $1 AND status <> 'ready_for_retest'`, [finding.id]);
  await tx.query(
    `INSERT INTO finding_history (finding_id, institution_id, actor_id, action, note) VALUES ($1,$2,$3,'retest_requested',$4)`,
    [finding.id, finding.institution_id, ctx.user.id, input.notes ?? null],
  );
  await recordAudit(
    {
      action: 'retest.requested',
      entityType: 'retest',
      entityId: retest!.id,
      institutionId: finding.institution_id,
      engagementId: finding.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { findingId: finding.id, reference: finding.reference },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return retest;
}

export async function completeRetest(
  tx: Tx,
  ctx: RequestContext,
  input: { retestId: string; result: 'resolved' | 'not_resolved' | 'partial' | 'inconclusive'; notes: string; evidenceId?: string | null },
) {
  if (!can(ctx.user, 'retest:perform')) throw new ForbiddenError('Missing permission: retest:perform');
  const retest = await tx.queryOne<any>('SELECT * FROM retests WHERE id = $1', [input.retestId]);
  if (!retest) throw new NotFoundError('Retest not found');
  if (retest.requested_by === ctx.user.id && !can(ctx.user, 'retest:verify')) {
    throw new ForbiddenError('Independent verification is required: request a retest by a different assessor');
  }
  await tx.query(
    `UPDATE retests SET status = 'completed', result = $2, notes = $3, evidence_id = $4, performed_by = $5, performed_at = now() WHERE id = $1`,
    [input.retestId, input.result, input.notes, input.evidenceId ?? null, ctx.user.id],
  );
  await tx.query(
    `INSERT INTO finding_history (finding_id, institution_id, actor_id, action, note) VALUES ($1,$2,$3,'retest_completed',$4)`,
    [retest.finding_id, retest.institution_id, ctx.user.id, `${input.result}: ${input.notes}`.slice(0, 800)],
  );
  await recordAudit(
    {
      action: 'retest.completed',
      entityType: 'retest',
      entityId: input.retestId,
      institutionId: retest.institution_id,
      engagementId: retest.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { result: input.result, findingId: retest.finding_id },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function verifyRetest(tx: Tx, ctx: RequestContext, retestId: string) {
  if (!can(ctx.user, 'retest:verify')) throw new ForbiddenError('Missing permission: retest:verify');
  const retest = await tx.queryOne<any>('SELECT * FROM retests WHERE id = $1', [retestId]);
  if (!retest) throw new NotFoundError('Retest not found');
  if (retest.performed_by === ctx.user.id) throw new ForbiddenError('You cannot independently verify a retest you performed');
  if (retest.status !== 'completed') throw new ConflictError('Only completed retests can be verified');
  await tx.query('UPDATE retests SET verified_by = $2, verified_at = now() WHERE id = $1', [retestId, ctx.user.id]);
  if (retest.result === 'resolved') {
    await tx.query(`UPDATE findings SET status = 'resolved', resolved_at = now(), updated_at = now(), verified_by = $2, verified_at = now() WHERE id = $1`, [retest.finding_id, ctx.user.id]);
    await tx.query(`UPDATE remediation_plans SET status = 'verified', updated_at = now() WHERE finding_id = $1`, [retest.finding_id]);
  } else if (retest.result === 'not_resolved' || retest.result === 'partial') {
    await tx.query(`UPDATE findings SET status = 'reopened', reopened_count = reopened_count + 1, updated_at = now() WHERE id = $1`, [retest.finding_id]);
    await tx.query(`UPDATE remediation_plans SET status = 'in_progress', updated_at = now() WHERE finding_id = $1`, [retest.finding_id]);
  }
  await recordAudit(
    {
      action: 'retest.verified',
      entityType: 'retest',
      entityId: retestId,
      institutionId: retest.institution_id,
      engagementId: retest.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { result: retest.result, findingId: retest.finding_id },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function flagOverdueRemediation(tx: Tx, institutionId?: string): Promise<number> {
  const result = await tx.query(
    `UPDATE remediation_plans SET status = 'overdue', updated_at = now()
      WHERE target_date < current_date AND status IN ('open','in_progress') ${institutionId ? 'AND institution_id = $1' : ''}
      RETURNING id`,
    institutionId ? [institutionId] : [],
  );
  return result.length;
}

export async function listRetests(tx: Tx, ctx: RequestContext, institutionId?: string) {
  const params: unknown[] = [ctx.mode];
  const clause = institutionId ? `AND f.institution_id = $2` : '';
  if (institutionId) params.push(institutionId);
  return tx.query(
    `SELECT r.*, f.reference AS finding_reference, f.title, f.technical_severity, i.name AS institution_name
       FROM retests r JOIN findings f ON f.id = r.finding_id JOIN institutions i ON i.id = f.institution_id
      WHERE f.data_mode = $1 ${clause}
      ORDER BY r.created_at DESC LIMIT 100`,
    params,
  );
}
