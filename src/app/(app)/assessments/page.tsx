import Link from 'next/link';
import { pageContext, query, canDo } from '@/lib/page-context';
import { listApplications } from '@/lib/domain/applications';
import { WEB_CHECKS, WEB_MANUAL_TESTS } from '@/lib/engines/web';
import { apiChecks, API_MANUAL_TESTS } from '@/lib/engines/api';
import { mobileChecks, MOBILE_DYNAMIC_TESTS } from '@/lib/engines/mobile';
import { dependencyChecks } from '@/lib/engines/deps';
import { CURATED_PROVENANCE } from '@/lib/engines/vuln-intel';
import { Badge, Card, CardBody, CardHeader, DataQualityNote, PageHeader, StatCard, TableWrap } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AssessmentsHubPage() {
  const ctx = await pageContext('engagement:read');
  const applications = await query(ctx, (tx) => listApplications(tx, ctx, {}));

  const webChecks = WEB_CHECKS;
  const api = apiChecks(() => null);
  const mobile = mobileChecks(async () => null);
  const deps = dependencyChecks(
    async () => ({ dependencies: [], sources: [], secrets: [], licenses: [], notes: [] }),
    { corpus: [], provenance: CURATED_PROVENANCE, notes: [] },
  );

  const modules = [
    {
      key: 'web',
      href: '/assessments/web',
      name: 'Web application assessment',
      checks: webChecks,
      manual: WEB_MANUAL_TESTS.length,
      framework: 'OWASP WSTG 4.2',
      channels: 'Internet banking, administrative panels, customer portals',
      note: 'Configuration, transport, header, cookie and information-disclosure checks. Authentication, authorisation and business logic cases require approved test identities and are recorded as manual.',
    },
    {
      key: 'api',
      href: '/assessments/api',
      name: 'API security assessment',
      checks: api,
      manual: API_MANUAL_TESTS.length,
      framework: 'OWASP API Security Top 10 (2023)',
      channels: 'Open banking APIs, payment APIs, partner integrations',
      note: 'Specification inventory, unauthenticated access sampling and schema checks. Object and function level authorisation require two approved synthetic identities and are recorded as blocked without them.',
    },
    {
      key: 'mobile',
      href: '/assessments/mobile',
      name: 'Mobile application assessment',
      checks: mobile,
      manual: MOBILE_DYNAMIC_TESTS.length,
      framework: 'OWASP MASVS 2.0 + MASTG',
      channels: 'Android APK/AAB and iOS IPA supplied by the institution',
      note: 'Static analysis of manifest, entitlements, secrets, transport configuration and third-party SDKs. Dynamic MASTG cases require an approved device farm and instrumented build; without them they are recorded as blocked.',
    },
    {
      key: 'dependencies',
      href: '/assessments/dependencies',
      name: 'Dependency and supply chain',
      checks: deps,
      manual: 0,
      framework: 'NIST CSF ID.RA / PR.PS, MASVS-CODE-3',
      channels: 'Lockfiles, manifests and source bundles',
      note: `Component inventory matched against a curated vulnerability corpus (${CURATED_PROVENANCE.recordCount} records, updated ${CURATED_PROVENANCE.updatedAt}). A vulnerability identifier alone never establishes exploitability.`,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assessment modules"
        description="Four independently disableable engines. Each module records every check it attempts, blocks checks whose prerequisite is missing, and never reports an unexecuted check as a pass."
        meta={<Badge tone={ctx.mode === 'demo' ? 'amber' : 'green'}>{ctx.mode === 'demo' ? 'demonstration mode' : 'live mode'}</Badge>}
        actions={canDo(ctx, 'engagement:create') ? <Link href="/engagements/new" className="btn btn-primary">New engagement</Link> : null}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Modules" value={modules.length} hint="Independently enabled and disabled by an administrator" />
        <StatCard label="Automated checks" value={modules.reduce((sum, module) => sum + module.checks.length, 0)} tone="navy" />
        <StatCard label="Manual cases with prerequisites" value={modules.reduce((sum, module) => sum + module.manual, 0)} tone="amber" />
        <StatCard label="Applications available" value={applications.length} hint="Scope still has to be approved per engagement" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {modules.map((module) => (
          <Card key={module.key}>
            <CardHeader
              title={module.name}
              subtitle={module.channels}
              actions={<Link href={module.href} className="btn btn-secondary btn-xs">Open module</Link>}
            />
            <CardBody className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="navy">{module.framework}</Badge>
                <Badge tone="green">{module.checks.filter((check) => check.automation !== 'manual').length} automated</Badge>
                <Badge tone="amber">{module.manual} manual cases</Badge>
              </div>
              <p className="text-xs leading-relaxed text-[var(--ficap-text)]">{module.note}</p>
              <details className="rounded border border-[var(--ficap-border)] bg-[#fbfcfd] px-2.5 py-2">
                <summary className="cursor-pointer text-2xs font-semibold text-navy-800">Checks in this module ({module.checks.length})</summary>
                <ul className="mt-1.5 space-y-1">
                  {module.checks.map((check: any) => (
                    <li key={check.key} className="flex items-start justify-between gap-2 text-2xs">
                      <span>{check.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-[var(--ficap-muted)]">{check.frameworkItemCode}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Execution model" subtitle="How a module runs, and what it will refuse to do." />
        <CardBody>
          <TableWrap>
            <table className="table">
              <thead><tr><th>Guarantee</th><th>Behaviour</th></tr></thead>
              <tbody>
                {[
                  ['Scope enforcement', 'Every request is validated against the approved asset list and exclusions immediately before the socket is opened, including every redirect hop.'],
                  ['Rate and volume limits', 'Rate, concurrency, total request budget and duration come from the engagement and are enforced by the client.'],
                  ['No destructive testing', 'No denial of service, stress testing, password spraying, real transactions or customer data access is implemented anywhere in the platform.'],
                  ['Honest outcomes', 'Blocked, skipped and errored checks are persisted with a reason and excluded from coverage statements.'],
                  ['Evidence integrity', 'Captured evidence is redacted, encrypted and hash verified on read; the browser never receives raw scanner credentials.'],
                  ['No autonomous escalation', 'The worker cannot expand scope, follow out-of-scope links, or convert an observation into an exploit.'],
                ].map(([area, behaviour]) => (
                  <tr key={area}>
                    <td className="w-52 text-xs font-medium">{area}</td>
                    <td className="text-2xs">{behaviour}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </CardBody>
      </Card>

      <DataQualityNote>
        {CURATED_PROVENANCE.note} Automated modules run only against an approved engagement. Where a module lacks a prerequisite (device farm, test
        identity, intelligence snapshot) the platform surfaces the dependency instead of simulating a result.
      </DataQualityNote>
    </div>
  );
}
