'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelMfaAction, verifyMfaAction, type MfaState } from '@/app/actions/auth';
import { FramedNotice } from '@/components/framed-notice';

const initialState: MfaState = {};

/** Seconds until the current one-time step ends (0 at the boundary). */
function secondsUntilNextStep(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

export function MfaForm({ demoCode }: { demoCode: string | null }) {
  const [state, action, pending] = useActionState(verifyMfaAction, initialState);
  const [code, setCode] = useState('');
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(secondsUntilNextStep);

  // A one-time code is only valid for its own 30-second step (plus one step of
  // clock tolerance). The code rendered with this page is therefore re-rendered
  // as each step rolls over, so a page left open for a minute cannot hand the
  // user a code that has already expired.
  useEffect(() => {
    if (!demoCode) return;
    const timer = setInterval(() => {
      const remaining = secondsUntilNextStep();
      setSecondsLeft(remaining);
      if (remaining >= 30) router.refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, [demoCode, router]);

  return (
    <div className="space-y-3">
      <FramedNotice />
      <form action={action} className="space-y-3">
        {state.error ? (
          <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            {state.error}
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="code">
            Authenticator code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="input mt-1 font-mono text-lg tracking-[0.4em]"
            placeholder="000000"
          />
        </div>
        <button type="submit" className="btn btn-primary w-full py-2 text-sm" disabled={pending || code.length !== 6}>
          {pending ? 'Verifying…' : 'Verify and open platform'}
        </button>
      </form>

      {demoCode ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2">
          <p className="text-2xs font-semibold uppercase tracking-wider text-amber-900">Demonstration mode</p>
          <p className="mt-1 text-2xs leading-relaxed text-amber-900/80">
            No authenticator device is enrolled for the synthetic account. The current code is shown here so the real MFA verification
            step can be completed.
          </p>
          <button
            type="button"
            onClick={() => setCode(demoCode)}
            className="mt-2 flex w-full items-center justify-between rounded border border-amber-200 bg-white/80 px-2 py-1.5 font-mono text-sm text-amber-900 hover:bg-white"
          >
            <span className="tracking-[0.3em]">{demoCode}</span>
            <span className="font-sans text-2xs font-semibold uppercase tracking-wide">
              Use code · {secondsLeft}s left
            </span>
          </button>
        </div>
      ) : null}

      <form action={cancelMfaAction}>
        <button type="submit" className="btn btn-ghost w-full text-2xs">
          Cancel and return to sign in
        </button>
      </form>
    </div>
  );
}
