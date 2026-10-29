import Link from 'next/link';
import { pageContext, query } from '@/lib/page-context';
import { Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, DataQualityNote, StatCard, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

type VerificationState = 'performed' | 'partial' | 'not_performed';

type Control = {
  area: string;
  claim: string;
  state: VerificationState;
  evidence: string;
  gap?: string;
};

/**
 * The verification dashboard states only what has actually been done in this
 * repository. It is deliberately unflattering: controls that exist but have not
 * been independently verified say so.
 */
const CONTROLS: Control[] = [
  {
    area: 'Authorisation and tenant isolation',
    claim: 'Role permissions and separation of duties are exercised by unit tests; row-level security is applied to every tenant table.',
    state: 'partial',
    evidence: 'tests/rbac.test.ts · schema.sql RLS policies (FORCE ROW LEVEL SECURITY) · manual HTTP checks of institution-scoped access',
    gap: 'No automated test drives two concurrent tenants through the HTTP surface. RLS behaviour is asserted by policy definition, not by a regression suite.',
  },
  {
    area: 'Scope enforcement',
    claim: 'Targets outside approved scope are refused, exclusions win, private and link-local addresses are blocked, and the training range requires explicit enablement.',
    state: 'performed',
    evidence: 'tests/scope.test.ts · src/lib/scope.ts · engines re-check scope per redirect hop',
    gap: 'DNS-rebinding resistance depends on the resolver honouring the pinned address set; this is implemented but not exercised against a hostile resolver.',
  },
  {
    area: 'CVSS v4.0 scoring',
    claim: 'Scores match the specification reference implementation across the full published macro-vector space.',
    state: 'performed',
    evidence: 'tests/cvss4.test.ts · tests/fixtures/cvss4-reference.json (6,502 vectors)',
  },
  {
    area: 'Evidence confidentiality and redaction',
    claim: 'Evidence is encrypted at rest, digest-verified on read, access-logged and redacted before storage; downloads are attachments with a restrictive CSP.',
    state: 'partial',
    evidence: 'tests/redact.test.ts · src/lib/domain/evidence.ts · /api/evidence/[id], /api/artifacts/[id]/download',
    gap: 'Redaction is pattern based. Novel secret formats can evade it; classification still requires reviewer judgement.',
  },
  {
    area: 'Registry integrity',
    claim: 'Ownership is never inferred, imports never auto-apply licence-category changes, and every change is audited.',
    state: 'performed',
    evidence: 'src/lib/domain/registry.ts · tests/registry.test.ts · registry reconciliation queue',
    gap: 'The demonstration dataset is synthetic; no real regulator feed has been ingested or reconciled.',
  },
  {
    area: 'Assessment engine isolation',
    claim: 'Engines run with an explicit capability list, quotas, timeouts, a response-size ceiling and a hard stop.',
    state: 'partial',
    evidence: 'src/lib/engines/* · job events and quotas in src/lib/domain/jobs.ts',
    gap: 'Isolation is in-process in this build. Container-level isolation and a network egress allowlist are deployment concerns that are documented, not demonstrated here.',
  },
  {
    area: 'Mobile assessment honesty',
    claim: 'Without a device, build and instrumentation harness the mobile module records blocked or static-only results.',
    state: 'performed',
    evidence: 'src/lib/engines/mobile.ts · blocked/skipped states rendered as such in coverage',
    gap: 'No dynamic instrumentation capability exists in this build, by design.',
  },
  {
    area: 'Framework catalogue fidelity',
    claim: 'Identifiers come only from imported official catalogues; unavailable content is marked pending import.',
    state: 'performed',
    evidence: 'src/lib/frameworks/catalog.ts · /admin/frameworks catalogue management',
    gap: 'Only WSTG, API Top 10, MASVS, MASTG and NIST CSF are present. Others must be imported before they can be referenced.',
  },
  {
    area: 'Independent security testing of this platform',
    claim: 'No independent penetration test, code review or certification has been performed on this codebase.',
    state: 'not_performed',
    evidence: 'Not applicable — no external assessment exists.',
    gap: 'Do not describe this platform as penetration-tested, certified or accredited.',
  },
  {
    area: 'Accessibility conformance',
    claim: 'The interface targets WCAG 2.2 AA with semantic landmarks, visible focus, keyboard operability and non-colour status cues.',
    state: 'partial',
    evidence: 'src/components/ui.tsx · skip link and focus styles in the app shell',
    gap: 'No assistive-technology audit or automated axe run has been completed. Treat conformance as intended, not certified.',
  },
];

const STATE_META: Record<VerificationState, { tone: 'green' | 'amber' | 'red'; label: string }> = {
  performed: { tone: 'green', label: 'Verified in this repository' },
  partial: { tone: 'amber', label: 'Partially verified' },
  not_performed: { tone: 'red', label: 'Not performed' },
};

export default async function VerificationPage() {
  const ctx = await pageContext(['settings:manage', 'audit:read']);

  const counts = await query(ctx, async (tx) => {
    const row = await tx.queryOne<any>(
      `SELECT
         (SELECT count(*)::int FROM audit_events WHERE data_mode = $1) AS audit_events,
         (SELECT count(*)::int FROM framework_items) AS framework_items,
         (SELECT count(*)::int FROM digital_assets WHERE data_mode = $1) AS assets,
         (SELECT count(*)::int FROM digital_assets WHERE data_mode = $1 AND status = 'ownership_verified') AS verified_assets,
         (SELECT max(at)::text FROM audit_events WHERE data_mode = $1) AS last_event`,
      [ctx.mode],
    );
    return row ?? {};
  });

  const performed = CONTROLS.filter((control) => control.state === 'performed').length;
  const partial = CONTROLS.filter((control) => control.state === 'partial').length;
  const notPerformed = CONTROLS.filter((control) => control.state === 'not_performed').length;

  return (
    <>
      <PageHeader
        title="Verification and assurance status"
        description="What this build has actually verified, what it has only partly verified, and what it has not verified at all. This page is intentionally conservative: it never upgrades an unverified control to a claim."
        meta={
          <>
            <Badge tone="slate">{ctx.mode === 'demo' ? 'Demonstration build' : 'Live build'}</Badge>
            <Badge tone="amber">{notPerformed} area(s) not verified</Badge>
          </>
        }
        actions={<Link href="/audit" className="btn btn-secondary">Audit trail</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Controls verified here" value={performed} hint="Exercised by an automated test or a recorded manual check in this repository" tone="green" />
        <StatCard label="Partially verified" value={partial} hint="Implemented and partly exercised; the stated gap still applies" tone="amber" />
        <StatCard label="Not verified at all" value={notPerformed} hint="Must not be described as done, tested or certified" tone="red" />
        <StatCard label="Audit events recorded" value={Number(counts.audit_events ?? 0)} hint={counts.last_event ? `latest ${formatDate(counts.last_event, true)}` : 'none yet'} tone="navy" />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Assurance matrix"
          subtitle="Each row names the evidence that exists and the gap that remains. A control that is implemented but untested is never reported as verified."
        />
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Control area</th>
                <th>State</th>
                <th>What is asserted</th>
                <th>Evidence</th>
                <th>Residual gap</th>
              </tr>
            </thead>
            <tbody>
              {CONTROLS.map((control) => {
                const meta = STATE_META[control.state];
                return (
                  <tr key={control.area}>
                    <td className="text-2xs font-medium">{control.area}</td>
                    <td className="text-2xs"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                    <td className="max-w-[280px] text-2xs leading-relaxed">{control.claim}</td>
                    <td className="max-w-[240px] text-[10px] leading-relaxed text-[var(--ficap-muted)]">{control.evidence}</td>
                    <td className="max-w-[260px] text-[10px] leading-relaxed text-[var(--ficap-muted)]">{control.gap ?? 'No material gap recorded.'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Secure development practices in force" subtitle="These are practices observed in the repository, not certifications." />
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-2">
              {[
                'Schema is declarative and idempotent; migrations never drop data silently.',
                'Every server action re-checks session, permission, CSRF token and scope.',
                'Parameterised SQL throughout; no string interpolation of user input.',
                'Input validation before writes; unknown enum values are rejected, not coerced.',
                'Errors return a stable public shape plus a correlation digest — no stack traces or SQL.',
                'Secrets are read from the environment and never written to the browser, logs or URLs.',
                'Evidence and artefacts are encrypted at rest and digest-verified on read.',
                'Destructive operations are separated from routine navigation and require explicit confirmation.',
                'Audit events are append-only and hash-chained at the database level.',
                'Demo and live data are separated by mode on every tenant-scoped query.',
              ].map((item) => (
                <li key={item} className="rounded border border-[var(--ficap-border)] px-2.5 py-2 text-2xs leading-relaxed">{item}</li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Dataset integrity" />
            <CardBody>
              <ul className="space-y-1.5 text-2xs">
                <li className="flex justify-between gap-2"><span>Catalogue items stored</span><span className="font-mono">{counts.framework_items ?? 0}</span></li>
                <li className="flex justify-between gap-2"><span>Digital assets recorded</span><span className="font-mono">{counts.assets ?? 0}</span></li>
                <li className="flex justify-between gap-2"><span>Ownership-verified assets</span><span className="font-mono">{counts.verified_assets ?? 0}</span></li>
                <li className="flex justify-between gap-2"><span>Mode</span><span className="font-mono">{ctx.mode}</span></li>
              </ul>
            </CardBody>
          </Card>
          <DataQualityNote>
            Independent verification is a prerequisite for any public claim about this platform. Until an external assessment is commissioned and recorded here,
            the absence of a finding must not be read as evidence that none exists.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
