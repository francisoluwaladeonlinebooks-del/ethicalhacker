'use server';

import { withScope } from '@/lib/db/pool';
import {
  generateReport,
  publishReport,
  reviewReport,
  submitReportForReview,
} from '@/lib/reporting/report';
import { optionalText, runAction, text } from '@/app/actions/helpers';

export async function generateReportAction(formData: FormData): Promise<never> {
  return runAction({
    formData,
    failurePath: '/reports',
    successNotice: 'Report generated from a frozen snapshot. Submit it for independent review when ready.',
    successPath: (row: any) => `/reports/${row.id}`,
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) =>
        generateReport(tx, ctx, {
          reportType: text(formData, 'reportType') as any,
          institutionId: optionalText(formData, 'institutionId') ?? null,
          engagementId: optionalText(formData, 'engagementId') ?? null,
          periodStart: optionalText(formData, 'periodStart') ?? null,
          periodEnd: optionalText(formData, 'periodEnd') ?? null,
          title: optionalText(formData, 'title'),
          notes: optionalText(formData, 'notes'),
        }),
      ),
  });
}

export async function submitReportAction(formData: FormData): Promise<never> {
  const reportId = text(formData, 'reportId');
  return runAction({
    formData,
    failurePath: `/reports/${reportId}`,
    successNotice: 'Report submitted for independent approval.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => submitReportForReview(tx, ctx, reportId)),
  });
}

export async function reviewReportAction(formData: FormData): Promise<never> {
  const reportId = text(formData, 'reportId');
  const decision = text(formData, 'decision') as 'approve' | 'return' | 'comment';
  return runAction({
    formData,
    failurePath: `/reports/${reportId}`,
    successNotice:
      decision === 'approve'
        ? 'Report approved. Publication is a separate, recorded step.'
        : decision === 'return'
          ? 'Report returned to the author with your comments.'
          : 'Review comment recorded.',
    mutate: async (ctx) =>
      withScope(ctx.scope, (tx) => reviewReport(tx, ctx, reportId, { decision, comments: optionalText(formData, 'comments') })),
  });
}

export async function publishReportAction(formData: FormData): Promise<never> {
  const reportId = text(formData, 'reportId');
  return runAction({
    formData,
    failurePath: `/reports/${reportId}`,
    successNotice: 'Report published and the publication event recorded in the audit trail.',
    mutate: async (ctx) => withScope(ctx.scope, (tx) => publishReport(tx, ctx, reportId)),
  });
}
