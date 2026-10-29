import Link from 'next/link';
import { pageContext, query, canDo, param } from '@/lib/page-context';
import { loadModuleView } from '@/lib/domain/modules';
import { mobileChecks, MOBILE_DYNAMIC_TESTS } from '@/lib/engines/mobile';
import { AssessmentModule } from '@/components/assessment-module';
import { withSystem } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

function deviceFarmConfigured(): boolean {
  return Boolean(process.env.FICAP_DEVICE_FARM_URL);
}

export default async function MobileAssessmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('engagement:read');
  const applicationId = param(params, 'applicationId');
  const view = await query(ctx, (tx) => loadModuleView(tx, ctx, { module: 'mobile', frameworkKeys: ['owasp-masvs', 'owasp-mastg', 'nist-csf'], applicationId }));

  const artefacts = await withSystem((tx) =>
    tx.query(
      `SELECT a.id, a.filename, a.kind, a.size_bytes, a.status, a.uploaded_at, a.application_id
         FROM artifacts a WHERE a.kind IN ('apk','aab','ipa') ${applicationId ? 'AND a.application_id = $1' : ''}
        ORDER BY a.uploaded_at DESC LIMIT 20`,
      applicationId ? [applicationId] : [],
    ),
  );

  const checks = mobileChecks(async () => null);
  const farm = deviceFarmConfigured();

  return (
    <AssessmentModule
      moduleKey="mobile"
      title="Mobile application assessment"
      description="Offline static analysis of the signed Android or iOS package supplied by the institution, aligned to OWASP MASVS 2.0 and MASTG. Dynamic testing is only claimed when a device farm and instrumented build are actually available."
      frameworkNote={
        <p>
          Requirement identifiers follow MASVS 2.0 groups (STORAGE, CRYPTO, AUTH, NETWORK, PLATFORM, CODE, RESILIENCE, PRIVACY). MASTG identifiers are
          used for testable cases. A static pass is never presented as MASVS compliance.
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
      manualTests={MOBILE_DYNAMIC_TESTS}
      prerequisites={[
        { label: 'Signed APK/AAB/IPA uploaded', met: artefacts.length > 0, detail: artefacts.length ? `${artefacts.length} package(s) stored` : 'Upload the release package on the application page' },
        { label: 'Device farm for dynamic testing', met: farm, detail: farm ? 'Configured via FICAP_DEVICE_FARM_URL' : 'Not configured. Dynamic MASTG cases are recorded as blocked.' },
        { label: 'Instrumented build (Frida/Objection)', met: false, detail: 'Requires an explicit agreement with the institution and a test-only build.' },
        { label: 'Approved test identities', met: false, detail: 'Needed for authentication and session cases.' },
      ]}
      applications={view.applications}
      selectedApplication={applicationId}
      results={view.results}
      lastJob={view.lastJob}
      actions={
        <>
          {applicationId ? <Link href={`/applications/${applicationId}`} className="btn btn-secondary">Application</Link> : null}
          {canDo(ctx, 'evidence:create') && applicationId ? <Link href={`/applications/${applicationId}`} className="btn btn-primary">Upload package</Link> : null}
        </>
      }
      scopeNote={
        <p className="text-2xs text-[var(--ficap-muted)]">
          Static analysis reads the package offline in the platform. No device, account or network access is used. The package is encrypted at rest and
          the SHA-256 digest is recorded with every finding it produces.
          {artefacts.length ? ` Latest package: ${artefacts[0].filename} (${Math.round(Number(artefacts[0].size_bytes) / 1024)} KB).` : ''}
        </p>
      }
    />
  );
}
