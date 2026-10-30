import type { RequestContext } from '@/lib/db/context';
import type { Tx } from '@/lib/db/pool';
import { ForbiddenError } from '@/lib/errors';

/**
 * Persona dashboards.
 *
 * Each role lands on a workspace built for the work it actually performs,
 * rather than one shared overview with a small role note bolted on. The five
 * loaders below are the only place these figures are produced, which keeps two
 * rules enforceable in one file:
 *
 *  1. A dashboard never shows a count for data the role cannot open. The
 *     platform administrator, for example, has no `finding:read` without a
 *     recorded access grant, so the administrative dashboard collects no
 *     finding, evidence or assessment-result aggregates at all — an aggregate
 *     is still a disclosure.
 *
 *  2. Every figure is a count of records that exist. Nothing is estimated,
 *     projected or extrapolated, and a zero is rendered as a zero rather than a
 *     reassuring fallback.
 *
 * All queries are parameterised and run inside the caller's scoped transaction,
 * so row level security still confines an institution contact to their own
 * institution even if a filter here were ever wrong.
 */

/** Finding states that count as open. Kept in step with the findings domain. */
const OPEN_FINDING_STATES = `('new','needs_verification','confirmed','remediation_in_progress','ready_for_retest','reopened')`;

function guard(ctx: RequestContext, role: RequestContext['user']['role']): void {
  if (ctx.user.role !== role) {
    throw new ForbiddenError('This dashboard is not available for your role');
  }
}

/* -------------------------------------------------------------------------- */
/* CBN assessor                                                                */
/* -------------------------------------------------------------------------- */

export async function assessorDashboard(tx: Tx, ctx: RequestContext) {
  guard(ctx, 'cbn_assessor');

  const counts = await tx.queryOne<any>(
    `SELECT
       (SELECT count(*)::int FROM engagements e WHERE e.data_mode = $1 AND e.status IN ('draft','pending_authorization')) AS awaiting_authorisation,
       (SELECT count(*)::int FROM test_plans p JOIN engagements e ON e.id = p.engagement_id
          WHERE e.data_mode = $1 AND p.status = 'pending_approval') AS plans_awaiting_approval,
       (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.status = 'needs_verification') AS findings_to_verify,
       (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.cvss_score IS NULL AND f.status <> 'false_positive') AS findings_unscored,
       (SELECT count(*)::int FROM retests r JOIN findings f ON f.id = r.finding_id
          WHERE f.data_mode = $1 AND r.status = 'completed' AND r.verified_at IS NULL) AS retests_to_verify,
       (SELECT count(*)::int FROM assessment_jobs j JOIN engagements e ON e.id = j.engagement_id
          WHERE e.data_mode = $1 AND j.status IN ('queued','running')) AS jobs_active,
       (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.status IN ${OPEN_FINDING_STATES}) AS open_findings`,
    [ctx.mode],
  );

  const [engagements, plans, findings, jobs] = await Promise.all([
    tx.query(
      `SELECT e.id, e.code, e.name, e.status, e.scope_expires_at, e.updated_at, i.name AS institution_name,
              (SELECT count(*)::int FROM scope_assets s WHERE s.engagement_id = e.id) AS scope_assets,
              (SELECT count(*)::int FROM findings f WHERE f.engagement_id = e.id) AS findings,
              (SELECT count(*)::int FROM assessment_jobs j WHERE j.engagement_id = e.id AND j.status IN ('queued','running')) AS active_jobs
         FROM engagements e JOIN institutions i ON i.id = e.institution_id
        WHERE e.data_mode = $1 AND e.status NOT IN ('cancelled','completed')
        ORDER BY e.updated_at DESC LIMIT 6`,
      [ctx.mode],
    ),
    tx.query(
      `SELECT p.id, p.version, p.status, p.created_at, p.approval_note, e.id AS engagement_id, e.code, e.name,
              i.name AS institution_name
         FROM test_plans p
         JOIN engagements e ON e.id = p.engagement_id
         JOIN institutions i ON i.id = e.institution_id
        WHERE e.data_mode = $1 AND p.status = 'pending_approval'
        ORDER BY p.created_at ASC LIMIT 5`,
      [ctx.mode],
    ),
    tx.query(
      `SELECT f.id, f.reference, f.title, f.technical_severity, f.status, f.created_at, i.name AS institution_name
         FROM findings f JOIN institutions i ON i.id = f.institution_id
        WHERE f.data_mode = $1 AND f.status = 'needs_verification'
        ORDER BY f.priority_rank ASC NULLS LAST, f.created_at ASC LIMIT 6`,
      [ctx.mode],
    ),
    tx.query(
      `SELECT j.id, j.module, j.status, j.progress, j.created_at, j.blocked_reason, e.code AS engagement_code
         FROM assessment_jobs j JOIN engagements e ON e.id = j.engagement_id
        WHERE e.data_mode = $1
        ORDER BY j.created_at DESC LIMIT 6`,
      [ctx.mode],
    ),
  ]);

  return { counts: counts ?? {}, engagements, plans, findings, jobs };
}

