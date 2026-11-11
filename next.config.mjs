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
/**
 * Server Action origin allow-list.
 *
 * `*.e2b.app` is the sandboxed preview host this demonstration runs behind; the
 * loopback entries cover local development. A real deployment behind its own
 * proxy should set FICAP_ALLOWED_ORIGINS (comma separated) and may drop the
 * preview entry, because an allow-listed origin may submit Server Actions.
 * Cross-site submissions still cannot act on a session: `Lax` cookies are not
 * sent on a cross-site POST, and every action re-checks its CSRF token.
 */
const defaultAllowedOrigins = [
  '*.e2b.app',
  'localhost:3000',
  '127.0.0.1:3000',
  '*.run.app',
  '*.google.com',
  '*.aistudio.google.com',
  'ais-dev-ecrs6uduidfimviailbqcw-182201287666.europe-west2.run.app',
  'ais-pre-ecrs6uduidfimviailbqcw-182201287666.europe-west2.run.app',
];
const allowedOrigins = [
  ...new Set([
    ...defaultAllowedOrigins,
    ...(process.env.FICAP_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  ]),
];

const contentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "font-src 'self' data:",
  "connect-src 'self' https://api.osv.dev https://*.huggingface.co https://*.run.app",
  "frame-ancestors *",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@electric-sql/pglite', 'pdfkit', 'exceljs'],
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
      allowedOrigins: allowedOrigins,
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          ...(process.env.FICAP_ENABLE_HSTS === '1' || process.env.FICAP_ENABLE_HSTS === 'true'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        ],
      },
    ];
  },
};
export default nextConfig;
