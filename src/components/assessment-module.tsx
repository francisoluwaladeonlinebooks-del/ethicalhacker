import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card, CardBody, CardHeader, DataQualityNote, EmptyState, PageHeader, StatCard, StatusBadge, TableWrap, formatDate } from '@/components/ui';

export type CheckRow = {
  key: string;
  title: string;
  frameworkItemCode?: string;
  frameworkKey?: string;
  automation?: string;
  requires?: string[];
};

export type ManualRow = { code: string; prerequisite: string };

/**
 * Shared layout for the four assessment module pages. Each page lists the
 * checks the engine can actually perform, the manual tests that require an
 * explicit prerequisite, and the most recent recorded results. Nothing on the
 * page implies that a check ran when it did not.
 */
export function AssessmentModule({
  moduleKey,
  title,
  description,
  frameworkNote,
  checks,
  manualTests,
  prerequisites,
  applications,
  selectedApplication,
  results,
  lastJob,
  actions,
  scopeNote,
}: {
  moduleKey: string;
  title: string;
  description: string;
  frameworkNote: ReactNode;
  checks: CheckRow[];
  manualTests: ManualRow[];
  prerequisites: { label: string; met: boolean; detail: string }[];
  applications: any[];
  selectedApplication?: string;
  results: any[];
  lastJob: any;
  actions?: ReactNode;
  scopeNote: ReactNode;
}) {
  const automated = checks.filter((check) => check.automation !== 'manual');
  const passed = results.filter((row) => row.status === 'passed').length;
  const failed = results.filter((row) => row.status === 'failed').length;
  const blocked = results.filter((row) => ['blocked', 'error', 'not_assessed'].includes(row.status)).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        meta={
          <>
            <Badge tone="navy">{moduleKey}</Badge>
            <Badge tone="slate">{automated.length} automated checks</Badge>
            <Badge tone="amber">{manualTests.length} manual cases requiring prerequisites</Badge>
          </>
        }
        actions={actions}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Results recorded" value={results.length} hint={selectedApplication ? 'For the selected application' : 'Across all applications in this mode'} />
        <StatCard label="Passed" value={passed} tone="green" />
        <StatCard label="Failed (findings raised)" value={failed} tone="red" />
        <StatCard label="Blocked / not assessed" value={blocked} tone="amber" hint="Excluded from coverage claims" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="What this module executes" subtitle="Every check writes a result row whether it passes, fails, or is blocked." />
          <TableWrap maxHeight="420px">
            <table className="table">
              <thead>
                <tr><th>Check</th><th>Framework item</th><th>Automation</th><th>Requires</th></tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.key}>
                    <td>
                      <span className="text-xs font-medium text-navy-900">{check.title}</span>
                      <p className="font-mono text-[10px] text-[var(--ficap-muted)]">{check.key}</p>
                    </td>
                    <td className="font-mono text-2xs">{check.frameworkItemCode ?? '—'}</td>
                    <td className="text-2xs capitalize">{check.automation ?? 'automated'}</td>
                    <td className="text-2xs text-[var(--ficap-muted)]">{(check.requires ?? []).join(', ') || 'authorised scope only'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Prerequisites" subtitle="When a prerequisite is missing the dependent checks are recorded as blocked, with the reason." />
            <CardBody className="space-y-1.5">
              {prerequisites.map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-2 text-xs">
                  <span>
                    {item.label}
                    <span className="block text-2xs text-[var(--ficap-muted)]">{item.detail}</span>
                  </span>
                  <Badge tone={item.met ? 'green' : 'amber'}>{item.met ? 'available' : 'missing'}</Badge>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Application filter" subtitle="Results are always filtered to an application you may see." />
            <CardBody>
              <form method="get" className="space-y-2">
                <label className="label" htmlFor="applicationId">Application</label>
                <select id="applicationId" name="applicationId" defaultValue={selectedApplication ?? ''} className="select">
                  <option value="">All applications</option>
                  {applications.map((application: any) => (
                    <option key={application.id} value={application.id}>{application.name}</option>
                  ))}
                </select>
                <button type="submit" className="btn btn-primary w-full">Apply filter</button>
              </form>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Manual test cases" subtitle="These require an approved identity, device or environment. They are recorded as blocked until the prerequisite is supplied." />
        <TableWrap maxHeight="320px">
          <table className="table">
            <thead><tr><th>Framework item</th><th>Prerequisite</th><th>Recorded state</th></tr></thead>
            <tbody>
              {manualTests.map((test) => (
                <tr key={test.code}>
                  <td className="font-mono text-2xs">{test.code}</td>
                  <td className="text-2xs">{test.prerequisite}</td>
                  <td><Badge tone="amber">blocked until prerequisite</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader
          title="Recorded results"
          subtitle="Newest first. A result row records the expected and observed behaviour and links to the evidence where one was captured."
          actions={lastJob ? <Link href={`/jobs/${lastJob.id}`} className="btn btn-secondary btn-xs">Last job</Link> : undefined}
        />
        {results.length ? (
          <TableWrap maxHeight="440px">
            <table className="table">
              <thead><tr><th>Framework</th><th>Item</th><th>Check</th><th>Status</th><th>Observed</th><th>Executed</th></tr></thead>
              <tbody>
                {results.map((row: any) => (
                  <tr key={row.id}>
                    <td className="text-2xs">{row.framework_key}</td>
                    <td className="font-mono text-2xs">{row.framework_item_code}</td>
                    <td className="font-mono text-[10px] text-[var(--ficap-muted)]">{row.check_key}</td>
                    <td><StatusBadge status={row.status} /></td>
                    <td className="max-w-[380px] text-2xs text-[var(--ficap-muted)]">{row.observed ?? '—'}</td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(row.executed_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <EmptyState
              title="No results recorded"
              description="This module has not produced results for the selected application. An approved engagement, an approved plan and a queued job are required before any check runs."
            />
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Framework alignment" />
        <CardBody className="space-y-2 text-xs leading-relaxed text-[var(--ficap-text)]">
          {frameworkNote}
          <div className="pt-1">{scopeNote}</div>
        </CardBody>
      </Card>

      <DataQualityNote>
        Automated coverage is not a certification of compliance. A control that was not tested, or that was tested only by an automated check, is
        reported as such and is never described as compliant or effective.
      </DataQualityNote>
    </div>
  );
}
