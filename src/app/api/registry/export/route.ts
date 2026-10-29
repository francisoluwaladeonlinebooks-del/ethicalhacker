import { NextResponse, type NextRequest } from 'next/server';
import { getRequestContext } from '@/lib/db/context';
import { withScope } from '@/lib/db/pool';
import { recordAudit } from '@/lib/domain/audit';
import { registryExport, toCsv } from '@/lib/domain/registry';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * Registry export.
 *
 * The export contains registry records and asset inventory only. It never
 * contains evidence content, credentials or assessment results, and it carries
 * the demo/live mode so an exported file can never be mistaken for the other.
 */
export async function GET(request: NextRequest) {
  const ctx = await getRequestContext({ required: false });
  if (!ctx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!can(ctx.user, 'institution:read')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  }

  const format = (request.nextUrl.searchParams.get('format') ?? 'csv').toLowerCase();
  if (!['csv', 'json'].includes(format)) {
    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
  }

  try {
    const payload = await withScope(ctx.scope, (tx) => registryExport(tx, ctx));
    await withScope(ctx.scope, (tx) =>
      recordAudit(
        {
          action: 'registry.exported',
          entityType: 'registry_export',
          entityId: null,
          actor: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role },
          metadata: { format, institutions: payload.institutions.length, assets: payload.assets.length, mode: payload.mode },
          ip: ctx.ip,
          dataMode: ctx.mode,
        },
        tx,
      ),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const body = JSON.stringify(
        {
          generatedAt: payload.generatedAt,
          mode: payload.mode,
          notice:
            payload.mode === 'demo'
              ? 'Synthetic demonstration records. Not authoritative regulatory data and not a testing list.'
              : 'Registry export. A registry entry is not an authorisation to test.',
          institutions: payload.institutions,
          digitalAssets: payload.assets,
        },
        null,
        2,
      );
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="ficap-registry-${stamp}.json"`,
          'Cache-Control': 'no-store, private',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    }

    const institutionCsv = toCsv(payload.institutions as Record<string, unknown>[]);
    const assetCsv = toCsv(payload.assets as Record<string, unknown>[]);
    const body = [
      `# FICAP registry export ${payload.generatedAt} (mode: ${payload.mode})`,
      payload.mode === 'demo' ? '# Synthetic demonstration records — not authoritative, not a testing list.' : '# A registry entry is not an authorisation to test.',
      '',
      '# Institutions',
      institutionCsv,
      '',
      '# Digital assets',
      assetCsv,
      '',
    ].join('\n');

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ficap-registry-${stamp}.csv"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    // Never return internal detail; the failure is audited by the runtime log.
    return NextResponse.json({ error: 'The export could not be produced' }, { status: 500 });
  }
}
