import Link from 'next/link';
import { pageContext, query, param, flashFrom } from '@/lib/page-context';
import { listEvidence } from '@/lib/domain/evidence';
import { listArtifacts } from '@/lib/domain/artifacts';
import { listInstitutions } from '@/lib/domain/institutions';
import { can } from '@/lib/rbac';
import {
  Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, StatCard, EmptyState, Flash, DataQualityNote, formatDate,
} from '@/components/ui';
import { setEvidenceSharingAction, verifyEvidenceIntegrityAction } from '@/app/actions/governance';
import { scannerConfigured, scannerDescription } from '@/lib/evidence-scan';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext(['evidence:read', 'finding:read']);
  const flash = flashFrom(params);
  const institutionId = param(params, 'institutionId');

  const [evidence, artifacts, institutions] = await query(ctx, (tx) =>
    Promise.all([listEvidence(tx, ctx, { institutionId }), listArtifacts(tx, ctx, { institutionId }), listInstitutions(tx, ctx, {})]),
  );

  const scannerReady = scannerConfigured();
  const scannerNote = scannerDescription();
  const shared = evidence.filter((row: any) => row.share_with_institution).length;
  const restricted = evidence.filter((row: any) => row.classification === 'restricted').length;
  const expiring = evidence.filter((row: any) => row.retention_until && new Date(row.retention_until).getTime() < Date.now() + 30 * 86400000).length;

  return (
    <>
      <PageHeader
        title="Evidence governance"
        description="Every evidence body is encrypted at rest, hashed on write and released only to roles holding the download permission. Institution access is granted explicitly, per item."
        meta={<><Badge tone="slate">{evidence.length} records</Badge><Badge tone="navy">{shared} shared with institutions</Badge>{expiring ? <Badge tone="amber">{expiring} near retention expiry</Badge> : null}</>}
        actions={
          <form method="get" className="flex items-end gap-2">
            <select name="institutionId" defaultValue={institutionId ?? ''} className="input py-1 text-2xs" aria-label="Institution">
              <option value="">All institutions</option>
              {institutions.map((institution: any) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
            </select>
            <button className="btn btn-secondary btn-xs" type="submit">Filter</button>
          </form>
        }
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Evidence records" value={evidence.length} tone="navy" hint="Across your authorised scope" />
        <StatCard label="Restricted" value={restricted} tone="red" hint="Never released without explicit authorisation" />
        <StatCard label="Redacted on capture" value={evidence.filter((row: any) => row.redacted).length} tone="green" hint="Secrets removed before storage" />
        <StatCard label="Uploaded artefacts" value={artifacts.length} tone="slate" hint="Packages, manifests and specifications" />
      </div>

      <Card className="mb-4">
        <CardHeader title="Evidence records" subtitle="Integrity can be re-verified at any time; a mismatch is reported as a failure, never as a pass." />
        {evidence.length ? (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Title</th><th>Kind</th><th>Classification</th><th>SHA-256</th><th>Shared</th><th>Accessed</th><th>Retention</th><th /></tr></thead>
              <tbody>
                {evidence.map((row: any) => (
                  <tr key={row.id}>
                    <td className="max-w-[22rem] text-2xs">{row.title}<div className="text-[var(--ficap-muted)]">{formatDate(row.created_at)}</div></td>
                    <td className="text-2xs">{row.kind}</td>
                    <td className="text-2xs"><Badge tone={row.classification === 'restricted' ? 'red' : row.classification === 'confidential' ? 'amber' : 'slate'}>{row.classification}</Badge></td>
                    <td className="font-mono text-2xs">{String(row.body_sha256).slice(0, 20)}…</td>
                    <td className="text-2xs">{row.share_with_institution ? 'yes' : 'no'}</td>
                    <td className="font-mono text-2xs">{row.accessed_count}</td>
                    <td className="whitespace-nowrap text-2xs">{row.retention_until ? formatDate(row.retention_until) : 'not set'}</td>
                    <td className="space-x-1 text-right">
                      {can(ctx.user, 'evidence:download') ? <a className="btn btn-ghost btn-xs" href={`/api/evidence/${row.id}`}>Download</a> : null}
                      {can(ctx.user, 'evidence:share') ? (
                        <form action={setEvidenceSharingAction} className="inline">
                          <Csrf />
                          <input type="hidden" name="evidenceId" value={row.id} />
                          <input type="hidden" name="share" value={row.share_with_institution ? 'false' : 'true'} />
                          <input type="hidden" name="returnTo" value="/evidence" />
                          <button className="btn btn-ghost btn-xs" type="submit">{row.share_with_institution ? 'Withdraw' : 'Share'}</button>
                        </form>
                      ) : null}
                      <form action={verifyEvidenceIntegrityAction} className="inline">
                        <Csrf />
                        <input type="hidden" name="evidenceId" value={row.id} />
                        <input type="hidden" name="returnTo" value="/evidence" />
                        <button className="btn btn-ghost btn-xs" type="submit">Verify</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody><EmptyState title="No evidence in scope" description="Evidence is captured by assessment checks and by assessors reviewing a finding." /></CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Uploaded artefacts"
          subtitle="Packages and specifications are treated as untrusted input: they are stored encrypted, parsed offline, never executed on the application server, and never served while quarantined."
          actions={<Badge tone={scannerReady ? 'green' : 'amber'}>{scannerReady ? 'Scanner configured' : 'Scanning not configured'}</Badge>}
        />
        {!scannerReady ? (
          <CardBody className="border-b border-[var(--ficap-border)]">
            <p className="text-2xs leading-relaxed text-[var(--ficap-muted)]">{scannerNote}</p>
          </CardBody>
        ) : null}
        {artifacts.length ? (
          <TableWrap>
            <table className="table">
              <thead><tr><th>File</th><th>Kind</th><th>Size</th><th>SHA-256</th><th>Status</th><th>Malware scan</th><th>Uploaded</th><th>By</th><th /></tr></thead>
              <tbody>
                {artifacts.map((row: any) => (
                  <tr key={row.id}>
                    <td className="font-mono text-2xs">{row.filename}</td>
                    <td className="text-2xs uppercase">{row.kind}</td>
                    <td className="font-mono text-2xs">{Math.round(Number(row.size_bytes) / 1024)} KB</td>
                    <td className="font-mono text-2xs">{String(row.sha256).slice(0, 20)}…</td>
                    <td className="text-2xs"><Badge tone={row.status === 'analyzed' ? 'green' : row.status === 'quarantined' ? 'red' : 'slate'}>{row.status}</Badge></td>
                    <td className="text-2xs">
                      <Badge tone={row.analysis?.scan?.state === 'clean' ? 'green' : row.analysis?.scan?.state === 'infected' ? 'red' : row.analysis?.scan?.state === 'error' ? 'amber' : 'slate'}>
                        {row.analysis?.scan?.state === 'clean' ? 'clean' : row.analysis?.scan?.state === 'infected' ? 'detected' : row.analysis?.scan?.state === 'error' ? 'scanner error' : 'not scanned'}
                      </Badge>
                      {row.analysis?.scan?.detail ? <div className="mt-0.5 max-w-[200px] text-[10px] leading-snug text-[var(--ficap-muted)]">{row.analysis.scan.detail}</div> : null}
                    </td>
                    <td className="whitespace-nowrap text-2xs">{formatDate(row.uploaded_at)}</td>
                    <td className="text-2xs">{row.uploaded_by_name ?? '—'}</td>
                    <td className="text-right">
                      {row.status === 'quarantined' ? <span className="text-[10px] text-risk-critical">withheld</span> : <a className="btn btn-ghost btn-xs" href={`/api/artifacts/${row.id}/download`}>Download</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <p className="prose-note">
              No artefact uploaded. Upload a signed package, lockfile or API specification from an application page to enable mobile, dependency or API analysis.
              <Link className="link ml-1" href="/applications">Open application inventory</Link>
            </p>
          </CardBody>
        )}
      </Card>

      <div className="mt-4">
        <DataQualityNote>
          Evidence is never placed in public storage and is never embedded in a report. Reports carry a manifest of hashes so a reviewer can confirm that the
          artefact behind a conclusion is unchanged. Binaries are never rendered inline; downloads are served as attachments with a restrictive policy.
        </DataQualityNote>
      </div>
    </>
  );
}
