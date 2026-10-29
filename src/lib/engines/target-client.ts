import dns from 'node:dns/promises';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import {
  assertResolvableTarget,
  evaluateTarget,
  isPrivateOrSpecialAddress,
  parseTargetUrl,
  type ScopeAsset,
  type ScopeExclusion,
} from '@/lib/scope';
import { redactHeaders, redactText } from '@/lib/redact';
import { RateLimitError, ScopeViolationError } from '@/lib/errors';
import type { FetchedResponse } from '@/lib/engines/types';

/**
 * Scope-enforcing HTTP client used by all assessment engines.
 *
 * Safety properties:
 *  - every request is authorised against the engagement scope before a socket
 *    is opened, including each redirect hop;
 *  - redirects that leave scope are never followed;
 *  - DNS is resolved and re-validated to prevent rebinding to internal hosts;
 *  - a bounded request budget, request rate and timeout are enforced;
 *  - response bodies are capped and redacted before they become evidence;
 *  - cancellation is polled so the global / engagement stop controls take
 *    effect promptly.
 */

export type TargetClientOptions = {
  assets: ScopeAsset[];
  exclusions: ScopeExclusion[];
  limits: { maxRequestsPerSecond?: number; maxConcurrency?: number; maxRequestsTotal?: number; maxDurationMinutes?: number };
  allowLoopbackTrainingRange: boolean;
  shouldCancel?: () => Promise<boolean>;
  onEvent?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
  startedAt?: number;
};

export class AssessmentTargetClient {
  requestsMade = 0;
  private nextSlotAt = 0;
  private readonly options: TargetClientOptions;

  constructor(options: TargetClientOptions) {
    this.options = options;
  }

  get remainingBudget(): number {
    const total = this.options.limits.maxRequestsTotal ?? 1000;
    return Math.max(0, total - this.requestsMade);
  }

  private async guard(method: string, url: string) {
    if (this.options.shouldCancel && (await this.options.shouldCancel())) {
      throw new ScopeViolationError('Assessment cancelled by operator', { code: 'cancelled' });
    }
    const maxDuration = (this.options.limits.maxDurationMinutes ?? 120) * 60_000;
    if (this.options.startedAt && Date.now() - this.options.startedAt > maxDuration) {
      throw new ScopeViolationError('Assessment exceeded the configured maximum duration', { code: 'max_duration' });
    }
    if (this.remainingBudget <= 0) {
      throw new RateLimitError('Engagement request budget exhausted');
    }

    const decision = evaluateTarget(url, method, this.options.assets, this.options.exclusions, {
      allowLoopbackTrainingRange: this.options.allowLoopbackTrainingRange,
    });
    if (!decision.allowed) {
      throw new ScopeViolationError(`Blocked by scope enforcement: ${decision.reason}`, { code: decision.code, url });
    }

    const parsed = parseTargetUrl(url);
    const host = parsed.hostname;
    const resolved = await assertResolvableTarget(host, this.options.assets, {
      allowLoopbackTrainingRange: this.options.allowLoopbackTrainingRange,
    });
    if (!resolved.ok) {
      throw new ScopeViolationError(`Blocked target resolution: ${resolved.reason}`, { code: 'dns_blocked', url });
    }

    // Token bucket: serialise request start times to the configured rate.
    const rate = this.options.limits.maxRequestsPerSecond ?? 2;
    const interval = rate > 0 ? 1000 / rate : 0;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + interval;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
    return decision;
  }

