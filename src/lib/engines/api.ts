import type { CheckDefinition, EngineContext, FindingDraft } from '@/lib/engines/types';
import { apiRisk } from '@/lib/engines/web';

export const API_VERSION = '2023';

export type ApiEndpointRecord = {
  method: string;
  path: string;
  summary: string | null;
  authRequired: boolean | null;
  roles: string[];
  params: { name: string; in: string; required: boolean }[];
  operationId?: string;
};

export type ApiSpec = {
  title: string;
  version: string;
  baseUrl: string | null;
  endpoints: ApiEndpointRecord[];
  securitySchemes: string[];
  serverUrls: string[];
  parseErrors: string[];
};

/** Parse an OpenAPI 2/3 or Postman collection document into a normalised inventory. */
export function parseApiSpec(raw: string, fallbackBaseUrl: string | null): ApiSpec {
  const spec: ApiSpec = { title: 'API specification', version: 'unknown', baseUrl: fallbackBaseUrl, endpoints: [], securitySchemes: [], serverUrls: [], parseErrors: [] };
  let doc: any;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    spec.parseErrors.push(`Specification is not valid JSON: ${(error as Error).message}`);
    return spec;
  }

  // Postman collection v2.x
  if (doc.info && Array.isArray(doc.item)) {
    spec.title = doc.info.name ?? 'Postman collection';
    const walk = (items: any[], prefix = '') => {
      for (const item of items) {
        if (Array.isArray(item.item)) {
          walk(item.item, `${prefix}/${item.name ?? ''}`);
          continue;
        }
        const request = item.request;
        if (!request) continue;
        const method = String(request.method ?? 'GET').toUpperCase();
        let path = '';
        if (typeof request.url === 'string') path = request.url;
        else if (request.url?.raw) path = request.url.raw;
        else if (Array.isArray(request.url?.path)) path = `/${request.url.path.join('/')}`;
        path = path.replace(/^\{\{[^}]+\}\}/, '').replace(/^https?:\/\/[^/]+/, '');
        if (!path.startsWith('/')) path = `/${path}`;
        spec.endpoints.push({
          method,
          path: path.split('?')[0],
          summary: item.name ?? null,
          authRequired: request.auth ? true : null,
          roles: [],
          params: [],
        });
      }
    };
    walk(doc.item);
    return spec;
  }

  // OpenAPI 2/3
  spec.title = doc.info?.title ?? 'API';
  spec.version = String(doc.info?.version ?? 'unknown');
  const servers: string[] = [];
  if (Array.isArray(doc.servers)) servers.push(...doc.servers.map((s: any) => s.url).filter(Boolean));
  if (doc.host) servers.push(`${doc.schemes?.[0] ?? 'https'}://${doc.host}${doc.basePath ?? ''}`);
  spec.serverUrls = servers;
  spec.baseUrl = servers[0] ?? fallbackBaseUrl;
  if (doc.components?.securitySchemes) spec.securitySchemes = Object.keys(doc.components.securitySchemes);
  else if (doc.securityDefinitions) spec.securitySchemes = Object.keys(doc.securityDefinitions);

  const globalSecurity = Array.isArray(doc.security) && doc.security.length > 0;
  for (const [path, methods] of Object.entries<any>(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries<any>(methods ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.toLowerCase())) continue;
      if (!operation || typeof operation !== 'object') continue;
      const params: ApiEndpointRecord['params'] = [];
      for (const parameter of [...(operation.parameters ?? []), ...(methods.parameters ?? [])]) {
        if (!parameter?.name) continue;
        params.push({ name: parameter.name, in: parameter.in ?? 'query', required: Boolean(parameter.required) });
      }
      if (operation.requestBody?.content) {
        const schema = Object.values<any>(operation.requestBody.content)[0]?.schema;
        for (const property of Object.keys(schema?.properties ?? {})) {
          params.push({ name: property, in: 'body', required: Boolean(schema?.required?.includes?.(property)) });
        }
      }
      const security = operation.security ?? (globalSecurity ? doc.security : undefined);
      spec.endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? operation.description?.slice(0, 160) ?? null,
        authRequired: Array.isArray(security) ? security.length > 0 : security === undefined ? null : true,
        roles: [],
        params,
        operationId: operation.operationId,
      });
    }
  }
  return spec;
}

function base(overrides: Record<string, string>): Record<string, string> {
  return { AV: 'N', AC: 'L', AT: 'N', PR: 'N', UI: 'N', VC: 'N', VI: 'N', VA: 'N', SC: 'N', SI: 'N', SA: 'N', ...overrides };
}

