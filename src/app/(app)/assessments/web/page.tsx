import Link from 'next/link';
import { pageContext, query, canDo, param } from '@/lib/page-context';
import { loadModuleView } from '@/lib/domain/modules';
import { WEB_CHECKS, WEB_MANUAL_TESTS, WSTG_VERSION } from '@/lib/engines/web';
import { AssessmentModule, type ManualRow } from '@/components/assessment-module';

export const dynamic = 'force-dynamic';

const MANUAL_PREREQUISITES: Record<string, string> = {
  'WSTG-ATHN-02': 'Requires approved synthetic credentials for the test account.',
  'WSTG-ATHN-03': 'Requires an approved test account and a bounded attempt budget.',
  'WSTG-ATHN-04': 'Requires approved synthetic credentials and a session policy to review.',
  'WSTG-ATHN-05': 'Requires access to the authentication configuration or an approved test identity set.',
  'WSTG-ATHN-07': 'Requires approved synthetic credentials and identity provisioning evidence.',
  'WSTG-ATHN-09': 'Requires two approved synthetic accounts and an authenticated session.',
  'WSTG-ATHZ-01': 'Requires several approved role sets to compare access.',
  'WSTG-ATHZ-02': 'Requires two approved identities and synthetic objects.',
  'WSTG-ATHZ-03': 'Requires approved identities covering each privileged role.',
  'WSTG-ATHZ-04': 'Requires two approved synthetic identities and synthetic object identifiers.',
  'WSTG-ATHZ-05': 'Requires approved OAuth/OIDC client configuration for the test environment.',
  'WSTG-SESS-03': 'Requires two approved identities to test session fixation behaviour.',
  'WSTG-SESS-04': 'Requires an approved session lifecycle test window.',
  'WSTG-SESS-06': 'Requires the logout and revocation behaviour to be observable on the test environment.',
  'WSTG-SESS-07': 'Requires the session timeout policy provided by the institution.',
};

export default async function WebAssessmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('engagement:read');
  const applicationId = param(params, 'applicationId');
  const view = await query(ctx, (tx) => loadModuleView(tx, ctx, { module: 'web', frameworkKeys: ['owasp-wstg', 'owasp-api-top10', 'nist-csf'], applicationId }));

  const manual: ManualRow[] = WEB_MANUAL_TESTS.map((code) => ({ code, prerequisite: MANUAL_PREREQUISITES[code] ?? 'Requires an approved test identity or configuration evidence.' }));

  return (
    <AssessmentModule
      moduleKey="web"
      title="Web application assessment"
      description="WSTG-informed, non-destructive checks against in-scope web and administrative channels. Executed only for an approved engagement with an approved plan."
      frameworkNote={
        <p>
          Checks map to OWASP Web Security Testing Guide v{WSTG_VERSION} identifiers and, where defensible, to NIST CSF 2.0 outcomes and the OWASP API
          Security Top 10. Identifiers are recorded with the framework version used at the time so a later catalogue update never rewrites history.
        </p>
      }
      checks={WEB_CHECKS.map((check) => ({
        key: check.key,
        title: check.title,
        frameworkItemCode: check.frameworkItemCode,
        frameworkKey: check.frameworkKey,
        automation: check.automation,
        requires: check.requires,
      }))}
      manualTests={manual}
      prerequisites={[
        { label: 'Approved engagement scope', met: Boolean(applicationId), detail: applicationId ? 'Filtered to the selected application' : 'Select an application to narrow the view' },
        { label: 'Network access to the target', met: false, detail: 'The sandbox does not reach institution hosts; requests are recorded as blocked or failed with the reason.' },
        { label: 'Synthetic test identities', met: false, detail: 'Required for authenticated and authorisation cases. Never request customer credentials.' },
        { label: 'Approved testing window', met: true, detail: 'Enforced from the engagement authorisation record' },
      ]}
      applications={view.applications}
      selectedApplication={applicationId}
      results={view.results}
      lastJob={view.lastJob}
      actions={
        <>
          {applicationId ? <Link href={`/applications/${applicationId}`} className="btn btn-secondary">Application</Link> : null}
          {canDo(ctx, 'engagement:create') ? <Link href="/engagements/new" className="btn btn-primary">New engagement</Link> : null}
        </>
      }
      scopeNote={
        <p className="text-2xs text-[var(--ficap-muted)]">
          Destructive input testing, denial of service and uncontrolled credential guessing are not implemented. Injection and business-logic checks
          require an approved test identity and are recorded as blocked until the prerequisite is supplied.
        </p>
      }
    />
  );
}
