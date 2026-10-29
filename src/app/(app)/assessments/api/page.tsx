import Link from 'next/link';
import { pageContext, query, canDo, param } from '@/lib/page-context';
import { loadModuleView } from '@/lib/domain/modules';
import { apiChecks, API_MANUAL_TESTS, API_VERSION } from '@/lib/engines/api';
import { AssessmentModule } from '@/components/assessment-module';
import { Card, CardBody, CardHeader, Badge, TableWrap } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ApiAssessmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('engagement:read');
  const applicationId = param(params, 'applicationId');
  const view = await query(ctx, (tx) => loadModuleView(tx, ctx, { module: 'api', frameworkKeys: ['owasp-api-top10', 'owasp-wstg', 'nist-csf'], applicationId }));
  const endpoints = applicationId
    ? await query(ctx, (tx) =>
        tx.query(
          `SELECT method, path, auth_required, spec_source, coverage_status, last_tested_at
             FROM api_endpoints WHERE application_id = $1 ORDER BY path, method LIMIT 200`,
          [applicationId],
        ),
      )
    : [];

  const checks = apiChecks(() => null);
  const tested = endpoints.filter((row: any) => row.coverage_status === 'tested').length;
  const blocked = endpoints.filter((row: any) => row.coverage_status === 'blocked').length;

  return (
    <div className="space-y-4">
      <AssessmentModule
        moduleKey="api"
        title="API security assessment"
        description="Specification-driven API review aligned to the OWASP API Security Top 10 (2023). Object and function level authorisation are the highest-value banking risks and require two approved synthetic identities."
        frameworkNote={
          <p>
            Category identifiers follow the 2023 edition of the OWASP API Security Top 10 (v{API_VERSION}) and are never mixed with the 2019 edition.
            Related WSTG and NIST CSF references are added only where the mapping is defensible.
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
        manualTests={API_MANUAL_TESTS}
        prerequisites={[
          { label: 'OpenAPI or Postman specification imported', met: endpoints.length > 0, detail: endpoints.length ? `${endpoints.length} endpoints inventoried` : 'Import the specification on the application page' },
          { label: 'Two approved synthetic identities', met: false, detail: 'Required for BOLA and BFLA cases. Blocked until the institution provisions them.' },
          { label: 'Sandbox environment for business flows', met: false, detail: 'API6 business-flow testing requires sandbox transactions; real money movement is prohibited.' },
          { label: 'Approved outbound canary for SSRF', met: false, detail: 'Internal service probing is prohibited; API7 is blocked without an approved canary.' },
        ]}
        applications={view.applications}
        selectedApplication={applicationId}
        results={view.results}
        lastJob={view.lastJob}
        actions={
          <>
            {applicationId ? <Link href={`/applications/${applicationId}`} className="btn btn-secondary">Application</Link> : null}
            {canDo(ctx, 'application:write') && applicationId ? <Link href={`/applications/${applicationId}`} className="btn btn-primary">Import specification</Link> : null}
          </>
        }
        scopeNote={
          <p className="text-2xs text-[var(--ficap-muted)]">
            Unauthenticated access checks sample at most 25 safe GET operations and record the status only. Response bodies are redacted before storage.
            No authentication bypass, token forgery or rate-limit exhaustion is attempted.
          </p>
        }
      />

      {applicationId ? (
        <Card>
          <CardHeader
            title="Endpoint coverage matrix"
            subtitle={`${endpoints.length} endpoints · ${tested} tested · ${blocked} blocked`}
            actions={<Badge tone={endpoints.length && tested === endpoints.length ? 'green' : 'amber'}>{endpoints.length ? Math.round((tested / endpoints.length) * 100) : 0}% tested</Badge>}
          />
          <CardBody>
            {endpoints.length ? (
              <TableWrap maxHeight="360px">
                <table className="table">
                  <thead><tr><th>Method</th><th>Path</th><th>Auth required</th><th>Source</th><th>Coverage</th><th>Last tested</th></tr></thead>
                  <tbody>
                    {endpoints.map((endpoint: any) => (
                      <tr key={`${endpoint.method}-${endpoint.path}`}>
                        <td className="font-mono text-2xs font-semibold">{endpoint.method}</td>
                        <td className="font-mono text-2xs">{endpoint.path}</td>
                        <td className="text-2xs">{endpoint.auth_required === null ? 'unknown' : endpoint.auth_required ? 'yes' : 'no'}</td>
                        <td className="text-2xs">{endpoint.spec_source}</td>
                        <td className="text-2xs capitalize">{endpoint.coverage_status.replace(/_/g, ' ')}</td>
                        <td className="whitespace-nowrap text-2xs">{endpoint.last_tested_at ? new Date(endpoint.last_tested_at).toISOString().slice(0, 10) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <p className="prose-note">No specification has been imported for this application, so endpoint coverage cannot be measured.</p>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
