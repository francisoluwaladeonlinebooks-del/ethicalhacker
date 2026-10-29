import { withSystem, type Tx } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { createEvidence } from '@/lib/domain/evidence';
import { appendJobEvent, claimNextJob, finishJob, isCancellationRequested, updateJobProgress, upsertJobCheck } from '@/lib/domain/jobs';
import { assertEngagementOperational } from '@/lib/domain/engagements';
import { persistEngineFindings, refreshSystemicFlags } from '@/lib/domain/findings';
import { AssessmentTargetClient, approvedPathsFor } from '@/lib/engines/target-client';
import { WEB_CHECKS, WEB_MANUAL_TESTS, manualPrerequisiteFor } from '@/lib/engines/web';
import { API_MANUAL_TESTS, apiChecks, parseApiSpec, type ApiSpec } from '@/lib/engines/api';
import { MOBILE_DYNAMIC_TESTS, loadMobileAnalysisFor, mobileChecks } from '@/lib/engines/mobile';
import { collectDependencies, dependencyChecks } from '@/lib/engines/deps';
import { CURATED_CORPUS, CURATED_PROVENANCE, type IntelProvenance, type VulnerabilityRecord } from '@/lib/engines/vuln-intel';
import { decrypt } from '@/lib/crypto';
import type { CheckDefinition, EngineContext, FindingDraft, FetchedResponse } from '@/lib/engines/types';
import type { ScopeAsset, ScopeExclusion } from '@/lib/scope';

/**
 * Assessment job runner.
 *
 * Safety contract:
 *   - a job only runs when the engagement is approved, authorised, inside its
 *     window and the global kill switch is released;
 *   - every request passes through the scope-enforcing client;
 *   - checks that cannot run are recorded as blocked/skipped with the missing
 *     prerequisite, never as passed;
 *   - the runner never expands scope, never follows out-of-scope redirects and
 *     never performs destructive or high volume testing.
 */

let workerTimer: NodeJS.Timeout | null = null;
let processing = false;

export function startWorker(intervalMs = 1500): void {
  const globalState = globalThis as typeof globalThis & { __ficapWorker?: boolean };
  if (globalState.__ficapWorker || process.env.FICAP_WORKER_ENABLED === 'false') return;
  globalState.__ficapWorker = true;
  workerTimer = setInterval(() => {
    void tick();
  }, intervalMs);
  workerTimer.unref?.();
}

export function stopWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

export async function tick(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const job = await claimNextJob();
    if (!job) return;
    await runJob(job.id);
  } catch (error) {
    // Worker-level failures are logged and the job is marked failed by runJob.
    console.error('[ficap-worker]', (error as Error).message);
  } finally {
    processing = false;
  }
}

type JobRecord = {
  id: string;
  engagement_id: string;
  institution_id: string;
  application_id: string | null;
  module: 'web' | 'api' | 'mobile' | 'dependencies' | 'correlation' | 'retest';
  created_by: string | null;
  limits: any;
  config: any;
  plan_id: string | null;
};

