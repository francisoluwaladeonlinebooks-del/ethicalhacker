/**
 * Framework catalogue seeds.
 *
 * Provenance policy
 * -----------------
 * Framework identifiers, titles and version numbers must match the official
 * publications. Where the platform seed cannot guarantee the exact official
 * wording, the item is stored with verification_status
 * "pending_official_import" and the UI marks it as such. Authorised
 * administrators can import the official catalogue (CSV/JSON) from
 * Platform configuration → Framework administration, which replaces the seed
 * wording and records the import. The platform never presents seeded wording
 * as an official quotation, and never invents control identifiers.
 */

export type SeedItem = {
  code: string;
  title: string;
  itemType: 'function' | 'category' | 'subcategory' | 'requirement' | 'test' | 'risk' | 'metric';
  parentCode?: string | null;
  description?: string | null;
  objective?: string | null;
  platform?: string | null;
  testMethod?: string | null;
  preconditions?: string | null;
  expected?: string | null;
  automation?: 'automated' | 'manual' | 'hybrid' | null;
  severityGuidance?: string | null;
  externalRefs?: string[];
  sortOrder?: number;
  verificationStatus?: 'seeded' | 'pending_official_import' | 'imported' | 'verified';
  metadata?: Record<string, unknown>;
};

export type FrameworkSeed = {
  key: string;
  name: string;
  version: string;
  publisher: string;
  sourceUrl: string;
  status: 'active' | 'draft' | 'deprecated' | 'superseded';
  verificationStatus: 'seeded' | 'pending_official_import' | 'imported' | 'verified';
  isPrimary: boolean;
  notes: string;
  items: SeedItem[];
};

const PENDING = 'pending_official_import' as const;

// ---------------------------------------------------------------------------
// OWASP Web Security Testing Guide v4.2
// ---------------------------------------------------------------------------
type WstgTuple = [code: string, title: string, automation: 'automated' | 'manual' | 'hybrid', objective: string];

