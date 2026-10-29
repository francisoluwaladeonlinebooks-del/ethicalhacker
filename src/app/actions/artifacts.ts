'use server';

import { withScope } from '@/lib/db/pool';
import { parseApiSpec } from '@/lib/engines/api';
import { storeArtifact, deleteArtifact, readArtifact, type ArtifactKind } from '@/lib/domain/artifacts';
import { recordAudit } from '@/lib/domain/audit';
import { can } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { list, optionalText, runAction, text } from '@/app/actions/helpers';

/**
 * Upload an artefact (APK/AAB/IPA/ZIP, manifest or API specification).
 * The declared kind is validated against the file signature in the domain
 * service; the browser never receives the stored bytes again without an
 * explicit, audited download.
 */
export async function uploadArtifactAction(formData: FormData): Promise<never> {
  const applicationId = text(formData, 'applicationId');
  const failurePath = `/applications/${applicationId}`;
  return runAction({
    formData,
    failurePath,
    successNotice: 'Artefact stored, encrypted and queued for analysis.',
    mutate: async (ctx) => {
      const file = formData.get('file');
      if (!(file instanceof File) || file.size === 0) throw new Error('Select a file to upload');
      const buffer = Buffer.from(await file.arrayBuffer());
      const declaredKind = (optionalText(formData, 'kind') ?? 'other') as ArtifactKind;

      return withScope(ctx.scope, async (tx) => {
        const application = await tx.queryOne<{ institution_id: string; engagement_id: string | null }>(
          `SELECT a.institution_id, (
             SELECT ea.engagement_id FROM engagement_applications ea
              JOIN engagements e ON e.id = ea.engagement_id
             WHERE ea.application_id = a.id AND e.status IN ('approved','running') ORDER BY e.created_at DESC LIMIT 1
           ) AS engagement_id
             FROM applications a WHERE a.id = $1`,
          [applicationId],
        );
        if (!application) throw new Error('Application not found');
        const stored = await storeArtifact(tx, ctx, {
          institutionId: application.institution_id,
          applicationId,
          engagementId: application.engagement_id,
          kind: declaredKind,
          filename: file.name,
          mediaType: file.type || undefined,
          content: buffer,
        });
        if (declaredKind === 'openapi' || declaredKind === 'postman') {
          await importSpecification(tx, ctx, applicationId, application.institution_id, buffer.toString('utf8'), declaredKind);
        }
        return stored;
      });
    },
  });
}

/**
 * Parse an OpenAPI or Postman document and persist the endpoint inventory so
 * the API coverage matrix has something defensible to report against.
 */
export async function importSpecification(
  tx: any,
  ctx: any,
  applicationId: string,
  institutionId: string,
  raw: string,
  kind: 'openapi' | 'postman',
) {
  const spec = parseApiSpec(raw, null);
  if (spec.parseErrors.length) throw new Error(spec.parseErrors[0]);
  if (!spec.endpoints.length) throw new Error('No endpoints could be parsed from the specification');
  if (!can(ctx.user, 'application:write')) throw new ForbiddenError('Missing permission: application:write');

  for (const endpoint of spec.endpoints) {
    await tx.query(
      `INSERT INTO api_endpoints (institution_id, application_id, spec_source, spec_version, base_url, method, path, summary,
          auth_required, roles, params, risk_categories, coverage_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]'::jsonb,$10,'[]'::jsonb,'untested')
       ON CONFLICT (application_id, method, path) DO UPDATE SET summary = EXCLUDED.summary, base_url = EXCLUDED.base_url,
         spec_source = EXCLUDED.spec_source, spec_version = EXCLUDED.spec_version`,
      [
        institutionId,
        applicationId,
        kind === 'postman' ? 'postman' : 'openapi',
        spec.version,
        spec.baseUrl,
        endpoint.method,
        endpoint.path,
        endpoint.summary ?? null,
        endpoint.authRequired ?? null,
        JSON.stringify(endpoint.params ?? []),
      ],
    );
  }
  await recordAudit(
    {
      action: 'api.specification_imported',
      entityType: 'application',
      entityId: applicationId,
      institutionId,
      actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
      metadata: { kind, title: spec.title, version: spec.version, endpoints: spec.endpoints.length, securitySchemes: spec.securitySchemes },
      ip: ctx.ip,
      dataMode: ctx.mode,
    },
    tx,
  );
  return { endpoints: spec.endpoints.length, title: spec.title, version: spec.version };
}

export async function importSpecificationAction(formData: FormData): Promise<never> {
  const applicationId = text(formData, 'applicationId');
  const kind = text(formData, 'kind', 'openapi') as 'openapi' | 'postman';
  return runAction({
    formData,
    failurePath: `/applications/${applicationId}`,
    successNotice: 'API specification imported into the endpoint inventory.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        const application = await tx.queryOne<{ institution_id: string }>('SELECT institution_id FROM applications WHERE id = $1', [applicationId]);
        if (!application) throw new Error('Application not found');
        const file = formData.get('spec');
        let raw = optionalText(formData, 'specText') ?? '';
        if (file instanceof File && file.size > 0) {
          if (file.size > 5 * 1024 * 1024) throw new Error('Specification files must be smaller than 5 MB');
          raw = Buffer.from(await file.arrayBuffer()).toString('utf8');
        }
        if (!raw.trim()) throw new Error('Provide a specification file or paste the document');
        return importSpecification(tx, ctx, applicationId, application.institution_id, raw, kind);
      }),
  });
}

export async function deleteArtifactAction(formData: FormData): Promise<never> {
  const artifactId = text(formData, 'artifactId');
  const applicationId = text(formData, 'applicationId');
  const reason = text(formData, 'reason', 'Deleted by operator');
  return runAction({
    formData,
    failurePath: `/applications/${applicationId}`,
    successNotice: 'Artefact deleted. The deletion is recorded in the audit trail.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => deleteArtifact(tx, ctx, artifactId, reason)),
  });
}

export async function downloadArtifactAction(formData: FormData): Promise<never> {
  const artifactId = text(formData, 'artifactId');
  const applicationId = text(formData, 'applicationId');
  return runAction({
    formData,
    failurePath: `/applications/${applicationId}`,
    mutate: async (ctx) => {
      const artifact = await withScope(ctx.scope, (tx) => readArtifact(tx, ctx, artifactId));
      // The download is served by a dedicated route so the response can be
      // streamed with hardened headers instead of embedded in a redirect.
      return { id: artifactId };
    },
    successPath: (result) => `/api/artifacts/${result.id}/download`,
  });
}

export async function listArtifactAnalysisAction(formData: FormData): Promise<never> {
  return runAction({
    formData,
    failurePath: text(formData, 'returnPath', '/applications'),
    mutate: async () => null,
  });
}

export async function reanalyseArtifactAction(formData: FormData): Promise<never> {
  const artifactId = text(formData, 'artifactId');
  const applicationId = text(formData, 'applicationId');
  const modules = list(formData, 'modules');
  return runAction({
    formData,
    failurePath: `/applications/${applicationId}`,
    successNotice: 'Analysis queued on the next worker cycle.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        const artifact = await tx.queryOne<{ institution_id: string; engagement_id: string | null; application_id: string | null }>(
          'SELECT institution_id, engagement_id, application_id FROM artifacts WHERE id = $1',
          [artifactId],
        );
        if (!artifact) throw new Error('Artefact not found');
        await tx.query(`UPDATE artifacts SET status = 'stored' WHERE id = $1`, [artifactId]);
        return artifact;
      }),
  });
}
