import { decrypt, encrypt, sha256 } from '@/lib/crypto';
import type { Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { redactText, containsUnredactedSensitiveData } from '@/lib/redact';

/**
 * Evidence management service.
 *
 * - Content is redacted, encrypted (AES-256-GCM) and stored with a SHA-256
 *   digest so integrity can be re-verified later.
 * - Every read is permission checked, audited and recorded in the access log.
 * - Institution contacts can only see evidence explicitly approved for sharing.
 */

export type EvidenceKind = 'http_exchange' | 'http_response' | 'screenshot' | 'log' | 'artifact' | 'document' | 'manifest' | 'api_spec' | 'other';

export type EvidenceInput = {
  institutionId: string;
  engagementId?: string | null;
  applicationId?: string | null;
  kind: EvidenceKind;
  title: string;
  mediaType?: string;
  content: string | Buffer;
  classification?: 'internal' | 'confidential' | 'restricted';
  shareWithInstitution?: boolean;
  retentionDays?: number;
  legalHold?: boolean;
  createdBy?: string | null;
};

export async function createEvidence(tx: Tx, ctx: RequestContext | null, input: EvidenceInput) {
  if (ctx && !can(ctx.user, 'evidence:create')) throw new ForbiddenError('Missing permission: evidence:create');
  if (!input.title?.trim()) throw new ValidationError('Evidence title is required');

  const isText = typeof input.content === 'string' || input.mediaType?.startsWith('text/') || input.mediaType === 'application/json';
  let raw: Buffer;
  let redactions: { type: string; count: number }[] = [];
  let redacted = false;

  if (isText) {
    const text = typeof input.content === 'string' ? input.content : input.content.toString('utf8');
    const result = redactText(text);
    raw = Buffer.from(result.text, 'utf8');
    redactions = result.redactions;
    redacted = result.redactions.length > 0;
  } else {
    // Binary artefacts are stored as supplied; they are never rendered inline.
    raw = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content);
  }

  const digest = sha256(raw);
  const retentionUntil = input.retentionDays ? new Date(Date.now() + input.retentionDays * 86400000).toISOString().slice(0, 10) : null;

  const row = await tx.queryOne<{ id: string; size_bytes: number; body_sha256: string }>(
    `INSERT INTO evidence (engagement_id, institution_id, application_id, kind, title, media_type, body_enc, body_sha256,
        size_bytes, redacted, redactions, classification, share_with_institution, retention_until, legal_hold, data_mode, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id, size_bytes, body_sha256`,
    [
      input.engagementId ?? null,
      input.institutionId,
      input.applicationId ?? null,
      input.kind,
      input.title.trim(),
      input.mediaType ?? 'text/plain',
      encrypt(raw),
      digest,
      raw.length,
      redacted,
      JSON.stringify(redactions),
      input.classification ?? 'confidential',
      Boolean(input.shareWithInstitution),
      retentionUntil,
      Boolean(input.legalHold),
      ctx?.mode ?? 'demo',
      input.createdBy ?? ctx?.user.id ?? null,
    ],
  );

  if (ctx) {
    await recordAudit(
      {
        action: 'evidence.created',
        entityType: 'evidence',
        entityId: row!.id,
        institutionId: input.institutionId,
        engagementId: input.engagementId ?? null,
        actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
        metadata: { kind: input.kind, sizeBytes: raw.length, redacted, redactions: redactions.length, shared: Boolean(input.shareWithInstitution) },
        ip: ctx.ip,
        dataMode: ctx.mode,
      },
      tx,
    );
  }
  return { id: row!.id, sha256: digest, sizeBytes: raw.length, redacted, redactions };
}

