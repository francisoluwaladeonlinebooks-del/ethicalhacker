import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/ids';
import { cookies } from 'next/headers';
import { pageContext, query, canDo, flashFrom } from '@/lib/page-context';
import { getInstitutionOverview, categoryLabel } from '@/lib/domain/institutions';
import { getProfile, summariseProfile, CSF_STATUS_LABELS } from '@/lib/domain/nist';
import { addSupervisoryNoteAction } from '@/app/actions/supervision';
import { CSRF_COOKIE } from '@/lib/db/context';
import { Badge, Bar, Card, CardBody, CardHeader, DataQualityNote, DescriptionList, EmptyState, Flash, PageHeader, SeverityBadge, StatCard, StatusBadge, TableWrap, formatDate } from '@/components/ui';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unscored'];

export default async function InstitutionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await pageContext('institution:read');
  const flash = flashFrom(await searchParams);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';

  let data;
  try {
    data = await query(ctx, (tx) => getInstitutionOverview(tx, ctx, id));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const nist = await query(ctx, async (tx) => {
    const profile = await getProfile(tx, id);
    return { ...profile, summary: summariseProfile(profile.entries, profile.functions, profile.findingsByOutcome) };
  });

  const { institution, applications, engagements, findingsBySeverity, remediation, trend, notes, canViewNotes } = data as any;
  const severityMap: Record<string, number> = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const row of findingsBySeverity) severityMap[row.technical_severity] = Number(row.count);
  const totalFindings = Object.values(severityMap).reduce((a, b) => a + b, 0);
  const openCount = applications.reduce((sum: number, app: any) => sum + Number(app.open_findings ?? 0), 0);
  const overdue = remediation.reduce((sum: number, row: any) => sum + Number(row.overdue ?? 0), 0);
  const activeEngagements = engagements.filter((e: any) => !['completed', 'cancelled'].includes(e.status));

  return (
    <div className="space-y-4">
      <PageHeader
        title={institution.name}
        description={institution.description ?? 'No summary recorded for this institution.'}
        meta={
          <>
            <Badge tone="navy">{institution.code}</Badge>
            <span className="text-2xs text-[var(--ficap-muted)]">{categoryLabel(institution.category)}</span>
            <Badge tone={institution.risk_tier === 'critical' || institution.risk_tier === 'high' ? 'red' : institution.risk_tier === 'medium' ? 'amber' : 'green'}>
              risk tier: {institution.risk_tier}
            </Badge>
            <StatusBadge status={institution.status} />
          </>
        }
        actions={
          <>
            <Link href="/institutions" className="btn btn-secondary">Registry</Link>
            {canDo(ctx, 'engagement:create') ? (
              <Link href={`/engagements/new?institutionId=${institution.id}`} className="btn btn-primary">New engagement</Link>
            ) : null}
          </>
        }
      />
      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications" value={applications.length} hint={`${applications.filter((a: any) => a.status === 'active').length} active in the inventory`} />
        <StatCard label="Open findings" value={openCount} tone="amber" hint="Excludes resolved, closed and false positives" />
        <StatCard label="Critical / High" value={severityMap.critical + severityMap.high} tone={severityMap.critical + severityMap.high ? 'red' : 'green'} hint="CVSS v4.0 base severity" />
        <StatCard label="Overdue remediation" value={overdue} tone={overdue ? 'red' : 'green'} hint={`${remediation.filter((r: any) => r.status === 'verified').length} independently verified`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Institutional profile" subtitle="Registry data recorded at onboarding. Changes are audited." />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Licence number', value: institution.licence_number },
                { label: 'Location', value: [institution.city, institution.state].filter(Boolean).join(', ') },
                { label: 'Website', value: institution.website },
                { label: 'Primary contact', value: institution.primary_contact_name },
                { label: 'Contact email', value: institution.primary_contact_email },
                { label: 'Onboarded', value: formatDate(institution.created_at) },
                { label: 'Data mode', value: institution.data_mode === 'demo' ? 'Demonstration (synthetic)' : 'Live supervisory record' },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Finding severity mix" subtitle="All recorded findings for this institution." />
          <CardBody className="space-y-2">
            {totalFindings === 0 ? (
              <p className="prose-note">No findings recorded. This may mean no assessment has run, which is not the same as a clean result.</p>
            ) : (
              SEVERITIES.map((severity) => (
                <div key={severity} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize">{severity}</span>
                    <span className="font-mono text-2xs text-[var(--ficap-muted)]">{severityMap[severity]}</span>
                  </div>
                  <Bar value={severityMap[severity]} max={totalFindings} tone={severity === 'critical' ? 'red' : severity === 'high' ? 'red' : severity === 'medium' ? 'amber' : severity === 'low' ? 'green' : 'slate'} />
                </div>
              ))
            )}
            <DataQualityNote>
              Severity shown here is the CVSS v4.0 technical rating. Contextual banking risk, which also considers exposure, customer funds and
              compensating controls, is recorded per finding and is never folded into the technical score.
            </DataQualityNote>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Applications"
          subtitle="Channels under assessment. An application must exist here before it can be included in an engagement scope."
          actions={canDo(ctx, 'application:write') ? <Link href={`/applications/new?institutionId=${institution.id}`} className="btn btn-secondary btn-xs">Add application</Link> : null}
        />
        {applications.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Channel</th>
                  <th>Environment</th>
                  <th>Version</th>
                  <th className="text-right">Open findings</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app: any) => (
                  <tr key={app.id}>
                    <td>
                      <Link href={`/applications/${app.id}`} className="link">{app.name}</Link>
                      <p className="text-2xs text-[var(--ficap-muted)]">{app.business_purpose ?? '—'}</p>
                    </td>
                    <td className="capitalize">{String(app.channel).replace(/_/g, ' ')}</td>
                    <td className="capitalize">{app.environment}</td>
                    <td className="font-mono text-2xs">{app.version ?? '—'}</td>
                    <td className="text-right font-mono">{app.open_findings}</td>
                    <td><StatusBadge status={app.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState title="No applications inventoried" description="Add the internet banking, mobile, API or administrative channels that fall within supervisory assessment." />
          </CardBody>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Engagements" subtitle="Authorised assessment activity for this institution." actions={<Link href="/engagements" className="btn btn-secondary btn-xs">All engagements</Link>} />
          {engagements.length ? (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Engagement</th>
                    <th>Status</th>
                    <th>Scope expires</th>
                    <th className="text-right">Findings</th>
                  </tr>
                </thead>
                <tbody>
                  {engagements.map((engagement: any) => (
                    <tr key={engagement.id}>
                      <td>
                        <Link href={`/engagements/${engagement.id}`} className="link">{engagement.name}</Link>
                        <p className="text-2xs text-[var(--ficap-muted)]">{engagement.code}</p>
                      </td>
                      <td><StatusBadge status={engagement.status} /></td>
                      <td className="whitespace-nowrap text-2xs">{formatDate(engagement.scope_expires_at)}</td>
                      <td className="text-right font-mono">{engagement.finding_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody>
              <EmptyState title="No engagements" description="An engagement records the written authorisation, scope and approved test plan before any assessment activity." />
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            title="NIST CSF 2.0 profile"
            subtitle="Evidence status of governance outcomes. Not a maturity score and never derived from vulnerability counts."
            actions={<Link href={`/nist?institutionId=${institution.id}`} className="btn btn-secondary btn-xs">Open profile</Link>}
          />
          <CardBody className="space-y-2">
            {nist.summary.byFunction.length ? (
              nist.summary.byFunction.map((bucket: any) => {
                const total = Object.values(bucket.counts as Record<string, number>).reduce((a, b) => a + b, 0);
                const covered = (bucket.counts.supported ?? 0) + (bucket.counts.partially_supported ?? 0);
                return (
                  <div key={bucket.code} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span><span className="font-mono text-2xs text-[var(--ficap-muted)]">{bucket.code}</span> {bucket.title}</span>
                      <span className="font-mono text-2xs text-[var(--ficap-muted)]">{covered}/{total || 0}</span>
                    </div>
                    <Bar value={covered} max={total || 1} tone={total && covered / total > 0.6 ? 'green' : covered > 0 ? 'amber' : 'slate'} />
                  </div>
                );
              })
            ) : (
              <p className="prose-note">No profile entries recorded for this institution.</p>
            )}
            <div className="flex flex-wrap gap-1 pt-1">
              {Object.entries(nist.summary.statusTotals as Record<string, number>).map(([status, count]) => (
                <Badge key={status} tone={status === 'supported' ? 'green' : status === 'improvement_required' ? 'red' : status === 'not_assessed' ? 'neutral' : 'amber'}>
                  {CSF_STATUS_LABELS[status] ?? status}: {count}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {trend.length ? (
        <Card>
          <CardHeader title="Findings recorded by month" subtitle="Trend of recorded findings. A flat line may reflect no assessment activity rather than stable risk." />
          <CardBody>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Period</th><th>Critical</th><th>High</th><th>Medium</th><th>Low</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {trend.map((row: any) => (
                    <tr key={row.period}>
                      <td className="font-mono text-2xs">{row.period}</td>
                      <td className="font-mono">{row.critical}</td>
                      <td className="font-mono">{row.high}</td>
                      <td className="font-mono">{row.medium}</td>
                      <td className="font-mono">{row.low}</td>
                      <td className="font-mono font-semibold">{Number(row.critical) + Number(row.high) + Number(row.medium) + Number(row.low)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </CardBody>
        </Card>
      ) : null}

      {canViewNotes ? (
        <Card>
          <CardHeader title="Confidential supervisory notes" subtitle="Visible only to roles with supervisory note access. Notes never appear in institution-facing reports." />
          <CardBody className="space-y-3">
            {notes.length ? (
              <ul className="space-y-2">
                {notes.map((note: any) => (
                  <li key={note.id} className="rounded border border-[var(--ficap-border)] bg-[#fbfcfd] px-3 py-2">
                    <p className="text-xs leading-relaxed text-[var(--ficap-text)]">{note.body}</p>
                    <p className="mt-1 text-2xs text-[var(--ficap-muted)]">
                      {note.author_name ?? 'Supervisory user'} · {formatDate(note.created_at, true)} · {note.classification.replace(/_/g, ' ')}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="prose-note">No supervisory notes recorded.</p>
            )}
            {canDo(ctx, 'supervisory_note:write') ? (
              <form action={addSupervisoryNoteAction} className="space-y-2 border-t border-[var(--ficap-border)] pt-3">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="institutionId" value={institution.id} />
                <label className="label" htmlFor="body">Add a confidential note</label>
                <textarea id="body" name="body" required rows={3} maxLength={4000} className="textarea" placeholder="Record supervisory judgement, follow-up agreed with the institution, or escalation context." />
                <button type="submit" className="btn btn-primary">Record note</button>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardBody>
            <p className="label">Active engagements</p>
            <p className="mt-1 text-2xl font-semibold text-navy-900">{activeEngagements.length}</p>
            <p className="mt-1 text-2xs text-[var(--ficap-muted)]">Excludes completed and cancelled engagements.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="label">Remediation plans</p>
            <p className="mt-1 text-2xl font-semibold text-navy-900">{remediation.reduce((sum: number, row: any) => sum + Number(row.count), 0)}</p>
            <p className="mt-1 text-2xs text-[var(--ficap-muted)]">Plans are auto-created with each confirmed finding.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="label">Severity of highest open finding</p>
            <div className="mt-1 flex items-center gap-2">
              <SeverityBadge severity={SEVERITIES.find((s) => severityMap[s] > 0) ?? 'unscored'} />
            </div>
            <p className="mt-1 text-2xs text-[var(--ficap-muted)]">Based on CVSS v4.0 base scores.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
