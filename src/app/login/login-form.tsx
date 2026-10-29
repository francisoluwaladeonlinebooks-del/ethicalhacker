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
            Synthetic accounts for the demonstration dataset. Selecting one fills the form only — you still complete the real password and MFA steps.
          </p>
          <div className="mt-2 grid gap-1">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(demoPassword);
                }}
                className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-white/70 px-2 py-1.5 text-left text-2xs hover:border-amber-300 hover:bg-white"
              >
                <span>
                  <span className="font-semibold text-navy-900">{account.name}</span>
                  <span className="ml-2 text-[var(--ficap-muted)]">{account.role.replace(/_/g, ' ')}</span>
                </span>
                <span className="font-mono text-[10px] text-amber-900">{account.email}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
