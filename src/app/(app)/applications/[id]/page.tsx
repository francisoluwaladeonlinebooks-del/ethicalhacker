import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { pageContext, query, canDo, flashFrom } from '@/lib/page-context';
import { getApplicationDetail, channelLabel } from '@/lib/domain/applications';
import { listArtifacts } from '@/lib/domain/artifacts';
import { uploadArtifactAction, importSpecificationAction } from '@/app/actions/artifacts';
import { CSRF_COOKIE } from '@/lib/db/context';
import { NotFoundError } from '@/lib/errors';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataQualityNote,
  DescriptionList,
  EmptyState,
  Flash,
  PageHeader,
  SeverityBadge,
  StatCard,
  StatusBadge,
  TableWrap,
  formatDate,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

const MODULE_FOR_CHANNEL: Record<string, string[]> = {
  web: ['web', 'api'],
  admin: ['web', 'api'],
  api: ['api'],
  service: ['api'],
  mobile_android: ['mobile', 'dependencies'],
  mobile_ios: ['mobile', 'dependencies'],
  mobile_both: ['mobile', 'dependencies'],
};

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await pageContext('application:read');
  const flash = flashFrom(await searchParams);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';

  let data: any;
  try {
    data = await query(ctx, (tx) => getApplicationDetail(tx, ctx, id));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const artifacts = await query(ctx, (tx) => listArtifacts(tx, ctx, { applicationId: id }));

  const { application, institution, findings, versions, endpoints, engagements, testResults } = data;
  const openFindings = findings.filter((row: any) => !['resolved', 'closed', 'false_positive'].includes(row.status));
  const criticalHigh = openFindings.filter((row: any) => ['critical', 'high'].includes(row.technical_severity));
  const modules = MODULE_FOR_CHANNEL[application.channel] ?? ['web'];
  const testedEndpoints = endpoints.filter((row: any) => row.coverage_status === 'tested').length;
  const blockedEndpoints = endpoints.filter((row: any) => row.coverage_status === 'blocked').length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={application.name}
        description={application.business_purpose ?? 'No business purpose recorded.'}
        meta={
          <>
            <Link href={`/institutions/${institution?.id}`} className="link text-2xs">{institution?.name}</Link>
            <Badge tone="navy">{channelLabel(application.channel)}</Badge>
            <Badge tone={application.environment === 'production' ? 'amber' : 'green'}>{application.environment}</Badge>
            <Badge tone={application.data_sensitivity === 'restricted' ? 'red' : 'neutral'}>{application.data_sensitivity} data</Badge>
            <StatusBadge status={application.status} />
          </>
        }
        actions={
          <>
            {canDo(ctx, 'engagement:create') ? (
              <Link href={`/engagements/new?institutionId=${application.institution_id}&applicationId=${application.id}`} className="btn btn-primary">
                Scope an engagement
              </Link>
            ) : null}
            {modules.map((module) => (
              <Link key={module} href={`/assessments/${module}?applicationId=${application.id}`} className="btn btn-secondary">
                {module} module
              </Link>
            ))}
          </>
        }
      />
      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open findings" value={openFindings.length} tone="amber" />
        <StatCard label="Critical / High" value={criticalHigh.length} tone={criticalHigh.length ? 'red' : 'green'} hint="CVSS v4.0 base severity" />
        <StatCard label="API endpoints inventoried" value={endpoints.length} hint={`${testedEndpoints} tested · ${blockedEndpoints} blocked`} />
        <StatCard label="Artefacts held" value={artifacts.length} hint="Encrypted at rest, hash verified on read" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Application record" subtitle="Technical identifiers used to validate scope and artefact ownership." />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Channel', value: channelLabel(application.channel) },
                { label: 'Web URL', value: application.web_url },
                { label: 'API base URL', value: application.api_base_url },
                { label: 'Package identifier', value: application.package_identifier },
                { label: 'Platform', value: application.mobile_platform },
                { label: 'Version', value: application.version },
                { label: 'Authentication', value: (application.auth_methods ?? []).join(', ') },
                { label: 'Critical processes', value: (application.critical_processes ?? []).join(', ') },
                { label: 'Boundaries', value: application.boundaries },
                { label: 'Known exclusions', value: application.exclusions },
                { label: 'Added', value: formatDate(application.created_at) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Versions recorded" subtitle="Each assessment result is tied to the version observed." />
          <CardBody>
            {versions.length ? (
              <ul className="space-y-2">
                {versions.map((version: any) => (
                  <li key={version.id} className="rounded border border-[var(--ficap-border)] px-2.5 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{version.version}</span>
                      <span className="text-2xs text-[var(--ficap-muted)]">{formatDate(version.released_at)}</span>
                    </div>
                    <p className="mt-0.5 text-2xs text-[var(--ficap-muted)]">{version.notes ?? 'No release notes'}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="prose-note">No versions recorded.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Upload an artefact"
            subtitle="Mobile packages, source bundles, dependency manifests or API specifications. Files are encrypted before storage; the SHA-256 digest is recorded."
          />
          <CardBody>
            {canDo(ctx, 'evidence:create') ? (
              <form action={uploadArtifactAction} encType="multipart/form-data" className="space-y-3">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="applicationId" value={application.id} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="kind">Artefact type</label>
                    <select id="kind" name="kind" className="select mt-1" defaultValue={application.channel.startsWith('mobile') ? 'apk' : 'zip'}>
                      <option value="apk">Android APK</option>
                      <option value="aab">Android App Bundle</option>
                      <option value="ipa">iOS IPA</option>
                      <option value="zip">Source or manifest archive (ZIP)</option>
                      <option value="openapi">OpenAPI specification</option>
                      <option value="postman">Postman collection</option>
                      <option value="osv_db">Vulnerability intelligence dataset</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="file">File</label>
                    <input id="file" name="file" type="file" required className="input mt-1 py-1 text-xs" />
                  </div>
                </div>
                <p className="prose-note">
                  Maximum 20 MB per file. The declared type is verified against the file signature; a mismatch is rejected. Uploads are
                  audited with your identity and the file digest.
                </p>
                <button type="submit" className="btn btn-primary">Upload and analyse</button>
              </form>
            ) : (
              <p className="prose-note">Your role cannot upload artefacts. Ask an assessor to supply the package or manifest.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Import an API specification" subtitle="OpenAPI 2/3 or Postman v2. Endpoints become the coverage matrix for API assessment." />
          <CardBody>
            {canDo(ctx, 'application:write') ? (
              <form action={importSpecificationAction} encType="multipart/form-data" className="space-y-3">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="applicationId" value={application.id} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="specKind">Format</label>
                    <select id="specKind" name="kind" className="select mt-1" defaultValue="openapi">
                      <option value="openapi">OpenAPI (JSON/YAML)</option>
                      <option value="postman">Postman collection</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="spec">Specification file</label>
                    <input id="spec" name="spec" type="file" accept=".json,.yaml,.yml" className="input mt-1 py-1 text-xs" />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="specText">Or paste the document</label>
                  <textarea id="specText" name="specText" rows={4} className="textarea mt-1 font-mono text-2xs" placeholder='{ "openapi": "3.0.3", ... }' />
                </div>
                <button type="submit" className="btn btn-primary">Import endpoints</button>
              </form>
            ) : (
              <p className="prose-note">Your role cannot import specifications.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Artefacts" subtitle="Uploaded packages and documents with their integrity digests." />
        {artifacts.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>SHA-256</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((artifact: any) => (
                  <tr key={artifact.id}>
                    <td className="font-mono text-2xs">{artifact.filename}</td>
                    <td className="uppercase text-2xs">{artifact.kind}</td>
                    <td className="font-mono text-2xs">{(Number(artifact.size_bytes) / 1024).toFixed(0)} KB</td>
                    <td className="font-mono text-[10px] text-[var(--ficap-muted)]" title={artifact.sha256}>{String(artifact.sha256).slice(0, 16)}…</td>
                    <td><StatusBadge status={artifact.status} /></td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(artifact.uploaded_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState title="No artefacts uploaded" description="Mobile and dependency assessment require the signed package, lockfile or manifest. Upload the file the institution actually released." />
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="API endpoint inventory" subtitle="Coverage is recorded per endpoint; untested endpoints are not evidence that the API is secure." actions={<Link href={`/assessments/api?applicationId=${application.id}`} className="btn btn-secondary btn-xs">API module</Link>} />
        {endpoints.length ? (
          <TableWrap maxHeight="360px">
            <table className="table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Auth required</th>
                  <th>Source</th>
                  <th>Coverage</th>
                  <th>Last tested</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint: any) => (
                  <tr key={endpoint.id}>
                    <td className="font-mono text-2xs font-semibold">{endpoint.method}</td>
                    <td className="font-mono text-2xs">{endpoint.path}</td>
                    <td className="text-2xs">{endpoint.auth_required === null ? 'unknown' : endpoint.auth_required ? 'yes' : 'no'}</td>
                    <td className="text-2xs">{endpoint.spec_source}</td>
                    <td><StatusBadge status={endpoint.coverage_status === 'untested' ? 'not_assessed' : endpoint.coverage_status === 'tested' ? 'passed' : endpoint.coverage_status} /></td>
                    <td className="whitespace-nowrap text-2xs">{endpoint.last_tested_at ? formatDate(endpoint.last_tested_at, true) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState title="No API endpoints inventoried" description="Import an OpenAPI or Postman document to build the endpoint coverage matrix." />
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Findings for this application" subtitle="Technical severity is CVSS v4.0; contextual banking risk is recorded separately on each finding." actions={<Link href={`/findings?applicationId=${application.id}`} className="btn btn-secondary btn-xs">Open explorer</Link>} />
        {findings.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding: any) => (
                  <tr key={finding.id}>
                    <td className="font-mono text-2xs">{finding.reference}</td>
                    <td><Link href={`/findings/${finding.id}`} className="link text-xs">{finding.title}</Link></td>
                    <td><SeverityBadge severity={finding.technical_severity} score={finding.cvss_score} /></td>
                    <td><StatusBadge status={finding.status} /></td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(finding.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState title="No findings recorded" description="No assessment has produced findings for this application, or every recorded finding has been resolved. Absence of findings is not proof of effective controls." />
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Framework test results" subtitle="The most recent recorded results for this application." />
        {testResults?.length ? (
          <TableWrap maxHeight="320px">
            <table className="table">
              <thead>
                <tr><th>Framework</th><th>Item</th><th>Check</th><th>Status</th><th>Executed</th></tr>
              </thead>
              <tbody>
                {testResults.slice(0, 40).map((result: any) => (
                  <tr key={result.id}>
                    <td className="text-2xs">{result.framework_key}</td>
                    <td className="font-mono text-2xs">{result.framework_item_code}</td>
                    <td className="font-mono text-[10px] text-[var(--ficap-muted)]">{result.check_key}</td>
                    <td><StatusBadge status={result.status} /></td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(result.executed_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><p className="prose-note">No framework results recorded for this application.</p></CardBody>
        )}
      </Card>

      <DataQualityNote>
        Findings and coverage on this page relate only to activity inside an authorised engagement. Mobile dynamic checks require an approved
        device farm and instrumented build; when those prerequisites are missing the checks are recorded as blocked and excluded from coverage.
      </DataQualityNote>

      <Card>
        <CardHeader title="Engagements covering this application" />
        {engagements.length ? (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Engagement</th><th>Status</th><th>Approved</th></tr></thead>
              <tbody>
                {engagements.map((engagement: any) => (
                  <tr key={engagement.id}>
                    <td><Link href={`/engagements/${engagement.id}`} className="link text-xs">{engagement.name}</Link> <span className="text-2xs text-[var(--ficap-muted)]">{engagement.code}</span></td>
                    <td><StatusBadge status={engagement.status} /></td>
                    <td className="text-2xs">{formatDate(engagement.approved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><p className="prose-note">Not yet included in an authorised engagement.</p></CardBody>
        )}
      </Card>
    </div>
  );
}