export function apiChecks(getSpec: () => ApiSpec | null): CheckDefinition[] {
  return [
    {
      key: 'api.inventory.spec',
      title: 'API specification inventory',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API9:2023',
      automation: 'automated',
      run: async (ctx) => {
        const spec = getSpec();
        if (!spec) {
          return {
            status: 'blocked',
            expected: 'An authoritative API inventory (OpenAPI or Postman) is available.',
            observed: 'No API specification was supplied for this application. Endpoint-level testing cannot be performed, and absence of a specification is itself an inventory management weakness to confirm with the institution.',
          };
        }
        const readMethods = spec.endpoints.filter((e) => ['GET', 'HEAD'].includes(e.method));
        const writeMethods = spec.endpoints.filter((e) => !['GET', 'HEAD'].includes(e.method));
        return {
          status: spec.endpoints.length > 0 ? 'passed' : 'failed',
          expected: 'An authoritative API inventory exists and is complete.',
          observed: `${spec.endpoints.length} endpoint(s) inventoried from ${spec.title} v${spec.version}: ${readMethods.length} read and ${writeMethods.length} write operations; ${spec.securitySchemes.length} security scheme(s) declared.`,
        };
      },
    },
    {
      key: 'api.auth.unauthenticated_access',
      title: 'Unauthenticated access to protected endpoints',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API2:2023',
      automation: 'hybrid',
      run: async (ctx) => {
        const spec = getSpec();
        if (!spec) return { status: 'blocked', expected: 'Protected endpoints reject unauthenticated requests.', observed: 'No API specification available for endpoint testing.' };
        const candidates = spec.endpoints.filter((e) => e.method === 'GET' && e.authRequired !== false).slice(0, 25);
        if (!candidates.length) return { status: 'needs_verification', expected: 'Protected endpoints reject unauthenticated requests.', observed: 'The specification declares no authenticated GET endpoints to probe.' };

        const accessible: string[] = [];
        const blockedByScope: string[] = [];
        const evidenceIds: string[] = [];
        for (const endpoint of candidates) {
          const url = new URL(endpoint.path.replace(/\{[^}]+\}/g, 'ficap-test-id'), ctx.client.baseUrl).toString();
          try {
            const response = await ctx.client.request(url);
            if (response.status >= 200 && response.status < 300) {
              const contentType = response.headers['content-type'] ?? '';
              if (/json|xml/.test(contentType)) {
                accessible.push(`${endpoint.method} ${endpoint.path} → HTTP ${response.status}`);
                if (evidenceIds.length < 5) {
                  evidenceIds.push(await ctx.capture(`Unauthenticated response for ${endpoint.path}`, `GET ${url}\nStatus: ${response.status}\n\n${response.body.slice(0, 4000)}`));
                }
              }
            }
          } catch (error) {
            blockedByScope.push(`${endpoint.path}: ${(error as Error).message}`);
          }
        }
        if (!accessible.length) {
          return {
            status: blockedByScope.length === candidates.length ? 'blocked' : 'passed',
            expected: 'Protected endpoints reject unauthenticated requests.',
            observed: blockedByScope.length === candidates.length
              ? `All probes were blocked before reaching the API: ${blockedByScope[0]}`
              : `${candidates.length} endpoint(s) probed without credentials; none returned a success response.`,
          };
        }
        const finding: FindingDraft = {
          title: 'API endpoints return data without authentication',
          category: 'API authentication',
          asset: new URL(ctx.client.baseUrl).host,
          endpoint: accessible[0].split(' → ')[0],
          description: `The following endpoints returned successful responses to unauthenticated requests: ${accessible.join('; ')}. Where these routes expose customer or account data, this constitutes broken authentication (OWASP API2:2023).`,
          businessImpact: 'Unauthenticated access to banking API data enables account enumeration and disclosure of customer information without any credential.',
          detectionMethod: 'Unauthenticated GET requests to endpoints declared as authenticated in the API specification.',
          confidence: 'medium',
          cwes: ['CWE-306'],
          cvss: base({ AC: 'L', VC: 'H', VI: 'L', SC: 'L' }),
          frameworkLinks: [
            { ...apiRisk('API2:2023'), rationale: 'Endpoints declared as authenticated returned data without credentials.' },
            { frameworkKey: 'nist-csf', frameworkVersion: '2.0', itemCode: 'PR.AA-03' },
          ],
          remediation: {
            rootCause: 'Authentication middleware is not applied consistently to all routes, or the specification does not reflect the deployed behaviour.',
            shortTerm: 'Enforce authentication at the gateway for all routes and verify the specification matches the deployment.',
            permanentFix: 'Apply authentication as a default-deny policy with route-level exceptions reviewed and tested in CI.',
            verificationCriteria: 'All endpoints declared as authenticated return 401/403 without a valid token.',
            retestProcedure: 'Repeat unauthenticated GET requests to the inventory and confirm rejection.',
            evidenceRequired: 'Response status codes per endpoint before and after remediation.',
            ownerTeam: 'API Platform Engineering',
            priority: 'critical',
          },
          evidenceIds,
          contextHints: { exposure: 'internet', data_sensitivity: 3 } as any,
        };
        return { status: 'failed', expected: 'Protected endpoints reject unauthenticated requests.', observed: accessible.join('; '), evidenceIds, findings: [finding] };
      },
    },
    {
      key: 'api.headers.security',
      title: 'API security headers and configuration',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API8:2023',
      automation: 'automated',
      run: async (ctx) => {
        const response = await ctx.client.request(ctx.client.baseUrl);
        const headers = response.headers;
        const missing = ['x-content-type-options', 'strict-transport-security'].filter((h) => !headers[h]);
        const evidenceId = await ctx.capture('API gateway response headers', `GET ${ctx.client.baseUrl}\nStatus: ${response.status}\n\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n')}`);
        if (!missing.length) return { status: 'passed', expected: 'API gateway applies baseline security headers.', observed: 'Baseline headers present.', evidenceIds: [evidenceId] };
        return {
          status: 'failed',
          expected: 'API gateway applies baseline security headers.',
          observed: `Missing headers on the API base URL: ${missing.join(', ')}.`,
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'api.errors.verbose',
      title: 'API error handling',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API8:2023',
      automation: 'automated',
      run: async (ctx) => {
        const url = new URL('/ficap-nonexistent-endpoint', ctx.client.baseUrl).toString();
        try {
          const response = await ctx.client.request(url);
          const verbose = /(stack|exception|trace|sql|at [\w.$]+\(|debug)/i.test(response.body);
          const evidenceId = await ctx.capture('API error response for a non-existent endpoint', `GET ${url}\nStatus: ${response.status}\n\n${response.body.slice(0, 6000)}`);
          return {
            status: verbose ? 'failed' : 'passed',
            expected: 'Generic, consistent error envelope without internal detail.',
            observed: verbose ? `HTTP ${response.status} returned internal error detail.` : `HTTP ${response.status} returned without internal error detail.`,
            evidenceIds: [evidenceId],
          };
        } catch (error) {
          return { status: 'blocked', expected: 'Error envelope assessed.', observed: `Probe blocked: ${(error as Error).message}` };
        }
      },
    },
    {
      key: 'api.rate_limit.headers',
      title: 'Rate limit signalling',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API4:2023',
      automation: 'automated',
      run: async (ctx) => {
        const response = await ctx.client.request(ctx.client.baseUrl);
        const headers = Object.keys(response.headers).filter((h) => /ratelimit|retry-after|x-rate/i.test(h));
        return {
          status: headers.length ? 'passed' : 'needs_verification',
          expected: 'Rate limits are advertised and enforced (RateLimit-* or Retry-After headers).',
          observed: headers.length
            ? `Rate limit headers observed: ${headers.join(', ')}. Enforcement thresholds still require a bounded behavioural check.`
            : 'No rate-limit headers were returned. Confirm gateway limits with a bounded behavioural check if the engagement authorises it.',
        };
      },
    },
    {
      key: 'api.rate_limit.behavior',
      title: 'Bounded rate limit behaviour',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API4:2023',
      automation: 'hybrid',
      requires: ['bounded_rate_limit'],
      run: async (ctx) => {
        if (!ctx.allowed.boundedRateLimit) {
          return { status: 'blocked', expected: 'Rate limiting enforced.', observed: 'Bounded rate-limit probing is not authorised for this engagement. Only five additional requests would be issued.' };
        }
        const url = new URL('/ficap-rate-check', ctx.client.baseUrl).toString();
        const statuses: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          try {
            const response = await ctx.client.request(url);
            statuses.push(response.status);
          } catch {
            break;
          }
        }
        const throttled = statuses.includes(429);
        return {
          status: throttled ? 'passed' : 'needs_verification',
          expected: 'The gateway throttles excessive requests with HTTP 429.',
          observed: `Five sequential requests returned: ${statuses.join(', ') || 'no responses'}. ${throttled ? 'Throttling observed.' : 'No throttling observed within five requests; confirm documented limits with the institution.'}`,
        };
      },
    },
    {
      key: 'api.versioning.inventory',
      title: 'API version inventory',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API9:2023',
      automation: 'automated',
      run: async (ctx) => {
        const spec = getSpec();
        if (!spec) return { status: 'blocked', expected: 'API versions are inventoried and deprecated versions retired.', observed: 'No specification available.' };
        const versions = new Set<string>();
        for (const endpoint of spec.endpoints) {
          const match = /\/v(\d+(?:\.\d+)?)\//.exec(endpoint.path) ?? /\/(v\d+)\b/.exec(endpoint.path);
          if (match) versions.add(match[1]);
        }
        for (const server of spec.serverUrls) {
          const match = /\/v(\d+(?:\.\d+)?)/.exec(server);
          if (match) versions.add(match[1]);
        }
        const list = [...versions];
        return {
          status: list.length > 1 ? 'needs_verification' : 'passed',
          expected: 'A single supported API version per channel, with older versions retired.',
          observed: list.length > 1
            ? `Multiple API versions are exposed (${list.map((v) => `v${v}`).join(', ')}). Confirm that deprecated versions are retired and documented.`
            : `API version(s) observed: ${list.map((v) => `v${v}`).join(', ') || 'no explicit version segment'}.`,
        };
      },
    },
    {
      key: 'api.documentation.exposure',
      title: 'API documentation exposure',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API9:2023',
      automation: 'hybrid',
      run: async (ctx) => {
        const candidates = ctx.approvedPaths.filter((p) => /openapi|swagger|docs|api-docs/i.test(p));
        if (!candidates.length) return { status: 'blocked', expected: 'Interactive API documentation is not publicly accessible.', observed: 'No documentation paths were approved for probing.' };
        const exposed: string[] = [];
        for (const path of candidates.slice(0, 4)) {
          const url = new URL(path, ctx.client.baseUrl).toString();
          try {
            const response = await ctx.client.request(url);
            if (response.status === 200 && /openapi|swagger|"paths"/i.test(response.body)) exposed.push(path);
          } catch {
            /* blocked by scope - recorded below */
          }
        }
        return {
          status: exposed.length ? 'needs_verification' : 'passed',
          expected: 'API documentation is restricted to authorised consumers.',
          observed: exposed.length ? `Interactive documentation is publicly reachable at: ${exposed.join(', ')}. Confirm whether exposure of the full API surface is intended.` : 'No publicly reachable interactive documentation observed on approved paths.',
        };
      },
    },
    {
      key: 'api.data_exposure.sensitive_fields',
      title: 'Sensitive fields in API responses',
      module: 'api',
      frameworkKey: 'owasp-api-top10',
      frameworkVersion: API_VERSION,
      frameworkItemCode: 'API3:2023',
      automation: 'hybrid',
      run: async (ctx) => {
        const spec = getSpec();
        const candidates = (spec?.endpoints ?? []).filter((e) => e.method === 'GET').slice(0, 10);
        if (!candidates.length) return { status: 'blocked', expected: 'Responses contain only fields required by the consumer.', observed: 'No GET endpoints available to inspect.' };
        const sensitive: string[] = [];
        for (const endpoint of candidates) {
          const url = new URL(endpoint.path.replace(/\{[^}]+\}/g, 'ficap-test-id'), ctx.client.baseUrl).toString();
          try {
            const response = await ctx.client.request(url);
            if (response.status >= 200 && response.status < 300 && /json/i.test(response.headers['content-type'] ?? '')) {
              const patterns: [RegExp, string][] = [
                [/"\s*(bvn|nin|card_?number|pan|pin|cvv|password|secret|token)\s*"/i, 'sensitive field names'],
                [/\b\d{11}\b/, '11-digit identifiers'],
                [/\b(?:\d[ -]?){13,19}\b/, 'card-number-like values'],
              ];
              for (const [pattern, label] of patterns) {
                if (pattern.test(response.body)) sensitive.push(`${endpoint.path}: ${label}`);
              }
            }
          } catch {
            /* scope blocked */
          }
        }
        if (!sensitive.length) return { status: 'passed', expected: 'No excessive data exposure observed.', observed: `${candidates.length} response(s) inspected for sensitive field patterns.` };
        return {
          status: 'needs_verification',
          expected: 'Responses contain only fields required by the consumer.',
          observed: `Potential excessive data exposure in: ${[...new Set(sensitive)].join('; ')}. Values were redacted in stored evidence. Verify with synthetic accounts whether these fields belong to other customers or are unnecessary.`,
        };
      },
    },
  ];
}

export const API_MANUAL_TESTS: { code: string; prerequisite: string }[] = [
  { code: 'API1:2023', prerequisite: 'Requires two approved test identities and synthetic objects to attempt object-level access.' },
  { code: 'API3:2023', prerequisite: 'Requires authenticated test accounts to observe property filtering and mass assignment behaviour.' },
  { code: 'API5:2023', prerequisite: 'Requires approved role sets (customer, maker, checker, administrator) to test function-level authorization.' },
  { code: 'API6:2023', prerequisite: 'Requires a sandbox environment, synthetic accounts and institution approval for business flow testing.' },
  { code: 'API7:2023', prerequisite: 'Requires an approved outbound canary target; SSRF probing against internal services is prohibited.' },
  { code: 'API10:2023', prerequisite: 'Requires the third-party integration inventory and sandbox credentials for upstream services.' },
];
