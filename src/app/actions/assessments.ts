'use server';

import { withScope } from '@/lib/db/pool';
import {
  addFrameworkLink,
  assessRisk,
  correlateFindings,
  scoreFinding,
  transitionFinding,
  updateFinding,
} from '@/lib/domain/findings';
import {
  completeRetest,
  createRetest,
  reviewSubmission,
  submitRemediation,
  updatePlan,
  verifyRetest,
} from '@/lib/domain/remediation';
import { generateSuggestion, reviewSuggestion } from '@/lib/domain/ai';
import { bool, optionalText, runAction, text } from '@/app/actions/helpers';

function dimensionsFrom(formData: FormData) {
  const keys = [
    'exposure',
    'data_sensitivity',
    'customer_funds',
    'payment_integrity',
    'privileged_access',
    'reachability',
    'compensating_controls',
    'confidence',
    'exploitation_evidence',
  ];
  const dimensions: Record<string, number> = {};
  for (const key of keys) {
    const raw = formData.get(key);
    if (typeof raw === 'string' && raw.length) dimensions[key] = Number(raw);
  }
  return dimensions;
}

export async function scoreFindingAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: `/findings/${findingId}`,
    successNotice: 'CVSS v4.0 score recorded. Contextual risk is stored separately and does not alter the score.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        scoreFinding(tx, ctx, {
          findingId,
          vector: text(formData, 'vector'),
          rationale: optionalText(formData, 'rationale'),
        }),
      ),
  });
}

export async function assessRiskAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: `/findings/${findingId}`,
    successNotice: 'Contextual banking risk recorded. The CVSS score is unchanged.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        assessRisk(tx, ctx, {
          findingId,
          dimensions: dimensionsFrom(formData),
          rationale: optionalText(formData, 'rationale'),
        }),
      ),
  });
}

export async function transitionFindingAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: `/findings/${findingId}`,
    successNotice: 'Finding status updated and the change recorded in the history.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        transitionFinding(tx, ctx, {
          findingId,
          toStatus: text(formData, 'toStatus') as any,
          note: optionalText(formData, 'note'),
        }),
      ),
  });
}

export async function updateFindingAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: `/findings/${findingId}`,
    successNotice: 'Finding updated.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        updateFinding(tx, ctx, findingId, {
          businessImpact: optionalText(formData, 'businessImpact'),
          remediation_summary: optionalText(formData, 'remediationSummary'),
          root_cause: optionalText(formData, 'rootCause'),
          owner_team: optionalText(formData, 'ownerTeam'),
          compensating_controls: optionalText(formData, 'compensatingControls'),
        }),
      ),
  });
}

export async function addFrameworkLinkAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: `/findings/${findingId}`,
    successNotice: 'Framework reference recorded. Only defensible mappings should be added.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        addFrameworkLink(tx, ctx, {
          findingId,
          frameworkKey: text(formData, 'frameworkKey'),
          frameworkVersion: text(formData, 'frameworkVersion'),
          itemCode: text(formData, 'itemCode'),
          relationship: optionalText(formData, 'relationship') ?? 'supports',
          rationale: optionalText(formData, 'rationale'),
        }),
      ),
  });
}

export async function correlateFindingsAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: findingId ? `/findings/${findingId}` : '/findings',
    successNotice: 'Cross-institution correlation refreshed.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => correlateFindings(tx, ctx)),
  });
}

export async function updateRemediationPlanAction(formData: FormData): Promise<never> {
  const planId = text(formData, 'planId');
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: `/findings/${findingId}`,
    successNotice: 'Remediation plan updated.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        updatePlan(tx, ctx, planId, {
          root_cause: optionalText(formData, 'rootCause'),
          containment: optionalText(formData, 'containment'),
          short_term: optionalText(formData, 'shortTerm'),
          permanent_fix: optionalText(formData, 'permanentFix'),
          owner_team: optionalText(formData, 'ownerTeam'),
          verification_criteria: optionalText(formData, 'verificationCriteria'),
          retest_procedure: optionalText(formData, 'retestProcedure'),
          evidence_required: optionalText(formData, 'evidenceRequired'),
          target_date: optionalText(formData, 'targetDate'),
        }),
      ),
  });
}

export async function submitRemediationAction(formData: FormData): Promise<never> {
  const planId = text(formData, 'planId');
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: findingId ? `/findings/${findingId}` : '/remediation',
    successNotice: 'Remediation submitted for independent verification.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        submitRemediation(tx, ctx, { planId, notes: text(formData, 'notes') }),
      ),
  });
}

export async function reviewSubmissionAction(formData: FormData): Promise<never> {
  const submissionId = text(formData, 'submissionId');
  return runAction({
    formData,
    failurePath: '/remediation',
    successNotice: 'Remediation submission reviewed.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        reviewSubmission(tx, ctx, {
          submissionId,
          decision: text(formData, 'decision') as 'accepted' | 'rejected' | 'needs_info',
          note: optionalText(formData, 'note'),
        }),
      ),
  });
}

export async function createRetestAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: findingId ? `/findings/${findingId}` : '/retesting',
    successNotice: 'Retest requested.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => createRetest(tx, ctx, { findingId, notes: optionalText(formData, 'notes') })),
  });
}

export async function completeRetestAction(formData: FormData): Promise<never> {
  const isAutomated = bool(formData, 'automated');
  const retestId = text(formData, 'retestId');
  return runAction({
    formData,
    failurePath: '/retesting',
    successNotice: isAutomated
      ? 'Automated re-check queued. The retest will complete only when the engine records an outcome.'
      : 'Retest result recorded. Independent verification is still required before closure.',
    mutate: async (ctx) =>
      withScope(ctx.scope, async (tx) => {
        if (isAutomated) {
          const retest = await tx.queryOne<{ finding_id: string }>('SELECT finding_id FROM retests WHERE id = $1', [retestId]);
          if (!retest) throw new Error('Retest not found');
          await tx.query(`UPDATE retests SET status = 'in_progress', notes = COALESCE($2, notes) WHERE id = $1`, [retestId, optionalText(formData, 'notes') ?? null]);
          return { retestId, findingId: retest.finding_id, automated: true };
        }
        return completeRetest(tx, ctx, {
          retestId,
          result: text(formData, 'result') as 'resolved' | 'not_resolved' | 'partial' | 'inconclusive',
          notes: text(formData, 'notes'),
        });
      }),
  });
}

export async function verifyRetestAction(formData: FormData): Promise<never> {
  const retestId = text(formData, 'retestId');
  return runAction({
    formData,
    failurePath: '/retesting',
    successNotice: 'Retest independently verified and the finding record updated.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => verifyRetest(tx, ctx, retestId)),
  });
}

export async function generateAiSuggestionAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: `/findings/${findingId}`,
    successNotice: 'Suggestion generated. It is labelled as an assistant suggestion and requires assessor review.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        generateSuggestion(tx, ctx, {
          findingId,
          kind: (text(formData, 'kind') || 'suggest_remediation') as any,
        }),
      ),
  });
}

export async function reviewAiSuggestionAction(formData: FormData): Promise<never> {
  const findingId = text(formData, 'findingId');
  return runAction({
    formData,
    failurePath: `/findings/${findingId}`,
    successNotice: 'Suggestion reviewed.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        reviewSuggestion(tx, ctx, {
          suggestionId: text(formData, 'suggestionId'),
          decision: text(formData, 'decision') as 'accepted' | 'rejected',
        }),
      ),
  });
}
