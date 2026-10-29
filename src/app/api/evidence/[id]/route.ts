import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/db/context';
import { withScope } from '@/lib/db/pool';
import { readEvidence } from '@/lib/domain/evidence';
import { can } from '@/lib/rbac';
import { toPublicError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';

/**
 * Evidence body retrieval.
 *
 * Evidence is confidential by default: authorisation is re-checked server side
 * on every request, the response is never cached, and inline rendering of
 * untrusted content is prevented by an attachment disposition plus a
 * restrictive Content-Security-Policy. Access is recorded by readEvidence().
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await getRequestContext();
    if (!ctx) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!can(ctx.user, 'evidence:download')) {
      return NextResponse.json({ error: 'You do not have permission to download evidence' }, { status: 403 });
    }
    if (!isUuid(id)) return NextResponse.json({ error: 'Evidence not found' }, { status: 404 });
    const evidence = await withScope(ctx.scope, (tx) => readEvidence(tx, ctx, id, 'download'));
    return new NextResponse(new Uint8Array(evidence.content), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sanitise(evidence.title)}.txt"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    const { body, status } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}

function sanitise(title: string): string {
  return (title || 'evidence').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
}
