import Link from 'next/link';
import { pageContext, query, flashFrom } from '@/lib/page-context';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, Flash, DescriptionList, DataQualityNote, Field, formatDate } from '@/components/ui';
import { importRegistryAction } from '@/app/actions/registry';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

export default async function RegistryImportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('institution:write');
  const flash = flashFrom(params);

  const imports = await query(ctx, async (tx) => {
    const rows = await tx.query<any>(
      `SELECT r.*, u.name AS imported_by_name
         FROM registry_imports r LEFT JOIN users u ON u.id = r.imported_by
        ORDER BY r.created_at DESC LIMIT 50`,
    );
    const queued = await tx.query<any>(
      `SELECT item_type, count(*)::int AS count FROM registry_verification_queue
        WHERE status IN ('open','in_review') GROUP BY item_type ORDER BY count DESC`,
    );
    return { rows, queued };
  });

  return (
    <>
      <PageHeader
        title="Registry imports and reconciliation"
        description="Official regulator lists are imported with their source, retrieval time and a full reconciliation report. Imports never create digital assets, never delete records and never schedule testing."
        meta={<Badge tone="slate">{ctx.mode === 'demo' ? 'Demonstration dataset' : 'Live records'}</Badge>}
        actions={<Link href="/registry" className="btn btn-secondary">Institution registry</Link>}
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Import an official list" subtitle="Accept a regulator-supplied CSV (with a header row) or JSON array. Unknown licence categories are rejected rather than guessed." />
          <CardBody>
            <form action={importRegistryAction} className="space-y-2">
              <Csrf />
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Official source" name="sourceName" required hint="e.g. “CBN list of licensed institutions, July 2026”">
                  <input className="input" name="sourceName" required placeholder="Regulator publication title" />
                </Field>
                <Field label="Source URL" name="sourceUrl">
                  <input className="input" name="sourceUrl" placeholder="https://…" />
                </Field>
                <Field label="Regulator" name="regulator">
                  <select className="input" name="regulator" defaultValue="CBN">
                    <option value="CBN">CBN</option>
                    <option value="NDIC">NDIC</option>
                    <option value="SEC">SEC</option>
                    <option value="NAICOM">NAICOM</option>
                    <option value="PenCom">PenCom</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
                <Field label="Format" name="format">
                  <select className="input" name="format" defaultValue="csv">
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                </Field>
                <Field label="Retrieved at" name="retrievedAt" hint="UTC timestamp of retrieval. Defaults to import time when blank.">
                  <input className="input" name="retrievedAt" type="datetime-local" />
                </Field>
              </div>
              <Field
                label="Payload"
                name="payload"
                required
                hint="CSV columns recognised: code, name, category, regulator, licenceNumber, licenceCategory, licenceStatus, city, state, website, tradingName. JSON: { “institutions”: [ … ] }."
              >
                <textarea className="input min-h-[160px] font-mono text-2xs" name="payload" required placeholder={'code,name,category,regulator,licenceNumber,licenceStatus\nSYN-0001,Example Bank Plc,commercial_bank,CBN,CBN/SYN/0001,active'} />
              </Field>
              <button className="btn btn-primary btn-sm" type="submit">Validate and import</button>
            </form>
            <p className="mt-2 text-2xs leading-relaxed text-[var(--ficap-muted)]">
              A licence category change is never applied silently: the proposed change is queued for a named reviewer to reconcile against the official source. No
              asset is created from an import, and nothing in the import becomes a scan target.
            </p>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Open reconciliation items" />
            <CardBody>
              {imports.queued.length ? (
                <ul className="space-y-1.5">
                  {imports.queued.map((row: any) => (
                    <li key={row.item_type} className="flex items-baseline justify-between text-2xs">
                      <span>{String(row.item_type).replace(/_/g, ' ')}</span>
                      <span className="font-mono text-[var(--ficap-muted)]">{row.count}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-2xs text-[var(--ficap-muted)]">No open items.</p>}
            </CardBody>
          </Card>
          <DataQualityNote>
            An import report is an audit artefact. It records what was changed, what conflicted and what was rejected, so a later reviewer can reconstruct the state
            of the registry at any point.
          </DataQualityNote>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Import history" subtitle="Newest first. Counts are the outcome of that import only." />
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Regulator</th>
                <th>Format</th>
                <th>Retrieved</th>
                <th className="text-right">Rows</th>
                <th className="text-right">Created</th>
                <th className="text-right">Updated</th>
                <th className="text-right">Unchanged</th>
                <th className="text-right">Conflicts</th>
                <th className="text-right">Rejected</th>
                <th>Status</th>
                <th>Imported by</th>
              </tr>
            </thead>
            <tbody>
              {imports.rows.map((row: any) => (
                <tr key={row.id}>
                  <td className="text-2xs">
                    <div className="font-medium">{row.source_name}</div>
                    {row.source_url ? <a className="link break-all text-[10px]" href={row.source_url} target="_blank" rel="noreferrer noopener">{row.source_url}</a> : null}
                  </td>
                  <td className="text-2xs">{row.regulator ?? '—'}</td>
                  <td className="text-2xs uppercase">{row.format}</td>
                  <td className="text-[10px] text-[var(--ficap-muted)]">{row.retrieved_at ? formatDate(row.retrieved_at, true) : formatDate(row.created_at)}</td>
                  <td className="text-right font-mono text-2xs">{row.row_count}</td>
                  <td className="text-right font-mono text-2xs">{row.created_count}</td>
                  <td className="text-right font-mono text-2xs">{row.updated_count}</td>
                  <td className="text-right font-mono text-2xs">{row.unchanged_count}</td>
                  <td className="text-right font-mono text-2xs">{row.conflict_count}</td>
                  <td className="text-right font-mono text-2xs">{row.rejected_count}</td>
                  <td className="text-2xs"><Badge tone={row.status === 'applied' ? 'green' : row.status === 'partial' ? 'amber' : 'red'}>{row.status}</Badge></td>
                  <td className="text-[10px] text-[var(--ficap-muted)]">{row.imported_by_name ?? 'system'}<div>{formatDate(row.created_at)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {!imports.rows.length ? <CardBody><p className="text-2xs text-[var(--ficap-muted)]">No import recorded yet.</p></CardBody> : null}
      </Card>

      {imports.rows.length ? (
        <Card className="mt-4">
          <CardHeader title="Latest reconciliation detail" subtitle={imports.rows[0].source_name} />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Status', value: imports.rows[0].status },
                { label: 'Conflicts', value: (imports.rows[0].report?.conflicts ?? []).length ? <ul className="list-disc pl-4">{(imports.rows[0].report.conflicts as string[]).slice(0, 20).map((line) => <li key={line} className="text-2xs">{line}</li>)}</ul> : 'none' },
                { label: 'Rejected rows', value: (imports.rows[0].report?.rejected ?? []).length ? (imports.rows[0].report.rejected as string[]).slice(0, 20).join('; ') : 'none' },
              ]}
            />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
