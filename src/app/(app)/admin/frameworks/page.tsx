import Link from 'next/link';
import { pageContext, query, flashFrom } from '@/lib/page-context';
import { listFrameworks } from '@/lib/domain/frameworks';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, Field, Flash, DataQualityNote, formatDate } from '@/components/ui';
import { importCatalogueAction, verifyFrameworkAction } from '@/app/actions/admin';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

export default async function FrameworkAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('framework:manage');
  const flash = flashFrom(params);

  const frameworks = await query(ctx, async (tx) => {
    const rows = await listFrameworks(tx);
    const usage = await tx.query<any>(
      `SELECT framework_key, framework_version, count(*)::int AS results
         FROM test_results GROUP BY 1,2`,
    );
    return rows.map((row: any) => ({
      ...row,
      results: usage.find((u: any) => u.framework_key === row.key && u.framework_version === row.version)?.results ?? 0,
    }));
  });

  const pending = frameworks.filter((row: any) => row.verification_status !== 'verified');

  return (
    <>
      <PageHeader
        title="Framework catalogue management"
        description="Official catalogues are imported and versioned. Importing a new version never rewrites results recorded against an earlier version."
        meta={
          <>
            <Badge tone="slate">{frameworks.length} catalogue versions</Badge>
            <Badge tone="amber">{pending.length} awaiting official verification</Badge>
          </>
        }
        actions={<Link href="/frameworks" className="btn btn-secondary">Coverage view</Link>}
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Catalogues" subtitle="Item counts reflect what is stored, not what is claimed. Seeded identifiers are marked pending until the official publication is imported." />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Framework</th><th>Version</th><th>Publisher</th><th>Items</th><th>Pending</th><th>Results recorded</th><th>Verification</th><th /></tr></thead>
                <tbody>
                  {frameworks.map((framework: any) => (
                    <tr key={framework.id}>
                      <td className="text-2xs"><div className="font-medium">{framework.name}</div><div className="font-mono text-[10px] text-[var(--ficap-muted)]">{framework.key}</div></td>
                      <td className="font-mono text-2xs">{framework.version}</td>
                      <td className="text-2xs">{framework.publisher}</td>
                      <td className="text-right font-mono text-2xs">{framework.item_count}</td>
                      <td className="text-right font-mono text-2xs">{framework.pending_items || '·'}</td>
                      <td className="text-right font-mono text-2xs">{framework.results}</td>
                      <td className="text-2xs">
                        <Badge tone={framework.verification_status === 'verified' ? 'green' : framework.verification_status === 'imported' ? 'navy' : 'amber'}>
                          {String(framework.verification_status).replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="text-right">
                        {framework.verification_status !== 'verified' ? (
                          <form action={verifyFrameworkAction}>
                            <Csrf />
                            <input type="hidden" name="frameworkId" value={framework.id} />
                            <button className="btn btn-ghost btn-xs" type="submit">Mark verified</button>
                          </form>
                        ) : <span className="text-2xs text-[var(--ficap-muted)]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <Card>
            <CardHeader title="Import an official catalogue" subtitle="Provide the published JSON. Each item must carry a code, title and item type; unknown shapes are rejected before anything is written." />
            <CardBody>
              <form action={importCatalogueAction} className="space-y-2">
                <Csrf />
                <Field
                  label="Catalogue JSON"
                  name="payload"
                  required
                  hint='Shape: {"key":"owasp-wstg","name":"…","version":"4.2","publisher":"OWASP","sourceUrl":"…","items":[{"code":"WSTG-…","title":"…","itemType":"test","automation":"manual","objective":"…"}]}'
                >
                  <textarea name="payload" rows={10} className="input font-mono text-2xs" required placeholder={'{\n  "key": "owasp-wstg",\n  "name": "OWASP Web Security Testing Guide",\n  "version": "4.2",\n  "publisher": "OWASP Foundation",\n  "items": [ ... ]\n}'} />
                </Field>
                <button className="btn btn-primary btn-sm" type="submit">Validate and import</button>
              </form>
              <p className="mt-2 text-2xs text-[var(--ficap-muted)]">
                Importing a version that already exists creates a new record only if the version string differs. Existing test results keep their original
                framework key and version.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Import rules" />
            <CardBody>
              <ul className="space-y-1 text-2xs leading-relaxed text-[var(--ficap-muted)]">
                <li>· Only official publications are imported; identifiers are never invented.</li>
                <li>· A catalogue import is versioned and audited with the importing administrator.</li>
                <li>· Historical results retain the version they used — no silent rewrite.</li>
                <li>· Mapping additions require a stated rationale and are stored per finding.</li>
                <li>· An item marked pending import is displayed as such wherever it appears.</li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Catalogue provenance" />
            <CardBody>
              <ul className="space-y-2 text-2xs">
                {frameworks.map((framework: any) => (
                  <li key={`p-${framework.id}`}>
                    <div className="font-medium">{framework.name} {framework.version}</div>
                    <div className="text-[var(--ficap-muted)]">
                      {framework.source_url ? <a className="link" href={framework.source_url} target="_blank" rel="noreferrer noopener">{framework.source_url}</a> : 'source not recorded'}
                    </div>
                    <div className="text-[10px] text-[var(--ficap-muted)]">stored {formatDate(framework.created_at)} · {framework.notes ?? 'no note'}</div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <DataQualityNote>
            If an official catalogue cannot be obtained, the platform keeps the identifiers it already stores and labels them pending. It never fabricates control
            identifiers or scoring rules to fill a gap.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
