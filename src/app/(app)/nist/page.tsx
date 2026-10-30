import Link from 'next/link';
import { pageContext, query, param, flashFrom } from '@/lib/page-context';
import { CSF_STATUS_LABELS, ensureProfiles, getProfile, summariseProfile } from '@/lib/domain/nist';
import { listInstitutions } from '@/lib/domain/institutions';
import { can } from '@/lib/rbac';
import {
  Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, EmptyState, Flash, Field, DataQualityNote, formatDate,
} from '@/components/ui';
import { updateNistEntryAction, addImprovementActionAction } from '@/app/actions/governance';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

export default async function NistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('institution:read');
  const flash = flashFrom(params);

  const institutions = await query(ctx, (tx) => listInstitutions(tx, ctx, {}));
  const selectedId = param(params, 'institutionId') ?? institutions[0]?.id;
  const canEdit = can(ctx.user, 'finding:update') || can(ctx.user, 'supervisory_note:write');

  const data = selectedId
    ? await query(ctx, async (tx) => {
        await ensureProfiles(tx, selectedId, ctx.user.id);
        const profile = await getProfile(tx, selectedId);
        return { profile, summary: summariseProfile(profile.entries, profile.functions, profile.findingsByOutcome) };
      })
    : null;

  const current = data?.profile.profiles.find((row: any) => row.profile_type === 'current');
  const target = data?.profile.profiles.find((row: any) => row.profile_type === 'target');
  const currentEntries = (data?.profile.entries ?? []).filter((entry: any) => entry.profile_id === current?.id);
  const targetEntries = (data?.profile.entries ?? []).filter((entry: any) => entry.profile_id === target?.id);
  const targetByCode = new Map(targetEntries.map((entry: any) => [entry.item_code, entry]));
  const selectedInstitution = institutions.find((row: any) => row.id === selectedId);

  return (
    <>
      <PageHeader
        title="NIST Cybersecurity Framework 2.0 profiles"
        description="GOVERN / IDENTIFY / PROTECT / DETECT / RESPOND / RECOVER outcomes recorded as evidence statuses. This is not an official maturity score and is never derived from vulnerability counts."
        meta={
          <>
            {current ? <Badge tone="navy">current profile</Badge> : null}
            {target ? <Badge tone="slate">target profile</Badge> : null}
            {selectedInstitution ? <Badge tone="neutral">{selectedInstitution.name}</Badge> : null}
          </>
        }
        actions={
          <form method="get" className="flex items-end gap-2">
            <select name="institutionId" defaultValue={selectedId ?? ''} className="input py-1 text-2xs" aria-label="Institution">
              {institutions.map((institution: any) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
            </select>
            <button className="btn btn-secondary btn-xs" type="submit">Open</button>
          </form>
        }
      />

      <Flash notice={flash.notice} error={flash.error} />

      {!data ? (
        <Card><CardBody><EmptyState title="No institution in scope" description="Register an institution before recording a CSF profile." /></CardBody></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card>
              <CardHeader title="Profile by function" subtitle="Each cell counts outcomes in that evidence status. Gaps are recorded as improvement actions, not as scores." />
              <CardBody>
                {data.summary.byFunction.length ? (
                  <TableWrap>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Function</th>
                          <th>Not assessed</th>
                          <th>Evidence required</th>
                          <th>Partially supported</th>
                          <th>Supported</th>
                          <th>Improvement required</th>
                          <th>Linked findings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.summary.byFunction.map((row: any) => (
                          <tr key={row.code}>
                            <td className="text-2xs font-medium">{row.code.toUpperCase()} · {row.title}</td>
                            {['not_assessed', 'evidence_required', 'partially_supported', 'supported', 'improvement_required'].map((status) => (
                              <td key={status} className="text-right font-mono text-2xs">{row.counts[status] ?? 0}</td>
                            ))}
                            <td className="text-right font-mono text-2xs">{row.linkedFindings || '·'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                ) : (
                  <p className="prose-note">The CSF catalogue has no function recorded. Import the official CSF 2.0 catalogue from platform configuration.</p>
                )}
                <p className="mt-3 text-2xs leading-relaxed text-[var(--ficap-muted)]">
                  Status definitions: {Object.entries(CSF_STATUS_LABELS).map(([key, label]) => `${label} (${key})`).join(' · ')}.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Outcome register"
                subtitle="Current profile against the target profile. Statuses describe the evidence held, not a compliance claim."
                actions={<Badge tone="slate">{currentEntries.length} recorded</Badge>}
              />
              {currentEntries.length ? (
                <TableWrap maxHeight="620px">
                  <table className="table">
                    <thead><tr><th>Outcome</th><th>Title</th><th>Current status</th><th>Target</th><th>Evidence summary</th><th /></tr></thead>
                    <tbody>
                      {currentEntries.map((entry: any) => (
                        <tr key={entry.id}>
                          <td className="whitespace-nowrap font-mono text-2xs">{entry.item_code}</td>
                          <td className="max-w-[22rem] text-2xs">{entry.title ?? '—'}</td>
                          <td className="text-2xs"><Badge tone={entry.status === 'supported' ? 'green' : entry.status === 'improvement_required' ? 'red' : entry.status === 'not_assessed' ? 'slate' : 'amber'}>{CSF_STATUS_LABELS[entry.status] ?? entry.status}</Badge></td>
                          <td className="text-2xs">{targetByCode.get(entry.item_code) ? <span className="capitalize">{String((targetByCode.get(entry.item_code) as any).status).replace(/_/g, ' ')}</span> : '—'}</td>
                          <td className="max-w-[24rem] text-2xs">{entry.evidence_summary ?? '—'}</td>
                          <td className="text-right">
                            {canEdit ? (
                              <details>
                                <summary className="btn btn-ghost btn-xs cursor-pointer">Update</summary>
                                <form action={updateNistEntryAction} className="mt-2 w-64 space-y-2 rounded border border-[var(--ficap-border)] p-2">
                                  <Csrf />
                                  <input type="hidden" name="profileId" value={current?.id} />
                                  <input type="hidden" name="itemCode" value={entry.item_code} />
                                  <input type="hidden" name="institutionId" value={selectedId} />
                                  <Field label="Status" name={`status-${entry.item_code}`}>
                                    <select name="status" className="input" defaultValue={entry.status}>
                                      {Object.entries(CSF_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                                    </select>
                                  </Field>
                                  <Field label="Evidence summary" name={`evidence-${entry.item_code}`}>
                                    <textarea name="evidenceSummary" rows={2} className="input" defaultValue={entry.evidence_summary ?? ''} />
                                  </Field>
                                  <button className="btn btn-primary btn-xs" type="submit">Save</button>
                                </form>
                              </details>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <CardBody><p className="prose-note">No outcome has been recorded for this institution yet. An empty profile is reported as not assessed.</p></CardBody>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Evidence status legend" />
              <CardBody>
                <ul className="space-y-1 text-2xs text-[var(--ficap-muted)]">
                  <li><strong className="text-[var(--ficap-fg)]">Not assessed</strong> — no review has been performed.</li>
                  <li><strong className="text-[var(--ficap-fg)]">Evidence required</strong> — a claim exists but supporting evidence has not been supplied.</li>
                  <li><strong className="text-[var(--ficap-fg)]">Partially supported</strong> — evidence covers part of the outcome.</li>
                  <li><strong className="text-[var(--ficap-fg)]">Supported</strong> — evidence reviewed and accepted for this outcome.</li>
                  <li><strong className="text-[var(--ficap-fg)]">Improvement required</strong> — evidence shows a material gap.</li>
                </ul>
                <p className="mt-2 text-2xs text-[var(--ficap-muted)]">No aggregated “maturity level” is calculated. Presenting one would misrepresent a status census as an official NIST rating.</p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Improvement actions" subtitle="Gaps turned into owned, dated work." />
              <CardBody>
                {data.profile.actions.length ? (
                  <ul className="space-y-2 text-2xs">
                    {data.profile.actions.map((action: any) => (
                      <li key={action.id} className="rounded border border-[var(--ficap-border)] p-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{action.title}</span>
                          <Badge tone={action.status === 'completed' ? 'green' : action.status === 'in_progress' ? 'navy' : 'slate'}>{String(action.status).replace(/_/g, ' ')}</Badge>
                        </div>
                        <div className="text-[var(--ficap-muted)]">{action.item_code ?? 'no outcome'} · {action.owner ?? 'unassigned'} · due {action.due_date ? formatDate(action.due_date) : 'not set'}</div>
                        {action.description ? <p className="mt-1">{action.description}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="prose-note">No improvement action recorded.</p>
                )}
                {canEdit ? (
                  <form action={addImprovementActionAction} className="mt-3 space-y-2 border-t border-[var(--ficap-border)] pt-3">
                    <Csrf />
                    <input type="hidden" name="institutionId" value={selectedId} />
                    <Field label="Outcome (optional)" name="itemCode"><input name="itemCode" className="input font-mono" placeholder="PR.AA-05" /></Field>
                    <Field label="Action" name="title" required><input name="title" className="input" required /></Field>
                    <Field label="Owner" name="owner"><input name="owner" className="input" /></Field>
                    <Field label="Target date" name="dueDate"><input name="dueDate" type="date" className="input" /></Field>
                    <button className="btn btn-primary btn-sm" type="submit">Add action</button>
                  </form>
                ) : null}
              </CardBody>
            </Card>

            <DataQualityNote>
              CSF outcomes are recorded per institution and per review. Technical findings can indicate where evidence is likely to be missing, but a finding count
              is never converted into a maturity level.
            </DataQualityNote>
          </div>
        </div>
      )}
    </>
  );
}
