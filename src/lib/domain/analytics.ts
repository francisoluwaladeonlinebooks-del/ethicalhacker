import type { Tx } from '@/lib/db/pool';
import type { RequestContext } from '@/lib/db/context';
import { can } from '@/lib/rbac';

/** Aggregations for the executive, technical, framework and portfolio dashboards. */

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unscored'];
const OPEN_STATES = `('new','needs_verification','confirmed','reopened','accepted_risk','remediation_in_progress','ready_for_retest')`;

export async function executiveSummary(tx: Tx, ctx: RequestContext) {
  const mode = ctx.mode;
  const totals = await tx.queryOne<any>(
    `SELECT
      (SELECT count(*)::int FROM institutions WHERE data_mode = $1) AS institutions,
      (SELECT count(*)::int FROM applications a JOIN institutions i ON i.id = a.institution_id WHERE i.data_mode = $1 AND a.status = 'active') AS applications,
      (SELECT count(*)::int FROM engagements e WHERE e.data_mode = $1 AND e.status IN ('running','approved','plan_review')) AS assessments_in_progress,
      (SELECT count(*)::int FROM engagements e WHERE e.data_mode = $1 AND e.status = 'completed') AS completed_assessments,
      (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.status IN ${OPEN_STATES}) AS open_findings,
      (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.technical_severity IN ('critical','high') AND f.status IN ${OPEN_STATES}) AS open_critical_high,
      (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.status = 'needs_verification') AS awaiting_verification,
      (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.is_systemic) AS systemic_findings,
      (SELECT count(*)::int FROM remediation_plans rp JOIN findings f ON f.id = rp.finding_id WHERE f.data_mode = $1 AND rp.target_date < current_date AND rp.status NOT IN ('verified','closed')) AS overdue_remediation,
      (SELECT count(*)::int FROM findings f WHERE f.data_mode = $1 AND f.status = 'ready_for_retest') AS awaiting_retest,
      (SELECT count(*)::int FROM reports r WHERE r.data_mode = $1 AND r.status IN ('in_review','approved')) AS reports_in_review`,
    [mode],
  );

  const bySeverity = await tx.query<{ technical_severity: string; count: number }>(
    `SELECT technical_severity, count(*)::int AS count FROM findings
      WHERE data_mode = $1 AND status IN ${OPEN_STATES} GROUP BY technical_severity`,
    [mode],
  );

  const byCategory = await tx.query<{ category: string; count: number; critical_high: number }>(
    `SELECT category, count(*)::int AS count,
            count(*) FILTER (WHERE technical_severity IN ('critical','high'))::int AS critical_high
       FROM findings WHERE data_mode = $1 AND status IN ${OPEN_STATES}
      GROUP BY category ORDER BY count DESC LIMIT 10`,
    [mode],
  );

  const channelCoverage = await tx.query<{ channel: string; applications: number; assessed: number }>(
    `SELECT a.channel,
            count(*)::int AS applications,
            count(DISTINCT CASE WHEN f.id IS NOT NULL THEN a.id END)::int AS assessed
       FROM applications a JOIN institutions i ON i.id = a.institution_id
       LEFT JOIN findings f ON f.application_id = a.id
      WHERE i.data_mode = $1 GROUP BY a.channel ORDER BY applications DESC`,
    [mode],
  );

  const trend = await tx.query<{ period: string; critical: number; high: number; medium: number; low: number }>(
    `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS period,
            count(*) FILTER (WHERE technical_severity = 'critical')::int AS critical,
            count(*) FILTER (WHERE technical_severity = 'high')::int AS high,
            count(*) FILTER (WHERE technical_severity = 'medium')::int AS medium,
            count(*) FILTER (WHERE technical_severity = 'low')::int AS low
       FROM findings WHERE data_mode = $1 GROUP BY 1 ORDER BY 1`,
    [mode],
  );

  const remediationPerformance = await tx.queryOne<any>(
    `SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE rp.status = 'verified')::int AS verified,
      count(*) FILTER (WHERE rp.target_date < current_date AND rp.status NOT IN ('verified','closed'))::int AS overdue,
      count(*) FILTER (WHERE rp.status = 'submitted')::int AS awaiting_review
     FROM remediation_plans rp JOIN findings f ON f.id = rp.finding_id WHERE f.data_mode = $1`,
    [mode],
  );

  const repeatFindings = await tx.query<{ fingerprint: string; title: string; occurrences: number; institutions: number }>(
    `SELECT fingerprint, min(title) AS title, count(*)::int AS occurrences, count(DISTINCT institution_id)::int AS institutions
       FROM findings WHERE data_mode = $1 GROUP BY fingerprint HAVING count(*) > 1 ORDER BY occurrences DESC LIMIT 8`,
    [mode],
  );

  const frameworkCoverage = await tx.query<{ framework_key: string; executed: number; failed: number; blocked: number }>(
    `SELECT tr.framework_key, count(*)::int AS executed,
            count(*) FILTER (WHERE tr.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE tr.status IN ('blocked','error'))::int AS blocked
       FROM test_results tr JOIN institutions i ON i.id = tr.institution_id
      WHERE i.data_mode = $1 GROUP BY tr.framework_key ORDER BY tr.framework_key`,
    [mode],
  );

  const portfolio = can(ctx.user, 'institution:portfolio')
    ? await tx.query<{ institution_id: string; name: string; category: string; critical_high: number; open_findings: number; risk_tier: string }>(
        `SELECT i.id AS institution_id, i.name, i.category, i.risk_tier,
                count(f.id) FILTER (WHERE f.technical_severity IN ('critical','high') AND f.status IN ${OPEN_STATES})::int AS critical_high,
                count(f.id) FILTER (WHERE f.status IN ${OPEN_STATES})::int AS open_findings
           FROM institutions i LEFT JOIN findings f ON f.institution_id = i.id
          WHERE i.data_mode = $1 GROUP BY i.id ORDER BY critical_high DESC, open_findings DESC`,
        [mode],
      )
    : [];

  const severityMap: Record<string, number> = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0]));
  for (const row of bySeverity) severityMap[row.technical_severity] = Number(row.count);

  return { totals, bySeverity: severityMap, byCategory, channelCoverage, trend, remediationPerformance, repeatFindings, frameworkCoverage, portfolio };
}

