/**
 * National financial institution and digital asset registry.
 *
 * Design rules enforced here:
 *
 * 1. A registry record describes an entity; it is never an authorisation to
 *    test. No function in this module launches or schedules an assessment.
 * 2. Provenance is mandatory. Every imported record keeps its source, the
 *    retrieval time and the time it was last verified by a human.
 * 3. Ownership of a digital asset is never inferred from a name, a domain, a
 *    certificate or a DNS relationship. An asset stays `candidate` until a named
 *    assessor records the evidence they reviewed and marks it verified.
 * 4. Imports are additive and reversible in effect: they never delete a record
 *    and never silently change a licence category.
 */
import type { Tx } from '@/lib/db/pool';
import type { RequestContext } from '@/lib/db/context';
import { can } from '@/lib/rbac';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from '@/lib/domain/audit';
import { INSTITUTION_CATEGORIES } from '@/lib/domain/institutions';

export const DIGITAL_ASSET_TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'web_app', label: 'Web application', hint: 'Publicly reachable web property operated for the institution.' },
  { key: 'internet_banking', label: 'Internet banking portal', hint: 'Retail or SME online banking entry point.' },
  { key: 'corporate_banking', label: 'Corporate banking portal', hint: 'Corporate or treasury banking channel.' },
  { key: 'admin_portal', label: 'Privileged administration portal', hint: 'Staff or operations console. Highest confidentiality.' },
  { key: 'api', label: 'Public or partner API', hint: 'Documented API surface; base URL only, no credentials stored here.' },
  { key: 'webhook', label: 'Webhook endpoint', hint: 'Callback endpoint receiving merchant or partner events.' },
  { key: 'mobile_android', label: 'Android application', hint: 'Package identifier, e.g. com.example.bank.' },
  { key: 'mobile_ios', label: 'iOS application', hint: 'Bundle identifier of the iOS application.' },
  { key: 'onboarding', label: 'Customer onboarding / KYC', hint: 'Account opening, identity capture or KYC workflow.' },
  { key: 'core_banking_interface', label: 'Core banking interface', hint: 'Integration surface into the core ledger. Never tested without explicit approval.' },
  { key: 'third_party_service', label: 'Third-party service', hint: 'Outsourced provider supporting the institution. Separate owner and authorisation.' },
  { key: 'shared_infrastructure', label: 'Shared sector infrastructure', hint: 'Infrastructure shared by several institutions. Testing requires every owner to authorise.' },
];

export const ASSET_STATUS_LABELS: Record<string, string> = {
  candidate: 'Candidate — ownership not verified',
  ownership_verified: 'Ownership verified by an assessor',
  ownership_rejected: 'Ownership rejected — not the institution’s asset',
  unverified: 'Unverified — awaiting evidence',
  retired: 'Retired — no longer in service',
};

export type RegistryFilters = {
  search?: string;
  category?: string;
  regulator?: string;
  licenceStatus?: string;
  verification?: string;
  staleOnly?: boolean;
};