export async function attachEvidenceToFinding(tx: Tx, ctx: RequestContext, findingId: string, evidenceId: string, caption?: string) {
  if (!can(ctx.user, 'evidence:create')) throw new ForbiddenError('Missing permission: evidence:create');
  const finding = await tx.queryOne<{ institution_id: string; engagement_id: string }>('SELECT institution_id, engagement_id FROM findings WHERE id = $1', [findingId]);
  if (!finding) throw new NotFoundError('Finding not found');
  const evidence = await tx.queryOne<{ institution_id: string }>('SELECT institution_id FROM evidence WHERE id = $1', [evidenceId]);
  if (!evidence) throw new NotFoundError('Evidence not found');
  if (evidence.institution_id !== finding.institution_id) throw new ForbiddenError('Evidence belongs to another institution');
  await tx.query(
    `INSERT INTO finding_evidence (finding_id, evidence_id, institution_id, caption) VALUES ($1,$2,$3,$4)
     ON CONFLICT (finding_id, evidence_id) DO UPDATE SET caption = EXCLUDED.caption`,
    [findingId, evidenceId, finding.institution_id, caption ?? null],
  );
  await recordAudit(
    {
      action: 'finding.evidence_attached',
      entityType: 'finding',
      entityId: findingId,
      institutionId: finding.institution_id,
      engagementId: finding.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { evidenceId },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export type EvidenceRow = {
  id: string;
  institution_id: string;
  engagement_id: string | null;
  application_id: string | null;
  kind: string;
  title: string;
  media_type: string;
  body_sha256: string;
  size_bytes: number;
  redacted: boolean;
  redactions: { type: string; count: number }[];
  classification: string;
  share_with_institution: boolean;
  retention_until: string | null;
  legal_hold: boolean;
  created_at: string;
  accessed_count: number;
};

export async function listEvidence(tx: Tx, ctx: RequestContext, filters: { institutionId?: string; engagementId?: string; findingId?: string } = {}) {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`e.institution_id = $${params.length}`);
  }
  if (filters.engagementId) {
    params.push(filters.engagementId);
    clauses.push(`e.engagement_id = $${params.length}`);
  }
  if (filters.findingId) {
    params.push(filters.findingId);
    clauses.push(`e.id IN (SELECT evidence_id FROM finding_evidence WHERE finding_id = $${params.length})`);
  }
  if (ctx.user.role === 'institution_contact') {
    clauses.push('e.share_with_institution = true');
  }
  return tx.query<EvidenceRow>(
    `SELECT e.* FROM evidence e ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY e.created_at DESC LIMIT 200`,
    params,
  );
}

export async function readEvidence(
  tx: Tx,
  ctx: RequestContext,
  evidenceId: string,
  action: 'view' | 'download',
) {
  if (ctx.user.role === 'institution_contact' && !can(ctx.user, 'evidence:read')) throw new ForbiddenError('Missing permission: evidence:read');
  if (action === 'download') {
    if (!can(ctx.user, 'evidence:download')) throw new ForbiddenError('Missing permission: evidence:download');
  } else if (!can(ctx.user, 'evidence:read')) {
    throw new ForbiddenError('Missing permission: evidence:read');
  }

  const evidence = await tx.queryOne<EvidenceRow & { body_enc: Uint8Array }>('SELECT * FROM evidence WHERE id = $1', [evidenceId]);
  if (!evidence) throw new NotFoundError('Evidence not found');
  if (ctx.user.role === 'institution_contact' && !evidence.share_with_institution) {
    throw new ForbiddenError('This evidence has not been approved for sharing with the institution');
  }

  const content = decrypt(evidence.body_enc);
  const digest = sha256(content);
  if (digest !== evidence.body_sha256) {
    await recordAudit(
      {
        action: 'evidence.integrity_failure',
        entityType: 'evidence',
        entityId: evidenceId,
        institutionId: evidence.institution_id,
        engagementId: evidence.engagement_id,
        actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
        outcome: 'failure',
        metadata: { expected: evidence.body_sha256, computed: digest },
        ip: ctx.ip,
        dataMode: ctx.mode,
      },
      tx,
    );
    throw new ValidationError('Evidence integrity verification failed. The record has been flagged.');
  }

  if (evidence.media_type.startsWith('text/') || evidence.media_type === 'application/json') {
    const text = content.toString('utf8');
    if (containsUnredactedSensitiveData(text)) {
      throw new ValidationError('Evidence contains unredacted sensitive material and cannot be displayed. Re-capture with redaction enabled.');
    }
  }

  await tx.query('UPDATE evidence SET accessed_count = accessed_count + 1 WHERE id = $1', [evidenceId]);
  await tx.query(
    `INSERT INTO evidence_access_log (evidence_id, institution_id, user_id, action, ip) VALUES ($1,$2,$3,$4,$5)`,
    [evidenceId, evidence.institution_id, ctx.user.id, action, ctx.ip],
  );
  await recordAudit(
    {
      action: action === 'download' ? 'evidence.downloaded' : 'evidence.viewed',
      entityType: 'evidence',
      entityId: evidenceId,
      institutionId: evidence.institution_id,
      engagementId: evidence.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { sha256: evidence.body_sha256, sizeBytes: evidence.size_bytes, classification: evidence.classification },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      dataMode: ctx.mode,
    },
    tx,
  );

  return {
    id: evidence.id,
    title: evidence.title,
    mediaType: evidence.media_type,
    sha256: digest,
    sizeBytes: evidence.size_bytes,
    redacted: evidence.redacted,
    redactions: evidence.redactions,
    content,
  };
}

export async function setEvidenceSharing(tx: Tx, ctx: RequestContext, evidenceId: string, share: boolean) {
  if (!can(ctx.user, 'evidence:share')) throw new ForbiddenError('Missing permission: evidence:share');
  const evidence = await tx.queryOne<{ institution_id: string; engagement_id: string | null; title: string }>('SELECT institution_id, engagement_id, title FROM evidence WHERE id = $1', [evidenceId]);
  if (!evidence) throw new NotFoundError('Evidence not found');
  await tx.query('UPDATE evidence SET share_with_institution = $2 WHERE id = $1', [evidenceId, share]);
  await recordAudit(
    {
      action: share ? 'evidence.shared_with_institution' : 'evidence.sharing_revoked',
      entityType: 'evidence',
      entityId: evidenceId,
      institutionId: evidence.institution_id,
      engagementId: evidence.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { title: evidence.title },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function verifyEvidenceIntegrity(tx: Tx, evidenceId: string) {
  const evidence = await tx.queryOne<{ body_enc: Uint8Array; body_sha256: string }>('SELECT body_enc, body_sha256 FROM evidence WHERE id = $1', [evidenceId]);
  if (!evidence) throw new NotFoundError('Evidence not found');
  const digest = sha256(decrypt(evidence.body_enc));
  return { ok: digest === evidence.body_sha256, expected: evidence.body_sha256, computed: digest };
}
