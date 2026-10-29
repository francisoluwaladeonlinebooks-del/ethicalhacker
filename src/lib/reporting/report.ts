/**
 * Report snapshots and report lifecycle.
 *
 * A report is a frozen snapshot: once generated, it is never silently
 * recalculated. Findings are separated into confirmed, suspected and
 * observation bands, and blocked or unexecuted checks are counted explicitly
 * so a reader cannot mistake an untested area for a clean result.
 *
 * Rendering lives in ./pdf.ts and ./xlsx.ts, which consume exactly the
 * snapshot produced here.
 */
import type { Tx } from '@/lib/db/pool';
import type { RequestContext } from '@/lib/db/context';
import { can } from '@/lib/rbac';
import { ForbiddenError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from '@/lib/domain/audit';

export type ReportType = 'executive' | 'technical' | 'supervisory_portfolio' | 'remediation_status' | 'coverage';
export type ReportStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'superseded';
export type ReportClassification = 'confirmed' | 'suspected' | 'observation';

const CLOSED_STATUSES = ['resolved', 'closed', 'false_positive', 'accepted_risk'];
const SEVERITY_ORDER = ['none', 'unscored', 'low', 'medium', 'high', 'critical'] as const;

/** Convert arbitrary text to printable ASCII. The built-in PDF fonts cannot
 * encode typographic quotes or dashes, and evidence content must never break
 * the export. */
export function toSafeText(input: unknown): string {
  const map: Record<string, string> = {
    '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-',
    '\u2026': '...', '\u00a0': ' ', '\u2022': '-', '\u2192': '->', '\u2265': '>=', '\u2264': '<=',
  };
  return String(input ?? '')
    .replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00a0\u2022\u2192\u2265\u2264]/g, (char) => map[char] ?? '?')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

export function classifyFinding(finding: {
  status: string;
  technical_severity?: string | null;
  verified_at?: string | Date | null;
}): ReportClassification | 'rejected' {
  if (finding.status === 'false_positive') return 'rejected';
  const severity = finding.technical_severity ?? 'unscored';
  if (severity === 'unscored' || severity === 'none') return 'observation';
  const confirmedStatuses = ['confirmed', 'remediation_in_progress', 'ready_for_retest', 'resolved', 'reopened', 'accepted_risk', 'closed'];
  if (finding.verified_at || confirmedStatuses.includes(finding.status)) return 'confirmed';
  return 'suspected';
}

export type ReportSnapshot = Record<string, any>;

