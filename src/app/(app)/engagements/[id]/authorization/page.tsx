import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/ids';
import { cookies } from 'next/headers';
import { pageContext, query, canDo, flashFrom } from '@/lib/page-context';
import { getEngagementDetail } from '@/lib/domain/engagements';
import { approveEngagementAction, recordAuthorizationAction } from '@/app/actions/supervision';
import { CSRF_COOKIE } from '@/lib/db/context';
import { NotFoundError } from '@/lib/errors';
import { METHOD_LABELS, TEST_METHODS } from '@/lib/constants';
import { Badge, Card, CardBody, CardHeader, DataQualityNote, Field, Flash, PageHeader, StatusBadge, TableWrap, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AuthorizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await pageContext('engagement:read');
  const flash = flashFrom(await searchParams);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';

  let data: any;
  try {
    data = await query(ctx, (tx) => getEngagementDetail(tx, ctx, id));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { engagement, institution, assets, exclusions, authorization, operational } = data;
  const activeRecord = authorization.find((record: any) => record.status === 'active');
  const expired = activeRecord ? new Date(activeRecord.valid_to) < new Date() : true;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Authorisation and scope review"
        description="The written authorisation, its validity window, the approved asset list and the exclusions. The engagement cannot be authorised or executed unless these are complete and in date."
        meta={
          <>
            <Badge tone="navy">{engagement.code}</Badge>
            <span className="text-2xs text-[var(--ficap-muted)]">{institution?.name}</span>
            <StatusBadge status={engagement.status} />
            {activeRecord ? <Badge tone={expired ? 'red' : 'green'}>{expired ? 'authorisation expired' : 'authorisation active'}</Badge> : <Badge tone="red">no authorisation</Badge>}
          </>
        }
        actions={<Link href={`/engagements/${id}`} className="btn btn-secondary">Back to engagement</Link>}
      />
      <Flash notice={flash.notice} error={flash.error} />

      <Card>
        <CardHeader title="Gate status" subtitle="The same gate is evaluated by the worker before every request." />
        <CardBody>
          {operational.ok ? (
            <p className="text-xs">All preconditions are satisfied: active authorisation, in-date scope, open testing window, released kill switch, approved plan and at least one scope asset.</p>
          ) : (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="font-semibold">Blocked: </span>{operational.reason}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Authorisation records" subtitle="Superseded and revoked records are retained for audit." />
        {authorization.length ? (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Reference</th><th>Authorised by</th><th>Signed</th><th>Valid</th><th>Testing window</th><th>Methods</th><th>Status</th></tr></thead>
              <tbody>
                {authorization.map((record: any) => (
                  <tr key={record.id}>
                    <td className="font-mono text-2xs">{record.reference}</td>
                    <td className="text-2xs">{record.authorized_by_name}<span className="block text-[var(--ficap-muted)]">{record.authorized_by_role}</span></td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(record.authorized_at, true)}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(record.valid_from)} → {formatDate(record.valid_to)}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(record.testing_window_start, true)} → {formatDate(record.testing_window_end, true)}</td>
                    <td className="text-2xs">{(record.permitted_methods ?? []).length}</td>
                    <td><StatusBadge status={record.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><p className="prose-note">No authorisation has been recorded. Execution is impossible until one exists.</p></CardBody>
        )}
      </Card>

      {canDo(ctx, 'engagement:authorize') && ['draft', 'pending_authorization'].includes(engagement.status) ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Record a written authorisation" subtitle="Record exactly what the institution signed. A reference to a document that does not exist is an audit failure." />
            <CardBody>
              <form action={recordAuthorizationAction} className="grid gap-3">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="engagementId" value={id} />
                <Field label="Authorisation reference" name="reference" required>
                  <input id="reference" name="reference" required maxLength={120} className="input font-mono" defaultValue={engagement.authorization_ref ?? ''} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Authorising officer" name="authorizedByName" required>
                    <input id="authorizedByName" name="authorizedByName" required maxLength={120} className="input" />
                  </Field>
                  <Field label="Role" name="authorizedByRole" required>
                    <input id="authorizedByRole" name="authorizedByRole" required maxLength={120} className="input" />
                  </Field>
                  <Field label="Signed on" name="authorizedAt" required>
                    <input id="authorizedAt" name="authorizedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
                  </Field>
                  <Field label="Valid until" name="validTo" required>
                    <input id="validTo" name="validTo" type="date" required defaultValue={new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)} className="input" />
                  </Field>
                  <Field label="Testing window start" name="testingWindowStart">
                    <input id="testingWindowStart" name="testingWindowStart" type="datetime-local" className="input" />
                  </Field>
                  <Field label="Testing window end" name="testingWindowEnd">
                    <input id="testingWindowEnd" name="testingWindowEnd" type="datetime-local" className="input" />
                  </Field>
                </div>
                <Field label="Valid from" name="validFrom" required>
                  <input id="validFrom" name="validFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
                </Field>
                <div>
                  <p className="label">Permitted methods</p>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    {TEST_METHODS.map((method) => (
                      <label key={method.key} className="flex items-center gap-2 text-2xs">
                        <input type="checkbox" name="permittedMethods" value={method.key} defaultChecked={(engagement.permitted_methods ?? []).includes(method.key)} className="h-3.5 w-3.5 rounded border-slate-300" />
                        {method.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="label">Prohibited actions</p>
                  <ul className="mt-1 space-y-1 text-2xs">
                    {(engagement.prohibited_actions ?? []).map((action: string) => (
                      <li key={action}>
                        <input type="hidden" name="prohibitedActions" value={action} />
                        • {action}
                      </li>
                    ))}
                  </ul>
                </div>
                <button type="submit" className="btn btn-primary">Record authorisation</button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Authorise the engagement" subtitle="Confirms the in-date authorisation and that scope matches it. This unlocks planning." />
            <CardBody className="space-y-3">
              <ul className="space-y-1.5 text-xs">
                {[
                  ['Written authorisation recorded and in date', Boolean(activeRecord) && !expired],
                  ['Approved scope assets recorded', assets.length > 0],
                  ['Emergency contact recorded', Boolean(engagement.emergency_contact_name && engagement.emergency_contact_phone)],
                  ['Escalation procedure recorded', Boolean(engagement.escalation_procedure)],
                  ['Scope expiry recorded', Boolean(engagement.scope_expires_at)],
                ].map(([label, ok]) => (
                  <li key={String(label)} className="flex items-center justify-between gap-2">
                    <span>{String(label)}</span>
                    <Badge tone={ok ? 'green' : 'red'}>{ok ? 'ready' : 'missing'}</Badge>
                  </li>
                ))}
              </ul>
              <form action={approveEngagementAction}>
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="engagementId" value={id} />
                <button type="submit" className="btn btn-primary w-full" disabled={!activeRecord || expired}>Authorise engagement</button>
              </form>
              <p className="prose-note">Authorising does not send any traffic. It records the supervisory decision and unlocks plan submission.</p>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Approved scope" subtitle={`${assets.length} assets · ${exclusions.length} exclusions`} />
        <TableWrap>
          <table className="table">
            <thead><tr><th>Type</th><th>Value</th><th>Scheme / port</th><th>Paths</th><th>Methods</th><th>Notes</th></tr></thead>
            <tbody>
              {assets.map((asset: any) => (
                <tr key={asset.id}>
                  <td className="text-2xs uppercase">{String(asset.asset_type).replace(/_/g, ' ')}</td>
                  <td className="font-mono text-2xs">{asset.value}</td>
                  <td className="text-2xs">{asset.scheme ?? '—'}{asset.port ? `:${asset.port}` : ''}</td>
                  <td className="font-mono text-2xs">{(asset.approved_paths ?? []).join(', ') || (asset.path_prefix ?? 'any')}</td>
                  <td className="font-mono text-2xs">{(asset.allowed_methods ?? []).join(', ')}</td>
                  <td className="text-2xs text-[var(--ficap-muted)]">{asset.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {exclusions.length ? (
          <CardBody className="border-t border-[var(--ficap-border)]">
            <p className="label">Exclusions</p>
            <ul className="mt-1 space-y-1 text-xs">
              {exclusions.map((exclusion: any) => (
                <li key={`${exclusion.asset_type}-${exclusion.value}`}>
                  <span className="font-mono text-2xs">{exclusion.value}</span> — <span className="text-2xs text-[var(--ficap-muted)]">{exclusion.reason}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        ) : null}
      </Card>

      <DataQualityNote>
        Scope changes after authorisation are refused by the platform: a materially different scope requires a new engagement version so that historical
        results stay tied to the scope that was actually approved.
      </DataQualityNote>
      <p className="text-2xs text-[var(--ficap-muted)]">
        Permitted methods recorded:{' '}
        {(engagement.permitted_methods ?? []).map((method: string) => METHOD_LABELS[method] ?? method).join('; ') || 'none'}
      </p>
    </div>
  );
}
