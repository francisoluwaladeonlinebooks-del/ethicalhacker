/**
 * Demonstration estate.
 *
 * Every record written by this seed is marked data_mode = 'demo' so it can
 * never be confused with a live supervisory record. Nothing here represents a
 * real institution, a real person or a real assessment result.
 */
import { withSystem, closeDb } from '@/lib/db/pool';
import type { Tx } from '@/lib/db/pool';
import { createUser } from '@/lib/domain/auth';
import { createInstitution } from '@/lib/domain/institutions';
import { seedRegistry } from '@/lib/demo/registry-seed';
import { createApplication } from '@/lib/domain/applications';
import { createEngagement } from '@/lib/domain/engagements';
import { createFinding } from '@/lib/domain/findings';
import { createEvidence, attachEvidenceToFinding } from '@/lib/domain/evidence';
import { parseVector } from '@/lib/cvss/engine';
import { generateReport, submitReportForReview, reviewReport } from '@/lib/reporting/report';
import type { RequestContext } from '@/lib/db/context';
import type { SessionUser } from '@/lib/rbac';

export const DEMO_PASSWORD = 'FicapDemo#2026';
const PASSWORD = DEMO_PASSWORD;
const DEMO = 'demo' as const;

type Ctx = RequestContext;

function ctxFor(user: SessionUser): Ctx {
  return {
    session: { id: 'seed-session' } as any,
    user,
    scope: { userId: user.id, role: user.role, institutionIds: [], crossInstitution: true, mode: DEMO },
    ip: 'seed',
    userAgent: 'ficap-seed',
    requestId: 'seed',
    token: 'seed',
    mode: DEMO,
  };
}

async function user(email: string): Promise<SessionUser> {
  const row = await withSystem((tx) =>
    tx.queryOne<{ id: string; email: string; name: string; role: SessionUser['role']; institution_id: string | null }>(
      'SELECT id, email, name, role, institution_id FROM users WHERE email = $1',
      [email],
    ),
  );
  if (!row) throw new Error(`seed user ${email} missing`);
  return { ...row, mfa_verified: true };
}

async function truncateDemoData() {
  const tables = [
    'evidence_access_log', 'report_approvals', 'reports', 'ai_suggestions', 'supervisory_notes',
    'nist_improvement_actions', 'nist_profile_entries', 'nist_profiles',
    'dependency_vulns', 'dependencies', 'dependency_scans',
    'retests', 'remediation_submissions', 'remediation_plans', 'finding_history', 'finding_framework_links',
    'finding_evidence', 'evidence', 'risk_assessments', 'cvss_scores', 'findings',
    'test_results', 'job_checks', 'job_events', 'assessment_jobs', 'test_plans', 'authorization_records',
    'scope_exclusions', 'scope_assets', 'engagement_applications', 'engagement_members', 'engagements',
    'api_endpoints', 'application_versions', 'applications', 'artifacts',
    'registry_verification_queue', 'registry_imports', 'digital_assets', 'entity_relationships',
    'licence_events', 'institution_names', 'institutions',
    'auth_throttle', 'sessions', 'mfa_recovery_codes', 'users',
  ];
  for (const table of tables) {
    await withSystem((tx) => tx.exec(`DELETE FROM ${table}`));
  }
}