export async function buildSnapshot(
  tx: Tx,
  ctx: Pick<RequestContext, 'mode' | 'user'>,
  input: {
    reportType: ReportType;
    institutionId?: string | null;
    engagementId?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    title?: string;
  },
): Promise<ReportSnapshot> {
  const engagement = input.engagementId
    ? await tx.queryOne<any>(
        `SELECT e.*, i.name AS institution_name, i.code AS institution_code, i.category AS institution_category, i.risk_tier
           FROM engagements e JOIN institutions i ON i.id = e.institution_id
          WHERE e.id = $1 AND i.data_mode = $2`,
        [input.engagementId, ctx.mode],
      )
    : null;
  if (input.engagementId && !engagement) throw new NotFoundError('Engagement not found');

  const institutionRow = engagement
    ? null
    : input.institutionId
      ? await tx.queryOne<any>(`SELECT * FROM institutions WHERE id = $1 AND data_mode = $2`, [input.institutionId, ctx.mode])
      : null;
  if (input.institutionId && !engagement && !institutionRow) throw new NotFoundError('Institution not found');

  const institution = engagement
    ? {
        id: engagement.institution_id,
        name: engagement.institution_name,
        code: engagement.institution_code,
        category: engagement.institution_category,
        riskTier: engagement.risk_tier ?? 'unrated',
      }
    : institutionRow
      ? { id: institutionRow.id, name: institutionRow.name, code: institutionRow.code, category: institutionRow.category, riskTier: institutionRow.risk_tier ?? 'unrated' }
      : null;

  if (!institution && input.reportType !== 'supervisory_portfolio') {
    throw new ValidationError('Select an engagement or institution for this report type');
  }

  const params: unknown[] = [ctx.mode];
  const clauses = ['f.data_mode = $1'];
  if (engagement) {
    params.push(engagement.id);
    clauses.push(`f.engagement_id = $${params.length}`);
  } else if (institution) {
    params.push(institution.id);
    clauses.push(`f.institution_id = $${params.length}`);
  } else {
    clauses.push('1 = 0');
  }

  const rows = await tx.query<any>(
    `SELECT f.*, a.name AS application_name,
            (SELECT count(*)::int FROM finding_evidence fe WHERE fe.finding_id = f.id) AS evidence_count
       FROM findings f
       LEFT JOIN applications a ON a.id = f.application_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY f.priority_rank ASC NULLS LAST, f.cvss_score DESC NULLS LAST`,
    params,
  );

  const linkParams = engagement ? [engagement.id] : institution ? [institution.id] : [null];
  const links = await tx.query<any>(
    `SELECT l.finding_id, l.framework_key, l.framework_version, l.item_code
       FROM finding_framework_links l
       JOIN findings f ON f.id = l.finding_id
      WHERE ${engagement ? 'f.engagement_id = $1' : institution ? 'f.institution_id = $1' : 'false'}`,
    linkParams,
  );
  const linksByFinding = new Map<string, string[]>();
  for (const link of links) {
    const list = linksByFinding.get(link.finding_id) ?? [];
    list.push(`${link.framework_key} ${link.framework_version} ${link.item_code}`);
    linksByFinding.set(link.finding_id, list);
  }

  const findings = rows
    .map((row) => ({ row, classification: classifyFinding(row) }))
    .filter((entry) => entry.classification !== 'rejected')
    .map(({ row, classification }) => ({
      reference: row.reference,
      title: row.title,
      category: row.category,
      classification,
      status: row.status,
      technicalSeverity: row.technical_severity,
      cvssScore: row.cvss_score === null ? null : Number(row.cvss_score),
      cvssVector: row.cvss_vector ?? null,
      contextualRating: row.contextual_rating ?? null,
      priorityRank: row.priority_rank ?? null,
      confidence: row.confidence,
      verified: Boolean(row.verified_at),
      dueDate: row.due_date ?? null,
      asset: row.asset ?? null,
      endpoint: row.endpoint ?? null,
      application: row.application_name ?? null,
      description: row.description,
      businessImpact: row.business_impact ?? null,
      remediationSummary: row.remediation_summary ?? null,
      frameworkRefs: linksByFinding.get(row.id) ?? [],
    }));

  const summary = {
    totalFindings: rows.length,
    openFindings: rows.filter((row) => !CLOSED_STATUSES.includes(row.status)).length,
    confirmed: rows.filter((row) => classifyFinding(row) === 'confirmed').length,
    suspected: rows.filter((row) => classifyFinding(row) === 'suspected').length,
    observation: rows.filter((row) => classifyFinding(row) === 'observation').length,
    rejected: rows.filter((row) => classifyFinding(row) === 'rejected').length,
    highestSeverity: findings.reduce((highest: string, finding) => {
      if (!finding.technicalSeverity) return highest;
      return SEVERITY_ORDER.indexOf(finding.technicalSeverity) > SEVERITY_ORDER.indexOf(highest as any)
        ? finding.technicalSeverity
        : highest;
    }, 'none'),
    blockedChecks: 0,
    notAssessedChecks: 0,
    verifiedRemediation: 0,
    overdueRemediation: 0,
  };

  const coverageParams = engagement ? [engagement.id] : institution ? [institution.id] : [null];
  const coverageRows = await tx.query<any>(
    `SELECT tr.framework_key, tr.framework_version,
            count(*)::int AS planned,
            count(*) FILTER (WHERE tr.status = 'passed')::int AS passed,
            count(*) FILTER (WHERE tr.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE tr.status = 'needs_verification')::int AS needs_verification,
            count(*) FILTER (WHERE tr.status = 'blocked')::int AS blocked,
            count(*) FILTER (WHERE tr.status = 'not_assessed')::int AS not_assessed,
            count(*) FILTER (WHERE tr.status = 'not_applicable')::int AS not_applicable,
            count(*) FILTER (WHERE tr.status = 'error')::int AS errors
       FROM test_results tr
      WHERE ${engagement ? 'tr.engagement_id = $1' : institution ? 'tr.institution_id = $1' : 'false'}
      GROUP BY tr.framework_key, tr.framework_version
      ORDER BY tr.framework_key, tr.framework_version`,
    coverageParams,
  );
  summary.blockedChecks = coverageRows.reduce((sum, row) => sum + Number(row.blocked ?? 0), 0);
  summary.notAssessedChecks = coverageRows.reduce((sum, row) => sum + Number(row.not_assessed ?? 0) + Number(row.errors ?? 0), 0);

  const notAssessedRows = await tx.query<any>(
    `SELECT tr.framework_key, tr.framework_item_code, tr.check_key, tr.status, tr.notes
       FROM test_results tr
      WHERE tr.status IN ('blocked','not_assessed','error','skipped')
        ${engagement ? 'AND tr.engagement_id = $1' : institution ? 'AND tr.institution_id = $1' : 'AND false'}
      ORDER BY tr.executed_at DESC LIMIT 100`,
    coverageParams,
  );

  const remediationRows = await tx.query<any>(
    `SELECT rp.*, f.reference, f.title, f.technical_severity
       FROM remediation_plans rp JOIN findings f ON f.id = rp.finding_id
      WHERE ${engagement ? 'f.engagement_id = $1' : institution ? 'f.institution_id = $1' : 'false'}
      ORDER BY rp.target_date NULLS LAST`,
    coverageParams,
  );
  const today = new Date().toISOString().slice(0, 10);
  const remediation = remediationRows.map((row) => ({
    reference: row.reference,
    title: row.title,
    severity: row.technical_severity,
    status: row.status,
    priority: row.priority,
    targetDate: row.target_date ?? null,
    overdue: Boolean(row.target_date && row.target_date < today && !['verified', 'closed'].includes(row.status)),
    verificationCriteria: row.verification_criteria ?? null,
  }));
  summary.verifiedRemediation = remediation.filter((row) => row.status === 'verified').length;
  summary.overdueRemediation = remediation.filter((row) => row.overdue).length;

  const evidenceRows = await tx.query<any>(
    `SELECT e.id, e.kind, e.title, e.media_type, e.size_bytes, e.body_sha256, e.classification, e.redacted, e.share_with_institution
       FROM evidence e
      WHERE ${engagement ? 'e.engagement_id = $1' : institution ? 'e.institution_id = $1' : 'false'}
      ORDER BY e.created_at LIMIT 200`,
    coverageParams,
  );
  const evidenceManifest = evidenceRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.body_sha256,
    classification: row.classification,
    redacted: Boolean(row.redacted),
    sharedWithInstitution: Boolean(row.share_with_institution),
  }));

  const nistRows = institution
    ? await tx.query<any>(
        `SELECT npe.item_code, npe.status, npe.gap_description
           FROM nist_profile_entries npe
           JOIN nist_profiles np ON np.id = npe.profile_id
          WHERE np.institution_id = $1 AND np.profile_type = 'current'
          ORDER BY npe.item_code`,
        [institution.id],
      )
    : [];
  const nist = nistRows.map((row) => ({ itemCode: row.item_code, status: row.status, gap: row.gap_description ?? null }));

  const frameworkRows = await tx.query<any>('SELECT key, name, version, verification_status FROM frameworks ORDER BY name');
  const used = new Set<string>();
  for (const row of coverageRows) used.add(`${row.framework_key}@${row.framework_version}`);
  for (const link of links) used.add(`${link.framework_key}@${link.framework_version}`);
  const frameworkVersions = frameworkRows
    .filter((row) => used.has(`${row.key}@${row.version}`) || input.reportType === 'coverage')
    .map((row) => ({ key: row.key, name: row.name, version: row.version, verificationStatus: row.verification_status }));

  let portfolio: any[] | undefined;
  if (input.reportType === 'supervisory_portfolio') {
    const portfolioRows = await tx.query<any>(
      `SELECT i.name, i.category,
              count(f.id) FILTER (WHERE f.status NOT IN ('resolved','closed','false_positive','accepted_risk'))::int AS open_findings,
              count(f.id) FILTER (WHERE f.technical_severity IN ('critical','high')
                    AND f.status NOT IN ('resolved','closed','false_positive','accepted_risk'))::int AS critical_high,
              count(f.id) FILTER (WHERE f.verified_at IS NULL AND f.status NOT IN ('false_positive'))::int AS unverified,
              max(CASE WHEN rp.target_date < current_date AND rp.status NOT IN ('verified','closed')
                       THEN (current_date - rp.target_date) END)::int AS worst_overdue
         FROM institutions i
         LEFT JOIN findings f ON f.institution_id = i.id AND f.data_mode = $1
         LEFT JOIN remediation_plans rp ON rp.finding_id = f.id
        WHERE i.data_mode = $1
        GROUP BY i.id, i.name, i.category
        ORDER BY critical_high DESC, open_findings DESC`,
      [ctx.mode],
    );
    portfolio = portfolioRows;
  }

  const limitations = [
    'Only checks recorded in the platform are represented. Areas with no executed check are counted as blocked or not assessed, never as clean.',
    'A published vulnerability identifier does not by itself demonstrate exploitability in this environment.',
    'Static mobile results do not constitute MASVS compliance and do not cover runtime behaviour.',
    'CVSS v4.0 expresses technical severity. Contextual banking risk is recorded separately and never adjusts the CVSS score.',
    'No production data, customer account or real payment channel was accessed during the assessment.',
    'Dynamic mobile testing, denial of service, uncontrolled credential guessing and social engineering are outside the permitted methods.',
  ];
  if (notAssessedRows.length) {
    limitations.push(`${notAssessedRows.length} recorded check(s) were blocked, skipped or errored and are listed in the coverage section.`);
  }
  if (institution && !nist.length) {
    limitations.push('No NIST CSF 2.0 profile has been recorded for this institution, so framework coverage cannot be stated.');
  }

  const periodStart = input.periodStart ?? (engagement?.testing_window_start ? new Date(engagement.testing_window_start).toISOString().slice(0, 10) : null);
  const periodEnd = input.periodEnd ?? (engagement?.testing_window_end ? new Date(engagement.testing_window_end).toISOString().slice(0, 10) : null);

  return {
    snapshotVersion: 1,
    dataMode: ctx.mode,
    reportType: input.reportType,
    title: input.title ?? defaultTitle(input.reportType, engagement?.code ?? null, institution?.name ?? null),
    generatedAt: new Date().toISOString(),
    institution,
    engagement: engagement
      ? {
          id: engagement.id,
          code: engagement.code,
          name: engagement.name,
          status: engagement.status,
          authorizationRef: engagement.authorization_ref ?? null,
          scopeApprovedAt: engagement.scope_approved_at ? new Date(engagement.scope_approved_at).toISOString().slice(0, 10) : null,
          scopeExpiresAt: engagement.scope_expires_at ? new Date(engagement.scope_expires_at).toISOString().slice(0, 10) : null,
        }
      : null,
    period: { start: periodStart, end: periodEnd },
    summary,
    findings,
    coverage: coverageRows,
    notAssessed: notAssessedRows.map((row) => ({
      framework: row.framework_key,
      itemCode: row.framework_item_code,
      checkKey: row.check_key,
      status: row.status,
      reason: row.notes ?? 'No reason recorded.',
    })),
    nist,
    remediation,
    evidenceManifest,
    frameworkVersions,
    portfolio,
    limitations,
  };
}

