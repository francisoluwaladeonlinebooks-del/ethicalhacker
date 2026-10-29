import net from 'node:net';
import dns from 'node:dns/promises';

/**
 * Engagement scope enforcement.
 *
 * Every outbound assessment request passes through `evaluateTarget` before a
 * socket is opened. The rules are intentionally strict:
 *   - exact host match (or an explicitly approved subdomain rule);
 *   - no credentials, fragments or unexpected ports in URLs;
 *   - method allow-list per asset;
 *   - path prefix / approved path restrictions;
 *   - explicit exclusion wins over any inclusion;
 *   - link-local, loopback, private and cloud metadata addresses are blocked
 *     unless the asset is the sandboxed training range in demo mode;
 *   - resolved IPs are re-validated immediately before the request to defeat
 *     DNS rebinding.
 */

export type ScopeAsset = {
  id?: string;
  asset_type: 'domain' | 'url' | 'ip_address' | 'cidr' | 'api_endpoint' | 'mobile_app' | 'other';
  value: string;
  path_prefix?: string | null;
  scheme?: string | null;
  port?: number | null;
  allow_subdomains?: boolean | null;
  allowed_methods?: string[] | null;
  approved_paths?: string[] | null;
  is_training_range?: boolean | null;
  ownership_verified?: boolean | null;
};

export type ScopeExclusion = { asset_type: string; value: string; reason?: string | null };

export type ScopeEvaluation = {
  allowed: boolean;
  code:
    | 'allowed'
    | 'invalid_target'
    | 'not_in_scope'
    | 'excluded'
    | 'blocked_address'
    | 'method_not_allowed'
    | 'path_not_allowed'
    | 'scheme_not_allowed'
    | 'port_not_allowed'
    | 'asset_type_not_applicable';
  reason: string;
  matchedAssetId?: string;
  normalised?: { url: string; host: string; path: string; method: string };
};

const DEFAULT_METHODS = ['GET', 'HEAD'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ScopeError extends Error {
  code: ScopeEvaluation['code'];
  constructor(message: string, code: ScopeEvaluation['code']) {
    super(message);
    this.name = 'ScopeError';
    this.code = code;
  }
}

export function normaliseHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/** Parse and sanity check a target URL. */
export function parseTargetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScopeError(`"${raw}" is not a valid absolute URL`, 'invalid_target');
  }
  if (url.username || url.password) throw new ScopeError('URLs containing credentials are not permitted', 'invalid_target');
  if (url.hash) throw new ScopeError('URL fragments are not permitted in assessment targets', 'invalid_target');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScopeError(`scheme ${url.protocol} is not permitted`, 'scheme_not_allowed');
  }
  return url;
}

export function isIpLiteral(host: string): boolean {
  return net.isIP(host) !== 0;
}

export function isPrivateOrSpecialAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
    if (a === 192 && b === 0) return true;
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (version === 6) {
    const normalised = address.toLowerCase();
    if (normalised === '::1' || normalised === '::') return true;
    if (normalised.startsWith('fe80')) return true;
    if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true;
    if (normalised.startsWith('::ffff:')) return isPrivateOrSpecialAddress(normalised.slice(7));
    return false;
  }
  return true;
}

function ipv4ToLong(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function ipv6ToBigInt(ip: string): bigint {
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  return parts.reduce((acc, part) => (acc << 16n) + BigInt(parseInt(part || '0', 16)), 0n);
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const version = net.isIP(ip);
  if (version !== net.isIP(range)) return false;
  const bits = Number(bitsRaw);
  if (!Number.isFinite(bits)) return false;
  if (version === 4) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToLong(ip) & mask) === (ipv4ToLong(range) & mask);
  }
  const totalBits = 128n;
  const shift = totalBits - BigInt(bits);
  const mask = shift <= 0n ? (1n << totalBits) - 1n : ~((1n << shift) - 1n) & ((1n << totalBits) - 1n);
  return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(range) & mask);
}

