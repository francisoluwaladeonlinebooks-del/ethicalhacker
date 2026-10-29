import type { Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';

export type InstitutionRow = {
  id: string;
  code: string;
  name: string;
  category: 'commercial_bank' | 'microfinance_bank' | 'payment_service_provider' | 'other';
  licence_number: string | null;
  risk_tier: string;
  city: string | null;
  state: string | null;
  website: string | null;
  status: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  description: string | null;
  data_mode: 'demo' | 'live';
  created_at: string;
  updated_at: string;
  application_count?: number;
  engagement_count?: number;
  open_findings?: number;
  critical_high?: number;
  last_assessment?: string | null;
};

export const INSTITUTION_CATEGORIES = [
  { key: 'commercial_bank', label: 'Commercial Bank' },
  { key: 'microfinance_bank', label: 'Microfinance Bank' },
  { key: 'payment_service_provider', label: 'Payment Service Provider' },
  { key: 'other', label: 'Other Approved Institution' },
] as const;

export function categoryLabel(value: string): string {
  return INSTITUTION_CATEGORIES.find((c) => c.key === value)?.label ?? value;
}

export async function listInstitutions(
  tx: Tx,
  ctx: RequestContext,
  filters: { search?: string; category?: string; riskTier?: string; status?: string } = {},
): Promise<InstitutionRow[]> {
  const params: unknown[] = [ctx.mode];
  const clauses = ['i.data_mode = $1'];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(i.name ILIKE $${params.length} OR i.code ILIKE $${params.length})`);
  }
  if (filters.category) {
    params.push(filters.category);
    clauses.push(`i.category = $${params.length}`);
  }
  if (filters.riskTier) {
    params.push(filters.riskTier);
    clauses.push(`i.risk_tier = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`i.status = $${params.length}`);
  }
  const rows = await tx.query<InstitutionRow>(
    `SELECT i.*,
            (SELECT count(*)::int FROM applications a WHERE a.institution_id = i.id AND a.status = 'active') AS application_count,
            (SELECT count(*)::int FROM engagements e WHERE e.institution_id = i.id) AS engagement_count,
            (SELECT count(*)::int FROM findings f WHERE f.institution_id = i.id AND f.status NOT IN ('resolved','false_positive','closed')) AS open_findings,
            (SELECT count(*)::int FROM findings f WHERE f.institution_id = i.id AND f.technical_severity IN ('critical','high') AND f.status NOT IN ('resolved','false_positive','closed')) AS critical_high,
            (SELECT max(e.approved_at)::text FROM engagements e WHERE e.institution_id = i.id AND e.status IN ('approved','running','completed')) AS last_assessment
       FROM institutions i
      WHERE ${clauses.join(' AND ')}
      ORDER BY i.name`,
    params,
  );
  return rows;
}

export async function getInstitution(tx: Tx, id: string): Promise<InstitutionRow | null> {
  return tx.queryOne<InstitutionRow>('SELECT * FROM institutions WHERE id = $1', [id]);
}

export async function createInstitution(
  tx: Tx,
  ctx: RequestContext,
  input: {
    name: string;
    code: string;
    category: InstitutionRow['category'];
    licenceNumber?: string;
    riskTier?: string;
    city?: string;
    state?: string;
    website?: string;
    primaryContactName?: string;
    primaryContactEmail?: string;
    description?: string;
  },
): Promise<InstitutionRow> {
  if (!can(ctx.user, 'institution:write')) throw new ForbiddenError('Missing permission: institution:write');
  if (!input.name?.trim()) throw new ValidationError('Institution name is required');
  if (!/^[A-Z0-9-]{3,20}$/.test(input.code?.trim() ?? '')) {
    throw new ValidationError('Institution code must be 3-20 characters of A-Z, 0-9 or hyphen');
  }
  if (!INSTITUTION_CATEGORIES.some((c) => c.key === input.category)) throw new ValidationError('Unknown institution category');
  const existing = await tx.queryOne('SELECT id FROM institutions WHERE code = $1', [input.code.trim()]);
  if (existing) throw new ValidationError('An institution with this code already exists');

  const row = await tx.queryOne<InstitutionRow>(
    `INSERT INTO institutions (code, name, category, licence_number, risk_tier, city, state, website, status,
        primary_contact_name, primary_contact_email, description, data_mode, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13) RETURNING *`,
    [
      input.code.trim().toUpperCase(),
      input.name.trim(),
      input.category,
      input.licenceNumber ?? null,
      input.riskTier ?? 'unassessed',
      input.city ?? null,
      input.state ?? null,
      input.website ?? null,
      input.primaryContactName ?? null,
      input.primaryContactEmail ?? null,
      input.description ?? null,
      ctx.mode,
      ctx.user.id,
    ],
  );

  await recordAudit(
    {
      action: 'institution.created',
      entityType: 'institution',
      entityId: row!.id,
      institutionId: row!.id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { name: row!.name, category: row!.category, mode: ctx.mode },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      dataMode: ctx.mode,
    },
    tx,
  );
  return row!;
}

