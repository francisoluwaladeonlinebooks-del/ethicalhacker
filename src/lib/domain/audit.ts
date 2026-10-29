import { withSystem, type Row, type Tx } from '@/lib/db/pool';
import { sha256 } from '@/lib/crypto';
import type { Role } from '@/lib/rbac';

/**
 * Tamper-evident audit trail.
 *
 * Records are append-only (a database trigger rejects UPDATE/DELETE) and hash
 * chained: each record's hash covers its own content plus the previous hash.
 * `verifyAuditChain` recomputes the chain and reports the first inconsistency.
 */

export type AuditActor = { id: string | null; email?: string | null; role?: Role | null } | null;

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  institutionId?: string | null;
  engagementId?: string | null;
  actor?: AuditActor;
  outcome?: 'success' | 'denied' | 'failure';
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  dataMode?: string | null;
};

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function auditHash(payload: Record<string, unknown>): string {
  return sha256(canonical(payload));
}

export async function recordAudit(input: AuditInput, tx?: Tx): Promise<void> {
  const run = async (t: Tx) => {
    const last = await t.queryOne<{ seq: string | number; hash: string }>(
      'SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1',
    );
    const seq = last ? Number(last.seq) + 1 : 1;
    const prevHash = last?.hash ?? null;
    const atIso = new Date().toISOString();
    const payload = {
      seq,
      at: atIso,
      actor_id: input.actor?.id ?? null,
      actor_email: input.actor?.email ?? null,
      actor_role: input.actor?.role ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      institution_id: input.institutionId ?? null,
      engagement_id: input.engagementId ?? null,
      outcome: input.outcome ?? 'success',
      metadata: input.metadata ?? {},
      prev_hash: prevHash,
    };
    const hash = auditHash(payload);
    await t.query(
      `INSERT INTO audit_events
        (seq, at, at_iso, actor_id, actor_email, actor_role, action, entity_type, entity_id,
         institution_id, engagement_id, ip, user_agent, request_id, data_mode, outcome, metadata, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        seq,
        atIso,
        atIso,
        input.actor?.id ?? null,
        input.actor?.email ?? null,
        input.actor?.role ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.institutionId ?? null,
        input.engagementId ?? null,
        input.ip ?? null,
        input.userAgent ?? null,
        input.requestId ?? null,
        input.dataMode ?? null,
        input.outcome ?? 'success',
        JSON.stringify(input.metadata ?? {}),
        prevHash,
        hash,
      ],
    );
  };

  if (tx) return run(tx);
  return withSystem(run);
}

export type AuditVerification = {
  ok: boolean;
  checked: number;
  brokenAtSeq?: number;
  reason?: string;
  firstSeq: number | null;
  lastSeq: number | null;
};

export async function verifyAuditChain(limit = 20000): Promise<AuditVerification> {
  return withSystem(async (tx) => {
    const rows = await tx.query<Row>(
      `SELECT seq, at_iso, actor_id, actor_email, actor_role, action, entity_type, entity_id,
              institution_id, engagement_id, outcome, metadata::text AS metadata, prev_hash, hash
         FROM audit_events ORDER BY seq ASC LIMIT $1`,
      [limit],
    );
    let previousHash: string | null = null;
    let checked = 0;
    for (const row of rows) {
      const payload = {
        seq: Number(row.seq),
        at: row.at_iso,
        actor_id: row.actor_id,
        actor_email: row.actor_email,
        actor_role: row.actor_role,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        institution_id: row.institution_id,
        engagement_id: row.engagement_id,
        outcome: row.outcome,
        metadata: JSON.parse(row.metadata ?? '{}'),
        prev_hash: row.prev_hash,
      };
      const expected = auditHash(payload);
      if (row.prev_hash !== previousHash) {
        return { ok: false, checked, brokenAtSeq: Number(row.seq), reason: 'previous hash mismatch', firstSeq: rows[0] ? Number(rows[0].seq) : null, lastSeq: rows.length ? Number(rows[rows.length - 1].seq) : null };
      }
      if (expected !== row.hash) {
        return { ok: false, checked, brokenAtSeq: Number(row.seq), reason: 'record hash mismatch', firstSeq: rows[0] ? Number(rows[0].seq) : null, lastSeq: rows.length ? Number(rows[rows.length - 1].seq) : null };
      }
      previousHash = row.hash;
      checked += 1;
    }
    return {
      ok: true,
      checked,
      firstSeq: rows[0] ? Number(rows[0].seq) : null,
      lastSeq: rows.length ? Number(rows[rows.length - 1].seq) : null,
    };
  });
}

export async function listAuditEvents(tx: Tx, filters: { institutionId?: string; action?: string; limit?: number; actorId?: string } = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.institutionId) {
    params.push(filters.institutionId);
    clauses.push(`institution_id = $${params.length}`);
  }
  if (filters.action) {
    params.push(`%${filters.action}%`);
    clauses.push(`action ILIKE $${params.length}`);
  }
  if (filters.actorId) {
    params.push(filters.actorId);
    clauses.push(`actor_id = $${params.length}`);
  }
  params.push(Math.min(filters.limit ?? 100, 500));
  return tx.query(
    `SELECT * FROM audit_events ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY seq DESC LIMIT $${params.length}`,
    params,
  );
}