function hostMatchesAsset(host: string, asset: ScopeAsset): boolean {
  const value = normaliseHost(asset.value.replace(/^https?:\/\//, '').split('/')[0]);
  if (host === value) return true;
  if (asset.allow_subdomains && host.endsWith(`.${value}`)) return true;
  return false;
}

function pathPermitted(pathname: string, asset: ScopeAsset): boolean {
  const approved = asset.approved_paths ?? [];
  if (Array.isArray(approved) && approved.length > 0) {
    const normalisedPath = pathname || '/';
    const exact = approved.some((p) => {
      const candidate = p.startsWith('/') ? p : `/${p}`;
      return normalisedPath === candidate || normalisedPath.startsWith(candidate.endsWith('/') ? candidate : `${candidate}/`) || normalisedPath === candidate;
    });
    if (!exact) return false;
  }
  if (asset.path_prefix) {
    const prefix = asset.path_prefix.startsWith('/') ? asset.path_prefix : `/${asset.path_prefix}`;
    if (!pathname.startsWith(prefix)) return false;
  }
  return true;
}

function isExcluded(host: string, pathname: string, exclusions: ScopeExclusion[]): ScopeExclusion | undefined {
  return exclusions.find((exclusion) => {
    const value = normaliseHost(exclusion.value.replace(/^https?:\/\//, ''));
    if (exclusion.asset_type === 'cidr' || exclusion.asset_type === 'ip_address') {
      const target = value.split('/')[0];
      if (net.isIP(host) && (exclusion.asset_type === 'ip_address' ? host === target : ipInCidr(host, value))) return true;
      if (value.includes('/') && net.isIP(host)) return ipInCidr(host, value);
      return false;
    }
    const hostPart = value.split('/')[0];
    const pathPart = value.includes('/') ? value.slice(hostPart.length) : '';
    if (host === hostPart || host.endsWith(`.${hostPart}`)) {
      if (!pathPart) return true;
      return pathname.startsWith(pathPart);
    }
    return false;
  });
}

export type EvaluateOptions = {
  /** Demo mode only: permits the loopback training range when explicitly scoped. */
  allowLoopbackTrainingRange?: boolean;
};

/**
 * Decide whether a request to `rawUrl` with `method` is inside the approved
 * scope for an engagement.
 */
export function evaluateTarget(
  rawUrl: string,
  method: string,
  assets: ScopeAsset[],
  exclusions: ScopeExclusion[] = [],
  options: EvaluateOptions = {},
): ScopeEvaluation {
  let url: URL;
  try {
    url = parseTargetUrl(rawUrl);
  } catch (error) {
    const scopeError = error as ScopeError;
    return { allowed: false, code: scopeError.code ?? 'invalid_target', reason: scopeError.message };
  }
  const upperMethod = method.toUpperCase();
  const host = normaliseHost(url.hostname);
  const pathname = url.pathname || '/';
  const hostIsIp = isIpLiteral(host);
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

  const exclusion = isExcluded(host, pathname, exclusions);
  if (exclusion) {
    return { allowed: false, code: 'excluded', reason: `Target is explicitly excluded: ${exclusion.reason ?? exclusion.value}` };
  }

  if (hostIsIp && isPrivateOrSpecialAddress(host)) {
    const trainingAsset = assets.find(
      (a) => a.is_training_range && (a.value === host || (a.asset_type === 'cidr' && ipInCidr(host, a.value))),
    );
    if (!trainingAsset || !options.allowLoopbackTrainingRange) {
      return {
        allowed: false,
        code: 'blocked_address',
        reason: `Address ${host} is loopback, private or link-local and is only reachable in the isolated training range`,
      };
    }
  }

  let candidate: ScopeAsset | undefined;
  for (const asset of assets) {
    if (asset.asset_type === 'mobile_app' || asset.asset_type === 'other') continue;
    if (asset.asset_type === 'ip_address' || asset.asset_type === 'cidr') {
      const value = asset.value.split('/')[0];
      const covers = asset.asset_type === 'ip_address' ? host === normaliseHost(value) : net.isIP(host) !== 0 && ipInCidr(host, asset.value);
      if (covers) {
        candidate = asset;
        break;
      }
      continue;
    }
    if (hostMatchesAsset(host, asset)) {
      candidate = asset;
      break;
    }
  }

  if (!candidate) {
    return { allowed: false, code: 'not_in_scope', reason: `Host ${host} is not present in the approved scope for this engagement` };
  }

  if (candidate.scheme && `${candidate.scheme}:` !== url.protocol) {
    return { allowed: false, code: 'scheme_not_allowed', reason: `Approved scheme for this asset is ${candidate.scheme}` };
  }
  if (candidate.port && candidate.port !== port) {
    return { allowed: false, code: 'port_not_allowed', reason: `Approved port for this asset is ${candidate.port}` };
  }
  const allowedMethods = (candidate.allowed_methods ?? DEFAULT_METHODS).map((m) => m.toUpperCase());
  if (!allowedMethods.includes(upperMethod)) {
    return {
      allowed: false,
      code: 'method_not_allowed',
      reason: `Method ${upperMethod} is not approved for this asset (approved: ${allowedMethods.join(', ')})`,
      matchedAssetId: candidate.id,
    };
  }
  if (!pathPermitted(pathname, candidate)) {
    return {
      allowed: false,
      code: 'path_not_allowed',
      reason: `Path ${pathname} is outside the approved paths for this asset`,
      matchedAssetId: candidate.id,
    };
  }

  return {
    allowed: true,
    code: 'allowed',
    reason: 'Target is within the approved engagement scope',
    matchedAssetId: candidate.id,
    normalised: { url: url.toString(), host, path: pathname, method: upperMethod },
  };
}

/** Mobile asset authorisation: the package / bundle identifier must be approved. */
export function evaluateMobileTarget(
  packageId: string,
  assets: ScopeAsset[],
  exclusions: ScopeExclusion[] = [],
): ScopeEvaluation {
  const normalised = packageId.trim();
  if (!normalised) return { allowed: false, code: 'invalid_target', reason: 'Package identifier is required' };
  const excluded = isExcluded(normalised, '/', exclusions.map((e) => ({ ...e, asset_type: 'other' })));
  if (excluded) return { allowed: false, code: 'excluded', reason: 'Application identifier is excluded from scope' };
  const match = assets.find((a) => a.asset_type === 'mobile_app' && a.value.trim() === normalised);
  if (!match) {
    return { allowed: false, code: 'not_in_scope', reason: `Application identifier ${normalised} is not in the approved scope` };
  }
  return { allowed: true, code: 'allowed', reason: 'Approved mobile application identifier', matchedAssetId: match.id };
}

/**
 * DNS resolution guard used immediately before opening a connection.
 * Every resolved address must be public (or explicitly scoped).
 */
export async function assertResolvableTarget(
  host: string,
  assets: ScopeAsset[],
  options: EvaluateOptions = {},
): Promise<{ ok: boolean; reason?: string; addresses: string[] }> {
  if (isIpLiteral(host)) {
    if (isPrivateOrSpecialAddress(host) && !options.allowLoopbackTrainingRange) {
      return { ok: false, reason: `blocked address ${host}`, addresses: [host] };
    }
    return { ok: true, addresses: [host] };
  }
  let addresses: string[] = [];
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch (error) {
    return { ok: false, reason: `DNS resolution failed: ${(error as Error).message}`, addresses: [] };
  }
  if (addresses.length === 0) return { ok: false, reason: 'no DNS records returned', addresses: [] };
  const training = assets.some((a) => a.is_training_range);
  for (const address of addresses) {
    if (isPrivateOrSpecialAddress(address)) {
      if (training && options.allowLoopbackTrainingRange) continue;
      return { ok: false, reason: `host resolves to restricted address ${address}`, addresses };
    }
  }
  return { ok: true, addresses };
}

/** Methods that are never permitted by any engagement, regardless of scope. */
export const PROHIBITED_CAPABILITIES = [
  'denial_of_service',
  'stress_testing',
  'password_spraying',
  'credential_stuffing',
  'real_transactions',
  'customer_data_access',
  'persistence',
  'lateral_movement',
  'social_engineering',
  'physical_intrusion',
];

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/** Summarise scope for display and report appendices. */
export function summariseScope(assets: ScopeAsset[], exclusions: ScopeExclusion[]) {
  const byType: Record<string, number> = {};
  for (const asset of assets) byType[asset.asset_type] = (byType[asset.asset_type] ?? 0) + 1;
  return {
    totalAssets: assets.length,
    byType,
    exclusions: exclusions.length,
    trainingRangeAssets: assets.filter((a) => a.is_training_range).length,
    unverifiedOwnership: assets.filter((a) => !a.ownership_verified).length,
  };
}
