'use server';

import { withScope } from '@/lib/db/pool';
import { addSupervisoryNote, createInstitution } from '@/lib/domain/institutions';
import { createApplication } from '@/lib/domain/applications';
import {
  DEFAULT_PROHIBITED_ACTIONS,
  approveEngagement,
  approvePlan,
  createEngagement,
  launchEngagement,
  recordAuthorization,
  resumeEngagement,
  setGlobalKillSwitch,
  stopEngagement,
  submitPlan,
} from '@/lib/domain/engagements';
import { requestCancel, retryJob } from '@/lib/domain/jobs';
import { startWorker } from '@/lib/engines/runner';
import { bool, list, optionalText, runAction, text } from '@/app/actions/helpers';

const DEFAULT_PROHIBITED = DEFAULT_PROHIBITED_ACTIONS;

export async function createInstitutionAction(formData: FormData): Promise<never> {
  const code = text(formData, 'code').toUpperCase();
  return runAction({
    formData,
    failurePath: '/institutions/new',
    successNotice: 'Institution added to the supervisory register.',
    successPath: (row) => `/institutions/${row.id}`,
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        createInstitution(tx, ctx, {
          name: text(formData, 'name'),
          code,
          category: text(formData, 'category') as any,
          licenceNumber: optionalText(formData, 'licenceNumber'),
          riskTier: optionalText(formData, 'riskTier') ?? 'unassessed',
          city: optionalText(formData, 'city'),
          state: optionalText(formData, 'state'),
          website: optionalText(formData, 'website'),
          primaryContactName: optionalText(formData, 'primaryContactName'),
          primaryContactEmail: optionalText(formData, 'primaryContactEmail'),
          description: optionalText(formData, 'description'),
        }),
      ),
  });
}

export async function createApplicationAction(formData: FormData): Promise<never> {
  const institutionId = text(formData, 'institutionId');
  return runAction({
    formData,
    failurePath: '/applications/new',
    successNotice: 'Application added to the inventory.',
    successPath: (row) => `/applications/${row.id}`,
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        createApplication(tx, ctx, {
          institutionId,
          name: text(formData, 'name'),
          businessPurpose: optionalText(formData, 'businessPurpose'),
          channel: text(formData, 'channel') as any,
          webUrl: optionalText(formData, 'webUrl'),
          apiBaseUrl: optionalText(formData, 'apiBaseUrl'),
          mobilePlatform: optionalText(formData, 'mobilePlatform'),
          packageIdentifier: optionalText(formData, 'packageIdentifier'),
          version: optionalText(formData, 'version'),
          environment: optionalText(formData, 'environment') ?? 'staging',
          authMethods: list(formData, 'authMethods'),
          dataSensitivity: optionalText(formData, 'dataSensitivity') ?? 'restricted',
          criticalProcesses: list(formData, 'criticalProcesses'),
          boundaries: optionalText(formData, 'boundaries'),
          exclusions: optionalText(formData, 'exclusions'),
        }),
      ),
  });
}