const WSTG_TESTS: WstgTuple[] = [
  ['WSTG-INFO-01', 'Conduct search engine discovery and reconnaissance for information leakage', 'manual', 'Determine whether public search indexes disclose sensitive banking application content, test data or staff information.'],
  ['WSTG-INFO-02', 'Fingerprint web server', 'automated', 'Identify the web server product and version from responses, headers and error behaviour.'],
  ['WSTG-INFO-03', 'Review webserver metafiles for information leakage', 'automated', 'Review robots.txt, sitemap and similar metafiles for paths that reveal administrative or internal functionality.'],
  ['WSTG-INFO-04', 'Enumerate applications on webserver', 'manual', 'Identify additional applications hosted on the same infrastructure that may belong to a different owner.'],
  ['WSTG-INFO-05', 'Review webpage content for information leakage', 'automated', 'Inspect HTML, scripts and comments for internal hostnames, developer notes, keys or customer data.'],
  ['WSTG-INFO-06', 'Identify application entry points', 'hybrid', 'Enumerate request entry points (parameters, headers, cookies) that reach server-side logic.'],
  ['WSTG-INFO-07', 'Map execution paths through application', 'manual', 'Map multi-step banking workflows (onboarding, transfer, approval) and their server-side transitions.'],
  ['WSTG-INFO-08', 'Fingerprint web application framework', 'automated', 'Identify framework and component versions from headers, cookies, paths and static assets.'],
  ['WSTG-INFO-09', 'Fingerprint web application', 'automated', 'Identify the application, its version and deployment characteristics.'],
  ['WSTG-INFO-10', 'Map application architecture', 'manual', 'Document the architecture, trust boundaries and supporting services in scope.'],
  ['WSTG-CONF-01', 'Test network infrastructure configuration', 'manual', 'Review approved infrastructure configuration for exposed services and weak transport settings.'],
  ['WSTG-CONF-02', 'Test application platform configuration', 'automated', 'Check platform level configuration: security headers, default content, directory listing and debug behaviour.'],
  ['WSTG-CONF-03', 'Test file extensions handling for sensitive information', 'hybrid', 'Check whether alternate extensions or backup variants expose source, configuration or data files.'],
  ['WSTG-CONF-04', 'Review old backup and unreferenced files for sensitive information', 'hybrid', 'Look for backup, archive and unreferenced artefacts within approved paths.'],
  ['WSTG-CONF-05', 'Enumerate infrastructure and application administration interfaces', 'hybrid', 'Check approved administrative interfaces for exposure and authentication requirements.'],
  ['WSTG-CONF-06', 'Test HTTP methods', 'automated', 'Determine which HTTP methods are enabled and whether unsafe methods are exposed.'],
  ['WSTG-CONF-07', 'Test HTTP Strict Transport Security', 'automated', 'Verify HSTS is present, scoped correctly and enforced consistently.'],
  ['WSTG-CONF-08', 'Test RIA cross domain policy', 'hybrid', 'Review cross-domain policy files for overly permissive access.'],
  ['WSTG-CONF-09', 'Test file permission', 'manual', 'Review file and directory permissions on approved hosts where configuration evidence is provided.'],
  ['WSTG-CONF-10', 'Test for subdomain takeover', 'manual', 'Identify dangling DNS records pointing to de-provisioned third-party services.'],
  ['WSTG-CONF-11', 'Test cloud storage', 'manual', 'Assess approved cloud storage endpoints for public access and weak access policy.'],
  ['WSTG-IDNT-01', 'Test role definitions', 'manual', 'Verify that defined roles map to least-privilege banking entitlements, including maker/checker separation.'],
  ['WSTG-IDNT-02', 'Test user registration process', 'manual', 'Assess customer onboarding and registration for identity verification and abuse controls.'],
  ['WSTG-IDNT-03', 'Test account provisioning process', 'manual', 'Assess how accounts and entitlements are provisioned, approved and reviewed.'],
  ['WSTG-IDNT-04', 'Testing for account enumeration and guessable user account', 'hybrid', 'Determine whether responses reveal account existence or use predictable identifiers.'],
  ['WSTG-IDNT-05', 'Testing for weak or unenforced username policy', 'manual', 'Review username policy enforcement for predictability and impersonation risk.'],
  ['WSTG-ATHN-01', 'Testing for credentials transported over an encrypted channel', 'automated', 'Confirm that authentication occurs only over properly protected transport.'],
  ['WSTG-ATHN-02', 'Testing for default credentials', 'manual', 'Check approved test accounts for default or unchanged vendor credentials (never by guessing).'],
  ['WSTG-ATHN-03', 'Testing for weak lock out mechanism', 'manual', 'Review the documented lockout policy; automated lockout attempts are prohibited.'],
  ['WSTG-ATHN-04', 'Testing for bypassing authentication schema', 'manual', 'Assess authentication bypass conditions using approved identities only.'],
  ['WSTG-ATHN-05', 'Testing for vulnerable remember password functionality', 'hybrid', 'Review remember-me tokens for predictability, expiry and revocation.'],
  ['WSTG-ATHN-06', 'Testing for browser cache weaknesses', 'automated', 'Check cache-control directives on authenticated and sensitive pages.'],
  ['WSTG-ATHN-07', 'Testing for weak password policy', 'manual', 'Assess password policy strength and enforcement using documented configuration.'],
  ['WSTG-ATHN-08', 'Testing for weak security question answer', 'manual', 'Assess knowledge-based recovery mechanisms for guessability.'],
  ['WSTG-ATHN-09', 'Testing for weak password change or reset functionalities', 'manual', 'Assess credential reset flows for identity proofing, token entropy and expiry.'],
  ['WSTG-ATHN-10', 'Testing for weaker authentication in alternative channel', 'manual', 'Compare authentication strength across web, mobile and USSD/agent channels.'],
  ['WSTG-ATHZ-01', 'Testing directory traversal and file include', 'hybrid', 'Assess path handling for traversal outside permitted directories (non-destructive, read-only probes).'],
  ['WSTG-ATHZ-02', 'Testing for bypassing authorization schema', 'manual', 'Assess whether authorization checks can be bypassed using approved test roles.'],
  ['WSTG-ATHZ-03', 'Testing for privilege escalation', 'manual', 'Test vertical escalation using approved low-privilege accounts.'],
  ['WSTG-ATHZ-04', 'Testing for insecure direct object references', 'manual', 'Test object-level authorization using synthetic records belonging to approved test identities.'],
  ['WSTG-ATHZ-05', 'Testing for OAuth weaknesses', 'manual', 'Assess OAuth/OIDC flows for redirect URI, scope and token handling weaknesses.'],
  ['WSTG-SESS-01', 'Testing for session management schema', 'hybrid', 'Examine session token generation, storage and lifecycle.'],
  ['WSTG-SESS-02', 'Testing for cookies attributes', 'automated', 'Check Secure, HttpOnly, SameSite, Domain and Path attributes on session cookies.'],
  ['WSTG-SESS-03', 'Testing for session fixation', 'manual', 'Test whether a session identifier is rotated at authentication and privilege change.'],
  ['WSTG-SESS-04', 'Testing for exposed session variables', 'manual', 'Check whether session identifiers or tokens appear in URLs, logs or client storage.'],
  ['WSTG-SESS-05', 'Testing for cross site request forgery', 'hybrid', 'Check anti-CSRF protections on state-changing requests, including transaction authorisation.'],
  ['WSTG-SESS-06', 'Testing for logout functionality', 'manual', 'Verify server-side session invalidation on logout, including token revocation.'],
  ['WSTG-SESS-07', 'Testing session timeout', 'manual', 'Verify idle and absolute session timeouts and re-authentication for sensitive actions.'],
  ['WSTG-SESS-08', 'Testing for session puzzling', 'manual', 'Assess session variable reuse across application components.'],
  ['WSTG-SESS-09', 'Testing for session hijacking', 'manual', 'Assess exposure of session tokens to interception or client-side compromise.'],
  ['WSTG-INPV-01', 'Testing for reflected cross site scripting', 'hybrid', 'Assess reflection of controlled markers in approved parameters without executing hostile payloads against live customers.'],
  ['WSTG-INPV-02', 'Testing for stored cross site scripting', 'manual', 'Assess stored script injection using synthetic records in a sandbox tenant.'],
  ['WSTG-INPV-03', 'Testing for HTTP verb tampering', 'hybrid', 'Assess whether authorization depends on the HTTP method used.'],
  ['WSTG-INPV-04', 'Testing for HTTP parameter pollution', 'manual', 'Assess duplicate parameter handling for authorization-relevant fields.'],
  ['WSTG-INPV-05', 'Testing for SQL injection', 'manual', 'Assess for SQL injection using non-destructive, time-bounded confirmation techniques in approved environments.'],
  ['WSTG-INPV-06', 'Testing for LDAP injection', 'manual', 'Assess directory service queries for injection using synthetic identifiers.'],
  ['WSTG-INPV-07', 'Testing for XML injection', 'manual', 'Assess XML/SOAP handling for injection and unsafe parser configuration.'],
  ['WSTG-INPV-08', 'Testing for SSI injection', 'manual', 'Assess server-side include handling.'],
  ['WSTG-INPV-09', 'Testing for XPath injection', 'manual', 'Assess XPath queries for injection using synthetic input.'],
  ['WSTG-INPV-10', 'Testing for IMAP/SMTP injection', 'manual', 'Assess mail gateway interaction for injection.'],
  ['WSTG-INPV-11', 'Testing for code injection', 'manual', 'Assess code evaluation paths using benign, non-executing markers.'],
  ['WSTG-INPV-12', 'Testing for command injection', 'manual', 'Assess operating system command construction using benign echo markers only.'],
  ['WSTG-INPV-13', 'Testing for format string injection', 'manual', 'Assess format string handling using safe markers.'],
  ['WSTG-INPV-14', 'Testing for incubated vulnerability', 'manual', 'Assess delayed/persisted effects of injected input.'],
  ['WSTG-INPV-15', 'Testing for HTTP splitting and smuggling', 'manual', 'Assess request parsing consistency at the edge using controlled, low-volume probes.'],
  ['WSTG-INPV-16', 'Testing for HTTP incoming requests', 'manual', 'Assess server-side handling of inbound request metadata.'],
  ['WSTG-INPV-17', 'Testing for host header injection', 'hybrid', 'Assess trust in the Host header for links, redirects and password reset delivery.'],
  ['WSTG-INPV-18', 'Testing for server-side template injection', 'manual', 'Assess template evaluation using benign arithmetic markers.'],
  ['WSTG-INPV-19', 'Testing for server-side request forgery', 'manual', 'Assess outbound request construction using approved, non-routable canary targets.'],
  ['WSTG-ERRH-01', 'Testing for improper error handling', 'automated', 'Assess error responses for verbose internals and inconsistent handling.'],
  ['WSTG-ERRH-02', 'Testing for stack traces', 'automated', 'Check whether stack traces or framework internals are disclosed.'],
  ['WSTG-CRYP-01', 'Testing for weak transport layer security configuration', 'automated', 'Enumerate supported TLS versions and cipher suites on approved endpoints.'],
  ['WSTG-CRYP-02', 'Testing for padding oracle', 'manual', 'Assess CBC-mode error differentiation using controlled ciphertext manipulation in sandbox environments.'],
  ['WSTG-CRYP-03', 'Testing for sensitive information sent via unencrypted channels', 'automated', 'Verify that sensitive pages and credentials are not served over cleartext transport.'],
  ['WSTG-CRYP-04', 'Testing for weak encryption', 'manual', 'Assess application-level cryptography for obsolete algorithms and hardcoded keys where source or artefacts are provided.'],
  ['WSTG-BUSL-01', 'Test business logic data validation', 'manual', 'Assess server-side validation of business-critical values (amounts, limits, currencies).'],
  ['WSTG-BUSL-02', 'Test ability to forge requests', 'manual', 'Assess whether transaction requests can be forged or replayed with approved test accounts.'],
  ['WSTG-BUSL-03', 'Test integrity checks', 'manual', 'Assess integrity verification of transaction data across channels.'],
  ['WSTG-BUSL-04', 'Test for process timing', 'manual', 'Assess timing-dependent state changes (scheduled transfers, cut-off times).'],
  ['WSTG-BUSL-05', 'Test number of times a function can be used limits', 'manual', 'Assess rate and count limits on sensitive functions without exceeding engagement limits.'],
  ['WSTG-BUSL-06', 'Testing for the circumvention of workflows', 'manual', 'Assess whether onboarding, transfer approval and maker/checker steps can be skipped.'],
  ['WSTG-BUSL-07', 'Test defenses against application misuse', 'manual', 'Assess anti-automation and misuse detection controls.'],
  ['WSTG-BUSL-08', 'Test upload of unexpected file types', 'manual', 'Assess upload validation using benign, non-executable test files.'],
  ['WSTG-BUSL-09', 'Test upload of malicious files', 'manual', 'Assess malware handling controls using industry-standard, inert test files in a sandbox.'],
  ['WSTG-CLNT-01', 'Testing for DOM-based cross site scripting', 'manual', 'Assess client-side sinks using synthetic pages and approved test data.'],
  ['WSTG-CLNT-02', 'Testing for JavaScript execution', 'manual', 'Assess client-side execution paths without affecting live customers.'],
  ['WSTG-CLNT-03', 'Testing for HTML injection', 'hybrid', 'Assess HTML injection through approved parameters.'],
  ['WSTG-CLNT-04', 'Testing for client-side URL redirect', 'hybrid', 'Assess open redirect behaviour through approved parameters.'],
  ['WSTG-CLNT-05', 'Testing for CSS injection', 'manual', 'Assess CSS injection paths.'],
  ['WSTG-CLNT-06', 'Testing for client-side resource manipulation', 'manual', 'Assess client-side resource loading trust.'],
  ['WSTG-CLNT-07', 'Testing cross origin resource sharing', 'automated', 'Assess CORS policy for wildcard or arbitrary origin reflection with credentials.'],
  ['WSTG-CLNT-08', 'Testing for cross site flashing', 'manual', 'Assess legacy Flash content.'],
  ['WSTG-CLNT-09', 'Testing for clickjacking', 'automated', 'Assess frame embedding protections (X-Frame-Options, CSP frame-ancestors).'],
  ['WSTG-CLNT-10', 'Testing WebSockets', 'manual', 'Assess WebSocket authentication and origin restrictions.'],
  ['WSTG-CLNT-11', 'Testing web messaging', 'manual', 'Assess postMessage origin validation.'],
  ['WSTG-CLNT-12', 'Testing browser storage', 'hybrid', 'Assess local/session storage for sensitive banking data.'],
  ['WSTG-CLNT-13', 'Testing for cross site script inclusion', 'manual', 'Assess JSONP and cross-origin script inclusion.'],
];

