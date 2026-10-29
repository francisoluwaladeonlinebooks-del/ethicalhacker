# FICAP — Financial Institution Cybersecurity Assurance Platform

FICAP is a supervisory application-security assessment platform for a financial-sector
regulator and the institutions it supervises. It plans and records **authorised,
scope-bound** security assessments of banks, microfinance banks, payment service
providers and related licensed entities, and it turns the resulting evidence into
findings, risk decisions, remediation tracking and regulatory reporting.

The platform is built for supervision, not for opportunistic scanning. A registry of
licensed institutions is **descriptive**: it is never a target list, a discovery engine
or an authorisation to test anything.

> **Status of this build.** This is a demonstration implementation running against a
> synthetic dataset. It has not been independently penetration-tested, certified or
> accredited, and nothing in this repository should be read as a claim that a system,
> institution or control is "secure", "compliant" or "unhackable". See
> [Claims, evidence and limitations](#claims-evidence-and-limitations).

---

## Contents

1. [What the platform does](#what-the-platform-does)
2. [Safety and authorisation model](#safety-and-authorisation-model)
3. [Roles](#roles)
4. [National registry and digital asset inventory](#national-registry-and-digital-asset-inventory)
5. [Assessment modules](#assessment-modules)
6. [Findings, risk and remediation](#findings-risk-and-remediation)
7. [Reporting](#reporting)
8. [Security architecture](#security-architecture)
9. [Running it](#running-it)
10. [Project layout](#project-layout)
11. [Tests](#tests)
12. [Operations notes](#operations-notes)
13. [Claims, evidence and limitations](#claims-evidence-and-limitations)

---

## What the platform does

| Area | Capability |
| --- | --- |
| Supervision | Portfolio overview, supervisory analytics, institution and application inventory, coverage and trends. |
| Registry | Licensed institutions by regulator category, licence history, provenance, verification state, duplicate/stale reconciliation and exportable registry reports. |
| Digital assets | Web apps, internet/corporate banking, mobile apps, APIs, webhooks, onboarding/KYC flows, admin portals, core-banking interfaces, third-party services and shared infrastructure, each with owner, environment and **evidence-based** ownership verification. |
| Engagements | Scoped authorisations with permitted methods, approved windows, safeguards, exclusions and a full audit trail of every authorisation decision. |
| Assessment | Web, API, mobile, dependency and coverage modules that execute only inside an approved engagement, with quotas, timeouts and per-hop scope re-checks. |
| Findings | CVSS v4.0 scoring, framework mapping, evidence binding, review workflow and repeat/reopened detection. |
| Risk | Technical severity kept separate from contextual risk; exceptions are documented, risk-approved and time-limited. |
| Remediation | Plans, submissions, retests and independent verification of closure. |
| Reports | Snapshot-based institutional and executive reports; PDF, XLSX and JSON export from the stored snapshot only. |
| Governance | Audit trail, NIST CSF 2.0 profiles and improvement actions, catalogue management, engine health, platform configuration. |

## Safety and authorisation model

Every active test must satisfy all of the following. Each control is enforced server
side, not in the interface.

1. **Approved engagement.** No scan, crawl, request or mobile check runs outside an
   engagement that has been authorised by a role holding `engagement:authorize`.
2. **Documented authorisation.** The authorisation record names the institution, the
   signatory, the reference and the validity window. Expired or missing authorisation
   blocks execution.
3. **Validated scope.** Targets are matched against scoped assets (domain, URL, IP,
   CIDR, API endpoint, mobile package). Unlisted hosts are refused; explicit
   exclusions always win.
4. **Permitted methods.** Only GET/HEAD (and explicitly approved methods) are used.
   Destructive methods, DoS patterns, uncontrolled credential guessing, real
   transactions and unauthorised account access are prohibited by policy and by the
   engine's capability list.
5. **Approved window and safeguards.** Requests are rate-limited, capped by count,
   bounded by timeouts and a response-size ceiling, and re-checked against scope on
   every redirect hop.
6. **Isolation.** The engine runs with minimal privilege, an egress allowlist, no
   tenant crossover and a hard stop control. Blocked or skipped checks are recorded as
   blocked/skipped — never as passing.

Read-only discovery is a separate activity from active assessment. Newly discovered
assets, related companies, third-party providers and shared infrastructure are **never
scanned automatically**, and ownership is **never inferred** from a name, brand,
domain, certificate, DNS record or third-party reference.

## Roles

| Role | Purpose | Notable boundaries |
| --- | --- | --- |
| `cbn_assessor` | Plans and performs authorised assessments, scores findings, drafts reports. | Cannot approve its own report or verify its own retest. |
| `supervisory_reviewer` | Reviews findings, plans and reports from a supervision perspective. | Cannot generate reports. |
| `report_approver` | Independent report approval. | Approves only; cannot author. |
| `institution_contact` | Institution-side view of shared evidence, remediation and retest requests. | Confined to its own institution by role **and** by row-level security. |
| `platform_admin` | Users, configuration, catalogue and engine health. | No assessment execution, no report approval, no finding access without an explicit, time-boxed access grant. |

Separation of duties is structural: the author of a report can never approve it, and
approval requires a substantive comment.

## National registry and digital asset inventory

- **Licence taxonomy** covers commercial, merchant and non-interest banks; microfinance
  banks by tier and scope; payment service banks; primary mortgage banks; development
  finance institutions; finance companies and bureaux de change; mobile money operators;
  PSSPs, switches, PTSPs, PTAs and super-agents; card schemes; capital market operators
  (SEC); insurers (NAICOM); pension operators (PenCom); shared infrastructure; and
  approved third-party technology providers.
- **Provenance is mandatory.** Each record carries its source name, source URL, retrieval
  timestamp, last verification timestamp and a staleness window. Records past the window
  are flagged for re-verification.
- **Licence history** is append-only. Only unambiguous events (granted, renewed, varied,
  suspended, revoked, surrendered, expired) change current state; mergers, acquisitions
  and renames are recorded as history and queued for a human to reconcile.
- **Ownership verification** is explicit. A recorded asset starts as a *candidate*; an
  assessor must record the evidence they reviewed before it becomes
  `ownership_verified`. Rejected claims stay in the registry as rejected.
- **Imports and reconciliation** accept regulator-supplied CSV or JSON, record a full
  report (created/updated/unchanged/conflicts/rejected) and queue conflicts. Imports
  never delete records, never create digital assets and never change a licence category
  silently.
- **Demonstration data is synthetic** and labelled as such in the interface and in
  exports. Institution names in demo mode are invented and must not be treated as real
  targets.

Registry export: `GET /api/registry/export?format=csv|json` (requires `institution:read`;
the export is audited and carries the demo/live mode).

## Assessment modules

| Module | What it records | Honest limits |
| --- | --- | --- |
| Web | WSTG-aligned checks over scoped HTTP targets: headers, TLS metadata, cookie attributes, information disclosure, safe authenticated-check confirmations. | Checks that require credentials or a live account are recorded as blocked/not-assessed, never as passed. |
| API | API Top 10 alignment over documented, scoped endpoints: authentication presence, method allowlists, error-shape leakage, rate-limit observation. | No fuzzing, no privilege escalation attempts, no data extraction. |
| Mobile | MASVS/MASTG-aligned **static** review of supplied build artefacts. | Dynamic instrumentation is not performed; without a device, build and instrumentation harness the module records `blocked`, not "passed". |
| Dependencies | Manifest/SBOM parsing plus OSV intelligence lookups. | Absence of a match is not proof of absence of vulnerabilities. |
| Coverage | Framework coverage matrix (WSTG, API Top 10, MASVS, MASTG, NIST CSF). | Coverage counts what was executed, not what is compliant. |

Framework identifiers come only from imported official catalogues. Where a catalogue is
unavailable it is marked **pending import**; identifiers, requirements and scoring rules
are never invented. CVSS scoring uses the v4.0 specification algorithm and the official
reference vectors; CVSS v3.1 is not implemented, and business impact never mutates a
CVSS score.

## Findings, risk and remediation

- Each finding can carry a CVSS v4.0 vector (validated against the specification), a
  technical severity derived from that score, and a **separate** contextual risk
  assessment across supervisory dimensions (customer impact, financial exposure,
  regulator visibility, exploitability, data sensitivity, recoverability). The two are
  never collapsed into one number.
- Confirmed, suspected, observation and rejected are distinct states. Suspected items
  are labelled as such everywhere they appear.
- Repeat and reopened findings are detected from history rather than asserted.
- Accepted risk is time-limited and requires a documented rationale and approver.
- Remediation submissions require evidence; retests require an independent verifier;
  a closure is only "verified" when that verification is recorded.

## Reporting

Reports are generated from a **stored snapshot**, so a published report cannot change
when the underlying data changes. The snapshot includes scope, period, findings, coverage,
not-assessed items, NIST profile state, remediation and evidence manifest, framework
versions, portfolio context and stated limitations.

Export: `GET /api/reports/[id]/export?format=pdf|xlsx|json`. Exports are produced from
the snapshot only and are audited before the response is returned.

Evidence download: `GET /api/evidence/[id]` and `GET /api/artifacts/[id]/download`.
Both re-check authorisation server side on every request, verify the recorded digest,
return `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
`Cache-Control: no-store, private` and a `default-src 'none'; sandbox` CSP.

## Security architecture

- **Zero-trust request path.** Every page, action and route resolves a session, checks
  permission **and** access scope, and query functions run inside a database transaction
  bound to that scope.
- **Defence in depth.** Authorisation is enforced in the service layer *and* by
  PostgreSQL row-level security (`FORCE ROW LEVEL SECURITY` with a `ficap_scope_ok()`
  predicate). Hiding a navigation item is treated as cosmetic only.
- **Sessions.** Short-lived, idle-bounded, server-side sessions with a CSRF token per
  session; MFA is required and a user without verified MFA holds no effective
  permission. High-risk actions require re-authentication. Passwords are hashed with
  scrypt and per-user salts; TOTP secrets are encrypted at rest.
- **Secrets never reach the browser.** No key, token or credential is written to
  browser storage, URLs, logs or error messages. Errors return a stable public shape and
  a correlation digest.
- **Evidence protection.** Evidence and artefacts are encrypted at rest, integrity
  checked on read, access-logged, least-privilege gated, delivered as short-lived
  authenticated downloads only, and subject to retention and legal hold. Captured text
  is redacted (authorisation headers, cookies, API keys, private keys, JWTs, account and
  phone numbers) before storage.
- **Audit.** `audit_events` is append-only at the database level and hash-chained.
  Authorisation refusals, evidence access, exports, configuration changes and licence or
  ownership decisions are all recorded with actor, scope, IP and mode.
- **Transport headers.** CSP, HSTS (when served over TLS), anti-framing,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a restrictive
  permissions policy are applied on every response.
- **Safe failure.** A failed or blocked check is rendered as blocked/failed. A scanner
  that could not run is never shown as a successful assessment.
- **Accessibility.** WCAG 2.2 AA intent: semantic landmarks, visible focus, keyboard
  operability, ARIA status regions, reduced-motion support, and severity conveyed by
  text and icon as well as colour.

## Running it

Requirements: Node.js 20+ (22 LTS recommended). No external database is required — the
platform embeds PostgreSQL 18 via PGlite.

```bash
npm install
cp .env.example .env            # optional in demo mode; set keys for anything else

npm run db:migrate              # apply schema, RLS policies and reference data
npm run db:seed                 # synthetic demonstration estate (demo mode)
npm run dev                     # http://0.0.0.0:3000
```

Demo sign-in (`FICAP_MODE=demo`). The MFA step displays the current code on screen in
demo mode only:

| Email | Role | Password |
| --- | --- | --- |
| `assessor@cbn.gov.ng` | CBN assessor | `FicapDemo#2026` |
| `reviewer@cbn.gov.ng` | Supervisory reviewer | `FicapDemo#2026` |
| `approver@cbn.gov.ng` | Report approver | `FicapDemo#2026` |
| `admin@cbn.gov.ng` | Platform administrator | `FicapDemo#2026` |
| `contact@meridian.example` | Institution contact (Meridian, synthetic) | `FicapDemo#2026` |

Useful commands:

```bash
npm run typecheck    # tsc --noEmit
npm test             # unit tests (CVSS v4.0 reference set, scope, RBAC, redaction, registry)
npm run db:reset     # delete the embedded database directory (demo only)
```

### Docker

```bash
docker compose up --build        # http://localhost:3000
```

The image runs the production build; the PGlite data directory is a named volume. Set
`FICAP_ENCRYPTION_KEY` and `FICAP_SESSION_PEPPER` in the environment or a `.env` file
before first start — both are required outside demo mode.

## Project layout

```
src/app/(app)/…            authenticated UI (registry, assessments, findings, reports, admin)
src/app/api/…              evidence, artefact, report-export and registry-export routes
src/app/actions/…          server actions (each re-checks permission, CSRF and scope)
src/lib/db/                schema.sql, PGlite pool with RLS context, migrations
src/lib/domain/            institutions, registry, applications, engagements, evidence,
                           artifacts, jobs, findings, risk, remediation, frameworks,
                           settings, nist, analytics, ai, audit, auth
src/lib/engines/           web, api, mobile, dependency and vulnerability-intel modules
src/lib/reporting/         report snapshots, PDF and XLSX renderers
src/lib/cvss/              CVSS v4.0 metric tables and scoring engine
src/lib/                   rbac, scope, redact, crypto, errors, page-context
src/lib/demo/              synthetic dataset (estate + registry)
tests/                     unit tests and the CVSS v4.0 reference fixture
```

## Tests

```bash
npm test
```

Covers the CVSS v4.0 engine against the 6,502-vector reference set, scope evaluation
(in-scope, exclusions, subdomains, methods, path prefixes, private-address blocking,
training-range gating, CIDR), role permission boundaries and separation of duties,
redaction of credentials and identifiers, and registry import/export parsing rules.

Tests are unit-level and offline. There is **no** automated end-to-end browser suite,
no live penetration test and no independent security review in this repository.

## Operations notes

- **Single writer.** PGlite permits one process to hold the data directory. Stop the dev
  server before running `db:migrate`, `db:seed`, `db:reset` or any script that opens the
  database directly; concurrent writers can corrupt the directory. Recover with
  `npm run db:reset && npm run db:migrate && npm run db:seed` (demo data only).
- **Production database.** For a real deployment, replace the embedded PGlite pool with
  a managed PostgreSQL instance, keep the RLS role model, and move evidence blobs to
  encrypted object storage with short-lived signed URLs issued by the server.
- **Modes.** `FICAP_MODE=demo` restricts the platform to synthetic data and the labelled
  training range. Demo and live records never mix: every tenant-scoped query filters on
  `data_mode`.
- **Backups and retention.** Evidence carries a retention date and a legal-hold flag;
  audit events are append-only and must be backed up independently of the application.

## Claims, evidence and limitations

This build is deliberately conservative about what it asserts:

- It does **not** claim that any institution, system or control is unhackable, compliant
  or secure. Compliance statements are supervisory judgements, not platform outputs.
- It does **not** claim the platform itself has been penetration-tested, certified or
  independently verified. The verification dashboard reports the checks this repository
  actually performs, and marks everything else as not performed.
- It does **not** claim dynamic mobile coverage, runtime instrumentation, or that checks
  "passed" when a device, build, account or engine was unavailable — those are recorded
  as blocked, skipped or untested.
- It does **not** invent framework control identifiers, requirements, test cases or
  scoring rules. Missing catalogue content is marked pending import.
- It does **not** convert automated results into MASVS compliance or NIST maturity
  scores. Maturity is a reviewed profile, entered by a person.
- AI output is suggestion-only, clearly labelled, and must be reviewed by an assessor
  before it influences a finding.
- Known exceptions, gaps and accepted risks are documented here and in the platform's
  own exception register, each with an owner and an expiry date.

To report a security issue in this codebase, open a private advisory rather than a public
issue. Do not test against infrastructure you do not own or have written authorisation to
assess.
