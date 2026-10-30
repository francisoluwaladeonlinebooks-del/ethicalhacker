import Link from 'next/link';
import { pageContext, query, param } from '@/lib/page-context';
import { findingsByFramework, listMappings } from '@/lib/domain/frameworks';
import { frameworkDashboard } from '@/lib/domain/analytics';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, EmptyState, DataQualityNote, Bar } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUS_COPY: Record<string, string> = {
  passed: 'Executed, no issue observed',
  failed: 'Executed, weakness observed',
  needs_verification: 'Observed, awaiting assessor confirmation',
  blocked: 'Not executed — prerequisite or capability unavailable',
  error: 'Attempted, no reliable result',
  not_assessed: 'Not executed in this engagement',
  not_applicable: 'Recorded as not applicable, with a reason',
};

export default async function FrameworksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('framework:read');
  const key = param(params, 'key');

  const data = await query(ctx, async (tx) => {
    const [dashboard, mappings] = await Promise.all([frameworkDashboard(tx, ctx), listMappings(tx)]);
    const linked = await findingsByFramework(tx, ctx);
    const items = key
      ? await tx.query<any>(
          `SELECT fi.code, fi.title, fi.item_type, fi.automation, fi.verification_status, fi.parent_code,
                  (SELECT count(*)::int FROM test_results tr WHERE tr.framework_key = f.key AND tr.framework_item_code = fi.code) AS executions,
                  (SELECT count(*)::int FROM test_results tr WHERE tr.framework_key = f.key AND tr.framework_item_code = fi.code AND tr.status = 'failed') AS failures
             FROM framework_items fi JOIN frameworks f ON f.id = fi.framework_id
            WHERE f.key = $1 ORDER BY fi.sort_order, fi.code`,
          [key],
        )
      : [];
    const framework = key ? await tx.queryOne<any>('SELECT * FROM frameworks WHERE key = $1 ORDER BY created_at DESC LIMIT 1', [key]) : null;
    return { dashboard, mappings, linked, items, framework };
  });

  const catalogue: any[] = data.dashboard.catalogue ?? [];
  const results: any[] = data.dashboard.results ?? [];

  return (
    <>
      <PageHeader
        title="Framework coverage"
        description="Catalogues are version-pinned. Results retain the version in force when they were recorded, so a later update never rewrites history."
        meta={<><Badge tone="slate">{catalogue.length} catalogue versions</Badge><Badge tone="amber">{catalogue.filter((row) => row.verification_status !== 'verified').length} pending official verification</Badge></>}
        actions={key ? <Link href="/frameworks" className="btn btn-secondary">All frameworks</Link> : null}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Catalogues" subtitle="Item counts come from the stored catalogue. Seeded wording is marked until the official publication is imported." />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Framework</th><th>Version</th><th>Items</th><th>Automated</th><th>Manual</th><th>Verification</th><th /></tr></thead>
                <tbody>
                  {catalogue.map((framework: any) => (
                    <tr key={`${framework.key}-${framework.version}`}>
                      <td className="text-2xs font-medium">{framework.name}</td>
                      <td className="font-mono text-2xs">{framework.version}</td>
                      <td className="text-right font-mono text-2xs">{framework.items}</td>
                      <td className="text-right font-mono text-2xs">{framework.automated}</td>
                      <td className="text-right font-mono text-2xs">{framework.manual}</td>
                      <td className="text-2xs">
                        <Badge tone={framework.verification_status === 'verified' ? 'green' : framework.verification_status === 'imported' ? 'navy' : 'amber'}>
                          {String(framework.verification_status).replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="text-right"><Link className="btn btn-ghost btn-xs" href={`/frameworks?key=${framework.key}`}>Inspect</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          {key ? (
            <Card>
              <CardHeader
                title={`${data.framework?.name ?? key} · ${data.framework?.version ?? ''}`}
                subtitle="Each item shows how often it was executed and how often it failed. An item never executed is not evidence of control effectiveness."
                actions={data.framework?.source_url ? <a className="btn btn-ghost btn-xs" href={data.framework.source_url} target="_blank" rel="noreferrer noopener">Official source</a> : null}
              />
              {data.items.length ? (
                <TableWrap maxHeight="560px">
                  <table className="table">
                    <thead><tr><th>Code</th><th>Title</th><th>Type</th><th>Automation</th><th>Executions</th><th>Failures</th><th>Verification</th></tr></thead>
                    <tbody>
                      {data.items.map((item: any) => (
                        <tr key={item.code}>
                          <td className="whitespace-nowrap font-mono text-2xs">{item.code}</td>
                          <td className="max-w-[30rem] text-2xs">{item.title}</td>
                          <td className="text-2xs capitalize">{item.item_type}</td>
                          <td className="text-2xs">{item.automation ?? '—'}</td>
                          <td className="text-right font-mono text-2xs">{item.executions}</td>
                          <td className={`text-right font-mono text-2xs ${item.failures ? 'text-risk-critical' : ''}`}>{item.failures}</td>
                          <td className="text-2xs">{String(item.verification_status).replace(/_/g, ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <CardBody><p className="prose-note">No item is stored for this catalogue. Import the official publication from platform configuration.</p></CardBody>
              )}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Cross-framework coverage" subtitle="Executed checks by framework and outcome. This is test coverage, not an assurance rating." />
            <CardBody>
              {results.length ? (
                <ul className="space-y-3">
                  {catalogue.map((framework: any) => {
                    const rows = results.filter((row: any) => row.framework_key === framework.key);
                    const total = rows.reduce((sum: number, row: any) => sum + Number(row.count), 0);
                    if (!total) return null;
                    return (
                      <li key={`cov-${framework.key}-${framework.version}`}>
                        <div className="mb-1 flex items-center justify-between text-2xs">
                          <span>{framework.key} <span className="font-mono text-[10px] text-[var(--ficap-muted)]">{framework.version}</span></span>
                          <span className="font-mono">{total} executions</span>
                        </div>
                        <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                          {[
                            ['passed', 'bg-seal-600'],
                            ['failed', 'bg-risk-critical'],
                            ['needs_verification', 'bg-amber-500'],
                            ['blocked', 'bg-slate-400'],
                            ['error', 'bg-slate-600'],
                          ].map(([status, color]) => {
                            const count = rows.filter((row: any) => row.status === status).reduce((sum: number, row: any) => sum + Number(row.count), 0);
                            return count ? <div key={status} className={color} style={{ width: `${(count / total) * 100}%` }} title={`${status}: ${count}`} /> : null;
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="prose-note">No check has executed against a framework item yet.</p>
              )}
              <dl className="mt-4 space-y-1 text-2xs text-[var(--ficap-muted)]">
                {Object.entries(STATUS_COPY).map(([status, copy]) => <div key={status} className="flex gap-2"><dt className="w-40 shrink-0 font-mono">{status}</dt><dd>{copy}</dd></div>)}
              </dl>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Mapped findings" subtitle="Only defensible mappings, each with a rationale." />
            <CardBody>
              {data.linked.length ? (
                <ul className="space-y-2 text-2xs">
                  {data.linked.map((row: any) => (
                    <li key={`${row.framework_key}-${row.item_code}`} className="flex items-start justify-between gap-2 border-b border-dashed border-[var(--ficap-border)] pb-1">
                      <span><span className="font-mono">{row.item_code}</span><div className="text-[var(--ficap-muted)]">{row.framework_key}</div></span>
                      <span className="font-mono">{row.findings}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="prose-note">No finding carries a framework reference yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Mapping integrity" subtitle="Cross-framework relationships are declared once and reused." />
            <CardBody>
              {data.mappings.length ? (
                <TableWrap maxHeight="280px">
                  <table className="table">
                    <thead><tr><th>From</th><th>To</th><th>Relationship</th></tr></thead>
                    <tbody>
                      {data.mappings.slice(0, 40).map((mapping: any, index: number) => (
                        <tr key={index}>
                          <td className="font-mono text-2xs">{mapping.source_key}:{mapping.source_code}</td>
                          <td className="font-mono text-2xs">{mapping.target_key}:{mapping.target_code}</td>
                          <td className="text-2xs">{mapping.relationship}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <EmptyState title="No mapping stored" description="Mappings are added when an official relationship can be justified." />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="CVSS v4.0 reference" subtitle="Base metrics only; Threat and Environmental groups are recorded per finding." />
            <CardBody>
              <ul className="space-y-1 text-2xs text-[var(--ficap-muted)]">
                <li>· Severity bands: None 0.0 · Low 0.1–3.9 · Medium 4.0–6.9 · High 7.0–8.9 · Critical 9.0–10.0.</li>
                <li>· Scores are computed by the platform from the vector; a client-submitted score is ignored.</li>
                <li>· Business context never modifies a CVSS score — see <Link className="link" href="/risk?view=method">risk method</Link>.</li>
                <li>· Official specification: <a className="link" href="https://www.first.org/cvss/v4.0/specification-document" target="_blank" rel="noreferrer noopener">FIRST CVSS v4.0</a>.</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <DataQualityNote>
          A high pass rate is not assurance. Coverage shows what was executed; the findings explorer and the risk workspace show what was concluded. Framework
          identifiers are never invented — items awaiting the official publication are labelled as pending import.
        </DataQualityNote>
      </div>
    </>
  );
}