const WSTG_ITEMS: SeedItem[] = WSTG_TESTS.map(([code, title, automation, objective], index) => {
  const category = code.split('-')[1];
  return {
    code,
    title,
    itemType: 'test',
    parentCode: `WSTG-${category}`,
    description: `Objective: ${objective}`,
    objective,
    automation,
    sortOrder: index,
    verificationStatus: PENDING,
    externalRefs: ['https://owasp.org/www-project-web-security-testing-guide/stable/'],
    metadata: { category },
    preconditions:
      automation === 'automated'
        ? 'An approved in-scope URL with GET/HEAD permission.'
        : 'An approved test identity, an approved test environment and explicit permission for the relevant method in the engagement scope.',
    expected: 'Implemented control matches the corresponding OWASP ASVS requirement and is enforced server-side.',
  };
});

// ---------------------------------------------------------------------------
// OWASP API Security Top 10 (2023)
// ---------------------------------------------------------------------------
const API_ITEMS: SeedItem[] = [
  ['API1:2023', 'Broken Object Level Authorization', 'Access control at object level is not enforced, allowing a caller to read or modify another customer’s account objects by changing an identifier.', 'Object-level authorization must be enforced server-side for every object reference, verified with two approved test identities and synthetic objects.'],
  ['API2:2023', 'Broken Authentication', 'Authentication mechanisms are weak, missing or can be bypassed, including token handling and credential management flaws.', 'Authentication must be enforced on every protected route with strong, revocable credentials and tokens.'],
  ['API3:2023', 'Broken Object Property Level Authorization', 'Excessive data exposure or mass assignment allows reading or writing properties the caller should not access.', 'Response schemas must be explicitly allow-listed and write schemas must reject unauthorized properties.'],
  ['API4:2023', 'Unrestricted Resource Consumption', 'No limits on resource consumption (requests, payload size, expensive operations), enabling abuse and denial of service.', 'Resource limits must be enforced at the gateway and application with documented thresholds.'],
  ['API5:2023', 'Broken Function Level Authorization', 'Function-level access control is missing or inconsistent across roles, enabling access to administrative operations.', 'Every function must enforce role/permission checks consistently on the server.'],
  ['API6:2023', 'Unrestricted Access to Sensitive Business Flows', 'Sensitive business flows (transfers, beneficiary creation, onboarding) can be abused without adequate anti-automation controls.', 'Business flows must enforce limits, velocity checks and step-up verification appropriate to the risk.'],
  ['API7:2023', 'Server Side Request Forgery', 'The API fetches remote resources based on user input without validating the destination.', 'Outbound requests must be restricted to allow-listed destinations and must not reach internal services.'],
  ['API8:2023', 'Security Misconfiguration', 'Missing security hardening across the API stack including headers, CORS, error handling and transport security.', 'Secure configuration baselines must be applied and verified across environments.'],
  ['API9:2023', 'Improper Inventory Management', 'API versions, endpoints and documentation are not inventoried, leaving shadow or deprecated endpoints exposed.', 'A complete, authoritative API inventory with version lifecycle management must be maintained.'],
  ['API10:2023', 'Unsafe Consumption of APIs', 'Data received from third-party APIs is trusted without validation, allowing downstream compromise.', 'Third-party API responses must be validated and treated as untrusted input.'],
].map(([code, title, description, expected], index) => ({
  code,
  title,
  itemType: 'risk' as const,
  description,
  expected,
  automation: 'hybrid' as const,
  sortOrder: index,
  verificationStatus: 'verified' as const,
  externalRefs: ['https://owasp.org/API-Security/editions/2023/en/0x11-t10/'],
}));

