import type { CvssMetrics } from '@/lib/cvss/engine';
import type { CheckDefinition, EngineContext, FindingDraft } from '@/lib/engines/types';
import { inspectTls } from '@/lib/engines/target-client';

/**
 * OWASP WSTG aligned web application assessment checks.
 *
 * Every check is passive or single-request and non-destructive. Checks that
 * would require authenticated accounts, input probing or manual judgement are
 * declared with `requires` and are recorded as blocked/skipped (never passed)
 * when the engagement has not authorised the capability.
 */

export const WSTG_VERSION = '4.2';
export const API_VERSION = '2023';

function base(overrides: Partial<Record<'AV' | 'AC' | 'AT' | 'PR' | 'UI' | 'VC' | 'VI' | 'VA' | 'SC' | 'SI' | 'SA', string>>): CvssMetrics {
  return {
    AV: 'N', AC: 'L', AT: 'N', PR: 'N', UI: 'N', VC: 'N', VI: 'N', VA: 'N', SC: 'N', SI: 'N', SA: 'N',
    ...overrides,
  } as CvssMetrics;
}

export function wstg(item: string): { frameworkKey: string; frameworkVersion: string; itemCode: string } {
  return { frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, itemCode: item };
}

export function apiRisk(item: string): { frameworkKey: string; frameworkVersion: string; itemCode: string } {
  return { frameworkKey: 'owasp-api-top10', frameworkVersion: API_VERSION, itemCode: item };
}

function nist(code: string): { frameworkKey: string; frameworkVersion: string; itemCode: string } {
  return { frameworkKey: 'nist-csf', frameworkVersion: '2.0', itemCode: code };
}

function parseCookies(setCookieHeader: string | undefined): { name: string; attributes: string[]; raw: string }[] {
  if (!setCookieHeader) return [];
  return setCookieHeader
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(';').map((p) => p.trim());
      const name = parts[0].split('=')[0];
      return { name, attributes: parts.slice(1), raw: line };
    });
}

