import type { Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';

export type ApplicationRow = {
  id: string;
  institution_id: string;
  name: string;
  business_purpose: string | null;
  channel: 'web' | 'api' | 'mobile_android' | 'mobile_ios' | 'mobile_both' | 'admin' | 'service';
  web_url: string | null;
  api_base_url: string | null;
  mobile_platform: string | null;
  package_identifier: string | null;
  version: string | null;
  build: string | null;
  environment: string;
  auth_methods: string[];
  api_services: string[];
  third_parties: string[];
  data_sensitivity: string;
  critical_processes: string[];
  test_accounts: unknown[];
  boundaries: string | null;
  exclusions: string | null;
  status: string;
  data_mode: string;
  created_at: string;
};

export const CHANNELS = [
  { key: 'web', label: 'Web Application' },
  { key: 'api', label: 'API / Backend Service' },
  { key: 'mobile_android', label: 'Mobile — Android' },
  { key: 'mobile_ios', label: 'Mobile — iOS' },
  { key: 'mobile_both', label: 'Mobile — Android & iOS' },
  { key: 'admin', label: 'Administrative Dashboard' },
  { key: 'service', label: 'Supporting Service' },
] as const;

export function channelLabel(channel: string): string {
  return CHANNELS.find((c) => c.key === channel)?.label ?? channel;
}

function isJsonArrayValue(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export async function listApplications(tx: Tx, ctx: RequestContext, filters: { institutionId?: string; channel?: string } = {}) {
  const params: unknown[] = [ctx.mode];
  const clauses = ['a.data_mode = $1'];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`a.institution_id = $${params.length}`);
  }
  if (filters.channel) {
    params.push(filters.channel);
    clauses.push(`a.channel = $${params.length}`);
  }
  return tx.query(
    `SELECT a.*, i.name AS institution_name,
            (SELECT count(*)::int FROM findings f WHERE f.application_id = a.id AND f.status NOT IN ('resolved','false_positive','closed')) AS open_findings,
            (SELECT count(*)::int FROM findings f WHERE f.application_id = a.id AND f.technical_severity IN ('critical','high') AND f.status NOT IN ('resolved','false_positive','closed')) AS critical_high,
            (SELECT max(last_tested_at)::text FROM api_endpoints ep WHERE ep.application_id = a.id) AS last_api_test
       FROM applications a JOIN institutions i ON i.id = a.institution_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY i.name, a.name`,
    params,
  );
}

export async function getApplication(tx: Tx, id: string) {
  return tx.queryOne<ApplicationRow>('SELECT * FROM applications WHERE id = $1', [id]);
}

export async function getApplicationDetail(tx: Tx, ctx: RequestContext, id: string) {
  const application = await getApplication(tx, id);
  if (!application) throw new NotFoundError('Application not found');
  const institution = await tx.queryOne<{ id: string; name: string; code: string; category: string }>(
    'SELECT id, name, code, category FROM institutions WHERE id = $1',
    [application.institution_id],
  );
  const findings = await tx.query(
    `SELECT f.* FROM findings f WHERE f.application_id = $1 ORDER BY
       CASE f.technical_severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
       f.created_at DESC`,
    [id],
  );
  const versions = await tx.query('SELECT * FROM application_versions WHERE application_id = $1 ORDER BY released_at DESC NULLS LAST', [id]);
  const endpoints = await tx.query(
    `SELECT * FROM api_endpoints WHERE application_id = $1 ORDER BY path, method`,
    [id],
  );
  const engagements = await tx.query(
    `SELECT e.id, e.code, e.name, e.status, e.approved_at FROM engagements e
       JOIN engagement_applications ea ON ea.engagement_id = e.id
      WHERE ea.application_id = $1 ORDER BY e.created_at DESC`,
    [id],
  );
  const testResults = await tx.query(
    `SELECT tr.*, fi.title AS item_title FROM test_results tr
       LEFT JOIN framework_items fi ON fi.code = tr.framework_item_code
      WHERE tr.application_id = $1 ORDER BY tr.executed_at DESC LIMIT 200`,
    [id],
  );
  const artifacts = await tx.query(
    `SELECT id, kind, filename, size_bytes, sha256, status, uploaded_at, analysis FROM artifacts WHERE application_id = $1 ORDER BY uploaded_at DESC`,
    [id],
  );
  return { application, institution, findings, versions, endpoints, engagements, testResults, artifacts };
}