// ---------------------------------------------------------------------------
// OWASP MASVS v2.0 + MASTG linked test areas
// ---------------------------------------------------------------------------
const MASVS_ITEMS: SeedItem[] = [
  ['MASVS-STORAGE-1', 'Sensitive data is protected at rest', 'The application protects sensitive data stored locally (tokens, account data, credentials).', 'Storage'],
  ['MASVS-STORAGE-2', 'Sensitive data does not leak through side channels', 'Sensitive data is not exposed through logs, backups, clipboard, or screenshots.', 'Storage'],
  ['MASVS-CRYPTO-1', 'Strong cryptography is used', 'The application uses current, strong cryptographic primitives and parameters.', 'Cryptography'],
  ['MASVS-CRYPTO-2', 'Key management follows best practice', 'Keys are generated, stored and rotated according to platform best practice; no hardcoded keys.', 'Cryptography'],
  ['MASVS-AUTH-1', 'Authentication and authorization are secure', 'Remote and local authentication/authorization flows are implemented securely against the threat model.', 'Authentication'],
  ['MASVS-AUTH-2', 'Biometric authentication is bound to a credential', 'Biometric prompts gate a strong credential and fail closed.', 'Authentication'],
  ['MASVS-AUTH-3', 'Step-up authentication protects sensitive actions', 'High-risk actions require re-authentication or step-up verification.', 'Authentication'],
  ['MASVS-NETWORK-1', 'Network communication is encrypted', 'Sensitive data is transmitted only over protected channels with current TLS.', 'Network'],
  ['MASVS-NETWORK-2', 'Certificate validation is enforced', 'Server certificates are validated and pinning is applied following the threat model.', 'Network'],
  ['MASVS-PLATFORM-1', 'Platform interactions are secure', 'Inter-process communication, deep links and URL schemes are authorised and validated.', 'Platform'],
  ['MASVS-PLATFORM-2', 'WebViews are used securely', 'WebViews restrict content, script access and navigation appropriately.', 'Platform'],
  ['MASVS-PLATFORM-3', 'The user interface protects sensitive data', 'Sensitive screens, overlays and notifications are protected against leakage.', 'Platform'],
  ['MASVS-CODE-1', 'The app requires a current platform version', 'The application runs only on supported, patched platform versions.', 'Code quality'],
  ['MASVS-CODE-2', 'The app enforces updates', 'A mechanism ensures users run a supported application version.', 'Code quality'],
  ['MASVS-CODE-3', 'Components have no known vulnerabilities', 'Third-party components and SDKs are free of known exploitable vulnerabilities.', 'Code quality'],
  ['MASVS-CODE-4', 'Input validation and error handling are secure', 'Untrusted input is validated and errors do not leak sensitive information.', 'Code quality'],
  ['MASVS-RESILIENCE-1', 'The app detects a compromised platform', 'The application detects root/jailbreak or emulator conditions consistent with its threat model.', 'Resilience'],
  ['MASVS-RESILIENCE-2', 'Anti-tampering is implemented', 'Integrity of the application package is verified and tampering is detected.', 'Resilience'],
  ['MASVS-RESILIENCE-3', 'Anti-static-analysis is implemented', 'Code is obfuscated and hardened against static analysis where required by the threat model.', 'Resilience'],
  ['MASVS-RESILIENCE-4', 'Anti-dynamic-analysis is implemented', 'Debugging and instrumentation are detected and resisted where required by the threat model.', 'Resilience'],
  ['MASVS-PRIVACY-1', 'Data minimisation is applied', 'The application collects only the data it needs and minimises access to device resources.', 'Privacy'],
  ['MASVS-PRIVACY-2', 'User identification is prevented or minimised', 'The application avoids unnecessary persistent identifiers.', 'Privacy'],
  ['MASVS-PRIVACY-3', 'Data collection is transparent', 'Data collection is disclosed and consent is obtained where required.', 'Privacy'],
  ['MASVS-PRIVACY-4', 'Users control their data', 'Users can review, correct and delete their data where applicable.', 'Privacy'],
].map(([code, title, description, domain], index) => ({
  code,
  title,
  itemType: 'requirement' as const,
  description,
  objective: description,
  automation: 'manual' as const,
  sortOrder: index,
  verificationStatus: PENDING,
  externalRefs: ['https://mas.owasp.org/MASVS/'],
  metadata: { domain },
  expected: 'Requirement outcome supported by verified MASTG test evidence.',
}));

/**
 * MASTG test areas. The official MASTG test identifiers change between
 * releases; the platform seeds stable internal test keys and stores the
 * official identifier only after an administrator imports the official
 * catalogue. Nothing here claims to be an official MASTG identifier.
 */
