'use server';

import { withScope } from '@/lib/db/pool';
import { addImprovementAction, updateProfileEntry } from '@/lib/domain/nist';
import { setEvidenceSharing, verifyEvidenceIntegrity } from '@/lib/domain/evidence';
import { addSupervisoryNote } from '@/lib/domain/institutions';
import { runAction, text, optionalText } from '@/app/actions/helpers';

export async function updateNistEntryAction(formData: FormData): Promise<never> {
  const institutionId = text(formData, 'institutionId');
  return runAction({
    formData,
    failurePath: `/nist?institutionId=${institutionId}`,
    successNotice: 'CSF outcome updated. The status records the evidence held, not a maturity level.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        updateProfileEntry(tx, ctx, {
          profileId: text(formData, 'profileId'),
          itemCode: text(formData, 'itemCode'),
          status: text(formData, 'status'),
          evidenceSummary: optionalText(formData, 'evidenceSummary'),
          gap: optionalText(formData, 'gap'),
          priority: optionalText(formData, 'priority'),
        }),
      ),
  });
}

export async function addImprovementActionAction(formData: FormData): Promise<never> {
  const institutionId = text(formData, 'institutionId');
  return runAction({
    formData,
    failurePath: `/nist?institutionId=${institutionId}`,
    successNotice: 'Improvement action recorded.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        addImprovementAction(tx, ctx, {
          institutionId,
          itemCode: optionalText(formData, 'itemCode'),
          title: text(formData, 'title'),
          description: optionalText(formData, 'description'),
          owner: optionalText(formData, 'owner'),
          priority: optionalText(formData, 'priority') ?? 'medium',
          dueDate: optionalText(formData, 'dueDate'),
        }),
      ),
  });
}

export async function setEvidenceSharingAction(formData: FormData): Promise<never> {
  const evidenceId = text(formData, 'evidenceId');
  const share = text(formData, 'share') === 'true';
  return runAction({
    formData,
    failurePath: text(formData, 'returnTo') || '/evidence',
    successNotice: share ? 'Evidence released to the institution contact.' : 'Institution access withdrawn.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => setEvidenceSharing(tx, ctx, evidenceId, share)),
  });
}

export async function verifyEvidenceIntegrityAction(formData: FormData): Promise<never> {
  const evidenceId = text(formData, 'evidenceId');
  return runAction({
    formData,
    failurePath: text(formData, 'returnTo') || '/evidence',
    successNotice: 'Evidence integrity verified against the stored SHA-256 digest.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => verifyEvidenceIntegrity(tx, evidenceId)),
  });
}

export async function addSupervisoryNoteAction(formData: FormData): Promise<never> {
  const institutionId = text(formData, 'institutionId');
  return runAction({
    formData,
    failurePath: `/institutions/${institutionId}`,
    successNotice: 'Confidential supervisory note recorded.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        addSupervisoryNote(tx, ctx, {
          institutionId,
          body: text(formData, 'body'),
          engagementId: optionalText(formData, 'engagementId') ?? null,
        }),
      ),
  });
}
