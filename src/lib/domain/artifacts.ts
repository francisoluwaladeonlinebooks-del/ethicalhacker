import type { Tx } from '@/lib/db/pool';
import type { RequestContext } from '@/lib/db/context';
import { encrypt, sha256 } from '@/lib/crypto';
import { recordAudit } from '@/lib/domain/audit';
import { isServedStatus, scanBuffer } from '@/lib/evidence-scan';
import { can } from '@/lib/rbac';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';

/**
 * Artefact storage for mobile packages, source bundles, API specifications and
 * dependency manifests.
 *
 * Rules:
 *  - only an allow-list of kinds is accepted and the declared kind must match
 *    the file signature;
 *  - size and filename are validated before encryption;
 *  - content is encrypted at rest and never served back to the browser as a
 *    raw download without a permission check and an audit record;
 *  - analysis output is stored separately so a later engine version cannot
 *    silently rewrite historical findings.
 */

export type ArtifactKind = 'apk' | 'aab' | 'ipa' | 'zip' | 'source' | 'openapi' | 'postman' | 'osv_db' | 'other';

export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

const EXTENSION_KIND: Record<string, ArtifactKind> = {
  apk: 'apk',
  aab: 'aab',
  ipa: 'ipa',
  zip: 'zip',
  tar: 'other',
  gz: 'other',
  json: 'openapi',
  yaml: 'openapi',
  yml: 'openapi',
  txt: 'other',
  lock: 'other',
  xml: 'other',
  gradle: 'other',
  kts: 'other',
  podspec: 'other',
  mod: 'other',
  sum: 'other',
};

function signature(buf: Buffer): 'zip' | 'text' | 'binary' {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) return 'zip';
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable += 1;
  }
  return printable / Math.max(1, sample.length) > 0.9 ? 'text' : 'binary';
}

export function sanitiseFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'artifact';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return cleaned.length ? cleaned : 'artifact';
}

export function guessKind(filename: string, mediaType: string): ArtifactKind {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'json' && /postman/i.test(filename)) return 'postman';
  return EXTENSION_KIND[ext] ?? 'other';
}

