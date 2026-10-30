'use client';

import { useActionState, useState } from 'react';
import { loginAction, type LoginState } from '@/app/actions/auth';
import { FramedNotice } from '@/components/framed-notice';

type DemoAccount = { email: string; role: string; name: string };

const initialState: LoginState = {};

export function LoginForm({ demoAccounts, demoPassword }: { demoAccounts: DemoAccount[]; demoPassword: string }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="space-y-4">
      <FramedNotice />
      <form action={action} className="space-y-3" autoComplete="on">
        {state.error ? (
          <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            {state.error}
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="email">
            Official email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className="input mt-1"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@cbn.gov.ng"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input mt-1"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••••"
          />
        </div>
        <button type="submit" className="btn btn-primary w-full py-2 text-sm" disabled={pending}>
          {pending ? 'Verifying credentials…' : 'Continue to multi-factor step'}
        </button>
        <p className="prose-note text-center">
          Access is restricted to authorised CBN personnel and nominated institution contacts. All authentication attempts are logged.
        </p>
      </form>

      {demoAccounts.length ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-amber-900">Demonstration accounts</p>
          <p className="mt-1 text-2xs leading-relaxed text-amber-900/80">
            Synthetic accounts for the demonstration dataset. Choose one to sign in without typing — the password step is still the real
            password check, and the second step is still real multi-factor verification.
          </p>
          <p className="mt-1 text-2xs text-amber-900/80">
            Password for every account below: <span className="font-mono font-semibold">{demoPassword}</span>
          </p>
          <div className="mt-2 grid gap-1">
            {demoAccounts.map((account) => (
              // Each account is its own form so the choice works with JavaScript
              // disabled as well: no typing, no copy-paste of a mangled address.
              <form key={account.email} action={action}>
                <input type="hidden" name="email" value={account.email} />
                <input type="hidden" name="password" value={demoPassword} />
                <button
                  type="submit"
                  disabled={pending}
                  className="flex w-full items-center justify-between gap-2 rounded border border-amber-200 bg-white/70 px-2 py-1.5 text-left text-2xs hover:border-amber-300 hover:bg-white disabled:opacity-60"
                >
                  <span>
                    <span className="font-semibold text-navy-900">{account.name}</span>
                    <span className="ml-2 text-[var(--ficap-muted)]">{account.role.replace(/_/g, ' ')}</span>
                  </span>
                  <span className="font-mono text-[10px] text-amber-900">{account.email}</span>
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
