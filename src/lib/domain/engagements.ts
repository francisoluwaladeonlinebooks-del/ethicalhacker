import type { Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import type { ScopeAsset, ScopeExclusion } from '@/lib/scope';
import { summariseScope } from '@/lib/scope';

export type EngagementStatus =
  | 'draft'
  | 'pending_authorization'
  | 'authorized'
  | 'plan_review'
  | 'approved'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'cancelled';

export type EngagementRow = {
  id: string;
  institution_id: string;
  code: string;
  name: string;
  description: string | null;
  status: EngagementStatus;
  owner_id: string;
  authorization_ref: string | null;
  scope_approved_at: string | null;
  scope_expires_at: string | null;
  testing_window_start: string | null;
  testing_window_end: string | null;
  permitted_methods: string[];
  prohibited_actions: string[];
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  escalation_procedure: string | null;
  approved_by: string | null;
  approved_at: string | null;
  kill_switch_engaged: boolean;
  kill_switch_reason: string | null;
  max_requests_per_second: string | number;
  max_concurrency: number;
  max_requests_total: number;
  max_duration_minutes: number;
  data_mode: 'demo' | 'live';
  notes: string | null;
  created_at: string;
};

export const ENGAGEMENT_STATUS_LABELS: Record<EngagementStatus, string> = {
  draft: 'Draft',
  pending_authorization: 'Pending authorisation',
  authorized: 'Authorised',
  plan_review: 'Plan review',
  approved: 'Approved',
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PERMITTED_METHOD_OPTIONS = [
  { key: 'passive_review', label: 'Passive review of responses and configuration' },
  { key: 'unauthenticated_http', label: 'Unauthenticated HTTP GET/HEAD requests' },
  { key: 'authenticated_testing', label: 'Authenticated testing with approved test accounts' },
  { key: 'input_validation', label: 'Non-destructive input validation probes' },
  { key: 'object_authorization', label: 'Object-level authorisation tests using synthetic records' },
  { key: 'function_authorization', label: 'Function-level authorisation tests using approved roles' },
  { key: 'rate_limit_check', label: 'Bounded rate-limit behaviour checks' },
  { key: 'static_artefact', label: 'Static analysis of supplied mobile artefacts and source' },
  { key: 'dynamic_mobile', label: 'Dynamic mobile testing on institution-approved devices' },
] as const;

export const DEFAULT_PROHIBITED_ACTIONS = [
  'Denial of service, stress or volume testing of any kind',
  'Password guessing, spraying or credential stuffing',
  'Real money transfers or modification of live balances',
  'Access to customer accounts or real customer data',
  'Persistence, backdoors, lateral movement or privilege retention',
  'Social engineering of staff or customers',
  'Testing outside the approved window or against unapproved assets',
  'Destructive testing against production systems',
];

export async function listEngagements(tx: Tx, ctx: RequestContext, filters: { institutionId?: string; status?: string } = {}) {
  const params: unknown[] = [ctx.mode];
  const clauses = ['e.data_mode = $1'];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`e.institution_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`e.status = $${params.length}`);
  }
  return tx.query(
    `SELECT e.*, i.name AS institution_name, i.category,
            u.name AS owner_name,
            (SELECT count(*)::int FROM scope_assets s WHERE s.engagement_id = e.id) AS scope_assets,
            (SELECT count(*)::int FROM findings f WHERE f.engagement_id = e.id) AS finding_count,
            (SELECT count(*)::int FROM assessment_jobs j WHERE j.engagement_id = e.id AND j.status IN ('queued','running')) AS active_jobs
       FROM engagements e
       JOIN institutions i ON i.id = e.institution_id
       LEFT JOIN users u ON u.id = e.owner_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.created_at DESC`,
    params,
  );
}

export async function getEngagement(tx: Tx, id: string) {
  return tx.queryOne<EngagementRow>('SELECT * FROM engagements WHERE id = $1', [id]);
}

export async function getEngagementDetail(tx: Tx, ctx: RequestContext, id: string) {
  const engagement = await getEngagement(tx, id);
  if (!engagement) throw new NotFoundError('Engagement not found');

  const institution = await tx.queryOne<{ id: string; name: string; code: string; category: string; risk_tier: string }>(
    'SELECT id, name, code, category, risk_tier FROM institutions WHERE id = $1',
    [engagement.institution_id],
  );
  const assets = await tx.query<ScopeAsset & { id: string }>('SELECT * FROM scope_assets WHERE engagement_id = $1 ORDER BY asset_type, value', [id]);
  const exclusions = await tx.query<ScopeExclusion>('SELECT * FROM scope_exclusions WHERE engagement_id = $1', [id]);
  const authorization = await tx.query(
    'SELECT * FROM authorization_records WHERE engagement_id = $1 ORDER BY created_at DESC',
    [id],
  );
  const applications = await tx.query(
    `SELECT a.* FROM applications a JOIN engagement_applications ea ON ea.application_id = a.id WHERE ea.engagement_id = $1`,
    [id],
  );
  const plans = await tx.query('SELECT * FROM test_plans WHERE engagement_id = $1 ORDER BY version DESC', [id]);
  const jobs = await tx.query(
    `SELECT j.*, (SELECT count(*)::int FROM job_checks c WHERE c.job_id = j.id) AS check_count,
            (SELECT count(*)::int FROM job_checks c WHERE c.job_id = j.id AND c.status IN ('passed','failed','needs_verification')) AS completed_checks
       FROM assessment_jobs j WHERE j.engagement_id = $1 ORDER BY j.created_at DESC`,
    [id],
  );
  const members = await tx.query(
    `SELECT m.*, u.name, u.email, u.role FROM engagement_members m JOIN users u ON u.id = m.user_id WHERE m.engagement_id = $1`,
    [id],
  );
  const findingsSummary = await tx.query<{ technical_severity: string; count: string }>(
    `SELECT technical_severity, count(*)::text AS count FROM findings WHERE engagement_id = $1 GROUP BY technical_severity`,
    [id],
  );
  const operational = await assertEngagementOperational(tx, id, {});

  return {
    engagement,
    institution,
    assets,
    exclusions,
    authorization,
    applications,
    plans,
    jobs,
    members,
    findingsSummary,
    operational,
    scopeSummary: summariseScope(assets, exclusions),
  };
}

function normaliseArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export async function createEngagement(
  tx: Tx,
  ctx: RequestContext,
  input: {
    institutionId: string;
    name: string;
    description?: string;
    applicationIds: string[];
    ownerId?: string;
    authorizationRef?: string;
    authorizedByName?: string;
    authorizedByRole?: string;
    authorizedAt?: string;
    validFrom?: string;
    validTo?: string;
    scopeExpiresAt?: string;
    testingWindowStart?: string;
    testingWindowEnd?: string;
    permittedMethods: string[];
    prohibitedActions?: string[];
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    escalationProcedure?: string;
    assets: {
      assetType: ScopeAsset['asset_type'];
      value: string;
      pathPrefix?: string;
      scheme?: string;
      port?: number;
      allowedMethods?: string[];
      approvedPaths?: string[];
      allowSubdomains?: boolean;
      isTrainingRange?: boolean;
      ownershipVerified?: boolean;
      notes?: string;
    }[];
    exclusions?: { assetType: string; value: string; reason: string }[];
    limits?: { maxRequestsPerSecond?: number; maxConcurrency?: number; maxRequestsTotal?: number; maxDurationMinutes?: number };
  },
) {
  if (!can(ctx.user, 'engagement:create')) throw new ForbiddenError('Missing permission: engagement:create');
  if (!input.name?.trim()) throw new ValidationError('Engagement name is required');
  if (!input.applicationIds?.length) throw new ValidationError('Select at least one application to assess');
  if (!input.assets?.length) throw new ValidationError('At least one authorised scope asset is required');
  if (!input.authorizationRef?.trim()) throw new ValidationError('Written authorisation reference is required');
  if (!input.permittedMethods?.length) throw new ValidationError('Select at least one permitted testing method');

  const institution = await tx.queryOne<{ id: string; data_mode: string; name: string }>(
    'SELECT id, data_mode, name FROM institutions WHERE id = $1',
    [input.institutionId],
  );
  if (!institution) throw new NotFoundError('Institution not found');
  if (institution.data_mode !== ctx.mode) throw new ValidationError('Institution belongs to a different platform mode');

  for (const applicationId of input.applicationIds) {
    const application = await tx.queryOne<{ institution_id: string }>('SELECT institution_id FROM applications WHERE id = $1', [applicationId]);
    if (!application || application.institution_id !== input.institutionId) {
      throw new ValidationError('All applications must belong to the selected institution');
    }
  }

  for (const asset of input.assets) {
    if (!asset.value?.trim()) throw new ValidationError('Scope asset values cannot be empty');
    if (asset.assetType === 'cidr' && !asset.value.includes('/')) throw new ValidationError(`CIDR asset "${asset.value}" must include a prefix length`);
    if ((asset.assetType === 'url' || asset.assetType === 'api_endpoint') && asset.value.includes('://')) {
      try {
        new URL(asset.value);
      } catch {
        throw new ValidationError(`Scope asset "${asset.value}" is not a valid URL`);
      }
    }
  }

  const seq = await tx.queryOne<{ nextval: string }>(`SELECT nextval('engagement_ref_seq') AS nextval`);
  const code = `ENG-${new Date().getFullYear()}-${String(seq!.nextval).padStart(4, '0')}`;

  const engagement = await tx.queryOne<EngagementRow>(
    `INSERT INTO engagements (institution_id, code, name, description, status, owner_id, authorization_ref,
        scope_expires_at, testing_window_start, testing_window_end, permitted_methods, prohibited_actions,
        emergency_contact_name, emergency_contact_phone, escalation_procedure,
        max_requests_per_second, max_concurrency, max_requests_total, max_duration_minutes, data_mode, created_by)
     VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [
      input.institutionId,
      code,
      input.name.trim(),
      input.description ?? null,
      input.ownerId ?? ctx.user.id,
      input.authorizationRef.trim(),
      input.scopeExpiresAt ?? input.validTo ?? null,
      input.testingWindowStart ?? null,
      input.testingWindowEnd ?? null,
      JSON.stringify(input.permittedMethods),
      JSON.stringify(input.prohibitedActions?.length ? input.prohibitedActions : DEFAULT_PROHIBITED_ACTIONS),
      input.emergencyContactName ?? null,
      input.emergencyContactPhone ?? null,
      input.escalationProcedure ?? null,
      input.limits?.maxRequestsPerSecond ?? 2,
      input.limits?.maxConcurrency ?? 2,
      input.limits?.maxRequestsTotal ?? 2000,
      input.limits?.maxDurationMinutes ?? 120,
      ctx.mode,
      ctx.user.id,
    ],
  );

  for (const applicationId of input.applicationIds) {
    await tx.query('INSERT INTO engagement_applications (engagement_id, application_id, institution_id) VALUES ($1,$2,$3)', [
      engagement!.id,
      applicationId,
      input.institutionId,
    ]);
  }

  await tx.query('INSERT INTO engagement_members (engagement_id, institution_id, user_id, role_in_engagement) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
    engagement!.id,
    input.institutionId,
    ctx.user.id,
    'lead_assessor',
  ]);
  if (input.ownerId && input.ownerId !== ctx.user.id) {
    await tx.query('INSERT INTO engagement_members (engagement_id, institution_id, user_id, role_in_engagement) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
      engagement!.id,
      input.institutionId,
      input.ownerId,
      'assessor',
    ]);
  }

  await replaceScope(tx, ctx, engagement!.id, input.institutionId, input.assets, input.exclusions ?? []);

  if (input.authorizationRef) {
    await recordAuthorization(tx, ctx, {
      engagementId: engagement!.id,
      reference: input.authorizationRef,
      authorizedByName: input.authorizedByName ?? 'Institution authorised representative',
      authorizedByRole: input.authorizedByRole ?? 'Chief Information Security Officer',
      authorizedAt: input.authorizedAt ?? new Date().toISOString(),
      validFrom: input.validFrom ?? new Date().toISOString(),
      validTo: input.validTo ?? input.scopeExpiresAt ?? new Date(Date.now() + 30 * 86400000).toISOString(),
      permittedMethods: input.permittedMethods,
      prohibitedActions: input.prohibitedActions?.length ? input.prohibitedActions : DEFAULT_PROHIBITED_ACTIONS,
      testingWindowStart: input.testingWindowStart,
      testingWindowEnd: input.testingWindowEnd,
    });
  }

  await recordAudit(
    {
      action: 'engagement.created',
      entityType: 'engagement',
      entityId: engagement!.id,
      institutionId: input.institutionId,
      engagementId: engagement!.id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { code, name: engagement!.name, assets: input.assets.length, applications: input.applicationIds.length },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      dataMode: ctx.mode,
    },
    tx,
  );
  return engagement!;
}

