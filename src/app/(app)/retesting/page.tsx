import Link from 'next/link';
import { pageContext, query, param, flashFrom } from '@/lib/page-context';
import { listRetests } from '@/lib/domain/remediation';
import { listInstitutions } from '@/lib/domain/institutions';
import { can } from '@/lib/rbac';
import {
  Card, CardHeader, CardBody, PageHeader, Badge, SeverityBadge, TableWrap, StatCard, EmptyState, Flash,
  Field, DataQualityNote, formatDate, relativeDays,
} from '@/components/ui';
import { completeRetestAction, createRetestAction, verifyRetestAction } from '@/app/actions/assessments';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

export default async function RetestingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext(['retest:request', 'retest:verify', 'finding:read']);
  const flash = flashFrom(params);
  const institutionId = param(params, 'institutionId');

  const [rows, institutions, candidates] = await query(ctx, (tx) =>
    Promise.all([
      listRetests(tx, ctx, institutionId),
      listInstitutions(tx, ctx, {}),
      tx.query<any>(
        `SELECT f.id, f.reference, f.title, f.status, f.technical_severity, i.name AS institution_name
           FROM findings f JOIN institutions i ON i.id = f.institution_id
          WHERE f.data_mode = $1 AND f.status IN ('confirmed','ready_for_retest','remediation_in_progress','reopened')
            ${institutionId ? 'AND f.institution_id = $2' : ''}
          ORDER BY f.priority_rank ASC NULLS LAST LIMIT 60`,
        institutionId ? [ctx.mode, institutionId] : [ctx.mode],
      ),
    ]),
  );

  const pending = rows.filter((row: any) => row.status === 'requested' || row.status === 'in_progress').length;
  const awaitingVerification = rows.filter((row: any) => row.result && !row.verified_at).length;
  const verified = rows.filter((row: any) => row.verified_at).length;

  return (
    <>
      <PageHeader
        title="Retesting workspace"
        description="Verification is a separate act from remediation. A retest records what was actually re-checked; closure requires the retest to be independently verified."
        meta={<><Badge tone="slate">{rows.length} retests</Badge>{pending ? <Badge tone="amber">{pending} outstanding</Badge> : null}</>}
        actions={<Link href="/remediation" className="btn btn-secondary">Remediation</Link>}
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Outstanding" value={pending} tone="amber" hint="Requested or in progress" />
        <StatCard label="Awaiting independent verification" value={awaitingVerification} tone="navy" hint="Result recorded, not yet verified" />
        <StatCard label="Verified" value={verified} tone="green" hint="Evidence accepted by a second person" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            <CardHeader
              title="Retest records"
              subtitle="An automated retest stays open until the engine records an outcome. A queued job is never reported as a pass."
              actions={
                <form method="get" className="flex items-end gap-2">
                  <select name="institutionId" defaultValue={institutionId ?? ''} className="input py-1 text-2xs" aria-label="Institution filter">
                    <option value="">All institutions</option>
                    {institutions.map((institution: any) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
                  </select>
                  <button className="btn btn-secondary btn-xs" type="submit">Filter</button>
                </form>
              }
            />
            {rows.length ? (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Finding</th><th>Institution</th><th>Requested</th><th>Status</th><th>Result</th><th>Verified</th><th /></tr></thead>
                  <tbody>
                    {rows.map((row: any) => (
                      <tr key={row.id}>
                        <td className="max-w-[20rem]">
                          <Link href={`/findings/${row.finding_id}`} className="link text-2xs font-medium">{row.finding_reference}</Link>
                          <div className="text-2xs text-[var(--ficap-muted)]">{row.title}</div>
                        </td>
                        <td className="text-2xs">{row.institution_name}</td>
                        <td className="whitespace-nowrap text-2xs">{relativeDays(row.created_at)}</td>
                        <td className="text-2xs capitalize">{String(row.status).replace(/_/g, ' ')}</td>
                        <td className="text-2xs">{row.result ? <Badge tone={row.result === 'resolved' ? 'green' : row.result === 'not_resolved' ? 'red' : 'amber'}>{String(row.result).replace(/_/g, ' ')}</Badge> : '—'}</td>
                        <td className="text-2xs">{row.verified_at ? <span className="text-seal-700">{formatDate(row.verified_at)}</span> : <span className="text-amber-700">not verified</span>}</td>
                        <td className="text-right">
                          {can(ctx.user, 'retest:perform') && row.status !== 'completed' ? (
                            <details>
                              <summary className="btn btn-ghost btn-xs cursor-pointer">Record</summary>
                              <form action={completeRetestAction} className="mt-2 w-60 space-y-2 rounded border border-[var(--ficap-border)] p-2">
                                <Csrf />
                                <input type="hidden" name="retestId" value={row.id} />
                                <Field label="Result" name={`result-${row.id}`}>
                                  <select name="result" className="input" required>
                                    <option value="resolved">resolved</option>
                                    <option value="not_resolved">not resolved</option>
                                    <option value="partial">partial</option>
                                    <option value="inconclusive">inconclusive</option>
                                  </select>
                                </Field>
                                <Field label="What was re-checked" name={`notes-${row.id}`}>
                                  <textarea name="notes" rows={2} className="input" required minLength={10} />
                                </Field>
                                <label className="flex items-center gap-1 text-2xs">
                                  <input type="checkbox" name="automated" value="on" /> Automated re-check (engine)
                                </label>
                                <button className="btn btn-primary btn-xs" type="submit">Save result</button>
                              </form>
                            </details>
                          ) : null}
                          {can(ctx.user, 'retest:verify') && row.result && !row.verified_at ? (
                            <form action={verifyRetestAction} className="mt-1">
                              <Csrf />
                              <input type="hidden" name="retestId" value={row.id} />
                              <button className="btn btn-secondary btn-xs" type="submit">Verify independently</button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <CardBody><EmptyState title="No retest requested" description="Request a retest from a confirmed finding once remediation work is claimed complete." /></CardBody>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Request a retest" subtitle="Only confirmed findings awaiting verification can be retested." />
            <CardBody>
              {candidates.length ? (
                <form action={createRetestAction} className="space-y-2">
                  <Csrf />
                  <Field label="Finding" name="findingId" required>
                    <select name="findingId" className="input" required>
                      {candidates.map((candidate: any) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.reference} · {candidate.institution_name} · {candidate.title.slice(0, 48)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Scope of the retest" name="notes" hint="Only the approved scope may be re-checked. A retest never expands the original authorisation.">
                    <textarea name="notes" rows={2} className="input" placeholder="What will be re-checked, on which asset, under which approval" />
                  </Field>
                  <button className="btn btn-primary btn-sm" type="submit">Request retest</button>
                </form>
              ) : (
                <p className="prose-note">No confirmed finding is currently awaiting a retest.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Verification rules" />
            <CardBody>
              <ul className="space-y-2 text-2xs leading-relaxed text-[var(--ficap-muted)]">
                <li>· A retest can only reference the original approved scope and testing window.</li>
                <li>· The assessor who requested a retest cannot be its sole verifier where separation of duties is configured.</li>
                <li>· “Resolved” requires a recorded observation that the original condition no longer reproduces.</li>
                <li>· Inconclusive results leave the finding open rather than closing it.</li>
                <li>· Automated retests that were blocked or skipped are recorded as such and never count as passes.</li>
              </ul>
            </CardBody>
          </Card>

          <DataQualityNote>
            Evidence attached to a retest is subject to the same encryption, redaction and access logging as any other evidence item.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
