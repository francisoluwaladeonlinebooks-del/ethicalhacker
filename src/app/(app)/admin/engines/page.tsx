import { pageContext, query, flashFrom } from '@/lib/page-context';
import { platformHealth } from '@/lib/domain/settings';
import { isKillSwitchEngaged } from '@/lib/domain/settings';
import { WEB_CHECKS } from '@/lib/engines/web';
import { apiChecks } from '@/lib/engines/api';
import { mobileChecks } from '@/lib/engines/mobile';
import { dependencyChecks } from '@/lib/engines/deps';
import { CURATED_PROVENANCE } from '@/lib/engines/vuln-intel';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, Flash, DescriptionList, DataQualityNote, formatDate, ProgressBar } from '@/components/ui';
import { toggleEngineAction } from '@/app/actions/admin';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

export default async function EnginesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('engine:manage');
  const flash = flashFrom(params);

  const data = await query(ctx, async (tx) => {
    const [health, killSwitch] = await Promise.all([platformHealth(tx, ctx), isKillSwitchEngaged(tx)]);
    const recent = await tx.query<any>(
      `SELECT j.id, j.module, j.status, j.progress, j.error, j.blocked_reason, j.started_at, j.finished_at,
              a.name AS application_name, i.name AS institution_name
         FROM assessment_jobs j LEFT JOIN applications a ON a.id = j.application_id
         JOIN institutions i ON i.id = j.institution_id
        ORDER BY j.created_at DESC LIMIT 12`,
    );
    return { health, killSwitch, recent };
  });

  const checkCounts = {
    web: WEB_CHECKS.length,
    api: apiChecks(() => null).length,
    mobile: mobileChecks(async () => null).length,
    dependencies: dependencyChecks(async () => ({ dependencies: [], sources: [], secrets: [], licenses: [], notes: [] }), { corpus: [], provenance: CURATED_PROVENANCE, notes: [] }).length,
  };

  const prerequisites: Record<string, { label: string; met: boolean; detail: string }[]> = {
    web: [
      { label: 'Outbound network egress to approved targets', met: false, detail: 'Sandbox deployments normally cannot reach institution hosts; requests are recorded as blocked with the reason.' },
      { label: 'Target allowlist enforced per request', met: true, detail: 'Applied by the assessment client on every hop, including redirects.' },
    ],
    api: [
      { label: 'Specification import (OpenAPI / Postman)', met: true, detail: 'Available offline; parsing is bounded and never executes the specification.' },
      { label: 'Two synthetic identities for object-level authorisation', met: false, detail: 'Required for API1/API5 cases. Absent identities produce blocked checks, never passes.' },
    ],
    mobile: [
      { label: 'Signed package uploaded', met: true, detail: 'Static analysis runs entirely offline in the platform.' },
      { label: 'Device farm for dynamic testing', met: Boolean(process.env.FICAP_DEVICE_FARM_URL), detail: 'Without a device farm, dynamic MASTG cases are recorded as blocked.' },
    ],
    dependencies: [
      { label: 'Vulnerability intelligence snapshot', met: Date.now() - new Date(CURATED_PROVENANCE.updatedAt || Date.now()).getTime() < 180 * 86400000, detail: `${CURATED_PROVENANCE.source} · updated ${CURATED_PROVENANCE.updatedAt}` },
      { label: 'Exploitation of identified CVEs', met: false, detail: 'Never performed. A vulnerability identifier is evidence of a version, not of exploitability.' },
    ],
  };

  return (
    <>
      <PageHeader
        title="Assessment engine health"
        description="Each module is independently disableable. A disabled module cannot be launched, and a check that cannot run is recorded as blocked — never as a pass."
        meta={
          <>
            <Badge tone={data.killSwitch ? 'red' : 'green'}>{data.killSwitch ? 'global stop engaged' : 'execution permitted'}</Badge>
            <Badge tone="slate">{data.health.engines.length} engines</Badge>
          </>
        }
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-4 xl:grid-cols-2">
        {data.health.engines.map((engine: any) => {
          const key = String(engine.key);
          const checks = checkCounts[key as keyof typeof checkCounts] ?? 0;
          const requires = Array.isArray(engine.requires) ? engine.requires : [];
          const running = Number(engine.running_jobs ?? 0);
          const failed = Number(engine.failed_jobs ?? 0);
          const enabled = engine.status === 'enabled';
          return (
            <Card key={engine.id}>
              <CardHeader
                title={`${engine.name} · v${engine.version}`}
                subtitle={`${checks} implemented check(s) · ${requires.length} declared dependency(ies)`}
                actions={<Badge tone={enabled ? 'green' : 'slate'}>{enabled ? 'enabled' : engine.status}</Badge>}
              />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: 'Running jobs', value: running },
                    { label: 'Failed jobs', value: failed },
                    { label: 'Last success', value: engine.last_success ? formatDate(engine.last_success, true) : 'never' },
                    { label: 'Minimal privileges', value: 'read-only analysis, no shell, no platform database access' },
                  ]}
                />
                <div className="mt-3">
                  <p className="label">Prerequisites</p>
                  <ul className="mt-1 space-y-1">
                    {prerequisites[key]?.map((item) => (
                      <li key={item.label} className="flex items-start gap-2 text-2xs">
                        <span className={item.met ? 'text-seal-700' : 'text-amber-700'} aria-hidden="true">{item.met ? '●' : '○'}</span>
                        <span><span className="font-medium">{item.label}</span> — <span className="text-[var(--ficap-muted)]">{item.detail}</span></span>
                      </li>
                    )) ?? <li className="text-2xs text-[var(--ficap-muted)]">No prerequisite declared.</li>}
                  </ul>
                </div>
                {requires.length ? <p className="mt-2 font-mono text-[10px] text-[var(--ficap-muted)]">requires: {requires.join(', ')}</p> : null}
                <form action={toggleEngineAction} className="mt-3 border-t border-[var(--ficap-border)] pt-3">
                  <Csrf />
                  <input type="hidden" name="engineKey" value={engine.key} />
                  <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
                  <button className={`btn btn-xs ${enabled ? 'btn-secondary' : 'btn-primary'}`} type="submit">{enabled ? 'Disable module' : 'Enable module'}</button>
                </form>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent job activity" subtitle="Failed and blocked jobs keep their reason so an operator can distinguish “nothing found” from “nothing ran”." />
        <TableWrap>
          <table className="table">
            <thead><tr><th>Job</th><th>Module</th><th>Institution / application</th><th>Status</th><th>Progress</th><th>Reason</th></tr></thead>
            <tbody>
              {data.recent.map((row: any) => (
                <tr key={row.id}>
                  <td className="font-mono text-2xs">{String(row.id).slice(0, 8)}</td>
                  <td className="text-2xs">{row.module}</td>
                  <td className="text-2xs">{row.institution_name}<div className="text-[var(--ficap-muted)]">{row.application_name ?? '—'}</div></td>
                  <td className="text-2xs"><Badge tone={row.status === 'succeeded' ? 'green' : row.status === 'failed' ? 'red' : row.status === 'blocked' ? 'amber' : 'slate'}>{row.status}</Badge></td>
                  <td className="w-32"><ProgressBar value={Number(row.progress ?? 0)} tone={row.status === 'failed' ? 'red' : row.status === 'blocked' ? 'amber' : 'navy'} /></td>
                  <td className="max-w-[24rem] text-2xs">{row.error ?? row.blocked_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="mt-4">
        <DataQualityNote>
          Assessment execution is isolated from the management plane: engines receive no platform credentials, cannot reach the platform database, and are bounded by
          request budgets, rate limits, timeouts and scope re-validation on every hop. Uploaded packages and target responses are treated as untrusted input.
        </DataQualityNote>
      </div>
    </>
  );
}
