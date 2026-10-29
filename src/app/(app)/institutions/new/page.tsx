import Link from 'next/link';
import { pageContext, flashFrom } from '@/lib/page-context';
import { createInstitutionAction } from '@/app/actions/supervision';
import { INSTITUTION_CATEGORIES, RISK_TIERS } from '@/lib/constants';
import { Card, CardBody, CardHeader, Field, Flash, PageHeader } from '@/components/ui';
import { cookies } from 'next/headers';
import { CSRF_COOKIE } from '@/lib/db/context';

export const dynamic = 'force-dynamic';

export default async function NewInstitutionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext('institution:write');
  const flash = flashFrom(await searchParams);
  const csrf = (await cookies()).get(CSRF_COOKIE)?.value ?? '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Add an institution to the register"
        description="Register the supervised entity before any engagement is created. The code is the stable supervisory identifier used in reports and audit records."
        actions={<Link href="/institutions" className="btn btn-secondary">Back to registry</Link>}
      />
      <Flash notice={flash.notice} error={flash.error} />

      <form action={createInstitutionAction} className="space-y-4">
        <input type="hidden" name="_csrf" value={csrf} />
        <Card>
          <CardHeader title="Identification" subtitle="Licence and regulatory references are recorded for traceability and are never shown to other institutions." />
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Institution name" name="name" required span={2}>
              <input id="name" name="name" required maxLength={160} className="input" placeholder="Example Commercial Bank Plc" />
            </Field>
            <Field label="Institution code" name="code" required hint="3–20 characters, A–Z, 0–9 or hyphen. Used on reports and in the audit trail.">
              <input id="code" name="code" required pattern="[A-Za-z0-9-]{3,20}" maxLength={20} className="input font-mono uppercase" placeholder="EXBANK" />
            </Field>
            <Field label="Category" name="category" required>
              <select id="category" name="category" required className="select" defaultValue="commercial_bank">
                {INSTITUTION_CATEGORIES.map((category) => (
                  <option key={category.key} value={category.key}>{category.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Licence number" name="licenceNumber">
              <input id="licenceNumber" name="licenceNumber" maxLength={60} className="input" placeholder="CB-2024-0042" />
            </Field>
            <Field label="Supervisory risk tier" name="riskTier" hint="A supervisory judgement, not a CVSS score. Leave unassessed until evidence supports a tier.">
              <select id="riskTier" name="riskTier" className="select" defaultValue="unassessed">
                {RISK_TIERS.map((tier) => (
                  <option key={tier} value={tier}>{tier}</option>
                ))}
              </select>
            </Field>
            <Field label="City" name="city">
              <input id="city" name="city" maxLength={80} className="input" />
            </Field>
            <Field label="State" name="state">
              <input id="state" name="state" maxLength={80} className="input" />
            </Field>
            <Field label="Website" name="website" hint="Public corporate site. This is not an assessment scope asset.">
              <input id="website" name="website" type="url" className="input" placeholder="https://example.bank.ng" />
            </Field>
            <Field label="Primary contact name" name="primaryContactName">
              <input id="primaryContactName" name="primaryContactName" maxLength={120} className="input" />
            </Field>
            <Field label="Primary contact email" name="primaryContactEmail">
              <input id="primaryContactEmail" name="primaryContactEmail" type="email" className="input" />
            </Field>
            <Field label="Summary" name="description" span={3}>
              <textarea id="description" name="description" rows={3} className="textarea" placeholder="Business model, channels and supervisory context." />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="prose-note max-w-2xl">
              Creating this record is audited with your identity, source address and request identifier. The institution is created in{' '}
              <strong>{ctx.mode === 'demo' ? 'demonstration' : 'live'}</strong> mode and cannot be moved between modes.
            </p>
            <div className="flex gap-2">
              <Link href="/institutions" className="btn btn-secondary">Cancel</Link>
              <button type="submit" className="btn btn-primary">Create institution</button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
