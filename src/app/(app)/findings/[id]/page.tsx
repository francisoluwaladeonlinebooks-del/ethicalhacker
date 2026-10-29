import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/ids';
import { pageContext, query } from '@/lib/page-context';
import { TRANSITIONS, FINDING_STATUS_LABELS, getFindingDetail } from '@/lib/domain/findings';
import { listFrameworks } from '@/lib/domain/frameworks';
import { RISK_DIMENSIONS } from '@/lib/domain/risk';
import { can } from '@/lib/rbac';
import { NotFoundError } from '@/lib/errors';
import {
  addFrameworkLinkAction, assessRiskAction, completeRetestAction, createRetestAction, generateAiSuggestionAction,
  reviewAiSuggestionAction, scoreFindingAction, submitRemediationAction, transitionFindingAction,
  updateFindingAction, updateRemediationPlanAction, verifyRetestAction,
} from '@/app/actions/assessments';
import {
  Card, CardHeader, CardBody, PageHeader, Badge, SeverityBadge, StatusBadge, DescriptionList,
  TableWrap, Field, EmptyState, DataQualityNote, formatDate, relativeDays,
} from '@/components/ui';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

const METRIC_LABELS: Record<string, string> = {
  AV: 'Attack Vector', AC: 'Attack Complexity', AT: 'Attack Requirements', PR: 'Privileges Required',
  UI: 'User Interaction', VC: 'Vuln. Confidentiality', VI: 'Vuln. Integrity', VA: 'Vuln. Availability',
  SC: 'Subseq. Confidentiality', SI: 'Subseq. Integrity', SA: 'Subseq. Availability',
};