/* -------------------------------------------------------------------------- */
/* Supervisory reviewer                                                        */
/* -------------------------------------------------------------------------- */

export async function reviewerDashboard(tx: Tx, ctx: RequestContext) {
  guard(ctx, 'supervisory_reviewer');

  const counts = await tx.queryOne<any>(
    `SELECT
       (SELECT count(*)::int FROM reports r WHERE r.data_mode = $1 AND r.status = 'in_review') AS reports_in_review,
       (SELECT count(*)::int FROM findings f
          WHERE f.data_mode = $1 AND f.status IN ${OPEN_FINDING_STATES}
            AND f.due_date IS NOT NULL AND f.due_date < current_date) AS findings_overdue,
       (SELECT count(*)::int FROM remediation_plans rp JOIN findings f ON f.id = rp.finding_id
          WHERE f.data_mode = $1 AND rp.target_date IS NOT NULL AND rp.target_date < current_date
            AND rp.status NOT IN ('verified','closed')) AS plans_overdue,
       (SELECT count(*)::int FROM institutions i
          WHERE i.data_mode = $1
            AND (i.last_verified_at IS NULL OR i.last_verified_at < now() - (i.stale_after_days || ' days')::interval)) AS registry_stale,
       (SELECT count(*)::int FROM findings f
          WHERE f.data_mode = $1 AND f.status IN ${OPEN_FINDING_STATES} AND f.technical_severity IN ('critical','high')) AS critical_high_open,
       (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.is_systemic) AS systemic`,
    [ctx.mode],
  );

  const [portfolio, reports, stale] = await Promise.all([
    tx.query(
      `SELECT i.id, i.name, i.category, i.risk_tier,
              (SELECT count(*)::int FROM findings f WHERE f.institution_id = i.id AND f.status IN ${OPEN_FINDING_STATES}) AS open_findings,
              (SELECT count(*)::int FROM findings f WHERE f.institution_id = i.id AND f.status IN ${OPEN_FINDING_STATES}
                 AND f.technical_severity IN ('critical','high')) AS critical_high
         FROM institutions i
        WHERE i.data_mode = $1
        ORDER BY critical_high DESC, open_findings DESC, i.name ASC
        LIMIT 8`,
      [ctx.mode],
    ),
    tx.query(
      `SELECT r.id, r.title, r.report_type, r.status, r.generated_at, r.version,
              i.name AS institution_name, u.name AS generated_by_name
         FROM reports r
         JOIN institutions i ON i.id = r.institution_id
         LEFT JOIN users u ON u.id = r.generated_by
        WHERE r.data_mode = $1 AND r.status = 'in_review'
        ORDER BY r.generated_at ASC LIMIT 5`,
      [ctx.mode],
    ),
    tx.query(
      `SELECT i.id, i.name, i.verification_status, i.last_verified_at, i.stale_after_days, i.source_name
         FROM institutions i
        WHERE i.data_mode = $1
          AND (i.last_verified_at IS NULL OR i.last_verified_at < now() - (i.stale_after_days || ' days')::interval)
        ORDER BY i.last_verified_at ASC NULLS FIRST LIMIT 5`,
      [ctx.mode],
    ),
  ]);

  return { counts: counts ?? {}, portfolio, reports, stale };
}