export async function createEngagementAction(formData: FormData): Promise<never> {
  const assetTypes = formData.getAll('assetType').map(String);
  const assetValues = formData.getAll('assetValue').map(String);
  const assetMethods = formData.getAll('assetMethods').map(String);
  const assetPaths = formData.getAll('assetPaths').map(String);
  const assetNotes = formData.getAll('assetNotes').map(String);
  const assets = assetValues
    .map((value, index) => ({
      assetType: (assetTypes[index] || 'url') as any,
      value: value.trim(),
      allowedMethods: (assetMethods[index] || 'GET,HEAD').split(',').map((m) => m.trim().toUpperCase()).filter(Boolean),
      approvedPaths: (assetPaths[index] || '').split(',').map((p) => p.trim()).filter(Boolean),
      notes: assetNotes[index] || undefined,
      ownershipVerified: true,
    }))
    .filter((asset) => asset.value.length > 0);

  const exclusions = formData
    .getAll('exclusionValue')
    .map(String)
    .map((value, index) => ({
      assetType: String(formData.getAll('exclusionType')[index] ?? 'url'),
      value: value.trim(),
      reason: String(formData.getAll('exclusionReason')[index] ?? 'Excluded by agreement').trim(),
    }))
    .filter((exclusion) => exclusion.value.length > 0);

  const permittedMethods = list(formData, 'permittedMethods');
  const prohibited = list(formData, 'prohibitedActions');

  return runAction({
    formData,
    failurePath: '/engagements/new',
    successNotice: 'Engagement created with its written authorisation and approved scope.',
    successPath: (row) => `/engagements/${row.id}`,
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        createEngagement(tx, ctx, {
          institutionId: text(formData, 'institutionId'),
          name: text(formData, 'name'),
          description: optionalText(formData, 'description'),
          applicationIds: list(formData, 'applicationIds'),
          authorizationRef: text(formData, 'authorizationRef'),
          authorizedByName: optionalText(formData, 'authorizedByName'),
          authorizedByRole: optionalText(formData, 'authorizedByRole'),
          authorizedAt: optionalText(formData, 'authorizedAt'),
          validFrom: optionalText(formData, 'validFrom'),
          validTo: optionalText(formData, 'validTo'),
          scopeExpiresAt: optionalText(formData, 'validTo'),
          testingWindowStart: optionalText(formData, 'testingWindowStart'),
          testingWindowEnd: optionalText(formData, 'testingWindowEnd'),
          permittedMethods,
          prohibitedActions: prohibited.length ? prohibited : DEFAULT_PROHIBITED,
          emergencyContactName: optionalText(formData, 'emergencyContactName'),
          emergencyContactPhone: optionalText(formData, 'emergencyContactPhone'),
          escalationProcedure: optionalText(formData, 'escalationProcedure'),
          assets,
          exclusions,
          limits: {
            maxRequestsPerSecond: Number(formData.get('maxRequestsPerSecond') ?? 2),
            maxConcurrency: Number(formData.get('maxConcurrency') ?? 2),
            maxRequestsTotal: Number(formData.get('maxRequestsTotal') ?? 2000),
            maxDurationMinutes: Number(formData.get('maxDurationMinutes') ?? 120),
          },
        }),
      ),
  });
}

export async function recordAuthorizationAction(formData: FormData): Promise<never> {
  const engagementId = text(formData, 'engagementId');
  return runAction({
    formData,
    failurePath: `/engagements/${engagementId}/authorization`,
    successNotice: 'Written authorisation recorded.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        recordAuthorization(tx, ctx, {
          engagementId,
          reference: text(formData, 'reference'),
          authorizedByName: text(formData, 'authorizedByName'),
          authorizedByRole: text(formData, 'authorizedByRole'),
          authorizedAt: text(formData, 'authorizedAt'),
          validFrom: text(formData, 'validFrom'),
          validTo: text(formData, 'validTo'),
          permittedMethods: list(formData, 'permittedMethods'),
          prohibitedActions: list(formData, 'prohibitedActions'),
          testingWindowStart: optionalText(formData, 'testingWindowStart'),
          testingWindowEnd: optionalText(formData, 'testingWindowEnd'),
        }),
      ),
  });
}

export async function approveEngagementAction(formData: FormData): Promise<never> {
  const engagementId = text(formData, 'engagementId');
  return runAction({
    formData,
    failurePath: `/engagements/${engagementId}/authorization`,
    successNotice: 'Engagement authorised. The assessment plan can now be prepared.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => approveEngagement(tx, ctx, engagementId)),
  });
}

export async function submitPlanAction(formData: FormData): Promise<never> {
  const engagementId = text(formData, 'engagementId');
  const modules = list(formData, 'modules');
  const frameworks = list(formData, 'frameworks').map((entry) => {
    const [key, version] = entry.split('@');
    return { key, version };
  });
  return runAction({
    formData,
    failurePath: `/engagements/${engagementId}/plan`,
    successNotice: 'Test plan submitted for independent approval.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        submitPlan(tx, ctx, {
          engagementId,
          modules,
          frameworks,
          plannedChecks: [],
          impactSummary: optionalText(formData, 'impactSummary'),
          limitations: optionalText(formData, 'limitations'),
        }),
      ),
  });
}

export async function approvePlanAction(formData: FormData): Promise<never> {
  const engagementId = text(formData, 'engagementId');
  const planId = text(formData, 'planId');
  return runAction({
    formData,
    failurePath: `/engagements/${engagementId}/plan`,
    successNotice: 'Test plan approved. Execution can be launched from the engagement page.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => approvePlan(tx, ctx, planId)),
  });
}

