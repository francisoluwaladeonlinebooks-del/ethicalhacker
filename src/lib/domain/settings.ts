import type { Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import type { RequestContext } from '@/lib/db/context';
import { ForbiddenError, NotFoundError } from '@/lib/errors';

export type SettingRow = { key: string; value: unknown; description: string | null; is_secret: boolean; updated_at: string };

const SECRET_KEYS = new Set(['ai_provider_key', 'ai_provider_endpoint', 'osv_endpoint']);

export async function listSettings(tx: Tx, ctx: RequestContext): Promise<(SettingRow & { masked?: boolean })[]> {
  const rows = await tx.query<SettingRow>('SELECT key, value, description, is_secret, updated_at FROM settings ORDER BY key');
  return rows.map((row) => {
    if (row.is_secret || SECRET_KEYS.has(row.key)) {
      const hasValue = typeof row.value === 'string' ? row.value.length > 0 : Boolean(row.value);
      return { ...row, value: hasValue ? '••••••••' : '', masked: true };
    }
    return row;
  });
}

export async function getSetting<T = unknown>(tx: Tx, key: string, fallback: T): Promise<T> {
  const row = await tx.queryOne<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key]);
  return (row?.value ?? fallback) as T;
}

export async function setSetting(tx: Tx, ctx: RequestContext, key: string, value: unknown) {
  if (!can(ctx.user, 'settings:manage')) throw new ForbiddenError('Missing permission: settings:manage');
  const existing = await tx.queryOne<{ key: string }>('SELECT key FROM settings WHERE key = $1', [key]);
  if (!existing) throw new NotFoundError('Unknown setting');
  await tx.query('UPDATE settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1', [key, JSON.stringify(value), ctx.user.id]);
  await recordAudit(
    {
      action: 'settings.updated',
      entityType: 'setting',
      entityId: key,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { key, masked: SECRET_KEYS.has(key) || undefined },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      dataMode: ctx.mode,
    },
    tx,
  );
}

export async function platformHealth(tx: Tx, ctx: RequestContext) {
  const engines = await tx.query(
    `SELECT e.*,
            (SELECT count(*)::int FROM assessment_jobs j WHERE j.module = e.key AND j.status = 'running') AS running_jobs,
            (SELECT count(*)::int FROM assessment_jobs j WHERE j.module = e.key AND j.status = 'failed') AS failed_jobs,
            (SELECT max(j.finished_at)::text FROM assessment_jobs j WHERE j.module = e.key AND j.status = 'succeeded') AS last_success
       FROM engines e ORDER BY e.key`,
  );
  const jobs = await tx.query<{ status: string; count: string }>('SELECT status, count(*)::text AS count FROM assessment_jobs GROUP BY status');
  const settings = await tx.query('SELECT key, value FROM settings WHERE key IN (\'global_kill_switch\',\'platform_mode\',\'ai_enabled\')');
  const auditStats = await tx.queryOne<{ total: string; last: string | null }>('SELECT count(*)::text AS total, max(at)::text AS last FROM audit_events');
  const evidenceStats = await tx.queryOne<{ total: string; bytes: string }>('SELECT count(*)::text AS total, coalesce(sum(size_bytes),0)::text AS bytes FROM evidence');
  return { engines, jobs, settings, auditStats, evidenceStats };
}

export async function isKillSwitchEngaged(tx: Tx): Promise<boolean> {
  const row = await tx.queryOne<{ value: boolean }>(`SELECT value FROM settings WHERE key = 'global_kill_switch'`);
  return row?.value === true;
}