  async request(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number; followRedirects?: boolean } = {},
  ): Promise<FetchedResponse> {
    const method = (init.method ?? 'GET').toUpperCase();
    const maxBytes = init.maxBytes ?? this.options.maxBytes ?? 262_144;
    const started = performance.now();
    const redirectChain: FetchedResponse['redirectChain'] = [];
    let currentUrl = url;
    let response: Response | null = null;
    const maxRedirects = init.followRedirects === false ? 0 : 3;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      await this.guard(method, currentUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
      try {
        response = await fetch(currentUrl, {
          method,
          headers: {
            'user-agent': 'FICAP-Assessment/1.0 (authorised security assessment; contact CBN)',
            accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
            ...(init.headers ?? {}),
          },
          body: method === 'GET' || method === 'HEAD' ? undefined : init.body,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeout);
        this.requestsMade += 1;
        throw new Error(`Request failed: ${(error as Error).message}`);
      }
      clearTimeout(timeout);
      this.requestsMade += 1;

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location && hop < maxRedirects) {
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          break;
        }
        redirectChain.push({ url: currentUrl, status: response.status, location: nextUrl });
        const hopDecision = evaluateTarget(nextUrl, method, this.options.assets, this.options.exclusions, {
          allowLoopbackTrainingRange: this.options.allowLoopbackTrainingRange,
        });
        if (!hopDecision.allowed) {
          await this.options.onEvent?.('warn', 'Redirect left the approved scope and was not followed', { from: currentUrl, to: nextUrl, reason: hopDecision.reason });
          return {
            requestedUrl: url,
            finalUrl: currentUrl,
            status: response.status,
            statusText: response.statusText,
            headers: this.collectHeaders(response),
            body: '',
            bodyBytes: 0,
            truncated: false,
            durationMs: Math.round(performance.now() - started),
            redirectChain,
          };
        }
        currentUrl = nextUrl;
        continue;
      }
      break;
    }

    if (!response) throw new Error('No response received');
    const buffer = Buffer.from(await response.arrayBuffer());
    const truncated = buffer.length > maxBytes;
    const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
    const contentType = response.headers.get('content-type') ?? '';
    const isText = /text\/|json|xml|javascript/i.test(contentType);
    const rawBody = isText ? slice.toString('utf8') : `[binary content: ${buffer.length} bytes, ${contentType || 'unknown type'}]`;
    const redactedBody = redactText(rawBody).text;

    return {
      requestedUrl: url,
      finalUrl: currentUrl,
      status: response.status,
      statusText: response.statusText,
      headers: this.collectHeaders(response),
      body: redactedBody,
      bodyBytes: buffer.length,
      truncated,
      durationMs: Math.round(performance.now() - started),
      redirectChain,
    };
  }

  private collectHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    const setCookie = typeof (response.headers as any).getSetCookie === 'function' ? (response.headers as any).getSetCookie() : [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return;
      headers[key.toLowerCase()] = value;
    });
    const redacted = redactHeaders(headers) as Record<string, string>;
    if (setCookie.length > 0) {
      // Keep the attribute structure (Secure/HttpOnly/SameSite) but never the
      // cookie value itself. One cookie per line for reliable analysis.
      redacted['set-cookie'] = setCookie
        .map((cookie: string) => cookie.replace(/^([^=]+)=[^;]*/, '$1=[REDACTED]'))
        .join('\n');
    }
    return redacted;
  }
}

export type TlsInspection = {
  ok: boolean;
  protocol?: string;
  cipher?: string;
  authorised?: string;
  validTo?: string;
  issuer?: string;
  subjectAltNames?: string[];
  error?: string;
  weakProtocol?: boolean;
};

/** Non-invasive TLS configuration inspection of an in-scope host. */
export async function inspectTls(host: string, port = 443, timeoutMs = 8000): Promise<TlsInspection> {
  if (isPrivateOrSpecialAddress(host)) {
    // Loopback training range speaks plain HTTP; TLS inspection is not applicable.
    return { ok: false, error: 'TLS inspection not applicable to loopback training range' };
  }
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const protocol = socket.getProtocol();
      const cipher = socket.getCipher();
      const certificate = socket.getPeerCertificate();
      const weakProtocol = ['TLSv1', 'TLSv1.1', 'SSLv3'].includes(protocol ?? '');
      resolve({
        ok: true,
        protocol: protocol ?? undefined,
        cipher: cipher?.name,
        authorised: certificate?.issuer?.O,
        validTo: certificate?.valid_to,
        issuer: certificate?.issuer?.CN,
        subjectAltNames: certificate?.subjectaltname ? [certificate.subjectaltname] : [],
        weakProtocol,
      });
      socket.end();
    });
    socket.on('error', (error) => resolve({ ok: false, error: error.message }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'TLS handshake timed out' });
    });
  });
}

/** Resolve the engagement's approved probe paths for the asset covering `url`. */
export function approvedPathsFor(url: string, assets: ScopeAsset[]): string[] {
  try {
    const parsed = new URL(url);
    const asset = assets.find((candidate) => {
      const value = candidate.value.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      return parsed.hostname.toLowerCase() === value || parsed.hostname.toLowerCase().endsWith(`.${value}`);
    });
    return (asset?.approved_paths ?? []).filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

export async function hostnameResolves(host: string): Promise<boolean> {
  try {
    const records = await dns.lookup(host, { all: true });
    return records.length > 0;
  } catch {
    return false;
  }
}