export async function replaceScope(
  tx: Tx,
  ctx: RequestContext,
  engagementId: string,
  institutionId: string,
  assets: Parameters<typeof createEngagement>[2]['assets'],
  exclusions: { assetType: string; value: string; reason: string }[],
) {
  if (!can(ctx.user, 'engagement:update')) throw new ForbiddenError('Missing permission: engagement:update');
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new NotFoundError('Engagement not found');
  if (!['draft', 'pending_authorization'].includes(engagement.status)) {
    throw new ConflictError('Scope can only be modified before authorisation. Create a new engagement version for approved scope changes.');
  }
  await tx.query('DELETE FROM scope_assets WHERE engagement_id = $1', [engagementId]);
  await tx.query('DELETE FROM scope_exclusions WHERE engagement_id = $1', [engagementId]);
  for (const asset of assets) {
    await tx.query(
      `INSERT INTO scope_assets (engagement_id, institution_id, asset_type, value, path_prefix, scheme, port,
          allowed_methods, approved_paths, allow_subdomains, is_training_range, ownership_verified, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (engagement_id, asset_type, value, path_prefix) DO NOTHING`,
      [
        engagementId,
        institutionId,
        asset.assetType,
        asset.value.trim(),
        asset.pathPrefix ?? null,
        asset.scheme ?? (asset.assetType === 'url' ? new URL(asset.value).protocol.replace(':', '') : null),
        asset.port ?? null,
        JSON.stringify(asset.allowedMethods?.length ? asset.allowedMethods : ['GET', 'HEAD']),
        JSON.stringify(asset.approvedPaths ?? []),
        Boolean(asset.allowSubdomains),
        Boolean(asset.isTrainingRange),
        Boolean(asset.ownershipVerified),
        asset.notes ?? null,
        ctx.user.id,
      ],
    );
  }
  for (const exclusion of exclusions) {
    await tx.query(
      'INSERT INTO scope_exclusions (engagement_id, institution_id, asset_type, value, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [engagementId, institutionId, exclusion.assetType, exclusion.value, exclusion.reason, ctx.user.id],
    );
  }
  await recordAudit(
    {
      action: 'engagement.scope_updated',
      entityType: 'engagement',
      entityId: engagementId,
      institutionId,
      engagementId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { assets: assets.length, exclusions: exclusions.length },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function recordAuthorization(
  tx: Tx,
  ctx: RequestContext,
  input: {
    engagementId: string;
    reference: string;
    authorizedByName: string;
    authorizedByRole: string;
    authorizedAt: string;
    validFrom: string;
    validTo: string;
    permittedMethods: string[];
    prohibitedActions: string[];
    testingWindowStart?: string;
    testingWindowEnd?: string;
    documentEvidenceId?: string | null;
  },
) {
  if (!can(ctx.user, 'engagement:authorize')) throw new ForbiddenError('Missing permission: engagement:authorize');
  const engagement = await getEngagement(tx, input.engagementId);
  if (!engagement) throw new NotFoundError('Engagement not found');
  if (!input.reference?.trim()) throw new ValidationError('Authorisation reference is required');
  if (new Date(input.validTo) <= new Date(input.validFrom)) throw new ValidationError('Authorisation expiry must be after the start date');
  if (!input.permittedMethods?.length) throw new ValidationError('At least one permitted method is required');

  const record = await tx.queryOne(
    `INSERT INTO authorization_records (engagement_id, institution_id, reference, authorized_by_name, authorized_by_role,
        authorized_at, valid_from, valid_to, permitted_methods, prohibited_actions, testing_window_start,
        testing_window_end, document_evidence_id, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      input.engagementId,
      engagement.institution_id,
      input.reference.trim(),
      input.authorizedByName,
      input.authorizedByRole,
      input.authorizedAt,
      input.validFrom,
      input.validTo,
      JSON.stringify(input.permittedMethods),
      JSON.stringify(input.prohibitedActions),
      input.testingWindowStart ?? null,
      input.testingWindowEnd ?? null,
      input.documentEvidenceId ?? null,
      ctx.user.id,
    ],
  );

  await tx.query(
    `UPDATE engagements SET authorization_ref = $2, scope_approved_at = now(), scope_expires_at = $3,
            testing_window_start = $4, testing_window_end = $5, permitted_methods = $6, prohibited_actions = $7,
            emergency_contact_name = COALESCE(emergency_contact_name, $8),
            emergency_contact_phone = COALESCE(emergency_contact_phone, $9),
            status = CASE WHEN status = 'draft' THEN 'pending_authorization' ELSE status END, updated_at = now()
      WHERE id = $1`,
    [
      input.engagementId,
      input.reference.trim(),
      input.validTo,
      input.testingWindowStart ?? null,
      input.testingWindowEnd ?? null,
      JSON.stringify(input.permittedMethods),
      JSON.stringify(input.prohibitedActions),
      input.authorizedByName,
      null,
    ],
  );

  await recordAudit(
    {
      action: 'engagement.authorization_recorded',
      entityType: 'engagement',
      entityId: input.engagementId,
      institutionId: engagement.institution_id,
      engagementId: input.engagementId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { reference: input.reference, validTo: input.validTo, permittedMethods: input.permittedMethods },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return record;
}

/** Authorise the engagement for planning and execution. */
export async function approveEngagement(tx: Tx, ctx: RequestContext, engagementId: string) {
  if (!can(ctx.user, 'engagement:authorize')) throw new ForbiddenError('Missing permission: engagement:authorize');
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new NotFoundError('Engagement not found');
  if (!['draft', 'pending_authorization'].includes(engagement.status)) throw new ConflictError('Engagement is already authorised');

  const active = await tx.queryOne<{ id: string; valid_from: string; valid_to: string }>(
    `SELECT id, valid_from, valid_to FROM authorization_records
      WHERE engagement_id = $1 AND status = 'active' AND valid_from <= now() AND valid_to > now()
      ORDER BY created_at DESC LIMIT 1`,
    [engagementId],
  );
  if (!active) throw new ValidationError('An in-date written authorisation record is required before approval');

  const assets = await tx.query<{ count: string }>('SELECT count(*)::text AS count FROM scope_assets WHERE engagement_id = $1', [engagementId]);
  if (Number(assets[0]?.count ?? 0) === 0) throw new ValidationError('At least one scope asset must be approved');

  const missing: string[] = [];
  if (!engagement.emergency_contact_name) missing.push('emergency contact name');
  if (!engagement.emergency_contact_phone) missing.push('emergency contact phone');
  if (!engagement.escalation_procedure) missing.push('escalation procedure');
  if (!engagement.scope_expires_at) missing.push('scope expiry date');
  if (missing.length) throw new ValidationError(`Cannot authorise engagement: missing ${missing.join(', ')}`);

  await tx.query(
    `UPDATE engagements SET status = 'authorized', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`,
    [engagementId, ctx.user.id],
  );
  await recordAudit(
    {
      action: 'engagement.authorized',
      entityType: 'engagement',
      entityId: engagementId,
      institutionId: engagement.institution_id,
      engagementId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { authorizationRef: engagement.authorization_ref, scopeExpiresAt: engagement.scope_expires_at },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function submitPlan(
  tx: Tx,
  ctx: RequestContext,
  input: { engagementId: string; modules: string[]; frameworks: { key: string; version: string }[]; plannedChecks: unknown[]; impactSummary?: string; limitations?: string },
) {
  if (!can(ctx.user, 'engagement:update')) throw new ForbiddenError('Missing permission: engagement:update');
  const engagement = await getEngagement(tx, input.engagementId);
  if (!engagement) throw new NotFoundError('Engagement not found');
  if (!['authorized', 'plan_review', 'approved'].includes(engagement.status)) throw new ConflictError('Engagement must be authorised before planning');
  if (!input.modules?.length) throw new ValidationError('Select at least one assessment module');
  const version = await tx.queryOne<{ max: string | null }>('SELECT max(version)::text AS max FROM test_plans WHERE engagement_id = $1', [input.engagementId]);
  const nextVersion = Number(version?.max ?? 0) + 1;
  const plan = await tx.queryOne(
    `INSERT INTO test_plans (engagement_id, institution_id, version, status, frameworks, modules, planned_checks,
        impact_summary, limitations, created_by)
     VALUES ($1,$2,$3,'pending_approval',$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      input.engagementId,
      engagement.institution_id,
      nextVersion,
      JSON.stringify(input.frameworks ?? []),
      JSON.stringify(input.modules),
      JSON.stringify(input.plannedChecks ?? []),
      input.impactSummary ?? null,
      input.limitations ?? null,
      ctx.user.id,
    ],
  );
  await tx.query(`UPDATE engagements SET status = 'plan_review', updated_at = now() WHERE id = $1`, [input.engagementId]);
  await recordAudit(
    {
      action: 'assessment.plan_submitted',
      entityType: 'test_plan',
      entityId: (plan as any).id,
      institutionId: engagement.institution_id,
      engagementId: input.engagementId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { version: nextVersion, modules: input.modules },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return plan;
}

export async function approvePlan(tx: Tx, ctx: RequestContext, planId: string) {
  if (!can(ctx.user, 'engagement:plan:approve')) throw new ForbiddenError('Missing permission: engagement:plan:approve');
  const plan = await tx.queryOne<{ id: string; engagement_id: string; institution_id: string; created_by: string; status: string; version: number }>(
    'SELECT * FROM test_plans WHERE id = $1',
    [planId],
  );
  if (!plan) throw new NotFoundError('Test plan not found');
  if (plan.status !== 'pending_approval') throw new ConflictError('Only plans pending approval can be approved');
  // Separation of duties: the plan author cannot approve their own plan.
  if (plan.created_by === ctx.user.id) throw new ForbiddenError('The plan author cannot approve the same plan');

  await tx.query(`UPDATE test_plans SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [planId, ctx.user.id]);
  await tx.query(`UPDATE test_plans SET status = 'superseded' WHERE engagement_id = $1 AND id <> $2 AND status = 'approved'`, [plan.engagement_id, planId]);
  await tx.query(`UPDATE engagements SET status = 'approved', updated_at = now() WHERE id = $1 AND status IN ('authorized','plan_review')`, [plan.engagement_id]);
  await recordAudit(
    {
      action: 'assessment.plan_approved',
      entityType: 'test_plan',
      entityId: planId,
      institutionId: plan.institution_id,
      engagementId: plan.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { version: plan.version },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

/**
 * Operational gate used by the job runner immediately before every outbound
 * request and by every launch request.
 */
export async function assertEngagementOperational(
  tx: Tx,
  engagementId: string,
  options: { requireMethod?: string; checkGlobalKillSwitch?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; code?: string }> {
  const engagement = await tx.queryOne<EngagementRow>('SELECT * FROM engagements WHERE id = $1', [engagementId]);
  if (!engagement) return { ok: false, reason: 'Engagement not found', code: 'not_found' };
  if (engagement.kill_switch_engaged) return { ok: false, reason: `Engagement stop control engaged: ${engagement.kill_switch_reason ?? 'stopped by operator'}`, code: 'engagement_stopped' };
  if (engagement.status === 'stopped' || engagement.status === 'cancelled') return { ok: false, reason: `Engagement is ${engagement.status}`, code: 'engagement_stopped' };
  if (!['authorized', 'plan_review', 'approved', 'running', 'paused'].includes(engagement.status)) {
    return { ok: false, reason: `Engagement is ${engagement.status}; authorisation and plan approval are required before testing`, code: 'not_approved' };
  }
  if (engagement.status === 'paused') return { ok: false, reason: 'Engagement is paused', code: 'paused' };

  if (options.checkGlobalKillSwitch !== false) {
    const killSwitch = await tx.queryOne<{ value: boolean }>(`SELECT value FROM settings WHERE key = 'global_kill_switch'`);
    if (killSwitch?.value === true) return { ok: false, reason: 'Global kill switch is engaged', code: 'global_kill_switch' };
  }

  const authorization = await tx.queryOne<{ id: string; valid_to: string; permitted_methods: string[]; testing_window_start: string | null; testing_window_end: string | null }>(
    `SELECT * FROM authorization_records WHERE engagement_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [engagementId],
  );
  if (!authorization) return { ok: false, reason: 'No active authorisation record', code: 'no_authorization' };
  const now = new Date();
  if (new Date(authorization.valid_to) < now) return { ok: false, reason: 'Authorisation has expired', code: 'authorization_expired' };
  if (engagement.scope_expires_at && new Date(engagement.scope_expires_at) < now) return { ok: false, reason: 'Approved scope has expired', code: 'scope_expired' };
  if (engagement.testing_window_start && new Date(engagement.testing_window_start) > now) {
    return { ok: false, reason: 'Outside the approved testing window (not yet open)', code: 'outside_window' };
  }
  if (engagement.testing_window_end && new Date(engagement.testing_window_end) < now) {
    return { ok: false, reason: 'Outside the approved testing window (window closed)', code: 'outside_window' };
  }
  if (options.requireMethod) {
    const permitted = normaliseArray(engagement.permitted_methods);
    const fromAuthorization = normaliseArray(authorization.permitted_methods);
    if (!permitted.includes(options.requireMethod) || !fromAuthorization.includes(options.requireMethod)) {
      return { ok: false, reason: `Method "${options.requireMethod}" is not permitted by the authorisation`, code: 'method_not_permitted' };
    }
  }
  const assets = await tx.queryOne<{ count: string }>('SELECT count(*)::text AS count FROM scope_assets WHERE engagement_id = $1', [engagementId]);
  if (Number(assets?.count ?? 0) === 0) return { ok: false, reason: 'No approved scope assets', code: 'no_scope' };

  // Ownership must be established from the registry, not asserted in a form.
  // A scope asset is acceptable when it is a labelled training range, or when a
  // registry record for the same institution is ownership-verified and its
  // identifier matches the scope value (exact value or its host).
  const unchecked = await tx.query<{ value: string; asset_type: string }>(
    `SELECT s.value, s.asset_type
       FROM scope_assets s
      WHERE s.engagement_id = $1
        AND coalesce(s.is_training_range, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM digital_assets d
           WHERE d.institution_id = $2
             AND d.status = 'ownership_verified'
             AND (
               lower(d.identifier) = lower(s.value)
               OR lower(d.identifier) = lower(split_part(split_part(s.value, '://', 2), '/', 1))
             )
        )
      ORDER BY s.value
      LIMIT 5`,
    [engagementId, engagement.institution_id],
  );
  if (unchecked.length) {
    const list = unchecked.map((asset) => asset.value).join(', ');
    return {
      ok: false,
      reason: `Ownership is not verified in the registry for: ${list}. Record the evidence that establishes the institution operates the asset before testing.`,
      code: 'ownership_unverified',
    };
  }
  return { ok: true };
}

export async function launchEngagement(tx: Tx, ctx: RequestContext, engagementId: string, options: { modules?: string[]; applicationId?: string } = {}) {
  if (!can(ctx.user, 'engagement:launch')) throw new ForbiddenError('Missing permission: engagement:launch');
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new NotFoundError('Engagement not found');
  if (engagement.status !== 'approved' && engagement.status !== 'running') {
    throw new ConflictError('The engagement must be approved before assessments can be launched');
  }
  const plan = await tx.queryOne<{ id: string; modules: string[]; status: string }>(
    `SELECT id, modules, status FROM test_plans WHERE engagement_id = $1 AND status = 'approved' ORDER BY version DESC LIMIT 1`,
    [engagementId],
  );
  if (!plan) throw new ConflictError('No approved test plan exists for this engagement');

  const operational = await assertEngagementOperational(tx, engagementId, {});
  if (!operational.ok) throw new ConflictError(`Cannot launch: ${operational.reason}`);

  const modules = (options.modules?.length ? options.modules : normaliseArray(plan.modules)).filter((m) =>
    ['web', 'api', 'mobile', 'dependencies'].includes(m),
  );
  if (!modules.length) throw new ValidationError('No executable modules selected');

  const applications = await tx.query<{ id: string; channel: string; name: string }>(
    `SELECT a.id, a.channel, a.name FROM applications a JOIN engagement_applications ea ON ea.application_id = a.id WHERE ea.engagement_id = $1`,
    [engagementId],
  );
  const targets = options.applicationId ? applications.filter((a) => a.id === options.applicationId) : applications;

  const created: { id: string; module: string; applicationId: string }[] = [];
  for (const application of targets) {
    for (const module of modules) {
      const applicable =
        module === 'web'
          ? ['web', 'admin'].includes(application.channel)
          : module === 'api'
            ? ['api', 'web', 'admin', 'service'].includes(application.channel)
            : module === 'mobile'
              ? ['mobile_android', 'mobile_ios', 'mobile_both'].includes(application.channel)
              : true;
      if (!applicable) continue;
      const job = await tx.queryOne<{ id: string }>(
        `INSERT INTO assessment_jobs (engagement_id, institution_id, application_id, plan_id, module, status, created_by, limits, config)
         VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8) RETURNING id`,
        [
          engagementId,
          engagement.institution_id,
          application.id,
          plan.id,
          module,
          ctx.user.id,
          JSON.stringify({
            maxRequestsPerSecond: Number(engagement.max_requests_per_second),
            maxConcurrency: engagement.max_concurrency,
            maxRequestsTotal: engagement.max_requests_total,
            maxDurationMinutes: engagement.max_duration_minutes,
          }),
          JSON.stringify({ requireMethod: module === 'mobile' ? 'static_artefact' : 'unauthenticated_http' }),
        ],
      );
      created.push({ id: job!.id, module, applicationId: application.id });
      await recordAudit(
        {
          action: 'assessment.job_queued',
          entityType: 'assessment_job',
          entityId: job!.id,
          institutionId: engagement.institution_id,
          engagementId,
          actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
          metadata: { module, applicationId: application.id, applicationName: application.name },
          ip: ctx.ip,
          dataMode: ctx.mode,
        },
        tx,
      );
    }
  }
  if (!created.length) throw new ValidationError('No jobs were created: the selected modules do not apply to the engagement applications');
  await tx.query(`UPDATE engagements SET status = 'running', updated_at = now() WHERE id = $1`, [engagementId]);
  return created;
}

export async function stopEngagement(tx: Tx, ctx: RequestContext, engagementId: string, reason: string) {
  if (!can(ctx.user, 'engagement:stop')) throw new ForbiddenError('Missing permission: engagement:stop');
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new NotFoundError('Engagement not found');
  await tx.query(`UPDATE engagements SET kill_switch_engaged = true, kill_switch_reason = $2, status = 'stopped', updated_at = now() WHERE id = $1`, [
    engagementId,
    reason,
  ]);
  await tx.query(
    `UPDATE assessment_jobs SET status = 'cancelled', cancel_requested_at = now(), finished_at = now(), blocked_reason = $2
      WHERE engagement_id = $1 AND status IN ('queued','running','cancelling')`,
    [engagementId, `Engagement stopped: ${reason}`],
  );
  await recordAudit(
    {
      action: 'engagement.stopped',
      entityType: 'engagement',
      entityId: engagementId,
      institutionId: engagement.institution_id,
      engagementId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { reason },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function setGlobalKillSwitch(tx: Tx, ctx: RequestContext, engaged: boolean, reason: string) {
  if (!can(ctx.user, 'engagement:stop')) throw new ForbiddenError('Missing permission: engagement:stop');
  await tx.query(`UPDATE settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = 'global_kill_switch'`, [
    JSON.stringify(engaged),
    ctx.user.id,
  ]);
  if (engaged) {
    await tx.query(`UPDATE assessment_jobs SET status = 'cancelled', cancel_requested_at = now(), finished_at = now(), blocked_reason = $1 WHERE status IN ('queued','running','cancelling')`, [
      `Global kill switch: ${reason}`,
    ]);
  }
  await recordAudit({
    action: engaged ? 'platform.kill_switch_engaged' : 'platform.kill_switch_released',
    entityType: 'platform',
    entityId: null,
    actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
    metadata: { reason },
    ip: ctx.ip,
    dataMode: ctx.mode,
  }, tx);
}

export async function resumeEngagement(tx: Tx, ctx: RequestContext, engagementId: string) {
  if (!can(ctx.user, 'engagement:stop')) throw new ForbiddenError('Missing permission: engagement:stop');
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new NotFoundError('Engagement not found');
  await tx.query(
    `UPDATE engagements SET kill_switch_engaged = false, kill_switch_reason = NULL, status = 'approved', updated_at = now() WHERE id = $1`,
    [engagementId],
  );
  await recordAudit(
    {
      action: 'engagement.resumed',
      entityType: 'engagement',
      entityId: engagementId,
      institutionId: engagement.institution_id,
      engagementId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}
