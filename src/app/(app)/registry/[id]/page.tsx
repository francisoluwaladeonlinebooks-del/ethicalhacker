import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/ids';
import { pageContext, query, flashFrom, canDo } from '@/lib/page-context';
import { DIGITAL_ASSET_TYPES, ASSET_STATUS_LABELS, listDigitalAssets } from '@/lib/domain/registry';
import { INSTITUTION_CATEGORIES } from '@/lib/domain/institutions';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, Flash, DescriptionList, DataQualityNote, EmptyState, Field, formatDate } from '@/components/ui';
import { createAssetAction, licenceEventAction, verifyAssetAction, verifyInstitutionAction } from '@/app/actions/registry';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

const LICENCE_EVENTS = ['granted', 'renewed', 'varied', 'suspended', 'revoked', 'surrendered', 'expired', 'category_changed', 'renamed', 'merged'];

export default async function InstitutionRegistryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const search = await searchParams;
  const ctx = await pageContext('institution:read');
  const flash = flashFrom(search);

  const data = await query(ctx, async (tx) => {
    const institution = await tx.queryOne<any>('SELECT * FROM institutions WHERE id = $1', [id]);
    if (!institution) return null;
    const [licences, assets, names, relationships, queue] = await Promise.all([
      tx.query<any>('SELECT * FROM licence_events WHERE institution_id = $1 ORDER BY effective_at DESC, created_at DESC', [id]),
      listDigitalAssets(tx, ctx, { institutionId: id }),
      tx.query<any>('SELECT * FROM institution_names WHERE institution_id = $1 ORDER BY name_type, name', [id]),
      tx.query<any>('SELECT * FROM entity_relationships WHERE institution_id = $1 ORDER BY relationship', [id]),
      tx.query<any>(
        `SELECT * FROM registry_verification_queue WHERE institution_id = $1 AND status IN ('open','in_review') ORDER BY created_at DESC`,
        [id],
      ),
    ]);
    return { institution, licences, assets, names, relationships, queue };
  });

  if (!data) notFound();
  const { institution, licences, assets, names, relationships, queue } = data;
  const category = INSTITUTION_CATEGORIES.find((entry) => entry.key === institution.category);
  const canWrite = canDo(ctx, 'institution:write');

  return (
    <>
      <PageHeader
        title={institution.name}
        description={`${category?.label ?? institution.category} · ${institution.regulator ?? 'regulator not recorded'}`}
        meta={
          <>
            <Badge tone="slate">{institution.code}</Badge>
            <Badge tone={institution.verification_status === 'verified' ? 'green' : 'amber'}>{String(institution.verification_status).replace(/_/g, ' ')}</Badge>
            <Badge tone={institution.licence_status === 'active' ? 'green' : 'red'}>licence {String(institution.licence_status).replace(/_/g, ' ')}</Badge>
            {institution.last_verified_at && institution.last_verified_at < new Date(Date.now() - 180 * 86400000).toISOString() ? <Badge tone="amber">verification stale</Badge> : null}
          </>
        }
        actions={
          <>
            <Link href="/registry" className="btn btn-secondary">Registry</Link>
            <Link href={`/institutions/${institution.id}`} className="btn btn-secondary">Institution workspace</Link>
            <Link href="/registry/assets" className="btn btn-secondary">Asset inventory</Link>
          </>
        }
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Record and provenance" subtitle="Every field below is traceable to a source. Verification has to be repeated when the source changes or when the staleness window elapses." />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Legal name', value: institution.name },
                  { label: 'Trading name', value: institution.trading_name ?? '—' },
                  { label: 'Licence category', value: category?.label ?? institution.category },
                  { label: 'Licence number', value: <span className="font-mono text-2xs">{institution.licence_number ?? 'not recorded'}</span> },
                  { label: 'Regulator', value: institution.regulator ?? 'not recorded' },
                  { label: 'Licence issued', value: institution.licence_issued_at ? formatDate(institution.licence_issued_at) : 'not recorded' },
                  { label: 'Licence expires', value: institution.licence_expires_at ? formatDate(institution.licence_expires_at) : 'not recorded' },
                  { label: 'Source', value: institution.source_name ?? 'not recorded' },
                  {
                    label: 'Source URL',
                    value: institution.source_url ? (
                      <a className="link break-all" href={institution.source_url} target="_blank" rel="noreferrer noopener">{institution.source_url}</a>
                    ) : 'not recorded',
                  },
                  { label: 'Retrieved', value: institution.source_retrieved_at ? formatDate(institution.source_retrieved_at, true) : 'not recorded' },
                  { label: 'Last verified', value: institution.last_verified_at ? formatDate(institution.last_verified_at, true) : 'never' },
                  { label: 'Staleness window', value: `${institution.stale_after_days} days` },
                  { label: 'Notes', value: institution.registry_notes ?? '—' },
                ]}
              />
              {canWrite ? (
                <form action={verifyInstitutionAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--ficap-border)] pt-3">
                  <Csrf />
                  <input type="hidden" name="institutionId" value={institution.id} />
                  <label className="min-w-[240px] flex-1">
                    <span className="label">Verification note</span>
                    <input className="input" name="note" placeholder="Official publication reviewed, e.g. CBN list dated …" />
                  </label>
                  <button className="btn btn-accent btn-sm" type="submit">Mark record verified</button>
                </form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Digital asset inventory"
              subtitle="An asset is a candidate until a named assessor records the evidence proving the institution operates it."
              actions={<Badge tone="navy">{assets.length} recorded</Badge>}
            />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Asset</th><th>Type</th><th>Environment</th><th>Ownership</th><th>Technical contact</th><th>Verify</th></tr></thead>
                <tbody>
                  {assets.map((asset: any) => (
                    <tr key={asset.id}>
                      <td>
                        <div className="text-2xs font-medium">{asset.display_name}</div>
                        <div className="mt-0.5 break-all font-mono text-[10px] text-[var(--ficap-muted)]">{asset.identifier}</div>
                        {asset.ownership_evidence ? <details className="mt-1"><summary className="cursor-pointer text-[10px] text-[var(--ficap-muted)]">evidence reviewed</summary><p className="mt-1 text-[10px] leading-relaxed">{asset.ownership_evidence}</p></details> : null}
                      </td>
                      <td className="text-2xs">{DIGITAL_ASSET_TYPES.find((type) => type.key === asset.asset_type)?.label ?? asset.asset_type}</td>
                      <td className="text-2xs">{asset.environment}</td>
                      <td className="text-2xs">
                        <Badge tone={asset.status === 'ownership_verified' ? 'green' : asset.status === 'ownership_rejected' ? 'red' : 'amber'}>
                          {asset.status === 'ownership_verified' ? 'verified' : asset.status === 'ownership_rejected' ? 'rejected' : 'candidate'}
                        </Badge>
                        <div className="mt-0.5 text-[10px] text-[var(--ficap-muted)]">{ASSET_STATUS_LABELS[asset.status] ?? asset.status}</div>
                      </td>
                      <td className="text-2xs">
                        {asset.technical_contact_name ?? '—'}
                        {asset.technical_contact_email ? <div className="break-all text-[10px] text-[var(--ficap-muted)]">{asset.technical_contact_email}</div> : null}
                      </td>
                      <td>
                        {canWrite && asset.status !== 'ownership_rejected' ? (
                          <form action={verifyAssetAction} className="space-y-1">
                            <Csrf />
                            <input type="hidden" name="assetId" value={asset.id} />
                            <input type="hidden" name="institutionId" value={institution.id} />
                            <input className="input w-44 text-2xs" name="evidence" placeholder="Evidence reviewed (≥20 chars)" required minLength={20} />
                            <div className="flex gap-1">
                              <button className="btn btn-ghost btn-xs" name="decision" value="verified" type="submit">Verify</button>
                              <button className="btn btn-ghost btn-xs text-risk-critical" name="decision" value="rejected" type="submit">Reject</button>
                            </div>
                          </form>
                        ) : (
                          <span className="text-[10px] text-[var(--ficap-muted)]">{asset.verified_at ? formatDate(asset.verified_at) : 'read-only'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {!assets.length ? (
              <CardBody>
                <EmptyState
                  title="No digital asset recorded"
                  description="Record known systems here. Recording an asset never schedules any activity against it — active testing requires a separate approved engagement."
                />
              </CardBody>
            ) : null}
            {canWrite ? (
              <CardBody className="border-t border-[var(--ficap-border)]">
                <details>
                  <summary className="cursor-pointer text-2xs font-semibold text-navy-800">Record a digital asset</summary>
                  <form action={createAssetAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Csrf />
                    <input type="hidden" name="institutionId" value={institution.id} />
                    <Field label="Asset type" name="assetType" required>
                      <select className="input" name="assetType" required defaultValue="web_app">
                        {DIGITAL_ASSET_TYPES.map((type) => (
                          <option key={type.key} value={type.key}>{type.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Display name" name="displayName" required>
                      <input className="input" name="displayName" required placeholder="Retail internet banking" />
                    </Field>
                    <Field label="Identifier" name="identifier" required hint="Domain, URL origin or package identifier. Credentials and secrets are never stored here.">
                      <input className="input" name="identifier" required placeholder="bank.example" />
                    </Field>
                    <Field label="Environment" name="environment">
                      <select className="input" name="environment" defaultValue="production">
                        <option value="production">Production</option>
                        <option value="staging">Staging</option>
                        <option value="sandbox">Sandbox</option>
                        <option value="test">Test</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </Field>
                    <Field label="Technical contact" name="technicalContactName">
                      <input className="input" name="technicalContactName" placeholder="Named owner at the institution" />
                    </Field>
                    <Field label="Contact email" name="technicalContactEmail">
                      <input className="input" name="technicalContactEmail" type="email" placeholder="owner@example" />
                    </Field>
                    <Field label="Source" name="sourceName" hint="Where the asset was learned from. Discovery is read-only and never establishes ownership.">
                      <input className="input" name="sourceName" defaultValue="Manual entry" />
                    </Field>
                    <Field label="Source URL" name="sourceUrl">
                      <input className="input" name="sourceUrl" placeholder="https://…" />
                    </Field>
                    <div className="sm:col-span-2">
                      <button className="btn btn-primary btn-sm" type="submit">Record as candidate</button>
                    </div>
                  </form>
                </details>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Licence history" subtitle="History is append-only. Only unambiguous events change the current licence state." />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Effective</th><th>Event</th><th>Category</th><th>Licence number</th><th>Source</th><th>Recorded</th></tr></thead>
                <tbody>
                  {licences.map((event: any) => (
                    <tr key={event.id}>
                      <td className="text-2xs">{formatDate(event.effective_at)}</td>
                      <td className="text-2xs"><Badge tone={['suspended', 'revoked', 'expired', 'surrendered'].includes(event.event_type) ? 'red' : 'navy'}>{event.event_type.replace(/_/g, ' ')}</Badge></td>
                      <td className="text-2xs">{event.licence_category ? INSTITUTION_CATEGORIES.find((entry) => entry.key === event.licence_category)?.label ?? event.licence_category : '—'}</td>
                      <td className="font-mono text-[10px]">{event.licence_number ?? '—'}</td>
                      <td className="text-[10px] text-[var(--ficap-muted)]">
                        {event.source_name ?? '—'}
                        {event.source_url ? <div className="break-all">{event.source_url.replace(/^https?:\/\//, '')}</div> : null}
                        {event.evidence_note ? <div className="mt-0.5 italic">{event.evidence_note}</div> : null}
                      </td>
                      <td className="text-[10px] text-[var(--ficap-muted)]">{formatDate(event.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {!licences.length ? <CardBody><p className="text-2xs text-[var(--ficap-muted)]">No licence event recorded.</p></CardBody> : null}
            {canWrite ? (
              <CardBody className="border-t border-[var(--ficap-border)]">
                <form action={licenceEventAction} className="grid gap-2 sm:grid-cols-3">
                  <Csrf />
                  <input type="hidden" name="institutionId" value={institution.id} />
                  <Field label="Event" name="eventType" required>
                    <select className="input" name="eventType" defaultValue="renewed" required>
                      {LICENCE_EVENTS.map((event) => <option key={event} value={event}>{event.replace(/_/g, ' ')}</option>)}
                    </select>
                  </Field>
                  <Field label="Effective date" name="effectiveAt" required>
                    <input className="input" name="effectiveAt" type="date" required />
                  </Field>
                  <Field label="Licence number" name="licenceNumber">
                    <input className="input" name="licenceNumber" defaultValue={institution.licence_number ?? ''} />
                  </Field>
                  <Field label="Source" name="sourceName">
                    <input className="input" name="sourceName" placeholder="Official publication" />
                  </Field>
                  <Field label="Source URL" name="sourceUrl">
                    <input className="input" name="sourceUrl" placeholder="https://…" />
                  </Field>
                  <Field label="Evidence note" name="evidenceNote">
                    <input className="input" name="evidenceNote" placeholder="What was reviewed" />
                  </Field>
                  <div className="sm:col-span-3">
                    <button className="btn btn-secondary btn-sm" type="submit">Record licence event</button>
                  </div>
                </form>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Names and aliases" subtitle="A name is a claim about identity, not proof of ownership of any system." />
            <CardBody>
              {names.length ? (
                <ul className="space-y-2">
                  {names.map((name: any) => (
                    <li key={name.id} className="text-2xs">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{name.name}</span>
                        <Badge tone="slate">{name.name_type}</Badge>
                        {name.verified ? <Badge tone="green">verified</Badge> : null}
                      </div>
                      <div className="text-[10px] text-[var(--ficap-muted)]">{name.source_name ?? 'source not recorded'} {name.retrieved_at ? `· ${formatDate(name.retrieved_at)}` : ''}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-2xs text-[var(--ficap-muted)]">No alias recorded.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Corporate relationships" subtitle="Mergers, acquisitions and shared platforms are tracked explicitly so ownership is never assumed." />
            <CardBody>
              {relationships.length ? (
                <ul className="space-y-2">
                  {relationships.map((relationship: any) => (
                    <li key={relationship.id} className="text-2xs">
                      <div className="font-medium">{relationship.related_name}</div>
                      <div className="text-[10px] text-[var(--ficap-muted)]">
                        {String(relationship.relationship).replace(/_/g, ' ')}
                        {relationship.effective_at ? ` · effective ${formatDate(relationship.effective_at)}` : ''}
                      </div>
                      {relationship.notes ? <p className="mt-0.5 text-[10px] leading-snug">{relationship.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-2xs text-[var(--ficap-muted)]">No relationship recorded.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Open reconciliation items" />
            <CardBody>
              {queue.length ? (
                <ul className="space-y-2">
                  {queue.map((item: any) => (
                    <li key={item.id} className="text-2xs">
                      <div className="flex items-center gap-2"><Badge tone={item.priority === 'high' ? 'red' : 'amber'}>{item.priority}</Badge><span>{String(item.item_type).replace(/_/g, ' ')}</span></div>
                      <p className="mt-0.5 leading-snug">{item.summary}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-2xs text-[var(--ficap-muted)]">Nothing open for this institution.</p>}
            </CardBody>
          </Card>

          <DataQualityNote>
            Registry membership is not an authorisation. Active testing needs an approved engagement with documented authorisation, validated scope, permitted
            methods, an approved window and safeguards. Discovery stays read-only and never triggers scanning.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
