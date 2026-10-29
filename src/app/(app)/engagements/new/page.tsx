import Link from 'next/link';
import { cookies } from 'next/headers';
import { pageContext, query, flashFrom, param } from '@/lib/page-context';
import { listInstitutions } from '@/lib/domain/institutions';
import { listApplications } from '@/lib/domain/applications';
import { createEngagementAction } from '@/app/actions/supervision';
import { DEFAULT_PROHIBITED_ACTIONS } from '@/lib/domain/engagements';
import { TEST_METHODS } from '@/lib/constants';
import { CSRF_COOKIE } from '@/lib/db/context';
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Flash, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

function localInput(offsetDays = 0, hour = 8): string {
  const date = new Date(Date.now() + offsetDays * 86400000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString().slice(0, 16);
}

export default async function NewEngagementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('engagement:create');
  const flash = flashFrom(params);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';
  const institutionId = param(params, 'institutionId') ?? '';
  const preselectedApplication = param(params, 'applicationId') ?? '';

  const institutions = await query(ctx, (tx) => listInstitutions(tx, ctx, {}));

  if (!institutionId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="New engagement — select the institution"
          description="An engagement can only cover one institution at a time. Choose the supervised entity, then record its written authorisation, the assets in scope and the permitted methods."
          actions={<Link href="/engagements" className="btn btn-secondary">Cancel</Link>}
        />
        <Flash notice={flash.notice} error={flash.error} />
        {institutions.length ? (
          <Card>
            <CardHeader title={`${institutions.length} institutions available`} subtitle="Selecting an institution opens the scope and authorisation form." />
            <CardBody className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {institutions.map((institution: any) => (
                <Link
                  key={institution.id}
                  href={`/engagements/new?institutionId=${institution.id}`}
                  className="rounded-md border border-[var(--ficap-border)] px-3 py-2.5 transition-colors hover:border-seal-600/40 hover:bg-seal-600/5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-navy-900">{institution.name}</span>
                    <Badge tone="navy">{institution.code}</Badge>
                  </div>
                  <p className="mt-1 text-2xs capitalize text-[var(--ficap-muted)]">
                    {String(institution.category).replace(/_/g, ' ')} · {institution.application_count ?? 0} applications · risk tier {institution.risk_tier}
                  </p>
                </Link>
              ))}
            </CardBody>
          </Card>
        ) : (
          <EmptyState title="No institutions registered" description="Register the institution before creating an engagement." action={<Link href="/institutions/new" className="btn btn-primary">Add institution</Link>} />
        )}
      </div>
    );
  }

  const institution = institutions.find((row: any) => row.id === institutionId);
  if (!institution) {
    return (
      <div className="space-y-4">
        <PageHeader title="Institution not available" description="The selected institution is not in your authorised scope." actions={<Link href="/engagements/new" className="btn btn-secondary">Choose another</Link>} />
      </div>
    );
  }
  const applications = await query(ctx, (tx) => listApplications(tx, ctx, { institutionId }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`New engagement — ${institution.name}`}
        description="Everything on this form is required before a job can start. Scope assets are the only hosts, endpoints or packages the platform will ever contact for this engagement."
        meta={
          <>
            <Badge tone="navy">{institution.code}</Badge>
            <Badge tone={ctx.mode === 'demo' ? 'amber' : 'green'}>{ctx.mode === 'demo' ? 'demonstration record' : 'live record'}</Badge>
          </>
        }
        actions={<Link href="/engagements/new" className="btn btn-secondary">Change institution</Link>}
      />
      <Flash notice={flash.notice} error={flash.error} />

      {applications.length === 0 ? (
        <EmptyState
          title="No applications inventoried for this institution"
          description="Add the applications to assess before creating an engagement."
          action={<Link href={`/applications/new?institutionId=${institutionId}`} className="btn btn-primary">Add application</Link>}
        />
      ) : (
        <form action={createEngagementAction} className="space-y-4">
          <input type="hidden" name="_csrf" value={csrf} />
          <input type="hidden" name="institutionId" value={institutionId} />

          <Card>
            <CardHeader title="1 · Engagement and applications" subtitle="Select every channel covered by this authorisation. All selections must belong to the institution above." />
            <CardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Engagement name" name="name" required span={2}>
                  <input id="name" name="name" required maxLength={180} className="input" placeholder="2026 internet and mobile channel assessment" />
                </Field>
                <Field label="Owner" name="owner">
                  <input className="input" value={ctx.user.name} readOnly disabled />
                </Field>
                <Field label="Description" name="description" span={3}>
                  <textarea id="description" name="description" rows={2} className="textarea" placeholder="Purpose, regulatory context and any constraints agreed with the institution." />
                </Field>
              </div>
              <div>
                <p className="label">Applications in scope</p>
                <div className="mt-1 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {applications.map((application: any) => (
                    <label key={application.id} className="flex items-start gap-2 rounded border border-[var(--ficap-border)] px-2 py-1.5 text-xs hover:bg-slate-50">
                      <input
                        type="checkbox"
                        name="applicationIds"
                        value={application.id}
                        defaultChecked={preselectedApplication ? application.id === preselectedApplication : false}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                      />
                      <span>
                        <span className="font-medium text-navy-900">{application.name}</span>
                        <span className="block text-2xs text-[var(--ficap-muted)]">
                          {String(application.channel).replace(/_/g, ' ')} · {application.environment}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="2 · Written authorisation" subtitle="A reference to the signed authorisation held by the institution. The platform blocks execution without an in-date record." />
            <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Authorisation reference" name="authorizationRef" required span={2} hint="For example CBN/SEC/2026/AUTH/0042 or the institution's internal reference.">
                <input id="authorizationRef" name="authorizationRef" required maxLength={120} className="input font-mono" />
              </Field>
              <Field label="Authorising officer" name="authorizedByName" required>
                <input id="authorizedByName" name="authorizedByName" required maxLength={120} className="input" placeholder="Full name" />
              </Field>
              <Field label="Authorising role" name="authorizedByRole" required>
                <input id="authorizedByRole" name="authorizedByRole" required maxLength={120} className="input" placeholder="Chief Risk Officer" />
              </Field>
              <Field label="Authorisation signed" name="authorizedAt" required>
                <input id="authorizedAt" name="authorizedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
              </Field>
              <Field label="Valid from" name="validFrom" required>
                <input id="validFrom" name="validFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
              </Field>
              <Field label="Valid to / scope expiry" name="validTo" required hint="No request is issued after this date, regardless of job state.">
                <input id="validTo" name="validTo" type="date" required defaultValue={new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)} className="input" />
              </Field>
              <Field label="Testing window opens" name="testingWindowStart">
                <input id="testingWindowStart" name="testingWindowStart" type="datetime-local" defaultValue={localInput(0, 8)} className="input" />
              </Field>
              <Field label="Testing window closes" name="testingWindowEnd">
                <input id="testingWindowEnd" name="testingWindowEnd" type="datetime-local" defaultValue={localInput(7, 18)} className="input" />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="3 · Approved scope assets" subtitle="Exact hosts, URLs, API endpoints, IP ranges or mobile package identifiers. Anything not listed here is out of scope and will be refused." />
            <CardBody className="space-y-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="grid gap-2 rounded border border-[var(--ficap-border)] p-2.5 sm:grid-cols-12">
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`assetType-${index}`}>Type</label>
                    <select id={`assetType-${index}`} name="assetType" className="select mt-1" defaultValue={index === 0 ? 'url' : 'api_endpoint'}>
                      <option value="url">URL</option>
                      <option value="domain">Domain</option>
                      <option value="api_endpoint">API endpoint</option>
                      <option value="ip_address">IP address</option>
                      <option value="cidr">CIDR range</option>
                      <option value="mobile_app">Mobile package</option>
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    <label className="label" htmlFor={`assetValue-${index}`}>Value</label>
                    <input id={`assetValue-${index}`} name="assetValue" className="input mt-1 font-mono text-xs" placeholder={index === 0 ? 'https://www.example.bank.ng' : 'https://api.example.bank.ng/v2'} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`assetMethods-${index}`}>Methods</label>
                    <input id={`assetMethods-${index}`} name="assetMethods" defaultValue="GET,HEAD" className="input mt-1 font-mono text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`assetPaths-${index}`}>Approved paths</label>
                    <input id={`assetPaths-${index}`} name="assetPaths" className="input mt-1 font-mono text-xs" placeholder="/v2/accounts" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`assetNotes-${index}`}>Note</label>
                    <input id={`assetNotes-${index}`} name="assetNotes" className="input mt-1 text-xs" placeholder="Optional" />
                  </div>
                </div>
              ))}
              <p className="prose-note">
                Leave unused rows blank. Methods default to GET and HEAD. If approved paths are supplied, only those path prefixes are permitted on
                that asset. Redirects to hosts outside this list are never followed.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="4 · Exclusions and prohibited actions" subtitle="Exclusions always win over an inclusion. Prohibited actions are enforced by the platform and cannot be overridden by an operator." />
            <CardBody className="space-y-3">
              {[0, 1].map((index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`exclusionType-${index}`}>Exclusion type</label>
                    <select id={`exclusionType-${index}`} name="exclusionType" className="select mt-1" defaultValue="url">
                      <option value="url">URL</option>
                      <option value="domain">Domain</option>
                      <option value="ip_address">IP address</option>
                      <option value="cidr">CIDR</option>
                      <option value="mobile_app">Mobile package</option>
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    <label className="label" htmlFor={`exclusionValue-${index}`}>Value</label>
                    <input id={`exclusionValue-${index}`} name="exclusionValue" className="input mt-1 font-mono text-xs" placeholder="https://legacy.example.bank.ng" />
                  </div>
                  <div className="sm:col-span-6">
                    <label className="label" htmlFor={`exclusionReason-${index}`}>Reason</label>
                    <input id={`exclusionReason-${index}`} name="exclusionReason" className="input mt-1 text-xs" placeholder="Decommissioning, third-party owned, or agreed exclusion" />
                  </div>
                </div>
              ))}
              <div className="grid gap-2 lg:grid-cols-2">
                <div>
                  <p className="label">Permitted methods</p>
                  <div className="mt-1 space-y-1">
                    {TEST_METHODS.map((method) => (
                      <label key={method.key} className="flex items-start gap-2 rounded border border-[var(--ficap-border)] px-2 py-1.5 text-2xs hover:bg-slate-50">
                        <input
                          type="checkbox"
                          name="permittedMethods"
                          value={method.key}
                          defaultChecked={['unauthenticated_http', 'configuration_review', 'dependency_analysis'].includes(method.key)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                        />
                        <span>
                          <span className="font-medium text-navy-900">{method.label}</span>
                          <span className="block text-[var(--ficap-muted)]">{method.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="label">Prohibited actions recorded against the engagement</p>
                  <div className="mt-1 space-y-1">
                    {DEFAULT_PROHIBITED_ACTIONS.map((action) => (
                      <label key={action} className="flex items-start gap-2 rounded border border-[var(--ficap-border)] px-2 py-1.5 text-2xs hover:bg-slate-50">
                        <input type="checkbox" name="prohibitedActions" value={action} defaultChecked className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300" />
                        <span className="text-[var(--ficap-text)]">{action}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="5 · Safety envelope and contacts" subtitle="Limits are enforced per job by the request client: rate, concurrency, total requests and duration." />
            <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Emergency contact name" name="emergencyContactName" required>
                <input id="emergencyContactName" name="emergencyContactName" required maxLength={120} className="input" />
              </Field>
              <Field label="Emergency contact phone" name="emergencyContactPhone" required>
                <input id="emergencyContactPhone" name="emergencyContactPhone" required maxLength={40} className="input" placeholder="+234 …" />
              </Field>
              <Field label="Requests per second" name="maxRequestsPerSecond" hint="Hard ceiling enforced by the client.">
                <input id="maxRequestsPerSecond" name="maxRequestsPerSecond" type="number" min={1} max={10} step={1} defaultValue={2} className="input" />
              </Field>
              <Field label="Concurrency" name="maxConcurrency">
                <input id="maxConcurrency" name="maxConcurrency" type="number" min={1} max={4} step={1} defaultValue={2} className="input" />
              </Field>
              <Field label="Total request budget" name="maxRequestsTotal" hint="A job stops when the budget is exhausted.">
                <input id="maxRequestsTotal" name="maxRequestsTotal" type="number" min={10} max={20000} step={10} defaultValue={2000} className="input" />
              </Field>
              <Field label="Maximum duration (minutes)" name="maxDurationMinutes">
                <input id="maxDurationMinutes" name="maxDurationMinutes" type="number" min={5} max={480} step={5} defaultValue={120} className="input" />
              </Field>
              <Field label="Escalation procedure" name="escalationProcedure" required span={2}>
                <textarea id="escalationProcedure" name="escalationProcedure" rows={2} required className="textarea" placeholder="Who to contact, how quickly, and how to stop activity." />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <p className="prose-note max-w-3xl">
                Creating the engagement records it in <strong>draft</strong>. An assessor must then authorise it, and an independent reviewer must approve
                the test plan, before any job can be launched. No traffic is generated by this step.
              </p>
              <div className="flex gap-2">
                <Link href="/engagements" className="btn btn-secondary">Cancel</Link>
                <button type="submit" className="btn btn-primary">Create engagement</button>
              </div>
            </CardBody>
          </Card>
        </form>
      )}
    </div>
  );
}
