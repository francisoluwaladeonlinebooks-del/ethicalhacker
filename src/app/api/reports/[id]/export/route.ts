import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/db/context';
import { withScope } from '@/lib/db/pool';
import { getReport, renderReportJson } from '@/lib/reporting/report';
import { renderReportPdf } from '@/lib/reporting/pdf';
import { renderReportXlsx } from '@/lib/reporting/xlsx';
import { recordAudit } from '@/lib/domain/audit';
import { toPublicError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';

/**
 * Report export.
 *
 * The export is rendered from the stored snapshot only, so an approved report
 * always exports exactly what was approved. Authorisation is re-checked on the
 * request and the download is written to the audit trail before the bytes leave
 * the server.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'pdf';
  try {
    const ctx = await getRequestContext();
    if (!ctx) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!['pdf', 'xlsx', 'json'].includes(format)) return NextResponse.json({ error: 'Unsupported export format' }, { status: 400 });
    if (!isUuid(id)) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    const { report } = await withScope(ctx.scope, (tx) => getReport(tx, ctx, id));
    const snapshot = report.snapshot ?? {};

    await withScope(ctx.scope, (tx) =>
      recordAudit(
        {
          action: 'report.exported',
          entityType: 'report',
          entityId: id,
          institutionId: report.institution_id,
          engagementId: report.engagement_id,
          actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
          metadata: { format, title: report.title, status: report.status },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          dataMode: ctx.mode,
        },
        tx,
      ),
    );

    const base = `${String(report.title).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60)}-v${report.version}`;
    if (format === 'json') {
      return new NextResponse(new Uint8Array(renderReportJson(snapshot)), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${base}.json"`,
          'Cache-Control': 'no-store, private',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const body = format === 'pdf' ? await renderReportPdf(snapshot) : await renderReportXlsx(snapshot);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${base}.${format}"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const { body, status } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