export async function seedDemoData() {
  console.log('[ficap] seeding demonstration estate (data_mode = demo)');
  await truncateDemoData();

  // --- Users -------------------------------------------------------------
  const accounts: { email: string; name: string; role: SessionUser['role']; jobTitle: string; institutionId?: string }[] = [
    { email: 'admin@cbn.gov.ng', name: 'Amina Bello', role: 'platform_admin', jobTitle: 'Platform administrator, CBN' },
    { email: 'assessor@cbn.gov.ng', name: 'Chinedu Okafor', role: 'cbn_assessor', jobTitle: 'Senior cybersecurity assessor' },
    { email: 'reviewer@cbn.gov.ng', name: 'Fatima Yusuf', role: 'supervisory_reviewer', jobTitle: 'Supervisory reviewer, banking supervision' },
    { email: 'approver@cbn.gov.ng', name: 'Ibrahim Sani', role: 'report_approver', jobTitle: 'Independent report approver' },
  ];
  for (const account of accounts) {
    await createUser({ ...account, password: PASSWORD, isDemo: true, actor: undefined });
  }

  const admin = await user('admin@cbn.gov.ng');
  const assessor = await user('assessor@cbn.gov.ng');
  const reviewer = await user('reviewer@cbn.gov.ng');
  const approver = await user('approver@cbn.gov.ng');
  const adminCtx = ctxFor(admin);
  const assessorCtx = ctxFor(assessor);
  const reviewerCtx = ctxFor(reviewer);
  const approverCtx = ctxFor(approver);

  // --- Institutions ------------------------------------------------------
  const meridian = await withSystem((tx) =>
    createInstitution(tx, assessorCtx, {
      name: 'Meridian Trust Bank Plc',
      code: 'MERIDIAN',
      category: 'commercial_bank',
      licenceNumber: 'CBN/CB/2019/014',
      riskTier: 'high',
      city: 'Lagos',
      state: 'Lagos',
      website: 'https://meridian.example',
      primaryContactName: 'Ngozi Adeyemi',
      primaryContactEmail: 'contact@meridian.example',
      description: 'Tier-2 commercial bank with retail, SME and digital channels. Synthetic institution used for demonstration.',
    }),
  );
  const kudi = await withSystem((tx) =>
    createInstitution(tx, assessorCtx, {
      name: 'Kudi Microfinance Bank',
      code: 'KUDI',
      category: 'microfinance_bank_state',
      licenceNumber: 'CBN/MFB/2021/087',
      riskTier: 'medium',
      city: 'Kano',
      state: 'Kano',
      website: 'https://kudi.example',
      primaryContactName: 'Sadiq Lawal',
      primaryContactEmail: 'security@kudi.example',
      description: 'State-focused microfinance bank with agent banking. Synthetic institution used for demonstration.',
    }),
  );
  const payfast = await withSystem((tx) =>
    createInstitution(tx, assessorCtx, {
      name: 'PayFast Payments Ltd',
      code: 'PAYFAST',
      category: 'payment_solution_service_provider',
      licenceNumber: 'CBN/PSP/2020/233',
      riskTier: 'high',
      city: 'Abuja',
      state: 'FCT',
      website: 'https://payfast.example',
      primaryContactName: 'Tolu Bakare',
      primaryContactEmail: 'compliance@payfast.example',
      description: 'Switching and acquiring provider supporting card and transfer checkout. Synthetic institution used for demonstration.',
    }),
  );

  const contact = await createUser({
    email: 'contact@meridian.example',
    name: 'Ngozi Adeyemi',
    role: 'institution_contact',
    institutionId: meridian.id,
    jobTitle: 'Head of information security',
    password: PASSWORD,
    isDemo: true,
    actor: undefined,
  });
  const contactUser = await user('contact@meridian.example');
  const contactCtx = ctxFor(contactUser);

  // --- Applications ------------------------------------------------------
  const meridianIb = await withSystem((tx) =>
    createApplication(tx, assessorCtx, {
      institutionId: meridian.id,
      name: 'Meridian Internet Banking',
      businessPurpose: 'Retail and SME internet banking including transfers, statements and beneficiary management.',
      channel: 'web',
      webUrl: 'https://ib.meridian.example',
      environment: 'sandbox',
      authMethods: ['password', 'totp', 'transaction_pin'],
      apiServices: ['core banking', 'payments switch', 'sms gateway'],
      thirdParties: ['Cloudflare', 'AWS', 'Interswitch'],
      dataSensitivity: 'restricted',
      criticalProcesses: ['funds transfer', 'beneficiary creation', 'statement download'],
      testAccounts: [],
      boundaries: 'Internet-facing web tier only. Core banking systems, ATM network and third-party processors are out of scope.',
      exclusions: 'No denial-of-service testing, no social engineering of staff or customers.',
    }),
  );
  const meridianMobile = await withSystem((tx) =>
    createApplication(tx, assessorCtx, {
      institutionId: meridian.id,
      name: 'Meridian Mobile Banking',
      businessPurpose: 'Android and iOS retail banking application with biometric login and transfers.',
      channel: 'mobile_both',
      mobilePlatform: 'both',
      packageIdentifier: 'com.meridian.mobile',
      version: '5.4.2',
      build: '5402',
      environment: 'sandbox',
      authMethods: ['biometric', 'password', 'otp'],
      dataSensitivity: 'restricted',
      criticalProcesses: ['login', 'funds transfer', 'card controls'],
    }),
  );
  const meridianApi = await withSystem((tx) =>
    createApplication(tx, assessorCtx, {
      institutionId: meridian.id,
      name: 'Meridian Open Banking API',
      businessPurpose: 'Third-party access to account information and payment initiation under open banking rules.',
      channel: 'api',
      apiBaseUrl: 'https://api.meridian.example/v1',
      environment: 'sandbox',
      authMethods: ['oauth2', 'mtls'],
      apiServices: ['accounts', 'payments', 'consent'],
      dataSensitivity: 'restricted',
      criticalProcesses: ['consent management', 'payment initiation'],
    }),
  );
  const kudiPortal = await withSystem((tx) =>
    createApplication(tx, assessorCtx, {
      institutionId: kudi.id,
      name: 'Kudi Agent Banking Portal',
      businessPurpose: 'Agent-facing portal for cash-in, cash-out and account opening.',
      channel: 'web',
      webUrl: 'https://agent.kudi.example',
      environment: 'sandbox',
      authMethods: ['password', 'otp'],
      dataSensitivity: 'restricted',
      criticalProcesses: ['cash-in', 'cash-out', 'account opening'],
    }),
  );
  const kudiApi = await withSystem((tx) =>
    createApplication(tx, assessorCtx, {
      institutionId: kudi.id,
      name: 'Kudi Partner API',
      businessPurpose: 'Partner integrations for wallet top-up and balance enquiry.',
      channel: 'api',
      apiBaseUrl: 'https://api.kudi.example/v2',
      environment: 'sandbox',
      authMethods: ['api_key', 'hmac'],
      dataSensitivity: 'confidential',
    }),
  );
  const payfastConsole = await withSystem((tx) =>
    createApplication(tx, assessorCtx, {
      institutionId: payfast.id,
      name: 'PayFast Merchant Console',
      businessPurpose: 'Merchant onboarding, settlement reports and dispute management.',
      channel: 'admin',
      webUrl: 'https://console.payfast.example',
      environment: 'sandbox',
      authMethods: ['password', 'totp'],
      dataSensitivity: 'restricted',
      criticalProcesses: ['merchant onboarding', 'settlement configuration'],
    }),
  );
  const payfastCheckout = await withSystem((tx) =>
    createApplication(tx, assessorCtx, {
      institutionId: payfast.id,
      name: 'PayFast Checkout API',
      businessPurpose: 'Server-to-server checkout, refunds and transaction retrieval for merchants.',
      channel: 'api',
      apiBaseUrl: 'https://api.payfast.example/v1',
      environment: 'sandbox',
      authMethods: ['api_key', 'hmac'],
      apiServices: ['checkout', 'refund', 'transaction lookup'],
      dataSensitivity: 'restricted',
      criticalProcesses: ['payment initiation', 'refund', 'transaction retrieval'],
    }),
  );

  // --- Engagements -------------------------------------------------------
  const now = Date.now();
  const day = (offset: number) => new Date(now + offset * 86400000).toISOString();

  const webEngagement = await withSystem((tx) =>
    createEngagement(tx, assessorCtx, {
      institutionId: meridian.id,
      name: 'Meridian internet banking — Q1 2026 supervisory assessment',
      description: 'Baseline web application security assessment of the internet banking channel, focusing on authentication, session management and transfer authorisation.',
      applicationIds: [meridianIb.id],
      ownerId: assessor.id,
      authorizationRef: 'MERIDIAN/CISO/AUTH/2026-004',
      authorizedByName: 'Ngozi Adeyemi',
      authorizedByRole: 'Chief Information Security Officer',
      authorizedAt: day(-40),
      validFrom: day(-40),
      validTo: day(20),
      scopeExpiresAt: day(20),
      testingWindowStart: day(-35),
      testingWindowEnd: day(-10),
      permittedMethods: ['unauthenticated_review', 'authenticated_review', 'configuration_review', 'dependency_review'],
      emergencyContactName: 'Ngozi Adeyemi',
      emergencyContactPhone: '+234-800-000-0001',
      escalationProcedure: 'Call the institution security operations centre, then the CBN supervisory desk if the target becomes unavailable.',
      assets: [
        { assetType: 'url', value: 'https://ib.meridian.example', scheme: 'https', allowedMethods: ['GET', 'HEAD'], approvedPaths: ['/login', '/dashboard', '/transfers', '/statements'], ownershipVerified: true, notes: 'Sandbox tenant of the internet banking application.' },
        { assetType: 'domain', value: 'ib.meridian.example', ownershipVerified: true },
        { assetType: 'ip_address', value: '198.51.100.24', ownershipVerified: true, notes: 'Documentation range address used for the sandbox tenant.' },
      ],
      exclusions: [
        { assetType: 'url', value: 'https://ib.meridian.example/admin/bulk-payments', reason: 'Bulk payment module is not part of this assessment and must not be exercised.' },
        { assetType: 'domain', value: 'core.meridian.example', reason: 'Core banking host is out of scope for all tests.' },
      ],
      limits: { maxRequestsPerSecond: 2, maxConcurrency: 2, maxRequestsTotal: 1000, maxDurationMinutes: 90 },
    }),
  );

  const mobileEngagement = await withSystem((tx) =>
    createEngagement(tx, assessorCtx, {
      institutionId: meridian.id,
      name: 'Meridian mobile banking — static and MASVS review',
      description: 'Static analysis of the released Android and iOS packages plus MASVS 2.0 review. Dynamic testing was not available in this cycle.',
      applicationIds: [meridianMobile.id],
      ownerId: assessor.id,
      authorizationRef: 'MERIDIAN/CISO/AUTH/2026-009',
      authorizedByName: 'Ngozi Adeyemi',
      authorizedByRole: 'Chief Information Security Officer',
      authorizedAt: day(-70),
      validFrom: day(-70),
      validTo: day(-5),
      scopeExpiresAt: day(-5),
      testingWindowStart: day(-65),
      testingWindowEnd: day(-20),
      permittedMethods: ['static_mobile_review', 'configuration_review'],
      emergencyContactName: 'Ngozi Adeyemi',
      emergencyContactPhone: '+234-800-000-0001',
      escalationProcedure: 'Contact the mobile engineering lead; halt if the package cannot be verified.',
      assets: [
        { assetType: 'mobile_app', value: 'com.meridian.mobile', ownershipVerified: true, notes: 'Release build 5402, signed by the institution.' },
      ],
      exclusions: [{ assetType: 'mobile_app', value: 'com.meridian.mobile.internal', reason: 'Internal staff build is out of scope.' }],
      limits: { maxRequestsPerSecond: 1, maxConcurrency: 1, maxRequestsTotal: 50, maxDurationMinutes: 45 },
    }),
  );

  const payfastEngagement = await withSystem((tx) =>
    createEngagement(tx, assessorCtx, {
      institutionId: payfast.id,
      name: 'PayFast checkout API — API Top 10 assessment',
      description: 'API security review of the checkout and refund surface, including object-level authorisation and business flow abuse cases.',
      applicationIds: [payfastCheckout.id],
      ownerId: assessor.id,
      authorizationRef: 'PAYFAST/COMPLIANCE/AUTH/2026-015',
      authorizedByName: 'Tolu Bakare',
      authorizedByRole: 'Chief Compliance Officer',
      authorizedAt: day(-8),
      validFrom: day(-6),
      validTo: day(44),
      scopeExpiresAt: day(44),
      testingWindowStart: day(-4),
      testingWindowEnd: day(30),
      permittedMethods: ['unauthenticated_review', 'authenticated_review', 'api_schema_review'],
      emergencyContactName: 'Tolu Bakare',
      emergencyContactPhone: '+234-800-000-0002',
      escalationProcedure: 'Suspend testing immediately if a production endpoint responds; notify the CBN desk.',
      assets: [
        { assetType: 'api_endpoint', value: 'https://api.payfast.example/v1', allowedMethods: ['GET', 'POST'], approvedPaths: ['/transactions', '/refunds', '/checkout'], ownershipVerified: true, notes: 'Sandbox merchant credentials supplied by the institution.' },
      ],
      exclusions: [{ assetType: 'api_endpoint', value: 'https://api.payfast.example/v1/settlements', reason: 'Settlement endpoints move funds and are excluded from automated testing.' }],
      limits: { maxRequestsPerSecond: 1, maxConcurrency: 1, maxRequestsTotal: 400, maxDurationMinutes: 60 },
    }),
  );

  const kudiEngagement = await withSystem((tx) =>
    createEngagement(tx, assessorCtx, {
      institutionId: kudi.id,
      name: 'Kudi agent banking portal — plan review',
      description: 'Planned assessment of agent authentication and cash-out authorisation. Awaiting supervisory plan approval.',
      applicationIds: [kudiPortal.id],
      ownerId: assessor.id,
      authorizationRef: 'KUDI/SEC/AUTH/2026-003',
      authorizedByName: 'Sadiq Lawal',
      authorizedByRole: 'Chief Technology Officer',
      authorizedAt: day(-3),
      validFrom: day(-2),
      validTo: day(58),
      scopeExpiresAt: day(58),
      testingWindowStart: day(0),
      testingWindowEnd: day(40),
      permittedMethods: ['unauthenticated_review', 'authenticated_review'],
      emergencyContactName: 'Sadiq Lawal',
      emergencyContactPhone: '+234-800-000-0003',
      escalationProcedure: 'Notify the CBN desk before retrying any failed request sequence.',
      assets: [{ assetType: 'url', value: 'https://agent.kudi.example', scheme: 'https', allowedMethods: ['GET', 'HEAD'], approvedPaths: ['/login', '/agent'], ownershipVerified: true }],
      limits: { maxRequestsPerSecond: 1, maxConcurrency: 1, maxRequestsTotal: 300, maxDurationMinutes: 60 },
    }),
  );

  // Lifetimes: the finished assessments are completed, the API engagement is
  // authorised with an approved plan, and the Kudi plan is still under review.
  await withSystem(async (tx) => {
    await tx.query(
      `UPDATE engagements SET status = 'completed', scope_approved_at = $2, approved_at = $3, testing_window_start = $3, testing_window_end = $4 WHERE id = $1`,
      [webEngagement.id, day(-38), day(-35), day(-12)],
    );
    await tx.query(`UPDATE engagements SET status = 'completed', scope_approved_at = $2, approved_at = $3, testing_window_start = $3, testing_window_end = $4 WHERE id = $1`, [
      mobileEngagement.id, day(-68), day(-65), day(-22),
    ]);
    await tx.query(`UPDATE engagements SET status = 'approved', scope_approved_at = $2, approved_at = $3, testing_window_start = $3 WHERE id = $1`, [
      payfastEngagement.id, day(-5), day(-3),
    ]);
    await tx.query(`UPDATE engagements SET status = 'plan_review', scope_approved_at = $2 WHERE id = $1`, [kudiEngagement.id, day(-2)]);

    // Plans record the framework versions in force at the time. Later catalogue
    // updates must never rewrite these.
    const plans = [
      { id: webEngagement.id, modules: ['web'], approved: true, creator: assessor.id, reviewer: reviewer.id },
      { id: mobileEngagement.id, modules: ['mobile', 'dependencies'], approved: true, creator: assessor.id, reviewer: reviewer.id },
      { id: payfastEngagement.id, modules: ['api'], approved: true, creator: assessor.id, reviewer: reviewer.id },
      { id: kudiEngagement.id, modules: ['web'], approved: false, creator: assessor.id, reviewer: null },
    ];
    for (const plan of plans) {
      await tx.query(
        `INSERT INTO test_plans (engagement_id, institution_id, version, status, frameworks, modules, planned_checks, impact_summary, limitations,
             created_by, approved_by, approved_at, approval_note)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          plan.id,
          plan.id === kudiEngagement.id ? kudi.id : plan.id === payfastEngagement.id ? payfast.id : meridian.id,
          plan.approved ? 'approved' : 'pending_approval',
          JSON.stringify([
            { key: 'owasp-wstg', version: '4.2' },
            { key: 'owasp-api-top10', version: '2023' },
            { key: 'owasp-masvs', version: '2.0' },
            { key: 'nist-csf', version: '2.0' },
          ]),
          JSON.stringify(plan.modules),
          JSON.stringify(plan.modules.map((m) => ({ module: m, profile: m === 'mobile' ? 'static_only' : 'default' }))),
          'Read-only verification of authentication, session and authorisation controls using synthetic accounts. No state-changing or destructive requests.',
          'Dynamic mobile testing, denial of service, credential guessing and social engineering are excluded. Areas where prerequisites are unavailable will be recorded as blocked, not passed.',
          plan.creator,
          plan.reviewer,
          plan.approved ? day(-30) : null,
          plan.approved ? 'Plan reviewed against the authorisation record; bound by the permitted methods and testing window.' : null,
        ],
      );
    }
  });

  // --- Jobs --------------------------------------------------------------
  type JobSeed = {
    engagementId: string;
    institutionId: string;
    applicationId: string;
    module: 'web' | 'api' | 'mobile' | 'dependencies';
    status: 'succeeded' | 'failed' | 'blocked' | 'queued';
    progress: number;
    startedAt: string | null;
    finishedAt: string | null;
    error?: string | null;
    blockedReason?: string | null;
    stats: Record<string, unknown>;
  };

  const jobs: JobSeed[] = [
    {
      engagementId: webEngagement.id, institutionId: meridian.id, applicationId: meridianIb.id, module: 'web',
      status: 'succeeded', progress: 100, startedAt: day(-35), finishedAt: day(-35),
      stats: { checks_total: 18, checks_passed: 9, checks_failed: 5, checks_blocked: 3, checks_error: 1, requests_made: 214, findings_created: 6 },
    },
    {
      engagementId: mobileEngagement.id, institutionId: meridian.id, applicationId: meridianMobile.id, module: 'mobile',
      status: 'blocked', progress: 35, startedAt: day(-65), finishedAt: day(-65),
      blockedReason: 'No device farm or instrumented build is configured. Static package analysis completed; dynamic MASTG cases were not attempted.',
      stats: { checks_total: 12, checks_passed: 4, checks_blocked: 6, checks_error: 0, requests_made: 0, findings_created: 2 },
    },
    {
      engagementId: mobileEngagement.id, institutionId: meridian.id, applicationId: meridianMobile.id, module: 'dependencies',
      status: 'failed', progress: 60, startedAt: day(-64), finishedAt: day(-64),
      error: 'Vulnerability intelligence snapshot expired (older than 180 days) and no import is configured. Results were discarded rather than presented as current.',
      stats: { checks_total: 5, checks_passed: 2, checks_error: 1, dependencies_found: 42 },
    },
    {
      engagementId: payfastEngagement.id, institutionId: payfast.id, applicationId: payfastCheckout.id, module: 'api',
      status: 'queued', progress: 0, startedAt: null, finishedAt: null,
      stats: {},
    },
  ];

  const jobIds: Record<string, string> = {};
  await withSystem(async (tx) => {
    let index = 0;
    for (const job of jobs) {
      index += 1;
      const row = await tx.queryOne<{ id: string }>(
        `INSERT INTO assessment_jobs (engagement_id, institution_id, application_id, module, status, progress, attempts, max_attempts,
            started_at, finished_at, error, blocked_reason, limits, stats, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,1,2,$7,$8,$9,$10,$11,$12,$13, now() - ($14 || ' days')::interval)
         RETURNING id`,
        [
          job.engagementId, job.institutionId, job.applicationId, job.module, job.status, job.progress,
          job.startedAt, job.finishedAt, job.error ?? null, job.blockedReason ?? null,
          JSON.stringify({ maxRequestsPerSecond: 2, maxConcurrency: 2, maxRequestsTotal: 1000, maxDurationMinutes: 90 }),
          JSON.stringify(job.stats), assessor.id, String(40 - index),
        ],
      );
      jobIds[`${job.module}-${index}`] = row!.id;

      // Job checks: the operational record of what actually ran.
      const checkRows =
        job.module === 'web'
          ? [
              ['web.transport.tls', 'WSTG-CRYP-01', 'passed', 'TLS 1.2/1.3 negotiated; certificate chain valid for the approved host.', 6],
              ['web.headers.hsts', 'WSTG-CRYP-03', 'failed', 'Strict-Transport-Security absent on the login response.', 4],
              ['web.headers.security', 'WSTG-CONF-02', 'failed', 'X-Content-Type-Options and Referrer-Policy absent.', 4],
              ['web.headers.csp', 'WSTG-CONF-02', 'failed', 'No Content-Security-Policy; inline scripts permitted by default.', 2],
              ['web.headers.clickjacking', 'WSTG-CONF-02', 'failed', 'X-Frame-Options absent and frame-ancestors not set.', 3],
              ['web.cors.policy', 'WSTG-CLNT-07', 'failed', 'Access-Control-Allow-Origin reflects the request origin with credentials.', 5],
              ['web.methods.allowed', 'WSTG-CONF-06', 'passed', 'TRACE disabled; only GET/HEAD/POST observed on approved paths.', 8],
              ['web.info_leakage.content', 'WSTG-INFO-05', 'needs_verification', 'HTML comments reference an internal hostname; awaiting assessor review.', 12],
              ['web.error_handling.verbose', 'WSTG-ERRH-01', 'needs_verification', 'Stack trace fragment returned on an invalid transfer payload.', 9],
              ['web.session.cookie_attributes', 'WSTG-SESS-02', 'failed', 'Session cookie lacks Secure and HttpOnly attributes.', 3],
              ['web.cache.control', 'WSTG-SESS-06', 'passed', 'Authenticated pages set Cache-Control: no-store.', 4],
              ['web.exposure.admin_interface', 'WSTG-CONF-05', 'blocked', 'No approved administrative path was supplied by the institution.', 0],
              ['web.input.reflection', 'WSTG-INPV-01', 'blocked', 'Requires approved input-validation probe allowance; not granted for this engagement.', 0],
              ['web.csrf.form_tokens', 'WSTG-SESS-05', 'blocked', 'Requires an approved authenticated flow with two synthetic accounts.', 0],
              ['web.exposure.directory_listing', 'WSTG-CONF-04', 'passed', 'No directory listing observed on approved paths.', 5],
              ['web.fingerprint.server', 'WSTG-INFO-02', 'passed', 'Server banner reduced to a generic product name.', 2],
              ['web.info_leakage.metafiles', 'WSTG-INFO-03', 'passed', 'robots.txt does not disclose administrative paths.', 2],
              ['web.client.browser_storage', 'WSTG-CLNT-12', 'passed', 'No credential material stored in local storage on the login page.', 1],
            ]
          : job.module === 'mobile'
            ? [
                ['mobile.storage.hardcoded_secret', 'MASVS-STORAGE-1', 'failed', 'A high-entropy string resembling an API key is embedded in the package.', 0],
                ['mobile.network.cleartext', 'MASVS-NETWORK-2', 'failed', 'Network security config permits cleartext traffic to a legacy host.', 0],
                ['mobile.crypto.weak_algorithms', 'MASVS-CRYPTO-1', 'passed', 'No MD5 or SHA-1 usage found in the analysed bytecode.', 0],
                ['mobile.platform.exported_components', 'MASVS-PLATFORM-1', 'needs_verification', 'Two exported activities require assessor review of their intent filters.', 0],
                ['mobile.code.debuggable', 'MASVS-CODE-2', 'passed', 'Release manifest sets android:debuggable=false.', 0],
                ['mobile.dynamic.instrumentation', 'MASTG-TEST-0016', 'blocked', 'No device farm or instrumented build is available; dynamic case not attempted.', 0],
              ]
            : job.module === 'dependencies'
              ? [
                  ['deps.lockfile.parse', 'ID.AM-02', 'passed', '142 components inventoried from the uploaded lockfile.', 0],
                  ['deps.known_vulnerabilities', 'ID.RA-01', 'error', 'Intelligence snapshot expired; matches cannot be presented as current.', 0],
                  ['deps.licence_inventory', 'GV.SC-01', 'passed', 'Two components carry copyleft obligations; reported as observations.', 0],
                  ['deps.secrets_in_source', 'PR.DS-01', 'needs_verification', 'Two candidate secrets require assessor confirmation.', 0],
                ]
              : [];

      for (const [checkKey, code, status, detail, requests] of checkRows as [string, string, string, string, number][]) {
        await tx.query(
          `INSERT INTO job_checks (job_id, engagement_id, institution_id, check_key, framework_item_code, status, detail, requests_made, started_at, finished_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [row!.id, job.engagementId, job.institutionId, checkKey, code, status, detail, requests, job.startedAt, job.finishedAt],
        );
        await tx.query(
          `INSERT INTO test_results (job_id, engagement_id, institution_id, application_id, framework_key, framework_version, framework_item_code,
              check_key, status, expected, observed, is_manual, notes, executed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            row!.id, job.engagementId, job.institutionId, job.applicationId,
            code.startsWith('MASVS') || code.startsWith('MASTG') ? 'owasp-masvs' : code.startsWith('API') ? 'owasp-api-top10' : code.startsWith('WSTG') ? 'owasp-wstg' : 'nist-csf',
            code.startsWith('MASVS') ? '2.0' : code.startsWith('MASTG') ? '2.x' : code.startsWith('API') ? '2023' : code.startsWith('WSTG') ? '4.2' : '2.0',
            code, checkKey, status, null, detail, false, null,
            job.finishedAt ?? job.startedAt ?? new Date().toISOString(),
          ],
        );
      }

      const eventAt = job.finishedAt ?? job.startedAt ?? new Date().toISOString();
      await tx.query(
        `INSERT INTO job_events (job_id, engagement_id, institution_id, seq, level, message, data, created_at) VALUES
           ($1,$2,$3,1,'info','Job accepted by the scheduler and scope re-validated against the authorisation record.',$4,$5),
           ($1,$2,$3,2,'info','Rate limits applied: 2 requests/second, concurrency 2, budget 1000 requests.',$4,$5),
           ($1,$2,$3,3,'info','Check execution completed. Results recorded with the framework version in force.',$4,$5)`,
        [row!.id, job.engagementId, job.institutionId, JSON.stringify({ limits: { rps: 2, concurrency: 2, total: 1000 } }), eventAt],
      );
    }
  });

  // --- Findings ----------------------------------------------------------
  const cvss = (vector: string) => parseVector(vector);

  type FindingSeed = {
    key: string;
    engagementId: string;
    institutionId: string;
    applicationId: string | null;
    title: string;
    category: string;
    subcategory?: string;
    asset?: string;
    endpoint?: string;
    description: string;
    businessImpact: string;
    method: string;
    confidence: 'low' | 'medium' | 'high';
    status: string;
    vector?: string;
    frameworks?: { key: string; version: string; code: string; relationship?: string; rationale?: string }[];
    evidence?: { title: string; kind: string; mediaType: string; classification: string; content: string; caption: string }[];
    ownerTeam?: string;
    dueInDays?: number;
    remediationStatus?: string;
    priorityOverride?: string;
    retest?: { result: 'resolved' | 'not_resolved' | 'partial' | 'inconclusive'; notes: string; verified: boolean };
    submission?: { summary: string; status: string; reviewerNote?: string };
  };

  const findings: FindingSeed[] = [
    {
      key: 'cookie', engagementId: webEngagement.id, institutionId: meridian.id, applicationId: meridianIb.id,
      title: 'Session cookie issued without Secure or HttpOnly attributes',
      category: 'Session management', subcategory: 'Cookie attributes',
      asset: 'https://ib.meridian.example', endpoint: 'POST /login',
      description:
        'The authenticated session cookie is issued with neither the Secure nor the HttpOnly attribute. A browser will therefore transmit it over any scheme and expose it to client-side scripts.',
      businessImpact:
        'A single cross-site scripting defect elsewhere in the channel would be sufficient to steal an authenticated session and act as the customer, including initiating transfers within transaction limits.',
      method: 'http_analysis', confidence: 'high', status: 'confirmed',
      vector: 'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:L/VA:N/SC:L/SI:L/SA:N',
      frameworks: [
        { key: 'owasp-wstg', version: '4.2', code: 'WSTG-SESS-02', rationale: 'Cookie attribute testing identified the missing flags on the session token.' },
        { key: 'owasp-api-top10', version: '2023', code: 'API2:2023', rationale: 'Weak session token handling undermines authentication integrity.' },
        { key: 'nist-csf', version: '2.0', code: 'PR.AA-05', rationale: 'Access permissions and session tokens are not fully protected.' },
      ],
      evidence: [
        {
          title: 'Login response headers (redacted)', kind: 'http_exchange', mediaType: 'text/plain', classification: 'confidential',
          caption: 'Set-Cookie header observed on the login response; the cookie value is redacted.',
          content: 'HTTP/1.1 200 OK\ncontent-type: application/json\ncache-control: no-store\nset-cookie: FICAP_SESSION=[REDACTED]; Path=/; SameSite=Lax\n',
        },
      ],
      ownerTeam: 'Digital Channels Engineering', dueInDays: 14, remediationStatus: 'in_progress',
    },
    {
      key: 'hsts', engagementId: webEngagement.id, institutionId: meridian.id, applicationId: meridianIb.id,
      title: 'HTTP Strict Transport Security header absent on the internet banking login',
      category: 'Transport security', subcategory: 'Security headers',
      asset: 'https://ib.meridian.example', endpoint: 'GET /login',
      description: 'Responses from the login page do not include a Strict-Transport-Security header, so a first request over HTTP could be downgraded before the redirect takes effect.',
      businessImpact: 'Enables downgrade and cookie-injection attacks against customers on hostile networks, weakening the confidentiality of credentials in transit.',
      method: 'http_analysis', confidence: 'high', status: 'confirmed',
      vector: 'CVSS:4.0/AV:N/AC:H/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-wstg', version: '4.2', code: 'WSTG-CRYP-03', rationale: 'Transport layer security configuration reviewed on the approved host.' },
        { key: 'nist-csf', version: '2.0', code: 'PR.DS-02', rationale: 'Data in transit protection is incomplete for the login entry point.' },
      ],
      ownerTeam: 'Digital Channels Engineering', dueInDays: 30, remediationStatus: 'submitted',
      submission: { summary: 'HSTS enabled at the edge with a one-year max-age after a staged rollout on the sandbox tenant.', status: 'accepted' },
    },
    {
      key: 'cors', engagementId: webEngagement.id, institutionId: meridian.id, applicationId: meridianIb.id,
      title: 'Cross-origin policy reflects arbitrary origins with credentials enabled',
      category: 'Client-side security', subcategory: 'CORS configuration',
      asset: 'https://ib.meridian.example', endpoint: 'GET /api/accounts/summary',
      description: 'The accounts summary endpoint echoes the supplied Origin header and returns Access-Control-Allow-Credentials: true, allowing any site to read authenticated responses.',
      businessImpact: 'A malicious site visited by an authenticated customer could read account balances and transaction history, and potentially trigger permitted state changes.',
      method: 'http_analysis', confidence: 'high', status: 'confirmed',
      vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:H/VI:L/VA:N/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-wstg', version: '4.2', code: 'WSTG-CLNT-07', rationale: 'Cross-origin resource sharing policy tested and found permissive.' },
        { key: 'owasp-api-top10', version: '2023', code: 'API8:2023', rationale: 'Security misconfiguration in the cross-origin policy exposes authenticated data.' },
        { key: 'nist-csf', version: '2.0', code: 'PR.PS-01', rationale: 'Configuration management did not restrict cross-origin access.' },
      ],
      evidence: [
        {
          title: 'CORS response with reflected origin (redacted)', kind: 'http_exchange', mediaType: 'text/plain', classification: 'confidential',
          caption: 'Response to an OPTIONS request from a test origin not on the institution allow-list.',
          content: 'HTTP/1.1 200 OK\naccess-control-allow-origin: https://assessor-test.example\naccess-control-allow-credentials: true\nvary: Origin\n',
        },
      ],
      ownerTeam: 'Digital Channels Engineering', dueInDays: 7, remediationStatus: 'open',
    },
    {
      key: 'stack', engagementId: webEngagement.id, institutionId: meridian.id, applicationId: meridianIb.id,
      title: 'Verbose framework error details returned on an invalid transfer payload',
      category: 'Error handling', subcategory: 'Information disclosure',
      asset: 'https://ib.meridian.example', endpoint: 'POST /transfers',
      description: 'A malformed transfer payload returns a framework stack trace containing internal package names and a file path. No credentials or customer data were present in the captured fragment.',
      businessImpact: 'Assists an attacker in mapping internal components and identifying vulnerable library versions; alone it is an information leak rather than a direct compromise.',
      method: 'http_analysis', confidence: 'medium', status: 'needs_verification',
      vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-wstg', version: '4.2', code: 'WSTG-ERRH-01', rationale: 'Improper error handling observed on an approved path.' },
        { key: 'nist-csf', version: '2.0', code: 'PR.PS-01', rationale: 'Configuration exposes internal implementation detail.' },
      ],
      evidence: [
        {
          title: 'Error response fragment (redacted)', kind: 'http_response', mediaType: 'text/plain', classification: 'internal',
          caption: 'Stack trace fragment captured once and not replayed.',
          content: 'HTTP/1.1 500 Internal Server Error\n{"trace":"at com.meridian.transfer.LedgerAdapter.apply(LedgerAdapter.java:148)","requestId":"[REDACTED]"}\n',
        },
      ],
      ownerTeam: 'Core Banking Integration', dueInDays: 45, remediationStatus: 'open',
    },
    {
      key: 'auditlog', engagementId: webEngagement.id, institutionId: meridian.id, applicationId: meridianIb.id,
      title: 'Administrative interface reachable without a second authentication factor',
      category: 'Authentication', subcategory: 'Administrative access',
      asset: 'https://ib.meridian.example', endpoint: 'GET /admin/console',
      description: 'The administrative console is internet-facing and prompts for a password only; no second factor or IP restriction is enforced at the edge. Access was not attempted beyond the login prompt.',
      businessImpact: 'Password compromise of an operations user would give direct access to customer-facing configuration without a second control.',
      method: 'configuration_review', confidence: 'medium', status: 'confirmed',
      vector: 'CVSS:4.0/AV:N/AC:L/AT:P/PR:H/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-wstg', version: '4.2', code: 'WSTG-ATHN-01', rationale: 'Authentication mechanism reviewed at the administrative entry point.' },
        { key: 'nist-csf', version: '2.0', code: 'PR.AA-03', rationale: 'Identity verification for privileged users is weaker than required.' },
      ],
      ownerTeam: 'IT Operations', dueInDays: 21, remediationStatus: 'open',
    },
    {
      key: 'reflection', engagementId: webEngagement.id, institutionId: meridian.id, applicationId: meridianIb.id,
      title: 'Application maps request parameters without validating reflected values',
      category: 'Input validation', subcategory: 'Reflected input',
      asset: 'https://ib.meridian.example', endpoint: 'GET /statements?period=',
      description: 'The statement period parameter is echoed unencoded into the HTML response. Testing was limited to observation of reflection; no payload was executed and no evidence of script execution is claimed.',
      businessImpact: 'Could become a cross-site scripting vector if a future template change removes output encoding, enabling session theft in combination with the cookie finding.',
      method: 'configuration_review', confidence: 'low', status: 'needs_verification',
      frameworks: [
        { key: 'owasp-wstg', version: '4.2', code: 'WSTG-INPV-01', rationale: 'Reflected input observed; execution not demonstrated.' },
      ],
      ownerTeam: 'Digital Channels Engineering', dueInDays: 60, remediationStatus: 'open',
    },
    {
      key: 'hardcoded', engagementId: mobileEngagement.id, institutionId: meridian.id, applicationId: meridianMobile.id,
      title: 'Third-party API key embedded in the Android package',
      category: 'Sensitive data exposure', subcategory: 'Hardcoded secret',
      asset: 'com.meridian.mobile', endpoint: 'assets/config.properties',
      description: 'A 32-character key with the shape of a third-party API credential is embedded in the release APK. The key is not reproduced in this record; only a redacted fingerprint is retained.',
      businessImpact: 'Anyone who downloads the package can extract the key and consume the associated third-party quota or access its data, depending on the vendor contract.',
      method: 'static_analysis', confidence: 'high', status: 'confirmed',
      vector: 'CVSS:4.0/AV:P/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:L/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-masvs', version: '2.0', code: 'MASVS-STORAGE-1', rationale: 'Sensitive data is stored in the application package.' },
        { key: 'owasp-mastg', version: '2.x', code: 'MASTG-STORAGE-01', rationale: 'Static review of package contents.' },
        { key: 'nist-csf', version: '2.0', code: 'PR.DS-01', rationale: 'Confidential information is not fully protected at rest.' },
      ],
      evidence: [
        {
          title: 'Redacted string extraction from the APK', kind: 'artifact', mediaType: 'text/plain', classification: 'restricted',
          caption: 'Credential-shaped string replaced with a placeholder before storage.',
          content: 'config.properties\nvendor.api.key=[REDACTED]\nvendor.endpoint=https://vendor.example/api\n',
        },
      ],
      ownerTeam: 'Mobile Engineering', dueInDays: 10, remediationStatus: 'in_progress',
    },
    {
      key: 'cleartext', engagementId: mobileEngagement.id, institutionId: meridian.id, applicationId: meridianMobile.id,
      title: 'Android network security configuration permits cleartext traffic',
      category: 'Transport security', subcategory: 'Network configuration',
      asset: 'com.meridian.mobile', endpoint: 'res/xml/network_security_config.xml',
      description: 'The packaged network security configuration sets cleartextTrafficPermitted="true" for a legacy host, allowing unencrypted HTTP connections from the application.',
      businessImpact: 'Customer data exchanged with the legacy host could be intercepted on a hostile network. The host was not contacted during the assessment.',
      method: 'static_analysis', confidence: 'high', status: 'confirmed',
      vector: 'CVSS:4.0/AV:A/AC:L/AT:P/PR:N/UI:N/VC:H/VI:L/VA:N/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-masvs', version: '2.0', code: 'MASVS-NETWORK-2', rationale: 'Cleartext traffic is explicitly permitted for a host.' },
        { key: 'nist-csf', version: '2.0', code: 'PR.DS-02', rationale: 'Data in transit is not consistently protected.' },
      ],
      ownerTeam: 'Mobile Engineering', dueInDays: 30, remediationStatus: 'open',
    },
    {
      key: 'bola', engagementId: payfastEngagement.id, institutionId: payfast.id, applicationId: payfastCheckout.id,
      title: 'Transaction retrieval does not verify object ownership',
      category: 'API security', subcategory: 'Object level authorisation',
      asset: 'https://api.payfast.example/v1', endpoint: 'GET /v1/transactions/{id}',
      description:
        'Two sandbox merchant credentials were used to request each other\'s transaction references. Retrieval succeeded for both, indicating object-level authorisation is enforced only by possession of a valid key rather than by merchant ownership.',
      businessImpact: 'A compromised or over-privileged merchant integration could enumerate other merchants\' transaction metadata, including amounts and references, enabling targeted fraud.',
      method: 'api_testing', confidence: 'high', status: 'confirmed',
      vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-api-top10', version: '2023', code: 'API1:2023', rationale: 'Object level authorisation failed across merchant boundaries.' },
        { key: 'owasp-wstg', version: '4.2', code: 'WSTG-ATHZ-04', rationale: 'Insecure direct object reference confirmed in the sandbox.' },
        { key: 'nist-csf', version: '2.0', code: 'PR.AA-05', rationale: 'Authorisation does not restrict access to owned resources.' },
      ],
      evidence: [
        {
          title: 'Cross-merchant retrieval sequence (redacted)', kind: 'http_exchange', mediaType: 'text/plain', classification: 'restricted',
          caption: 'Merchant B key used to retrieve a transaction created by merchant A. Identifiers redacted.',
          content: 'GET /v1/transactions/[REDACTED] HTTP/1.1\nHost: api.payfast.example\nAuthorization: [REDACTED]\n\nHTTP/1.1 200 OK\n{"id":"[REDACTED]","amount":150000,"currency":"NGN","merchant":"[REDACTED]"}\n',
        },
      ],
      ownerTeam: 'Payments Platform', dueInDays: 5, remediationStatus: 'open',
    },
    {
      key: 'ratelimit', engagementId: payfastEngagement.id, institutionId: payfast.id, applicationId: payfastCheckout.id,
      title: 'No observable rate limiting on refund initiation',
      category: 'API security', subcategory: 'Business flow abuse',
      asset: 'https://api.payfast.example/v1', endpoint: 'POST /v1/refunds',
      description: 'Repeated refund requests were refused only by business rules on refundable balance, not by a request-rate control. Only five requests were attempted within the engagement budget.',
      businessImpact: 'In combination with a compromised merchant key, bursts of refund attempts could be used to probe limits and interfere with settlement reconciliation.',
      method: 'api_testing', confidence: 'medium', status: 'needs_verification',
      vector: 'CVSS:4.0/AV:N/AC:H/AT:P/PR:L/UI:N/VC:N/VI:L/VA:L/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-api-top10', version: '2023', code: 'API4:2023', rationale: 'Unrestricted resource consumption control not observed.' },
        { key: 'nist-csf', version: '2.0', code: 'DE.CM-09', rationale: 'Runtime monitoring of abusive request patterns is not evident.' },
      ],
      ownerTeam: 'Payments Platform', dueInDays: 30, remediationStatus: 'open',
    },
    {
      key: 'dependency', engagementId: mobileEngagement.id, institutionId: meridian.id, applicationId: meridianMobile.id,
      title: 'Outdated logging component with a known remote code execution history',
      category: 'Supply chain', subcategory: 'Vulnerable dependency',
      asset: 'com.meridian.mobile', endpoint: 'lib/log4j-core-2.14.1.jar',
      description:
        'The package bundles log4j-core 2.14.1. Vulnerability intelligence records CVE-2021-44228 against this version range. No exploitation was attempted; the finding reports the component version and the published advisory only.',
      businessImpact: 'If the component processes attacker-influenced strings in a reachable code path, the historical advisory describes remote code execution. Reachability was not proven in this assessment.',
      method: 'dependency_analysis', confidence: 'medium', status: 'confirmed',
      vector: 'CVSS:4.0/AV:N/AC:H/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'nist-csf', version: '2.0', code: 'ID.RA-01', rationale: 'Vulnerabilities in assets are identified from a dated intelligence source.' },
        { key: 'owasp-masvs', version: '2.0', code: 'MASVS-CODE-3', rationale: 'Third-party components are not free of known vulnerabilities.' },
      ],
      evidence: [
        {
          title: 'Dependency inventory excerpt', kind: 'manifest', mediaType: 'text/plain', classification: 'internal',
          caption: 'Component name and version recorded from the package manifest.',
          content: 'log4j-core 2.14.1 (bundled)\nintelligence: CVE-2021-44228\nfixed in: 2.17.1\nsource: curated advisory snapshot\n',
        },
      ],
      ownerTeam: 'Mobile Engineering', dueInDays: 15, remediationStatus: 'ready',
    },
    {
      key: 'resolved', engagementId: webEngagement.id, institutionId: meridian.id, applicationId: meridianIb.id,
      title: 'Clickjacking protection missing on the statement download page',
      category: 'Client-side security', subcategory: 'Frame protection',
      asset: 'https://ib.meridian.example', endpoint: 'GET /statements',
      description: 'The statement page could be framed by any origin. Following remediation, the response now sets frame-ancestors \'none\'.',
      businessImpact: 'Previously allowed clickjacking of a page that exposes financial statements. Retest confirmed the header is now present.',
      method: 'http_analysis', confidence: 'high', status: 'resolved',
      vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N',
      frameworks: [
        { key: 'owasp-wstg', version: '4.2', code: 'WSTG-CLNT-09', rationale: 'Framing protection tested before and after remediation.' },
      ],
      ownerTeam: 'Digital Channels Engineering', dueInDays: -5, remediationStatus: 'verified',
      retest: { result: 'resolved', notes: 'Response now returns content-security-policy: frame-ancestors \'none\'. Verified on the approved path only.', verified: true },
      submission: { summary: 'CSP frame-ancestors deployed to the statement page at the edge.', status: 'verified', reviewerNote: 'Header confirmed on retest; no other change observed.' },
    },
    {
      key: 'accepted', engagementId: payfastEngagement.id, institutionId: payfast.id, applicationId: payfastCheckout.id,
      title: 'Server banner discloses the API gateway product version',
      category: 'Information disclosure', subcategory: 'Banner disclosure',
      asset: 'https://api.payfast.example/v1', endpoint: 'GET /v1/health',
      description: 'The gateway returns a Server header naming the product and major version.',
      businessImpact: 'Minor aid to an attacker fingerprinting the estate; no direct impact on confidentiality or integrity.',
      method: 'http_analysis', confidence: 'high', status: 'accepted_risk',
      vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N',
      frameworks: [{ key: 'owasp-wstg', version: '4.2', code: 'WSTG-INFO-02', rationale: 'Server fingerprinting identified the product version.' }],
      ownerTeam: 'Payments Platform', dueInDays: 90, remediationStatus: 'closed',
    },
    {
      key: 'falsepositive', engagementId: payfastEngagement.id, institutionId: payfast.id, applicationId: payfastCheckout.id,
      title: 'Reported TLS 1.0 support not reproducible',
      category: 'Transport security', subcategory: 'Protocol version',
      asset: 'https://api.payfast.example/v1', endpoint: 'TLS handshake',
      description: 'An initial scan suggested TLS 1.0 was enabled. A controlled handshake from the assessment host negotiated TLS 1.3 only, and the gateway configuration confirms 1.2 as the minimum.',
      businessImpact: 'None identified. The observation was withdrawn after verification.',
      method: 'http_analysis', confidence: 'high', status: 'false_positive',
      frameworks: [{ key: 'owasp-wstg', version: '4.2', code: 'WSTG-CRYP-01', rationale: 'Weak transport protocol testing produced a non-reproducible result.' }],
      ownerTeam: 'Payments Platform', dueInDays: 0, remediationStatus: 'closed',
    },
  ];

  const findingIds: Record<string, string> = {};
  for (const seed of findings) {
    const ownerTeam = seed.ownerTeam ?? 'Information Security';
    const remediationPriority: 'low' | 'medium' | 'high' | 'critical' =
      seed.remediationStatus === 'closed' ? 'low' : seed.status === 'false_positive' ? 'low' : seed.confidence === 'high' ? 'high' : 'medium';
    const created = await withSystem((tx) =>
      createFinding(tx, assessorCtx, {
        engagementId: seed.engagementId,
        institutionId: seed.institutionId,
        applicationId: seed.applicationId,
        title: seed.title,
        category: seed.category,
        subcategory: seed.subcategory,
        asset: seed.asset ?? 'Not stated',
        endpoint: seed.endpoint,
        description: seed.description,
        businessImpact: seed.businessImpact,
        detectionMethod: seed.method,
        confidence: seed.confidence,
        status: seed.status as any,
        cvss: seed.vector ? cvss(seed.vector) : undefined,
        frameworkLinks: (seed.frameworks ?? []).map((link) => ({
          frameworkKey: link.key,
          frameworkVersion: link.version,
          itemCode: link.code,
          relationship: (link.relationship as 'supports' | 'root_cause' | 'affected_control' | 'related') ?? 'supports',
          rationale: link.rationale,
        })),
        remediation: {
          rootCause: `The ${seed.category.toLowerCase()} control is not implemented consistently at this boundary, so the expected behaviour is not enforced for every request.`,
          containment: 'Monitor authentication and session anomalies for the affected channel until the configuration change is deployed.',
          shortTerm: `Apply the configuration change for ${seed.title.toLowerCase()} on the affected channel.`,
          permanentFix: 'Add the control to the channel configuration baseline and to the automated pre-release checklist so it cannot regress.',
          verificationCriteria: 'Retest on the approved path records the expected behaviour, or the institution supplies configuration evidence accepted by the assessor.',
          retestProcedure: `Repeat a bounded, read-only check of ${seed.endpoint ?? seed.asset} within the engagement limits and record the observed response.`,
          evidenceRequired: 'Configuration export or a redacted response captured during retest.',
          ownerTeam,
          priority: remediationPriority,
        },
        dataMode: DEMO,
        createdBy: assessor.id,
      }),
    );
    findingIds[seed.key] = created.id;

    await withSystem(async (tx) => {
      const verified = ['confirmed', 'resolved', 'accepted_risk', 'false_positive'].includes(seed.status);
      await tx.query(
        `UPDATE findings SET verified_by = $2, verified_at = CASE WHEN $3 THEN now() ELSE NULL END,
                resolved_at = CASE WHEN status = 'resolved' THEN now() - interval '2 days' ELSE NULL END
          WHERE id = $1`,
        [created.id, verified ? reviewer.id : null, verified],
      );
      for (const link of seed.frameworks ?? []) {
        const exists = await tx.queryOne(
          `SELECT fi.code FROM framework_items fi JOIN frameworks f ON f.id = fi.framework_id
            WHERE f.key = $1 AND f.version = $2 AND fi.code = $3`,
          [link.key, link.version, link.code],
        );
        if (!exists) {
          console.warn(`[ficap] seed: framework item ${link.key} ${link.version} ${link.code} is not in the catalogue; link skipped`);
          continue;
        }
        await tx.query(
          `INSERT INTO finding_framework_links (finding_id, institution_id, framework_key, framework_version, item_code, relationship, rationale, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (finding_id, framework_key, item_code) DO NOTHING`,
          [created.id, seed.institutionId, link.key, link.version, link.code, link.relationship ?? 'supports', link.rationale ?? null, assessor.id],
        );
      }
      if (seed.ownerTeam || seed.dueInDays !== undefined) {
        await tx.query(
          `UPDATE remediation_plans SET owner_team = COALESCE($2, owner_team),
                  target_date = CASE WHEN $3::int IS NULL THEN target_date ELSE current_date + ($3::int || ' days')::interval END,
                  status = $4
            WHERE finding_id = $1`,
          [created.id, seed.ownerTeam ?? null, seed.dueInDays ?? null, seed.remediationStatus === 'verified' ? 'verified' : seed.remediationStatus === 'submitted' ? 'submitted' : seed.remediationStatus === 'in_progress' ? 'in_progress' : seed.remediationStatus === 'closed' ? 'closed' : 'open'],
        );
      }
      if (seed.submission) {
        const plan = await tx.queryOne<{ id: string }>('SELECT id FROM remediation_plans WHERE finding_id = $1', [created.id]);
        const submissionStatus = seed.submission.status === 'verified' || seed.submission.status === 'accepted' ? 'accepted' : 'pending_review';
        await tx.query(
          `INSERT INTO remediation_submissions (plan_id, finding_id, institution_id, submitted_by, notes, status, reviewed_by, reviewed_at, review_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8)`,
          [
            plan!.id, created.id, seed.institutionId, contactUser.id, seed.submission.summary,
            submissionStatus, submissionStatus === 'accepted' ? reviewer.id : null, seed.submission.reviewerNote ?? null,
          ],
        );
      }
      if (seed.retest) {
        await tx.query(
          `INSERT INTO retests (finding_id, institution_id, engagement_id, requested_by, performed_by, status, result, notes, performed_at, verified_by, verified_at)
           VALUES ($1,$2,$3,$4,$5,'completed',$6,$7, now() - interval '3 days', $8, CASE WHEN $9 THEN now() - interval '2 days' ELSE NULL END)`,
          [created.id, seed.institutionId, seed.engagementId, reviewer.id, assessor.id, seed.retest.result, seed.retest.notes, seed.retest.verified ? reviewer.id : null, seed.retest.verified],
        );
      }
    });

    for (const evidence of seed.evidence ?? []) {
      const stored = await withSystem((tx) =>
        createEvidence(tx, assessorCtx, {
          institutionId: seed.institutionId,
          engagementId: seed.engagementId,
          applicationId: seed.applicationId,
          kind: evidence.kind as any,
          title: evidence.title,
          mediaType: evidence.mediaType,
          content: evidence.content,
          classification: evidence.classification as any,
          retentionDays: 365,
          shareWithInstitution: true,
          createdBy: assessor.id,
        }),
      );
      await withSystem((tx) => attachEvidenceToFinding(tx, assessorCtx, created.id, stored.id, evidence.caption));
    }
  }

  // --- API inventory (specification import result) ------------------------
  const endpoints: [string, string, string, boolean, string, string, string][] = [
    ['POST', '/v1/checkout', 'Create a checkout session for a merchant order', false, 'openapi', 'tested', 'OpenAPI 3.0'],
    ['GET', '/v1/transactions/{id}', 'Retrieve a single transaction by reference', true, 'openapi', 'tested', 'OpenAPI 3.0'],
    ['POST', '/v1/refunds', 'Initiate a refund against a settled transaction', true, 'openapi', 'tested', 'OpenAPI 3.0'],
    ['GET', '/v1/merchants/{id}/settlements', 'List settlement records for a merchant', true, 'openapi', 'blocked', 'OpenAPI 3.0'],
    ['POST', '/v1/webhooks', 'Register a merchant webhook endpoint', true, 'openapi', 'untested', 'OpenAPI 3.0'],
    ['GET', '/v1/health', 'Gateway health probe', false, 'openapi', 'tested', 'OpenAPI 3.0'],
  ];
  await withSystem(async (tx) => {
    for (const [method, path, summary, authRequired, source, coverage, version] of endpoints) {
      await tx.query(
        `INSERT INTO api_endpoints (institution_id, application_id, engagement_id, spec_source, spec_version, base_url, method, path, summary,
            auth_required, risk_categories, coverage_status, last_tested_at)
         VALUES ($1,$2,$3,$4,$5,'https://api.payfast.example',$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (application_id, method, path) DO NOTHING`,
        [
          payfast.id, payfastCheckout.id, payfastEngagement.id, source, version, method, path, summary, authRequired,
          JSON.stringify(method === 'GET' && path.includes('{id}') ? ['API1:2023'] : method === 'POST' && path.includes('refund') ? ['API4:2023'] : []),
          coverage, coverage === 'tested' ? day(-2) : null,
        ],
      );
    }

    // Dependency scan with a dated intelligence snapshot.
    const scan = await tx.queryOne<{ id: string }>(
      `INSERT INTO dependency_scans (institution_id, application_id, engagement_id, source_type, source_name, intelligence_source, intelligence_updated_at, summary)
       VALUES ($1,$2,$3,'artifact','meridian-mobile-5.4.2.apk','Curated advisory snapshot (demonstration)', $4, $5) RETURNING id`,
      [meridian.id, meridianMobile.id, mobileEngagement.id, '2026-08-15T00:00:00Z', JSON.stringify({ components: 42, vulnerable: 1 })],
    );
    const components: [string, string, string, string | null, string][] = [
      ['log4j-core', '2.14.1', 'java', 'Apache-2.0', 'vulnerable'],
      ['okhttp', '4.12.0', 'java', 'Apache-2.0', 'ok'],
      ['retrofit', '2.9.0', 'java', 'Apache-2.0', 'ok'],
      ['bouncycastle', '1.70', 'java', 'MIT', 'outdated'],
      ['guava', '31.1-jre', 'java', 'Apache-2.0', 'ok'],
      ['jose4j', '0.9.3', 'java', 'Apache-2.0', 'ok'],
    ];
    for (const [name, version, ecosystem, licence, status] of components) {
      const dependency = await tx.queryOne<{ id: string }>(
        `INSERT INTO dependencies (scan_id, institution_id, name, version, ecosystem, is_direct, license, source_path, status)
         VALUES ($1,$2,$3,$4,$5,true,$6,'META-INF/dependencies.txt',$7) RETURNING id`,
        [scan!.id, meridian.id, name, version, ecosystem, licence, status],
      );
      if (status === 'vulnerable') {
        await tx.query(
          `INSERT INTO dependency_vulns (dependency_id, institution_id, vuln_id, source, summary, details, affected_range, fixed_version,
              severity_hint, confidence, known_exploited, reference_url, intelligence_updated_at)
           VALUES ($1,$2,'CVE-2021-44228','CVE / NVD','JNDI lookups in log messages can lead to remote code execution.','Advisory text is not reproduced in full; the platform stores the identifier, affected range and fixed version.',
              '>=2.0-beta9,<2.17.1','2.17.1','critical','high',true,'https://nvd.nist.gov/vuln/detail/CVE-2021-44228','2026-08-15T00:00:00Z')`,
          [dependency!.id, meridian.id],
        );
      }
    }
  });

  // --- NIST CSF 2.0 profiles --------------------------------------------
  await withSystem(async (tx) => {
    const current = await tx.queryOne<{ id: string }>(
      `INSERT INTO nist_profiles (institution_id, name, profile_type, notes, created_by)
       VALUES ($1,'Meridian current profile (2026 Q1)','current',$2,$3) RETURNING id`,
      [meridian.id, 'Derived from the completed internet banking assessment. Statuses reflect evidence actually reviewed; no maturity score is calculated.', assessor.id],
    );
    const target = await tx.queryOne<{ id: string }>(
      `INSERT INTO nist_profiles (institution_id, name, profile_type, notes, created_by)
       VALUES ($1,'Meridian target profile 2027','target',$2,$3) RETURNING id`,
      [meridian.id, 'Target outcomes agreed with the institution. Gaps are recorded as improvement actions rather than scores.', reviewer.id],
    );
    const entries: [string, string, string, string][] = [
      ['PR.AA-03', 'partially_supported', 'Password and TOTP are enforced for customers; the administrative console lacks a second factor.', 'high'],
      ['PR.AA-05', 'improvement_required', 'Session tokens are not protected with Secure/HttpOnly and the cross-origin policy is permissive.', 'high'],
      ['PR.DS-02', 'partially_supported', 'TLS is current at the edge but HSTS is absent and the mobile client permits cleartext to a legacy host.', 'high'],
      ['PR.PS-01', 'evidence_required', 'Security header configuration is not baselined across channels; evidence of change control not supplied.', 'medium'],
      ['ID.RA-01', 'partially_supported', 'Dependency scanning exists but the intelligence snapshot used for the assessment had expired.', 'medium'],
      ['DE.CM-09', 'not_assessed', 'Runtime monitoring and abuse detection were not reviewed in this engagement.', 'low'],
      ['GV.SC-01', 'evidence_required', 'Third-party register was referenced but not provided for review.', 'low'],
    ];
    for (const [code, status, summary, priority] of entries) {
      await tx.query(
        `INSERT INTO nist_profile_entries (profile_id, institution_id, item_code, status, evidence_summary, gap_description, priority, updated_by)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7)`,
        [current!.id, meridian.id, code, status, summary, priority, assessor.id],
      );
      await tx.query(
        `INSERT INTO nist_profile_entries (profile_id, institution_id, item_code, status, evidence_summary, gap_description, priority, updated_by)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7)`,
        [target!.id, meridian.id, code, status === 'not_assessed' ? 'not_assessed' : 'supported', 'Target outcome: control evidenced by an approved independent review.', priority, reviewer.id],
      );
    }
    await tx.query(
      `INSERT INTO nist_improvement_actions (institution_id, item_code, title, description, owner, priority, due_date, status)
       VALUES ($1,'PR.AA-05','Harden session and cross-origin configuration','Deploy Secure/HttpOnly session cookies and replace the reflective CORS policy with an explicit allow-list.','Digital Channels Engineering','high', current_date + 30, 'in_progress')`,
      [meridian.id],
    );
    await tx.query(
      `INSERT INTO nist_improvement_actions (institution_id, item_code, title, description, owner, priority, due_date, status)
       VALUES ($1,'ID.RA-01','Restore current dependency intelligence','Import a current vulnerability snapshot and re-run the dependency analysis before the next supervisory cycle.','Information Security','medium', current_date + 45, 'planned')`,
      [meridian.id],
    );

    await tx.query(
      `INSERT INTO supervisory_notes (institution_id, engagement_id, author_id, classification, body)
       VALUES ($1,$2,$3,'confidential_supervisory',$4)`,
      [meridian.id, webEngagement.id, reviewer.id, 'Internet banking assessment accepted into the supervisory record. Two findings require verification before the next reporting cycle.'],
    );
    await tx.query(
      `INSERT INTO supervisory_notes (institution_id, engagement_id, author_id, classification, body)
       VALUES ($1,$2,$3,'internal',$4)`,
      [payfast.id, payfastEngagement.id, reviewer.id, 'Cross-merchant object authorisation defect is material. Request an institution remediation plan within five business days.'],
    );
  });

  // --- Reports -----------------------------------------------------------
  const technical = await withSystem((tx) =>
    generateReport(tx, assessorCtx, {
      reportType: 'technical',
      institutionId: meridian.id,
      engagementId: webEngagement.id,
      title: 'Meridian internet banking — technical assessment report',
      notes: 'Covers the completed Q1 2026 assessment of the internet banking channel.',
    }),
  );
  await withSystem((tx) => submitReportForReview(tx, assessorCtx, technical.id));
  await withSystem((tx) =>
    reviewReport(tx, approverCtx, technical.id, {
      decision: 'approve',
      comments: 'Methodology and evidence reviewed against the authorisation record. Confirmed findings are supported by recorded exchanges; suspected items are clearly marked. Approved for supervisory use.',
    }),
  );

  const executive = await withSystem((tx) =>
    generateReport(tx, assessorCtx, {
      reportType: 'executive',
      institutionId: payfast.id,
      engagementId: payfastEngagement.id,
      title: 'PayFast checkout API — executive summary',
      notes: 'Executive summary prepared ahead of the supervisory exit meeting.',
    }),
  );
  await withSystem((tx) => submitReportForReview(tx, assessorCtx, executive.id));

  // --- National registry and digital asset inventory ---------------------
  await seedRegistry({ assessor, reviewer });

  // --- Summary -----------------------------------------------------------
  const summary = await withSystem((tx) =>
    tx.queryOne<Record<string, string>>(
      `SELECT
         (SELECT count(*)::text FROM institutions WHERE data_mode = 'demo') AS institutions,
         (SELECT count(*)::text FROM applications WHERE data_mode = 'demo') AS applications,
         (SELECT count(*)::text FROM engagements WHERE data_mode = 'demo') AS engagements,
         (SELECT count(*)::text FROM assessment_jobs) AS jobs,
         (SELECT count(*)::text FROM findings WHERE data_mode = 'demo') AS findings,
         (SELECT count(*)::text FROM evidence WHERE data_mode = 'demo') AS evidence,
         (SELECT count(*)::text FROM test_results) AS test_results,
         (SELECT count(*)::text FROM reports) AS reports,
         (SELECT count(*)::text FROM users) AS users`,
    ),
  );
  console.log('[ficap] demo estate ready', summary);
  console.log('[ficap] sign in with assessor@cbn.gov.ng / %s (demo mode shows the TOTP code on the MFA step)', PASSWORD);
  void contact;
  void contactCtx;
  void kudiApi;
  void meridianApi;
  void payfastConsole;
  void jobIds;
  void findingIds;
}

export async function runSeedScript() {
  try {
    await seedDemoData();
    await closeDb();
    process.exit(0);
  } catch (error) {
    console.error('[ficap] seed failed:', error);
    await closeDb().catch(() => undefined);
    process.exit(1);
  }
}
