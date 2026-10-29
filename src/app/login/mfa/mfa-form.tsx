'use client';

import { useActionState, useState } from 'react';
import { cancelMfaAction, verifyMfaAction, type MfaState } from '@/app/actions/auth';

const initialState: MfaState = {};

export function MfaForm({ demoCode }: { demoCode: string | null }) {
  const [state, action, pending] = useActionState(verifyMfaAction, initialState);
  const [code, setCode] = useState('');

  return (
    <div className="space-y-3">
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
            <span className="font-sans text-2xs font-semibold uppercase tracking-wide">Use code</span>
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
