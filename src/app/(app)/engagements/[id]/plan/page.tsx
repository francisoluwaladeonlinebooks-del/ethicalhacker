import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { pageContext, query, canDo, flashFrom } from '@/lib/page-context';
import { getEngagementDetail, assertEngagementOperational } from '@/lib/domain/engagements';
import { listFrameworks } from '@/lib/domain/frameworks';
import { approvePlanAction, submitPlanAction } from '@/app/actions/supervision';
import { CSRF_COOKIE } from '@/lib/db/context';
import { NotFoundError } from '@/lib/errors';
import { Badge, Card, CardBody, CardHeader, DataQualityNote, DescriptionList, EmptyState, Field, Flash, PageHeader, StatusBadge, TableWrap, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

const MODULES = [
  { key: 'web', label: 'Web application', description: 'WSTG-informed configuration, transport, session and information disclosure checks.' },
  { key: 'api', label: 'API security', description: 'OpenAPI/Postman inventory, authorisation and schema checks against the OWASP API Top 10.' },
  { key: 'mobile', label: 'Mobile application', description: 'MASVS/MASTG static analysis of the uploaded package; dynamic cases require a device farm.' },
  { key: 'dependencies', label: 'Dependency and supply chain', description: 'Manifest and lockfile analysis matched against a dated vulnerability intelligence snapshot.' },
];

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await pageContext('engagement:read');
  const flash = flashFrom(await searchParams);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';

  let data: any;
  try {
    data = await query(ctx, (tx) => getEngagementDetail(tx, ctx, id));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const frameworks = await query(ctx, (tx) => listFrameworks(tx));
  const { engagement, plans, operational } = data;
  const pending = plans.find((plan: any) => plan.status === 'pending_approval');
  const approved = plans.find((plan: any) => plan.status === 'approved');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assessment plan"
        description="The plan states which modules will run, which framework versions apply and what the impact and limitations are. An independent reviewer must approve it before jobs can be queued."
        meta={
          <>
            <Badge tone="navy">{engagement.code}</Badge>
            <StatusBadge status={engagement.status} />
            {approved ? <Badge tone="green">approved plan v{approved.version}</Badge> : <Badge tone="amber">no approved plan</Badge>}
          </>
        }
        actions={<Link href={`/engagements/${id}`} className="btn btn-secondary">Back to engagement</Link>}
      />
      <Flash notice={flash.notice} error={flash.error} />

      <Card>
        <CardHeader title="Plan versions" subtitle="Historical plans are retained; approving a new plan supersedes the earlier one." />
        {plans.length ? (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Version</th><th>Status</th><th>Modules</th><th>Frameworks</th><th>Submitted</th><th>Approved</th><th>Approver note</th></tr></thead>
              <tbody>
                {plans.map((plan: any) => (
                  <tr key={plan.id}>
                    <td className="font-mono text-2xs">v{plan.version}</td>
                    <td><StatusBadge status={plan.status} /></td>
                    <td className="text-2xs capitalize">{(plan.modules ?? []).join(', ')}</td>
                    <td className="text-2xs">{(plan.frameworks ?? []).map((framework: any) => `${framework.key} ${framework.version}`).join(', ')}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(plan.created_at, true)}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(plan.approved_at, true)}</td>
                    <td className="text-2xs text-[var(--ficap-muted)]">{plan.approval_note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><EmptyState title="No plan submitted" description="Record the modules and framework versions to be used, then submit the plan for independent approval." /></CardBody>
        )}
      </Card>

      {pending && canDo(ctx, 'engagement:plan:approve') ? (
        <Card>
          <CardHeader title={`Approve plan v${pending.version}`} subtitle="Separation of duties: the author of a plan cannot approve it." />
          <CardBody className="space-y-3">
            <DescriptionList
              items={[
                { label: 'Impact summary', value: pending.impact_summary ?? 'not recorded' },
                { label: 'Limitations', value: pending.limitations ?? 'not recorded' },
                { label: 'Modules', value: (pending.modules ?? []).join(', ') },
              ]}
            />
            <form action={approvePlanAction}>
              <input type="hidden" name="_csrf" value={csrf} />
              <input type="hidden" name="engagementId" value={id} />
              <input type="hidden" name="planId" value={pending.id} />
              <button type="submit" className="btn btn-primary">Approve plan</button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canDo(ctx, 'engagement:update') && ['authorized', 'plan_review', 'approved'].includes(engagement.status) ? (
        <Card>
          <CardHeader title="Submit a plan" subtitle="This creates a new plan version. An existing approved plan stays in force until the new version is approved." />
          <CardBody>
            <form action={submitPlanAction} className="space-y-3">
              <input type="hidden" name="_csrf" value={csrf} />
              <input type="hidden" name="engagementId" value={id} />
              <div>
                <p className="label">Modules</p>
                <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                  {MODULES.map((module) => (
                    <label key={module.key} className="flex items-start gap-2 rounded border border-[var(--ficap-border)] px-2 py-1.5 text-xs hover:bg-slate-50">
                      <input type="checkbox" name="modules" value={module.key} defaultChecked className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300" />
                      <span>
                        <span className="font-medium text-navy-900">{module.label}</span>
                        <span className="block text-2xs text-[var(--ficap-muted)]">{module.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="label">Framework versions</p>
                <div className="mt-1 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {frameworks
                    .filter((framework: any) => framework.key !== 'cvss')
                    .map((framework: any) => (
                      <label key={`${framework.key}@${framework.version}`} className="flex items-center gap-2 rounded border border-[var(--ficap-border)] px-2 py-1.5 text-2xs">
                        <input
                          type="checkbox"
                          name="frameworks"
                          value={`${framework.key}@${framework.version}`}
                          defaultChecked={['owasp-wstg', 'owasp-api-top10', 'owasp-masvs', 'nist-csf'].includes(framework.key)}
                          className="h-3.5 w-3.5 rounded border-slate-300"
                        />
                        <span>
                          {framework.name}
                          <span className="ml-1 font-mono text-[10px] text-[var(--ficap-muted)]">{framework.version}</span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
              <Field label="Impact summary" name="impactSummary" required hint="State the expected effect on the institution: read-only traffic, bounded attempts, no availability impact.">
                <textarea id="impactSummary" name="impactSummary" required rows={3} className="textarea" placeholder="Read-only requests and bounded verification against synthetic identities. No exploitation, no availability impact, no customer data." />
              </Field>
              <Field label="Limitations" name="limitations" required hint="Record known gaps up front — for example missing device farm, missing test identities or expired intelligence.">
                <textarea id="limitations" name="limitations" required rows={2} className="textarea" placeholder="Dynamic mobile instrumentation requires an approved device farm; those cases will be recorded as blocked." />
              </Field>
              <button type="submit" className="btn btn-primary">Submit plan for approval</button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <DataQualityNote>
        Plan approval does not authorise any target outside the recorded scope. Every check still passes the scope validation, rate limit and window
        gate at request time; failures are recorded against the job rather than being silently skipped.
      </DataQualityNote>
      {operational.ok ? null : <p className="text-2xs text-amber-800">Current gate: {operational.reason}</p>}
    </div>
  );
}