export async function storeArtifact(
  tx: Tx,
  ctx: RequestContext,
  input: {
    institutionId: string;
    engagementId?: string | null;
    applicationId?: string | null;
    kind: ArtifactKind;
    filename: string;
    mediaType?: string;
    content: Buffer;
    retentionDays?: number;
  },
) {
  if (!can(ctx.user, 'evidence:create')) throw new ForbiddenError('Missing permission: evidence:create');
  if (!input.content?.length) throw new ValidationError('The uploaded file is empty');
  if (input.content.length > MAX_ARTIFACT_BYTES) {
    throw new ValidationError(`Files larger than ${Math.round(MAX_ARTIFACT_BYTES / 1024 / 1024)} MB cannot be uploaded in the browser. Contact the platform administrator for bulk handling.`);
  }
  if (!input.institutionId) throw new ValidationError('An institution is required for every artefact');

  const filename = sanitiseFilename(input.filename);
  const sig = signature(input.content);
  if (['apk', 'aab', 'ipa', 'zip'].includes(input.kind) && sig !== 'zip') {
    throw new ValidationError('The file content does not match the declared package type (expected a ZIP container).');
  }
  if (['openapi', 'postman'].includes(input.kind) && sig === 'binary') {
    throw new ValidationError('API specifications must be JSON or YAML text documents.');
  }
  const digest = sha256(input.content);
  const duplicate = await tx.queryOne<{ id: string; filename: string }>(
    'SELECT id, filename FROM artifacts WHERE sha256 = $1 AND institution_id = $2',
    [digest, input.institutionId],
  );
  if (duplicate) throw new ValidationError(`This exact file has already been uploaded as "${duplicate.filename}".`);

  // The file is untrusted until a scanner says otherwise. A missing or failing
  // scanner is recorded as "not scanned"; it is never treated as clean.
  const scan = await scanBuffer(input.content, filename);
  const artifactStatus = scan.state === 'infected' ? 'quarantined' : 'stored';

  const retentionUntil = new Date(Date.now() + (input.retentionDays ?? 180) * 86400000).toISOString().slice(0, 10);
  const row = await tx.queryOne<{ id: string }>(
    `INSERT INTO artifacts (institution_id, engagement_id, application_id, kind, filename, media_type, size_bytes, sha256,
        body_enc, status, analysis, uploaded_by, retention_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      input.institutionId,
      input.engagementId ?? null,
      input.applicationId ?? null,
      input.kind,
      filename,
      input.mediaType ?? 'application/octet-stream',
      input.content.length,
      digest,
      encrypt(input.content),
      artifactStatus,
      JSON.stringify({ scan }),
      ctx.user.id,
      retentionUntil,
    ],
  );

  await recordAudit(
    {
      action: 'artifact.uploaded',
      entityType: 'artifact',
      entityId: row!.id,
      institutionId: input.institutionId,
      engagementId: input.engagementId ?? null,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: {
        kind: input.kind,
        filename,
        sizeBytes: input.content.length,
        sha256: digest,
        scanState: scan.state,
        scanProvider: scan.provider,
        ...(scan.signature ? { scanSignature: scan.signature } : {}),
      },
      outcome: scan.state === 'infected' ? 'failure' : 'success',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { id: row!.id, filename, sha256: digest, sizeBytes: input.content.length, kind: input.kind, scan };
}

export async function listArtifacts(tx: Tx, ctx: RequestContext, filters: { institutionId?: string; applicationId?: string; engagementId?: string } = {}) {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`a.institution_id = $${params.length}`);
  }
  if (filters.applicationId) {
    params.push(filters.applicationId);
    clauses.push(`a.application_id = $${params.length}`);
  }
  if (filters.engagementId) {
    params.push(filters.engagementId);
    clauses.push(`a.engagement_id = $${params.length}`);
  }
  return tx.query(
    `SELECT a.id, a.institution_id, a.engagement_id, a.application_id, a.kind, a.filename, a.media_type, a.size_bytes, a.sha256,
            a.status, a.uploaded_at, a.retention_until, a.analysis, u.name AS uploaded_by_name
       FROM artifacts a LEFT JOIN users u ON u.id = a.uploaded_by
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY a.uploaded_at DESC LIMIT 100`,
  );
}

export async function readArtifact(tx: Tx, ctx: RequestContext, artifactId: string) {
  const artifact = await tx.queryOne<{
    id: string;
    institution_id: string;
    filename: string;
    body_enc: Uint8Array;
    sha256: string;
    engagement_id: string | null;
    status: string;
    analysis: unknown;
  }>(
    'SELECT id, institution_id, filename, body_enc, sha256, engagement_id, status, analysis FROM artifacts WHERE id = $1',
    [artifactId],
  );
  if (!artifact) throw new NotFoundError('Artefact not found');
  if (!can(ctx.user, 'evidence:download')) throw new ForbiddenError('Missing permission: evidence:download');
  if (!isServedStatus(artifact.status, artifact.analysis)) {
    // A quarantined or failed artefact is not served to anyone, including the
    // administrator who uploaded it. The refusal is recorded.
    await recordAudit(
      {
        action: 'artifact.download_refused',
        entityType: 'artifact',
        entityId: artifactId,
        institutionId: artifact.institution_id,
        engagementId: artifact.engagement_id,
        outcome: 'failure',
        actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
        metadata: { filename: artifact.filename, status: artifact.status },
        ip: ctx.ip,
        dataMode: ctx.mode,
      },
      tx,
    );
    throw new ForbiddenError('This artefact is quarantined and cannot be downloaded');
  }
  const { decrypt } = await import('@/lib/crypto');
  const content = decrypt(artifact.body_enc);
  if (sha256(content) !== artifact.sha256) throw new ValidationError('Artefact integrity verification failed');
  await recordAudit(
    {
      action: 'artifact.downloaded',
      entityType: 'artifact',
      entityId: artifactId,
      institutionId: artifact.institution_id,
      engagementId: artifact.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { filename: artifact.filename, sha256: artifact.sha256 },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { filename: artifact.filename, content };
}

export async function deleteArtifact(tx: Tx, ctx: RequestContext, artifactId: string, reason: string) {
  if (!can(ctx.user, 'engine:manage') && !can(ctx.user, 'evidence:share')) throw new ForbiddenError('Missing permission to delete artefacts');
  const artifact = await tx.queryOne<{ institution_id: string; engagement_id: string | null; filename: string }>(
    'SELECT institution_id, engagement_id, filename FROM artifacts WHERE id = $1',
    [artifactId],
  );
  if (!artifact) throw new NotFoundError('Artefact not found');
  await tx.query('DELETE FROM artifacts WHERE id = $1', [artifactId]);
  await recordAudit(
    {
      action: 'artifact.deleted',
      entityType: 'artifact',
      entityId: artifactId,
      institutionId: artifact.institution_id,
      engagementId: artifact.engagement_id,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { filename: artifact.filename, reason },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
}