export async function getInstitutionOverview(tx: Tx, ctx: RequestContext, institutionId: string) {
  const institution = await getInstitution(tx, institutionId);
  if (!institution) throw new NotFoundError('Institution not found');

  const applications = await tx.query(
    `SELECT a.*,
            (SELECT count(*)::int FROM findings f WHERE f.application_id = a.id AND f.status NOT IN ('resolved','false_positive','closed')) AS open_findings
       FROM applications a WHERE a.institution_id = $1 ORDER BY a.name`,
    [institutionId],
  );

  const engagements = await tx.query(
    `SELECT e.*, (SELECT count(*)::int FROM findings f WHERE f.engagement_id = e.id) AS finding_count
       FROM engagements e WHERE e.institution_id = $1 ORDER BY e.created_at DESC`,
    [institutionId],
  );

  const findingsBySeverity = await tx.query<{ technical_severity: string; count: string }>(
    `SELECT technical_severity, count(*)::text AS count FROM findings
      WHERE institution_id = $1 AND status NOT IN ('false_positive','closed')
      GROUP BY technical_severity`,
    [institutionId],
  );

  const remediation = await tx.query<{ status: string; count: string; overdue: string }>(
    `SELECT rp.status, count(*)::text AS count,
            sum(CASE WHEN rp.target_date < current_date AND rp.status <> 'verified' THEN 1 ELSE 0 END)::text AS overdue
       FROM remediation_plans rp WHERE rp.institution_id = $1 GROUP BY rp.status`,
    [institutionId],
  );

  const trend = await tx.query<{ period: string; critical: string; high: string; medium: string; low: string }>(
    `SELECT to_char(date_trunc('month', f.created_at), 'YYYY-MM') AS period,
            count(*) FILTER (WHERE f.technical_severity = 'critical')::text AS critical,
            count(*) FILTER (WHERE f.technical_severity = 'high')::text AS high,
            count(*) FILTER (WHERE f.technical_severity = 'medium')::text AS medium,
            count(*) FILTER (WHERE f.technical_severity = 'low')::text AS low
       FROM findings f WHERE f.institution_id = $1
      GROUP BY 1 ORDER BY 1`,
    [institutionId],
  );

  const canViewNotes = can(ctx.user, 'supervisory_note:read');
  const notes = canViewNotes
    ? await tx.query(
        `SELECT n.*, u.name AS author_name FROM supervisory_notes n
           LEFT JOIN users u ON u.id = n.author_id
          WHERE n.institution_id = $1 ORDER BY n.created_at DESC LIMIT 20`,
        [institutionId],
      )
    : [];

  const nistProfile = await tx.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM nist_profiles WHERE institution_id = $1 AND profile_type = 'current' LIMIT 1`,
    [institutionId],
  );

  return { institution, applications, engagements, findingsBySeverity, remediation, trend, notes, canViewNotes, nistProfile };
}

export async function addSupervisoryNote(
  tx: Tx,
  ctx: RequestContext,
  input: { institutionId: string; body: string; engagementId?: string | null },
) {
  if (!can(ctx.user, 'supervisory_note:write')) throw new ForbiddenError('Missing permission: supervisory_note:write');
  if (!input.body?.trim()) throw new ValidationError('Note body is required');
  const row = await tx.queryOne(
    `INSERT INTO supervisory_notes (institution_id, engagement_id, author_id, body) VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.institutionId, input.engagementId ?? null, ctx.user.id, input.body.trim()],
  );
  await recordAudit(
    {
      action: 'supervisory_note.created',
      entityType: 'supervisory_note',
      entityId: (row as any).id,
      institutionId: input.institutionId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { classification: 'confidential_supervisory' },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      dataMode: ctx.mode,
    },
    tx,
  );
  return row;
}

/** Institution category roll-up used by supervisory analytics and reports. */
export async function portfolioByCategory(tx: Tx, ctx: RequestContext) {
  return tx.query<{ category: string; institutions: string; applications: string; open_findings: string; critical_high: string }>(
    `SELECT i.category,
            count(DISTINCT i.id)::text AS institutions,
            count(DISTINCT a.id)::text AS applications,
            count(DISTINCT f.id) FILTER (WHERE f.status NOT IN ('resolved','false_positive','closed'))::text AS open_findings,
            count(DISTINCT f.id) FILTER (WHERE f.technical_severity IN ('critical','high') AND f.status NOT IN ('resolved','false_positive','closed'))::text AS critical_high
       FROM institutions i
       LEFT JOIN applications a ON a.institution_id = i.id
       LEFT JOIN findings f ON f.institution_id = i.id
      WHERE i.data_mode = $1
      GROUP BY i.category ORDER BY i.category`,
    [ctx.mode],
  );
}