export async function technicalSummary(tx: Tx, ctx: RequestContext) {
  const engagements = await tx.query(
    `SELECT e.id, e.code, e.name, e.status, e.scope_expires_at, i.name AS institution_name,
            (SELECT count(*)::int FROM assessment_jobs j WHERE j.engagement_id = e.id AND j.status IN ('queued','running')) AS active_jobs,
            (SELECT count(*)::int FROM scope_assets s WHERE s.engagement_id = e.id) AS scope_assets,
            (SELECT count(*)::int FROM findings f WHERE f.engagement_id = e.id) AS findings
       FROM engagements e JOIN institutions i ON i.id = e.institution_id
      WHERE e.data_mode = $1 AND e.status NOT IN ('cancelled','completed') ORDER BY e.created_at DESC`,
    [ctx.mode],
  );

  const jobs = await tx.query(
    `SELECT j.*, a.name AS application_name, i.name AS institution_name, e.code AS engagement_code
       FROM assessment_jobs j LEFT JOIN applications a ON a.id = j.application_id
       JOIN institutions i ON i.id = j.institution_id JOIN engagements e ON e.id = j.engagement_id
      WHERE i.data_mode = $1 ORDER BY j.created_at DESC LIMIT 12`,
    [ctx.mode],
  );

  const checks = await tx.queryOne<any>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE tr.status = 'passed')::int AS passed,
            count(*) FILTER (WHERE tr.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE tr.status IN ('blocked','error'))::int AS blocked,
            count(*) FILTER (WHERE tr.status = 'needs_verification')::int AS needs_verification
       FROM test_results tr JOIN institutions i ON i.id = tr.institution_id WHERE i.data_mode = $1`,
    [ctx.mode],
  );

  const cvssDistribution = await tx.query<{ bucket: string; count: number }>(
    `SELECT CASE
              WHEN cvss_score IS NULL THEN 'unscored'
              WHEN cvss_score = 0 THEN '0.0'
              WHEN cvss_score < 4 THEN '0.1-3.9'
              WHEN cvss_score < 7 THEN '4.0-6.9'
              WHEN cvss_score < 9 THEN '7.0-8.9'
              ELSE '9.0-10.0' END AS bucket,
            count(*)::int AS count
       FROM findings f JOIN institutions i ON i.id = f.institution_id WHERE i.data_mode = $1
      GROUP BY bucket`,
    [ctx.mode],
  );

  const evidence = await tx.queryOne<any>(
    `SELECT count(*)::int AS records, coalesce(sum(e.size_bytes),0)::bigint AS bytes,
            count(*) FILTER (WHERE e.redacted)::int AS redacted
       FROM evidence e JOIN institutions i ON i.id = e.institution_id WHERE i.data_mode = $1`,
    [ctx.mode],
  );

  const retests = await tx.query(
    `SELECT r.*, f.reference AS finding_reference, f.title FROM retests r JOIN findings f ON f.id = r.finding_id
      WHERE r.status IN ('requested','in_progress') ORDER BY r.created_at DESC LIMIT 10`,
  );

  return { engagements, jobs, checks, cvssDistribution, evidence, retests };
}

export async function frameworkDashboard(tx: Tx, ctx: RequestContext) {
  const catalogue = await tx.query<{ key: string; name: string; version: string; verification_status: string; items: number; automated: number; manual: number }>(
    `SELECT f.key, f.name, f.version, f.verification_status,
            count(fi.id)::int AS items,
            count(fi.id) FILTER (WHERE fi.automation = 'automated')::int AS automated,
            count(fi.id) FILTER (WHERE fi.automation = 'manual')::int AS manual
       FROM frameworks f LEFT JOIN framework_items fi ON fi.framework_id = f.id
      GROUP BY f.id ORDER BY f.key`,
  );
  const results = await tx.query<{ framework_key: string; status: string; count: number }>(
    `SELECT tr.framework_key, tr.status, count(*)::int AS count
       FROM test_results tr JOIN institutions i ON i.id = tr.institution_id
      WHERE i.data_mode = $1 GROUP BY tr.framework_key, tr.status`,
    [ctx.mode],
  );
  const byItem = await tx.query<{ framework_key: string; item_code: string; status: string; count: number }>(
    `SELECT tr.framework_key, tr.framework_item_code AS item_code, tr.status, count(*)::int AS count
       FROM test_results tr JOIN institutions i ON i.id = tr.institution_id
      WHERE i.data_mode = $1 GROUP BY 1,2,3`,
    [ctx.mode],
  );
  const findings = await tx.query<{ framework_key: string; count: number }>(
    `SELECT l.framework_key, count(DISTINCT l.finding_id)::int AS count
       FROM finding_framework_links l JOIN findings f ON f.id = l.finding_id
      WHERE f.data_mode = $1 GROUP BY 1`,
    [ctx.mode],
  );
  return { catalogue, results, byItem, findings };
}

export async function portfolioAnalytics(tx: Tx, ctx: RequestContext) {
  if (!can(ctx.user, 'institution:portfolio')) {
    return { authorised: false, categories: [], themes: [], remediationTimeliness: [], coverageGaps: [] };
  }
  const categories = await tx.query<{ category: string; institutions: number; open_findings: number; critical_high: number; overdue: number }>(
    `SELECT i.category,
            count(DISTINCT i.id)::int AS institutions,
            count(f.id) FILTER (WHERE f.status IN ${OPEN_STATES})::int AS open_findings,
            count(f.id) FILTER (WHERE f.technical_severity IN ('critical','high') AND f.status IN ${OPEN_STATES})::int AS critical_high,
            count(DISTINCT CASE WHEN rp.target_date < current_date AND rp.status NOT IN ('verified','closed') THEN rp.id END)::int AS overdue
       FROM institutions i
       LEFT JOIN findings f ON f.institution_id = i.id
       LEFT JOIN remediation_plans rp ON rp.finding_id = f.id
      WHERE i.data_mode = $1 GROUP BY i.category ORDER BY critical_high DESC`,
    [ctx.mode],
  );
  const themes = await tx.query<{ category: string; findings: number; institutions: number; applications: number; highest: string }>(
    `SELECT category, count(*)::int AS findings, count(DISTINCT institution_id)::int AS institutions,
            count(DISTINCT application_id)::int AS applications,
            max(CASE technical_severity WHEN 'critical' THEN 'critical' WHEN 'high' THEN 'high' WHEN 'medium' THEN 'medium' ELSE 'low' END) AS highest
       FROM findings WHERE data_mode = $1 AND status IN ${OPEN_STATES}
      GROUP BY category ORDER BY institutions DESC, findings DESC LIMIT 12`,
    [ctx.mode],
  );
  const remediationTimeliness = await tx.query<{ status: string; count: number; avg_days: number | null }>(
    `SELECT rp.status, count(*)::int AS count,
            round(avg(EXTRACT(EPOCH FROM (coalesce(rp.updated_at, now()) - rp.created_at)) / 86400)::numeric, 1)::float AS avg_days
       FROM remediation_plans rp JOIN findings f ON f.id = rp.finding_id WHERE f.data_mode = $1
      GROUP BY rp.status`,
    [ctx.mode],
  );
  const coverageGaps = await tx.query<{ institution: string; applications: number; unassessed: number }>(
    `SELECT i.name AS institution, count(a.id)::int AS applications,
            count(a.id) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM engagement_applications ea JOIN engagements e ON e.id = ea.engagement_id
               WHERE ea.application_id = a.id AND e.status IN ('approved','running','completed')
            ))::int AS unassessed
       FROM institutions i LEFT JOIN applications a ON a.institution_id = i.id AND a.status = 'active'
      WHERE i.data_mode = $1 GROUP BY i.id ORDER BY unassessed DESC`,
    [ctx.mode],
  );
  return { authorised: true, categories, themes, remediationTimeliness, coverageGaps };
}
