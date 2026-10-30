import Link from 'next/link';
import { pageContext, query, param } from '@/lib/page-context';
import { RISK_DIMENSIONS } from '@/lib/domain/risk';
import { Card, CardHeader, CardBody, PageHeader, Badge, SeverityBadge, TableWrap, StatCard, EmptyState, DataQualityNote, relativeDays } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function RiskWorkspacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('finding:read');
  const view = param(params, 'view') ?? 'matrix';
  const institutionId = param(params, 'institutionId');

  const data = await query(ctx, async (tx) => {
    const params: unknown[] = [ctx.mode];
    const clause = institutionId ? 'AND f.institution_id = $2' : '';
    if (institutionId) params.push(institutionId);
    const findings = await tx.query<any>(
      `SELECT f.id, f.reference, f.title, f.technical_severity, f.cvss_score, f.contextual_rating, f.contextual_score,
              f.priority_rank, f.status, f.category, f.is_systemic, f.verified_at, i.name AS institution_name,
              (SELECT r.dimensions FROM risk_assessments r WHERE r.finding_id = f.id ORDER BY r.created_at DESC LIMIT 1) AS dimensions,
              (SELECT count(*)::int FROM risk_assessments r WHERE r.finding_id = f.id) AS assessment_count
         FROM findings f JOIN institutions i ON i.id = f.institution_id
        WHERE f.data_mode = $1 ${clause}
        ORDER BY f.priority_rank ASC NULLS LAST, f.cvss_score DESC NULLS LAST LIMIT 300`,
      params,
    );
    const repeat = await tx.query<any>(
      `SELECT fingerprint, count(DISTINCT institution_id)::int AS institutions, count(*)::int AS occurrences,
              min(title) AS title, max(technical_severity) AS severity
         FROM findings WHERE data_mode = $1 GROUP BY fingerprint
        HAVING count(DISTINCT institution_id) > 1 ORDER BY institutions DESC LIMIT 12`,
      [ctx.mode],
    );
    const exceptions = await tx.query<any>(
      `SELECT f.id, f.reference, f.title, f.priority_reason, f.technical_severity, f.updated_at, i.name AS institution_name
         FROM findings f JOIN institutions i ON i.id = f.institution_id
        WHERE f.data_mode = $1 AND f.status = 'accepted_risk' ORDER BY f.updated_at DESC LIMIT 20`,
      [ctx.mode],
    );
    const institutions = await tx.query<any>('SELECT id, name FROM institutions WHERE data_mode = $1 ORDER BY name', [ctx.mode]);
    return { findings, repeat, exceptions, institutions };
  });

  const open = data.findings.filter((row: any) => !['resolved', 'closed', 'false_positive'].includes(row.status));
  const unassessed = open.filter((row: any) => !row.contextual_rating).length;
  const criticalHigh = open.filter((row: any) => ['critical', 'high'].includes(row.technical_severity)).length;
  const disputed = open.filter((row: any) => row.contextual_rating && ['low', 'none'].includes(row.contextual_rating) && ['critical', 'high'].includes(row.technical_severity)).length;

  const link = (next: string) => `/risk?view=${next}${institutionId ? `&institutionId=${institutionId}` : ''}`;

  return (
    <>
      <PageHeader
        title="Risk intelligence"
        description="Technical severity and contextual banking risk are maintained as separate records. Contextual judgement never rewrites a CVSS score; the two are combined only in the remediation priority, with the reason recorded."
        meta={
          <>
            <Badge tone="slate">{data.findings.length} findings in scope</Badge>
            <Badge tone="red">{criticalHigh} critical/high open</Badge>
            <Badge tone="amber">{unassessed} without contextual assessment</Badge>
            {disputed ? <Badge tone="navy">{disputed} technical/contextual divergence</Badge> : null}
          </>
        }
        actions={
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="view" value={view} />
            <label className="block">
              <span className="label">Institution</span>
              <select name="institutionId" defaultValue={institutionId ?? ''} className="input mt-1">
                <option value="">All institutions</option>
                {data.institutions.map((institution: any) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
              </select>
            </label>
            <button className="btn btn-secondary" type="submit">Apply</button>
          </form>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Critical" value={open.filter((row: any) => row.technical_severity === 'critical').length} tone="red" hint="CVSS v4.0 9.0–10.0" />
        <StatCard label="High" value={open.filter((row: any) => row.technical_severity === 'high').length} tone="amber" hint="CVSS v4.0 7.0–8.9" />
        <StatCard label="Repeat patterns" value={data.repeat.length} tone="navy" hint="Same weakness in two or more institutions" />
        <StatCard label="Accepted risk" value={data.exceptions.length} tone="slate" hint="Requires documented supervisory rationale" />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {[
          ['matrix', 'Technical × contextual matrix'],
          ['register', 'Risk register'],
          ['repeat', 'Repeat findings'],
          ['exceptions', 'Risk exceptions'],
          ['method', 'Method'],
        ].map(([key, label]) => (
          <Link key={key} href={link(key)} className={`btn btn-xs ${view === key ? 'btn-primary' : 'btn-secondary'}`}>{label}</Link>
        ))}
      </div>

      {view === 'matrix' ? (
        <Card>
          <CardHeader title="Technical severity against contextual banking risk" subtitle="Each cell counts findings. Divergent cells (high technical, low context or the reverse) deserve an explicit rationale in the finding record." />
          <CardBody>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Technical ↓ / Contextual →</th>
                    {['critical', 'high', 'medium', 'low', 'not assessed'].map((band) => <th key={band} className="text-center capitalize">{band}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {['critical', 'high', 'medium', 'low', 'none', 'unscored'].map((technical) => (
                    <tr key={technical}>
                      <th scope="row" className="capitalize">{technical}</th>
                      {['critical', 'high', 'medium', 'low'].map((contextual) => {
                        const count = open.filter((row: any) => row.technical_severity === technical && row.contextual_rating === contextual).length;
                        const tone = (technical === 'critical' || contextual === 'critical') ? 'bg-risk-critical/10 text-risk-critical' : (technical === 'high' || contextual === 'high') ? 'bg-amber-50 text-amber-800' : count ? 'bg-slate-50' : '';
                        return <td key={contextual} className={`text-center font-mono ${tone}`}>{count || '·'}</td>;
                      })}
                      <td className="text-center font-mono">{open.filter((row: any) => row.technical_severity === technical && !row.contextual_rating).length || '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 text-2xs leading-relaxed text-[var(--ficap-muted)]">
              A finding is never discounted to Low contextual risk solely because a compensating control is claimed. Where a control is asserted, the evidence
              for it is recorded on the finding and reviewed like any other claim.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {view === 'register' ? (
        <Card>
          <CardHeader title="Risk register" subtitle="Ordered by remediation priority. Priority combines technical severity and contextual risk; the CVSS score itself is untouched." />
          {open.length ? (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Reference</th><th>Finding</th><th>Institution</th><th>Technical</th><th>Contextual</th><th>Priority</th><th>Status</th><th>Assessed</th></tr></thead>
                <tbody>
                  {open.map((row: any) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap font-mono text-2xs"><Link href={`/findings/${row.id}`} className="link">{row.reference}</Link></td>
                      <td className="max-w-[22rem] text-2xs"><Link href={`/findings/${row.id}`} className="link">{row.title}</Link><div className="text-2xs text-[var(--ficap-muted)]">{row.category}{row.is_systemic ? ' · recurring' : ''}</div></td>
                      <td className="text-2xs">{row.institution_name}</td>
                      <td><SeverityBadge severity={row.technical_severity} score={row.cvss_score} /></td>
                      <td className="text-2xs capitalize">{row.contextual_rating ? `${row.contextual_rating} (${Number(row.contextual_score).toFixed(1)})` : <span className="text-amber-700">not assessed</span>}</td>
                      <td className="text-2xs">{row.priority_rank ? <Badge tone="navy">P{row.priority_rank}</Badge> : '—'}</td>
                      <td className="text-2xs capitalize">{row.status.replace(/_/g, ' ')}</td>
                      <td className="text-2xs">{row.assessment_count ? relativeDays(row.updated_at ?? null) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody><EmptyState title="No open findings" description="Nothing is currently open within your authorised scope." /></CardBody>
          )}
        </Card>
      ) : null}

      {view === 'repeat' ? (
        <Card>
          <CardHeader title="Repeat and systemic patterns" subtitle="Grouped by weakness fingerprint across institutions. A repeat pattern is a supervisory signal, not an automatic finding against any institution." />
          <CardBody>
            {data.repeat.length ? (
              <ul className="space-y-2">
                {data.repeat.map((row: any) => (
                  <li key={row.fingerprint} className="rounded border border-[var(--ficap-border)] p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium">{row.title}</span>
                      <span className="flex items-center gap-2 text-2xs">
                        <Badge tone="navy">{row.institutions} institutions</Badge>
                        <Badge tone="slate">{row.occurrences} occurrences</Badge>
                        <SeverityBadge severity={row.severity} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="prose-note">No weakness has been recorded in more than one institution yet.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {view === 'exceptions' ? (
        <Card>
          <CardHeader title="Accepted risk" subtitle="Acceptance requires a written rationale, is time-bound by review, and remains visible in reporting." />
          {data.exceptions.length ? (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Reference</th><th>Finding</th><th>Institution</th><th>Rationale</th><th>Updated</th></tr></thead>
                <tbody>
                  {data.exceptions.map((row: any) => (
                    <tr key={row.id}>
                      <td className="font-mono text-2xs"><Link href={`/findings/${row.id}`} className="link">{row.reference}</Link></td>
                      <td className="max-w-[20rem] text-2xs">{row.title}</td>
                      <td className="text-2xs">{row.institution_name}</td>
                      <td className="max-w-[24rem] text-2xs">{row.priority_reason ?? 'No rationale recorded — incomplete acceptance.'}</td>
                      <td className="whitespace-nowrap text-2xs">{relativeDays(row.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody><p className="prose-note">No finding is currently accepted as a risk.</p></CardBody>
          )}
        </Card>
      ) : null}

      {view === 'method' ? (
        <Card>
          <CardHeader title="How contextual risk is calculated" subtitle="Deterministic, documented, and reviewable. Nothing here changes the CVSS v4.0 score." />
          <CardBody>
            <TableWrap>
              <table className="table">
                <thead><tr><th>Dimension</th><th>Weight</th><th>What it captures</th><th>Options</th></tr></thead>
                <tbody>
                  {RISK_DIMENSIONS.map((dimension) => (
                    <tr key={dimension.key}>
                      <td className="text-2xs font-medium">{dimension.label}</td>
                      <td className="font-mono text-2xs">{dimension.weight}</td>
                      <td className="text-2xs">{dimension.help}</td>
                      <td className="text-2xs">{dimension.options.map((option) => `${option.value} ${option.label}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 text-2xs leading-relaxed text-[var(--ficap-muted)]">
              The weighted score is normalised to 0–100 and banded: 75+ critical, 55+ high, 35+ medium, otherwise low. Remediation priority =
              round((0.45 × technical + 0.55 × contextual) × 10) / 10, where technical and contextual are 0–4 indices. The formula is applied by the server; a
              browser-submitted score is never trusted.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-4">
        <DataQualityNote>
          Technical severity answers “how bad is this weakness in general?”. Contextual risk answers “what does it mean for this institution's banking operations?”.
          Keeping them apart prevents a business justification from silently downgrading a technical defect.
        </DataQualityNote>
      </div>
    </>
  );
}
