import Link from 'next/link';
import { pageContext, query, flashFrom } from '@/lib/page-context';
import { DIGITAL_ASSET_TYPES, ASSET_STATUS_LABELS, listDigitalAssets } from '@/lib/domain/registry';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, Flash, StatCard, DataQualityNote, EmptyState, formatDate } from '@/components/ui';
import { verifyAssetAction } from '@/app/actions/registry';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

export default async function AssetInventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('institution:read');
  const flash = flashFrom(params);
  const one = (key: string) => (Array.isArray(params[key]) ? (params[key] as string[])[0] : (params[key] as string | undefined));

  const assets = await query(ctx, (tx) =>
    listDigitalAssets(tx, ctx, { status: one('status'), assetType: one('type') }),
  );

  const verified = assets.filter((asset: any) => asset.status === 'ownership_verified');
  const candidates = assets.filter((asset: any) => asset.status === 'candidate' || asset.status === 'unverified');
  const highSensitivity = assets.filter((asset: any) => ['admin_portal', 'core_banking_interface', 'shared_infrastructure'].includes(asset.asset_type));

  return (
    <>
      <PageHeader
        title="Digital asset inventory"
        description="Every system recorded against an institution, with its ownership verification state. Inventory is descriptive: it does not schedule, authorise or discover anything by itself."
        meta={<Badge tone="slate">{ctx.mode === 'demo' ? 'Synthetic demonstration records' : 'Live records'}</Badge>}
        actions={<Link href="/registry" className="btn btn-secondary">Institution registry</Link>}
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Assets recorded" value={assets.length} hint="Across institutions in your scope" tone="navy" />
        <StatCard label="Ownership verified" value={verified.length} hint="Evidence recorded and reviewed by an assessor" tone="green" />
        <StatCard label="Awaiting verification" value={candidates.length} hint="Cannot be referenced by an engagement" tone={candidates.length ? 'amber' : 'slate'} />
        <StatCard label="High-sensitivity assets" value={highSensitivity.length} hint="Admin portals, core banking and shared infrastructure" tone={highSensitivity.length ? 'red' : 'slate'} />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recorded assets"
          subtitle="A candidate or unverified asset is not the institution’s by assumption. Ownership needs recorded evidence; a name, domain or certificate is not evidence."
          actions={
            <form method="get" className="flex flex-wrap items-end gap-2">
              <label>
                <span className="label">Type</span>
                <select className="input w-44 text-2xs" name="type" defaultValue={one('type') ?? ''}>
                  <option value="">All types</option>
                  {DIGITAL_ASSET_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Ownership</span>
                <select className="input w-40 text-2xs" name="status" defaultValue={one('status') ?? ''}>
                  <option value="">Any</option>
                  <option value="ownership_verified">Verified</option>
                  <option value="candidate">Candidate</option>
                  <option value="unverified">Unverified</option>
                  <option value="ownership_rejected">Rejected</option>
                  <option value="retired">Retired</option>
                </select>
              </label>
              <button className="btn btn-primary btn-sm" type="submit">Filter</button>
            </form>
          }
        />
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Institution</th>
                <th>Type</th>
                <th>Environment</th>
                <th>Ownership</th>
                <th>Linked engagements</th>
                <th>Verify</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset: any) => (
                <tr key={asset.id}>
                  <td>
                    <div className="text-2xs font-medium">{asset.display_name}</div>
                    <div className="mt-0.5 break-all font-mono text-[10px] text-[var(--ficap-muted)]">{asset.identifier}</div>
                    {asset.application_name ? <div className="mt-0.5 text-[10px] text-[var(--ficap-muted)]">application: {asset.application_name}</div> : null}
                  </td>
                  <td className="text-2xs"><Link href={`/registry/${asset.institution_id}`} className="link">{asset.institution_name}</Link></td>
                  <td className="text-2xs">{DIGITAL_ASSET_TYPES.find((type) => type.key === asset.asset_type)?.label ?? asset.asset_type}</td>
                  <td className="text-2xs">{asset.environment}</td>
                  <td className="text-2xs">
                    <Badge tone={asset.status === 'ownership_verified' ? 'green' : asset.status === 'ownership_rejected' ? 'red' : 'amber'}>
                      {asset.status === 'ownership_verified' ? 'verified' : asset.status === 'ownership_rejected' ? 'rejected' : asset.status === 'retired' ? 'retired' : 'unverified'}
                    </Badge>
                    <div className="mt-0.5 text-[10px] text-[var(--ficap-muted)]">{ASSET_STATUS_LABELS[asset.status] ?? asset.status}</div>
                    {asset.verified_at ? <div className="text-[10px] text-[var(--ficap-muted)]">{formatDate(asset.verified_at)}</div> : null}
                  </td>
                  <td className="text-right font-mono text-2xs">{asset.engagements_linked}</td>
                  <td>
                    <form action={verifyAssetAction} className="space-y-1">
                      <Csrf />
                      <input type="hidden" name="assetId" value={asset.id} />
                      <input type="hidden" name="institutionId" value={asset.institution_id} />
                      <input className="input w-44 text-2xs" name="evidence" placeholder="Evidence reviewed (≥20 chars)" required minLength={20} />
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-xs" name="decision" value="verified" type="submit">Verify</button>
                        <button className="btn btn-ghost btn-xs text-risk-critical" name="decision" value="rejected" type="submit">Reject</button>
                      </div>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {!assets.length ? (
          <CardBody>
            <EmptyState
              title="No asset matches these filters"
              description="Assets are recorded per institution from the registry detail page. Nothing is discovered or created automatically."
              action={<Link href="/registry" className="btn btn-secondary btn-sm">Open institution registry</Link>}
            />
          </CardBody>
        ) : null}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Asset classes covered" subtitle="The inventory distinguishes systems that carry different risk and different authorisation needs." />
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-2">
              {DIGITAL_ASSET_TYPES.map((type) => {
                const count = assets.filter((asset: any) => asset.asset_type === type.key).length;
                return (
                  <li key={type.key} className="rounded border border-[var(--ficap-border)] px-2.5 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-2xs font-medium">{type.label}</span>
                      <span className="font-mono text-2xs text-[var(--ficap-muted)]">{count}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-[var(--ficap-muted)]">{type.hint}</p>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
        <DataQualityNote>
          Read-only discovery is separate from active assessment. A newly discovered asset, a related company, a third-party provider or shared infrastructure is
          never scanned automatically and never treated as in scope because it appears related.
        </DataQualityNote>
      </div>
    </>
  );
}