function headerSummary(headers: Record<string, string>): string {
  return Object.entries(headers)
    .filter(([key]) => !['content-length', 'date', 'connection', 'keep-alive', 'etag', 'last-modified'].includes(key))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

const REQUIRED_HEADERS: { header: string; why: string }[] = [
  { header: 'x-content-type-options', why: 'resource sniffing protection' },
  { header: 'referrer-policy', why: 'referrer leakage control' },
  { header: 'permissions-policy', why: 'browser feature restriction' },
];

export const WEB_CHECKS: CheckDefinition[] = [
  {
    key: 'web.transport.cleartext',
    title: 'Sensitive pages served over cleartext HTTP',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CRYP-03' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const target = ctx.client.baseUrl;
      if (target.startsWith('https://')) {
        return { status: 'passed', expected: 'All banking pages are served over HTTPS.', observed: 'The approved entry point uses HTTPS.' };
      }
      const response = await ctx.client.request(target);
      const finding: FindingDraft = {
        title: 'Internet banking application reachable over unencrypted HTTP',
        category: 'Transport security',
        asset: new URL(target).host,
        endpoint: new URL(target).pathname,
        description:
          'The approved entry point responded to a plain HTTP request. Customer credentials, session tokens and transaction data sent over cleartext can be intercepted or modified by an attacker on the network path.',
        businessImpact:
          'Credential and session interception could enable unauthorised account access and fraudulent transfers, exposing the institution to customer loss and regulatory sanction.',
        detectionMethod: 'Single unauthenticated HTTP GET to the approved entry point; response inspected for cleartext delivery.',
        confidence: 'high',
        cwes: ['CWE-319'],
        cvss: base({ AC: 'H', VC: 'H', VI: 'H', UI: 'A' }),
        frameworkLinks: [
          { ...wstg('WSTG-CRYP-03'), rationale: 'Sensitive information sent via unencrypted channel.' },
          { ...apiRisk('API8:2023'), rationale: 'Transport security is part of API platform configuration.' },
          nist('PR.DS-02'),
        ],
        remediation: {
          rootCause: 'The web tier does not enforce HTTPS for the assessed entry point or is deployed without a redirect policy.',
          containment: 'Redirect all HTTP traffic to HTTPS at the edge and enable HSTS once the redirect is verified.',
          shortTerm: 'Enforce HTTPS redirects and configure HSTS with a long max-age after validating all sub-resources.',
          permanentFix: 'Remove plaintext listeners from load balancers, enforce TLS 1.2+ with modern cipher suites and automate configuration checks in CI.',
          verificationCriteria: 'An HTTP request returns a 301/308 redirect to the same host over HTTPS and no sensitive content is served over cleartext.',
          retestProcedure: 'Re-issue an unauthenticated GET over HTTP and confirm only a redirect is returned.',
          evidenceRequired: 'Response headers and status for the HTTP request before and after remediation.',
          ownerTeam: 'Digital Channels / Infrastructure Security',
          priority: 'critical',
        },
        evidenceIds: [],
        contextHints: { exposure: 'internet', affectsCustomerFunds: true, affectsPaymentIntegrity: true },
      };
      return {
        status: 'failed',
        expected: 'HTTPS-only delivery with a redirect from HTTP.',
        observed: `HTTP ${response.status} returned ${response.bodyBytes} bytes over cleartext.`,
        findings: [finding],
        requestsMade: 1,
      };
    },
  },
  {
    key: 'web.transport.tls',
    title: 'TLS protocol and cipher configuration',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CRYP-01' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const url = new URL(ctx.client.baseUrl);
      if (url.protocol !== 'https:') {
        return {
          status: 'skipped',
          expected: 'TLS 1.2 or higher with modern cipher suites.',
          observed: 'The approved entry point is not served over TLS, so TLS configuration could not be inspected (see cleartext transport finding).',
        };
      }
      const inspection = await inspectTls(url.hostname, url.port ? Number(url.port) : 443);
      if (!inspection.ok) {
        return { status: 'needs_verification', expected: 'TLS handshake succeeds with a valid certificate chain.', observed: `TLS inspection failed: ${inspection.error}` };
      }
      const weak = inspection.weakProtocol;
      const finding: FindingDraft | undefined = weak
        ? {
            title: `Obsolete TLS protocol negotiated (${inspection.protocol})`,
            category: 'Cryptography',
            asset: url.hostname,
            endpoint: '/',
            description: `The endpoint negotiated ${inspection.protocol} with cipher ${inspection.cipher ?? 'unknown'}. Obsolete TLS versions have known cryptographic weaknesses.`,
            businessImpact: 'Session confidentiality and integrity can be undermined, exposing customer data in transit.',
            detectionMethod: 'TLS handshake inspection of the approved endpoint.',
            confidence: 'high',
            cwes: ['CWE-327'],
            cvss: base({ AC: 'H', VC: 'H', VI: 'L', UI: 'A' }),
            frameworkLinks: [{ ...wstg('WSTG-CRYP-01'), rationale: 'Weak transport layer security configuration.' }, nist('PR.DS-02')],
            remediation: {
              rootCause: 'Obsolete TLS versions remain enabled on the edge terminators.',
              shortTerm: 'Disable TLS 1.0/1.1 and legacy cipher suites.',
              permanentFix: 'Standardise on TLS 1.2+ with forward-secret cipher suites and monitor configuration drift.',
              verificationCriteria: 'Only TLS 1.2 and TLS 1.3 handshakes succeed on the approved endpoint.',
              retestProcedure: 'Re-run the TLS handshake inspection and enumerate accepted protocol versions.',
              evidenceRequired: 'Handshake output showing the negotiated protocol after remediation.',
              ownerTeam: 'Infrastructure Security',
              priority: 'high',
            },
            contextHints: { exposure: 'internet', affectsCustomerFunds: true },
          }
        : undefined;
      return {
        status: weak ? 'failed' : 'passed',
        expected: 'TLS 1.2 or higher with modern cipher suites.',
        observed: `${inspection.protocol} negotiated, cipher ${inspection.cipher ?? 'unknown'}, certificate valid to ${inspection.validTo ?? 'unknown'}.`,
        findings: finding ? [finding] : [],
      };
    },
  },
  {
    key: 'web.headers.hsts',
    title: 'HTTP Strict Transport Security',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CONF-07' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const hsts = response.headers['strict-transport-security'];
      if (!response.finalUrl.startsWith('https://')) {
        return { status: 'skipped', expected: 'HSTS enforced over HTTPS.', observed: 'Endpoint is not served over HTTPS; HSTS is not applicable until HTTPS is enforced.' };
      }
      if (hsts && /max-age=(\d+)/i.test(hsts)) {
        const maxAge = Number(/max-age=(\d+)/i.exec(hsts)![1]);
        if (maxAge >= 15_552_000) {
          return { status: 'passed', expected: 'HSTS with max-age of at least 180 days.', observed: `HSTS present: ${hsts}` };
        }
        return { status: 'failed', expected: 'HSTS max-age of at least 15552000 seconds.', observed: `HSTS present but short-lived: ${hsts}` };
      }
      const finding: FindingDraft = {
        title: 'HTTP Strict Transport Security is not enforced',
        category: 'Security configuration',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: '/',
        description: 'The application does not return a Strict-Transport-Security header. Browsers may therefore be downgraded to HTTP on subsequent visits, enabling interception of banking sessions.',
        businessImpact: 'Downgrade attacks can expose credentials and session tokens, leading to account takeover.',
        detectionMethod: 'Single unauthenticated GET; response headers inspected.',
        confidence: 'high',
        cwes: ['CWE-319', 'CWE-523'],
        cvss: base({ AC: 'H', AT: 'P', UI: 'A', VC: 'L', VI: 'L' }),
        frameworkLinks: [{ ...wstg('WSTG-CONF-07'), rationale: 'HSTS missing.' }, nist('PR.DS-02')],
        remediation: {
          rootCause: 'HSTS was not configured on the web tier or is stripped by an intermediary.',
          shortTerm: 'Add Strict-Transport-Security with max-age=31536000; includeSubDomains after confirming all subdomains support HTTPS.',
          permanentFix: 'Configure HSTS centrally at the edge with preload consideration and add a regression test to the security baseline.',
          verificationCriteria: 'Every HTTPS response from the approved host includes the HSTS header with a max-age of at least one year.',
          retestProcedure: 'Re-issue a GET to the entry point and inspect response headers.',
          evidenceRequired: 'Response header capture showing the HSTS directive.',
          ownerTeam: 'Digital Channels Engineering',
          priority: 'medium',
        },
        contextHints: { exposure: 'internet', compensatingControls: 'partial' },
      };
      return { status: 'failed', expected: 'HSTS present with long max-age.', observed: 'Strict-Transport-Security header absent.', findings: [finding] };
    },
  },
  {
    key: 'web.headers.security',
    title: 'Security response headers',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CONF-02' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const missing = REQUIRED_HEADERS.filter((item) => !response.headers[item.header]);
      const evidenceId = await ctx.capture('Security response headers for entry point', `GET ${response.requestedUrl}\nStatus: ${response.status}\n\n${headerSummary(response.headers)}`);
      if (missing.length === 0) {
        return { status: 'passed', expected: 'Baseline security headers present.', observed: 'All baseline headers present.', evidenceIds: [evidenceId] };
      }
      const finding: FindingDraft = {
        title: 'Missing baseline security response headers',
        category: 'Security configuration',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: '/',
        description: `The application is missing baseline security headers: ${missing.map((m) => m.header).join(', ')}. These headers reduce the impact of content sniffing, referrer leakage and browser feature abuse.`,
        businessImpact: 'Increased likelihood of client-side attacks against customers using the internet banking channel.',
        detectionMethod: 'Unauthenticated GET with response header inspection.',
        confidence: 'high',
        cwes: ['CWE-693'],
        cvss: base({ AC: 'H', AT: 'P', UI: 'A', VC: 'L', VI: 'L' }),
        frameworkLinks: [{ ...wstg('WSTG-CONF-02'), rationale: 'Application platform configuration.' }, nist('PR.PS-01')],
        remediation: {
          rootCause: 'The web tier does not apply a standard security header baseline.',
          shortTerm: `Add the missing headers: ${missing.map((m) => m.header).join(', ')}.`,
          permanentFix: 'Define a security header baseline at the reverse proxy or application framework level and test it in CI.',
          verificationCriteria: 'All baseline headers are present on HTML responses across the application.',
          retestProcedure: 'Re-issue a GET and confirm each header is present.',
          evidenceRequired: 'Response header capture.',
          ownerTeam: 'Digital Channels Engineering',
          priority: 'low',
        },
        evidenceIds: [evidenceId],
        contextHints: { exposure: 'internet', compensatingControls: 'partial' },
      };
      return {
        status: 'failed',
        expected: 'Baseline security headers present.',
        observed: `Missing: ${missing.map((m) => m.header).join(', ')}.`,
        evidenceIds: [evidenceId],
        findings: [finding],
      };
    },
  },
  {
    key: 'web.headers.clickjacking',
    title: 'Clickjacking protection',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CLNT-09' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const xfo = response.headers['x-frame-options']?.toLowerCase();
      const csp = response.headers['content-security-policy']?.toLowerCase() ?? '';
      const protectedByXfo = xfo === 'deny' || xfo === 'sameorigin';
      const protectedByCsp = /frame-ancestors\s+(none|'self')/.test(csp);
      if (protectedByXfo || protectedByCsp) {
        return { status: 'passed', expected: 'Framing prevented by X-Frame-Options or CSP frame-ancestors.', observed: protectedByXfo ? `X-Frame-Options: ${xfo}` : 'CSP frame-ancestors restricts framing.' };
      }
      const finding: FindingDraft = {
        title: 'Clickjacking protection is absent on the banking entry point',
        category: 'Client-side security',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: '/',
        description: 'Neither X-Frame-Options nor a CSP frame-ancestors directive prevents the application from being framed. An attacker could overlay the banking interface to capture customer actions or credentials.',
        businessImpact: 'UI redressing could lead customers to authorise unintended transfers or disclose credentials.',
        detectionMethod: 'Unauthenticated GET with frame protection header inspection.',
        confidence: 'high',
        cwes: ['CWE-1021'],
        cvss: base({ AC: 'H', AT: 'P', UI: 'A', VC: 'L', VI: 'H' }),
        frameworkLinks: [{ ...wstg('WSTG-CLNT-09'), rationale: 'Clickjacking defence missing.' }, nist('PR.DS-02')],
        remediation: {
          rootCause: 'Frame protection headers are not applied by the application or edge.',
          shortTerm: 'Set Content-Security-Policy: frame-ancestors \'none\' (and X-Frame-Options: DENY for legacy browsers).',
          permanentFix: 'Adopt a strict CSP baseline including frame-ancestors across all banking pages.',
          verificationCriteria: 'Responses include frame-ancestors none/self and X-Frame-Options DENY/SAMEORIGIN.',
          retestProcedure: 'Re-issue a GET and inspect the frame protection directives.',
          evidenceRequired: 'Header capture demonstrating frame-ancestors.',
          ownerTeam: 'Digital Channels Engineering',
          priority: 'medium',
        },
        contextHints: { exposure: 'internet' },
      };
      return { status: 'failed', expected: 'Frame embedding prevented.', observed: 'No X-Frame-Options or frame-ancestors directive.', findings: [finding] };
    },
  },
  {
    key: 'web.headers.csp',
    title: 'Content Security Policy quality',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CONF-02' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const csp = response.headers['content-security-policy'];
      if (!csp) {
        return { status: 'failed', expected: 'A restrictive Content-Security-Policy is defined.', observed: 'No Content-Security-Policy header.' };
      }
      const weaknesses: string[] = [];
      if (/unsafe-inline/i.test(csp)) weaknesses.push("'unsafe-inline' allowed");
      if (/unsafe-eval/i.test(csp)) weaknesses.push("'unsafe-eval' allowed");
      if (/(script-src[^;]*\*)/i.test(csp) || /default-src\s+\*/i.test(csp)) weaknesses.push('wildcard source');
      if (!/object-src/i.test(csp)) weaknesses.push('object-src not restricted');
      if (!/base-uri/i.test(csp)) weaknesses.push('base-uri not restricted');
      return {
        status: weaknesses.length ? 'needs_verification' : 'passed',
        expected: 'Restrictive CSP without unsafe-inline/unsafe-eval or wildcards.',
        observed: weaknesses.length ? `CSP present but weakened: ${weaknesses.join('; ')}.` : 'CSP present and restrictive.',
      };
    },
  },
  {
    key: 'web.cors.policy',
    title: 'Cross-Origin Resource Sharing policy',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CLNT-07' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const probeOrigin = 'https://ficap-probe.invalid';
      const response = await ctx.client.request(ctx.client.baseUrl, { headers: { origin: probeOrigin } });
      const allowOrigin = response.headers['access-control-allow-origin'];
      const allowCredentials = response.headers['access-control-allow-credentials'];
      const evidenceId = await ctx.capture(
        'CORS response with probe origin',
        `GET ${response.requestedUrl}\nOrigin: ${probeOrigin}\nStatus: ${response.status}\n\n${headerSummary(response.headers)}`,
      );
      if (!allowOrigin) {
        return { status: 'passed', expected: 'No permissive CORS headers for arbitrary origins.', observed: 'No Access-Control-Allow-Origin header returned.', evidenceIds: [evidenceId] };
      }
      const reflects = allowOrigin === probeOrigin || allowOrigin === '*';
      if (!reflects) {
        return { status: 'passed', expected: 'CORS restricted to approved origins.', observed: `Access-Control-Allow-Origin: ${allowOrigin}`, evidenceIds: [evidenceId] };
      }
      const dangerous = allowCredentials === 'true' || allowOrigin === '*';
      const finding: FindingDraft = {
        title: allowCredentials === 'true' ? 'CORS reflects arbitrary origins with credentials' : 'Overly permissive CORS policy',
        category: 'Security configuration',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: '/',
        description: `The application returns Access-Control-Allow-Origin: ${allowOrigin}${allowCredentials === 'true' ? ' together with Access-Control-Allow-Credentials: true' : ''} for an arbitrary Origin header. A hostile site could read authenticated responses from a victim browser where credentials are enabled.`,
        businessImpact: 'Cross-origin data theft from authenticated customers, exposing account and transaction data.',
        detectionMethod: 'Single request with a synthetic Origin header; response CORS headers inspected.',
        confidence: allowCredentials === 'true' ? 'high' : 'medium',
        cwes: ['CWE-942'],
        cvss: base({ AC: 'H', AT: 'N', UI: 'A', VC: allowCredentials === 'true' ? 'H' : 'L', VI: 'L' }),
        frameworkLinks: [{ ...wstg('WSTG-CLNT-07'), rationale: 'Permissive CORS.' }, nist('PR.PS-01')],
        remediation: {
          rootCause: 'CORS is configured with a dynamic or wildcard origin instead of an explicit allow-list.',
          containment: 'Remove the wildcard/reflection and disable credentials for cross-origin requests.',
          shortTerm: 'Restrict Access-Control-Allow-Origin to the approved application origins and validate the Origin header server-side.',
          permanentFix: 'Centralise CORS policy in the API gateway with an allow-list and add configuration tests.',
          verificationCriteria: 'Requests from unapproved origins receive no Access-Control-Allow-Origin header.',
          retestProcedure: 'Repeat the probe with an unapproved Origin and confirm no ACAO is returned.',
          evidenceRequired: 'Before/after header captures for the probe origin and an approved origin.',
          ownerTeam: 'Digital Channels Engineering',
          priority: dangerous ? 'high' : 'medium',
        },
        evidenceIds: [evidenceId],
        contextHints: { exposure: 'internet', compensatingControls: allowCredentials === 'true' ? 'none' : 'partial' },
      };
      return {
        status: 'failed',
        expected: 'CORS restricted to approved origins without wildcard reflection.',
        observed: `Access-Control-Allow-Origin: ${allowOrigin}${allowCredentials ? `, Access-Control-Allow-Credentials: ${allowCredentials}` : ''}`,
        evidenceIds: [evidenceId],
        findings: [finding],
      };
    },
  },
  {
    key: 'web.methods.allowed',
    title: 'HTTP method exposure',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CONF-06' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl, { method: 'OPTIONS' });
      const allow = response.headers['allow'] ?? '';
      const methods = allow.split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);
      const risky = methods.filter((m) => ['TRACE', 'TRACK', 'PUT', 'DELETE', 'CONNECT'].includes(m));
      if (risky.length === 0) {
        return { status: 'passed', expected: 'Only required methods advertised.', observed: methods.length ? `Advertised methods: ${methods.join(', ')}` : 'No method advertisement observed.' };
      }
      return {
        status: 'needs_verification',
        expected: 'Unsafe or unnecessary HTTP methods disabled.',
        observed: `Advertised methods include: ${risky.join(', ')}. Manual verification is required to confirm whether these methods are handled by the banking application or an intermediate component.`,
      };
    },
  },
  {
    key: 'web.fingerprint.server',
    title: 'Technology and version disclosure',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-INFO-02' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const disclosureHeaders = ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator', 'via', 'x-drupal-cache'];
      const disclosed = disclosureHeaders.filter((h) => response.headers[h]).map((h) => `${h}: ${response.headers[h]}`);
      const versionPattern = /\b(apache|nginx|iis|tomcat|jboss|weblogic|php|asp\.net|spring|express)\b[\/\s]?\d+\.\d+/i;
      const bodyDisclosure = versionPattern.exec(response.body)?.[0];
      if (disclosed.length === 0 && !bodyDisclosure) {
        return { status: 'passed', expected: 'No server or framework version information exposed.', observed: 'No version disclosing headers or strings observed.' };
      }
      const finding: FindingDraft = {
        title: 'Server and framework version disclosure',
        category: 'Information disclosure',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: '/',
        description: `Responses disclose technology or version information (${[...disclosed, bodyDisclosure].filter(Boolean).join('; ')}). This assists an attacker in selecting exploits for known vulnerabilities in the identified stack.`,
        businessImpact: 'Increased efficiency of targeted attacks against the digital channel; combined with an unpatched component it may enable compromise.',
        detectionMethod: 'Unauthenticated GET with header and body version pattern inspection.',
        confidence: 'medium',
        cwes: ['CWE-200'],
        cvss: base({ AC: 'H', AT: 'P', UI: 'A', VC: 'L' }),
        frameworkLinks: [{ ...wstg('WSTG-INFO-02'), rationale: 'Web server fingerprinting.' }, nist('PR.PS-01')],
        remediation: {
          rootCause: 'Default server tokens are enabled at the web server or framework layer.',
          shortTerm: 'Suppress Server and X-Powered-By headers at the reverse proxy.',
          permanentFix: 'Apply a hardened baseline image that disables version banners and test it in the deployment pipeline.',
          verificationCriteria: 'No version-revealing headers or strings are returned.',
          retestProcedure: 'Re-issue a GET and inspect response headers and body banners.',
          evidenceRequired: 'Header capture before and after remediation.',
          ownerTeam: 'Infrastructure Security',
          priority: 'low',
        },
        contextHints: { exposure: 'internet', compensatingControls: 'partial' },
      };
      return { status: 'failed', expected: 'No version disclosure.', observed: [...disclosed, bodyDisclosure].filter(Boolean).join('; '), findings: [finding] };
    },
  },
  {
    key: 'web.info_leakage.content',
    title: 'Sensitive information in page content',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-INFO-05' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const body = response.body;
      const indicators: string[] = [];
      const htmlComments = body.match(/<!--[\s\S]{0,400}?-->/g) ?? [];
      const suspiciousComments = htmlComments.filter((c) => /todo|fixme|password|secret|key|test|internal|staging/i.test(c));
      if (suspiciousComments.length) indicators.push(`${suspiciousComments.length} developer comment(s) with sensitive keywords`);
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(body)) indicators.push('private key material');
      if (/\bAKIA[0-9A-Z]{16}\b/.test(body)) indicators.push('AWS access key identifier');
      if (/\bsk_(live|test)_[A-Za-z0-9]{10,}\b/.test(body)) indicators.push('payment provider secret key');
      if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(body)) indicators.push('JSON Web Token');
      const internalHosts = [...new Set((body.match(/\b(?:[a-z0-9-]+\.)+(?:internal|local|corp|lan)\b/gi) ?? []))];
      if (internalHosts.length) indicators.push(`internal hostnames (${internalHosts.slice(0, 3).join(', ')})`);
      const stackTrace = /(at [\w.$]+\([\w.]+:\d+\)|Traceback \(most recent call last\)|java\.lang\.[A-Za-z]+Exception)/.test(body);
      if (stackTrace) indicators.push('stack trace fragments');

      const evidenceId = await ctx.capture('Entry point content excerpt', `GET ${response.requestedUrl}\nContent-Type: ${response.headers['content-type'] ?? 'unknown'}\n\n${body.slice(0, 20_000)}`);
      if (!indicators.length) {
        return { status: 'passed', expected: 'No sensitive information in page content.', observed: 'No developer comments, embedded secrets or internal hostnames observed.', evidenceIds: [evidenceId] };
      }
      const critical = indicators.some((i) => /private key|secret key|access key|JSON Web Token/.test(i));
      const finding: FindingDraft = {
        title: critical ? 'Secret material disclosed in client-side content' : 'Sensitive implementation information disclosed in page content',
        category: 'Information disclosure',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: '/',
        description: `The entry point page discloses: ${indicators.join('; ')}. Values have been redacted in the stored evidence.`,
        businessImpact: critical
          ? 'Exposed credentials or signing material can allow direct compromise of integrated payment services or customer data.'
          : 'Implementation details reduce the effort required for targeted attacks against the banking application.',
        detectionMethod: 'Unauthenticated GET with pattern inspection for secrets, comments and internal hostnames.',
        confidence: critical ? 'high' : 'medium',
        cwes: ['CWE-200', 'CWE-615'],
        cvss: base({ AC: 'H', AT: 'P', UI: 'A', VC: critical ? 'H' : 'L', VI: critical ? 'L' : 'N' }),
        frameworkLinks: [{ ...wstg('WSTG-INFO-05'), rationale: 'Information leakage through page content.' }, nist('PR.DS-01')],
        remediation: {
          rootCause: 'Development artefacts (comments, keys, internal references) reach the production build.',
          containment: 'Revoke and rotate any credential exposed in client-side content.',
          shortTerm: 'Remove sensitive comments and secrets from served content; move secrets to server-side configuration.',
          permanentFix: 'Add automated secret scanning and build-time comment stripping to the release pipeline.',
          verificationCriteria: 'No secrets, developer comments or internal hostnames are present in served pages.',
          retestProcedure: 'Re-fetch the entry point and inspect the content for the identified patterns.',
          evidenceRequired: 'Scrubbed diff or pipeline evidence showing removal and secret rotation.',
          ownerTeam: 'Digital Channels Engineering',
          priority: critical ? 'critical' : 'medium',
        },
        evidenceIds: [evidenceId],
        contextHints: { exposure: 'internet', affectsCustomerFunds: critical },
      };
      return { status: 'failed', expected: 'No sensitive content disclosure.', observed: indicators.join('; '), evidenceIds: [evidenceId], findings: [finding] };
    },
  },
  {
    key: 'web.info_leakage.metafiles',
    title: 'Robots and sitemap disclosure',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-INFO-03' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const target = new URL('/robots.txt', ctx.client.baseUrl).toString();
      if (ctx.approvedPaths.length && !ctx.approvedPaths.some((p) => target.endsWith(p) || p === '/robots.txt')) {
        return {
          status: 'blocked',
          expected: 'robots.txt and sitemap reviewed for sensitive path disclosure.',
          observed: '/robots.txt is not inside the approved paths for this asset, so it was not requested. Add it to the approved paths to enable this check.',
        };
      }
      try {
        const response = await ctx.client.request(target);
        if (response.status !== 200) {
          return { status: 'passed', expected: 'No sensitive paths disclosed in metafiles.', observed: `robots.txt not present (HTTP ${response.status}).` };
        }
        const disallowed = (response.body.match(/^Disallow:\s*\S+/gim) ?? []).map((l) => l.trim());
        const sensitive = disallowed.filter((line) => /admin|internal|api|test|dev|backup|\.git/i.test(line));
        const evidenceId = await ctx.capture('robots.txt content', response.body.slice(0, 8000));
        if (!sensitive.length) {
          return { status: 'passed', expected: 'Metafiles do not disclose sensitive paths.', observed: `${disallowed.length} Disallow entries without sensitive path patterns.`, evidenceIds: [evidenceId] };
        }
        return {
          status: 'needs_verification',
          expected: 'Metafiles do not disclose sensitive paths.',
          observed: `robots.txt discloses potentially sensitive paths: ${sensitive.slice(0, 6).join(', ')}. Verify that these paths are protected by authentication.`,
          evidenceIds: [evidenceId],
        };
      } catch (error) {
        return { status: 'error', expected: 'robots.txt reviewed.', observed: (error as Error).message };
      }
    },
  },
  {
    key: 'web.error_handling.verbose',
    title: 'Error handling and information disclosure',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-ERRH-01' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const probePath = `${new URL(ctx.client.baseUrl).pathname.replace(/\/$/, '')}/ficap-nonexistent-${Date.now().toString(36)}`;
      const target = new URL(probePath, ctx.client.baseUrl).toString();
      const response = await ctx.client.request(target);
      const evidenceId = await ctx.capture('Error response for a non-existent path', `GET ${target}\nStatus: ${response.status}\n\n${response.body.slice(0, 8000)}`);
      const verbose = /(stack trace|at [\w.$]+\(|Exception|SQLException|ORA-\d{5}|syntax error|Warning:|Fatal error)/i.test(response.body);
      if (!verbose) {
        return { status: 'passed', expected: 'Generic error responses without internal detail.', observed: `HTTP ${response.status} returned without internal error detail.`, evidenceIds: [evidenceId] };
      }
      const finding: FindingDraft = {
        title: 'Verbose error responses disclose application internals',
        category: 'Error handling',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: probePath,
        description: 'A request for a non-existent path returned internal error detail (stack traces, framework exceptions or database messages). Error detail helps attackers map the application and may expose sensitive values.',
        businessImpact: 'Faster exploitation of other weaknesses and possible disclosure of internal architecture or data.',
        detectionMethod: 'Single unauthenticated GET to a non-existent path within the approved path prefix.',
        confidence: 'high',
        cwes: ['CWE-209'],
        cvss: base({ AC: 'H', AT: 'P', UI: 'A', VC: 'L' }),
        frameworkLinks: [{ ...wstg('WSTG-ERRH-01'), rationale: 'Improper error handling.' }, nist('PR.PS-01')],
        remediation: {
          rootCause: 'Debug mode or default error pages are enabled in the deployed environment.',
          shortTerm: 'Disable detailed error output and return a generic error page with a correlation identifier.',
          permanentFix: 'Centralise error handling, log detail server-side and enforce environment configuration in CI.',
          verificationCriteria: 'Error responses contain no stack traces or framework internals.',
          retestProcedure: 'Repeat the non-existent path request and inspect the response body.',
          evidenceRequired: 'Error response capture before and after remediation.',
          ownerTeam: 'Digital Channels Engineering',
          priority: 'medium',
        },
        evidenceIds: [evidenceId],
        contextHints: { exposure: 'internet' },
      };
      return { status: 'failed', expected: 'Generic error page.', observed: 'Internal error detail returned.', evidenceIds: [evidenceId], findings: [finding] };
    },
  },
  {
    key: 'web.error_handling.stack_traces',
    title: 'Stack trace and framework disclosure',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-ERRH-02' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const patterns = /(at [\w.$]+\([\w.]+:\d+\)|Traceback \(most recent call last\)|java\.lang\.[A-Za-z]+Exception|Microsoft OLE DB|System\.Data\.SqlClient)/;
      const match = patterns.exec(response.body) ?? patterns.exec(response.headers['x-error'] ?? '');
      if (!match) return { status: 'passed', expected: 'No stack traces in responses.', observed: 'No stack trace patterns observed on the entry point.' };
      return { status: 'needs_verification', expected: 'No stack traces in responses.', observed: `Stack trace pattern observed: ${match[0].slice(0, 120)}` };
    },
  },
  {
    key: 'web.session.cookie_attributes',
    title: 'Session cookie attributes',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-SESS-02' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const cookies = parseCookies(response.headers['set-cookie']);
      if (cookies.length === 0) {
        return { status: 'needs_verification', expected: 'Session cookies carry Secure, HttpOnly and SameSite attributes.', observed: 'No cookies were set on the entry point; session cookie attributes require an authenticated session (approved test account needed).' };
      }
      const issues: string[] = [];
      for (const cookie of cookies) {
        const attrs = cookie.attributes.map((a) => a.toLowerCase());
        const isHttps = response.finalUrl.startsWith('https://');
        if (isHttps && !attrs.some((a) => a === 'secure')) issues.push(`${cookie.name}: missing Secure`);
        if (!attrs.some((a) => a === 'httponly')) issues.push(`${cookie.name}: missing HttpOnly`);
        if (!attrs.some((a) => a.startsWith('samesite'))) issues.push(`${cookie.name}: missing SameSite`);
        else if (attrs.some((a) => a === 'samesite=none') && !attrs.some((a) => a === 'secure')) issues.push(`${cookie.name}: SameSite=None without Secure`);
      }
      const evidenceId = await ctx.capture('Set-Cookie attributes', `GET ${response.requestedUrl}\n\n${(response.headers['set-cookie'] ?? '').replace(/\[REDACTED\]/g, '[REDACTED]')}`);
      if (!issues.length) {
        return { status: 'passed', expected: 'Secure cookie attributes.', observed: `${cookies.length} cookie(s) with Secure, HttpOnly and SameSite.`, evidenceIds: [evidenceId] };
      }
      const finding: FindingDraft = {
        title: 'Session cookie missing security attributes',
        category: 'Session management',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: '/',
        description: `Cookies are issued without recommended security attributes: ${issues.join('; ')}. Missing HttpOnly exposes session identifiers to script-based theft; missing Secure allows transmission over cleartext; missing SameSite increases cross-site request risk.`,
        businessImpact: 'Session hijacking or cross-site request forgery enabling unauthorised account access and transfers.',
        detectionMethod: 'Unauthenticated GET; Set-Cookie attributes inspected (values redacted).',
        confidence: 'high',
        cwes: ['CWE-1004', 'CWE-614'],
        cvss: base({ AC: 'H', AT: 'P', UI: 'A', VC: 'H', VI: 'L' }),
        frameworkLinks: [{ ...wstg('WSTG-SESS-02'), rationale: 'Cookie attributes.' }, nist('PR.DS-02')],
        remediation: {
          rootCause: 'Cookie policy does not set HttpOnly/Secure/SameSite on session cookies.',
          shortTerm: 'Set HttpOnly, Secure and SameSite=Lax (or Strict) on all session cookies and rotate existing sessions.',
          permanentFix: 'Apply a central cookie policy in the framework configuration and assert it in automated tests.',
          verificationCriteria: 'All session cookies include HttpOnly, Secure and SameSite attributes.',
          retestProcedure: 'Re-issue a request and inspect Set-Cookie attributes, including after authentication.',
          evidenceRequired: 'Set-Cookie headers before and after remediation.',
          ownerTeam: 'Digital Channels Engineering',
          priority: 'high',
        },
        evidenceIds: [evidenceId],
        contextHints: { exposure: 'internet', affectsCustomerFunds: true },
      };
      return { status: 'failed', expected: 'Secure cookie attributes.', observed: issues.join('; '), evidenceIds: [evidenceId], findings: [finding] };
    },
  },
  {
    key: 'web.cache.control',
    title: 'Caching of sensitive responses',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-AUTHN-06' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const cacheControl = (response.headers['cache-control'] ?? '').toLowerCase();
      const pragma = (response.headers['pragma'] ?? '').toLowerCase();
      const contentType = response.headers['content-type'] ?? '';
      const isHtml = contentType.includes('text/html');
      if (!isHtml) return { status: 'skipped', expected: 'Sensitive pages marked no-store.', observed: `Entry point content type is ${contentType || 'unknown'}; caching review requires an HTML page.` };
      const noStore = cacheControl.includes('no-store') || cacheControl.includes('no-cache') || pragma.includes('no-cache');
      if (noStore) return { status: 'passed', expected: 'Sensitive pages marked no-store.', observed: `Cache-Control: ${cacheControl || 'absent'}; Pragma: ${pragma || 'absent'}` };
      return {
        status: 'needs_verification',
        expected: 'Authenticated pages must send Cache-Control: no-store.',
        observed: 'The unauthenticated entry point is cacheable. Confirm caching headers on authenticated pages with an approved test account.',
      };
    },
  },
  {
    key: 'web.csrf.form_tokens',
    title: 'Anti-CSRF tokens on forms',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-SESS-05' }))(),
    automation: 'hybrid',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const forms = response.body.match(/<form[\s\S]{0,4000}?<\/form>/gi) ?? [];
      if (forms.length === 0) {
        return { status: 'needs_verification', expected: 'State-changing forms include anti-CSRF tokens.', observed: 'No HTML forms on the entry point. Verify anti-CSRF controls on authenticated transaction forms with an approved test account.' };
      }
      const formsWithoutToken = forms.filter((form) => {
        const isStateChanging = /method\s*=\s*["']?post/i.test(form) || /action\s*=\s*["'][^"']*(transaction|transfer|update|create)/i.test(form);
        const hasToken = /name\s*=\s*["'][^"']*(csrf|xsrf|authenticity|_token|requestverificationtoken)[^"']*["']/i.test(form);
        return isStateChanging && !hasToken;
      });
      if (formsWithoutToken.length === 0) {
        return { status: 'passed', expected: 'State-changing forms include anti-CSRF tokens.', observed: `${forms.length} form(s) inspected; all state-changing forms include a token field.` };
      }
      return {
        status: 'needs_verification',
        expected: 'State-changing forms include anti-CSRF tokens.',
        observed: `${formsWithoutToken.length} of ${forms.length} state-changing form(s) do not include a visible anti-CSRF token field. Confirm whether the protection is header-based (e.g. SameSite plus custom header) before raising a finding.`,
      };
    },
  },
  {
    key: 'web.exposure.admin_interface',
    title: 'Exposure of administrative interfaces',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CONF-05' }))(),
    automation: 'hybrid',
    run: async (ctx) => {
      const candidates = ctx.approvedPaths.filter((p) => /admin|manage|console|dashboard|ops|internal/i.test(p));
      if (!candidates.length) {
        return {
          status: 'blocked',
          expected: 'Administrative interfaces require authentication and are not publicly discoverable.',
          observed: 'No administrative paths were approved for probing. Add specific administrative paths to the engagement scope to enable this check.',
        };
      }
      const exposed: string[] = [];
      const evidenceIds: string[] = [];
      for (const path of candidates.slice(0, 6)) {
        const target = new URL(path, ctx.client.baseUrl).toString();
        const response = await ctx.client.request(target);
        evidenceIds.push(await ctx.capture(`Administrative interface probe ${path}`, `GET ${target}\nStatus: ${response.status}\n\n${headerSummary(response.headers)}`));
        if (response.status === 200 && !/login|sign in|authenticate/i.test(response.body)) exposed.push(`${path} (HTTP 200 without authentication challenge)`);
      }
      if (!exposed.length) {
        return { status: 'passed', expected: 'Administrative interfaces protected.', observed: 'All approved administrative paths required authentication or did not exist.', evidenceIds };
      }
      const finding: FindingDraft = {
        title: 'Administrative interface accessible without authentication',
        category: 'Access control',
        asset: new URL(ctx.client.baseUrl).host,
        endpoint: exposed[0],
        description: `The following administrative interfaces responded with content without an authentication challenge: ${exposed.join('; ')}. Publicly reachable administrative functionality is a high-impact exposure in banking environments.`,
        businessImpact: 'Potential unauthorised administrative actions including customer record access, limit changes and transaction manipulation.',
        detectionMethod: 'Approved-path GET requests; responses inspected for authentication challenges.',
        confidence: 'medium',
        cwes: ['CWE-306'],
        cvss: base({ AC: 'L', VC: 'H', VI: 'H', VA: 'L', SC: 'L', SI: 'L' }),
        frameworkLinks: [{ ...wstg('WSTG-CONF-05'), rationale: 'Administrative interface enumeration.' }, apiRisk('API5:2023'), nist('PR.AA-05')],
        remediation: {
          rootCause: 'Administrative functionality is deployed on the public interface without network or identity controls.',
          containment: 'Restrict access at the edge to approved administrative networks and enforce strong authentication.',
          shortTerm: 'Require administrative authentication, MFA and source restriction for all administrative paths.',
          permanentFix: 'Separate administrative planes from customer-facing ingress and enforce just-in-time privileged access.',
          verificationCriteria: 'Administrative paths return an authentication challenge or are unreachable from the public network.',
          retestProcedure: 'Repeat the approved-path probes without credentials and confirm denial.',
          evidenceRequired: 'Response status and bodies before and after remediation.',
          ownerTeam: 'Digital Channels / Infrastructure Security',
          priority: 'critical',
        },
        evidenceIds,
        contextHints: { exposure: 'internet', privilegedAccess: true, affectsCustomerFunds: true, affectsPaymentIntegrity: true },
      };
      return { status: 'failed', expected: 'Administrative interfaces protected.', observed: exposed.join('; '), evidenceIds, findings: [finding] };
    },
  },
  {
    key: 'web.exposure.directory_listing',
    title: 'Directory listing exposure',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CONF-04' }))(),
    automation: 'hybrid',
    run: async (ctx) => {
      const candidates = ctx.approvedPaths.filter((p) => p.endsWith('/'));
      if (!candidates.length) {
        return { status: 'blocked', expected: 'Directory listing disabled.', observed: 'No directory paths were approved for probing.' };
      }
      const exposed: string[] = [];
      for (const path of candidates.slice(0, 5)) {
        const target = new URL(path, ctx.client.baseUrl).toString();
        const response = await ctx.client.request(target);
        if (/<title>\s*Index of \/|<h1>\s*Index of \//i.test(response.body)) exposed.push(path);
      }
      if (!exposed.length) return { status: 'passed', expected: 'Directory listing disabled.', observed: 'No directory listings observed on approved directory paths.' };
      return { status: 'failed', expected: 'Directory listing disabled.', observed: `Directory listing enabled at: ${exposed.join(', ')}` };
    },
  },
  {
    key: 'web.input.reflection',
    title: 'Reflected input handling (controlled marker)',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-INPV-01' }))(),
    automation: 'hybrid',
    requires: ['input_validation'],
    run: async (ctx) => {
      if (!ctx.allowed.inputProbes) {
        return {
          status: 'blocked',
          expected: 'Reflected parameters are correctly encoded.',
          observed: 'Input validation probing is not permitted by the engagement authorisation. This check requires the "Non-destructive input validation probes" method.',
        };
      }
      const marker = `ficapx${Math.random().toString(36).slice(2, 8)}`;
      const url = new URL(ctx.client.baseUrl);
      url.searchParams.set('q', marker);
      const response = await ctx.client.request(url.toString());
      const reflected = response.body.includes(marker);
      if (!reflected) return { status: 'passed', expected: 'Controlled marker not reflected unsafely.', observed: 'Marker was not reflected in the response.' };
      const context = /<script[^>]*>[^<]*ficapx/i.test(response.body)
        ? 'inside a script block'
        : /<[^>]*ficapx/i.test(response.body)
          ? 'inside an HTML attribute'
          : 'in HTML body text';
      return {
        status: 'needs_verification',
        expected: 'Controlled marker is encoded or not reflected.',
        observed: `The controlled alphanumeric marker was reflected ${context}. No executable payload was used. Manual verification with an approved tester and a safe, non-destructive payload is required before raising a cross-site scripting finding.`,
      };
    },
  },
  {
    key: 'web.client.browser_storage',
    title: 'Sensitive values in client-side storage',
    module: 'web',
    ...(() => ({ frameworkKey: 'owasp-wstg', frameworkVersion: WSTG_VERSION, frameworkItemCode: 'WSTG-CLNT-12' }))(),
    automation: 'automated',
    run: async (ctx) => {
      const response = await ctx.client.request(ctx.client.baseUrl);
      const patterns = /localStorage\.setItem\(\s*["']([^"']+)["']|sessionStorage\.setItem\(\s*["']([^"']+)["']/gi;
      const keys: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = patterns.exec(response.body)) !== null) keys.push(match[1] ?? match[2]);
      const sensitiveKeys = keys.filter((k) => /token|auth|session|password|pin|account|otp/i.test(k));
      if (!sensitiveKeys.length) return { status: 'passed', expected: 'No sensitive values persisted in browser storage.', observed: keys.length ? `Storage keys observed: ${keys.join(', ')}` : 'No browser storage writes observed on the entry point.' };
      return {
        status: 'needs_verification',
        expected: 'Authentication tokens are not stored in localStorage/sessionStorage.',
        observed: `Potentially sensitive browser storage keys observed: ${sensitiveKeys.join(', ')}. Confirm by inspecting client storage during an authenticated session.`,
      };
    },
  },
];