/** Institutions with provenance, licence state and asset counts. */
export async function listRegistry(tx: Tx, ctx: RequestContext, filters: RegistryFilters = {}) {
  const params: unknown[] = [ctx.mode];
  const clauses = ['i.data_mode = $1'];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(i.name ILIKE $${params.length} OR i.code ILIKE $${params.length} OR coalesce(i.trading_name,'') ILIKE $${params.length} OR coalesce(i.licence_number,'') ILIKE $${params.length})`);
  }
  if (filters.category) {
    params.push(filters.category);
    clauses.push(`i.category = $${params.length}`);
  }
  if (filters.regulator) {
    params.push(filters.regulator);
    clauses.push(`i.regulator = $${params.length}`);
  }
  if (filters.licenceStatus) {
    params.push(filters.licenceStatus);
    clauses.push(`i.licence_status = $${params.length}`);
  }
  if (filters.verification) {
    params.push(filters.verification);
    clauses.push(`i.verification_status = $${params.length}`);
  }
  if (filters.staleOnly) {
    clauses.push('(i.last_verified_at IS NULL OR i.last_verified_at < now() - (i.stale_after_days || \' days\')::interval)');
  }
  return tx.query<any>(
    `SELECT i.id, i.code, i.name, i.trading_name, i.category, i.regulator, i.licence_category, i.licence_status,
            i.licence_number, i.risk_tier, i.status, i.verification_status, i.source_name, i.source_url,
            i.source_retrieved_at, i.last_verified_at, i.stale_after_days, i.city, i.state,
            (SELECT count(*)::int FROM digital_assets d WHERE d.institution_id = i.id) AS asset_count,
            (SELECT count(*)::int FROM digital_assets d WHERE d.institution_id = i.id AND d.status = 'ownership_verified') AS verified_assets,
            (SELECT count(*)::int FROM applications a WHERE a.institution_id = i.id AND a.status = 'active') AS application_count,
            (i.last_verified_at IS NULL OR i.last_verified_at < now() - (i.stale_after_days || ' days')::interval) AS stale
       FROM institutions i
      WHERE ${clauses.join(' AND ')}
      ORDER BY stale DESC, i.risk_tier, i.name
      LIMIT 300`,
    params,
  );
}

export async function registryOverview(tx: Tx, ctx: RequestContext) {
  const totals = await tx.queryOne<any>(
    `SELECT
       (SELECT count(*)::int FROM institutions WHERE data_mode = $1) AS institutions,
       (SELECT count(*)::int FROM institutions WHERE data_mode = $1 AND (last_verified_at IS NULL OR last_verified_at < now() - (stale_after_days || ' days')::interval)) AS stale_institutions,
       (SELECT count(*)::int FROM digital_assets WHERE data_mode = $1) AS assets,
       (SELECT count(*)::int FROM digital_assets WHERE data_mode = $1 AND status = 'ownership_verified') AS verified_assets,
       (SELECT count(*)::int FROM digital_assets WHERE data_mode = $1 AND status = 'candidate') AS candidate_assets,
       (SELECT count(*)::int FROM registry_verification_queue WHERE data_mode = $1 AND status IN ('open','in_review')) AS queue_open,
       (SELECT count(*)::int FROM registry_imports) AS imports,
       (SELECT max(created_at)::text FROM registry_imports) AS last_import`,
    [ctx.mode],
  );
  const byCategory = await tx.query<any>(
    `SELECT category, regulator, count(*)::int AS institutions,
            count(*) FILTER (WHERE last_verified_at IS NULL OR last_verified_at < now() - (stale_after_days || ' days')::interval)::int AS stale
       FROM institutions WHERE data_mode = $1 GROUP BY category, regulator ORDER BY institutions DESC`,
    [ctx.mode],
  );
  const queue = await tx.query<any>(
    `SELECT q.*, i.name AS institution_name, a.display_name AS asset_name
       FROM registry_verification_queue q
       LEFT JOIN institutions i ON i.id = q.institution_id
       LEFT JOIN digital_assets a ON a.id = q.asset_id
      WHERE q.data_mode = $1 AND q.status IN ('open','in_review')
      ORDER BY CASE q.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, q.created_at
      LIMIT 40`,
    [ctx.mode],
  );
  const imports = await tx.query<any>(
    `SELECT id, source_name, source_url, regulator, format, retrieved_at, row_count, created_count, updated_count,
            conflict_count, rejected_count, status, created_at
       FROM registry_imports ORDER BY created_at DESC LIMIT 10`,
  );
  return { totals, byCategory, queue, imports };
}

export async function listDigitalAssets(tx: Tx, ctx: RequestContext, filters: { institutionId?: string; status?: string; assetType?: string } = {}) {
  const params: unknown[] = [ctx.mode];
  const clauses = ['d.data_mode = $1'];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`d.institution_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`d.status = $${params.length}`);
  }
  if (filters.assetType) {
    params.push(filters.assetType);
    clauses.push(`d.asset_type = $${params.length}`);
  }
  return tx.query<any>(
    `SELECT d.*, i.name AS institution_name, a.name AS application_name,
            (SELECT count(*)::int FROM engagements e JOIN engagement_applications ea ON ea.engagement_id = e.id
              WHERE ea.application_id = d.application_id) AS engagements_linked
       FROM digital_assets d
       JOIN institutions i ON i.id = d.institution_id
       LEFT JOIN applications a ON a.id = d.application_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY CASE d.status WHEN 'candidate' THEN 0 WHEN 'unverified' THEN 1 ELSE 2 END, i.name, d.display_name
      LIMIT 300`,
    params,
  );
}

