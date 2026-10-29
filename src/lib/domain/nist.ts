import type { Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';

/**
 * NIST CSF 2.0 governance layer.
 *
 * The platform maps technical findings to CSF outcomes as *indicators that
 * evidence should exist*, never as an official maturity tier. Statuses are
 * explicit about the quality of evidence available.
 */

export const CSF_STATUS_LABELS: Record<string, string> = {
  not_assessed: 'Not assessed',
  evidence_required: 'Evidence required',
  partially_supported: 'Partially supported',
  supported: 'Supported by available evidence',
  improvement_required: 'Improvement required',
  not_applicable: 'Not applicable',
};

export async function ensureProfiles(tx: Tx, institutionId: string, createdBy: string) {
  const existing = await tx.query('SELECT * FROM nist_profiles WHERE institution_id = $1 ORDER BY created_at', [institutionId]);
  if (existing.length >= 2) return existing;
  for (const profileType of ['current', 'target'] as const) {
    if (existing.some((row: any) => row.profile_type === profileType)) continue;
    await tx.query(
      `INSERT INTO nist_profiles (institution_id, name, profile_type, notes, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        institutionId,
        profileType === 'current' ? 'Current profile' : 'Target profile',
        profileType,
        profileType === 'current' ? 'Evidence based current cybersecurity profile for the institution.' : 'Target profile agreed with the institution.',
        createdBy,
      ],
    );
  }
  return tx.query('SELECT * FROM nist_profiles WHERE institution_id = $1 ORDER BY created_at', [institutionId]);
}

export async function getProfile(tx: Tx, institutionId: string) {
  const profiles = await tx.query<any>('SELECT * FROM nist_profiles WHERE institution_id = $1 ORDER BY profile_type DESC', [institutionId]);
  const entries = await tx.query(
    `SELECT e.*, fi.title, fi.description, fi.parent_code
       FROM nist_profile_entries e
       LEFT JOIN frameworks fw ON fw.key = 'nist-csf' AND fw.version = '2.0'
       LEFT JOIN framework_items fi ON fi.framework_id = fw.id AND fi.code = e.item_code
      WHERE e.profile_id = ANY($1::uuid[]) ORDER BY e.item_code`,
    [profiles.map((p: any) => p.id)],
  );
  const subcategories = await tx.query(
    `SELECT fi.code, fi.title, fi.description, fi.parent_code FROM framework_items fi
       JOIN frameworks fw ON fw.id = fi.framework_id
      WHERE fw.key = 'nist-csf' AND fw.version = '2.0' AND fi.item_type = 'subcategory'
      ORDER BY fi.code`,
  );
  const findingsByOutcome = await tx.query(
    `SELECT l.item_code, count(DISTINCT f.id)::int AS findings,
            max(CASE f.technical_severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS severity_rank
       FROM finding_framework_links l JOIN findings f ON f.id = l.finding_id
      WHERE l.framework_key = 'nist-csf' AND f.institution_id = $1
      GROUP BY l.item_code`,
    [institutionId],
  );
  const actions = await tx.query('SELECT * FROM nist_improvement_actions WHERE institution_id = $1 ORDER BY created_at DESC', [institutionId]);
  const functions = await tx.query(
    `SELECT fi.code, fi.title, fi.description FROM framework_items fi JOIN frameworks fw ON fw.id = fi.framework_id
      WHERE fw.key = 'nist-csf' AND fw.version = '2.0' AND fi.item_type = 'function' ORDER BY fi.sort_order`,
  );
  return { profiles, entries, subcategories, findingsByOutcome, actions, functions };
}

export async function updateProfileEntry(
  tx: Tx,
  ctx: RequestContext,
  input: { profileId: string; itemCode: string; status: string; evidenceSummary?: string; gap?: string; priority?: string },
) {
  if (!can(ctx.user, 'finding:update') && !can(ctx.user, 'supervisory_note:write')) {
    throw new ForbiddenError('Missing permission to maintain NIST CSF profiles');
  }
  const profile = await tx.queryOne<any>('SELECT * FROM nist_profiles WHERE id = $1', [input.profileId]);
  if (!profile) throw new NotFoundError('Profile not found');
  const item = await tx.queryOne(
    `SELECT fi.code FROM framework_items fi JOIN frameworks fw ON fw.id = fi.framework_id
      WHERE fw.key = 'nist-csf' AND fw.version = '2.0' AND fi.code = $1`,
    [input.itemCode],
  );
  if (!item) throw new ValidationError('The selected CSF outcome does not exist in the imported catalogue');
  const valid = Object.keys(CSF_STATUS_LABELS);
  if (!valid.includes(input.status)) throw new ValidationError('Unknown profile status');

  await tx.query(
    `INSERT INTO nist_profile_entries (profile_id, institution_id, item_code, status, evidence_summary, gap_description, priority, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (profile_id, item_code) DO UPDATE SET status = EXCLUDED.status, evidence_summary = EXCLUDED.evidence_summary,
       gap_description = EXCLUDED.gap_description, priority = EXCLUDED.priority, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [input.profileId, profile.institution_id, input.itemCode, input.status, input.evidenceSummary ?? null, input.gap ?? null, input.priority ?? 'medium', ctx.user.id],
  );
  await recordAudit(
    {
      action: 'nist.profile_entry_updated',
      entityType: 'nist_profile',
      entityId: input.profileId,
      institutionId: profile.institution_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { itemCode: input.itemCode, status: input.status },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function addImprovementAction(
  tx: Tx,
  ctx: RequestContext,
  input: { institutionId: string; itemCode?: string; title: string; description?: string; owner?: string; priority?: string; dueDate?: string },
) {
  if (!can(ctx.user, 'finding:update') && !can(ctx.user, 'supervisory_note:write')) throw new ForbiddenError('Missing permission');
  const row = await tx.queryOne(
    `INSERT INTO nist_improvement_actions (institution_id, item_code, title, description, owner, priority, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.institutionId, input.itemCode ?? null, input.title, input.description ?? null, input.owner ?? null, input.priority ?? 'medium', input.dueDate ?? null],
  );
  await recordAudit(
    {
      action: 'nist.improvement_action_created',
      entityType: 'nist_improvement_action',
      entityId: (row as any).id,
      institutionId: input.institutionId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { title: input.title, priority: input.priority },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return row;
}

export function summariseProfile(entries: any[], functions: any[], findingsByOutcome: any[]) {
  const byFunction = new Map<string, { code: string; title: string; counts: Record<string, number>; gaps: number; linkedFindings: number }>();
  for (const fn of functions) {
    byFunction.set(fn.code, { code: fn.code, title: fn.title, counts: {}, gaps: 0, linkedFindings: 0 });
  }
  const findingsMap = new Map(findingsByOutcome.map((row: any) => [row.item_code, row.findings]));
  for (const entry of entries) {
    const functionCode = String(entry.item_code).split('.')[0];
    const bucket = byFunction.get(functionCode);
    if (!bucket) continue;
    bucket.counts[entry.status] = (bucket.counts[entry.status] ?? 0) + 1;
    if (entry.status === 'improvement_required') bucket.gaps += 1;
    bucket.linkedFindings += findingsMap.get(entry.item_code) ?? 0;
  }
  const statusTotals: Record<string, number> = {};
  for (const entry of entries) statusTotals[entry.status] = (statusTotals[entry.status] ?? 0) + 1;
  return { byFunction: [...byFunction.values()], statusTotals };
}