type MastgTuple = [code: string, title: string, masvs: string, platform: string, method: string, automation: 'automated' | 'manual' | 'hybrid'];
const MASTG_TESTS: MastgTuple[] = [
  ['MASTG-STORAGE-01', 'Local storage inspection for sensitive data', 'MASVS-STORAGE-1', 'android,ios', 'Inspect application sandbox, keychain/keystore, preferences and databases for sensitive values.', 'hybrid'],
  ['MASTG-STORAGE-02', 'Log and console output inspection', 'MASVS-STORAGE-2', 'android,ios', 'Review device logs and application console output for credentials, tokens and customer data.', 'hybrid'],
  ['MASTG-STORAGE-03', 'Backup and data extraction settings', 'MASVS-STORAGE-2', 'android,ios', 'Verify backup configuration and data extraction rules in the manifest/entitlements.', 'automated'],
  ['MASTG-STORAGE-04', 'Clipboard and screenshot protection', 'MASVS-STORAGE-2', 'android,ios', 'Assess clipboard exposure and screen capture protection for sensitive views.', 'manual'],
  ['MASTG-CRYPTO-01', 'Cryptographic API usage review', 'MASVS-CRYPTO-1', 'android,ios', 'Review use of cryptographic APIs for obsolete algorithms, ECB mode and static IVs.', 'automated'],
  ['MASTG-CRYPTO-02', 'Hardcoded key and secret detection', 'MASVS-CRYPTO-2', 'android,ios', 'Search artefacts for embedded keys, IVs and symmetric secrets.', 'automated'],
  ['MASTG-CRYPTO-03', 'Random number generation review', 'MASVS-CRYPTO-1', 'android,ios', 'Identify non-cryptographic random number generators used in security contexts.', 'automated'],
  ['MASTG-AUTH-01', 'Authentication flow and token handling', 'MASVS-AUTH-1', 'android,ios', 'Assess token issuance, storage, refresh and revocation behaviour.', 'manual'],
  ['MASTG-AUTH-02', 'Biometric authentication enforcement', 'MASVS-AUTH-2', 'android,ios', 'Assess biometric gating, fallback behaviour and CryptoObject binding.', 'manual'],
  ['MASTG-AUTH-03', 'Session invalidation and logout', 'MASVS-AUTH-1', 'android,ios', 'Verify that logout and timeout invalidate tokens server-side.', 'manual'],
  ['MASTG-NETWORK-01', 'Cleartext traffic configuration', 'MASVS-NETWORK-1', 'android,ios', 'Review cleartext permissions and transport security policy.', 'automated'],
  ['MASTG-NETWORK-02', 'Certificate validation and pinning', 'MASVS-NETWORK-2', 'android,ios', 'Review trust manager implementation and pinning configuration.', 'hybrid'],
  ['MASTG-NETWORK-03', 'Observed traffic analysis', 'MASVS-NETWORK-1', 'android,ios', 'Intercept approved traffic on an authorised test device to confirm encryption and pinning.', 'manual'],
  ['MASTG-PLATFORM-01', 'Exported component and intent handling', 'MASVS-PLATFORM-1', 'android', 'Review exported activities, services and receivers for unauthorised invocation.', 'automated'],
  ['MASTG-PLATFORM-02', 'Deep link and URL scheme authorisation', 'MASVS-PLATFORM-1', 'android,ios', 'Assess deep link handlers for parameter tampering and missing authorisation.', 'hybrid'],
  ['MASTG-PLATFORM-03', 'WebView configuration review', 'MASVS-PLATFORM-2', 'android,ios', 'Review JavaScript bridge exposure, file access and navigation restrictions.', 'automated'],
  ['MASTG-PLATFORM-04', 'iOS URL scheme and universal link review', 'MASVS-PLATFORM-1', 'ios', 'Review registered URL schemes and associated domains.', 'automated'],
  ['MASTG-PLATFORM-05', 'iOS App Transport Security review', 'MASVS-NETWORK-1', 'ios', 'Review NSAppTransportSecurity exceptions in Info.plist.', 'automated'],
  ['MASTG-PLATFORM-06', 'iOS keychain and local storage review', 'MASVS-STORAGE-1', 'ios', 'Review keychain accessibility classes and local file protection.', 'hybrid'],
  ['MASTG-CODE-01', 'Manifest permission analysis', 'MASVS-CODE-1', 'android', 'Identify excessive, obsolete or dangerous permissions.', 'automated'],
  ['MASTG-CODE-02', 'Debuggable and release configuration', 'MASVS-RESILIENCE-4', 'android,ios', 'Detect debug flags and development configuration in release artefacts.', 'automated'],
  ['MASTG-CODE-03', 'Third-party SDK inventory', 'MASVS-CODE-3', 'android,ios', 'Inventory embedded SDKs and frameworks and match them against known vulnerabilities.', 'automated'],
  ['MASTG-CODE-04', 'Dependency currency', 'MASVS-CODE-3', 'android,ios', 'Compare embedded libraries with current supported versions.', 'automated'],
  ['MASTG-RESILIENCE-01', 'Root/jailbreak detection', 'MASVS-RESILIENCE-1', 'android,ios', 'Assess presence and robustness of compromised-device detection.', 'hybrid'],
  ['MASTG-RESILIENCE-02', 'Application integrity verification', 'MASVS-RESILIENCE-2', 'android,ios', 'Assess signature/integrity verification and tamper detection.', 'hybrid'],
  ['MASTG-RESILIENCE-03', 'Anti-debugging and instrumentation detection', 'MASVS-RESILIENCE-4', 'android,ios', 'Assess detection of debuggers, Frida and dynamic instrumentation.', 'manual'],
  ['MASTG-PRIVACY-01', 'Device identifier collection review', 'MASVS-PRIVACY-2', 'android,ios', 'Identify persistent identifier collection and third-party sharing.', 'automated'],
  ['MASTG-PRIVACY-02', 'Permission justification review', 'MASVS-PRIVACY-1', 'android,ios', 'Assess whether sensitive permissions are justified by application function.', 'manual'],
];
const MASTG_ITEMS: SeedItem[] = MASTG_TESTS.map(([code, title, masvs, platform, method, automation], index) => ({
  code,
  title,
  itemType: 'test' as const,
  parentCode: masvs,
  description: method,
  objective: title,
  platform,
  testMethod: method,
  automation,
  sortOrder: index,
  verificationStatus: PENDING,
  externalRefs: ['https://mas.owasp.org/MASTG/'],
  metadata: { official_id: null, note: 'Official MASTG identifier to be recorded on catalogue import.' },
  preconditions:
    automation === 'automated'
      ? 'Authorised APK/IPA build or extracted artefact supplied by the institution.'
      : 'Authorised test device or emulator, instrumentation tooling and an approved test account.',
  expected: 'Security control observed and evidenced in line with the linked MASVS requirement.',
}));

// ---------------------------------------------------------------------------
// NIST Cybersecurity Framework 2.0
// ---------------------------------------------------------------------------
const CSF_FUNCTIONS: [string, string, string][] = [
  ['GV', 'GOVERN', 'Establishes and monitors the organisation’s cybersecurity risk management strategy, expectations and policy.'],
  ['ID', 'IDENTIFY', 'Helps determine the current cybersecurity risk to the organisation and its assets.'],
  ['PR', 'PROTECT', 'Uses safeguards to prevent, reduce and manage cybersecurity risk.'],
  ['DE', 'DETECT', 'Finds and analyses possible cybersecurity attacks and compromises.'],
  ['RS', 'RESPOND', 'Takes action regarding a detected cybersecurity incident.'],
  ['RC', 'RECOVER', 'Restores assets and operations affected by a cybersecurity incident.'],
];

const CSF_CATEGORIES: [code: string, name: string, parent: string, description: string][] = [
  ['GV.OC', 'Organizational Context', 'GV', 'The circumstances that inform cybersecurity risk management for the institution.'],
  ['GV.RM', 'Risk Management Strategy', 'GV', 'Priorities, constraints, risk tolerance and assumptions are established and communicated.'],
  ['GV.RR', 'Roles, Responsibilities, and Authorities', 'GV', 'Cybersecurity roles, responsibilities and authorities are established, communicated and enforced.'],
  ['GV.PO', 'Policy', 'GV', 'Cybersecurity policy is established, communicated and enforced.'],
  ['GV.OV', 'Oversight', 'GV', 'Cybersecurity risk management activities are monitored and adjusted.'],
  ['GV.SC', 'Cybersecurity Supply Chain Risk Management', 'GV', 'Supply chain risks are identified, assessed, managed and monitored.'],
  ['ID.AM', 'Asset Management', 'ID', 'Assets are identified, prioritised and inventoried.'],
  ['ID.RA', 'Risk Assessment', 'ID', 'Risks to assets are identified, assessed and prioritised.'],
  ['ID.IM', 'Improvement', 'ID', 'Improvements are identified and implemented from lessons learned and assessments.'],
  ['PR.AA', 'Identity Management, Authentication, and Access Control', 'PR', 'Access to physical and logical assets is limited to authorised users, services and hardware.'],
  ['PR.AT', 'Awareness and Training', 'PR', 'Personnel are provided with awareness and training.'],
  ['PR.DS', 'Data Security', 'PR', 'Data are managed consistent with the risk strategy to protect confidentiality, integrity and availability.'],
  ['PR.PS', 'Platform Security', 'PR', 'Hardware, software and services are managed consistent with the risk strategy.'],
  ['PR.IR', 'Technology Infrastructure Resilience', 'PR', 'Security architectures are managed to protect asset confidentiality, integrity and availability.'],
  ['DE.CM', 'Continuous Monitoring', 'DE', 'Assets are monitored to find anomalies, indicators of compromise and other adverse events.'],
  ['DE.AE', 'Adverse Event Analysis', 'DE', 'Anomalies, indicators of compromise and other adverse events are analysed.'],
  ['RS.MA', 'Incident Management', 'RS', 'Responses to detected incidents are managed.'],
  ['RS.AN', 'Incident Analysis', 'RS', 'Investigations are conducted to ensure effective response.'],
  ['RS.CO', 'Incident Response Reporting and Communication', 'RS', 'Response activities are coordinated with internal and external stakeholders.'],
  ['RS.MI', 'Incident Mitigation', 'RS', 'Activities are performed to prevent expansion of an incident.'],
  ['RC.RP', 'Incident Recovery Plan Execution', 'RC', 'Restoration activities are performed to ensure operational availability.'],
  ['RC.CO', 'Incident Recovery Communication', 'RC', 'Restoration activities are coordinated with internal and external parties.'],
];