export async function runJob(jobId: string): Promise<void> {
  const startedAt = Date.now();
  const job = await withSystem((tx) => tx.queryOne<JobRecord>('SELECT * FROM assessment_jobs WHERE id = $1', [jobId]));
  if (!job) return;

  const mode = (process.env.FICAP_MODE ?? 'demo') === 'live' ? 'live' : 'demo';
  const stats: Record<string, unknown> = { module: job.module, status: 'running' };

  try {
    // ---- Pre-flight authorisation gate -------------------------------------
    const gate = await withSystem(async (tx) => {
      const operational = await assertEngagementOperational(tx, job.engagement_id, {});
      if (!operational.ok) return operational;
      if (job.module === 'mobile' || job.module === 'dependencies') {
        return assertEngagementOperational(tx, job.engagement_id, { requireMethod: 'static_artefact' });
      }
      return assertEngagementOperational(tx, job.engagement_id, { requireMethod: 'unauthenticated_http' });
    });
    if (!gate.ok) {
      await withSystem(async (tx) => {
        await tx.query(`UPDATE assessment_jobs SET blocked_reason = $2, error = NULL WHERE id = $1`, [job.id, gate.reason]);
        await appendJobEvent(tx, job.id, job.institution_id, 'warn', `Job blocked before execution: ${gate.reason}`, { code: gate.code });
        await recordAudit({
          action: 'assessment.job_blocked',
          entityType: 'assessment_job',
          entityId: job.id,
          institutionId: job.institution_id,
          engagementId: job.engagement_id,
          outcome: 'denied',
          metadata: { reason: gate.reason, code: gate.code },
          dataMode: mode,
        });
      });
      await finishJob(job.id, { status: 'blocked', blockedReason: gate.reason ?? 'Blocked by authorisation controls', progress: 0 });
      return;
    }

    if (job.module === 'correlation') {
      await runCorrelation(job);
      await finishJob(job.id, { status: 'succeeded', stats: { module: 'correlation' } });
      return;
    }

    // ---- Load context ------------------------------------------------------
    const context = await withSystem(async (tx) => {
      const engagement = await tx.queryOne<any>('SELECT * FROM engagements WHERE id = $1', [job.engagement_id]);
      const application = job.application_id
        ? await tx.queryOne<any>('SELECT * FROM applications WHERE id = $1', [job.application_id])
        : null;
      const assets = await tx.query<ScopeAsset>('SELECT * FROM scope_assets WHERE engagement_id = $1', [job.engagement_id]);
      const exclusions = await tx.query<ScopeExclusion>('SELECT * FROM scope_exclusions WHERE engagement_id = $1', [job.engagement_id]);
      const artifacts = await tx.query<any>(
        `SELECT * FROM artifacts WHERE application_id = $1 AND engagement_id = $2 AND status <> 'quarantined' ORDER BY uploaded_at DESC`,
        [job.application_id, job.engagement_id],
      );
      const plan = job.plan_id ? await tx.queryOne<any>('SELECT * FROM test_plans WHERE id = $1', [job.plan_id]) : null;
      const allowedRow = engagement?.permitted_methods ?? [];
      const allowedMethods: string[] = Array.isArray(allowedRow) ? allowedRow : [];
      return {
        engagement,
        application,
        assets,
        exclusions,
        artifacts,
        plan,
        allowed: {
          inputProbes: allowedMethods.includes('input_validation'),
          authenticatedTests: allowedMethods.includes('authenticated_testing'),
          objectAuthorization: allowedMethods.includes('object_authorization'),
          dynamicMobile: allowedMethods.includes('dynamic_mobile'),
          boundedRateLimit: allowedMethods.includes('rate_limit_check'),
        },
      };
    });

    if (!context.application) {
      await finishJob(job.id, { status: 'failed', error: 'The job references an application that no longer exists' });
      return;
    }

    const baseUrl = job.module === 'api'
      ? context.application.api_base_url ?? context.application.web_url
      : context.application.web_url;

    const allowLoopback = mode === 'demo' && context.assets.some((asset) => asset.is_training_range);
    const limits = {
      maxRequestsPerSecond: Number(job.limits?.maxRequestsPerSecond ?? context.engagement.max_requests_per_second ?? 2),
      maxRequestsTotal: Number(job.limits?.maxRequestsTotal ?? context.engagement.max_requests_total ?? 2000),
      maxDurationMinutes: Number(job.limits?.maxDurationMinutes ?? context.engagement.max_duration_minutes ?? 120),
      maxConcurrency: Number(job.limits?.maxConcurrency ?? context.engagement.max_concurrency ?? 2),
    };

    const client = new AssessmentTargetClient({
      assets: context.assets,
      exclusions: context.exclusions,
      limits,
      allowLoopbackTrainingRange: allowLoopback,
      startedAt,
      shouldCancel: () => isCancellationRequested(job.id),
      onEvent: async (level, message, data) => {
        await withSystem((tx) => appendJobEvent(tx, job.id, job.institution_id, level, message, data));
      },
    });

    const approvedPaths = baseUrl ? approvedPathsFor(baseUrl, context.assets) : [];

    const ctx: EngineContext = {
      tx: null as unknown as Tx,
      jobId: job.id,
      institutionId: job.institution_id,
      engagementId: job.engagement_id,
      applicationId: context.application.id,
      mode,
      client: Object.assign(client, {
        baseUrl: baseUrl ?? '',
        origin: baseUrl ? new URL(baseUrl).origin : '',
        allowLoopbackTrainingRange: allowLoopback,
      }),
      log: async (level, message, data) => {
        await withSystem((tx) => appendJobEvent(tx, job.id, job.institution_id, level, message, data));
      },
      capture: async (title, content, mediaType, share) => {
        const isResponse = typeof content === 'object' && content !== null && 'status' in (content as FetchedResponse);
        const payload = isResponse
          ? [
              `Request: ${(content as FetchedResponse).requestedUrl}`,
              `Final URL: ${(content as FetchedResponse).finalUrl}`,
              `Status: ${(content as FetchedResponse).status} ${(content as FetchedResponse).statusText}`,
              `Duration: ${(content as FetchedResponse).durationMs}ms`,
              '',
              'Response headers:',
              Object.entries((content as FetchedResponse).headers).map(([k, v]) => `${k}: ${v}`).join('\n'),
              '',
              'Response body (redacted, truncated):',
              (content as FetchedResponse).body.slice(0, 40_000),
            ].join('\n')
          : String(content);
        const evidence = await withSystem((tx) =>
          createEvidence(tx, null, {
            institutionId: job.institution_id,
            engagementId: job.engagement_id,
            applicationId: job.application_id,
            kind: isResponse ? 'http_exchange' : 'log',
            title,
            mediaType: mediaType ?? 'text/plain',
            content: payload,
            shareWithInstitution: Boolean(share),
            createdBy: job.created_by,
          }),
        );
        return evidence.id;
      },
      recordResult: async (input) => {
        await withSystem(async (tx) => {
          await tx.query(
            `INSERT INTO test_results (job_id, engagement_id, institution_id, application_id, framework_key, framework_version,
                framework_item_code, check_key, status, expected, observed, evidence_id, is_manual, performed_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              job.id,
              job.engagement_id,
              job.institution_id,
              job.application_id,
              input.frameworkKey,
              input.frameworkVersion,
              input.frameworkItemCode,
              input.checkKey,
              input.status,
              input.expected ?? null,
              input.observed ?? null,
              input.evidenceId ?? null,
              Boolean(input.isManual),
              job.created_by,
            ],
          );
        });
      },
      allowed: context.allowed,
      approvedPaths,
      appVersion: context.application.version ?? null,
    };

    // ---- Module specific preparation --------------------------------------
    let checks: CheckDefinition[] = [];
    let manualEntries: { code: string; prerequisite: string }[] = [];
    let apiSpec: ApiSpec | null = null;
    let intel: { corpus: VulnerabilityRecord[]; provenance: IntelProvenance; notes: string[] } = {
      corpus: CURATED_CORPUS,
      provenance: CURATED_PROVENANCE,
      notes: [],
    };
    let dependencyLoader: (() => Promise<Awaited<ReturnType<typeof collectDependencies>>>) | null = null;
    let mobileLoader: (() => Promise<Awaited<ReturnType<typeof loadMobileAnalysisFor>>>) | null = null;

    if (job.module === 'web') {
      if (!baseUrl) {
        await finishJob(job.id, { status: 'blocked', blockedReason: 'The application has no approved web URL to assess' });
        return;
      }
      checks = WEB_CHECKS;
      manualEntries = WEB_MANUAL_TESTS.map((code) => ({ code, prerequisite: manualPrerequisiteFor(code) }));
    } else if (job.module === 'api') {
      if (!baseUrl) {
        await finishJob(job.id, { status: 'blocked', blockedReason: 'The application has no approved API base URL to assess' });
        return;
      }
      // Prefer an imported specification artefact; otherwise attempt an approved documentation path.
      const specArtifact = context.artifacts.find((a) => a.kind === 'openapi' || a.kind === 'postman');
      if (specArtifact) {
        const raw = decrypt(specArtifact.body_enc).toString('utf8');
        apiSpec = parseApiSpec(raw, baseUrl);
      } else {
        await ctx.log('warn', 'No OpenAPI/Postman specification artefact supplied; endpoint inventory will be limited');
      }
      checks = apiChecks(() => apiSpec);
      manualEntries = API_MANUAL_TESTS;
    } else if (job.module === 'mobile') {
      const artifact = context.artifacts.find((a) => ['apk', 'aab', 'ipa'].includes(a.kind));
      if (!artifact) {
        await withSystem((tx) =>
          appendJobEvent(tx, job.id, job.institution_id, 'warn', 'No mobile artefact supplied for static analysis', {
            required: 'APK, AAB or IPA build authorised by the institution',
          }),
        );
        await finishJob(job.id, {
          status: 'blocked',
          blockedReason: 'No authorised mobile build (APK/AAB/IPA) was uploaded for this application. Static and dynamic mobile testing cannot proceed.',
        });
        return;
      }
      mobileLoader = () => withSystem((tx) => loadMobileAnalysisFor(tx, artifact.id));
      checks = mobileChecks(() => mobileLoader!());
      manualEntries = MOBILE_DYNAMIC_TESTS;
    } else if (job.module === 'dependencies') {
      const artifact = context.artifacts.find((a) => ['zip', 'source', 'openapi', 'other'].includes(a.kind) || /lock|manifest|requirements|pom|gradle|podfile|gomod|pubspec/i.test(a.filename));
      const osvArtifact = context.artifacts.find((a) => a.kind === 'osv_db');
      if (osvArtifact) {
        try {
          const { parseOsvDataset } = await import('@/lib/engines/vuln-intel');
          const dataset = parseOsvDataset(decrypt(osvArtifact.body_enc).toString('utf8'));
          intel = { corpus: dataset.records, provenance: dataset.provenance, notes: [] };
        } catch (error) {
          intel.notes.push(`Imported OSV dataset could not be parsed: ${(error as Error).message}`);
        }
      }
      dependencyLoader = () => withSystem((tx) => collectDependencies(tx, artifact?.id ?? null));
      checks = dependencyChecks(() => dependencyLoader!(), intel);
      manualEntries = [];
    }

    // ---- Execute checks ----------------------------------------------------
    const drafts: FindingDraft[] = [];
    let completed = 0;
    const total = checks.length + manualEntries.length;

    for (const check of checks) {
      if (await isCancellationRequested(job.id)) {
        await finishJob(job.id, { status: 'cancelled', stats: { ...stats, cancelled: true }, progress: Math.round((completed / Math.max(total, 1)) * 100) });
        return;
      }
      await withSystem((tx) => upsertJobCheck(tx, { jobId: job.id, checkKey: check.key, frameworkItemCode: check.frameworkItemCode, status: 'running' }));
      try {
        // A check whose required capability is not authorised is recorded as blocked.
        const missingCapability = (check.requires ?? []).find((capability) => !context.allowed[capability === 'input_validation' ? 'inputProbes' : capability === 'authenticated_testing' ? 'authenticatedTests' : capability === 'object_authorization' ? 'objectAuthorization' : capability === 'dynamic_mobile' ? 'dynamicMobile' : 'boundedRateLimit']);
        if (missingCapability) {
          await withSystem((tx) =>
            upsertJobCheck(tx, {
              jobId: job.id,
              checkKey: check.key,
              frameworkItemCode: check.frameworkItemCode,
              status: 'blocked',
              detail: `Requires the "${missingCapability}" permission, which the engagement authorisation does not include.`,
            }),
          );
          await ctx.recordResult({
            checkKey: check.key,
            frameworkKey: check.frameworkKey,
            frameworkVersion: check.frameworkVersion,
            frameworkItemCode: check.frameworkItemCode,
            status: 'blocked',
            expected: check.title,
            observed: `Not executed: the engagement does not authorise ${missingCapability}.`,
          });
          completed += 1;
          continue;
        }

        const outcome = await check.run(ctx);
        const evidenceId = outcome.evidenceIds?.[0] ?? null;
        await withSystem((tx) =>
          upsertJobCheck(tx, {
            jobId: job.id,
            checkKey: check.key,
            frameworkItemCode: check.frameworkItemCode,
            status: outcome.status,
            detail: outcome.observed.slice(0, 2000),
            requestsMade: outcome.requestsMade ?? 0,
          }),
        );
        await ctx.recordResult({
          checkKey: check.key,
          frameworkKey: check.frameworkKey,
          frameworkVersion: check.frameworkVersion,
          frameworkItemCode: check.frameworkItemCode,
          status: outcome.status,
          expected: outcome.expected,
          observed: outcome.observed,
          evidenceId,
        });
        for (const draft of outcome.findings ?? []) {
          draft.frameworkLinks ??= [];
          draft.evidenceIds = [...(draft.evidenceIds ?? []), ...(outcome.evidenceIds ?? [])];
          drafts.push(draft);
        }
        await ctx.log(outcome.status === 'failed' ? 'warn' : 'info', `${check.key}: ${outcome.status}`, { observed: outcome.observed.slice(0, 400) });
      } catch (error) {
        const message = (error as Error).message;
        const blocked = /scope enforcement|blocked|not permitted|budget|cancel/i.test(message);
        await withSystem((tx) =>
          upsertJobCheck(tx, {
            jobId: job.id,
            checkKey: check.key,
            frameworkItemCode: check.frameworkItemCode,
            status: blocked ? 'blocked' : 'error',
            detail: message.slice(0, 1500),
          }),
        );
        await ctx.recordResult({
          checkKey: check.key,
          frameworkKey: check.frameworkKey,
          frameworkVersion: check.frameworkVersion,
          frameworkItemCode: check.frameworkItemCode,
          status: blocked ? 'blocked' : 'error',
          expected: check.title,
          observed: `Check could not complete: ${message}`,
        });
        await ctx.log(blocked ? 'warn' : 'error', `Check ${check.key} ${blocked ? 'blocked' : 'failed to execute'}`, { error: message.slice(0, 400) });
      }
      completed += 1;
      await updateJobProgress(job.id, Math.round((completed / Math.max(total, 1)) * 100), { requestsMade: ctx.client.requestsMade });
    }

    // ---- Manual coverage record (never counted as passed) -------------------
    for (const manual of manualEntries) {
      if (await isCancellationRequested(job.id)) break;
      await withSystem((tx) =>
        upsertJobCheck(tx, {
          jobId: job.id,
          checkKey: `manual.${manual.code}`,
          frameworkItemCode: manual.code,
          status: 'blocked',
          detail: manual.prerequisite,
        }),
      );
      await ctx.recordResult({
        checkKey: `manual.${manual.code}`,
        frameworkKey: job.module === 'mobile' ? 'owasp-mastg' : job.module === 'api' ? 'owasp-api-top10' : 'owasp-wstg',
        frameworkVersion: job.module === 'mobile' ? '2.x' : job.module === 'api' ? '2023' : '4.2',
        frameworkItemCode: manual.code,
        status: 'blocked',
        expected: 'Manual assessor execution with supporting evidence.',
        observed: `Not executed automatically. ${manual.prerequisite}`,
        isManual: true,
      });
      completed += 1;
      await updateJobProgress(job.id, Math.round((completed / Math.max(total, 1)) * 100), { requestsMade: ctx.client.requestsMade });
    }

    // ---- Persist findings --------------------------------------------------
    let findingsResult = { created: 0, deduplicated: 0, ids: [] as string[] };
    if (drafts.length) {
      findingsResult = await withSystem((tx) =>
        persistEngineFindings(
          tx,
          {
            id: job.id,
            engagement_id: job.engagement_id,
            institution_id: job.institution_id,
            application_id: job.application_id,
            created_by: job.created_by,
          },
          drafts,
          mode,
        ),
      );
    }
    await refreshSystemicFlags();

    await finishJob(job.id, {
      status: 'succeeded',
      progress: 100,
      stats: {
        ...stats,
        status: 'succeeded',
        checksRun: checks.length,
        manualOutstanding: manualEntries.length,
        requestsMade: ctx.client.requestsMade,
        findingsCreated: findingsResult.created,
        findingsDeduplicated: findingsResult.deduplicated,
        budgetRemaining: ctx.client.remainingBudget,
        durationMs: Date.now() - startedAt,
      },
    });
    await withSystem((tx) =>
      recordAudit({
        action: 'assessment.job_completed',
        entityType: 'assessment_job',
        entityId: job.id,
        institutionId: job.institution_id,
        engagementId: job.engagement_id,
        metadata: {
          module: job.module,
          checks: checks.length,
          findings: findingsResult.created,
          requests: ctx.client.requestsMade,
          durationMs: Date.now() - startedAt,
        },
        dataMode: mode,
      }),
    );
  } catch (error) {
    const message = (error as Error).message;
    await finishJob(job.id, { status: 'failed', error: message, stats: { ...stats, status: 'failed' } });
    await withSystem((tx) =>
      recordAudit({
        action: 'assessment.job_failed',
        entityType: 'assessment_job',
        entityId: job.id,
        institutionId: job.institution_id,
        engagementId: job.engagement_id,
        outcome: 'failure',
        metadata: { module: job.module, error: message },
        dataMode: mode,
      }),
    );
  }
}

async function runCorrelation(job: JobRecord): Promise<void> {
  await withSystem(async (tx) => {
    await appendJobEvent(tx, job.id, job.institution_id, 'info', 'Correlating findings and refreshing systemic flags');
    const findings = await tx.query<any>(
      `SELECT id, title, asset, endpoint, category FROM findings WHERE engagement_id = $1`,
      [job.engagement_id],
    );
    const seen = new Map<string, string>();
    for (const finding of findings) {
      const key = `${finding.category}|${(finding.title || '').toLowerCase()}`;
      if (seen.has(key)) {
        await appendJobEvent(tx, job.id, job.institution_id, 'info', 'Related finding groups identified', {
          primary: seen.get(key),
          related: finding.id,
        });
      } else {
        seen.set(key, finding.id);
      }
    }
    await updateJobProgress(job.id, 100, { groups: seen.size });
  });
  await refreshSystemicFlags();
}
