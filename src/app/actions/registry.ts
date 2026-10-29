'use server';

import { revalidatePath } from 'next/cache';
import { withScope } from '@/lib/db/pool';
import { runAction, text, optionalText } from '@/app/actions/helpers';
import {
  createDigitalAsset,
  importRegistry,
  markInstitutionVerified,
  recordLicenceEvent,
  resolveQueueItem,
  verifyAssetOwnership,
} from '@/lib/domain/registry';

export async function createAssetAction(formData: FormData): Promise<never> {
  const institutionId = text(formData, 'institutionId');
  return runAction({
    formData,
    failurePath: `/registry/${institutionId}`,
    successNotice: 'Asset recorded as a candidate. Ownership must be verified with recorded evidence before any engagement may reference it.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        await createDigitalAsset(tx, ctx, {
          institutionId,
          assetType: text(formData, 'assetType'),
          displayName: text(formData, 'displayName'),
          identifier: text(formData, 'identifier'),
          environment: optionalText(formData, 'environment') ?? 'production',
          technicalContactName: optionalText(formData, 'technicalContactName'),
          technicalContactEmail: optionalText(formData, 'technicalContactEmail'),
          sourceName: optionalText(formData, 'sourceName') ?? 'Manual entry',
          sourceUrl: optionalText(formData, 'sourceUrl'),
          notes: optionalText(formData, 'notes'),
        });
        revalidatePath('/registry');
        revalidatePath(`/registry/${institutionId}`);
      }),
  });
}

export async function verifyAssetAction(formData: FormData): Promise<never> {
  const institutionId = text(formData, 'institutionId');
  const decision = text(formData, 'decision') === 'rejected' ? 'rejected' : 'verified';
  return runAction({
    formData,
    failurePath: institutionId ? `/registry/${institutionId}` : '/registry/assets',
    successNotice:
      decision === 'verified'
        ? 'Ownership verified and recorded against the evidence reviewed.'
        : 'Ownership rejected. The asset stays in the registry as rejected and cannot be used in an engagement.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        await verifyAssetOwnership(tx, ctx, { assetId: text(formData, 'assetId'), decision, evidence: text(formData, 'evidence') });
        revalidatePath('/registry');
        revalidatePath('/registry/assets');
      }),
  });
}

export async function licenceEventAction(formData: FormData): Promise<never> {
  const institutionId = text(formData, 'institutionId');
  return runAction({
    formData,
    failurePath: `/registry/${institutionId}`,
    successNotice: 'Licence history updated. The current licence state changes only where the event is unambiguous.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        await recordLicenceEvent(tx, ctx, {
          institutionId,
          eventType: text(formData, 'eventType'),
          licenceCategory: optionalText(formData, 'licenceCategory'),
          licenceNumber: optionalText(formData, 'licenceNumber'),
          effectiveAt: text(formData, 'effectiveAt'),
          regulator: optionalText(formData, 'regulator'),
          sourceName: optionalText(formData, 'sourceName'),
          sourceUrl: optionalText(formData, 'sourceUrl'),
          evidenceNote: optionalText(formData, 'evidenceNote'),
        });
        revalidatePath('/registry');
        revalidatePath(`/registry/${institutionId}`);
      }),
  });
}

export async function verifyInstitutionAction(formData: FormData): Promise<never> {
  const institutionId = text(formData, 'institutionId');
  return runAction({
    formData,
    failurePath: `/registry/${institutionId}`,
    successNotice: 'Registry record marked verified against the recorded source. Verification must be repeated when the source changes.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        await markInstitutionVerified(tx, ctx, institutionId, optionalText(formData, 'note'));
        revalidatePath('/registry');
        revalidatePath(`/registry/${institutionId}`);
      }),
  });
}

export async function importRegistryAction(formData: FormData): Promise<never> {
  const format = text(formData, 'format') === 'json' ? 'json' : 'csv';
  return runAction({
    formData,
    failurePath: '/registry/imports',
    successNotice: 'Import recorded. Nothing was scheduled for testing and no asset was created from the import.',
    mutate: async (ctx) => {
      const result = await withScope(ctx.scope, async (tx) =>
        importRegistry(tx, ctx, {
          format,
          payload: text(formData, 'payload'),
          sourceName: text(formData, 'sourceName'),
          sourceUrl: optionalText(formData, 'sourceUrl'),
          regulator: optionalText(formData, 'regulator'),
          retrievedAt: optionalText(formData, 'retrievedAt'),
        }),
      );
      revalidatePath('/registry');
      revalidatePath('/registry/imports');
      return result;
    },
    successPath: (result) =>
      `/registry/imports?notice=${encodeURIComponent(
        `Import applied: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.conflicts.length} queued for reconciliation, ${result.rejected.length} rejected.`,
      )}`,
  });
}

export async function resolveQueueAction(formData: FormData): Promise<never> {
  const decision = text(formData, 'decision') === 'rejected' ? 'rejected' : 'resolved';
  return runAction({
    formData,
    failurePath: '/registry',
    successNotice: 'Reconciliation item closed with a recorded rationale.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        await resolveQueueItem(tx, ctx, { queueId: text(formData, 'queueId'), decision, note: text(formData, 'note') });
        revalidatePath('/registry');
      }),
  });
}