type SubcatTuple = [code: string, title: string, parent: string, note: string];
const CSF_SUBCATEGORIES: SubcatTuple[] = [
  ['GV.RM-01', 'Risk management objectives are established and agreed to by organisational stakeholders', 'GV.RM', 'Banking application assurance objectives, risk appetite and supervisory expectations are documented and approved.'],
  ['GV.RM-02', 'Risk appetite and risk tolerance statements are established, communicated and maintained', 'GV.RM', 'The institution defines tolerance for application security risk affecting customers and payment integrity.'],
  ['GV.RR-01', 'Organisational leadership is responsible and accountable for cybersecurity risk and fosters a culture of risk awareness', 'GV.RR', 'Executive accountability for digital channel security is evidenced.'],
  ['GV.RR-02', 'Roles, responsibilities and authorities related to cybersecurity risk management are established, communicated, understood and enforced', 'GV.RR', 'Application owners, security teams and approvers are clearly assigned.'],
  ['GV.PO-01', 'Policy for managing cybersecurity risks is established, communicated and enforced', 'GV.PO', 'Secure development and assessment policies exist and are enforced.'],
  ['GV.SC-01', 'A cybersecurity supply chain risk management program, strategy, objectives, policies and processes are established and agreed to', 'GV.SC', 'Third-party and open-source component risk is governed.'],
  ['GV.OC-03', 'Legal, regulatory and contractual requirements regarding cybersecurity are understood and managed', 'GV.OC', 'CBN regulatory obligations for digital channels are tracked.'],
  ['GV.OV-03', 'Organisational cybersecurity risk management performance is evaluated and reviewed for adjustments needed', 'GV.OV', 'Assessment results feed executive and board oversight.'],
  ['ID.AM-01', 'Inventories of hardware managed by the organisation are maintained', 'ID.AM', 'Only in scope where infrastructure is explicitly authorised.'],
  ['ID.AM-02', 'Inventories of software, services and systems managed by the organisation are maintained', 'ID.AM', 'Application, API and mobile inventory completeness.'],
  ['ID.AM-05', 'Assets are prioritised based on classification, criticality, resources and impact on the mission', 'ID.AM', 'Digital channels are classified by customer and payment criticality.'],
  ['ID.RA-01', 'Vulnerabilities in assets are identified, validated and recorded', 'ID.RA', 'Findings from assessments are validated, recorded and tracked.'],
  ['ID.RA-02', 'Cyber threat intelligence is received from information sharing forums and sources', 'ID.RA', 'Threat intelligence informs exploitability assessment.'],
  ['ID.RA-04', 'Potential impacts and likelihoods of threats exploiting vulnerabilities are identified and recorded', 'ID.RA', 'Contextual banking risk assessment considers customer funds and payment integrity.'],
  ['ID.RA-05', 'Threats, vulnerabilities, likelihoods and impacts are used to understand inherent risk and inform risk response prioritisation', 'ID.RA', 'Prioritisation combines CVSS v4.0 with banking context.'],
  ['ID.IM-02', 'Security and resilience tests and exercises are used to identify improvements', 'ID.IM', 'Assessment and retest cycles drive improvement.'],
  ['PR.AA-01', 'Identities and credentials for authorised users, services and hardware are managed by the organisation', 'PR.AA', 'Credential lifecycle management for customers and staff.'],
  ['PR.AA-03', 'Users, services and hardware are authenticated', 'PR.AA', 'Authentication mechanisms are implemented and enforced.'],
  ['PR.AA-05', 'Access permissions, entitlements and authorisations are defined in a policy, managed, enforced and reviewed', 'PR.AA', 'Server-side authorization and least privilege, including maker/checker.'],
  ['PR.DS-01', 'The confidentiality, integrity and availability of data at rest are protected', 'PR.DS', 'Customer data and tokens are protected at rest.'],
  ['PR.DS-02', 'The confidentiality, integrity and availability of data in transit are protected', 'PR.DS', 'TLS configuration and certificate validation.'],
  ['PR.DS-10', 'The confidentiality, integrity and availability of data in use are protected', 'PR.DS', 'Sensitive data handled in memory and on screen.'],
  ['PR.PS-01', 'Configuration management practices are established and applied', 'PR.PS', 'Secure configuration baselines for deployed applications.'],
  ['PR.PS-02', 'Software is maintained, replaced and removed commensurate with risk', 'PR.PS', 'Dependency currency and vulnerability remediation.'],
  ['PR.PS-04', 'Log records are generated and made available for continuous monitoring', 'PR.PS', 'Security logging of authentication, authorization and transactions.'],
  ['PR.PS-05', 'Installation and execution of unauthorised software are prevented', 'PR.PS', 'Application integrity and update enforcement.'],
  ['PR.PS-06', 'Secure software development practices are integrated, and their performance is monitored', 'PR.PS', 'Secure SDLC and security testing coverage.'],
  ['PR.IR-01', 'Networks and environments are protected from unauthorised logical access and usage', 'PR.IR', 'Network segmentation protecting internal APIs.'],
  ['DE.CM-01', 'Networks and network services are monitored to find potentially adverse events', 'DE.CM', 'Monitoring of digital channel traffic.'],
  ['DE.CM-03', 'Personnel activity and technology usage are monitored to find potentially adverse events', 'DE.CM', 'Detection of suspicious privileged activity.'],
  ['DE.CM-06', 'External service provider activities and services are monitored to find potentially adverse events', 'DE.CM', 'Third-party API monitoring.'],
  ['DE.CM-09', 'Computing hardware and software, runtime environments and their data are monitored to find potentially adverse events', 'DE.CM', 'Application and dependency monitoring.'],
  ['DE.AE-02', 'Potentially adverse events are analysed to better understand associated activities', 'DE.AE', 'Alert triage for authentication and payment anomalies.'],
  ['DE.AE-03', 'Information is correlated from multiple sources', 'DE.AE', 'Correlation across WAF, application and transaction logs.'],
  ['DE.AE-06', 'Information on adverse events is provided to authorised staff and tools', 'DE.AE', 'Escalation of fraud and security events.'],
  ['RS.MA-01', 'The incident response plan is executed in coordination with relevant third parties once an incident is declared', 'RS.MA', 'Documented response for channel compromise.'],
  ['RS.AN-03', 'Analysis is performed to establish what has taken place during an incident and the root cause', 'RS.AN', 'Root cause analysis capability.'],
  ['RS.AN-06', 'Actions performed during an investigation are recorded and the records’ integrity and provenance are preserved', 'RS.AN', 'Investigation evidence integrity.'],
  ['RS.CO-02', 'Internal and external stakeholders are notified of incidents', 'RS.CO', 'Customer and regulator notification procedures.'],
  ['RS.MI-01', 'Incidents are contained', 'RS.MI', 'Containment playbooks for compromised accounts.'],
  ['RS.MI-02', 'Incidents are eradicated', 'RS.MI', 'Eradication of compromised components.'],
  ['RC.RP-01', 'The recovery portion of the incident response plan is executed once initiated from the incident response process', 'RC.RP', 'Recovery plans for banking services.'],
  ['RC.CO-03', 'Recovery activities and progress in restoring operational capabilities are communicated to designated internal and external stakeholders', 'RC.CO', 'Recovery communication to customers and supervisors.'],
];

