'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Route error boundary. The message rendered is deliberately generic: server
 * errors never expose stack traces, SQL or internal identifiers to the browser.
 * The correlation id lets an operator find the matching server-side record.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Report only the digest and message class; never the payload of the request.
    console.error('[ficap] route error', error.digest ?? 'no-digest');
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <p className="text-2xs font-semibold uppercase tracking-wider text-[var(--ficap-muted)]">Something went wrong</p>
      <h1 className="mt-2 text-lg font-semibold text-navy-900">This view could not be completed</h1>
      <p className="mt-2 text-xs leading-relaxed text-[var(--ficap-muted)]">
        No result has been recorded or inferred. The failure has been logged; if it persists, quote the reference below to the platform administrator.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-2xs text-[var(--ficap-muted)]">reference {error.digest}</p> : null}
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
        <Link href="/" className="btn btn-secondary">Overview</Link>
      </div>
    </div>
  );
}
