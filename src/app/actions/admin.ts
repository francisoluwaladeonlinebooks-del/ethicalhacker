'use server';

import { withSystem } from '@/lib/db/pool';
import { createUser } from '@/lib/domain/auth';
import { importCatalogue, markFrameworkVerified } from '@/lib/domain/frameworks';
import { setSetting } from '@/lib/domain/settings';
import { recordAudit } from '@/lib/domain/audit';
import { can, type Role } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { runAction, text, optionalText } from '@/app/actions/helpers';

const ROLES: Role[] = ['platform_admin', 'cbn_assessor', 'supervisory_reviewer', 'institution_contact', 'report_approver'];

export async function createUserAction(formData: FormData): Promise<never> {
  return runAction({
    formData,
    failurePath: '/admin/users',
    successNotice: 'Account created. The user must enrol MFA; the password is not displayed again.',
    mutate: async (ctx) => {
      if (!can(ctx.user, 'user:manage')) throw new ForbiddenError('Missing permission: user:manage');
      const role = text(formData, 'role') as Role;
      if (!ROLES.includes(role)) throw new Error('Unknown role');
      const institutionId = role === 'institution_contact' ? optionalText(formData, 'institutionId') ?? null : null;
      if (role === 'institution_contact' && !institutionId) throw new Error('An institution contact must be linked to an institution');
      return createUser({
        email: text(formData, 'email'),
        name: text(formData, 'name'),
        role,
        institutionId,
        jobTitle: optionalText(formData, 'jobTitle') ?? null,
        password: text(formData, 'password'),
        isDemo: (process.env.FICAP_MODE ?? 'demo') === 'demo',
        mfaRequired: true,
        actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
        ip: ctx.ip,
      });
    },
  });
}

export async function setUserStatusAction(formData: FormData): Promise<never> {
  const userId = text(formData, 'userId');
  const status = text(formData, 'status');
  return runAction({
    formData,
    failurePath: '/admin/users',
    successNotice: status === 'suspended' ? 'Account suspended and all sessions revoked.' : 'Account reactivated.',
    mutate: async (ctx) => {
      if (!can(ctx.user, 'user:manage')) throw new ForbiddenError('Missing permission: user:manage');
      if (userId === ctx.user.id) throw new Error('You cannot change the status of your own account');
      if (!['active', 'suspended'].includes(status)) throw new Error('Unknown status');
      const target = await withSystem((tx) => tx.queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]));
      if (!target) throw new Error('User not found');
      await withSystem(async (tx) => {
        await tx.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [userId, status]);
        if (status === 'suspended') await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      });
      await recordAudit({
        action: 'user.status_changed',
        entityType: 'user',
        entityId: userId,
        actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
        metadata: { email: target.email, status },
        ip: ctx.ip,
        dataMode: ctx.mode,
      });
      return { userId, status };
    },
  });
}

export async function updateSettingAction(formData: FormData): Promise<never> {
  const key = text(formData, 'key');
  const raw = text(formData, 'value');
  return runAction({
    formData,
    failurePath: '/admin/settings',
    successNotice: `Setting "${key}" updated and audited.`,
    mutate: async (ctx) => {
      if (!can(ctx.user, 'settings:manage')) throw new ForbiddenError('Missing permission: settings:manage');
      let value: unknown = raw;
      const trimmed = raw.trim();
      if (trimmed === 'true' || trimmed === 'false') value = trimmed === 'true';
      else if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) value = Number(trimmed);
      else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          value = JSON.parse(trimmed);
        } catch {
          throw new Error('This setting expects valid JSON');
        }
      }
      return withSystem((tx) => setSetting(tx, ctx, key, value));
    },
  });
}

export async function verifyFrameworkAction(formData: FormData): Promise<never> {
  const frameworkId = text(formData, 'frameworkId');
  return runAction({
    formData,
    failurePath: '/admin/frameworks',
    successNotice: 'Catalogue marked as officially verified. Assessments keep the version they used.',
    mutate: async (ctx) => withSystem((tx) => markFrameworkVerified(tx, ctx, frameworkId)),
  });
}

export async function importCatalogueAction(formData: FormData): Promise<never> {
  const payload = text(formData, 'payload');
  return runAction({
    formData,
    failurePath: '/admin/frameworks',
    successNotice: 'Catalogue import validated and stored as a new framework version.',
    mutate: async (ctx) => {
      if (!can(ctx.user, 'framework:manage')) throw new ForbiddenError('Missing permission: framework:manage');
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error('The catalogue must be valid JSON in the documented import shape');
      }
      if (!parsed?.key || !parsed?.version || !Array.isArray(parsed?.items) || !parsed.items.length) {
        throw new Error('The catalogue requires key, version and a non-empty items array');
      }
      for (const item of parsed.items) {
        if (!item.code || !item.title || !item.itemType) {
          throw new Error(`Every item requires code, title and itemType (offending item: ${JSON.stringify(item).slice(0, 80)})`);
        }
      }
      return withSystem((tx) =>
        importCatalogue(tx, ctx, {
          key: parsed.key,
          name: parsed.name ?? parsed.key,
          version: parsed.version,
          publisher: parsed.publisher ?? 'Unstated publisher',
          sourceUrl: parsed.sourceUrl,
          notes: parsed.notes,
          items: parsed.items,
        }),
      );
    },
  });
}

export async function toggleEngineAction(formData: FormData): Promise<never> {
  const engineKey = text(formData, 'engineKey');
  const enabled = text(formData, 'enabled') === 'true';
  return runAction({
    formData,
    failurePath: '/admin/engines',
    successNotice: `Engine "${engineKey}" ${enabled ? 'enabled' : 'disabled'}. Launching a disabled module is refused.`,
    mutate: async (ctx) => {
      if (!can(ctx.user, 'engine:manage')) throw new ForbiddenError('Missing permission: engine:manage');
      await withSystem((tx) =>
        tx.query(`UPDATE engines SET status = $2, updated_at = now() WHERE key = $1`, [engineKey, enabled ? 'enabled' : 'disabled']),
      );
      await recordAudit({
        action: 'engine.status_changed',
        entityType: 'engine',
        entityId: engineKey,
        actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
        metadata: { enabled },
        ip: ctx.ip,
        dataMode: ctx.mode,
      });
      return { engineKey, enabled };
    },
  });
}
