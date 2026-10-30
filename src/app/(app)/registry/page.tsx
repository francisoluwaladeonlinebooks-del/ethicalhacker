import Link from 'next/link';
import { pageContext, query, flashFrom } from '@/lib/page-context';
import { listRegistry, registryOverview } from '@/lib/domain/registry';
import { INSTITUTION_CATEGORIES } from '@/lib/domain/institutions';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, Flash, StatCard, DataQualityNote, EmptyState, formatDate } from '@/components/ui';
import { resolveQueueAction } from '@/app/actions/registry';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

const REGULATORS = ['CBN', 'NDIC', 'SEC', 'NAICOM', 'PenCom', 'Other'];

function staleTone(stale: boolean) {
  return stale ? 'amber' : 'green';
}

export default async function RegistryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('institution:read');
  const flash = flashFrom(params);
  const one = (key: string) => (Array.isArray(params[key]) ? (params[key] as string[])[0] : (params[key] as string | undefined));

  const filters = {
    search: one('search'),
    category: one('category'),
    regulator: one('regulator'),
    licenceStatus: one('licenceStatus'),
    staleOnly: one('stale') === '1',
  };

  const { rows, overview } = await query(ctx, async (tx) => ({
    rows: await listRegistry(tx, ctx, filters),
    overview: await registryOverview(tx, ctx),
  }));

  const total = overview.totals ?? { institutions: 0, stale_institutions: 0, assets: 0, verified_assets: 0, candidate_assets: 0, queue_open: 0, imports: 0 };
  const maxCategory = Math.max(1, ...overview.byCategory.map((row: any) => Number(row.institutions)));

  return (
    <>
      <PageHeader
        title="National institution registry"
        description="Licensed institutions with provenance, licence history and verification state. A registry record describes an entity — it is never an authorisation to test or a list of scan targets."
        meta={
          <>
            <Badge tone="navy">Regulator-sourced</Badge>
            <Badge tone="slate">{ctx.mode === 'demo' ? 'Synthetic demonstration dataset' : 'Live records'}</Badge>
          </>
        }
        actions={
          <>
            <Link href="/registry/assets" className="btn btn-secondary">Digital asset inventory</Link>
            <Link href="/registry/imports" className="btn btn-secondary">Imports and reconciliation</Link>
          </>
        }
      />

      <Flash notice={flash.notice} error={flash.error} />

      {ctx.mode === 'demo' ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-amber-900">Demonstration dataset — not verified real targets</p>
          <p className="mt-1 text-2xs leading-relaxed text-amber-900/90">
            Institution names, licence numbers and digital assets below are synthetic records created for this environment. They are not authoritative
            regulatory records and must never be used as a testing list. In live mode this banner is replaced by the provenance column on each record.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Institutions" value={Number(total.institutions)} hint={`${overview.byCategory.length} licence categories represented`} tone="navy" />
        <StatCard label="Records needing re-verification" value={Number(total.stale_institutions)} hint="Verification older than the record’s staleness window" tone={Number(total.stale_institutions) ? 'amber' : 'green'} />
        <StatCard label="Digital assets" value={Number(total.assets)} hint={`${Number(total.verified_assets)} ownership-verified · ${Number(total.candidate_assets)} candidate`} tone={Number(total.candidate_assets) ? 'amber' : 'green'} />
        <StatCard label="Reconciliation queue" value={Number(total.queue_open)} hint={`${Number(total.imports)} imports recorded`} tone={Number(total.queue_open) ? 'amber' : 'slate'} href="#queue" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader
              title="Institutions"
              subtitle="Filter by licence category, regulator or verification state. Unverified labels are shown explicitly; the platform never assumes a record is current."
              actions={<span className="text-2xs text-[var(--ficap-muted)]">{rows.length} shown</span>}
            />
            <CardBody>
              <form method="get" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <label className="sm:col-span-2">
                  <span className="label">Search</span>
                  <input className="input" type="search" name="search" defaultValue={filters.search ?? ''} placeholder="Name, code, trading name or licence number" />
                </label>
                <label>
                  <span className="label">Category</span>
                  <select className="input" name="category" defaultValue={filters.category ?? ''}>
                    <option value="">All categories</option>
                    {INSTITUTION_CATEGORIES.map((category) => (
                      <option key={category.key} value={category.key}>{category.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">Regulator</span>
                  <select className="input" name="regulator" defaultValue={filters.regulator ?? ''}>
                    <option value="">All regulators</option>
                    {REGULATORS.map((regulator) => (
                      <option key={regulator} value={regulator}>{regulator}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">Verification</span>
                  <select className="input" name="verification" defaultValue={one('verification') ?? ''}>
                    <option value="">Any</option>
                    <option value="verified">Verified</option>
                    <option value="unverified">Unverified</option>
                    <option value="provisional">Provisional (imported)</option>
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-1.5">
                  <input type="checkbox" name="stale" value="1" defaultChecked={filters.staleOnly} className="h-4 w-4 rounded border-slate-300" />
                  <span className="text-2xs">Only records needing re-verification</span>
                </label>
                <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
                  <button className="btn btn-primary btn-sm" type="submit">Apply filters</button>
                  <Link href="/registry" className="btn btn-ghost btn-sm">Clear</Link>
                </div>
              </form>
            </CardBody>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Licence category</th>
                    <th>Regulator</th>
                    <th>Licence status</th>
                    <th>Verification</th>
                    <th className="text-right">Assets</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/registry/${row.id}`} className="link font-medium">{row.name}</Link>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--ficap-muted)]">
                          <span className="font-mono">{row.code}</span>
                          {row.trading_name ? <span>· {row.trading_name}</span> : null}
                          {row.city ? <span>· {row.city}{row.state ? `, ${row.state}` : ''}</span> : null}
                        </div>
                      </td>
                      <td className="text-2xs">{INSTITUTION_CATEGORIES.find((category) => category.key === row.category)?.label ?? row.category}</td>
                      <td className="text-2xs">{row.regulator ?? '—'}</td>
                      <td className="text-2xs">
                        <Badge tone={row.licence_status === 'active' ? 'green' : row.licence_status === 'suspended' || row.licence_status === 'revoked' ? 'red' : 'slate'}>
                          {String(row.licence_status).replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="text-2xs">
                        <Badge tone={row.verification_status === 'verified' ? 'green' : row.verification_status === 'provisional' ? 'amber' : 'slate'}>
                          {String(row.verification_status).replace(/_/g, ' ')}
                        </Badge>
                        <div className={`mt-0.5 text-[10px] ${row.stale ? 'text-amber-700' : 'text-[var(--ficap-muted)]'}`}>
                          {row.last_verified_at ? `verified ${formatDate(row.last_verified_at)}` : 'never verified'}
                        </div>
                      </td>
                      <td className="text-right text-2xs">
                        <span className="font-mono">{row.verified_assets}/{row.asset_count}</span>
                        <div className="text-[10px] text-[var(--ficap-muted)]">verified / recorded</div>
                      </td>
                      <td className="max-w-[180px] text-[10px] leading-snug text-[var(--ficap-muted)]">
                        <div>{row.source_name ?? 'source not recorded'}</div>
                        {row.source_url ? <a className="link break-all" href={row.source_url} target="_blank" rel="noreferrer noopener">{row.source_url.replace(/^https?:\/\//, '')}</a> : null}
                        {row.source_retrieved_at ? <div>retrieved {formatDate(row.source_retrieved_at)}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {!rows.length ? (
              <CardBody>
                <EmptyState title="No institution matches these filters" description="Adjust the filters, or import an official regulator list from the imports page." />
              </CardBody>
            ) : null}
          </Card>

          <div id="queue">
          <Card>
            <CardHeader
              title="Reconciliation queue"
              subtitle="Nothing here is applied automatically. Conflicts, ownership claims and licence changes wait for a named reviewer."
            />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Item</th><th>Type</th><th>Priority</th><th>Raised</th><th>Resolve</th></tr></thead>
                <tbody>
                  {overview.queue.map((item: any) => (
                    <tr key={item.id}>
                      <td className="max-w-[320px]">
                        <div className="text-2xs font-medium">{item.summary}</div>
                        <div className="mt-0.5 text-[10px] leading-snug text-[var(--ficap-muted)]">{item.detail}</div>
                      </td>
                      <td className="text-2xs">{String(item.item_type).replace(/_/g, ' ')}</td>
                      <td><Badge tone={item.priority === 'high' ? 'red' : item.priority === 'medium' ? 'amber' : 'slate'}>{item.priority}</Badge></td>
                      <td className="text-[10px] text-[var(--ficap-muted)]">{formatDate(item.created_at)}</td>
                      <td>
                        <form action={resolveQueueAction} className="flex items-center gap-1">
                          <Csrf />
                          <input type="hidden" name="queueId" value={item.id} />
                          <input className="input w-40 text-2xs" name="note" placeholder="How was this resolved?" aria-label="Resolution note" required />
                          <select className="input w-24 text-2xs" name="decision" aria-label="Decision" defaultValue="resolved">
                            <option value="resolved">Resolved</option>
                            <option value="rejected">Reject</option>
                          </select>
                          <button className="btn btn-ghost btn-xs" type="submit">Close</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {!overview.queue.length ? <CardBody><p className="text-2xs text-[var(--ficap-muted)]">No open reconciliation items.</p></CardBody> : null}
          </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Coverage by licence category" subtitle="Counts describe registry membership only." />
            <CardBody>
              <ul className="space-y-2">
                {overview.byCategory.map((row: any) => (
                  <li key={`${row.category}-${row.regulator}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-2xs">{INSTITUTION_CATEGORIES.find((category) => category.key === row.category)?.label ?? row.category}</span>
                      <span className="font-mono text-2xs text-[var(--ficap-muted)]">{row.institutions}{Number(row.stale) ? ` · ${row.stale} stale` : ''}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-navy-700" style={{ width: `${Math.round((Number(row.institutions) / maxCategory) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent imports" actions={<Link href="/registry/imports" className="btn btn-ghost btn-xs">All imports</Link>} />
            <CardBody>
              {overview.imports.length ? (
                <ul className="space-y-2">
                  {overview.imports.slice(0, 5).map((row: any) => (
                    <li key={row.id} className="text-2xs">
                      <div className="font-medium">{row.source_name}</div>
                      <div className="text-[10px] text-[var(--ficap-muted)]">
                        {row.format.toUpperCase()} · {row.row_count} rows · {row.created_count} new · {row.conflict_count} conflicts · {formatDate(row.created_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-2xs text-[var(--ficap-muted)]">No import has been recorded yet.</p>
              )}
            </CardBody>
          </Card>

          <DataQualityNote>
            Registry membership never implies that an institution operates any particular system, and it never authorises testing. Ownership of a digital asset is
            established only by recorded evidence reviewed by an assessor — not by a name, a domain, a certificate or a DNS record.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
