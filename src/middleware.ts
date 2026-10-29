import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware: coarse, per-client request throttling.
 *
 * Purpose: blunt the two cheapest abuse paths — credential stuffing against the
 * sign-in endpoints and bulk scraping of the API surface. It is deliberately
 * conservative and it is NOT the authorisation layer: every request is still
 * authenticated, authorised and scope-checked inside the application.
 *
 * The counter is in-process and resets on restart, which is appropriate for a
 * single-instance deployment. A multi-instance deployment must move the counter
 * to a shared store (Redis or the database) before relying on it.
 */

const WINDOW_MS = 60_000;

type Bucket = { windowStart: number; count: number };

const buckets = new Map<string, Bucket>();

/** Keep the map from growing without bound under many distinct clients. */
function prune(now: number) {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS * 2) buckets.delete(key);
  }
}

type Rule = { limit: number; match: (pathname: string, method: string) => boolean };

const RULES: Rule[] = [
  { limit: 20, match: (pathname, method) => method === 'POST' && pathname.startsWith('/login') },
  { limit: 90, match: (pathname) => pathname.startsWith('/api/') },
  { limit: 300, match: () => true },
];

function clientKey(request: NextRequest, rule: Rule): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'local';
  return `${ip}:${rule.limit}`;
}

function disabled(): boolean {
  const value = (process.env.FICAP_RATE_LIMIT_DISABLED ?? '').toLowerCase();
  return value === '1' || value === 'true';
}

export function middleware(request: NextRequest) {
  if (disabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();
  const rule = RULES.find((candidate) => candidate.match(pathname, method));
  if (!rule) return NextResponse.next();

  const now = Date.now();
  prune(now);
  const key = clientKey(request, rule);
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return NextResponse.next();
  }

  bucket.count += 1;
  if (bucket.count <= rule.limit) return NextResponse.next();

  const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000));
  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/html')) {
    return new NextResponse('Too many requests. Wait a moment and try again.', {
      status: 429,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.json(
    { error: 'Too many requests', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } },
  );
}

export const config = {
  // Static assets and the Next internals are excluded: they are content-hashed
  // and carry no user data, and throttling them would break page rendering.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|css|js|map|woff2?)$).*)'],
};
