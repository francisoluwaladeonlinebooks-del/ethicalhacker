import { sha256 } from '@/lib/crypto';
import { scoreMetrics, scoreVector, type CvssMetrics } from '@/lib/cvss/engine';
import type { Tx } from '@/lib/db/pool';
import { withSystem } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { computeContextualRisk, computePriority, defaultDimensions, type RiskDimensions, type TechnicalSeverity } from '@/lib/domain/risk';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import type { FindingDraft } from '@/lib/engines/types';

export type FindingStatus =
  | 'new'
  | 'needs_verification'
  | 'confirmed'
  | 'false_positive'
  | 'accepted_risk'
  | 'remediation_in_progress'
  | 'ready_for_retest'
  | 'resolved'
  | 'reopened'
  | 'closed';

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  new: 'New',
  needs_verification: 'Needs verification',
  confirmed: 'Confirmed',
  false_positive: 'False positive',
  accepted_risk: 'Accepted risk',
  remediation_in_progress: 'Remediation in progress',
  ready_for_retest: 'Ready for retest',
  resolved: 'Resolved',
  reopened: 'Reopened',
  closed: 'Closed',
};

export const TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  new: ['needs_verification', 'confirmed', 'false_positive', 'accepted_risk'],
  needs_verification: ['confirmed', 'false_positive', 'accepted_risk'],
  confirmed: ['remediation_in_progress', 'ready_for_retest', 'accepted_risk', 'resolved', 'false_positive'],
  false_positive: ['reopened'],
  accepted_risk: ['reopened', 'remediation_in_progress'],
  remediation_in_progress: ['ready_for_retest', 'accepted_risk', 'reopened'],
  ready_for_retest: ['resolved', 'reopened', 'remediation_in_progress'],
  resolved: ['reopened', 'closed'],
  reopened: ['needs_verification', 'confirmed', 'remediation_in_progress'],
  closed: ['reopened'],
};

export function findingFingerprint(input: { title: string; asset?: string | null; endpoint?: string | null; category: string }): string {
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return sha256([normalise(input.title), normalise(input.asset ?? ''), normalise(input.endpoint ?? ''), normalise(input.category)].join('|'));
}

export type CreateFindingInput = FindingDraft & {
  engagementId: string;
  institutionId: string;
  applicationId: string | null;
  createdBy: string;
  isAiSuggested?: boolean;
  status?: FindingStatus;
  dataMode?: 'demo' | 'live';
  testResultId?: string | null;
};