const CSF_ITEMS: SeedItem[] = [
  ...CSF_FUNCTIONS.map(([code, title, description], index) => ({
    code,
    title,
    itemType: 'function' as const,
    description,
    automation: null,
    sortOrder: index,
    verificationStatus: 'verified' as const,
    externalRefs: ['https://www.nist.gov/cyberframework'],
  })),
  ...CSF_CATEGORIES.map(([code, name, parent, description], index) => ({
    code,
    title: name,
    itemType: 'category' as const,
    parentCode: parent,
    description,
    automation: null,
    sortOrder: 100 + index,
    verificationStatus: 'verified' as const,
    externalRefs: ['https://www.nist.gov/cyberframework'],
  })),
  ...CSF_SUBCATEGORIES.map(([code, title, parent, note], index) => ({
    code,
    title,
    itemType: 'subcategory' as const,
    parentCode: parent,
    description: note,
    automation: null,
    sortOrder: 200 + index,
    verificationStatus: PENDING,
    externalRefs: ['https://www.nist.gov/cyberframework'],
    metadata: { note: 'Outcome statement paraphrased; import the official CSF 2.0 subcategory wording to verify.' },
  })),
];

// ---------------------------------------------------------------------------
// CVSS v4.0 metric catalogue (verified against the specification)
// ---------------------------------------------------------------------------
const CVSS_ITEMS: SeedItem[] = [
  ['AV', 'Attack Vector', 'base'], ['AC', 'Attack Complexity', 'base'], ['AT', 'Attack Requirements', 'base'],
  ['PR', 'Privileges Required', 'base'], ['UI', 'User Interaction', 'base'],
  ['VC', 'Confidentiality Impact (Vulnerable System)', 'base'], ['VI', 'Integrity Impact (Vulnerable System)', 'base'],
  ['VA', 'Availability Impact (Vulnerable System)', 'base'], ['SC', 'Confidentiality Impact (Subsequent Systems)', 'base'],
  ['SI', 'Integrity Impact (Subsequent Systems)', 'base'], ['SA', 'Availability Impact (Subsequent Systems)', 'base'],
  ['E', 'Exploit Maturity', 'threat'],
  ['CR', 'Confidentiality Requirement', 'environmental'], ['IR', 'Integrity Requirement', 'environmental'],
  ['AR', 'Availability Requirement', 'environmental'],
  ['MAV', 'Modified Attack Vector', 'environmental'], ['MAC', 'Modified Attack Complexity', 'environmental'],
  ['MAT', 'Modified Attack Requirements', 'environmental'], ['MPR', 'Modified Privileges Required', 'environmental'],
  ['MUI', 'Modified User Interaction', 'environmental'], ['MVC', 'Modified Confidentiality (Vulnerable System)', 'environmental'],
  ['MVI', 'Modified Integrity (Vulnerable System)', 'environmental'], ['MVA', 'Modified Availability (Vulnerable System)', 'environmental'],
  ['MSC', 'Modified Confidentiality (Subsequent Systems)', 'environmental'], ['MSI', 'Modified Integrity (Subsequent Systems)', 'environmental'],
  ['MSA', 'Modified Availability (Subsequent Systems)', 'environmental'],
  ['S', 'Safety', 'supplemental'], ['AU', 'Automatable', 'supplemental'], ['R', 'Recovery', 'supplemental'],
  ['V', 'Value Density', 'supplemental'], ['RE', 'Vulnerability Response Effort', 'supplemental'], ['U', 'Provider Urgency', 'supplemental'],
].map(([code, title, group], index) => ({
  code,
  title,
  itemType: 'metric' as const,
  description: `CVSS v4.0 ${group} metric`,
  automation: null,
  sortOrder: index,
  verificationStatus: 'verified' as const,
  externalRefs: ['https://www.first.org/cvss/v4.0/specification-document'],
  metadata: { group },
}));

export const FRAMEWORK_SEEDS: FrameworkSeed[] = [
  {
    key: 'owasp-wstg',
    name: 'OWASP Web Security Testing Guide',
    version: '4.2',
    publisher: 'OWASP Foundation',
    sourceUrl: 'https://owasp.org/www-project-web-security-testing-guide/',
    status: 'active',
    verificationStatus: PENDING,
    isPrimary: true,
    notes:
      'Test identifiers and categories follow WSTG v4.2. Objective text is paraphrased for the banking context; import the official catalogue to verify exact wording.',
    items: WSTG_ITEMS,
  },
  {
    key: 'owasp-api-top10',
    name: 'OWASP API Security Top 10',
    version: '2023',
    publisher: 'OWASP Foundation',
    sourceUrl: 'https://owasp.org/API-Security/editions/2023/en/0x11-t10/',
    status: 'active',
    verificationStatus: 'verified',
    isPrimary: true,
    notes: 'Category identifiers and titles follow the 2023 edition. Do not mix with the 2019 edition in one assessment.',
    items: API_ITEMS,
  },
  {
    key: 'owasp-masvs',
    name: 'OWASP Mobile Application Security Verification Standard',
    version: '2.0',
    publisher: 'OWASP Foundation',
    sourceUrl: 'https://mas.owasp.org/MASVS/',
    status: 'active',
    verificationStatus: PENDING,
    isPrimary: true,
    notes:
      'Control identifiers follow MASVS v2.0 groups. Requirement statements are paraphrased; import the official catalogue before quoting requirement text.',
    items: MASVS_ITEMS,
  },
  {
    key: 'owasp-mastg',
    name: 'OWASP Mobile Application Security Testing Guide',
    version: '2.x',
    publisher: 'OWASP Foundation',
    sourceUrl: 'https://mas.owasp.org/MASTG/',
    status: 'active',
    verificationStatus: PENDING,
    isPrimary: true,
    notes:
      'Platform test areas linked to MASVS requirements. Internal test keys are used until the official MASTG catalogue is imported; official identifiers are never fabricated.',
    items: MASTG_ITEMS,
  },
  {
    key: 'nist-csf',
    name: 'NIST Cybersecurity Framework',
    version: '2.0',
    publisher: 'NIST',
    sourceUrl: 'https://www.nist.gov/cyberframework',
    status: 'active',
    verificationStatus: PENDING,
    isPrimary: true,
    notes:
      'Functions and categories follow CSF 2.0. Subcategory outcome statements are paraphrased and flagged pending official import. Vulnerability counts are never converted into an official maturity tier.',
    items: CSF_ITEMS,
  },
  {
    key: 'cvss',
    name: 'Common Vulnerability Scoring System',
    version: '4.0',
    publisher: 'FIRST',
    sourceUrl: 'https://www.first.org/cvss/v4.0/specification-document',
    status: 'active',
    verificationStatus: 'verified',
    isPrimary: true,
    notes: 'Scoring engine validated against official reference vectors (see tests/cvss4.test.ts).',
    items: CVSS_ITEMS,
  },
];