export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await pageContext('finding:read');
  const detail = await query(ctx, async (tx) => {
    try {
      const data = await getFindingDetail(tx, ctx, id);
      const frameworks = await listFrameworks(tx);
      return { ...data, frameworks };
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  });
  if (!detail) notFound();

  const { finding, frameworkLinks, evidence, history, scores, risks, remediation, submissions, retests, suggestions, frameworks } = detail as any;
  const vector = scores[0]?.vector ?? finding.cvss_vector;
  const metrics = scores[0]?.metrics ?? null;
  const latestRisk = risks[0] ?? null;
  const nextStatuses: string[] = TRANSITIONS[finding.status as keyof typeof TRANSITIONS] ?? [];
  const canUpdate = can(ctx.user, 'finding:update');
  const canVerify = can(ctx.user, 'finding:verify');

  return (
    <>
      <PageHeader
        title={`${finding.reference} · ${finding.title}`}
        description={
          <span>
            {finding.category}{finding.subcategory ? ` / ${finding.subcategory}` : ''} · {finding.institution_name}
            {finding.application_name ? ` · ${finding.application_name}` : ''} · engagement <Link className="link" href={`/engagements/${finding.engagement_id}`}>{finding.engagement_code}</Link>
          </span>
        }
        meta={
          <>
            <SeverityBadge severity={finding.technical_severity} score={finding.cvss_score} />
            <StatusBadge status={finding.status} />
            {finding.priority_rank ? <Badge tone="navy">P{finding.priority_rank} priority</Badge> : null}
            {finding.verified_at ? <Badge tone="green">verified {relativeDays(finding.verified_at)}</Badge> : <Badge tone="amber">not independently verified</Badge>}
            {finding.is_systemic ? <Badge tone="red">recurring across institutions</Badge> : null}
          </>
        }
        actions={
          <>
            <Link href="/findings" className="btn btn-secondary">All findings</Link>
            {can(ctx.user, 'report:generate') ? <Link href={`/reports?engagementId=${finding.engagement_id}`} className="btn btn-primary">Reports</Link> : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Technical description" subtitle={`Detected by ${finding.detection_method.replace(/_/g, ' ')} · confidence ${finding.confidence}`} />
            <CardBody>
              <p className="prose-note whitespace-pre-wrap">{finding.description}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="label">Affected asset</p>
                  <p className="mt-1 font-mono text-2xs">{finding.asset ?? 'not recorded'}</p>
                </div>
                <div>
                  <p className="label">Endpoint</p>
                  <p className="mt-1 font-mono text-2xs">{finding.endpoint ?? 'not recorded'}</p>
                </div>
              </div>
              {finding.business_impact ? (
                <div className="mt-4 rounded border border-[var(--ficap-border)] bg-[var(--ficap-surface-2)] p-3">
                  <p className="label">Business impact</p>
                  <p className="mt-1 text-xs leading-relaxed">{finding.business_impact}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="CVSS v4.0"
              subtitle="Official Base/Threat/Environmental arithmetic. The score is never adjusted for business context."
              actions={vector ? <span className="font-mono text-2xs text-[var(--ficap-muted)]">{vector}</span> : null}
            />
            <CardBody>
              {vector ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <span className="text-2xl font-semibold tabular-nums">{Number(scores[0]?.score ?? finding.cvss_score).toFixed(1)}</span>
                    <SeverityBadge severity={strings(scores[0]?.severity ?? finding.technical_severity)} />
                    <span className="text-2xs text-[var(--ficap-muted)]">spec version {scores[0]?.spec_version ?? '4.0'}</span>
                  </div>
                  {metrics ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-3">
                      {Object.entries(METRIC_LABELS).map(([key, label]) => (
                        <div key={key} className="flex justify-between border-b border-dashed border-[var(--ficap-border)] py-1">
                          <span className="text-[var(--ficap-muted)]">{label}</span>
                          <span className="font-mono font-medium">{String((metrics as any)[key] ?? '—')}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {scores[0]?.rationale ? <p className="mt-3 text-2xs text-[var(--ficap-muted)]">{scores[0].rationale}</p> : null}
                </>
              ) : (
                <div className="mb-3">
                  <p className="prose-note">This finding has not been scored. An unscored finding is reported as an observation, never as a pass.</p>
                </div>
              )}
              {canUpdate ? (
                <form action={scoreFindingAction} className="mt-3 space-y-2 border-t border-[var(--ficap-border)] pt-3">
                  <Csrf />
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Field label="CVSS v4.0 vector" name="vector" hint="Must begin CVSS:4.0/ and include the eleven base metrics. The server recalculates the score; a submitted score is ignored.">
                    <input name="vector" className="input font-mono text-2xs" placeholder="CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N" defaultValue={vector ?? ''} required />
                  </Field>
                  <Field label="Scoring rationale" name="rationale">
                    <input name="rationale" className="input" placeholder="Why these metric values were chosen" />
                  </Field>
                  <button className="btn btn-secondary btn-sm" type="submit">Record score</button>
                </form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Contextual banking risk" subtitle="Stored separately from CVSS. Priority combines technical severity (45%) with this rating (55%) and never rewrites the score." />
            <CardBody>
              {latestRisk ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <span className="text-xl font-semibold tabular-nums">{Number(latestRisk.score).toFixed(1)}<span className="text-2xs text-[var(--ficap-muted)]">/100</span></span>
                    <Badge tone={latestRisk.rating === 'critical' || latestRisk.rating === 'high' ? 'red' : latestRisk.rating === 'medium' ? 'amber' : 'green'}>{latestRisk.rating}</Badge>
                    <span className="text-2xs text-[var(--ficap-muted)]">assessed {relativeDays(latestRisk.created_at)}</span>
                  </div>
                  <p className="text-2xs leading-relaxed text-[var(--ficap-muted)]">{latestRisk.rationale}</p>
                </>
              ) : (
                <p className="prose-note">No contextual assessment recorded. The finding is ranked on technical severity only.</p>
              )}
              {canUpdate ? (
                <form action={assessRiskAction} className="mt-3 grid gap-2 border-t border-[var(--ficap-border)] pt-3 sm:grid-cols-3">
                  <Csrf />
                  <input type="hidden" name="findingId" value={finding.id} />
                  {RISK_DIMENSIONS.map((dimension) => (
                    <Field key={dimension.key} label={dimension.label} name={dimension.key} hint={`weight ${dimension.weight}`}>
                      <select name={dimension.key} className="input" defaultValue="0">
                        {dimension.options.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </Field>
                  ))}
                  <div className="sm:col-span-3">
                    <Field label="Rationale" name="rationale">
                      <input name="rationale" className="input" placeholder="Record how the banking context was judged" />
                    </Field>
                  </div>
                  <div className="sm:col-span-3">
                    <button className="btn btn-secondary btn-sm" type="submit">Record contextual assessment</button>
                  </div>
                </form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Framework references" subtitle="Only defensible mappings. Each reference is validated against the pinned catalogue version." />
            {frameworkLinks.length ? (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Framework</th><th>Version</th><th>Item</th><th>Relationship</th><th>Rationale</th></tr></thead>
                  <tbody>
                    {frameworkLinks.map((link: any) => (
                      <tr key={link.id}>
                        <td className="text-2xs">{link.framework_key}</td>
                        <td className="font-mono text-2xs">{link.framework_version}</td>
                        <td className="font-mono text-2xs">{link.item_code}</td>
                        <td className="text-2xs capitalize">{link.relationship.replace(/_/g, ' ')}</td>
                        <td className="text-2xs">{link.rationale ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <CardBody><p className="prose-note">No framework reference recorded. A finding is not required to map to every framework.</p></CardBody>
            )}
            {canUpdate ? (
              <CardBody>
                <form action={addFrameworkLinkAction} className="grid gap-2 sm:grid-cols-5">
                  <Csrf />
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Field label="Framework" name="frameworkKey">
                    <select name="frameworkKey" className="input" required>
                      {frameworks.map((framework: any) => (
                        <option key={`${framework.key}-${framework.version}`} value={framework.key}>{framework.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Version" name="frameworkVersion">
                    <select name="frameworkVersion" className="input" required>
                      {frameworks.map((framework: any) => (
                        <option key={`v-${framework.key}-${framework.version}`} value={framework.version}>{framework.key} {framework.version}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Item code" name="itemCode"><input name="itemCode" className="input font-mono" placeholder="WSTG-SESS-02" required /></Field>
                  <Field label="Relationship" name="relationship">
                    <select name="relationship" className="input">
                      <option value="supports">supports</option>
                      <option value="root_cause">root cause</option>
                      <option value="affected_control">affected control</option>
                      <option value="related">related</option>
                    </select>
                  </Field>
                  <div className="flex items-end"><button className="btn btn-secondary btn-sm" type="submit">Add reference</button></div>
                </form>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Evidence" subtitle="Bodies are encrypted at rest and released only to authorised roles. Hashes support integrity verification." />
            {evidence.length ? (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Title</th><th>Kind</th><th>Classification</th><th>SHA-256</th><th>Recorded</th><th /></tr></thead>
                  <tbody>
                    {evidence.map((item: any) => (
                      <tr key={item.id}>
                        <td className="text-2xs">{item.title}<div className="text-2xs text-[var(--ficap-muted)]">{item.caption ?? ''}</div></td>
                        <td className="text-2xs">{item.kind}</td>
                        <td className="text-2xs capitalize">{item.classification}</td>
                        <td className="font-mono text-2xs">{String(item.body_sha256).slice(0, 16)}…</td>
                        <td className="whitespace-nowrap text-2xs">{formatWhen(item.created_at)}</td>
                        <td className="text-right">
                          {can(ctx.user, 'evidence:download') ? <a className="btn btn-ghost btn-xs" href={`/api/evidence/${item.id}`}>Open</a> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <CardBody><p className="prose-note">No evidence attached. A confirmed finding should normally carry at least one evidence item.</p></CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Remediation plan" subtitle="Closure requires an independent retest, not just a submitted fix." />
            <CardBody>
              {remediation ? (
                <form action={updateRemediationPlanAction} className="grid gap-2 sm:grid-cols-2">
                  <Csrf />
                  <input type="hidden" name="planId" value={remediation.id} />
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Field label="Root cause" name="rootCause" span={2}><textarea name="rootCause" rows={2} className="input" defaultValue={remediation.root_cause ?? ''} /></Field>
                  <Field label="Containment" name="containment"><textarea name="containment" rows={2} className="input" defaultValue={remediation.containment ?? ''} /></Field>
                  <Field label="Short-term fix" name="shortTerm"><textarea name="shortTerm" rows={2} className="input" defaultValue={remediation.short_term ?? ''} /></Field>
                  <Field label="Permanent fix" name="permanentFix"><textarea name="permanentFix" rows={2} className="input" defaultValue={remediation.permanent_fix ?? ''} /></Field>
                  <Field label="Verification criteria" name="verificationCriteria"><textarea name="verificationCriteria" rows={2} className="input" defaultValue={remediation.verification_criteria ?? ''} /></Field>
                  <Field label="Owner team" name="ownerTeam"><input name="ownerTeam" className="input" defaultValue={remediation.owner_team ?? ''} /></Field>
                  <Field label="Target date" name="targetDate"><input name="targetDate" type="date" className="input" defaultValue={remediation.target_date ? String(remediation.target_date).slice(0, 10) : ''} /></Field>
                  <div className="sm:col-span-2">
                    <button className="btn btn-secondary btn-sm" type="submit" disabled={!can(ctx.user, 'finding:update')}>Save plan</button>
                    <Badge tone={remediation.status === 'verified' ? 'green' : remediation.status === 'submitted' ? 'amber' : 'slate'}>{remediation.status}</Badge>
                  </div>
                </form>
              ) : (
                <p className="prose-note">No remediation plan exists for this finding.</p>
              )}

              {can(ctx.user, 'remediation:submit') && remediation ? (
                <form action={submitRemediationAction} className="mt-4 space-y-2 border-t border-[var(--ficap-border)] pt-3">
                  <Csrf />
                  <input type="hidden" name="planId" value={remediation.id} />
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Field label="Submit remediation for verification" name="notes" hint="Describe exactly what changed. The claim is verified independently before the finding can close.">
                    <textarea name="notes" rows={2} className="input" required minLength={10} />
                  </Field>
                  <button className="btn btn-primary btn-sm" type="submit">Submit for verification</button>
                </form>
              ) : null}

              {submissions.length ? (
                <ul className="mt-4 space-y-2 text-2xs">
                  {submissions.map((submission: any) => (
                    <li key={submission.id} className="rounded border border-[var(--ficap-border)] p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{submission.status.replace(/_/g, ' ')}</span>
                        <span className="text-[var(--ficap-muted)]">{formatWhen(submission.created_at, true)}</span>
                      </div>
                      <p className="mt-1">{submission.notes}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Retesting" subtitle="An automated retest only completes when the engine records an outcome; a queued retest is not a pass." />
            {retests.length ? (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Requested</th><th>Status</th><th>Result</th><th>Verified</th><th /></tr></thead>
                  <tbody>
                    {retests.map((retest: any) => (
                      <tr key={retest.id}>
                        <td className="whitespace-nowrap text-2xs">{formatWhen(retest.created_at)}</td>
                        <td className="text-2xs capitalize">{retest.status.replace(/_/g, ' ')}</td>
                        <td className="text-2xs">{retest.result ?? 'pending'}</td>
                        <td className="text-2xs">{retest.verified_at ? formatWhen(retest.verified_at) : '—'}</td>
                        <td className="space-x-1 text-right">
                          {can(ctx.user, 'retest:perform') && retest.status !== 'completed' ? (
                            <form action={completeRetestAction} className="inline-flex items-center gap-1">
                              <Csrf />
                              <input type="hidden" name="retestId" value={retest.id} />
                              <select name="result" className="input py-0 text-2xs" aria-label="Retest result">
                                <option value="resolved">resolved</option>
                                <option value="not_resolved">not resolved</option>
                                <option value="partial">partial</option>
                                <option value="inconclusive">inconclusive</option>
                              </select>
                              <input name="notes" className="input py-0 text-2xs" placeholder="notes" required />
                              <button className="btn btn-ghost btn-xs" type="submit">Record</button>
                            </form>
                          ) : null}
                          {can(ctx.user, 'retest:verify') && retest.result && !retest.verified_at ? (
                            <form action={verifyRetestAction} className="inline">
                              <Csrf />
                              <input type="hidden" name="retestId" value={retest.id} />
                              <button className="btn btn-secondary btn-xs" type="submit">Verify</button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <CardBody><p className="prose-note">No retest recorded for this finding.</p></CardBody>
            )}
            {can(ctx.user, 'retest:request') && ['confirmed', 'ready_for_retest', 'remediation_in_progress', 'reopened'].includes(finding.status) ? (
              <CardBody>
                <form action={createRetestAction} className="flex flex-wrap items-end gap-2">
                  <Csrf />
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Field label="Request a retest" name="notes"><input name="notes" className="input" placeholder="What will be re-checked and under which approval" /></Field>
                  <button className="btn btn-secondary btn-sm" type="submit">Request retest</button>
                </form>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Lifecycle" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Status', value: <StatusBadge status={finding.status} /> },
                  { label: 'Created', value: formatWhen(finding.created_at, true) },
                  { label: 'Last change', value: relativeDays(finding.updated_at) },
                  { label: 'Verified by', value: finding.verified_by_name ?? 'not verified' },
                  { label: 'Reopened', value: String(finding.reopened_count ?? 0) },
                  { label: 'Owner team', value: finding.owner_team ?? 'not recorded' },
                  { label: 'Due', value: finding.due_date ? formatWhen(finding.due_date) : 'not set' },
                ]}
              />
              {(canUpdate || canVerify) && nextStatuses.length ? (
                <form action={transitionFindingAction} className="mt-3 space-y-2 border-t border-[var(--ficap-border)] pt-3">
                  <Csrf />
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Field label="Move to" name="toStatus">
                    <select name="toStatus" className="input" required>
                      {nextStatuses.map((status) => <option key={status} value={status}>{FINDING_STATUS_LABELS[status as keyof typeof FINDING_STATUS_LABELS]}</option>)}
                    </select>
                  </Field>
                  <Field label="Note" name="note"><input name="note" className="input" placeholder="Recorded in the change history" /></Field>
                  <button className="btn btn-secondary btn-sm" type="submit">Apply transition</button>
                </form>
              ) : null}
            </CardBody>
          </Card>

          {canUpdate ? (
            <Card>
              <CardHeader title="Assessor notes" />
              <CardBody>
                <form action={updateFindingAction} className="space-y-2">
                  <Csrf />
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Field label="Business impact" name="businessImpact"><textarea name="businessImpact" rows={2} className="input" defaultValue={finding.business_impact ?? ''} /></Field>
                  <Field label="Remediation summary" name="remediationSummary"><textarea name="remediationSummary" rows={2} className="input" defaultValue={finding.remediation_summary ?? ''} /></Field>
                  <Field label="Root cause" name="rootCause"><textarea name="rootCause" rows={2} className="input" defaultValue={finding.root_cause ?? ''} /></Field>
                  <Field label="Compensating controls" name="compensatingControls"><textarea name="compensatingControls" rows={2} className="input" defaultValue={finding.compensating_controls ?? ''} /></Field>
                  <button className="btn btn-secondary btn-sm" type="submit">Save notes</button>
                </form>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Assistant suggestions" subtitle="Suggestions only. Never treated as a finding, never auto-applied, and clearly labelled." />
            <CardBody>
              {suggestions.length ? (
                <ul className="space-y-2">
                  {suggestions.map((suggestion: any) => (
                    <li key={suggestion.id} className="rounded border border-amber-200 bg-amber-50 p-2 text-2xs">
                      <div className="flex items-center justify-between">
                        <Badge tone="amber">assistant suggestion · {suggestion.status}</Badge>
                        <span className="text-[var(--ficap-muted)]">{formatWhen(suggestion.created_at)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{typeof suggestion.output === 'string' ? suggestion.output : JSON.stringify(suggestion.output)}</p>
                      {suggestion.status === 'suggested' && can(ctx.user, 'ai:use') ? (
                        <form action={reviewAiSuggestionAction} className="mt-1 flex gap-1">
                          <Csrf />
                          <input type="hidden" name="suggestionId" value={suggestion.id} />
                          <input type="hidden" name="findingId" value={finding.id} />
                          <button className="btn btn-ghost btn-xs" name="decision" value="accepted" type="submit">Accept</button>
                          <button className="btn btn-ghost btn-xs" name="decision" value="rejected" type="submit">Reject</button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="prose-note">No suggestion generated. Assistant output is optional and requires explicit review.</p>
              )}
              {can(ctx.user, 'ai:use') ? (
                <form action={generateAiSuggestionAction} className="mt-3 flex items-end gap-2">
                  <Csrf />
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Field label="Draft" name="kind">
                    <select name="kind" className="input">
                      <option value="suggest_remediation">Remediation wording</option>
                      <option value="explain_finding">Plain-language explanation</option>
                      <option value="suggest_root_cause">Possible root cause</option>
                      <option value="suggest_verification_steps">Verification steps</option>
                      <option value="suggest_framework_mapping">Possible framework mapping</option>
                    </select>
                  </Field>
                  <button className="btn btn-secondary btn-sm" type="submit">Generate suggestion</button>
                </form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Change history" subtitle="Append-only record of every status and content change." />
            <CardBody>
              {history.length ? (
                <ol className="space-y-2 text-2xs">
                  {history.map((event: any) => (
                    <li key={event.id} className="border-l-2 border-[var(--ficap-border)] pl-2">
                      <div className="font-medium">{event.action.replace(/_/g, ' ')}{event.to_status ? ` → ${event.to_status}` : ''}</div>
                      <div className="text-[var(--ficap-muted)]">{event.actor_name ?? 'system'} · {formatWhen(event.created_at, true)}</div>
                      {event.note ? <p>{event.note}</p> : null}
                      {event.changes ? <p className="font-mono text-[10px] text-[var(--ficap-muted)]">{JSON.stringify(event.changes).slice(0, 160)}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState title="No history yet" description="History is written as the finding is triaged." />
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <DataQualityNote>
          A finding represents an observed condition, not proof of exploitability. Suspected items must be verified before they are counted as confirmed.
          Evidence is confidential by default and every access is recorded in the audit trail.
        </DataQualityNote>
      </div>
    </>
  );
}

function formatWhen(value: unknown, _withTime = true): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function strings(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}