function defaultTitle(reportType: ReportType, engagementCode: string | null, institutionName: string | null): string {
  const labels: Record<ReportType, string> = {
    executive: 'Executive summary',
    technical: 'Technical assessment report',
    supervisory_portfolio: 'Supervisory portfolio report',
    remediation_status: 'Remediation status report',
    coverage: 'Assessment coverage report',
  };
  return `${labels[reportType]}${engagementCode ? ` - ${engagementCode}` : institutionName ? ` - ${institutionName}` : ''}`;
}

export async function listReports(
  tx: Tx,
  ctx: RequestContext,
  filters: { institutionId?: string; engagementId?: string; status?: string; reportType?: string } = {},
) {
  if (!can(ctx.user, 'report:read')) throw new ForbiddenError('Missing permission: report:read');
  const params: unknown[] = [ctx.mode];
  const clauses = ['r.data_mode = $1'];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`r.institution_id = $${params.length}`);
  }
  if (filters.engagementId) {
    params.push(filters.engagementId);
    clauses.push(`r.engagement_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`r.status = $${params.length}`);
  }
  if (filters.reportType) {
    params.push(filters.reportType);
    clauses.push(`r.report_type = $${params.length}`);
  }
  return tx.query(
    `SELECT r.id, r.report_type, r.title, r.status, r.version, r.generated_at, r.approved_at, r.published_at,
            r.institution_id, r.engagement_id, r.data_mode, r.confidentiality,
            i.name AS institution_name, e.code AS engagement_code,
            gu.name AS generated_by_name, au.name AS approved_by_name,
            (SELECT count(*)::int FROM report_approvals ra WHERE ra.report_id = r.id) AS review_count
       FROM reports r
       LEFT JOIN institutions i ON i.id = r.institution_id
       LEFT JOIN engagements e ON e.id = r.engagement_id
       LEFT JOIN users gu ON gu.id = r.generated_by
       LEFT JOIN users au ON au.id = r.approved_by
      WHERE ${clauses.join(' AND ')}
      ORDER BY r.generated_at DESC LIMIT 200`,
    params,
  );
}

export async function getReport(tx: Tx, ctx: RequestContext, reportId: string) {
  if (!can(ctx.user, 'report:read')) throw new ForbiddenError('Missing permission: report:read');
  const report = await tx.queryOne<any>(
    `SELECT r.*, i.name AS institution_name, e.code AS engagement_code, gu.name AS generated_by_name, au.name AS approved_by_name
       FROM reports r
       LEFT JOIN institutions i ON i.id = r.institution_id
       LEFT JOIN engagements e ON e.id = r.engagement_id
       LEFT JOIN users gu ON gu.id = r.generated_by
       LEFT JOIN users au ON au.id = r.approved_by
      WHERE r.id = $1 AND r.data_mode = $2`,
    [reportId, ctx.mode],
  );
  if (!report) throw new NotFoundError('Report not found');
  const approvals = await tx.query(
    `SELECT ra.*, u.name AS reviewer_name, u.role AS reviewer_role
       FROM report_approvals ra JOIN users u ON u.id = ra.reviewer_id
      WHERE ra.report_id = $1 ORDER BY ra.created_at`,
    [reportId],
  );
  return { report, approvals };
}

export async function generateReport(
  tx: Tx,
  ctx: RequestContext,
  input: {
    reportType: ReportType;
    institutionId?: string | null;
    engagementId?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    title?: string;
    notes?: string;
  },
) {
  if (!can(ctx.user, 'report:generate')) throw new ForbiddenError('Missing permission: report:generate');
  if (ctx.user.role === 'institution_contact') throw new ForbiddenError('Institution contacts cannot generate supervisory reports');
  const snapshot = await buildSnapshot(tx, ctx, input);
  const inserted = await tx.queryOne<{ id: string }>(
    `INSERT INTO reports (institution_id, engagement_id, report_type, title, period_start, period_end, status,
                          generated_by, framework_versions, snapshot, data_mode, confidentiality, notes)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,'confidential_supervisory',$11)
     RETURNING id`,
    [
      snapshot.institution?.id ?? null,
      snapshot.engagement?.id ?? null,
      input.reportType,
      snapshot.title,
      snapshot.period.start,
      snapshot.period.end,
      ctx.user.id,
      JSON.stringify(snapshot.frameworkVersions),
      JSON.stringify(snapshot),
      ctx.mode,
      input.notes ?? null,
    ],
  );
  await recordAudit(
    {
      action: 'report.generated',
      entityType: 'report',
      entityId: inserted!.id,
      institutionId: snapshot.institution?.id ?? null,
      engagementId: snapshot.engagement?.id ?? null,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { reportType: input.reportType, findings: snapshot.findings.length, summary: snapshot.summary },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { id: inserted!.id, snapshot };
}

export async function submitReportForReview(tx: Tx, ctx: RequestContext, reportId: string) {
  if (!can(ctx.user, 'report:generate')) throw new ForbiddenError('Missing permission: report:generate');
  const report = await tx.queryOne<any>('SELECT * FROM reports WHERE id = $1 AND data_mode = $2', [reportId, ctx.mode]);
  if (!report) throw new NotFoundError('Report not found');
  if (!['draft', 'changes_requested'].includes(report.status)) {
    throw new ConflictError('Only a draft or a returned report can be submitted for review');
  }
  await tx.query(`UPDATE reports SET status = 'in_review' WHERE id = $1`, [reportId]);
  await recordAudit(
    {
      action: 'report.submitted',
      entityType: 'report',
      entityId: reportId,
      institutionId: report.institution_id,
      engagementId: report.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { title: report.title },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function reviewReport(
  tx: Tx,
  ctx: RequestContext,
  reportId: string,
  input: { decision: 'approve' | 'return' | 'comment'; comments?: string },
) {
  if (!can(ctx.user, 'report:approve')) throw new ForbiddenError('Missing permission: report:approve');
  const report = await tx.queryOne<any>('SELECT * FROM reports WHERE id = $1 AND data_mode = $2', [reportId, ctx.mode]);
  if (!report) throw new NotFoundError('Report not found');
  if (report.generated_by === ctx.user.id) {
    throw new ForbiddenError('Separation of duties: a report cannot be reviewed by the person who generated it');
  }
  if (input.decision === 'approve') {
    if (report.status !== 'in_review') throw new ConflictError('Only a report under review can be approved');
    if (!input.comments || input.comments.trim().length < 20) {
      throw new ValidationError('Record the basis for approval in at least 20 characters so the decision is auditable');
    }
    await tx.query(`UPDATE reports SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [reportId, ctx.user.id]);
  } else if (input.decision === 'return') {
    if (report.status !== 'in_review') throw new ConflictError('Only a report under review can be returned');
    if (!input.comments || input.comments.trim().length < 10) {
      throw new ValidationError('Explain what must change before the report can be resubmitted');
    }
    await tx.query(`UPDATE reports SET status = 'changes_requested' WHERE id = $1`, [reportId]);
  } else if (!input.comments) {
    throw new ValidationError('A comment is required');
  }
  await tx.query(`INSERT INTO report_approvals (report_id, reviewer_id, decision, comments) VALUES ($1,$2,$3,$4)`, [
    reportId,
    ctx.user.id,
    input.decision,
    input.comments ?? null,
  ]);
  await recordAudit(
    {
      action: `report.${input.decision}`,
      entityType: 'report',
      entityId: reportId,
      institutionId: report.institution_id,
      engagementId: report.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { title: report.title, comments: input.comments ?? null },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function publishReport(tx: Tx, ctx: RequestContext, reportId: string) {
  if (!can(ctx.user, 'report:publish')) throw new ForbiddenError('Missing permission: report:publish');
  const report = await tx.queryOne<any>('SELECT * FROM reports WHERE id = $1 AND data_mode = $2', [reportId, ctx.mode]);
  if (!report) throw new NotFoundError('Report not found');
  if (report.status !== 'approved') throw new ConflictError('Only an approved report can be published');
  await tx.query(`UPDATE reports SET status = 'published', published_at = now() WHERE id = $1`, [reportId]);
  await recordAudit(
    {
      action: 'report.published',
      entityType: 'report',
      entityId: reportId,
      institutionId: report.institution_id,
      engagementId: report.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { title: report.title },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export function renderReportJson(snapshot: ReportSnapshot): Buffer {
  return Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8');
}
