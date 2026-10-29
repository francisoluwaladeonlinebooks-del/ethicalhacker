'use client';

import { useEffect, useState } from 'react';

/**
 * Embedded-preview helper.
 *
 * When the platform is shown inside a third-party frame, browsers may withhold
 * cookies from cross-site requests. The sign-in flow still works, but if a
 * cookie is refused the user sees a misleading "session expired" message. This
 * notice explains the situation and offers a first-party tab, where the cookie
 * policy is unambiguous.
 */
export function FramedNotice() {
  const [framed, setFramed] = useState(false);

  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      // A cross-origin parent throws on access; treat that as framed.
      setFramed(true);
    }
  }, []);

  if (!framed) return null;

  return (
    <div className="mb-4 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
      <p className="text-2xs font-semibold uppercase tracking-wider text-slate-700">Embedded view detected</p>
      <p className="mt-1 text-2xs leading-relaxed text-slate-600">
        Some browsers withhold sign-in cookies from pages shown inside a frame, which can interrupt multi-factor verification. Opening the platform in its own
        tab keeps the session intact.
      </p>
      <button
        type="button"
        onClick={() => window.open(window.location.href, '_blank', 'noopener,noreferrer')}
        className="btn btn-secondary btn-xs mt-2"
      >
        Open in a new tab
      </button>
    </div>
  );
}