/**
 * Record a digital asset. It is always created as a candidate: ownership must be
 * verified separately, with the evidence recorded.
 */
export async function createDigitalAsset(
  tx: Tx,
  ctx: RequestContext,
  input: {
    institutionId: string;
    assetType: string;
    displayName: string;
    identifier: string;
    environment?: string;
    applicationId?: string | null;
    technicalContactName?: string;
    technicalContactEmail?: string;
    sourceName?: string;
    sourceUrl?: string;
    notes?: string;
  },
) {
  if (!can(ctx.user, 'institution:write')) throw new ForbiddenError('Missing permission: institution:write');
  if (!DIGITAL_ASSET_TYPES.some((type) => type.key === input.assetType)) throw new ValidationError('Unknown digital asset type');
  if (!input.displayName?.trim()) throw new ValidationError('A display name is required');
  const identifier = input.identifier?.trim();
  if (!identifier) throw new ValidationError('An identifier (domain, URL or package name) is required');
  if (identifier.length > 300) throw new ValidationError('Identifier is too long');

  const institution = await tx.queryOne<{ id: string; data_mode: string }>('SELECT id, data_mode FROM institutions WHERE id = $1', [input.institutionId]);
  if (!institution) throw new NotFoundError('Institution not found');
  if (institution.data_mode !== ctx.mode) throw new ValidationError('Institution belongs to a different platform mode');

  const existing = await tx.queryOne<{ id: string }>(
    'SELECT id FROM digital_assets WHERE institution_id = $1 AND asset_type = $2 AND identifier = $3',
    [input.institutionId, input.assetType, identifier],
  );
  if (existing) throw new ValidationError('This asset is already recorded for the institution');

  const row = await tx.queryOne<any>(
    `INSERT INTO digital_assets (institution_id, application_id, asset_type, display_name, identifier, environment, status,
        technical_contact_name, technical_contact_email, source_name, source_url, retrieved_at, notes, data_mode, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'candidate',$7,$8,$9,$10,now(),$11,$12,$13) RETURNING *`,
    [
      input.institutionId,
      input.applicationId ?? null,
      input.assetType,
      input.displayName.trim(),
      identifier,
      input.environment ?? 'production',
      input.technicalContactName ?? null,
      input.technicalContactEmail ?? null,
      input.sourceName ?? 'Manual entry',
      input.sourceUrl ?? null,
      input.notes ?? null,
      ctx.mode,
      ctx.user.id,
    ],
  );

  await tx.query(
    `INSERT INTO registry_verification_queue (institution_id, asset_id, item_type, summary, detail, priority, data_mode)
     VALUES ($1,$2,'ownership_claim',$3,$4,'high',$5)`,
    [
      input.institutionId,
      row!.id,
      `Ownership claim for ${input.displayName} (${identifier})`,
      'A registry entry is not an authorisation. Record the evidence that establishes the institution operates this asset before any engagement references it.',
      ctx.mode,
    ],
  );

  await recordAudit(
    {
      action: 'registry.asset_claimed',
      entityType: 'digital_asset',
      entityId: row!.id,
      institutionId: input.institutionId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { assetType: input.assetType, identifier, status: 'candidate' },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return row;
}

/** Verify or reject ownership, recording the evidence reviewed. */
export async function verifyAssetOwnership(
  tx: Tx,
  ctx: RequestContext,
  input: { assetId: string; decision: 'verified' | 'rejected'; evidence: string },
) {
  if (!can(ctx.user, 'institution:write')) throw new ForbiddenError('Missing permission: institution:write');
  if (!input.evidence || input.evidence.trim().length < 20) {
    throw new ValidationError('Record the evidence reviewed (at least 20 characters) so ownership can be defended later');
  }
  const asset = await tx.queryOne<any>('SELECT * FROM digital_assets WHERE id = $1', [input.assetId]);
  if (!asset) throw new NotFoundError('Digital asset not found');
  if (asset.data_mode !== ctx.mode) throw new ValidationError('Asset belongs to a different platform mode');

  const status = input.decision === 'verified' ? 'ownership_verified' : 'ownership_rejected';
  await tx.query(
    `UPDATE digital_assets SET status = $2, ownership_evidence = $3, verified_by = $4, verified_at = now(), updated_at = now() WHERE id = $1`,
    [input.assetId, status, input.evidence.trim(), ctx.user.id],
  );
  await tx.query(
    `UPDATE registry_verification_queue SET status = 'resolved', resolved_by = $2, resolved_at = now(), resolution_note = $3
      WHERE asset_id = $1 AND status IN ('open','in_review')`,
    [input.assetId, ctx.user.id, `${input.decision}: ${input.evidence.trim()}`],
  );
  await recordAudit(
    {
      action: input.decision === 'verified' ? 'registry.ownership_verified' : 'registry.ownership_rejected',
      entityType: 'digital_asset',
      entityId: input.assetId,
      institutionId: asset.institution_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { identifier: asset.identifier, assetType: asset.asset_type, evidence: input.evidence.trim() },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { status };
}

export async function recordLicenceEvent(
  tx: Tx,
  ctx: RequestContext,
  input: {
    institutionId: string;
    eventType: string;
    licenceCategory?: string;
    licenceNumber?: string;
    effectiveAt: string;
    regulator?: string;
    sourceName?: string;
    sourceUrl?: string;
    evidenceNote?: string;
  },
) {
  if (!can(ctx.user, 'institution:write')) throw new ForbiddenError('Missing permission: institution:write');
  if (!input.effectiveAt) throw new ValidationError('An effective date is required');
  const institution = await tx.queryOne<any>('SELECT * FROM institutions WHERE id = $1', [input.institutionId]);
  if (!institution) throw new NotFoundError('Institution not found');

  const row = await tx.queryOne<any>(
    `INSERT INTO licence_events (institution_id, event_type, licence_category, licence_number, effective_at, regulator,
        source_name, source_url, evidence_note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      input.institutionId,
      input.eventType,
      input.licenceCategory ?? institution.licence_category ?? null,
      input.licenceNumber ?? institution.licence_number ?? null,
      input.effectiveAt,
      input.regulator ?? institution.regulator ?? null,
      input.sourceName ?? 'Manual entry',
      input.sourceUrl ?? null,
      input.evidenceNote ?? null,
      ctx.user.id,
    ],
  );

  // Only unambiguous events change the current licence state. Mergers and
  // renamed entities are recorded as history and queued for reconciliation.
  const nextStatus: Record<string, string> = {
    granted: 'active', renewed: 'active', varied: 'active', category_changed: 'active',
    suspended: 'suspended', revoked: 'revoked', surrendered: 'surrendered', expired: 'expired',
  };
  if (nextStatus[input.eventType]) {
    await tx.query(
      `UPDATE institutions SET licence_status = $2,
              licence_category = COALESCE($3, licence_category),
              licence_number = COALESCE($4, licence_number),
              regulator = COALESCE($5, regulator),
              updated_at = now()
        WHERE id = $1`,
      [input.institutionId, nextStatus[input.eventType], input.licenceCategory ?? null, input.licenceNumber ?? null, input.regulator ?? null],
    );
  } else {
    await tx.query(
      `INSERT INTO registry_verification_queue (institution_id, item_type, summary, detail, priority, data_mode)
       VALUES ($1,$2,$3,$4,'medium',$5)`,
      [
        input.institutionId,
        input.eventType === 'merged' ? 'duplicate_suspected' : 'licence_change',
        `${input.eventType} recorded for ${institution.name}`,
        'Reconcile the entity’s current licence state and any successor entity before relying on this record.',
        ctx.mode,
      ],
    );
  }

  await recordAudit(
    {
      action: 'registry.licence_event',
      entityType: 'institution',
      entityId: input.institutionId,
      institutionId: input.institutionId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { eventType: input.eventType, effectiveAt: input.effectiveAt, source: input.sourceName ?? 'manual' },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return row;
}

export async function markInstitutionVerified(tx: Tx, ctx: RequestContext, institutionId: string, note?: string) {
  if (!can(ctx.user, 'institution:write')) throw new ForbiddenError('Missing permission: institution:write');
  const institution = await tx.queryOne<any>('SELECT * FROM institutions WHERE id = $1', [institutionId]);
  if (!institution) throw new NotFoundError('Institution not found');
  await tx.query(
    `UPDATE institutions SET verification_status = 'verified', last_verified_at = now(), registry_notes = COALESCE($2, registry_notes), updated_at = now() WHERE id = $1`,
    [institutionId, note ?? null],
  );
  await recordAudit(
    {
      action: 'registry.institution_verified',
      entityType: 'institution',
      entityId: institutionId,
      institutionId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { source: institution.source_name, note: note ?? null },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

/**
 * Import a regulator-supplied list.
 *
 * The parser accepts CSV with a header row or JSON with an `institutions` array.
 * It never overwrites an existing licence category without flagging a conflict,
 * never deletes records, and never derives digital assets from the import.
 */
export type ImportRow = {
  code?: string;
  name: string;
  category?: string;
  regulator?: string;
  licenceNumber?: string;
  licenceCategory?: string;
  licenceStatus?: string;
  city?: string;
  state?: string;
  website?: string;
  tradingName?: string;
};

export function parseRegistryPayload(format: 'csv' | 'json', payload: string): ImportRow[] {
  const text = payload.trim();
  if (!text) throw new ValidationError('The import payload is empty');

  if (format === 'json') {
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ValidationError('The payload is not valid JSON');
    }
    const rows = Array.isArray(parsed) ? parsed : parsed?.institutions;
    if (!Array.isArray(rows) || !rows.length) throw new ValidationError('The JSON payload must contain a non-empty institutions array');
    return rows.slice(0, 2000).map((row: any) => ({
      code: row.code ? String(row.code).toUpperCase().slice(0, 20) : undefined,
      name: String(row.name ?? '').trim(),
      category: row.category ? String(row.category).trim() : undefined,
      regulator: row.regulator ? String(row.regulator).trim() : undefined,
      licenceNumber: row.licenceNumber ? String(row.licenceNumber).trim() : undefined,
      licenceCategory: row.licenceCategory ? String(row.licenceCategory).trim() : undefined,
      licenceStatus: row.licenceStatus ? String(row.licenceStatus).trim() : undefined,
      city: row.city ? String(row.city).trim() : undefined,
      state: row.state ? String(row.state).trim() : undefined,
      website: row.website ? String(row.website).trim() : undefined,
      tradingName: row.tradingName ? String(row.tradingName).trim() : undefined,
    }));
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
  if (lines.length < 2) throw new ValidationError('CSV import requires a header row and at least one data row');
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z]/g, ''));
  const index = (name: string) => headers.indexOf(name);
  const columns = {
    name: index('name') >= 0 ? index('name') : index('institutionname'),
    code: index('code'),
    category: index('category'),
    regulator: index('regulator'),
    licenceNumber: index('licencenumber') >= 0 ? index('licencenumber') : index('licence'),
    licenceCategory: index('licencecategory'),
    licenceStatus: index('licencestatus'),
    city: index('city'),
    state: index('state'),
    website: index('website'),
    tradingName: index('tradingname'),
  };
  if (columns.name < 0) throw new ValidationError('CSV must include a name (or institution name) column');

  const rows: ImportRow[] = [];
  for (const line of lines.slice(1, 2001)) {
    const cells = parseLine(line);
    const value = (position: number) => (position >= 0 && cells[position] !== undefined ? cells[position].trim() : undefined);
    const name = value(columns.name);
    if (!name) continue;
    rows.push({
      code: value(columns.code)?.toUpperCase().slice(0, 20),
      name,
      category: value(columns.category),
      regulator: value(columns.regulator),
      licenceNumber: value(columns.licenceNumber),
      licenceCategory: value(columns.licenceCategory),
      licenceStatus: value(columns.licenceStatus),
      city: value(columns.city),
      state: value(columns.state),
      website: value(columns.website),
      tradingName: value(columns.tradingName),
    });
  }
  if (!rows.length) throw new ValidationError('No usable row was found in the payload');
  return rows;
}

export async function importRegistry(
  tx: Tx,
  ctx: RequestContext,
  input: { format: 'csv' | 'json'; payload: string; sourceName: string; sourceUrl?: string; regulator?: string; retrievedAt?: string },
) {
  if (!can(ctx.user, 'institution:write')) throw new ForbiddenError('Missing permission: institution:write');
  if (!input.sourceName?.trim()) throw new ValidationError('Name the official source for this import');

  const rows = parseRegistryPayload(input.format, input.payload);
  const validCategories = new Set<string>(INSTITUTION_CATEGORIES.map((category) => category.key));
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const conflicts: string[] = [];
  const rejected: string[] = [];

  for (const row of rows) {
    if (!row.name) {
      rejected.push('row without a name');
      continue;
    }
    const category = row.category && validCategories.has(row.category) ? row.category : undefined;
    if (row.category && !category) conflicts.push(`${row.name}: unknown category "${row.category}" — recorded without a category change`);

    const existing = row.code
      ? await tx.queryOne<any>('SELECT * FROM institutions WHERE code = $1', [row.code])
      : await tx.queryOne<any>('SELECT * FROM institutions WHERE lower(name) = lower($1) AND data_mode = $2', [row.name, ctx.mode]);

    if (!existing) {
      const code = row.code ?? (await nextInstitutionCode(tx, row.name));
      await tx.query(
        `INSERT INTO institutions (code, name, category, licence_number, regulator, licence_category, licence_status,
            city, state, website, trading_name, status, risk_tier, data_mode, created_by,
            source_name, source_url, source_retrieved_at, verification_status, stale_after_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active','unassessed',$12,$13,$14,$15,$16,'provisional',180)`,
        [
          code,
          row.name,
          category ?? 'other',
          row.licenceNumber ?? null,
          row.regulator ?? input.regulator ?? null,
          row.licenceCategory ?? null,
          row.licenceStatus ?? 'unknown',
          row.city ?? null,
          row.state ?? null,
          row.website ?? null,
          row.tradingName ?? null,
          ctx.mode,
          ctx.user.id,
          input.sourceName,
          input.sourceUrl ?? null,
          input.retrievedAt ?? new Date().toISOString(),
        ],
      );
      created += 1;
      continue;
    }

    const differs =
      existing.name !== row.name ||
      (category && existing.category !== category) ||
      (row.licenceNumber && existing.licence_number !== row.licenceNumber) ||
      (row.licenceStatus && existing.licence_status !== row.licenceStatus);

    if (!differs) {
      unchanged += 1;
      continue;
    }

    // A licence category change is never applied silently: it is queued for a
    // human to reconcile against the official source.
    if (category && existing.category !== category) {
      conflicts.push(`${row.name}: category "${existing.category}" → "${category}" queued for reconciliation`);
      await tx.query(
        `INSERT INTO registry_verification_queue (institution_id, item_type, summary, detail, priority, data_mode)
         VALUES ($1,'licence_change',$2,$3,'high',$4)`,
        [existing.id, `Licence category change proposed for ${row.name}`, `${existing.category} → ${category} from ${input.sourceName}`, ctx.mode],
      );
    }

    await tx.query(
      `UPDATE institutions SET
          name = $2,
          licence_number = COALESCE($3, licence_number),
          licence_status = COALESCE($4, licence_status),
          regulator = COALESCE($5, regulator),
          licence_category = COALESCE($6, licence_category),
          trading_name = COALESCE($7, trading_name),
          website = COALESCE($8, website),
          city = COALESCE($9, city),
          state = COALESCE($10, state),
          source_name = $11,
          source_url = COALESCE($12, source_url),
          source_retrieved_at = $13,
          updated_at = now()
        WHERE id = $1`,
      [
        existing.id,
        row.name,
        row.licenceNumber ?? null,
        row.licenceStatus ?? null,
        row.regulator ?? input.regulator ?? null,
        category ?? null,
        row.tradingName ?? null,
        row.website ?? null,
        row.city ?? null,
        row.state ?? null,
        input.sourceName,
        input.sourceUrl ?? null,
        input.retrievedAt ?? new Date().toISOString(),
      ],
    );
    updated += 1;
  }

  const report = { conflicts, rejected };
  const importRow = await tx.queryOne<any>(
    `INSERT INTO registry_imports (source_name, source_url, regulator, format, retrieved_at, row_count, created_count,
        updated_count, unchanged_count, conflict_count, rejected_count, status, report, imported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      input.sourceName,
      input.sourceUrl ?? null,
      input.regulator ?? null,
      input.format,
      input.retrievedAt ?? new Date().toISOString(),
      rows.length,
      created,
      updated,
      unchanged,
      conflicts.length,
      rejected.length,
      conflicts.length || rejected.length ? 'partial' : 'applied',
      JSON.stringify(report),
      ctx.user.id,
    ],
  );

  await recordAudit(
    {
      action: 'registry.imported',
      entityType: 'registry_import',
      entityId: importRow!.id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { source: input.sourceName, rows: rows.length, created, updated, unchanged, conflicts: conflicts.length, rejected: rejected.length },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );

  return { id: importRow!.id, rows: rows.length, created, updated, unchanged, conflicts, rejected };
}

async function nextInstitutionCode(tx: Tx, name: string): Promise<string> {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 10) || 'INST';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`.slice(0, 20);
    const clash = await tx.queryOne('SELECT id FROM institutions WHERE code = $1', [candidate]);
    if (!clash) return candidate;
  }
  return `INST-${Date.now().toString(36).toUpperCase().slice(-8)}`;
}

export async function resolveQueueItem(
  tx: Tx,
  ctx: RequestContext,
  input: { queueId: string; decision: 'resolved' | 'rejected'; note: string },
) {
  if (!can(ctx.user, 'institution:write')) throw new ForbiddenError('Missing permission: institution:write');
  if (!input.note || input.note.trim().length < 10) throw new ValidationError('Record how the item was resolved');
  const item = await tx.queryOne<any>('SELECT * FROM registry_verification_queue WHERE id = $1', [input.queueId]);
  if (!item) throw new NotFoundError('Queue item not found');
  await tx.query(
    `UPDATE registry_verification_queue SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE id = $1`,
    [input.queueId, input.decision, ctx.user.id, input.note.trim()],
  );
  await recordAudit(
    {
      action: `registry.queue_${input.decision}`,
      entityType: 'registry_verification_queue',
      entityId: input.queueId,
      institutionId: item.institution_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { itemType: item.item_type, note: input.note.trim() },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function registryExport(tx: Tx, ctx: RequestContext) {
  const institutions = await tx.query<any>(
    `SELECT code, name, trading_name, category, regulator, licence_number, licence_category, licence_status,
            status, risk_tier, verification_status, source_name, source_url, source_retrieved_at, last_verified_at
       FROM institutions WHERE data_mode = $1 ORDER BY name`,
    [ctx.mode],
  );
  const assets = await tx.query<any>(
    `SELECT i.code AS institution_code, d.asset_type, d.display_name, d.identifier, d.environment, d.status,
            d.ownership_evidence, d.verified_at, d.source_name
       FROM digital_assets d JOIN institutions i ON i.id = d.institution_id
      WHERE d.data_mode = $1 ORDER BY i.name, d.display_name`,
    [ctx.mode],
  );
  return { institutions, assets, generatedAt: new Date().toISOString(), mode: ctx.mode };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
}