export async function createApplication(
  tx: Tx,
  ctx: RequestContext,
  input: {
    institutionId: string;
    name: string;
    businessPurpose?: string;
    channel: ApplicationRow['channel'];
    webUrl?: string;
    apiBaseUrl?: string;
    mobilePlatform?: string;
    packageIdentifier?: string;
    version?: string;
    build?: string;
    environment?: string;
    authMethods?: string[];
    apiServices?: string[];
    thirdParties?: string[];
    dataSensitivity?: string;
    criticalProcesses?: string[];
    testAccounts?: unknown[];
    boundaries?: string;
    exclusions?: string;
  },
) {
  if (!can(ctx.user, 'application:write')) throw new ForbiddenError('Missing permission: application:write');
  if (!input.name?.trim()) throw new ValidationError('Application name is required');
  if (!input.institutionId) throw new ValidationError('Institution is required');
  if (!CHANNELS.some((c) => c.key === input.channel)) throw new ValidationError('Unknown application channel');
  const institution = await tx.queryOne('SELECT id, data_mode FROM institutions WHERE id = $1', [input.institutionId]);
  if (!institution) throw new NotFoundError('Institution not found');
  if (institution.data_mode !== ctx.mode) throw new ValidationError('Institution belongs to a different platform mode');

  if (input.webUrl) {
    try {
      const url = new URL(input.webUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    } catch {
      throw new ValidationError('Web application URL must be an absolute http(s) URL');
    }
  }
  if (input.packageIdentifier && !/^[A-Za-z0-9._-]+$/.test(input.packageIdentifier)) {
    throw new ValidationError('Package identifier contains invalid characters');
  }

  const row = await tx.queryOne<ApplicationRow>(
    `INSERT INTO applications (institution_id, name, business_purpose, channel, web_url, api_base_url, mobile_platform,
        package_identifier, version, build, environment, auth_methods, api_services, third_parties, data_sensitivity,
        critical_processes, test_accounts, boundaries, exclusions, data_mode, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [
      input.institutionId,
      input.name.trim(),
      input.businessPurpose ?? null,
      input.channel,
      input.webUrl ?? null,
      input.apiBaseUrl ?? null,
      input.mobilePlatform ?? null,
      input.packageIdentifier ?? null,
      input.version ?? null,
      input.build ?? null,
      input.environment ?? 'staging',
      JSON.stringify(isJsonArrayValue(input.authMethods) ? input.authMethods : []),
      JSON.stringify(isJsonArrayValue(input.apiServices) ? input.apiServices : []),
      JSON.stringify(isJsonArrayValue(input.thirdParties) ? input.thirdParties : []),
      input.dataSensitivity ?? 'restricted',
      JSON.stringify(isJsonArrayValue(input.criticalProcesses) ? input.criticalProcesses : []),
      JSON.stringify(Array.isArray(input.testAccounts) ? input.testAccounts : []),
      input.boundaries ?? null,
      input.exclusions ?? null,
      ctx.mode,
      ctx.user.id,
    ],
  );

  await recordAudit(
    {
      action: 'application.created',
      entityType: 'application',
      entityId: row!.id,
      institutionId: input.institutionId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { name: row!.name, channel: row!.channel, environment: row!.environment },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      dataMode: ctx.mode,
    },
    tx,
  );
  return row!;
}

export async function registerApplicationVersion(
  tx: Tx,
  ctx: RequestContext,
  input: { applicationId: string; version: string; build?: string; releasedAt?: string; notes?: string },
) {
  if (!can(ctx.user, 'application:write')) throw new ForbiddenError('Missing permission: application:write');
  const application = await getApplication(tx, input.applicationId);
  if (!application) throw new NotFoundError('Application not found');
  if (!input.version?.trim()) throw new ValidationError('Version is required');
  const row = await tx.queryOne(
    `INSERT INTO application_versions (application_id, institution_id, version, build, released_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.applicationId, application.institution_id, input.version.trim(), input.build ?? null, input.releasedAt ?? null, input.notes ?? null],
  );
  await tx.query('UPDATE applications SET version = $2, build = COALESCE($3, build), updated_at = now() WHERE id = $1', [
    input.applicationId,
    input.version.trim(),
    input.build ?? null,
  ]);
  await recordAudit(
    {
      action: 'application.version_registered',
      entityType: 'application',
      entityId: input.applicationId,
      institutionId: application.institution_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { version: input.version, build: input.build ?? null },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return row;
}