/** Catalogue entries that require a human assessor for this module. */
export const WEB_MANUAL_TESTS = [
  'WSTG-ATHN-02', 'WSTG-ATHN-03', 'WSTG-ATHN-04', 'WSTG-ATHN-05', 'WSTG-ATHN-07', 'WSTG-ATHN-09',
  'WSTG-ATHZ-01', 'WSTG-ATHZ-02', 'WSTG-ATHZ-03', 'WSTG-ATHZ-04', 'WSTG-ATHZ-05',
  'WSTG-SESS-03', 'WSTG-SESS-04', 'WSTG-SESS-06', 'WSTG-SESS-07',
  'WSTG-INPV-02', 'WSTG-INPV-05', 'WSTG-INPV-12', 'WSTG-INPV-17', 'WSTG-INPV-18', 'WSTG-INPV-19',
  'WSTG-BUSL-01', 'WSTG-BUSL-02', 'WSTG-BUSL-06', 'WSTG-BUSL-07', 'WSTG-BUSL-08',
  'WSTG-CLNT-01', 'WSTG-CLNT-10', 'WSTG-CLNT-11',
];

export function manualPrerequisiteFor(item: string): string {
  if (/ATHZ|ATHN/.test(item)) return 'Requires approved test identities with distinct roles and an authorised authenticated test window.';
  if (/BUSL/.test(item)) return 'Requires a sandbox environment, synthetic accounts and institution approval for business flow testing.';
  if (/INPV/.test(item)) return 'Requires input validation permission and a non-destructive payload set approved by the engagement owner.';
  return 'Requires manual assessor execution and supporting evidence.';
}
