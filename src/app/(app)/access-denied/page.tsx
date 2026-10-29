import Link from 'next/link';
import { getRequestContext } from '@/lib/db/context';
import { Card, CardBody, PageHeader, DataQualityNote } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Explicit refusal page. Reaching this page never implies the underlying data
 * is reachable: the service layer and row level security refuse it separately.
 */
export default async function AccessDeniedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const needed = typeof params.need === 'string' ? params.need.split(',') : [];
  const ctx = await getRequestContext({ required: false });

  return (
    <>
      <PageHeader
        title="Access not authorised"
        description="Your role does not include the permission required for this area. This refusal is recorded in the audit trail when the underlying action is attempted."
        meta={needed.length ? <span className="font-mono text-2xs text-[var(--ficap-muted)]">required: {needed.join(' or ')}</span> : null}
      />
      <Card>
        <CardBody>
          <p className="text-xs leading-relaxed">
            Signed in as <strong>{ctx?.user.email ?? 'unknown'}</strong>
            {ctx ? <> with the role <strong>{String(ctx.user.role).replace(/_/g, ' ')}</strong></> : null}.
          </p>
          <p className="mt-2 text-2xs leading-relaxed text-[var(--ficap-muted)]">
            Access is scoped by role, institution and engagement. If you need this capability, ask a platform administrator to review your role. Do not attempt to
            work around the control: every authorisation failure is logged and supervisory access is reviewed.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/" className="btn btn-primary">Return to overview</Link>
            <Link href="/findings" className="btn btn-secondary">Findings in my scope</Link>
          </div>
        </CardBody>
      </Card>
      <div className="mt-4">
        <DataQualityNote>
          Hiding navigation is a usability measure, never a security boundary. Server-side permission checks, scope validation and database row level security each
          enforce access independently.
        </DataQualityNote>
      </div>
    </>
  );
}
