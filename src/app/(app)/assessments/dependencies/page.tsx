import Link from 'next/link';
import { pageContext, query, canDo, param } from '@/lib/page-context';
import { loadModuleView } from '@/lib/domain/modules';
import { dependencyChecks } from '@/lib/engines/deps';
import { CURATED_CORPUS, CURATED_PROVENANCE } from '@/lib/engines/vuln-intel';
import { AssessmentModule } from '@/components/assessment-module';
import { withSystem } from '@/lib/db/pool';
import { Badge, Card, CardBody, CardHeader, TableWrap, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DependencyAssessmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('engagement:read');
  const applicationId = param(params, 'applicationId');
  const view = await query(ctx, (tx) => loadModuleView(tx, ctx, { module: 'dependencies', frameworkKeys: ['owasp-masvs', 'nist-csf'], applicationId }));

  const scans = await withSystem((tx) =>
    tx.query(
      `SELECT ds.*, (SELECT count(*)::int FROM dependencies d WHERE d.scan_id = ds.id) AS dependency_count,
              (SELECT count(*)::int FROM dependencies d WHERE d.scan_id = ds.id AND d.status = 'vulnerable') AS vulnerable_count
         FROM dependency_scans ds ${applicationId ? 'WHERE ds.application_id = $1' : ''}
        ORDER BY ds.created_at DESC LIMIT 20`,
      applicationId ? [applicationId] : [],
    ),
  );
  const manifests = await withSystem((tx) =>
    tx.query(
      `SELECT id, filename, kind, size_bytes, uploaded_at, application_id FROM artifacts
        WHERE kind IN ('zip','source','other','osv_db') ${applicationId ? 'AND application_id = $1' : ''}
        ORDER BY uploaded_at DESC LIMIT 10`,
      applicationId ? [applicationId] : [],
    ),
  );

  const checks = dependencyChecks(
    async () => ({ dependencies: [], sources: [], secrets: [], licenses: [], notes: [] }),
    { corpus: CURATED_CORPUS, provenance: CURATED_PROVENANCE, notes: [] },
  );

  const updatedAt = new Date(CURATED_PROVENANCE.updatedAt || Date.now()).getTime();
  const intelFresh = Date.now() - updatedAt < 180 * 86400000;

  return (
    <div className="space-y-4">
      <AssessmentModule
        moduleKey="dependencies"
        title="Dependency and supply-chain analysis"
        description="Inventory of third-party components from lockfiles, manifests and archives, matched against a dated vulnerability intelligence snapshot. A vulnerability identifier never establishes exploitability on its own."
        frameworkNote={
          <p>
            Checks align to NIST CSF 2.0 ID.RA (risk assessment) and PR.PS (platform security) outcomes and to MASVS-CODE-3 for third-party component
            hygiene. Every result carries the intelligence source, its update time and the fixed version where one is known.
          </p>
        }
        checks={checks.map((check) => ({
          key: check.key,
          title: check.title,
          frameworkItemCode: check.frameworkItemCode,
          frameworkKey: check.frameworkKey,
          automation: check.automation,
          requires: check.requires,
        }))}
        manualTests={[]}
        prerequisites={[
          { label: 'Manifest, lockfile or source bundle uploaded', met: manifests.length > 0, detail: manifests.length ? `${manifests.length} candidate artefact(s)` : 'Upload package-lock.json, requirements.txt, pom.xml, build.gradle, Podfile.lock or go.mod' },
          { label: 'Vulnerability intelligence snapshot', met: intelFresh, detail: `${CURATED_PROVENANCE.source} · ${CURATED_PROVENANCE.recordCount} records · updated ${CURATED_PROVENANCE.updatedAt}` },
          { label: 'Licence inventory', met: true, detail: 'Licence obligations are reported as observations, not legal advice' },
          { label: 'Exploitation testing', met: false, detail: 'Never performed. Component versions are evidence; exploitation requires separate authorisation and is out of platform scope.' },
        ]}
        applications={view.applications}
        selectedApplication={applicationId}
        results={view.results}
        lastJob={view.lastJob}
        actions={
          <>
            {applicationId ? <Link href={`/applications/${applicationId}`} className="btn btn-secondary">Application</Link> : null}
            {canDo(ctx, 'evidence:create') && applicationId ? <Link href={`/applications/${applicationId}`} className="btn btn-primary">Upload manifest</Link> : null}
          </>
        }
        scopeNote={
          <p className="text-2xs text-[var(--ficap-muted)]">
            Intelligence reliability is {CURATED_PROVENANCE.reliable ? 'rated sufficient' : 'limited'}. {CURATED_PROVENANCE.note} When intelligence is
            unavailable the platform reports the gap and refuses to declare the estate clean.
          </p>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Intelligence snapshot"
            subtitle="Provenance is attached to every match so a finding can be defended years later."
            actions={<Badge tone={intelFresh ? 'green' : 'amber'}>{intelFresh ? 'current' : 'stale'}</Badge>}
          />
          <CardBody>
            <dl className="kv">
              <dt>Source</dt>
              <dd>{CURATED_PROVENANCE.source}</dd>
              <dt>Updated</dt>
              <dd>{formatDate(CURATED_PROVENANCE.updatedAt)}</dd>
              <dt>Records</dt>
              <dd>{CURATED_PROVENANCE.recordCount}</dd>
              <dt>Known exploited included</dt>
              <dd>{CURATED_CORPUS.filter((record) => record.knownExploited).length}</dd>
              <dt>Note</dt>
              <dd className="text-2xs">{CURATED_PROVENANCE.note}</dd>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent dependency scans" subtitle="Each scan stores its source type, intelligence timestamp and per-component status." />
          {scans.length ? (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Source</th><th>Type</th><th>Components</th><th>Vulnerable</th><th>When</th></tr></thead>
                <tbody>
                  {scans.map((scan: any) => (
                    <tr key={scan.id}>
                      <td className="text-2xs">{scan.source_name}</td>
                      <td className="text-2xs">{scan.source_type}</td>
                      <td className="text-right font-mono text-2xs">{scan.dependency_count}</td>
                      <td className="text-right font-mono text-2xs">{scan.vulnerable_count}</td>
                      <td className="whitespace-nowrap text-2xs">{formatDate(scan.created_at, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody><p className="prose-note">No dependency scan has run for the selected scope.</p></CardBody>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Candidate artefacts" subtitle="Archives and manifests uploaded for the selected application." />
        {manifests.length ? (
          <TableWrap>
            <table className="table">
              <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Uploaded</th></tr></thead>
              <tbody>
                {manifests.map((artifact: any) => (
                  <tr key={artifact.id}>
                    <td className="font-mono text-2xs">{artifact.filename}</td>
                    <td className="uppercase text-2xs">{artifact.kind}</td>
                    <td className="font-mono text-2xs">{Math.round(Number(artifact.size_bytes) / 1024)} KB</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(artifact.uploaded_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><p className="prose-note">No manifest or archive uploaded for this scope.</p></CardBody>
        )}
      </Card>
    </div>
  );
}
