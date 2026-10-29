import { pageContext, query, flashFrom } from '@/lib/page-context';
import { listSettings, platformHealth, isKillSwitchEngaged } from '@/lib/domain/settings';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, Field, Flash, DescriptionList, DataQualityNote, formatDate } from '@/components/ui';
import { updateSettingAction } from '@/app/actions/admin';
import { verifyDemoDatasetAction } from '@/app/actions/supervision';
import { globalKillSwitchAction } from '@/app/actions/supervision';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

const SETTING_LABELS: Record<string, string> = {
  global_kill_switch: 'Global kill switch — halt every active assessment immediately',
  platform_mode: 'Platform mode (demo or live)',
  ai_enabled: 'Optional AI analyst suggestions',
  require_independent_verification: 'Require independent verification before a finding can be confirmed',
  require_report_approval: 'Require independent approval before a report can be published',
  default_max_requests_per_second: 'Default request rate limit for new engagements',
  default_max_requests_total: 'Default request budget for new engagements',
  evidence_retention_days: 'Default evidence retention (days)',
  session_idle_minutes: 'Session idle timeout (minutes)',
  max_failed_logins: 'Failed sign-in attempts before temporary lock',
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('settings:manage');
  const flash = flashFrom(params);

  const data = await query(ctx, async (tx) => {
    const [settings, health] = await Promise.all([listSettings(tx, ctx), platformHealth(tx, ctx)]);
    const killSwitch = await isKillSwitchEngaged(tx);
    const counts = await tx.queryOne<any>(
      `SELECT
         (SELECT count(*)::int FROM institutions WHERE data_mode = 'demo') AS demo_institutions,
         (SELECT count(*)::int FROM findings WHERE data_mode = 'demo') AS demo_findings,
         (SELECT count(*)::int FROM findings WHERE data_mode = 'live') AS live_findings`,
    );
    return { settings, health, killSwitch, counts };
  });

  const demo = (process.env.FICAP_MODE ?? 'demo') === 'demo';

  return (
    <>
      <PageHeader
        title="Platform configuration"
        description="Operational safety controls, security policy toggles and evidence handling. Every change is audited with the acting administrator."
        meta={
          <>
            <Badge tone={demo ? 'amber' : 'green'}>{demo ? 'demonstration mode' : 'live mode'}</Badge>
            <Badge tone={data.killSwitch ? 'red' : 'green'}>{data.killSwitch ? 'kill switch engaged' : 'assessments enabled'}</Badge>
            <Badge tone="slate">{data.settings.length} settings</Badge>
          </>
        }
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Emergency stop" subtitle="Halts every queued and running assessment at the next check boundary. Scope is not affected and no result is fabricated." />
            <CardBody>
              {data.killSwitch ? (
                <div className="rounded border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-risk-critical">The global kill switch is engaged. No assessment can start or continue.</p>
                  <p className="mt-1 text-2xs text-red-900">Release only after the cause has been recorded and the incident reviewed.</p>
                </div>
              ) : (
                <p className="text-2xs text-[var(--ficap-muted)]">Engaging the switch stops all assessment execution immediately. Use it when scope, authorisation or safety is in doubt.</p>
              )}
              <form action={globalKillSwitchAction} className="mt-3 flex flex-wrap items-end gap-2">
                <Csrf />
                <input type="hidden" name="engaged" value={data.killSwitch ? 'false' : 'true'} />
                <Field label="Reason (recorded)" name="reason" required>
                  <input name="reason" className="input" required minLength={8} placeholder="Why the stop is being engaged or released" />
                </Field>
                <button className={`btn ${data.killSwitch ? 'btn-primary' : 'btn-danger'}`} type="submit">
                  {data.killSwitch ? 'Release kill switch' : 'Engage global stop'}
                </button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Security and safety settings" subtitle="Secret values are masked and never returned to the browser." />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Setting</th><th>Value</th><th>Description</th><th>Updated</th><th /></tr></thead>
                <tbody>
                  {data.settings.map((setting: any) => (
                    <tr key={setting.key}>
                      <td className="text-2xs"><div className="font-medium">{SETTING_LABELS[setting.key] ?? setting.key}</div><div className="font-mono text-[10px] text-[var(--ficap-muted)]">{setting.key}</div></td>
                      <td className="font-mono text-2xs">{setting.masked ? <span title="Masked secret">{setting.value || '—'}</span> : String(typeof setting.value === 'object' ? JSON.stringify(setting.value) : setting.value)}</td>
                      <td className="max-w-[18rem] text-2xs">{setting.description}</td>
                      <td className="whitespace-nowrap text-2xs">{formatDate(setting.updated_at)}</td>
                      <td className="text-right">
                        <details>
                          <summary className="btn btn-ghost btn-xs cursor-pointer">Change</summary>
                          <form action={updateSettingAction} className="mt-2 w-56 space-y-2 rounded border border-[var(--ficap-border)] p-2">
                            <Csrf />
                            <input type="hidden" name="key" value={setting.key} />
                            <input name="value" className="input" disabled={setting.masked} placeholder={setting.masked ? 'Secret value cannot be read back' : 'New value'} />
                            <button className="btn btn-primary btn-xs" type="submit" disabled={setting.masked}>Save</button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Platform health" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Audit records', value: String(data.health.auditStats?.total ?? 0) },
                  { label: 'Last audit event', value: data.health.auditStats?.last ? formatDate(data.health.auditStats.last, true) : '—' },
                  { label: 'Evidence records', value: String(data.health.evidenceStats?.total ?? 0) },
                  { label: 'Evidence bytes stored', value: `${Math.round(Number(data.health.evidenceStats?.bytes ?? 0) / 1024)} KB` },
                  { label: 'Running jobs', value: String(data.health.jobs.find((job: any) => job.status === 'running')?.count ?? 0) },
                  { label: 'Queued jobs', value: String(data.health.jobs.find((job: any) => job.status === 'queued')?.count ?? 0) },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Demonstration data" subtitle="Demonstration records are tagged and never mixed with live supervisory records." />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Demo institutions', value: data.counts?.demo_institutions ?? 0 },
                  { label: 'Demo findings', value: data.counts?.demo_findings ?? 0 },
                  { label: 'Live findings', value: data.counts?.live_findings ?? 0 },
                ]}
              />
              <form action={verifyDemoDatasetAction} className="mt-3">
                <Csrf />
                <button className="btn btn-secondary btn-sm" type="submit">Verify demonstration dataset</button>
              </form>
              <p className="mt-2 text-2xs text-[var(--ficap-muted)]">
                Rebuilding the dataset is a deliberate operator action: <code className="font-mono">npm run db:reset &amp;&amp; npm run db:seed</code>. It is not exposed
                as an in-app button so a demonstration reset can never be mistaken for a live operation.
              </p>
            </CardBody>
          </Card>

          <DataQualityNote>
            Safety controls are default-on: rate limits, request budgets, scope re-validation before every request and the global kill switch. Disabling a safety
            control is recorded as a deliberate, reasoned administrative action.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