/* -------------------------------------------------------------------------- */
/* Independent report approver                                                 */
/* -------------------------------------------------------------------------- */

export async function approverDashboard(tx: Tx, ctx: RequestContext) {
  guard(ctx, 'report_approver');

  const counts = await tx.queryOne<any>(
    `SELECT
       (SELECT count(*)::int FROM reports r WHERE r.data_mode = $1 AND r.status = 'in_review' AND r.generated_by IS DISTINCT FROM $2) AS awaiting_my_approval,
       (SELECT count(*)::int FROM reports r WHERE r.data_mode = $1 AND r.status = 'in_review' AND r.generated_by = $2) AS authored_by_me,
       (SELECT count(*)::int FROM reports r WHERE r.data_mode = $1 AND r.status = 'approved' AND r.approved_by = $2) AS approved_by_me,
       (SELECT count(*)::int FROM report_approvals ra JOIN reports r ON r.id = ra.report_id
          WHERE r.data_mode = $1 AND ra.decision <> 'approved') AS returned_total,
       (SELECT count(*)::int FROM reports r WHERE r.data_mode = $1 AND r.status = 'published') AS published,
       (SELECT count(*)::int FROM reports r WHERE r.data_mode = $1) AS total_reports`,
    [ctx.mode, ctx.user.id],
  );

  const [queue, decisions] = await Promise.all([
    tx.query(
      `SELECT r.id, r.title, r.report_type, r.status, r.generated_at, r.version, r.confidentiality,
              i.name AS institution_name, u.name AS generated_by_name,
              (r.generated_by = $2) AS authored_by_me,
              (SELECT count(*)::int FROM report_approvals ra WHERE ra.report_id = r.id) AS prior_reviews
         FROM reports r
         JOIN institutions i ON i.id = r.institution_id
         LEFT JOIN users u ON u.id = r.generated_by
        WHERE r.data_mode = $1 AND r.status = 'in_review'
        ORDER BY r.generated_at ASC LIMIT 8`,
      [ctx.mode, ctx.user.id],
    ),
    tx.query(
      `SELECT ra.id, ra.decision, ra.comments, ra.created_at, r.title, u.name AS reviewer_name
         FROM report_approvals ra
         JOIN reports r ON r.id = ra.report_id
         LEFT JOIN users u ON u.id = ra.reviewer_id
        WHERE r.data_mode = $1
        ORDER BY ra.created_at DESC LIMIT 6`,
      [ctx.mode],
    ),
  ]);

  return { counts: counts ?? {}, queue, decisions };
}

/* -------------------------------------------------------------------------- */
/* Institution contact                                                         */
/* -------------------------------------------------------------------------- */