/** Create a finding, de-duplicating identical observations within an engagement. */
export async function createFinding(
  tx: Tx,
  ctx: RequestContext | null,
  input: CreateFindingInput,
): Promise<{ id: string; reference: string; created: boolean }> {
  const fingerprint = findingFingerprint(input);
  const existing = await tx.queryOne<{ id: string; reference: string }>(
    'SELECT id, reference FROM findings WHERE engagement_id = $1 AND fingerprint = $2 LIMIT 1',
    [input.engagementId, fingerprint],
  );
  if (existing) return { id: existing.id, reference: existing.reference, created: false };

  const seqRow = await tx.queryOne<{ nextval: string }>(`SELECT nextval('finding_ref_seq') AS nextval`);
  const reference = `FND-${new Date().getFullYear()}-${String(seqRow!.nextval).padStart(4, '0')}`;

  let technicalSeverity: TechnicalSeverity = 'unscored';
  let cvssScore: number | null = null;
  let cvssVector: string | null = null;
  if (input.cvss) {
    try {
      const result = scoreMetrics(input.cvss);
      technicalSeverity = result.severity;
      cvssScore = result.score;
      cvssVector = result.vector;
    } catch {
      technicalSeverity = 'unscored';
    }
  }

  const status: FindingStatus = input.status ?? 'needs_verification';
  const dimensions = defaultDimensions(technicalSeverity);
  const contextual = computeContextualRisk(dimensions);
  const priority = computePriority(technicalSeverity, contextual.rating);

  const row = await tx.queryOne<{ id: string }>(
    `INSERT INTO findings (reference, engagement_id, institution_id, application_id, title, category, subcategory, asset,
        endpoint, app_version, description, business_impact, cia_impact, detection_method, confidence, status,
        technical_severity, cvss_vector, cvss_score, cvss_version, contextual_rating, contextual_score, priority_rank,
        priority_reason, root_cause, remediation_summary, owner_team, due_date, fingerprint, is_ai_suggested, data_mode, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
     RETURNING id`,
    [
      reference,
      input.engagementId,
      input.institutionId,
      input.applicationId,
      input.title,
      input.category,
      input.subcategory ?? null,
      input.asset,
      input.endpoint ?? null,
      input.appVersion ?? null,
      input.description,
      input.businessImpact,
      JSON.stringify({ confidentiality: input.cvss?.VC ?? 'N', integrity: input.cvss?.VI ?? 'N', availability: input.cvss?.VA ?? 'N' }),
      input.detectionMethod,
      input.confidence,
      status,
      technicalSeverity,
      cvssVector,
      cvssScore,
      '4.0',
      contextual.rating,
      contextual.score,
      Number(priority.band.slice(1)),
      priority.reason,
      input.remediation.rootCause,
      input.remediation.shortTerm,
      input.remediation.ownerTeam,
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      fingerprint,
      Boolean(input.isAiSuggested),
      input.dataMode ?? 'demo',
      input.createdBy,
    ],
  );
  const findingId = row!.id;

  if (cvssVector) {
    await tx.query(
      `INSERT INTO cvss_scores (finding_id, institution_id, vector, score, severity, metrics, rationale, is_current, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
      [
        findingId,
        input.institutionId,
        cvssVector,
        cvssScore,
        technicalSeverity,
        JSON.stringify(input.cvss),
        'Initial CVSS v4.0 score recorded from the assessment engine metric set. Review before publishing.',
        input.createdBy,
      ],
    );
  }
  await tx.query(
    `INSERT INTO risk_assessments (finding_id, institution_id, dimensions, score, rating, rationale, assessor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [findingId, input.institutionId, JSON.stringify(dimensions), contextual.score, contextual.rating, contextual.rationale, input.createdBy],
  );

  await tx.query(
    `INSERT INTO remediation_plans (finding_id, institution_id, root_cause, containment, short_term, permanent_fix, owner_team,
        verification_criteria, retest_procedure, evidence_required, priority, target_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (finding_id) DO NOTHING`,
    [
      findingId,
      input.institutionId,
      input.remediation.rootCause,
      input.remediation.containment ?? null,
      input.remediation.shortTerm,
      input.remediation.permanentFix,
      input.remediation.ownerTeam,
      input.remediation.verificationCriteria,
      input.remediation.retestProcedure,
      input.remediation.evidenceRequired,
      input.remediation.priority,
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      input.createdBy,
    ],
  );

  for (const link of input.frameworkLinks ?? []) {
    // Only persist mappings to real catalogue items - never fabricate mappings.
    const item = await tx.queryOne<{ code: string }>(
      `SELECT fi.code FROM framework_items fi JOIN frameworks f ON f.id = fi.framework_id
        WHERE f.key = $1 AND f.version = $2 AND fi.code = $3 LIMIT 1`,
      [link.frameworkKey, link.frameworkVersion, link.itemCode],
    );
    if (!item) continue;
    await tx.query(
      `INSERT INTO finding_framework_links (finding_id, institution_id, framework_key, framework_version, item_code, relationship, rationale, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (finding_id, framework_key, item_code) DO NOTHING`,
      [
        findingId,
        input.institutionId,
        link.frameworkKey,
        link.frameworkVersion,
        link.itemCode,
        link.relationship ?? 'supports',
        link.rationale ?? null,
        input.createdBy,
      ],
    );
  }

  for (const evidenceId of input.evidenceIds ?? []) {
    await tx.query(
      `INSERT INTO finding_evidence (finding_id, evidence_id, institution_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [findingId, evidenceId, input.institutionId],
    );
  }

  await tx.query(
    `INSERT INTO finding_history (finding_id, institution_id, actor_id, action, from_status, to_status, changes)
     VALUES ($1,$2,$3,'created',NULL,$4,$5)`,
    [findingId, input.institutionId, input.createdBy, status, JSON.stringify({ source: input.detectionMethod })],
  );

  if (ctx) {
    await recordAudit(
      {
        action: 'finding.created',
        entityType: 'finding',
        entityId: findingId,
        institutionId: input.institutionId,
        engagementId: input.engagementId,
        actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
        metadata: { reference, title: input.title, severity: technicalSeverity, cvss: cvssScore },
        ip: ctx.ip,
        dataMode: ctx.mode,
      },
      tx,
    );
  }
  return { id: findingId, reference, created: true };
}

export async function listFindings(
  tx: Tx,
  ctx: RequestContext,
  filters: { institutionId?: string; engagementId?: string; applicationId?: string; severity?: string; status?: string; search?: string; band?: string } = {},
) {
  const params: unknown[] = [ctx.mode];
  const clauses = ['f.data_mode = $1'];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`f.institution_id = $${params.length}`);
  }
  if (filters.engagementId) {
    params.push(filters.engagementId);
    clauses.push(`f.engagement_id = $${params.length}`);
  }
  if (filters.applicationId) {
    params.push(filters.applicationId);
    clauses.push(`f.application_id = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    clauses.push(`f.technical_severity = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`f.status = $${params.length}`);
  }
  if (filters.band) {
    params.push(Number(filters.band));
    clauses.push(`f.priority_rank = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(f.title ILIKE $${params.length} OR f.reference ILIKE $${params.length} OR f.asset ILIKE $${params.length})`);
  }
  if (ctx.user.role === 'institution_contact') {
    // Institution contacts only see findings that are confirmed (or later in
    // the lifecycle) - unverified assessor observations stay internal.
    clauses.push(`f.status IN ('confirmed','remediation_in_progress','ready_for_retest','resolved','accepted_risk','reopened','closed')`);
  }
  return tx.query(
    `SELECT f.*, i.name AS institution_name, a.name AS application_name, e.code AS engagement_code,
            (SELECT count(*)::int FROM finding_evidence fe WHERE fe.finding_id = f.id) AS evidence_count
       FROM findings f
       JOIN institutions i ON i.id = f.institution_id
       LEFT JOIN applications a ON a.id = f.application_id
       JOIN engagements e ON e.id = f.engagement_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY f.priority_rank ASC, f.cvss_score DESC NULLS LAST, f.created_at DESC
      LIMIT 300`,
    params,
  );
}

export async function getFindingDetail(tx: Tx, ctx: RequestContext, findingId: string) {
  const finding = await tx.queryOne<any>(
    `SELECT f.*, i.name AS institution_name, a.name AS application_name, a.channel AS application_channel,
            e.code AS engagement_code, e.name AS engagement_name, u.name AS created_by_name, v.name AS verified_by_name
       FROM findings f
       JOIN institutions i ON i.id = f.institution_id
       LEFT JOIN applications a ON a.id = f.application_id
       JOIN engagements e ON e.id = f.engagement_id
       LEFT JOIN users u ON u.id = f.created_by
       LEFT JOIN users v ON v.id = f.verified_by
      WHERE f.id = $1`,
    [findingId],
  );
  if (!finding) throw new NotFoundError('Finding not found');
  if (ctx.user.role === 'institution_contact' && ['new', 'needs_verification'].includes(finding.status)) {
    throw new ForbiddenError('This finding has not yet been validated by the assessment team');
  }

  const frameworkLinks = await tx.query(
    `SELECT l.*, fi.title, fi.item_type, fi.description
       FROM finding_framework_links l
       LEFT JOIN frameworks fw ON fw.key = l.framework_key AND fw.version = l.framework_version
       LEFT JOIN framework_items fi ON fi.framework_id = fw.id AND fi.code = l.item_code
      WHERE l.finding_id = $1 ORDER BY l.framework_key, l.item_code`,
    [findingId],
  );
  const evidence = await tx.query(
    `SELECT e.*, fe.caption FROM evidence e JOIN finding_evidence fe ON fe.evidence_id = e.id
      WHERE fe.finding_id = $1 ORDER BY e.created_at`,
    [findingId],
  );
  const history = await tx.query(
    `SELECT h.*, u.name AS actor_name FROM finding_history h LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.finding_id = $1 ORDER BY h.created_at DESC`,
    [findingId],
  );
  const scores = await tx.query('SELECT * FROM cvss_scores WHERE finding_id = $1 ORDER BY created_at DESC', [findingId]);
  const risks = await tx.query('SELECT * FROM risk_assessments WHERE finding_id = $1 ORDER BY created_at DESC', [findingId]);
  const remediation = await tx.queryOne('SELECT * FROM remediation_plans WHERE finding_id = $1', [findingId]);
  const submissions = await tx.query(
    `SELECT s.*, u.name AS submitted_by_name FROM remediation_submissions s LEFT JOIN users u ON u.id = s.submitted_by
      WHERE s.finding_id = $1 ORDER BY s.created_at DESC`,
    [findingId],
  );
  const retests = await tx.query('SELECT * FROM retests WHERE finding_id = $1 ORDER BY created_at DESC', [findingId]);
  const testResults = await tx.query(
    `SELECT tr.*, fi.title AS item_title FROM test_results tr LEFT JOIN framework_items fi ON fi.code = tr.framework_item_code
      WHERE tr.engagement_id = $1 AND tr.application_id IS NOT DISTINCT FROM $2 ORDER BY tr.executed_at DESC LIMIT 50`,
    [finding.engagement_id, finding.application_id],
  );
  const suggestions = await tx.query('SELECT * FROM ai_suggestions WHERE finding_id = $1 ORDER BY created_at DESC', [findingId]);

  return { finding, frameworkLinks, evidence, history, scores, risks, remediation, submissions, retests, testResults, suggestions };
}

export async function scoreFinding(
  tx: Tx,
  ctx: RequestContext,
  input: { findingId: string; vector: string; rationale?: string; dimensions?: RiskDimensions },
) {
  if (!can(ctx.user, 'finding:update')) throw new ForbiddenError('Missing permission: finding:update');
  const finding = await tx.queryOne<{ id: string; institution_id: string; engagement_id: string; title: string; reference: string }>(
    'SELECT id, institution_id, engagement_id, title, reference FROM findings WHERE id = $1',
    [input.findingId],
  );
  if (!finding) throw new NotFoundError('Finding not found');

  let result;
  try {
    result = scoreVector(input.vector);
  } catch (error) {
    throw new ValidationError(`CVSS v4.0 scoring failed: ${(error as Error).message}`);
  }

  await tx.query('UPDATE cvss_scores SET is_current = false WHERE finding_id = $1', [input.findingId]);
  await tx.query(
    `INSERT INTO cvss_scores (finding_id, institution_id, vector, score, severity, metrics, rationale, is_current, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
    [
      input.findingId,
      finding.institution_id,
      result.vector,
      result.score,
      result.severity,
      JSON.stringify(parseVectorSafely(result.vector)),
      input.rationale ?? 'Metric set reviewed by assessor.',
      ctx.user.id,
    ],
  );

  const dimensions = input.dimensions ?? defaultDimensions(result.severity);
  const contextual = computeContextualRisk(dimensions);
  const priority = computePriority(result.severity, contextual.rating);

  await tx.query(
    `UPDATE findings SET cvss_vector = $2, cvss_score = $3, technical_severity = $4, contextual_rating = $5,
            contextual_score = $6, priority_rank = $7, priority_reason = $8, updated_at = now() WHERE id = $1`,
    [input.findingId, result.vector, result.score, result.severity, contextual.rating, contextual.score, Number(priority.band.slice(1)), priority.reason],
  );
  await tx.query(
    `INSERT INTO risk_assessments (finding_id, institution_id, dimensions, score, rating, rationale, assessor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.findingId, finding.institution_id, JSON.stringify(dimensions), contextual.score, contextual.rating, contextual.rationale, ctx.user.id],
  );
  await tx.query(
    `INSERT INTO finding_history (finding_id, institution_id, actor_id, action, changes) VALUES ($1,$2,$3,'cvss_scored',$4)`,
    [finding.id, finding.institution_id, ctx.user.id, JSON.stringify({ vector: result.vector, score: result.score, severity: result.severity })],
  );
  await recordAudit(
    {
      action: 'finding.scored',
      entityType: 'finding',
      entityId: finding.id,
      institutionId: finding.institution_id,
      engagementId: finding.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { vector: result.vector, score: result.score, severity: result.severity, contextual: contextual.rating },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { ...result, contextual, priority };
}

function parseVectorSafely(vector: string): Record<string, string> {
  const metrics: Record<string, string> = {};
  for (const part of vector.replace('CVSS:4.0/', '').split('/')) {
    const [key, value] = part.split(':');
    if (key && value) metrics[key] = value;
  }
  return metrics;
}

export async function assessRisk(
  tx: Tx,
  ctx: RequestContext,
  input: { findingId: string; dimensions: RiskDimensions; rationale?: string },
) {
  if (!can(ctx.user, 'finding:update')) throw new ForbiddenError('Missing permission: finding:update');
  const finding = await tx.queryOne<{ institution_id: string; technical_severity: TechnicalSeverity; engagement_id: string }>(
    'SELECT institution_id, technical_severity, engagement_id FROM findings WHERE id = $1',
    [input.findingId],
  );
  if (!finding) throw new NotFoundError('Finding not found');
  const contextual = computeContextualRisk(input.dimensions);
  const priority = computePriority(finding.technical_severity, contextual.rating);
  await tx.query(
    `UPDATE findings SET contextual_rating = $2, contextual_score = $3, priority_rank = $4, priority_reason = $5, updated_at = now() WHERE id = $1`,
    [input.findingId, contextual.rating, contextual.score, Number(priority.band.slice(1)), priority.reason],
  );
  await tx.query(
    `INSERT INTO risk_assessments (finding_id, institution_id, dimensions, score, rating, rationale, assessor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.findingId, finding.institution_id, JSON.stringify(input.dimensions), contextual.score, contextual.rating, input.rationale ?? contextual.rationale, ctx.user.id],
  );
  await recordAudit(
    {
      action: 'finding.contextual_risk_assessed',
      entityType: 'finding',
      entityId: input.findingId,
      institutionId: finding.institution_id,
      engagementId: finding.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { rating: contextual.rating, score: contextual.score, priority: priority.band },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return contextual;
}

export async function transitionFinding(
  tx: Tx,
  ctx: RequestContext,
  input: { findingId: string; toStatus: FindingStatus; note?: string },
) {
  const finding = await tx.queryOne<any>('SELECT * FROM findings WHERE id = $1', [input.findingId]);
  if (!finding) throw new NotFoundError('Finding not found');
  const from = finding.status as FindingStatus;
  const to = input.toStatus;
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new ConflictError(`Cannot move a finding from "${FINDING_STATUS_LABELS[from]}" to "${FINDING_STATUS_LABELS[to]}"`);
  }

  const requiresVerification = ['confirmed', 'resolved', 'false_positive'].includes(to);
  if (requiresVerification && !can(ctx.user, 'finding:verify')) throw new ForbiddenError('Missing permission: finding:verify');
  if (['accepted_risk', 'closed'].includes(to) && !can(ctx.user, 'finding:close')) {
    throw new ForbiddenError('Missing permission: finding:close');
  }
  if (!requiresVerification && !can(ctx.user, 'finding:update')) throw new ForbiddenError('Missing permission: finding:update');

  const setting = await tx.queryOne<{ value: boolean }>(`SELECT value FROM settings WHERE key = 'require_independent_verification'`);
  if (requiresVerification && setting?.value !== false && finding.created_by === ctx.user.id) {
    throw new ForbiddenError('Independent verification required: the finding author cannot verify their own finding');
  }

  if (to === 'resolved') {
    const retest = await tx.queryOne<{ id: string }>(
      `SELECT id FROM retests WHERE finding_id = $1 AND result = 'resolved' AND verified_by IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [input.findingId],
    );
    if (!retest) throw new ConflictError('A verified retest showing the issue is resolved is required before closing this finding');
  }

  await tx.query(
    `UPDATE findings SET status = $2, updated_at = now(),
            verified_by = CASE WHEN $3 THEN $4 ELSE verified_by END,
            verified_at = CASE WHEN $3 THEN now() ELSE verified_at END,
            resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END,
            reopened_count = CASE WHEN $2 = 'reopened' THEN reopened_count + 1 ELSE reopened_count END
      WHERE id = $1`,
    [input.findingId, to, requiresVerification, ctx.user.id],
  );
  await tx.query(
    `INSERT INTO finding_history (finding_id, institution_id, actor_id, action, from_status, to_status, note)
     VALUES ($1,$2,$3,'status_transition',$4,$5,$6)`,
    [input.findingId, finding.institution_id, ctx.user.id, from, to, input.note ?? null],
  );
  await recordAudit(
    {
      action: 'finding.status_changed',
      entityType: 'finding',
      entityId: input.findingId,
      institutionId: finding.institution_id,
      engagementId: finding.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { reference: finding.reference, from, to, note: input.note ?? null },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { from, to };
}

export async function updateFinding(
  tx: Tx,
  ctx: RequestContext,
  findingId: string,
  patch: Partial<{ title: string; description: string; businessImpact: string; remediation_summary: string; owner_team: string; due_date: string; confidence: string; root_cause: string; compensating_controls: string }>,
) {
  if (!can(ctx.user, 'finding:update')) throw new ForbiddenError('Missing permission: finding:update');
  const finding = await tx.queryOne<any>('SELECT * FROM findings WHERE id = $1', [findingId]);
  if (!finding) throw new NotFoundError('Finding not found');
  if (ctx.user.role === 'institution_contact') throw new ForbiddenError('Institution contacts cannot modify assessment evidence');

  const fields = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (!fields.length) return finding;
  const setSql = fields.map(([key], index) => `${key} = $${index + 2}`).join(', ');
  await tx.query(`UPDATE findings SET ${setSql}, updated_at = now() WHERE id = $1`, [findingId, ...fields.map(([, value]) => value)]);
  await tx.query(
    `INSERT INTO finding_history (finding_id, institution_id, actor_id, action, changes) VALUES ($1,$2,$3,'updated',$4)`,
    [findingId, finding.institution_id, ctx.user.id, JSON.stringify(patch)],
  );
  await recordAudit(
    {
      action: 'finding.updated',
      entityType: 'finding',
      entityId: findingId,
      institutionId: finding.institution_id,
      engagementId: finding.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { fields: Object.keys(patch) },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { ...finding, ...patch };
}

export async function addFrameworkLink(
  tx: Tx,
  ctx: RequestContext,
  input: { findingId: string; frameworkKey: string; frameworkVersion: string; itemCode: string; relationship?: string; rationale?: string },
) {
  if (!can(ctx.user, 'finding:update')) throw new ForbiddenError('Missing permission: finding:update');
  const item = await tx.queryOne<{ code: string; title: string }>(
    `SELECT fi.code, fi.title FROM framework_items fi JOIN frameworks f ON f.id = fi.framework_id
      WHERE f.key = $1 AND f.version = $2 AND fi.code = $3`,
    [input.frameworkKey, input.frameworkVersion, input.itemCode],
  );
  if (!item) throw new ValidationError('The referenced framework item does not exist in the selected framework version');
  const finding = await tx.queryOne<{ institution_id: string; engagement_id: string }>('SELECT institution_id, engagement_id FROM findings WHERE id = $1', [input.findingId]);
  if (!finding) throw new NotFoundError('Finding not found');
  await tx.query(
    `INSERT INTO finding_framework_links (finding_id, institution_id, framework_key, framework_version, item_code, relationship, rationale, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (finding_id, framework_key, item_code) DO UPDATE SET relationship = EXCLUDED.relationship, rationale = EXCLUDED.rationale`,
    [input.findingId, finding.institution_id, input.frameworkKey, input.frameworkVersion, input.itemCode, input.relationship ?? 'supports', input.rationale ?? null, ctx.user.id],
  );
  await recordAudit(
    {
      action: 'finding.framework_link_added',
      entityType: 'finding',
      entityId: input.findingId,
      institutionId: finding.institution_id,
      engagementId: finding.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { framework: input.frameworkKey, version: input.frameworkVersion, item: input.itemCode },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

/** Flag findings whose fingerprint recurs across multiple institutions. */
export async function refreshSystemicFlags(): Promise<number> {
  return withSystem(async (tx) => {
    const rows = await tx.query<{ fingerprint: string; institutions: string }>(
      `SELECT fingerprint, count(DISTINCT institution_id)::text AS institutions FROM findings
        GROUP BY fingerprint HAVING count(DISTINCT institution_id) > 1`,
    );
    let updated = 0;
    for (const row of rows) {
      const result = await tx.query(
        `UPDATE findings SET is_systemic = true WHERE fingerprint = $1 AND technical_severity IN ('high','critical') AND is_systemic = false`,
        [row.fingerprint],
      );
      updated += (result as unknown as { rowCount?: number })?.rowCount ?? 0;
    }
    return updated;
  });
}

export type CorrelationGroup = {
  key: string;
  title: string;
  category: string;
  findingCount: number;
  institutions: number;
  applications: number;
  highestSeverity: string;
  frameworkItems: string[];
};

export async function correlateFindings(tx: Tx, ctx: RequestContext): Promise<CorrelationGroup[]> {
  const rows = await tx.query<any>(
    `SELECT f.category,
            count(*)::int AS finding_count,
            count(DISTINCT f.institution_id)::int AS institutions,
            count(DISTINCT f.application_id)::int AS applications,
            max(CASE f.technical_severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS severity_rank,
            array_agg(DISTINCT f.title) AS titles,
            array_remove(array_agg(DISTINCT l.item_code), NULL) AS framework_items
       FROM findings f
       LEFT JOIN finding_framework_links l ON l.finding_id = f.id
      WHERE f.data_mode = $1 AND f.status NOT IN ('false_positive','closed')
      GROUP BY f.category
      ORDER BY severity_rank DESC, finding_count DESC`,
    [ctx.mode],
  );
  const severityByRank: Record<number, string> = { 4: 'critical', 3: 'high', 2: 'medium', 1: 'low', 0: 'unscored' };
  return rows.map((row) => ({
    key: row.category,
    title: row.titles?.[0] ?? row.category,
    category: row.category,
    findingCount: row.finding_count,
    institutions: row.institutions,
    applications: row.applications,
    highestSeverity: severityByRank[row.severity_rank] ?? 'unscored',
    frameworkItems: (row.framework_items ?? []).slice(0, 6),
  }));
}

/** Create findings from a completed job's drafts (used by the assessment runner). */
export async function persistEngineFindings(
  tx: Tx,
  job: { id: string; engagement_id: string; institution_id: string; application_id: string | null; created_by: string | null },
  drafts: FindingDraft[],
  dataMode: 'demo' | 'live',
): Promise<{ created: number; deduplicated: number; ids: string[] }> {
  let created = 0;
  let deduplicated = 0;
  const ids: string[] = [];
  for (const draft of drafts) {
    const result = await createFinding(tx, null, {
      ...draft,
      engagementId: job.engagement_id,
      institutionId: job.institution_id,
      applicationId: job.application_id,
      createdBy: job.created_by ?? job.id,
      dataMode,
      status: draft.confidence === 'low' ? 'needs_verification' : 'needs_verification',
    });
    ids.push(result.id);
    if (result.created) created += 1;
    else deduplicated += 1;
  }
  return { created, deduplicated, ids };
}

export function frameworkCoverageSummary(rows: { framework_key: string; status: string; count: string }[]) {
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const bucket = map.get(row.framework_key) ?? {};
    bucket[row.status] = (bucket[row.status] ?? 0) + Number(row.count);
    map.set(row.framework_key, bucket);
  }
  return map;
}
