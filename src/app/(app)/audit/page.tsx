import Link from 'next/link';
import { pageContext, query, param } from '@/lib/page-context';
import { listAuditEvents, verifyAuditChain } from '@/lib/domain/audit';
import { listInstitutions } from '@/lib/domain/institutions';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, EmptyState, DataQualityNote, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('audit:read');
  const institutionId = param(params, 'institutionId');
  const action = param(params, 'action');
  const actorId = param(params, 'actorId');

  const data = await query(ctx, async (tx) => {
    const [events, institutions] = await Promise.all([
      listAuditEvents(tx, { institutionId, action, actorId, limit: 200 }),
      listInstitutions(tx, ctx, {}),
    ]);
    return { events, institutions };
  });
  const verification = await verifyAuditChain();

  const outcomes = data.events.reduce((acc: Record<string, number>, event: any) => {
    acc[event.outcome] = (acc[event.outcome] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Append-only, hash-chained record of security-relevant activity. Rows cannot be updated or deleted by the application role, and the chain can be re-verified at any time."
        meta={
          <>
            <Badge tone={verification.ok ? 'green' : 'red'}>
              {verification.ok ? `chain verified · ${verification.checked} records` : `chain broken at #${verification.brokenAtSeq}`}
            </Badge>
            <Badge tone="slate">{data.events.length} events shown</Badge>
            {outcomes.denied ? <Badge tone="amber">{outcomes.denied} denied attempts</Badge> : null}
            {outcomes.failure ? <Badge tone="red">{outcomes.failure} failures</Badge> : null}
          </>
        }
      />

      <Card className="mb-4">
        <CardHeader title="Filters" subtitle="Filtering never changes what is recorded; it only changes what is displayed." />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label">Institution</span>
              <select name="institutionId" defaultValue={institutionId ?? ''} className="input mt-1">
                <option value="">All institutions</option>
                {data.institutions.map((institution: any) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Action contains</span>
              <input name="action" defaultValue={action ?? ''} className="input mt-1" placeholder="evidence.downloaded" />
            </label>
            <button className="btn btn-primary" type="submit">Apply</button>
            <Link href="/audit" className="btn btn-ghost">Reset</Link>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Events"
          subtitle="Most recent first. Sequence numbers are monotonic and gaps indicate records outside your authorised scope."
          actions={
            verification.ok ? (
              <span className="text-2xs text-[var(--ficap-muted)]">
                verified {verification.firstSeq ?? '—'}–{verification.lastSeq ?? '—'}
              </span>
            ) : (
              <span className="text-2xs text-risk-critical">{verification.reason}</span>
            )
          }
        />
        {data.events.length ? (
          <TableWrap maxHeight="640px">
            <table className="table">
              <thead><tr><th>Seq</th><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Outcome</th><th>Metadata</th></tr></thead>
              <tbody>
                {data.events.map((event: any) => (
                  <tr key={event.id} className={event.outcome === 'denied' ? 'bg-amber-50/60' : event.outcome === 'failure' ? 'bg-red-50/60' : ''}>
                    <td className="font-mono text-2xs">{event.seq}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(event.at, true)}</td>
                    <td className="text-2xs">
                      {event.actor_email ?? 'system'}
                      <div className="text-[var(--ficap-muted)]">{String(event.actor_role ?? '—').replace(/_/g, ' ')}</div>
                    </td>
                    <td className="font-mono text-2xs">{event.action}</td>
                    <td className="text-2xs">{event.entity_type}{event.entity_id ? <div className="font-mono text-[10px] text-[var(--ficap-muted)]">{String(event.entity_id).slice(0, 12)}…</div> : null}</td>
                    <td className="text-2xs"><Badge tone={event.outcome === 'success' ? 'green' : event.outcome === 'denied' ? 'amber' : 'red'}>{event.outcome}</Badge></td>
                    <td className="max-w-[26rem] font-mono text-[10px] leading-snug text-[var(--ficap-muted)]">{JSON.stringify(event.metadata ?? {}).slice(0, 220)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><EmptyState title="No event matches these filters" description="Audit events are written by every security-relevant action, including failed authorisation." /></CardBody>
        )}
      </Card>

      <div className="mt-4">
        <DataQualityNote>
          Each record stores the hash of its own content and the hash of its predecessor. Altering or deleting a record breaks the chain and is detected by the
          verification above. Evidence access, report exports and privileged configuration changes are all recorded.
        </DataQualityNote>
      </div>
    </>
  );
}
