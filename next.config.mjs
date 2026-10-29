/**
 * Security response headers, set for every route.
 *
 * The framing policy is the one header that a hosted demonstration has to
 * change: `frame-ancestors 'none'` is the correct default for a supervisory
 * platform, but it also stops the application from being shown inside an
 * embedded preview pane. The default is therefore unchanged and strict, and an
 * operator who needs framed hosting must say so explicitly:
 *
 *   FICAP_FRAME_ANCESTORS="https://console.example.gov.ng"   allow that origin
 *   FICAP_FRAME_ANCESTORS="*"                                allow any origin (demo only)
 *
 * Next.js snapshots the header list when the application is built, so the value
 * must be present for the build (and for the server that serves that build).
 *
 * When an allow-list is configured the CSP directive alone is emitted, because
 * X-Frame-Options cannot express a list; when it is not configured the strict
 * pair (`frame-ancestors 'none'` plus `X-Frame-Options: DENY`) is emitted.
 */
const frameAncestors = (process.env.FICAP_FRAME_ANCESTORS ?? '').trim();
const strictFraming = frameAncestors === '' || frameAncestors.toLowerCase() === 'none';
const framingValue = strictFraming ? "'none'" : frameAncestors;

const contentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  `frame-ancestors ${framingValue}`,
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@electric-sql/pglite', 'pdfkit', 'exceljs'],
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // X-Frame-Options cannot name a list of permitted parents, so it is
          // only emitted alongside the strict policy; otherwise the CSP
          // frame-ancestors directive is the single source of truth.
          ...(strictFraming ? [{ key: 'X-Frame-Options', value: 'DENY' }] : []),
          // HSTS is opt-in. It is only correct when the deployment owns the domain
          // and terminates TLS for every subdomain it covers; emitting it from a
          // shared preview host would pin unrelated subdomains in the operator's
          // browser. Enable with FICAP_ENABLE_HSTS=1 in a real deployment.
          ...(process.env.FICAP_ENABLE_HSTS === '1' || process.env.FICAP_ENABLE_HSTS === 'true'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        ],
      },
    ];
  },
};
export default nextConfig;
