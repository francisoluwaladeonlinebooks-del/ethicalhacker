import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/db/context';
import { withScope } from '@/lib/db/pool';
import { readArtifact, sanitiseFilename } from '@/lib/domain/artifacts';
import { can } from '@/lib/rbac';
import { toPublicError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Artefact download.
 *
 * Artefacts are stored encrypted, verified against their recorded digest on
 * every read, and always returned as an attachment with a restrictive CSP. The
 * response is never cached, and the download is recorded in the audit trail by
 * readArtifact().
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await getRequestContext();
    if (!ctx) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!can(ctx.user, 'evidence:download')) {
      return NextResponse.json({ error: 'You do not have permission to download artefacts' }, { status: 403 });
    }
    const artifact = await withScope(ctx.scope, (tx) => readArtifact(tx, ctx, id));
    const filename = sanitiseFilename(artifact.filename || 'artifact');
    return new NextResponse(new Uint8Array(artifact.content), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
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