/**
 * Defensible cross-framework mappings used by the correlation engine.
 * Only relationships that hold for the banking application context are
 * included, each with a rationale.
 */
export const FRAMEWORK_MAPPINGS: {
  source_framework: string;
  source_code: string;
  target_framework: string;
  target_code: string;
  mapping_type: string;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
}[] = [
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-ATHZ-04',
    target_framework: 'owasp-api-top10',
    target_code: 'API1:2023',
    mapping_type: 'related',
    confidence: 'high',
    rationale: 'Insecure direct object references in a banking web application are normally exercised through an API that lacks object-level authorization.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-ATHZ-02',
    target_framework: 'owasp-api-top10',
    target_code: 'API5:2023',
    mapping_type: 'related',
    confidence: 'high',
    rationale: 'Bypassing an authorization schema at the UI layer typically indicates missing function-level authorization on the backing endpoint.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-ATHZ-03',
    target_framework: 'owasp-api-top10',
    target_code: 'API5:2023',
    mapping_type: 'related',
    confidence: 'high',
    rationale: 'Vertical privilege escalation corresponds to broken function-level authorization.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-SESS-05',
    target_framework: 'owasp-api-top10',
    target_code: 'API2:2023',
    mapping_type: 'related',
    confidence: 'medium',
    rationale: 'A missing anti-CSRF control on a state-changing endpoint is an authentication/session weakness on the API surface.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-CRYP-03',
    target_framework: 'owasp-api-top10',
    target_code: 'API8:2023',
    mapping_type: 'related',
    confidence: 'high',
    rationale: 'Serving sensitive data over cleartext transport is a security misconfiguration of the API platform.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-CONF-02',
    target_framework: 'nist-csf',
    target_code: 'PR.PS-01',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'Platform hardening findings evidence the configuration management outcome.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-ATHZ-04',
    target_framework: 'nist-csf',
    target_code: 'PR.AA-05',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'Broken object-level authorization directly contradicts the access permission outcome.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-ATHN-01',
    target_framework: 'nist-csf',
    target_code: 'PR.AA-03',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'Authentication transport weaknesses undermine the authentication outcome.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-SESS-02',
    target_framework: 'nist-csf',
    target_code: 'PR.DS-02',
    mapping_type: 'affected_control',
    confidence: 'medium',
    rationale: 'Insecure session cookie attributes expose data in transit to interception.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-BUSL-06',
    target_framework: 'nist-csf',
    target_code: 'PR.AA-05',
    mapping_type: 'affected_control',
    confidence: 'medium',
    rationale: 'Workflow circumvention in maker/checker processes is an authorization enforcement gap.',
  },
  {
    source_framework: 'owasp-api-top10',
    source_code: 'API2:2023',
    target_framework: 'nist-csf',
    target_code: 'PR.AA-03',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'Broken API authentication contradicts the authentication outcome.',
  },
  {
    source_framework: 'owasp-api-top10',
    source_code: 'API4:2023',
    target_framework: 'nist-csf',
    target_code: 'DE.CM-09',
    mapping_type: 'related',
    confidence: 'low',
    rationale: 'Missing resource consumption limits reduce the ability to detect and contain abusive automation.',
  },
  {
    source_framework: 'owasp-api-top10',
    source_code: 'API8:2023',
    target_framework: 'nist-csf',
    target_code: 'PR.PS-01',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'API security misconfiguration evidences the configuration management outcome.',
  },
  {
    source_framework: 'owasp-api-top10',
    source_code: 'API9:2023',
    target_framework: 'nist-csf',
    target_code: 'ID.AM-02',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'Improper API inventory management contradicts the software inventory outcome.',
  },
  {
    source_framework: 'owasp-api-top10',
    source_code: 'API10:2023',
    target_framework: 'nist-csf',
    target_code: 'GV.SC-01',
    mapping_type: 'affected_control',
    confidence: 'medium',
    rationale: 'Unsafe third-party API consumption is a supply chain risk management gap.',
  },
  {
    source_framework: 'owasp-masvs',
    source_code: 'MASVS-STORAGE-1',
    target_framework: 'nist-csf',
    target_code: 'PR.DS-01',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'Insecure local storage of customer data contradicts the data-at-rest protection outcome.',
  },
  {
    source_framework: 'owasp-masvs',
    source_code: 'MASVS-NETWORK-2',
    target_framework: 'nist-csf',
    target_code: 'PR.DS-02',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'Missing certificate validation undermines data-in-transit protection.',
  },
  {
    source_framework: 'owasp-masvs',
    source_code: 'MASVS-CODE-3',
    target_framework: 'nist-csf',
    target_code: 'PR.PS-02',
    mapping_type: 'affected_control',
    confidence: 'high',
    rationale: 'Vulnerable embedded components contradict software maintenance outcomes.',
  },
  {
    source_framework: 'owasp-masvs',
    source_code: 'MASVS-AUTH-3',
    target_framework: 'nist-csf',
    target_code: 'PR.AA-05',
    mapping_type: 'affected_control',
    confidence: 'medium',
    rationale: 'Missing step-up authentication for sensitive actions is an authorization enforcement gap.',
  },
  {
    source_framework: 'owasp-wstg',
    source_code: 'WSTG-BUSL-08',
    target_framework: 'owasp-api-top10',
    target_code: 'API6:2023',
    mapping_type: 'related',
    confidence: 'low',
    rationale: 'Unvalidated uploads on sensitive business flows can enable abuse of the flow itself.',
  },
];
