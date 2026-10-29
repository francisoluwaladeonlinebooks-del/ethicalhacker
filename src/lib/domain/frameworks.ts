import type { Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';

export async function listFrameworks(tx: Tx) {
  return tx.query(
    `SELECT f.*,
            (SELECT count(*)::int FROM framework_items fi WHERE fi.framework_id = f.id) AS item_count,
            (SELECT count(*)::int FROM framework_items fi WHERE fi.framework_id = f.id AND fi.verification_status = 'pending_official_import') AS pending_items
       FROM frameworks f ORDER BY f.is_primary DESC, f.key, f.version DESC`,
  );
}

export async function getFramework(tx: Tx, key: string, version?: string) {
  const framework = await tx.queryOne(
    `SELECT * FROM frameworks WHERE key = $1 ${version ? 'AND version = $2' : ''} ORDER BY created_at DESC LIMIT 1`,
    version ? [key, version] : [key],
  );
  if (!framework) throw new NotFoundError('Framework not found');
  const items = await tx.query('SELECT * FROM framework_items WHERE framework_id = $1 ORDER BY sort_order, code', [(framework as any).id]);
  return { framework, items };
}

/** Coverage per framework for an engagement, distinguishing tested from untested. */
export async function frameworkCoverage(tx: Tx, ctx: RequestContext, options: { engagementId?: string; institutionId?: string } = {}) {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (options.engagementId) {
    params.push(options.engagementId);
    clauses.push(`tr.engagement_id = $${params.length}`);
  }
  if (options.institutionId) {
    params.push(options.institutionId);
    clauses.push(`tr.institution_id = $${params.length}`);
  }
  return tx.query(
    `SELECT tr.framework_key, tr.framework_version, tr.framework_item_code,
            count(*)::int AS executions,
            count(*) FILTER (WHERE tr.status = 'passed')::int AS passed,
            count(*) FILTER (WHERE tr.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE tr.status = 'needs_verification')::int AS needs_verification,
            count(*) FILTER (WHERE tr.status = 'blocked')::int AS blocked,
            count(*) FILTER (WHERE tr.status = 'error')::int AS errors,
            count(*) FILTER (WHERE tr.status = 'not_applicable')::int AS not_applicable,
            max(tr.executed_at)::text AS last_executed
       FROM test_results tr
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      GROUP BY tr.framework_key, tr.framework_version, tr.framework_item_code
      ORDER BY tr.framework_key, tr.framework_item_code`,
    params,
  );
}

export async function catalogueCoverage(tx: Tx) {
  return tx.query(
    `SELECT f.key, f.name, f.version, f.verification_status,
            count(fi.id)::int AS total_items,
            count(fi.id) FILTER (WHERE fi.automation = 'automated')::int AS automated_items,
            count(fi.id) FILTER (WHERE fi.automation = 'hybrid')::int AS hybrid_items,
            count(fi.id) FILTER (WHERE fi.automation = 'manual')::int AS manual_items
       FROM frameworks f LEFT JOIN framework_items fi ON fi.framework_id = f.id
      GROUP BY f.id, f.key, f.name, f.version, f.verification_status
      ORDER BY f.key`,
  );
}

export async function listMappings(tx: Tx) {
  return tx.query(
    `SELECT * FROM framework_mappings ORDER BY source_framework, source_code`,
  );
}

/**
 * Import an official framework catalogue (JSON) as a new, versioned framework
 * record. Historical assessments keep referencing the version they used.
 */
export async function importCatalogue(
  tx: Tx,
  ctx: RequestContext,
  input: {
    key: string;
    name: string;
    version: string;
    publisher: string;
    sourceUrl?: string;
    notes?: string;
    items: {
      code: string;
      title: string;
      itemType: 'function' | 'category' | 'subcategory' | 'requirement' | 'test' | 'risk' | 'metric';
      parentCode?: string | null;
      description?: string | null;
      objective?: string | null;
      automation?: 'automated' | 'manual' | 'hybrid' | null;
      externalRefs?: string[];
      metadata?: Record<string, unknown>;
    }[];
  },
) {
  if (!can(ctx.user, 'framework:manage')) throw new ForbiddenError('Missing permission: framework:manage');
  if (!input.items?.length) throw new ValidationError('The imported catalogue contains no items');
  const duplicate = await tx.queryOne('SELECT id FROM frameworks WHERE key = $1 AND version = $2', [input.key, input.version]);
  if (duplicate) throw new ValidationError(`Framework ${input.key} version ${input.version} already exists. Import a new version identifier instead of overwriting history.`);

  const framework = await tx.queryOne<{ id: string }>(
    `INSERT INTO frameworks (key, name, version, publisher, source_url, status, verification_status, is_primary, notes)
     VALUES ($1,$2,$3,$4,$5,'active','imported',false,$6) RETURNING id`,
    [input.key, input.name, input.version, input.publisher, input.sourceUrl ?? null, input.notes ?? 'Imported official catalogue'],
  );
  let order = 0;
  for (const item of input.items) {
    order += 1;
    await tx.query(
      `INSERT INTO framework_items (framework_id, parent_code, item_type, code, title, description, objective, automation,
          external_refs, sort_order, verification_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'imported',$11)
       ON CONFLICT (framework_id, code) DO NOTHING`,
      [
        framework!.id,
        item.parentCode ?? null,
        item.itemType,
        item.code,
        item.title,
        item.description ?? null,
        item.objective ?? null,
        item.automation ?? null,
        JSON.stringify(item.externalRefs ?? []),
        order,
        JSON.stringify(item.metadata ?? {}),
      ],
    );
  }
  await recordAudit(
    {
      action: 'framework.catalogue_imported',
      entityType: 'framework',
      entityId: framework!.id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { key: input.key, version: input.version, items: input.items.length },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { id: framework!.id, items: input.items.length };
}

export async function markFrameworkVerified(tx: Tx, ctx: RequestContext, frameworkId: string) {
  if (!can(ctx.user, 'framework:manage')) throw new ForbiddenError('Missing permission: framework:manage');
  const framework = await tx.queryOne<{ key: string; version: string }>('SELECT key, version FROM frameworks WHERE id = $1', [frameworkId]);
  if (!framework) throw new NotFoundError('Framework not found');
  await tx.query(`UPDATE frameworks SET verification_status = 'verified' WHERE id = $1`, [frameworkId]);
  await tx.query(`UPDATE framework_items SET verification_status = 'verified' WHERE framework_id = $1 AND verification_status <> 'imported'`, [frameworkId]);
  await recordAudit(
    {
      action: 'framework.verified',
      entityType: 'framework',
      entityId: frameworkId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { key: framework.key, version: framework.version },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

/** Findings grouped by framework item - used by coverage dashboards and reports. */
export async function findingsByFramework(tx: Tx, ctx: RequestContext, filters: { institutionId?: string } = {}) {
  const params: unknown[] = [ctx.mode];
  let clause = '';
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clause = `AND f.institution_id = $${params.length}`;
  }
  return tx.query(
    `SELECT l.framework_key, l.framework_version, l.item_code, count(DISTINCT f.id)::int AS findings,
            max(CASE f.technical_severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS severity_rank
       FROM finding_framework_links l JOIN findings f ON f.id = l.finding_id
      WHERE f.data_mode = $1 ${clause}
      GROUP BY l.framework_key, l.framework_version, l.item_code
      ORDER BY findings DESC`,
    params,
  );
}