export async function contactDashboard(tx: Tx, ctx: RequestContext) {
  guard(ctx, 'institution_contact');

  const institution = ctx.user.institution_id
    ? await tx.queryOne(
        `SELECT id, name, code, category, risk_tier, licence_status, verification_status, last_verified_at
           FROM institutions WHERE id = $1`,
        [ctx.user.institution_id],
      )
    : null;

  const counts = await tx.queryOne<any>(
    `SELECT
       (SELECT count(*)::int FROM evidence e WHERE e.data_mode = $1 AND e.share_with_institution) AS shared_evidence,
       (SELECT count(*)::int FROM findings f
          WHERE f.data_mode = $1 AND f.status IN ('confirmed','remediation_in_progress','ready_for_retest')) AS open_confirmed,
       (SELECT count(*)::int FROM remediation_submissions rs JOIN findings f ON f.id = rs.finding_id
          WHERE f.data_mode = $1 AND rs.status = 'needs_info') AS submissions_needing_info,
       (SELECT count(*)::int FROM retests rt JOIN findings f ON f.id = rt.finding_id
          WHERE f.data_mode = $1 AND rt.status IN ('requested','in_progress')) AS retests_pending,
       (SELECT count(*)::int FROM findings f
          WHERE f.data_mode = $1 AND f.status IN ('confirmed','remediation_in_progress')
            AND f.due_date IS NOT NULL AND f.due_date < current_date) AS findings_overdue`,
    [ctx.mode],
  );

  const [findings, evidence, submissions] = await Promise.all([
    tx.query(
      `SELECT f.id, f.reference, f.title, f.technical_severity, f.contextual_rating, f.status, f.due_date,
              a.name AS application_name
         FROM findings f LEFT JOIN applications a ON a.id = f.application_id
        WHERE f.data_mode = $1
          AND f.status IN ('confirmed','remediation_in_progress','ready_for_retest','resolved','accepted_risk','reopened','closed')
        ORDER BY f.priority_rank ASC NULLS LAST, f.created_at DESC LIMIT 10`,
      [ctx.mode],
    ),
    tx.query(
      `SELECT e.id, e.title, e.kind, e.classification, e.created_at, e.redacted, e.retention_until
         FROM evidence e
        WHERE e.data_mode = $1 AND e.share_with_institution
        ORDER BY e.created_at DESC LIMIT 6`,
      [ctx.mode],
    ),
    tx.query(
      `SELECT rs.id, rs.status, rs.created_at, rs.review_note, f.id AS finding_id, f.reference, f.title
         FROM remediation_submissions rs JOIN findings f ON f.id = rs.finding_id
        WHERE f.data_mode = $1
        ORDER BY rs.created_at DESC LIMIT 6`,
      [ctx.mode],
    ),
  ]);

  return { institution, counts: counts ?? {}, findings, evidence, submissions };
}

/* -------------------------------------------------------------------------- */
/* Platform administrator                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Administrative position only.
 *
 * Deliberately excludes every finding, evidence and assessment-result figure:
 * the administrator has no reading right to that material without a recorded,
 * time-boxed access grant, so surfacing a count here would disclose the thing
 * the separation of duties exists to protect.
 */
export async function adminDashboard(tx: Tx, ctx: RequestContext) {
  guard(ctx, 'platform_admin');

  const counts = await tx.queryOne<any>(
    `SELECT
       (SELECT count(*)::int FROM users WHERE status = 'active') AS active_users,
       (SELECT count(*)::int FROM users WHERE status = 'active' AND last_login_at > now() - interval '7 days') AS signed_in_7d,
       (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND expires_at > now()) AS live_sessions,
       (SELECT count(*)::int FROM engines WHERE status <> 'enabled') AS engines_not_enabled,
       (SELECT count(*)::int FROM audit_events WHERE at > now() - interval '24 hours') AS audit_events_24h,
       (SELECT count(*)::int FROM access_grants WHERE revoked_at IS NULL AND expires_at > now()) AS active_grants,
       (SELECT count(*)::int FROM frameworks WHERE verification_status IS DISTINCT FROM 'verified') AS catalogues_unverified,
       (SELECT count(*)::int FROM assessment_jobs WHERE status IN ('queued','running')) AS jobs_active`,
  );

  const [engines, sessions, audit, settings] = await Promise.all([
    tx.query(
      `SELECT e.key, e.name, e.version, e.status, e.health, e.last_health_check,
              (SELECT count(*)::int FROM assessment_jobs j WHERE j.module = e.key AND j.status = 'running') AS running_jobs,
              (SELECT count(*)::int FROM assessment_jobs j WHERE j.module = e.key AND j.status = 'failed') AS failed_jobs
         FROM engines e ORDER BY e.key`,
    ),
    tx.query(
      `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.mfa_verified, s.ip, u.email, u.name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.revoked_at IS NULL AND s.expires_at > now()
        ORDER BY s.created_at DESC LIMIT 8`,
    ),
    tx.query(
      `SELECT id, at, actor_email, actor_role, action, entity_type, outcome
         FROM audit_events ORDER BY at DESC LIMIT 8`,
    ),
    tx.query(`SELECT key, value FROM settings WHERE key IN ('global_kill_switch','platform_mode','ai_enabled','require_independent_verification')`),
  ]);

  const settingsMap = Object.fromEntries(settings.map((row: any) => [row.key, row.value]));

  return { counts: counts ?? {}, engines, sessions, audit, settings: settingsMap };
}