export async function launchEngagementAction(formData: FormData): Promise<never> {
  const engagementId = text(formData, 'engagementId');
  const modules = list(formData, 'modules');
  return runAction({
    formData,
    failurePath: `/engagements/${engagementId}`,
    successNotice: 'Assessment jobs queued. The worker will execute only approved, in-scope checks.',
    successPath: () => `/engagements/${engagementId}`,
    mutate: async (ctx) => {
      const jobs = await withScope(ctx.scope, (tx) => launchEngagement(tx, ctx, engagementId, { modules }));
      startWorker();
      return jobs;
    },
  });
}

export async function stopEngagementAction(formData: FormData): Promise<never> {
  const engagementId = text(formData, 'engagementId');
  const reason = text(formData, 'reason', 'Stopped by operator').slice(0, 300);
  return runAction({
    formData,
    failurePath: `/engagements/${engagementId}`,
    successNotice: 'Engagement stop control engaged. Running jobs were cancelled and the stop is recorded in the audit trail.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => stopEngagement(tx, ctx, engagementId, reason)),
  });
}

export async function resumeEngagementAction(formData: FormData): Promise<never> {
  const engagementId = text(formData, 'engagementId');
  return runAction({
    formData,
    failurePath: `/engagements/${engagementId}`,
    successNotice: 'Engagement resumed after operator review. Authorisation and window checks still apply to every request.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => resumeEngagement(tx, ctx, engagementId)),
  });
}

export async function globalKillSwitchAction(formData: FormData): Promise<never> {
  const engaged = bool(formData, 'engaged');
  const reason = text(formData, 'reason', 'Operator action').slice(0, 300);
  return runAction({
    formData,
    failurePath: '/admin/engines',
    successNotice: engaged ? 'Global kill switch engaged: all assessment execution halted.' : 'Global kill switch released.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => setGlobalKillSwitch(tx, ctx, engaged, reason)),
  });
}

export async function cancelJobAction(formData: FormData): Promise<never> {
  const jobId = text(formData, 'jobId');
  const reason = text(formData, 'reason', 'Cancelled by operator');
  return runAction({
    formData,
    failurePath: '/jobs',
    successNotice: 'Cancellation requested. The worker stops the job at the next check boundary.',
    successPath: () => `/jobs/${jobId}`,
    mutate: async (ctx) => withScope(ctx.scope, (tx) => requestCancel(tx, ctx, jobId)),
  });
}

export async function retryJobAction(formData: FormData): Promise<never> {
  const jobId = text(formData, 'jobId');
  return runAction({
    formData,
    failurePath: '/jobs',
    successNotice: 'Job re-queued for execution.',
    successPath: (row: any) => (row?.id ? `/jobs/${row.id}` : `/jobs/${jobId}`),
    mutate: async (ctx) => {
      const job = await withScope(ctx.scope, (tx) => retryJob(tx, ctx, jobId));
      startWorker();
      return job;
    },
  });
}

export async function verifyDemoDatasetAction(formData: FormData): Promise<never> {
  return runAction({
    formData,
    failurePath: '/admin/settings',
    successNotice: 'Demonstration dataset verified. Use "npm run db:seed" to rebuild it from scratch.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        const counts = await tx.queryOne<Record<string, number>>(
          `SELECT
             (SELECT count(*)::int FROM institutions WHERE data_mode = 'demo') AS institutions,
             (SELECT count(*)::int FROM applications WHERE data_mode = 'demo') AS applications,
             (SELECT count(*)::int FROM engagements WHERE data_mode = 'demo') AS engagements,
             (SELECT count(*)::int FROM findings WHERE data_mode = 'demo') AS findings,
             (SELECT count(*)::int FROM evidence WHERE data_mode = 'demo') AS evidence,
             (SELECT count(*)::int FROM reports WHERE data_mode = 'demo') AS reports`,
        );
        if (!counts || Number(counts.institutions) === 0) {
          throw new Error('No demonstration dataset is present. Run "npm run db:seed" to create one.');
        }
        return counts;
      }),
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
