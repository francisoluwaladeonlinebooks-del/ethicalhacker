import Link from 'next/link';
import { cookies } from 'next/headers';
import { pageContext, query, flashFrom, param } from '@/lib/page-context';
import { createApplicationAction } from '@/app/actions/supervision';
import { listInstitutions } from '@/lib/domain/institutions';
import { CHANNELS, DATA_SENSITIVITY, ENVIRONMENTS } from '@/lib/constants';
import { Card, CardBody, CardHeader, Field, Flash, PageHeader } from '@/components/ui';
import { CSRF_COOKIE } from '@/lib/db/context';

export const dynamic = 'force-dynamic';

export default async function NewApplicationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('application:write');
  const flash = flashFrom(params);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';
  const institutionId = param(params, 'institutionId') ?? '';
  const institutions = await query(ctx, (tx) => listInstitutions(tx, ctx, {}));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Add an application to the inventory"
        description="Record the channel, environment and data classification. Mobile applications also require the package identifier so the uploaded artefact can be validated against the approved scope."
        actions={<Link href="/applications" className="btn btn-secondary">Back to inventory</Link>}
      />
      <Flash notice={flash.notice} error={flash.error} />

      <form action={createApplicationAction} className="space-y-4">
        <input type="hidden" name="_csrf" value={csrf} />
        <Card>
          <CardHeader title="Ownership and purpose" />
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Institution" name="institutionId" required>
              <select id="institutionId" name="institutionId" required className="select" defaultValue={institutionId}>
                <option value="">Select an institution</option>
                {institutions.map((institution: any) => (
                  <option key={institution.id} value={institution.id}>{institution.name} ({institution.code})</option>
                ))}
              </select>
            </Field>
            <Field label="Application name" name="name" required span={2}>
              <input id="name" name="name" required maxLength={160} className="input" placeholder="Retail internet banking" />
            </Field>
            <Field label="Business purpose" name="businessPurpose" span={3}>
              <textarea id="businessPurpose" name="businessPurpose" rows={2} className="textarea" placeholder="What the application does and who uses it." />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Channel and technical detail" />
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Channel" name="channel" required>
              <select id="channel" name="channel" required className="select" defaultValue="web">
                {CHANNELS.map((channel) => (
                  <option key={channel.key} value={channel.key}>{channel.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Environment" name="environment" required>
              <select id="environment" name="environment" required className="select" defaultValue="staging">
                {ENVIRONMENTS.map((environment) => (
                  <option key={environment.key} value={environment.key}>{environment.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Data sensitivity" name="dataSensitivity" required hint="Determines the minimum protection applied to captured evidence.">
              <select id="dataSensitivity" name="dataSensitivity" required className="select" defaultValue="restricted">
                {DATA_SENSITIVITY.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Web URL" name="webUrl" hint="Absolute http(s) URL as provided by the institution.">
              <input id="webUrl" name="webUrl" type="url" className="input" placeholder="https://www.example.bank.ng" />
            </Field>
            <Field label="API base URL" name="apiBaseUrl">
              <input id="apiBaseUrl" name="apiBaseUrl" type="url" className="input" placeholder="https://api.example.bank.ng/v2" />
            </Field>
            <Field label="Mobile platform" name="mobilePlatform">
              <select id="mobilePlatform" name="mobilePlatform" className="select" defaultValue="">
                <option value="">Not applicable</option>
                <option value="android">Android</option>
                <option value="ios">iOS</option>
                <option value="both">Both</option>
              </select>
            </Field>
            <Field label="Package identifier" name="packageIdentifier" hint="Android applicationId or iOS bundle identifier. Required for mobile artefact validation.">
              <input id="packageIdentifier" name="packageIdentifier" className="input font-mono" placeholder="ng.example.bank.retail" />
            </Field>
            <Field label="Version" name="version">
              <input id="version" name="version" maxLength={40} className="input font-mono" placeholder="4.8.1" />
            </Field>
            <Field label="Authentication methods" name="authMethods" hint="Comma separated, for example: password, otp, biometric, oauth2.">
              <input id="authMethods" name="authMethods" className="input" placeholder="password, otp" />
            </Field>
            <Field label="Critical processes" name="criticalProcesses" hint="Comma separated, for example: funds_transfer, statement_access." span={2}>
              <input id="criticalProcesses" name="criticalProcesses" className="input" placeholder="funds_transfer, onboarding_kyc" />
            </Field>
            <Field label="Boundaries" name="boundaries" span={3}>
              <textarea id="boundaries" name="boundaries" rows={2} className="textarea" placeholder="Systems and trust boundaries of the application." />
            </Field>
            <Field label="Known exclusions" name="exclusions" span={3}>
              <textarea id="exclusions" name="exclusions" rows={2} className="textarea" placeholder="Components explicitly out of supervisory assessment scope (for example a third-party hosted widget)." />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="prose-note max-w-2xl">
              Inventory records do not authorise testing. Each engagement must record a written authorisation, an approved asset scope and a
              testing window before any assessment job can start.
            </p>
            <div className="flex gap-2">
              <Link href="/applications" className="btn btn-secondary">Cancel</Link>
              <button type="submit" className="btn btn-primary">Add application</button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
